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
      description: 'Puedes usar libremente cualquier herramienta de inteligencia artificial para ayudarte en esta tarea, siempre que lo declares al finalizar.',
      showAIButton: true
    },
    {
      key:'difusa',
      label:'Difusa',
      description: 'Puedes usar herramientas de inteligencia artificial si lo consideras necesario, pero procura mantener tu propio criterio y estilo en el texto.',
      showAIButton: true
    },
    {
      key:'restrictiva',
      label:'Restrictiva',
      description: 'No debes usar herramientas de inteligencia artificial para completar esta tarea. Por favor, redacta el texto por tu cuenta sin ayuda de IA.',
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
        console.warn(`⚠️ Batch log failed:`, response.status);
        // Re-encolar eventos que fallaron
        eventBuffer.unshift(...batch);
      }
    } catch (err) {
      console.warn(`⚠️ Batch log network error:`, err.message);
      eventBuffer.unshift(...batch);
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

  // Flush forzado + esperar a que se complete (para momentos críticos como finalize)
  async function flushAndWait() {
    await flushEventBuffer();
    // También pedirle al servidor que escriba lo pendiente
    try {
      await fetch('/flush-events', { method: 'POST' });
    } catch (e) {
      console.warn('⚠️ flush-events failed:', e.message);
    }
  }

  // Arranca contador de inactividad (inactividad >2s suma)
  function startIdleWatch(){
    stopIdleWatch();
    lastActivityAt = Date.now();
    idleMs = 0;
    const bump = () => { lastActivityAt = Date.now(); };
    window.addEventListener('mousemove', bump, { capture:true, passive:true });
    window.addEventListener('keydown', bump, { capture:true, passive:true });
    window.addEventListener('click', bump, { capture:true, passive:true });
    window.addEventListener('touchstart', bump, { capture:true, passive:true });
    idleTimer = setInterval(() => {
      const since = Date.now() - lastActivityAt;
      if (since > 2000) idleMs += 1000;
    }, 1000);
  }
  function stopIdleWatch(){
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
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
        index: jsPsych.getProgress().current_trial_global+1,
        trial_type: t.type?.name || 'unknown',
        timestamp: screenStartTime
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
      // Mostrar mensaje de agradecimiento automáticamente al finalizar la pantalla 9
      const target = document.getElementById('jspsych-target');
      if (target) {
        target.innerHTML = `
          <div style="display:flex;justify-content:center;align-items:center;min-height:60vh;padding:24px;">
            <div class="center">
              <h2>¡Gracias por participar!</h2>
              <p>Tu respuesta ha sido guardada correctamente.</p>
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
    paste_total_chars: 0  // Total de caracteres pegados
  };

  // ====== PANTALLA 1 — Bienvenida y consentimiento ======
  const s1 = {
    type: jsPsychSurveyHtmlForm,
    preamble: `
      <h2>Bienvenida</h2>
      <p>
        El siguiente experimento forma parte de un Trabajo de Fin de Grado para la Universidad Pontificia Comillas.
        Toda la información será recolectada de forma anónima y su uso será únicamente académico y de investigación.
        Por favor, mantente hasta el final. Gracias.
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

      <label class="label">Estudios superiores cursados</label>
      <select class="input" name="studies" id="studies" required>
        <option value="">Selecciona…</option>
        <option>Grado</option>
        <option>Máster</option>
        <option>Doctorado</option>
        <option>Ya graduado/a (Grado o Máster)</option>
      </select>

      <div id="grad_year_wrap" class="hidden">
        <label class="label">Año de graduación</label>
        <input class="input" type="number" name="grad_year" id="grad_year" min="1950" max="2035" />
      </div>
      <script>
        const sel = document.getElementById('studies');
        const wrap = document.getElementById('grad_year_wrap');
        sel.addEventListener('change', () => {
          if (sel.value.startsWith('Ya graduado')) wrap.classList.remove('hidden');
          else wrap.classList.add('hidden');
        });
      </script>
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
  const taskPrompt = 'Escribe sobre cómo tus estudios actuales te ayudarán en tu futuro profesional y/o personal. Puedes enfocarte en las competencias adquiridas, tus objetivos, o cualquier aspecto que consideres relevante.';

  const s3 = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="card-plain">
        <h2>Introducción a la tarea</h2>
        <p>
          ${taskPrompt}
        </p>
        <div class="policy">
          <strong>Política de uso de IA:</strong>
          <p>${assignedPolicy.description}</p>
        </div>
      </div>
    `,
    choices: ['Continuar']
  };

  // ====== PANTALLA 4 — Tarea 150–300 palabras + Ayuda IA con OpenAI ======
  let editLog = [];

  const s4 = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div>
        <h2>Tarea</h2>
        <p class="task-prompt"><em>${taskPrompt}</em></p>
        <p>Redacta un texto entre <strong>150 y 300 palabras</strong>.</p>
        <textarea class="input" id="task_text" rows="10" placeholder="Escribe aquí…"></textarea>
        <div class="task-tools">
          ${assignedPolicy.showAIButton ? '<button id="ai_help" class="btn-outline" type="button" title="Si seleccionas una frase y solicitas ayuda, ofrece una frase alternativa. Si simplemente clickeas, proporciona una frase o definición para continuar.">Ayuda de IA</button>' : '<span></span>'}
          <span id="word_count" class="muted">0 palabras</span>
        </div>
        <div id="ai_suggestions" class="suggestions hidden"></div>
        <div class="policy" style="margin-top:16px;">
          <strong>Tu política de uso de IA asignada:</strong>
          <p>${assignedPolicy.description}</p>
        </div>
      </div>
    `,
    choices: ['Continuar'],
    on_load: () => {
      // deshabilita botón "Continuar" hasta llegar a 90
      const contBtn = document.querySelector('.jspsych-btn');
      contBtn.disabled = true;

      const ta = document.getElementById('task_text');
      const wc = document.getElementById('word_count');
      const panel = document.getElementById('ai_suggestions');
      const help = document.getElementById('ai_help');

      const update = () => {
        const n = wordsOf(ta.value);
        wc.textContent = `${n} ${n===1?'palabra':'palabras'}`;
        contBtn.disabled = !(n>=150 && n<=300);
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

            // Mostrar sugerencia como botón clickeable
            panel.innerHTML = `
              <div style="display:flex; flex-direction:column; gap:8px; width:100%;">
                <p class="muted" style="margin:0; font-size:0.9em;">Sugerencia de IA:</p>
                <button class="chip ai-chip" type="button" style="text-align:left; white-space:normal;">${suggestion}</button>
              </div>
            `;
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

            sendLog('ai_help_open', { has_selection: selection.length > 0 });

          } catch (error) {
            panel.innerHTML = '<p class="muted" style="color:red;">Error al obtener sugerencia. Inténtalo de nuevo.</p>';
            panel.classList.remove('hidden');
            console.error('Error al obtener sugerencia de IA:', error);
          } finally {
            help.disabled = false;
            help.textContent = 'Ayuda de IA';
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
    type: jsPsychSurveyMultiChoice,
    preamble: `<h2>Alguna pregunta sobre la tarea</h2>`,
    questions: [
      { prompt: '¿Te diste cuenta de que había una indicación sobre el uso de IA?',
        options: ['Sí','No'], required:true, name:'noticed_policy' },
      { prompt: '¿Usaste el botón de ayuda de IA?',
        options: ['Sí','No'], required:true, name:'used_ai_button' },
      { prompt: '¿Usaste alguna IA externa al experimento?',
        options: ['Sí','No'], required:true, name:'used_external_ai' }
    ],
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
      <select class="input" name="uni" required>
        <option value="">Selecciona…</option>
        <optgroup label="Madrid">
          <option>Universidad Complutense de Madrid (UCM)</option>
          <option>Universidad Autónoma de Madrid (UAM)</option>
          <option>Universidad Carlos III de Madrid (UC3M)</option>
          <option>Universidad Politécnica de Madrid (UPM)</option>
          <option>Universidad Pontificia Comillas (ICAI-ICADE)</option>
          <option>Universidad Rey Juan Carlos (URJC)</option>
          <option>Universidad de Alcalá (UAH)</option>
          <option>Universidad Nacional de Educación a Distancia (UNED)</option>
          <option>Universidad San Pablo CEU</option>
          <option>Universidad Francisco de Vitoria</option>
          <option>Universidad Antonio de Nebrija</option>
          <option>Universidad Europea de Madrid</option>
          <option>Universidad Camilo José Cela</option>
          <option>Centro Universitario Villanueva</option>
          <option>IE Universidad (Madrid)</option>
        </optgroup>
        <optgroup label="Barcelona">
          <option>Universidad de Barcelona (UB)</option>
          <option>Universidad Autónoma de Barcelona (UAB)</option>
          <option>Universidad Politécnica de Cataluña (UPC)</option>
          <option>Universidad Pompeu Fabra (UPF)</option>
          <option>Universidad Ramon Llull</option>
          <option>Universidad de Vic</option>
          <option>Universitat Oberta de Catalunya (UOC)</option>
        </optgroup>
        <optgroup label="Valencia">
          <option>Universidad de Valencia (UV)</option>
          <option>Universidad Politécnica de Valencia (UPV)</option>
          <option>Universidad Miguel Hernández de Elche</option>
          <option>Universidad Jaume I de Castellón</option>
          <option>Universidad Cardenal Herrera CEU</option>
        </optgroup>
        <optgroup label="Andalucía">
          <option>Universidad de Sevilla (US)</option>
          <option>Universidad de Granada (UGR)</option>
          <option>Universidad de Málaga (UMA)</option>
          <option>Universidad de Córdoba (UCO)</option>
          <option>Universidad Pablo de Olavide</option>
          <option>Universidad de Cádiz (UCA)</option>
          <option>Universidad de Almería (UAL)</option>
          <option>Universidad de Huelva (UHU)</option>
          <option>Universidad de Jaén (UJA)</option>
        </optgroup>
        <optgroup label="País Vasco y Navarra">
          <option>Universidad del País Vasco (UPV/EHU)</option>
          <option>Universidad de Deusto</option>
          <option>Universidad de Navarra</option>
          <option>Universidad Pública de Navarra</option>
          <option>Mondragon Unibertsitatea</option>
        </optgroup>
        <optgroup label="Castilla y León">
          <option>Universidad de Salamanca (USAL)</option>
          <option>Universidad de Valladolid (UVA)</option>
          <option>Universidad de León (ULE)</option>
          <option>Universidad de Burgos (UBU)</option>
          <option>Universidad Pontificia de Salamanca</option>
        </optgroup>
        <optgroup label="Galicia">
          <option>Universidad de Santiago de Compostela (USC)</option>
          <option>Universidad de Vigo</option>
          <option>Universidad de A Coruña (UDC)</option>
        </optgroup>
        <optgroup label="Resto de España">
          <option>Universidad de Murcia (UM)</option>
          <option>Universidad de Zaragoza (UNIZAR)</option>
          <option>Universidad de Alicante (UA)</option>
          <option>Universidad de Oviedo (UNIOVI)</option>
          <option>Universidad de Cantabria (UC)</option>
          <option>Universidad de Extremadura (UEX)</option>
          <option>Universidad de La Rioja (UR)</option>
          <option>Universidad de Castilla-La Mancha (UCLM)</option>
          <option>Universidad de las Islas Baleares (UIB)</option>
          <option>Universidad de La Laguna (ULL)</option>
          <option>Universidad de Las Palmas de Gran Canaria (ULPGC)</option>
        </optgroup>
        <optgroup label="Otras">
          <option>Universidad Internacional</option>
          <option>Universidad Privada</option>
          <option>Universidad Extranjera</option>
          <option>Otra</option>
        </optgroup>
      </select>

      <label class="label">Rama de conocimiento de los últimos estudios</label>
      <select class="input" name="field" required>
        <option value="">Selecciona…</option>
        <option>Ciencias Sociales y Jurídicas</option>
        <option>Ingeniería y Arquitectura</option>
        <option>Artes y Humanidades</option>
        <option>Ciencias</option>
        <option>Ciencias de la Salud</option>
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

  // ====== PANTALLA 7 — Sobre tu forma de trabajar (Likert 5 puntos horizontal) ======
  const s7 = {
    type: jsPsychSurveyHtmlForm,
    preamble: `<h2>Sobre tu forma de trabajar</h2><p class="muted">Indica tu nivel de acuerdo con cada afirmación<br>(1 = Totalmente en desacuerdo &nbsp;·&nbsp; 5 = Totalmente de acuerdo).</p>`,
    html: `
      ${makeLikert('q1', 'Cuando una norma me parece injusta, tiendo a no cumplirla.')}
      ${makeLikert('q2', 'Suelo subestimar el tiempo que me llevará completar una tarea.')}
      ${makeLikert('q3', 'Me siento cómodo/a usando herramientas digitales cuando necesito ayuda.')}
    `,
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.personality = data.response;
      await sendLog('personality_answers', store.personality);
    }
  };

  // ====== PANTALLA 8B — Qué piensas de la IA (Likert 5 puntos horizontal) ======
  const s7b = {
    type: jsPsychSurveyHtmlForm,
    preamble: `<h2>Qué piensas de la IA</h2><p class="muted">Indica tu nivel de acuerdo con cada afirmación<br>(1 = Totalmente en desacuerdo &nbsp;·&nbsp; 5 = Totalmente de acuerdo).</p>`,
    html: `
      ${makeLikert('overconfidence_1',      'Cuando uso herramientas de IA, el resultado es de mejor calidad que si trabajara yo solo/a.')}
      ${makeLikert('overconfidence_2',      'Acepto lo que me dice la IA sin necesidad de verificarlo por mi cuenta.')}
      ${makeLikert('norm_internalization_1','Respetaría las normas sobre el uso de IA aunque nadie pudiera comprobarlo.')}
      ${makeLikert('norm_internalization_2','Si la IA mejora mi trabajo, usarla está justificado aunque esté prohibido.')}
      ${makeLikert('reference_group_1',    'En mi universidad, las normas sobre el uso de IA en trabajos están bien definidas y son claras.')}
      ${makeLikert('reference_group_2',    'Mis profesores tienen una postura clara sobre qué usos de la IA son aceptables en los trabajos.')}
      ${makeLikert('peer_group_1',         'La mayoría de mis compañeros/as usan IA regularmente en sus tareas académicas.')}
      ${makeLikert('peer_group_2',         'En mi entorno de amigos y compañeros, usar IA para estudiar es algo habitual y aceptado.')}
    `,
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.ai_motivation = data.response;
      await sendLog('ai_motivation_answers', store.ai_motivation);
    }
  };

  // ====== FINALIZE — Envío de datos al terminar pantalla 9 (invisible para el usuario) ======
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

  const finalizeCall = {
    type: jsPsychCallFunction,
    async: true,
    func: async (done) => {
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
        control: store.control,
        personality: store.personality,
        ai_motivation: store.ai_motivation
      };

      // Debug: verificar que task_text tiene contenido
      console.log('📝 Enviando datos finales:', {
        task_text_length: store.task_text?.length || 0,
        words: results.words,
        subject_id: subject_id
      });

      // IMPORTANTE: Flush todos los eventos pendientes antes de finalizar
      console.log('🔄 Flushing eventos pendientes antes de finalizar...');
      await flushAndWait();

      // Intentar enviar con reintentos
      const result = await fetchWithRetry('/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject_id, demographics, results })
      }, 3); // 3 intentos máximo

      if (result.ok) {
        if (result.data && result.data.finalized) {
          console.log('✅ Datos guardados correctamente');
        } else {
          console.warn('⚠️ Respuesta exitosa pero datos posiblemente no guardados:', result.data);
        }
      } else {
        console.error('❌ Error crítico: No se pudieron guardar los datos después de 3 intentos');
        console.error('   Error:', result.error);
        // En un escenario de producción, podrías mostrar un mensaje al usuario
        // o guardar los datos localmente para recuperación posterior
      }

      // Registrar intento de finalización
      await sendLog('finalize_sent', {
        success: result.ok,
        error: result.ok ? null : result.error
      }).catch(() => {});

      done();
    }
  };

  // ====== Timeline completo ======
  // Pantalla 10 eliminada: el finalize ocurre automáticamente tras pantalla 9 (s7b),
  // y el mensaje de agradecimiento se muestra en el on_finish de jsPsych.
  const timeline = [s1, s2, s3, s4, s4b, s5, s6, s7, s7b, finalizeCall];

  // ¡Comenzar!
  jsPsych.run(timeline);
})();
