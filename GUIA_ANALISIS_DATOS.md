# Guía de análisis de datos — Shadow AI Experimento

Esta guía explica cada columna de las dos hojas de Google Sheets y cada tipo de evento registrado. Está pensada como referencia antes de abrir los datos en R, Python o SPSS.

---

## Estructura general

El experimento genera dos hojas:

- **`events`** — log granular de todo lo que hace el participante durante el experimento (cada clic, cada pantalla, cada uso de IA, etc.)
- **`results`** — una fila por participante con el resumen final (demográficos, texto escrito, escalas psicológicas, etc.)

Para análisis estadístico, la hoja principal es **`results`**. La hoja **`events`** es útil para análisis de comportamiento más fino (tiempo por pantalla, secuencia de acciones, etc.).

---

## Hoja `results` — columnas

### Identificación y condición experimental

| Columna | Descripción |
|---|---|
| `timestamp` | Fecha y hora UTC en que se guardaron los datos (ISO 8601). Indica cuándo terminó el participante. |
| `subject_id` | ID único del participante, generado aleatoriamente al cargar la página. Formato `S-XXXXXXXX`. No es recuperable después — si un participante repite, tiene otro ID. |
| `policy` | Condición experimental asignada al azar: `permisiva`, `difusa` o `restrictiva`. Es la variable independiente principal del experimento. |

### Demográficos

| Columna | Descripción |
|---|---|
| `dob` | Fecha de nacimiento en formato `dd/mm/aaaa`. Para calcular la edad hay que parsearla. |
| `sex` | Sexo: `Hombre` o `Mujer`. |
| `studies` | Último nivel de estudios cursados (en progreso o terminados): `Bachillerato`, `Formación Profesional Superior`, `Grado`, `Máster`, `Doctorado`. |
| `grad_year` | Año de graduación (o año previsto) de los últimos estudios. Número entero. |
| `uni` | Universidad. Si seleccionó "Otra" en el desplegable, puede aparecer el nombre libre que tecleó en `uni_other`. |
| `field` | Rama de conocimiento de los últimos estudios (texto de los `<option>` del formulario, p. ej. `"Administración y Dirección de Empresas (ADE)"`). |
| `gpa` | Nota media de los últimos estudios en escala 0–10, con decimales. |

### Tarea de redacción

| Columna | Descripción |
|---|---|
| `task_text` | Texto completo escrito por el participante en la tarea. La consigna era escribir 60–120 palabras sobre cómo sus estudios les ayudan en su futuro. |
| `words` | Número de palabras del `task_text` calculado por el frontend. |
| `edit_count` | Número de snapshots de edición guardados. Cada vez que el participante teclea algo en el textarea se añade un snapshot `{t, len}` al log. Se guardan como máximo los últimos 50. Este número refleja la intensidad de edición, no el número de caracteres. |

### Métricas conductuales de uso de IA y copiar/pegar  
*(registradas automáticamente por el frontend, sin que el participante lo declare)*

| Columna | Descripción |
|---|---|
| `ai_chars_inserted` | Caracteres totales insertados desde sugerencias de la IA integrada (botón "✨ Ayuda de IA"). Solo cuenta los que el participante aceptó haciendo clic en la sugerencia. 0 si nunca usó el botón o no insertó nada. |
| `paste_count` | Número de veces que el participante pegó texto en el textarea (evento `paste`). |
| `paste_total_chars` | Total de caracteres pegados a lo largo de toda la tarea. Si `paste_count > 0` y este valor es alto, puede indicar que pegó texto externo (p. ej. de ChatGPT). |

### Declaración autoreportada de uso de IA  
*(Pantalla 4b — el participante lo indica manualmente)*

| Columna | Descripción |
|---|---|
| `ai_generated_pct` | Porcentaje del texto que el participante dice haber copiado directamente de una IA, sin modificar (0–100). |
| `ai_paraphrased_pct` | Porcentaje del texto que el participante dice haber tomado de una IA y luego reformulado (0–100). |

