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
    { key:'permisiva',   label:'Permisiva'   },
    { key:'difusa',      label:'Difusa'      },
    { key:'restrictiva', label:'Restrictiva' }
  ];
  const assignedPolicy = policies[Math.floor(Math.random()*policies.length)];

  // Estado de métricas por trial
  let trialClickCount = 0;
  let lastClickAt = Date.now();
  let idleMs = 0;
  let lastActivityAt = Date.now();
  let idleTimer = null;

  // Enviar evento al backend (si no hay servidor, simplemente falla en silencio)
  async function sendLog(event, payload={}) {
    const body = { subject_id, event, payload, ts: nowIso(), policy: assignedPolicy.key };
    try {
      await fetch('/log', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
    } catch (_) { /* sin backend local → es normal al abrir HTML suelto */ }
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
      startIdleWatch();
      await sendLog('screen_enter', { index: jsPsych.getProgress().current_trial_global+1, trial_type: t.type });
      // contar clics dentro del trial
      document.addEventListener('click', clickBump, { once:false });
    },
    on_trial_finish: async (data) => {
      stopIdleWatch();
      document.removeEventListener('click', clickBump, { once:false });
      await sendLog('screen_leave', {
        rt_ms: data.rt ?? null,
        clicks: trialClickCount,
        idle_ms: idleMs,
        trial_type: data.trial_type
      });
    },
    on_finish: async () => {
      // nada aquí; el finalize se hace en la última pantalla
    }
  });

  function clickBump(){
    const now = Date.now();
    const delta = now - lastClickAt;
    lastClickAt = now;
    trialClickCount += 1;
    sendLog('click', { since_prev_click_ms: delta });
  }

  // ====== VARIABLES QUE RECOGEMOS A LO LARGO DEL FLUJO ======
  const store = {
    dob: '', basicStudies: '', gradYear: null,
    intro_ack: true,
    task_text: '', task_edits: [],
    control: {}, demographics: {}, personality: {}
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

  // ====== PANTALLA 2 — Fecha nacimiento + estudios ======
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
      store.basicStudies = d.studies;
      store.gradYear = d.grad_year ? Number(d.grad_year) : null;
      await sendLog('demographics_basic', { dob: store.dob, studies: store.basicStudies, grad_year: store.gradYear });
    }
  };

  // ====== PANTALLA 3 — Introducción + política IA visible ======
  const s3 = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="card-plain">
        <h2>Introducción a la tarea</h2>
        <p>
          Explica brevemente cómo los últimos estudios que has cursado te ayudarán en un futuro cercano o lejano
          y/o cómo tu labor puede contribuir a crear una sociedad mejor.
        </p>
        <div class="policy"><small>Política de IA: <strong>${assignedPolicy.label}</strong></small></div>
      </div>
    `,
    choices: ['Continuar']
  };

  // ====== PANTALLA 4 — Tarea 150–300 palabras + Ayuda IA desde backend ======
  let currentSuggestions = []; // Se llenan desde /assist
  let editLog = [];

  const s4 = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div>
        <h2>Tarea</h2>
        <p>Redacta un texto entre <strong>150 y 300 palabras</strong>.</p>
        <textarea class="input" id="task_text" rows="10" placeholder="Escribe aquí…"></textarea>
        <div class="task-tools">
          <button id="ai_help" class="btn-outline" type="button">Ayuda de IA</button>
          <span id="word_count" class="muted">0 palabras</span>
        </div>
        <div id="ai_suggestions" class="suggestions hidden"></div>
      </div>
    `,
    choices: ['Continuar'],
    on_load: () => {
      // deshabilita botón "Continuar" hasta llegar a 150
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
      };
      ta.addEventListener('input', update);
      update();

      help.addEventListener('click', async () => {
        if (panel.classList.contains('hidden')) {
          // Mostrar loading
          panel.innerHTML = '<div class="chip">Generando sugerencias...</div>';
          panel.classList.remove('hidden');

          try {
            // Llamar a /assist con el texto actual
            const response = await fetch('/assist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subject_id,
                policy: assignedPolicy.key,
                text: ta.value,
                selection: ta.value.slice(ta.selectionStart, ta.selectionEnd)
              })
            });

            const data = await response.json();

            if (data.ok && data.suggestions) {
              currentSuggestions = data.suggestions;
              panel.innerHTML = currentSuggestions.map((s,i)=>
                `<button class="chip" data-i="${i}" type="button">${s}</button>`
              ).join('');
              sendLog('ai_help_open', { tokens: data.tokens, model: data.model });
            } else {
              // Fallback si falla el backend
              currentSuggestions = [
                "Añade ejemplos concretos para ilustrar tu punto.",
                "Conecta tus ideas con el contexto social actual.",
                "Concluye resumiendo tu aportación principal.",
                "Revisa la claridad de tus frases principales."
              ];
              panel.innerHTML = currentSuggestions.map((s,i)=>
                `<button class="chip" data-i="${i}" type="button">${s}</button>`
              ).join('');
              sendLog('ai_help_open', { fallback: true });
            }
          } catch (err) {
            // Fallback si no hay conexión
            currentSuggestions = [
              "Añade ejemplos concretos para ilustrar tu punto.",
              "Conecta tus ideas con el contexto social actual.",
              "Concluye resumiendo tu aportación principal.",
              "Revisa la claridad de tus frases principales."
            ];
            panel.innerHTML = currentSuggestions.map((s,i)=>
              `<button class="chip" data-i="${i}" type="button">${s}</button>`
            ).join('');
            sendLog('ai_help_open', { error: err.message });
          }
        } else {
          panel.classList.add('hidden');
        }
      });

      panel.addEventListener('click', (e)=>{
        const btn = e.target.closest('button.chip'); if(!btn) return;
        const idx = Number(btn.dataset.i);
        const tip = currentSuggestions[idx];
        if (!tip) return; // Protección por si no hay sugerencias

        const start = ta.selectionStart, end = ta.selectionEnd;
        const hasSel = end>start;
        let injected = tip;

        // Si hay texto seleccionado y la sugerencia menciona "reescribe" o "revisa"
        if (hasSel && (tip.toLowerCase().includes("reescribe") || tip.toLowerCase().includes("revisa"))) {
          const sel = ta.value.slice(start,end);
          injected = sel.replace(/\b(puede|podría|quizá)\b/gi, ''); // reescritura simple
        } else if (!hasSel) {
          // Sin selección, añadir sugerencia al final
          injected = (ta.value.endsWith('\n') ? '' : '\n') + tip;
        }

        ta.setRangeText(injected, start, end, 'end');
        ta.dispatchEvent(new Event('input'));
        sendLog('ai_help_use', { suggestion_index: idx, selection_chars: hasSel ? (end-start) : 0 });
      });
    },
    on_finish: async (data) => {
      const txt = document.getElementById('task_text').value;
      store.task_text = txt;
      store.task_edits = editLog.slice(-50);
      await sendLog('task_snapshot', {
        words: wordsOf(txt),
        text_len: txt.length,
        edits: store.task_edits
      });
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
      <input class="input" name="uni" placeholder="Ej: Universidad Pontificia Comillas" required />

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

  // ====== PANTALLA 8 — Gracias + subject_id + finalize ======
  const finalizeCall = {
    type: jsPsychCallFunction,
    async: true,
    func: async () => {
      const demographics = {
        dob: store.dob,
        studies: store.basicStudies,
        grad_year: store.gradYear,
        ...store.demographics,
        policy: assignedPolicy.key
      };
      const results = {
        task_text: store.task_text,
        words: wordsOf(store.task_text),
        edits: store.task_edits,
        control: store.control,
        personality: store.personality
      };
      try {
        await fetch('/finalize', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ subject_id, demographics, results })
        });
      } catch (_) {}
      await sendLog('finalize_sent', { ok:true });
    }
  };

  const s8 = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="center">
        <h2>¡Gracias!</h2>
        <p>Tu código de participante es:</p>
        <p class="code">${subject_id}</p>
        <p class="muted">
          Si deseas más información o retirar tus datos, escríbenos a
          <a href="mailto:pmartinmartinez@alu.comillas.edu">pmartinmartinez@alu.comillas.edu</a>.
        </p>
      </div>
    `,
    choices: ['Copiar código'],
    on_load: () => sendLog('thanks_screen'),
    on_finish: async () => {
      try {
        await navigator.clipboard.writeText(subject_id);
        alert('Código copiado.');
      } catch {}
    }
  };

  // ====== Timeline completo ======
  const timeline = [s1, s2, s3, s4, s5, s6, s7, finalizeCall, s8];

  // ¡Comenzar!
  jsPsych.run(timeline);
})();
