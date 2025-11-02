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

  // Enviar evento al backend (si no hay servidor, simplemente falla en silencio)
  async function sendLog(event, payload={}) {
    const body = { subject_id, event, payload, ts: nowIso(), policy: assignedPolicy.key };
    try {
      const response = await fetch('/log', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
      // No lanzar error si el servidor responde con 500, solo loguear
      if (!response.ok) {
        console.warn(`⚠️ Log failed for event "${event}":`, response.status);
      }
    } catch (err) {
      // Sin backend o error de red → silenciar para no interrumpir el experimento
      console.warn(`⚠️ Log network error for event "${event}":`, err.message);
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
    on_finish: async () => {
      // nada aquí; el finalize se hace en la última pantalla
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
    control: {}, demographics: {}, personality: {}, ai_motivation: {}
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
        <option>Prefiero no decirlo</option>
        <option>Otro</option>
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
        <p>Redacta un texto entre <strong>90 y 300 palabras</strong>.</p>
        <textarea class="input" id="task_text" rows="10" placeholder="Escribe aquí…"></textarea>
        <div class="task-tools">
          ${assignedPolicy.showAIButton ? '<button id="ai_help" class="btn-outline" type="button">Ayuda de IA</button>' : ''}
          <span id="word_count" class="muted">0 palabras</span>
        </div>
        <div id="ai_suggestions" class="suggestions hidden"></div>
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
        contBtn.disabled = !(n>=90 && n<=300);
        editLog.push({ t: nowIso(), len: ta.value.length });
        // Guardar en store para que esté disponible en on_finish
        store.task_text = ta.value;
      };
      ta.addEventListener('input', update);
      update();

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

            if (!response.ok) {
              throw new Error('Error al obtener sugerencia');
            }

            const result = await response.json();
            const suggestion = result.suggestion;

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
              if (selection) {
                // Reemplazar selección
                ta.setRangeText(suggestion, start, end, 'end');
              } else {
                // Añadir al final
                const prefix = ta.value.endsWith('\n') || ta.value === '' ? '' : '\n';
                ta.setRangeText(prefix + suggestion, ta.value.length, ta.value.length, 'end');
              }
              ta.dispatchEvent(new Event('input'));
              panel.classList.add('hidden');
              sendLog('ai_help_use', { suggestion: suggestion, selection_chars: selection.length });
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
      await sendLog('task_snapshot', {
        words: wordsOf(store.task_text),
        text_len: store.task_text.length,
        edits: store.task_edits
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
    preamble: `<h2>Cuestionario (control)</h2>`,
    questions: [
      { prompt: '¿Te diste cuenta de que había una indicación sobre el uso de IA?',
        options: ['Sí','No','No estoy seguro/a'], required:true, name:'noticed_policy' },
      { prompt: '¿Usaste el botón de ayuda de IA?',
        options: ['Sí','No'], required:true, name:'used_ai_button' },
      { prompt: '¿Usaste alguna IA externa al experimento?',
        options: ['Sí','No','Prefiero no decir'], required:true, name:'used_external_ai' }
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
    preamble: `<h2>Datos demográficos</h2>`,
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

      <label class="label">Ciudad donde estudiaste/estudias</label>
      <input class="input" name="city" placeholder="Ej: Madrid" required />

      <label class="label">Nota media de los últimos estudios (0–10)</label>
      <input class="input" type="number" step="0.01" min="0" max="10" name="gpa" placeholder="Ej: 7.8" required />
    `,
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.demographics = data.response;
      await sendLog('demographics_extended', store.demographics);
    }
  };

  // ====== PANTALLA 7 — Personalidad / behavioural ======
  const s7 = {
    type: jsPsychSurveyMultiChoice,
    preamble: `<h2>Cuestionario de personalidad</h2><p class="muted">Selecciona la opción que mejor te representa.</p>`,
    questions: [
      { prompt: 'Cuando una norma me parece injusta, tiendo a no cumplirla.',
        options: ['Totalmente en desacuerdo','En desacuerdo','De acuerdo','Totalmente de acuerdo'],
        required:true, name:'q1' },
      { prompt: 'Suelo subestimar el tiempo que me llevará completar una tarea.',
        options: ['Nunca','A veces','A menudo','Siempre'],
        required:true, name:'q2' },
      { prompt: 'Me siento cómodo/a pidiendo ayuda a herramientas digitales.',
        options: ['Nada','Poco','Bastante','Mucho'],
        required:true, name:'q3' }
    ],
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.personality = data.response;
      await sendLog('personality_answers', store.personality);
    }
  };

  // ====== PANTALLA 7B — Motivaciones de uso de IA ======
  const s7b = {
    type: jsPsychSurveyMultiChoice,
    preamble: `<h2>Actitudes hacia la IA</h2><p class="muted">Responde con sinceridad según tu experiencia.</p>`,
    questions: [
      { prompt: 'Creo que las herramientas de IA pueden hacer mi trabajo mejor de lo que yo lo haría solo/a.',
        options: ['Totalmente en desacuerdo','En desacuerdo','De acuerdo','Totalmente de acuerdo'],
        required:true, name:'overconfidence_1' },
      { prompt: 'Confío plenamente en las respuestas que me da una IA sin necesidad de revisarlas.',
        options: ['Totalmente en desacuerdo','En desacuerdo','De acuerdo','Totalmente de acuerdo'],
        required:true, name:'overconfidence_2' },
      { prompt: 'Uso herramientas de IA principalmente para ahorrar tiempo y esfuerzo.',
        options: ['Totalmente en desacuerdo','En desacuerdo','De acuerdo','Totalmente de acuerdo'],
        required:true, name:'self_motivation_1' },
      { prompt: 'Uso IA porque me ayuda a sentirme más seguro/a con mis resultados.',
        options: ['Totalmente en desacuerdo','En desacuerdo','De acuerdo','Totalmente de acuerdo'],
        required:true, name:'self_motivation_2' },
      { prompt: 'La mayoría de mis compañeros/as de estudios usan herramientas de IA regularmente.',
        options: ['Totalmente en desacuerdo','En desacuerdo','De acuerdo','Totalmente de acuerdo'],
        required:true, name:'social_acceptance_1' },
      { prompt: 'Usar IA para tareas académicas es algo normal y aceptado en mi entorno.',
        options: ['Totalmente en desacuerdo','En desacuerdo','De acuerdo','Totalmente de acuerdo'],
        required:true, name:'social_acceptance_2' }
    ],
    button_label: 'Continuar',
    on_finish: async (data) => {
      store.ai_motivation = data.response;
      await sendLog('ai_motivation_answers', store.ai_motivation);
    }
  };

  // ====== PANTALLA 8 — Gracias + finalize ======
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

      try {
        const response = await fetch('/finalize', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ subject_id, demographics, results })
        });
        if (!response.ok) {
          console.warn('⚠️ Finalize failed:', response.status);
          const errorText = await response.text();
          console.warn('⚠️ Error details:', errorText);
        } else {
          console.log('✅ Datos guardados correctamente');
        }
      } catch (err) {
        console.warn('⚠️ Finalize network error:', err.message);
      }
      // Siempre continuar, incluso si falla
      await sendLog('finalize_sent', { ok:true }).catch(() => {});
      done();
    }
  };

  const s8 = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="center">
        <h2>¡Gracias por participar!</h2>
        <p>Tu respuesta ha sido guardada correctamente.</p>
        <p class="muted">
          Si deseas más información o retirar tus datos, escríbenos a
          <a href="mailto:pmartinmartinez@alu.comillas.edu">pmartinmartinez@alu.comillas.edu</a>.
        </p>
      </div>
    `,
    choices: ['Finalizar'],
    on_load: () => sendLog('thanks_screen')
  };

  // ====== Timeline completo ======
  const timeline = [s1, s2, s3, s4, s4b, s5, s6, s7, s7b, finalizeCall, s8];

  // ¡Comenzar!
  jsPsych.run(timeline);
})();