> **Nota para análisis:** la diferencia entre `ai_chars_inserted` (conductual) y `ai_generated_pct` + `ai_paraphrased_pct` (autoreportado) es clave para detectar infradeclaración o uso de IA externa.

### Preguntas de control  
*(Pantalla 5)*

| Columna | Descripción |
|---|---|
| `policy_restrictiveness` | Escala Likert 1–7. Percepción de cuán restrictiva era la política de IA asignada (1 = nada restrictiva, 7 = muy restrictiva). Sirve como manipulation check. |
| `used_ai_button` | `Sí` / `No`. Si el participante dice haber clicado el botón de ayuda de IA del experimento. |
| `used_external_ai` | `Sí` / `No`. Si el participante admite haber usado una IA externa (p. ej. ChatGPT en otra pestaña). |

### Escala "Tu entorno y la IA"  
*(Pantalla 7 — Likert 1–5: 1 = Totalmente en desacuerdo, 5 = Totalmente de acuerdo)*

Estas variables capturan factores del modelo teórico (normas subjetivas, control conductual percibido, oportunidad, claridad normativa y presión).

| Columna | Ítem |
|---|---|
| `subj_norm_desc_1` | *"La mayoría de las personas de mi entorno usan IA regularmente en sus tareas o proyectos."* — Norma descriptiva: qué hacen los demás. |
| `subj_norm_inj_1` | *"Las personas importantes para mí desaprobarían que usara IA sin declararlo en un trabajo académico o profesional."* — Norma injuntiva: qué aprueban o desaprueban los demás. |
| `pbc_evasion_1` | *"Si quisiera, podría usar IA en una tarea sin que nadie lo detectara."* — Control conductual percibido (evasión): facilidad de uso encubierto. |
| `pbc_capacity_1` | *"Tengo los conocimientos necesarios para usar IA de forma eficaz en una tarea."* — Control conductual percibido (capacidad): autoeficacia con la IA. |
| `opp_perceived_1` | *"Creo que es fácil detectar cuando alguien ha usado IA sin declararlo."* — Oportunidad percibida: qué tan detectable cree que es el uso no declarado (puntuación alta = percibe alta detección, lo que desincentiva el uso encubierto). |
| `norm_clarity_1` | *"Las normas sobre el uso de IA en trabajos académicos o profesionales están bien definidas y son claras."* — Claridad normativa. |
| `pressure_1` | *"Siento que las exigencias de mis tareas o responsabilidades actuales me superan con frecuencia."* — Presión percibida / sobrecarga. |
| `ai_frequency` | Frecuencia de uso habitual de IA (ordinal codificado 1–5): 1 = Nunca, 2 = Raramente, 3 = A veces, 4 = Frecuentemente, 5 = Siempre. |

### Escala "Valores y motivaciones"  
*(Pantalla 7b — Likert 1–5: 1 = Totalmente en desacuerdo, 5 = Totalmente de acuerdo)*

| Columna | Ítem |
|---|---|
| `motiv_orient_1` | *"En general, me importa más obtener un buen resultado que el proceso de llegar a él."* — Orientación hacia los resultados vs. el proceso. |
| `moral_intern_1` | *"Respetaría las normas sobre uso de IA aunque nadie pudiera comprobarlo."* — Internalización moral: cumplimiento por convicción propia. |
| `moral_guilt_1` | *"Me sentiría culpable si usara IA en una tarea sin declararlo."* — Culpa moral anticipada. |
| `moral_principles_1` | *"Usar IA sin declararlo iría en contra de mis principios."* — Consistencia con principios personales. |
| `rationaliz_util_1` | *"Si la IA mejora el resultado de un trabajo, usarla está justificado aunque no esté permitido."* — Racionalización utilitaria (el fin justifica los medios). |
| `rationaliz_norm_1` | *"Si otros usan IA sin consecuencias, yo tampoco debería abstenerse."* — Racionalización normativa (comparación social). |

### Contacto

| Columna | Descripción |
|---|---|
| `email` | Correo electrónico del participante (campo completamente opcional). Vacío en la mayoría de los casos. No usar para análisis estadístico. |

