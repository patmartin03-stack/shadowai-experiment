// public/js/experiment.js
// Controla flujo simple del experimento y llamadas a /log y /finalize (mismo origen).
(() => {
  const $ = (sel) => document.querySelector(sel);
  const show = (id) => { document.querySelectorAll('main .card').forEach(s => s.classList.add('hidden')); $(id).classList.remove('hidden'); };
  const nowIso = () => new Date().toISOString();

  // subject_id aleatorio simple
  const subject_id = 'S-' + Math.random().toString(36).slice(2, 10).toUpperCase();

  // Elementos
  const consent = $('#consent');
  const startBtn = $('#startBtn');
  const studies = $('#studies');
  const gradWrap = $('#grad_year_wrap');
  const nextToTask = $('#nextToTask');
  const aiHelp = $('#aiHelp');
  const finishTask = $('#finishTask');
  const subjectIdOut = $('#subjectId');
  const copyCode = $('#copyCode');

  // Habilitar "Comenzar" cuando marcan el consentimiento
  consent.addEventListener('change', () => {
    startBtn.disabled = !consent.checked;
  });

  startBtn.addEventListener('click', async () => {
    await sendLog('consent_given', { accepted: true });
    show('#screen-demographics');
  });

  // Mostrar campo "año de graduación" si aplica
  studies.addEventListener('change', () => {
    const val = studies.value || '';
    if (val.startsWith('Ya graduado')) {
      gradWrap.classList.remove('hidden');
    } else {
      gradWrap.classList.add('hidden');
    }
  });

  nextToTask.addEventListener('click', async () => {
    const birth_year = Number($('#birth_year').value || 0);
    const studiesVal = studies.value || '';
    const grad_year = Number($('#grad_year').value || 0);

    await sendLog('demographics_submitted', {
      birth_year, studies: studiesVal, grad_year: grad_year || null
    });

    show('#screen-task');
  });

  aiHelp.addEventListener('click', async () => {
    // Solo se registra el click; NO hay claves, NO hay llamadas a APIs externas
    await sendLog('ai_button_clicked', {});
    alert('Registrado: pulsaste el botón IA (sin llamadas a IA).');
  });

  finishTask.addEventListener('click', async () => {
    const task_text = ($('#task_text').value || '').trim();

    // Registrar último evento
    await sendLog('task_submitted', { length: task_text.length });

    // Llamar a /finalize con resumen (demográficos simplificados para ejemplo)
    const demographics = {
      birth_year: Number($('#birth_year').value || 0),
      studies: ($('#studies').value || ''),
      grad_year: Number($('#grad_year').value || 0) || null
    };
    const results = { task_text };

    try {
      await fetch('/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject_id, demographics, results })
      });
    } catch (e) {
      console.warn('No se pudo llamar a /finalize (¿backend sin iniciar?).', e);
    }

    // Pantalla de gracias con subject_id
    subjectIdOut.textContent = subject_id;
    show('#screen-thanks');
  });

  copyCode.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(subject_id);
      alert('Código copiado.');
    } catch {
      alert('No se pudo copiar automáticamente. Selecciona y copia manualmente.');
    }
  });

  // Enviar evento a /log (fail-safe si el backend no está disponible)
  async function sendLog(event, payload) {
    const body = {
      subject_id,
      event,
      payload,
      ts: nowIso()
    };
    try {
      await fetch('/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      console.warn('No se pudo llamar a /log (¿backend sin iniciar?).', e);
    }
  }
})();
