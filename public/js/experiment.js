// public/js/experiment.js
// Experimento 1→8 con jsPsych. Registra métricas en /log y envía resumen a /finalize.
// No hay claves de API en el frontend.

(() => {
  // ====== Utilidades básicas ======
  const nowIso = () => new Date().toISOString();
  const wordsOf = (t) => t.trim().split(/\s+/).filter(Boolean).length;

  // Identificador de participante
  const subject_id = 'S-' + Math.random().toString(36).slice(2, 10).toUpperCase();

  // Política IA aleatoria
  const policies = [
    {
      key:'permisiva',
      label:'Permisiva',
      description: 'Para esta tarea, el uso de herramientas de inteligencia artificial generativa <strong>está permitido</strong>. Puedes apoyarte en ellas libremente durante todo el proceso.',
      showAIButton: true
    },
    {
      key:'difusa',
      label:'Ambigua',
      description: 'Para esta tarea, el uso de herramientas de inteligencia artificial generativa <strong>queda a tu criterio</strong> personal. Tú decides si apoyarte en ellas.',
      showAIButton: true
    },
    {
      key:'restrictiva',
      label:'Restrictiva',
      description: 'Para esta tarea, el uso de herramientas de inteligencia artificial generativa <strong>no está permitido</strong>. El texto debe ser redactado íntegramente por ti.',
      showAIButton: true
    }
  ];
  const assignedPolicy = policies[Math.floor(Math.random()*policies.length)];

  // Estado de métricas por trial
  let trialClickCount = 0;
  let lastClickAt = Date.now();
  let idleMs = 0;
  let lastActivityAt = Date.now();
  let idleTimer = null;
  let _idleBump = null; // Referencia fija para poder eliminar los listeners de idle
  let screenStartTime = Date.now(); // Tiempo de inicio de cada pantalla

  // ====== Sistema de envío de eventos en batch ======
  const eventBuffer = [];
  let flushTimer = null;
  const FLUSH_INTERVAL = 5000;  // Enviar cada 5 segundos
  const FLUSH_SIZE = 10;        // O cuando haya 10+ eventos

  function queueEvent(event, payload={}) {
    eventBuffer.push({ subject_id, event, payload, ts: nowIso(), policy: assignedPolicy.key });
    // Flush inmediato si hay suficientes eventos
    if (eventBuffer.length >= FLUSH_SIZE) {
      flushEventBuffer();
    } else if (!flushTimer) {
      flushTimer = setTimeout(flushEventBuffer, FLUSH_INTERVAL);
    }
  }

  async function flushEventBuffer() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (eventBuffer.length === 0) return;

    const batch = eventBuffer.splice(0);  // Vaciar buffer
    try {
      const response = await fetch('/log-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch })
      });
      if (!response.ok) {
        console.warn(`⚠️ Batch log failed (${response.status}), reintentando en ${FLUSH_INTERVAL/1000}s`);
        // Re-encolar eventos que fallaron y programar reintento
        eventBuffer.unshift(...batch);
        if (!flushTimer) flushTimer = setTimeout(flushEventBuffer, FLUSH_INTERVAL);
      }
    } catch (err) {
      console.warn(`⚠️ Batch log network error:`, err.message, `— reintentando en ${FLUSH_INTERVAL/1000}s`);
      eventBuffer.unshift(...batch);
      if (!flushTimer) flushTimer = setTimeout(flushEventBuffer, FLUSH_INTERVAL);
    }
  }

  // Flush al cerrar/cambiar de página
  window.addEventListener('beforeunload', () => {
    if (eventBuffer.length > 0) {
      const batch = eventBuffer.splice(0);
      // sendBeacon es más fiable que fetch al cerrar página
      const blob = new Blob([JSON.stringify({ events: batch })], { type: 'application/json' });
      navigator.sendBeacon('/log-batch', blob);
    }
  });

  // Enviar evento al backend usando el sistema de batch
  async function sendLog(event, payload={}) {
    queueEvent(event, payload);
  }

  // Flush forzado con reintentos (para momentos críticos como finalize)
  async function flushAndWait(maxAttempts = 3) {
    for (let i = 0; i < maxAttempts; i++) {
      if (eventBuffer.length === 0) break;
      await flushEventBuffer();
      if (eventBuffer.length > 0) {
        // El flush falló y re-encoló — esperar antes de reintentar
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
    // Indicar al servidor que vacíe su cola interna (por si quedó algo del endpoint /log)
    try {
      await fetch('/flush-events', { method: 'POST' });
    } catch (e) {
      console.warn('⚠️ flush-events failed:', e.message);
    }
  }

  // Arranca contador de inactividad (inactividad >2s suma)
  function startIdleWatch(){
    stopIdleWatch(); // Limpia siempre listeners y timer previos antes de añadir nuevos
    lastActivityAt = Date.now();
    idleMs = 0;
    _idleBump = () => { lastActivityAt = Date.now(); };
    window.addEventListener('mousemove',   _idleBump, { capture:true, passive:true });
    window.addEventListener('keydown',     _idleBump, { capture:true, passive:true });
    window.addEventListener('click',       _idleBump, { capture:true, passive:true });
    window.addEventListener('touchstart',  _idleBump, { capture:true, passive:true });
    idleTimer = setInterval(() => {
      const since = Date.now() - lastActivityAt;
      if (since > 2000) idleMs += 1000;
    }, 1000);
  }
  function stopIdleWatch(){
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    if (_idleBump) {
      window.removeEventListener('mousemove',  _idleBump, { capture:true });
      window.removeEventListener('keydown',    _idleBump, { capture:true });
      window.removeEventListener('click',      _idleBump, { capture:true });
      window.removeEventListener('touchstart', _idleBump, { capture:true });
      _idleBump = null;
    }
  }

  // ====== jsPsych setup ======
  const jsPsych = initJsPsych({
    display_element: 'jspsych-target',
    show_progress_bar: true,        // barra de progreso integrada
    auto_update_progress_bar: true, // jsPsych avanza solo con cada trial
    on_trial_start: async (t) => {
      trialClickCount = 0;
      lastClickAt = Date.now();
      screenStartTime = Date.now(); // Resetear tiempo de inicio de pantalla
      startIdleWatch();
      // No enviar el objeto 't' completo porque tiene referencias circulares
      await sendLog('screen_enter', {
        trial_index: jsPsych.getProgress().current_trial_global,
        trial_type: t.type?.name || 'unknown'
      });
      // contar clics dentro del trial
      document.addEventListener('click', clickBump, { once:false });
    },
    on_trial_finish: async (data) => {
      stopIdleWatch();
      document.removeEventListener('click', clickBump, { once:false });
      const screenEndTime = Date.now();
      const timeOnScreen = screenEndTime - screenStartTime;

      await sendLog('screen_leave', {
        rt_ms: data.rt ?? null,
        clicks: trialClickCount,
        idle_ms: idleMs,
        time_on_screen_ms: timeOnScreen,
        time_on_screen_seconds: Math.round(timeOnScreen / 1000),
        trial_type: data.trial_type,
        trial_index: jsPsych.getProgress().current_trial_global
      });
    },
    on_finish: () => {
      const target = document.getElementById('jspsych-target');
      if (target) {
        const ok = store._finalize_ok === true;
        target.innerHTML = `
          <div style="display:flex;justify-content:center;align-items:center;min-height:60vh;padding:24px;">
            <div class="center">
              <h2>¡Gracias por participar!</h2>
              <p>${ok
                ? 'Tu respuesta ha sido guardada correctamente.'
                : 'Hubo un problema al guardar tu respuesta. Por favor, contacta con nosotros para confirmar que se ha registrado.'}</p>
              <p class="muted">
                Si deseas más información o retirar tus datos, escríbenos a
                <a href="mailto:pmartinmartinez@alu.comillas.edu">pmartinmartinez@alu.comillas.edu</a>.
              </p>
            </div>
          </div>`;
      }
    }
  });

  function clickBump(e){
    const now = Date.now();
    const delta = now - lastClickAt;
    lastClickAt = now;
    trialClickCount += 1;

    // Capturar información del elemento clickeado
    const target = e.target;
    const elementInfo = {
      tag: target.tagName,
      id: target.id || null,
      class: target.className || null,
      text: target.textContent?.slice(0, 50) || null, // Primeros 50 caracteres
      type: target.type || null
    };

    // Fire and forget - no esperamos respuesta para no bloquear
    sendLog('click', {
      trial_index: jsPsych.getProgress().current_trial_global,
      since_prev_click_ms: delta,
      element: elementInfo,
      screen_time_ms: now - screenStartTime
    }).catch(() => {});
  }

  // ====== VARIABLES QUE RECOGEMOS A LO LARGO DEL FLUJO ======
  const store = {
    dob: '', sex: '', basicStudies: '', gradYear: null,
    intro_ack: true,
    task_text: '', task_edits: [],
    ai_usage: {},
    control: {}, demographics: {}, personality: {}, ai_motivation: {},
    // Tracking de uso de IA y copy/paste
    ai_text_inserted: 0,  // Caracteres insertados desde sugerencias de IA
    paste_count: 0,       // Número de veces que se pegó texto
    paste_total_chars: 0, // Total de caracteres pegados
    email: '',            // Correo electrónico (opcional)
    _finalize_ok: null    // Resultado de la finalización (para thank-you)
  };

  // ====== PANTALLA 1 — Bienvenida y consentimiento ======
  const s1 = {
    type: jsPsychSurveyHtmlForm,
    preamble: `
      <h2>Bienvenida</h2>
      <p>
        El siguiente experimento forma parte de un Trabajo de Fin de Grado para la Universidad Pontificia Comillas.
        Toda la información será recolectada de forma anónima y su uso será únicamente académico y de investigación.
      </p>
      <p>
        <strong>¡Muchas gracias por responder!</strong> Te llevará <strong>como máximo 10 minutos</strong> (aunque normalmente alrededor de 5 minutos) y es de gran ayuda para la investigación que te quedes hasta el final. <strong>Por favor, lee todo atentamente antes de continuar.</strong>
      </p>
      <p class="muted">
        Contacto: <a href="mailto:pmartinmartinez@alu.comillas.edu">pmartinmartinez@alu.comillas.edu</a>
      </p>
    `,
    html: `
      <label class="checkbox">
        <input type="checkbox" name="consent" value="yes" required />
        Acepto participar y el uso anónimo de mis datos.
      </label>
    `,
    button_label: 'Continuar',
    on_load: () => sendLog('policy_assigned', { policy: assignedPolicy.key })
  };

  // ====== PANTALLA 2 — Fecha nacimiento + sexo + estudios ======
  const s2 = {
    type: jsPsychSurveyHtmlForm,
    preamble: `<h2>Datos iniciales</h2>`,
    html: `
      <label class="label">Fecha de nacimiento (dd/mm/aaaa)</label>
      <div class="row-3">
        <input class="input" type="number" name="dob_day" placeholder="dd" min="1" max="31" required />
        <input class="input" type="number" name="dob_month" placeholder="mm" min="1" max="12" required />
        <input class="input" type="number" name="dob_year" placeholder="aaaa" min="1900" max="2035" required />
      </div>

      <label class="label">Sexo</label>
      <select class="input" name="sex" required>
        <option value="">Selecciona…</option>
        <option>Hombre</option>
        <option>Mujer</option>
      </select>

      <label class="label">Últimos estudios superiores cursados (terminados o en progreso)</label>
      <select class="input" name="studies" id="studies" required>
        <option value="">Selecciona…</option>
        <option>Bachillerato</option>
        <option>Formación Profesional Superior</option>
        <option>Grado</option>
        <option>Máster</option>
        <option>Doctorado</option>
      </select>

      <label class="label">Año de graduación de los últimos estudios superiores (en curso o finalizados)</label>
      <input class="input" type="number" name="grad_year" id="grad_year" min="1950" max="2035" placeholder="Ej: 2024" required />
    `,
    button_label: 'Continuar',
    on_finish: async (data) => {
      const d = data.response;
      store.dob = `${d.dob_day}/${d.dob_month}/${d.dob_year}`;
      store.sex = d.sex;
      store.basicStudies = d.studies;
      store.gradYear = d.grad_year ? Number(d.grad_year) : null;
      await sendLog('demographics_basic', { dob: store.dob, sex: store.sex, studies: store.basicStudies, grad_year: store.gradYear });
    }
  };

  // ====== PANTALLA 3 — Introducción + política IA visible ======
  const taskPrompt = 'Escribe sobre cómo tus estudios te han ayudado o te ayudarán en tu futuro profesional y/o personal. Puedes enfocarte en las competencias adquiridas, tus objetivos, o cualquier aspecto que consideres relevante.';

  const s3 = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="card-plain">
        <h2>Introducción a la tarea</h2>
        <p>
          ${taskPrompt}
        </p>
        <p class="muted" style="font-size:0.9em;">Redacta un texto de entre <strong>60 y 120 palabras</strong>.</p>
        <div class="policy">
          <span style="font-size:0.85em; font-weight:600; color:var(--muted);">Política de uso de IA</span>
          <p>${assignedPolicy.description}</p>
        </div>
      </div>
    `,
    choices: ['Continuar'],
    enable_button_after: 3000
  };

  // ====== PANTALLA 4 — Tarea 60–120 palabras + Ayuda IA con OpenAI ======
  let editLog = [];

  const s4 = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div>
        <h2>Tarea</h2>
        <p class="task-prompt"><em>${taskPrompt}</em></p>
        <p>Redacta un texto entre <strong>60 y 120 palabras</strong>.</p>
        <textarea class="input" id="task_text" rows="10" placeholder="Escribe aquí…"></textarea>
        <div class="task-tools">
          ${assignedPolicy.showAIButton ? '<button id="ai_help" class="btn-outline" type="button" title="Selecciona texto para reescribirlo, o pulsa sin seleccionar para obtener una frase que puedas insertar directamente.">✨ Ayuda de IA</button>' : '<span></span>'}
          <span id="word_count" class="muted">0 palabras</span>
        </div>
        <div id="ai_suggestions" class="suggestions hidden"></div>
        <div class="policy" style="margin-top:16px; opacity:0.65;">
          <span style="font-size:0.85em; font-weight:600; color:var(--muted);">Política de uso de IA</span>
          <p>${assignedPolicy.description}</p>
        </div>
      </div>
    `,
    choices: ['Continuar'],
    on_load: () => {
      // Resetear editLog para este trial (evita acumulación si la pantalla se recarga)
      editLog = [];

      // deshabilita botón "Continuar" hasta llegar a 90
      const contBtn = document.querySelector('.jspsych-btn');
      contBtn.disabled = true;

      const ta = document.getElementById('task_text');
      const wc = document.getElementById('word_count');
      const panel = document.getElementById('ai_suggestions');
      const help = document.getElementById('ai_help');

      const MIN_WORDS = 60, MAX_WORDS = 120;
      const update = () => {
        const n = wordsOf(ta.value);
        const inRange = n >= MIN_WORDS && n <= MAX_WORDS;
        // Texto del contador con pista cuando está fuera de rango
        if (n === 0) {
          wc.textContent = `0 palabras`;
          wc.style.color = 'var(--muted)';
        } else if (n < MIN_WORDS) {
          wc.textContent = `${n} palabras — mínimo ${MIN_WORDS}`;
          wc.style.color = '#dc2626';
        } else if (n > MAX_WORDS) {
          wc.textContent = `${n} palabras — máximo ${MAX_WORDS}`;
          wc.style.color = '#dc2626';
        } else {
          wc.textContent = `${n} palabras ✓`;
          wc.style.color = 'var(--accent)';
        }
        contBtn.disabled = !inRange;
        editLog.push({ t: nowIso(), len: ta.value.length });
        // Guardar en store para que esté disponible en on_finish
        store.task_text = ta.value;
      };
      ta.addEventListener('input', update);
      update();

      // Tracking de copy/paste
      ta.addEventListener('paste', (e) => {
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        const pastedLength = pastedText.length;
        store.paste_count += 1;
        store.paste_total_chars += pastedLength;
        sendLog('paste', {
          paste_count: store.paste_count,
          chars_pasted: pastedLength,
          total_chars_pasted: store.paste_total_chars,
          text_preview: pastedText.slice(0, 50)  // Primeros 50 caracteres del texto pegado
        }).catch(() => {});
      });

      // Tracking de copy
      ta.addEventListener('copy', (e) => {
        const selectedText = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        sendLog('copy', {
          chars_copied: selectedText.length,
          text_preview: selectedText.slice(0, 50)
        }).catch(() => {});
      });

      // Tracking de cut
      ta.addEventListener('cut', (e) => {
        const selectedText = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        sendLog('cut', {
          chars_cut: selectedText.length,
          text_preview: selectedText.slice(0, 50)
        }).catch(() => {});
      });

      // Solo si el botón existe (no en política restrictiva)
      if (help) {
        help.addEventListener('click', async () => {
          // Deshabilitar botón mientras carga
          help.disabled = true;
          help.textContent = 'Generando sugerencia...';
          panel.classList.add('hidden');

          const text = ta.value;
          const start = ta.selectionStart, end = ta.selectionEnd;
          const selection = end > start ? ta.value.slice(start, end) : '';

          // Registrar el clic al botón inmediatamente, antes de llamar a la API
          sendLog('ai_help_open', { has_selection: selection.length > 0 }).catch(() => {});

          try {
            const response = await fetch('/ai-suggest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: text,
                selection: selection,
                policy: assignedPolicy.key
              })
            });

            // Validar código de respuesta
            if (!response.ok) {
              let errorMessage = 'Error al obtener sugerencia';
              try {
                const errorData = await response.json();
                if (errorData && errorData.error) {
                  errorMessage = errorData.error;
                }
              } catch (e) {
                // Si no se puede parsear el error, usar mensaje genérico
              }
              throw new Error(errorMessage);
            }

            // Parsear JSON con validación
            let result;
            try {
              result = await response.json();
            } catch (e) {
              console.error('Error parseando JSON de respuesta:', e);
              throw new Error('Respuesta inválida del servidor');
            }

            // Validar estructura de respuesta
            if (!result || typeof result !== 'object') {
              console.error('Respuesta no es un objeto:', result);
              throw new Error('Respuesta inválida del servidor');
            }

            if (!result.ok) {
              const errorMessage = result.error || 'Error desconocido';
              throw new Error(errorMessage);
            }

            if (!result.suggestion || typeof result.suggestion !== 'string') {
              console.error('Respuesta sin sugerencia válida:', result);
              throw new Error('El servidor no devolvió una sugerencia válida');
            }

            const suggestion = result.suggestion.trim();

            if (!suggestion) {
              throw new Error('La sugerencia está vacía');
            }

            // Mostrar sugerencia como botón clickeable (textContent evita XSS)
            panel.innerHTML = `
              <div style="display:flex; flex-direction:column; gap:8px; width:100%;">
                <p class="muted" style="margin:0; font-size:0.9em;">Haz clic para insertar:</p>
                <button class="chip ai-chip" type="button" style="text-align:left; white-space:normal;"></button>
              </div>
            `;
            panel.querySelector('.ai-chip').textContent = suggestion;
            panel.classList.remove('hidden');

            // Al hacer click, insertar la sugerencia
            panel.querySelector('.ai-chip').addEventListener('click', () => {
              const insertedChars = suggestion.length;
              store.ai_text_inserted += insertedChars;

              if (selection) {
                // Reemplazar selección
                ta.setRangeText(suggestion, start, end, 'end');
              } else {
                // Añadir al final
                const prefix = ta.value.endsWith('\n') || ta.value === '' ? '' : '\n';
                const textToInsert = prefix + suggestion;
                ta.setRangeText(textToInsert, ta.value.length, ta.value.length, 'end');
              }
              ta.dispatchEvent(new Event('input'));
              panel.classList.add('hidden');

              sendLog('ai_text_inserted', {
                suggestion: suggestion,
                chars_inserted: insertedChars,
                total_ai_chars: store.ai_text_inserted,
                selection_chars: selection.length,
                replaced_selection: selection.length > 0
              }).catch(() => {});
            });

          } catch (error) {
            panel.innerHTML = '<p class="muted" style="color:red;">Error al obtener sugerencia. Inténtalo de nuevo.</p>';
            panel.classList.remove('hidden');
            console.error('Error al obtener sugerencia de IA:', error);
          } finally {
            help.disabled = false;
            help.textContent = '✨ Ayuda de IA';
          }
        });
      }
    },
    on_finish: async (data) => {
      // El texto ya está en store.task_text gracias al update()
      store.task_edits = editLog.slice(-50);
      const totalChars = store.task_text.length;
      const aiPercentage = totalChars > 0 ? ((store.ai_text_inserted / totalChars) * 100).toFixed(2) : 0;
      const pastePercentage = totalChars > 0 ? ((store.paste_total_chars / totalChars) * 100).toFixed(2) : 0;

      await sendLog('task_snapshot', {
        words: wordsOf(store.task_text),
        text_len: totalChars,
        edits: store.task_edits,
        // Estadísticas de uso de IA
        ai_chars_inserted: store.ai_text_inserted,
        ai_percentage: parseFloat(aiPercentage),
        // Estadísticas de copy/paste
        paste_count: store.paste_count,
        paste_total_chars: store.paste_total_chars,
        paste_percentage: parseFloat(pastePercentage),
        // Estadística derivada
        manual_chars: totalChars - store.ai_text_inserted - store.paste_total_chars,
        manual_percentage: Math.max(0, 100 - parseFloat(aiPercentage) - parseFloat(pastePercentage)).toFixed(2)
      });
    }
  };

  // ====== PANTALLA 4B — Declaración de uso de IA ======
  const s4b = {
    type: jsPsychSurveyHtmlForm,
    preamble: `
      <h2>Declaración de uso de IA</h2>
      <p>Por favor, indica de manera honesta qué porcentaje de tu texto fue asistido por inteligencia artificial.</p>
    `,
    html: `
      <label class="label">¿Qué porcentaje del texto está 100% generado por IA? (0-100%)</label>
      <input class="input" type="number" name="ai_generated_pct" min="0" max="100" value="0" required />
      <p class="muted" style="margin-top:4px;">Texto copiado directamente de una IA sin modificaciones</p>

      <label class="label" style="margin-top:20px;">¿Qué porcentaje del texto está parafraseado por IA? (0-100%)</label>
      <input class="input" type="number" name="ai_paraphrased_pct" min="0" max="100" value="0" required />
      <p class="muted" style="margin-top:4px;">Texto que tomaste de una IA pero modificaste o reformulaste</p>
    `,
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.ai_usage = {
        generated_pct: Number(data.response.ai_generated_pct),
        paraphrased_pct: Number(data.response.ai_paraphrased_pct)
      };
      await sendLog('ai_usage_declaration', store.ai_usage);
    }
  };

  // ====== PANTALLA 5 — Control ======
  const s5 = {
    type: jsPsychSurveyHtmlForm,
    preamble: `<h2>Alguna pregunta sobre la tarea</h2>`,
    html: `
      <div class="likert-group">
        <p class="likert-question">¿Cómo de restrictiva consideras que era la política de Inteligencia Artificial para la tarea que acabas de realizar?</p>
        <div class="likert-scale">
          <span class="likert-anchor">Nada<br>restrictiva</span>
          <label class="likert-option"><input type="radio" name="policy_restrictiveness" value="1" required><span>1</span></label>
          <label class="likert-option"><input type="radio" name="policy_restrictiveness" value="2"><span>2</span></label>
          <label class="likert-option"><input type="radio" name="policy_restrictiveness" value="3"><span>3</span></label>
          <label class="likert-option"><input type="radio" name="policy_restrictiveness" value="4"><span>4</span></label>
          <label class="likert-option"><input type="radio" name="policy_restrictiveness" value="5"><span>5</span></label>
          <label class="likert-option"><input type="radio" name="policy_restrictiveness" value="6"><span>6</span></label>
          <label class="likert-option"><input type="radio" name="policy_restrictiveness" value="7"><span>7</span></label>
          <span class="likert-anchor">Muy<br>restrictiva</span>
        </div>
      </div>
      <div class="likert-group">
        <p class="likert-question">¿Clickaste el botón de ayuda de IA?</p>
        <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;cursor:pointer;">
          <input type="radio" name="used_ai_button" value="Sí" required onchange="document.getElementById('s5-insert-q').style.display='block'"> Sí
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="used_ai_button" value="No" onchange="document.getElementById('s5-insert-q').style.display='none'"> No
        </label>
      </div>
      <div class="likert-group" id="s5-insert-q" style="display:none">
        <p class="likert-question">¿Insertaste la sugerencia en el texto?</p>
        <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;cursor:pointer;">
          <input type="radio" name="inserted_ai_suggestion" value="Sí"> Sí
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="inserted_ai_suggestion" value="No"> No
        </label>
      </div>
      <div class="likert-group">
        <p class="likert-question">¿Usaste alguna IA externa al experimento?</p>
        <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;cursor:pointer;">
          <input type="radio" name="used_external_ai" value="Sí" required> Sí
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="used_external_ai" value="No"> No
        </label>
      </div>
    `,
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.control = data.response;
      await sendLog('control_answers', store.control);
    }
  };

  // ====== PANTALLA 6 — Demográficas ampliadas ======
  const s6 = {
    type: jsPsychSurveyHtmlForm,
    preamble: `<h2>Sobre tus estudios</h2>`,
    html: `
      <label class="label">Universidad en la que has estudiado</label>
      <select class="input" name="uni" required onchange="(function(v){var g=document.getElementById('uni_other_grp');var i=document.getElementById('uni_other_inp');if(v==='Otra'){g.style.display='block';i.required=true;}else{g.style.display='none';i.required=false;i.value='';}})(this.value)">
        <option value="">Selecciona…</option>
        <optgroup label="Madrid">
          <option>Centro Universitario Villanueva</option>
          <option>CUNEF Universidad</option>
          <option>IE Universidad (Madrid)</option>
          <option>Universidad a Distancia de Madrid (UDIMA)</option>
          <option>Universidad Alfonso X el Sabio (UAX)</option>
          <option>Universidad Antonio de Nebrija</option>
          <option>Universidad Autónoma de Madrid (UAM)</option>
          <option>Universidad Camilo José Cela</option>
          <option>Universidad Carlos III de Madrid (UC3M)</option>
          <option>Universidad Complutense de Madrid (UCM)</option>
          <option>Universidad de Alcalá (UAH)</option>
          <option>Universidad Europea de Madrid</option>
          <option>Universidad Francisco de Vitoria</option>
          <option>Universidad Isabel I</option>
          <option>Universidad Nacional de Educación a Distancia (UNED)</option>
          <option>Universidad Politécnica de Madrid (UPM)</option>
          <option>Universidad Pontificia Comillas (ICAI-ICADE)</option>
          <option>Universidad Rey Juan Carlos (URJC)</option>
          <option>Universidad San Pablo CEU</option>
        </optgroup>
        <optgroup label="Cataluña">
          <option>TecnoCampus (UPF)</option>
          <option>Universidad Autónoma de Barcelona (UAB)</option>
          <option>Universidad de Barcelona (UB)</option>
          <option>Universidad de Vic – Universidad Central de Cataluña (UVic-UCC)</option>
          <option>Universidad Politécnica de Cataluña (UPC)</option>
          <option>Universidad Pompeu Fabra (UPF)</option>
          <option>Universidad Ramon Llull (URL)</option>
          <option>Universitat de Girona (UdG)</option>
          <option>Universitat de Lleida (UdL)</option>
          <option>Universitat Internacional de Catalunya (UIC)</option>
          <option>Universitat Oberta de Catalunya (UOC)</option>
          <option>Universitat Rovira i Virgili (URV)</option>
        </optgroup>
        <optgroup label="Valencia y Murcia">
          <option>Universidad Cardenal Herrera CEU (UCH-CEU)</option>
          <option>Universidad Católica de Murcia (UCAM)</option>
          <option>Universidad Católica de Valencia (UCV)</option>
          <option>Universidad de Alicante (UA)</option>
          <option>Universidad de Murcia (UM)</option>
          <option>Universidad de Valencia (UV)</option>
          <option>Universidad Internacional de Valencia (VIU)</option>
          <option>Universidad Jaume I de Castellón (UJI)</option>
          <option>Universidad Miguel Hernández de Elche (UMH)</option>
          <option>Universidad Politécnica de Cartagena (UPCT)</option>
          <option>Universidad Politécnica de Valencia (UPV)</option>
        </optgroup>
        <optgroup label="Andalucía">
          <option>Universidad de Almería (UAL)</option>
          <option>Universidad de Cádiz (UCA)</option>
          <option>Universidad de Córdoba (UCO)</option>
          <option>Universidad de Granada (UGR)</option>
          <option>Universidad de Huelva (UHU)</option>
          <option>Universidad de Jaén (UJA)</option>
          <option>Universidad de Málaga (UMA)</option>
          <option>Universidad de Sevilla (US)</option>
          <option>Universidad Internacional de Andalucía (UNIA)</option>
          <option>Universidad Loyola Andalucía</option>
          <option>Universidad Pablo de Olavide (UPO)</option>
        </optgroup>
        <optgroup label="País Vasco y Navarra">
          <option>Mondragon Unibertsitatea</option>
          <option>Universidad de Deusto</option>
          <option>Universidad de Navarra (UNAV)</option>
          <option>Universidad del País Vasco (UPV/EHU)</option>
          <option>Universidad Pública de Navarra (UPNA)</option>
        </optgroup>
        <optgroup label="Castilla y León">
          <option>Universidad de Burgos (UBU)</option>
          <option>Universidad de León (ULE)</option>
          <option>Universidad de Salamanca (USAL)</option>
          <option>Universidad de Valladolid (UVA)</option>
          <option>Universidad Europea Miguel de Cervantes (UEMC)</option>
          <option>Universidad Pontificia de Salamanca (UPSA)</option>
        </optgroup>
        <optgroup label="Galicia">
          <option>Universidad de A Coruña (UDC)</option>
          <option>Universidad de Santiago de Compostela (USC)</option>
          <option>Universidad de Vigo (UVigo)</option>
        </optgroup>
        <optgroup label="Aragón">
          <option>Universidad de Zaragoza (UNIZAR)</option>
          <option>Universidad San Jorge (USJ)</option>
        </optgroup>
        <optgroup label="Asturias y Cantabria">
          <option>Universidad de Cantabria (UC)</option>
          <option>Universidad de Oviedo (UNIOVI)</option>
        </optgroup>
        <optgroup label="Castilla-La Mancha y Extremadura">
          <option>Universidad de Castilla-La Mancha (UCLM)</option>
          <option>Universidad de Extremadura (UEX)</option>
        </optgroup>
        <optgroup label="La Rioja">
          <option>Universidad de La Rioja (UR)</option>
          <option>Universidad Internacional de La Rioja (UNIR)</option>
        </optgroup>
        <optgroup label="Islas Baleares">
          <option>Universidad de las Islas Baleares (UIB)</option>
        </optgroup>
        <optgroup label="Canarias">
          <option>Universidad de La Laguna (ULL)</option>
          <option>Universidad de Las Palmas de Gran Canaria (ULPGC)</option>
        </optgroup>
        <optgroup label="Ceuta y Melilla">
          <option>UNED (centros en Ceuta y Melilla)</option>
        </optgroup>
        <option value="Otra">Otra</option>
      </select>
      <div id="uni_other_grp" style="display:none;margin-top:8px;">
        <label class="label">Indica el nombre de tu universidad</label>
        <input id="uni_other_inp" class="input" type="text" name="uni_other" placeholder="Nombre de la universidad…" />
      </div>

      <label class="label">Rama de conocimiento de los últimos estudios</label>
      <select class="input" name="field" required>
        <option value="">Selecciona…</option>
        <optgroup label="Ciencias Sociales y Jurídicas">
          <option>Administración y Dirección de Empresas (ADE)</option>
          <option>Economía</option>
          <option>Derecho</option>
          <option>Relaciones Internacionales</option>
          <option>Ciencias Políticas y de la Administración</option>
          <option>Sociología</option>
          <option>Trabajo Social y Servicios Sociales</option>
          <option>Psicología</option>
          <option>Educación y Pedagogía</option>
          <option>Comunicación, Periodismo y Publicidad</option>
          <option>Marketing y Publicidad</option>
          <option>Turismo, Hostelería y Ocio</option>
          <option>Recursos Humanos y Relaciones Laborales</option>
          <option>Criminología y Seguridad</option>
          <option>Contabilidad y Finanzas</option>
          <option>Comercio Internacional</option>
        </optgroup>
        <optgroup label="Ingeniería y Arquitectura">
          <option>Ingeniería Informática y Tecnologías de la Información</option>
          <option>Ingeniería de Telecomunicaciones</option>
          <option>Inteligencia Artificial y Ciencia de Datos</option>
          <option>Ingeniería Industrial</option>
          <option>Ingeniería Mecánica</option>
          <option>Ingeniería Eléctrica y Electrónica</option>
          <option>Ingeniería Civil y Obras Públicas</option>
          <option>Ingeniería Química</option>
          <option>Ingeniería Aeronáutica y Aeroespacial</option>
          <option>Ingeniería de Minas y Energía</option>
          <option>Ingeniería Agronómica, Forestal y del Medio Natural</option>
          <option>Ingeniería Biomédica</option>
          <option>Ingeniería de Materiales</option>
          <option>Arquitectura y Urbanismo</option>
          <option>Arquitectura Técnica / Edificación</option>
        </optgroup>
        <optgroup label="Artes y Humanidades">
          <option>Historia</option>
          <option>Historia del Arte</option>
          <option>Geografía</option>
          <option>Filosofía</option>
          <option>Filología y Lingüística</option>
          <option>Traducción e Interpretación</option>
          <option>Bellas Artes</option>
          <option>Diseño (Gráfico, Industrial, Moda…)</option>
          <option>Música, Danza y Artes Escénicas</option>
          <option>Arqueología y Patrimonio</option>
          <option>Estudios Clásicos</option>
        </optgroup>
        <optgroup label="Ciencias">
          <option>Matemáticas</option>
          <option>Estadística</option>
          <option>Física</option>
          <option>Química</option>
          <option>Biología</option>
          <option>Biotecnología</option>
          <option>Bioquímica y Biología Molecular</option>
          <option>Geología y Ciencias de la Tierra</option>
          <option>Ciencias Ambientales</option>
          <option>Ciencias del Mar y Oceanografía</option>
          <option>Óptica</option>
        </optgroup>
        <optgroup label="Ciencias de la Salud">
          <option>Medicina</option>
          <option>Enfermería</option>
          <option>Farmacia</option>
          <option>Fisioterapia</option>
          <option>Terapia Ocupacional</option>
          <option>Odontología</option>
          <option>Nutrición y Dietética</option>
          <option>Óptica y Optometría</option>
          <option>Veterinaria</option>
          <option>Podología</option>
          <option>Logopedia</option>
          <option>Psicología Clínica (Máster)</option>
        </optgroup>
        <option>Otra</option>
      </select>

      <label class="label">Nota media de los últimos estudios (0–10)</label>
      <input class="input" type="number" step="0.01" min="0" max="10" name="gpa" placeholder="Ej: 7.8" required />
    `,
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.demographics = data.response;
      await sendLog('demographics_extended', store.demographics);
    }
  };

  // ====== Helper: genera HTML de pregunta Likert horizontal 5 puntos ======
  function makeLikert(name, question) {
    return `
      <div class="likert-group">
        <p class="likert-question">${question}</p>
        <div class="likert-scale">
          <span class="likert-anchor">Totalmente<br>en desacuerdo</span>
          <label class="likert-option"><input type="radio" name="${name}" value="1" required><span>1</span></label>
          <label class="likert-option"><input type="radio" name="${name}" value="2"><span>2</span></label>
          <label class="likert-option"><input type="radio" name="${name}" value="3"><span>3</span></label>
          <label class="likert-option"><input type="radio" name="${name}" value="4"><span>4</span></label>
          <label class="likert-option"><input type="radio" name="${name}" value="5"><span>5</span></label>
          <span class="likert-anchor">Totalmente<br>de acuerdo</span>
        </div>
      </div>`;
  }

  // ====== PANTALLA 7 — Tu entorno y la IA (Likert 5 puntos + ordinal) ======
  const s7 = {
    type: jsPsychSurveyHtmlForm,
    preamble: `<h2>Tu entorno y la IA</h2><p class="muted">Indica tu nivel de acuerdo con cada afirmación<br>(1 = Totalmente en desacuerdo &nbsp;·&nbsp; 5 = Totalmente de acuerdo).</p>`,
    html: `
      ${makeLikert('subj_norm_desc_1',  'La mayoría de las personas de mi entorno usan IA regularmente en sus tareas o proyectos.')}
      ${makeLikert('subj_norm_inj_1',   'Las personas importantes para mí desaprobarían que usara IA sin declararlo en un trabajo académico o profesional.')}
      ${makeLikert('pbc_evasion_1',     'Si quisiera, podría usar IA en una tarea sin que nadie lo detectara.')}
      ${makeLikert('pbc_capacity_1',    'Tengo los conocimientos necesarios para usar IA de forma eficaz en una tarea.')}
      ${makeLikert('opp_perceived_1',   'Creo que es fácil detectar cuando alguien ha usado IA sin declararlo.')}
      ${makeLikert('norm_clarity_1',    'Las normas sobre el uso de IA en trabajos académicos o profesionales están bien definidas y son claras.')}
      ${makeLikert('pressure_1',        'Siento que las exigencias de mis tareas o responsabilidades actuales me superan con frecuencia.')}
      <div class="likert-group">
        <p class="likert-question">¿Con qué frecuencia usas herramientas de IA en tus tareas actualmente?</p>
        <select class="input" name="ai_frequency" required>
          <option value="">Selecciona…</option>
          <option value="1">Nunca</option>
          <option value="2">Raramente</option>
          <option value="3">A veces</option>
          <option value="4">Frecuentemente</option>
          <option value="5">Siempre</option>
        </select>
      </div>
    `,
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.personality = data.response;
      await sendLog('personality_answers', store.personality);
    }
  };

  // ====== PANTALLA 8B — Sobre tus valores y motivaciones (Likert 5 puntos horizontal) ======
  const s7b = {
    type: jsPsychSurveyHtmlForm,
    preamble: `<h2>Sobre tus valores y motivaciones</h2><p class="muted">Indica tu nivel de acuerdo con cada afirmación<br>(1 = Totalmente en desacuerdo &nbsp;·&nbsp; 5 = Totalmente de acuerdo).</p>`,
    html: `
      ${makeLikert('motiv_orient_1',     'En general, me importa más obtener un buen resultado que el proceso de llegar a él.')}
      ${makeLikert('moral_intern_1',     'Respetaría las normas sobre uso de IA aunque nadie pudiera comprobarlo.')}
      ${makeLikert('moral_guilt_1',      'Me sentiría culpable si usara IA en una tarea sin declararlo.')}
      ${makeLikert('moral_principles_1', 'Usar IA sin declararlo iría en contra de mis principios.')}
      ${makeLikert('rationaliz_util_1',  'Si la IA mejora el resultado de un trabajo, usarla está justificado aunque no esté permitido.')}
      ${makeLikert('rationaliz_norm_1',  'Si otros usan IA sin consecuencias, no veo por qué yo no debería.')}
    `,
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.ai_motivation = data.response;
      await sendLog('ai_motivation_answers', store.ai_motivation);
    }
  };

  // ====== PRE-FINALIZE — Envío previo a Sheets (antes de la pantalla de email) ======
  const preFinalizeCall = {
    type: jsPsychCallFunction,
    async: true,
    func: async (done) => {
      try {
        const demographics = {
          dob: store.dob,
          sex: store.sex,
          studies: store.basicStudies,
          grad_year: store.gradYear,
          ...store.demographics,
          policy: assignedPolicy.key
        };
        const results = {
          task_text: store.task_text,
          words: wordsOf(store.task_text),
          edits: store.task_edits,
          ai_usage: store.ai_usage,
          ai_chars_inserted: store.ai_text_inserted,
          paste_count: store.paste_count,
          paste_total_chars: store.paste_total_chars,
          control: store.control,
          personality: store.personality,
          ai_motivation: store.ai_motivation
        };
        await flushAndWait();
        const result = await fetchWithRetry('/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject_id, demographics, results, email: '' })
        }, 3);
        store._finalize_ok = result.ok;
        await sendLog('finalize_sent', { success: result.ok, error: result.ok ? null : result.error }).catch(() => {});
      } catch (e) {
        store._finalize_ok = false;
        console.warn('⚠️ pre-finalize failed:', e.message);
      } finally {
        done();
      }
    }
  };

  // ====== PANTALLA FINAL — Gracias + correo opcional ======
  const sEmail = {
    type: jsPsychSurveyHtmlForm,
    preamble: `
      <h2>¡Ya terminamos!</h2>
      <p>Tus respuestas han sido guardadas correctamente. <strong>Puedes cerrar esta ventana ahora si lo deseas.</strong></p>
      <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
      <p style="margin-bottom:4px;">Si deseas recibir más información sobre los resultados de esta investigación, puedes dejarnos tu correo electrónico.</p>
      <p>Este dato es completamente <strong style="color:#d97706;">OPCIONAL</strong>.</p>
    `,
    html: `
      <label class="label">Correo electrónico (<strong style="color:#d97706;">OPCIONAL</strong>)</label>
      <input class="input" type="email" name="email" id="sEmail_input" placeholder="tu@email.com" />
    `,
    button_label: 'Salir',
    on_load: () => {
      const input = document.getElementById('sEmail_input');
      const btn = document.querySelector('.jspsych-btn');
      input.addEventListener('input', () => {
        btn.textContent = input.value.trim() ? 'Enviar correo' : 'Salir';
      });
    },
    on_finish: async (data) => {
      store.email = (data.response.email || '').trim();
      if (store.email) {
        await sendLog('email_provided', { email: store.email });
      }
    }
  };

  // ====== FINALIZE — Envío de datos al terminar (invisible para el usuario) ======
  // Función auxiliar para reintentar con backoff exponencial
  async function fetchWithRetry(url, options, maxRetries = 3) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        // Validar respuesta
        if (!response.ok) {
          let errorMessage = `HTTP error ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData && errorData.error) {
              errorMessage = errorData.error;
            }
          } catch (e) {
            // No se pudo parsear el error
          }

          // Si es un error del servidor (5xx) o servicio no disponible, reintentar
          if (response.status >= 500 || response.status === 503) {
            throw new Error(errorMessage);
          } else {
            // Error del cliente (4xx), no reintentar
            return { ok: false, error: errorMessage, response };
          }
        }

        // Parsear JSON con validación
        let result;
        try {
          result = await response.json();
        } catch (e) {
          console.error('Error parseando JSON de respuesta:', e);
          throw new Error('Respuesta inválida del servidor');
        }

        // Validar estructura de respuesta
        if (!result || typeof result !== 'object') {
          console.error('Respuesta no es un objeto:', result);
          throw new Error('Respuesta inválida del servidor');
        }

        return { ok: true, data: result, response };
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ Intento ${attempt + 1}/${maxRetries} falló:`, error.message);

        // Si no es el último intento, esperar antes de reintentar
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.log(`⏳ Esperando ${delay}ms antes de reintentar...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // Todos los intentos fallaron
    return { ok: false, error: lastError?.message || 'Error desconocido' };
  }

  // Los datos ya se enviaron en preFinalizeCall; aquí solo flusheamos el log del email.
  const finalizeCall = {
    type: jsPsychCallFunction,
    async: true,
    func: async (done) => {
      try {
        await flushAndWait();
      } catch (e) {
        console.warn('⚠️ final flush failed:', e.message);
      } finally {
        done();
      }
    }
  };

  // ====== Timeline completo ======
  // sEmail recoge contacto opcional; finalizeCall envía todo a /finalize;
  // el mensaje de agradecimiento se muestra en el on_finish de jsPsych.
  const timeline = [s1, s2, s3, s4, s4b, s5, s6, s7, s7b, preFinalizeCall, sEmail, finalizeCall];

  // ¡Comenzar!
  jsPsych.run(timeline);
})();