---

## Hoja `events` — columnas

Cada fila es un evento individual. Hay muchas filas por participante.

| Columna | Descripción |
|---|---|
| `timestamp` | Fecha y hora UTC del evento (ISO 8601). |
| `subject_id` | ID del participante (igual que en `results`). |
| `policy` | Política asignada a ese participante. |
| `event` | Tipo de evento (ver tabla de eventos abajo). |
| `trial_index` | Número de trial jsPsych cuando ocurrió el evento. Los trials van de 0 en adelante siguiendo la secuencia de pantallas. |
| `time_on_screen_sec` | Segundos que el participante llevaba en la pantalla cuando ocurrió el evento (solo lo rellenan `screen_leave` y algunos otros; en el resto puede estar vacío). |
| `element_clicked` | Para eventos `click`: selector CSS del elemento clicado (p. ej. `BUTTON#ai_help`, `INPUT.input`). Vacío para otros tipos de eventos. |
| `payload_json` | JSON con datos adicionales específicos del tipo de evento (ver tabla de eventos). |

---

## Tipos de evento en la hoja `events`

### Eventos de navegación (generados automáticamente por jsPsych)

| Evento | Cuándo se dispara | Payload destacado |
|---|---|---|
| `screen_enter` | Al inicio de cada pantalla/trial | `trial_index`, `trial_type` (nombre del plugin jsPsych) |
| `screen_leave` | Al salir de cada pantalla/trial | `trial_index`, `rt_ms` (reaction time de jsPsych), `clicks` (total de clics en esa pantalla), `idle_ms` (ms de inactividad >2s), `time_on_screen_ms`, `time_on_screen_seconds` |

> `idle_ms` se calcula con un timer que acumula cada segundo de inactividad cuando el usuario lleva más de 2s sin mover el ratón, teclear ni hacer clic.

### Eventos de interacción general

| Evento | Cuándo se dispara | Payload destacado |
|---|---|---|
| `click` | Cada clic en cualquier lugar de la página | `trial_index`, `since_prev_click_ms` (ms desde el clic anterior), `element` (objeto con `tag`, `id`, `class`, `text`, `type`), `screen_time_ms` |
| `policy_assigned` | Al cargar la pantalla 1 (consentimiento) | `policy` — confirma qué condición se asignó y cuándo |

### Eventos de recogida de datos de formularios

| Evento | Cuándo se dispara | Payload |
|---|---|---|
| `demographics_basic` | Al salir de la pantalla 2 | `dob`, `sex`, `studies`, `grad_year` |
| `demographics_extended` | Al salir de la pantalla 6 | `uni`, `field`, `gpa` (y `uni_other` si aplica) |
| `ai_usage_declaration` | Al salir de la pantalla 4b | `generated_pct`, `paraphrased_pct` |
| `control_answers` | Al salir de la pantalla 5 | `policy_restrictiveness`, `used_ai_button`, `used_external_ai`, `inserted_ai_suggestion` |
| `personality_answers` | Al salir de la pantalla 7 | Todos los valores de `subj_norm_*`, `pbc_*`, `opp_*`, `norm_clarity_1`, `pressure_1`, `ai_frequency` |
| `ai_motivation_answers` | Al salir de la pantalla 7b | Todos los valores de `motiv_*`, `moral_*`, `rationaliz_*` |
| `email_provided` | Al salir de la pantalla de email, solo si escribió algo | `email` |

### Eventos de la tarea de redacción (pantalla 4)

| Evento | Cuándo se dispara | Payload destacado |
|---|---|---|
| `task_snapshot` | Al salir de la pantalla 4 | `words`, `text_len`, `edits` (array con los últimos 50 snapshots `{t, len}`), `ai_chars_inserted`, `ai_percentage`, `paste_count`, `paste_total_chars`, `paste_percentage`, `manual_chars`, `manual_percentage` |
| `paste` | Cada vez que se pega texto en el textarea | `paste_count` (acumulado), `chars_pasted` (del evento actual), `total_chars_pasted` (acumulado), `text_preview` (primeros 50 caracteres del texto pegado) |
| `copy` | Cada vez que se copia texto del textarea | `chars_copied`, `text_preview` |
| `cut` | Cada vez que se corta texto del textarea | `chars_cut`, `text_preview` |

### Eventos de uso del botón de IA (pantalla 4)

| Evento | Cuándo se dispara | Payload destacado |
|---|---|---|
| `ai_help_open` | Al hacer clic en "✨ Ayuda de IA" | `has_selection` (booleano — si había texto seleccionado para reescribir) |
| `ai_text_inserted` | Al aceptar la sugerencia (clic en el chip de sugerencia) | `suggestion` (texto sugerido), `chars_inserted`, `total_ai_chars` (acumulado), `selection_chars` (si reemplazó selección), `replaced_selection` (booleano) |

### Eventos de finalización

| Evento | Cuándo se dispara | Payload |
|---|---|---|
| `finalize_sent` | Justo después de enviar los datos a `/finalize` | `success` (booleano), `error` (mensaje si falló) |

---

## Variables derivadas útiles para análisis

Estas no existen directamente como columnas pero se calculan fácilmente a partir de los datos:

| Variable derivada | Cálculo |
|---|---|
| Edad del participante | Parsear `dob` + restar a la fecha del experimento (`timestamp`) |
| % de caracteres de IA sobre el total | `ai_chars_inserted / len(task_text) * 100` |
| % de caracteres pegados sobre el total | `paste_total_chars / len(task_text) * 100` |
| Discrepancia declaración vs. conducta | `(ai_generated_pct + ai_paraphrased_pct) - ai_pct_conductual` |
| Tiempo total en el experimento | Diferencia entre el `timestamp` del primer `screen_enter` y el último `screen_leave` en la hoja `events` |
| Tiempo en la tarea (pantalla 4) | `time_on_screen_seconds` del evento `screen_leave` con `trial_index` correspondiente a la pantalla 4 |
| ¿Usó IA a pesar de política restrictiva? | `policy == 'restrictiva'` AND (`ai_chars_inserted > 0` OR `used_external_ai == 'Sí'`) |

---

## Secuencia de pantallas (trial_index de referencia)

La timeline del experimento es fija y en este orden:

| Pantalla | Contenido | trial_index aproximado |
|---|---|---|
| s1 | Bienvenida y consentimiento | 0 |
| s2 | Datos básicos (DOB, sexo, estudios) | 1 |
| s3 | Introducción a la tarea + política IA | 2 |
| s4 | Tarea de redacción (textarea + botón IA) | 3 |
| s4b | Declaración autoreportada de uso de IA | 4 |
| s5 | Preguntas de control | 5 |
| s6 | Demográficos ampliados (uni, field, gpa) | 6 |
| s7 | Escala "Tu entorno y la IA" | 7 |
| s7b | Escala "Valores y motivaciones" | 8 |
| preFinalizeCall | Envío silencioso a servidor | 9 |
| sEmail | Correo opcional | 10 |
| finalizeCall | Flush final de eventos | 11 |

---

## Notas de calidad de datos

- **`subject_id` duplicados**: si aparece el mismo `subject_id` dos veces en `results`, el participante probablemente refrescó la página antes de terminar — conservar solo la fila con `timestamp` más reciente.
- **`task_text` vacío**: el frontend impide avanzar con menos de 60 palabras, pero si el participante escribió y borró y recargó puede llegar vacío. Filtrar.
- **`paste_total_chars > len(task_text)`**: puede ocurrir si el participante pegó, borró y volvió a pegar. El contador acumula todos los `paste`, no el neto final.
- **`ai_generated_pct + ai_paraphrased_pct > 100`**: no hay validación en el formulario. Tratar como dato inválido o pedir que sumen ≤ 100.
- **Eventos sin `trial_index`**: algunos eventos enviados desde `on_load` pueden tener `trial_index` del trial anterior porque jsPsych aún no ha avanzado el contador.
