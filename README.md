# Shadow AI — Experimento

Aplicación web del experimento desarrollado para un **Trabajo de Fin de Grado
(TFG)** de la Universidad Pontificia Comillas. El experimento estudia el
fenómeno del **"Shadow AI"**: el uso —declarado u oculto— de herramientas de
inteligencia artificial generativa cuando una norma lo permite, lo prohíbe o lo
deja a criterio del individuo.

---

## 1. ¿Qué estudia el experimento?

Cada participante realiza una breve **tarea de redacción** (un texto de 60–120
palabras sobre cómo sus estudios le ayudan en su futuro profesional o personal).
Antes de empezar se le muestra, **asignada al azar**, una de tres políticas
sobre el uso de IA:

| Política | Mensaje al participante |
|----------|-------------------------|
| **Permisiva** | El uso de IA generativa **está permitido**. |
| **Ambigua** | El uso de IA generativa **queda a tu criterio** personal. |
| **Restrictiva** | El uso de IA generativa **no está permitido**. |

Durante la tarea, el participante dispone de un botón **"✨ Ayuda de IA"** que
genera fragmentos de texto listos para insertar (a través del backend y la API
de OpenAI). El botón se muestra en las tres condiciones, de modo que el diseño
permite observar si la política asignada influye en:

- el **uso real** de la IA (clics, caracteres insertados, copiar/pegar), y
- el **uso declarado** (lo que la persona reconoce haber usado),

así como la posible brecha entre ambos. Tras la tarea se recogen cuestionarios
de control, datos demográficos y escalas tipo Likert sobre normas percibidas,
control conductual, presión, valores morales y racionalizaciones.

> **Nota:** el botón de IA aparece incluso en la condición restrictiva de forma
> intencional, para poder medir el comportamiento bajo cada norma. Esto forma
> parte del diseño del experimento.

---

## 2. Flujo de pantallas

El experimento se presenta como una secuencia lineal de pantallas construida con
[jsPsych](https://www.jspsych.org/) 7.3.3:

| # | Pantalla | Contenido |
|---|----------|-----------|
| 1 | Bienvenida | Información del estudio y consentimiento informado. |
| 2 | Datos iniciales | Fecha de nacimiento, sexo, últimos estudios, año de graduación. |
| 3 | Introducción | Enunciado de la tarea + política de IA asignada (visible). |
| 4 | Tarea | Redacción de 60–120 palabras con botón de "Ayuda de IA". |
| 4b | Declaración de uso de IA | % de texto generado y % parafraseado por IA (autoreportado). |
| 5 | Control | Percepción de la restrictividad de la política y uso de IA. |
| 6 | Estudios | Universidad, rama de conocimiento y nota media. |
| 7 | Tu entorno y la IA | Escalas Likert: normas, control percibido, presión, frecuencia de uso. |
| 7b | Valores y motivaciones | Escalas Likert: motivación, moral interna, racionalizaciones. |
| — | Finalización | Envío de datos, contacto opcional y mensaje de agradecimiento. |

---

## 3. Datos que se recogen

Los datos se almacenan en un documento de **Google Sheets** con dos hojas:

### Hoja `events` — registro conductual continuo

Cada fila es un evento capturado durante la sesión (entrada/salida de pantalla,
clic, copiar/pegar, apertura de la ayuda de IA, inserción de texto de IA, etc.).

| Columna | Descripción |
|---------|-------------|
| `timestamp` | Marca de tiempo (UTC, ISO 8601). |
| `subject_id` | Identificador anónimo del participante. |
| `policy` | Política asignada (`permisiva` / `difusa` / `restrictiva`). |
| `event` | Tipo de evento. |
| `trial_index` | Índice de la pantalla. |
| `time_on_screen_sec` | Tiempo en la pantalla (segundos). |
| `element_clicked` | Elemento sobre el que se hizo clic (tag/id/clase). |
| `payload_json` | Datos adicionales del evento en JSON. |

### Hoja `results` — resumen final por participante

Una fila por participante con datos demográficos, métricas de la tarea, uso de
IA (real y declarado) y respuestas a los cuestionarios. Las columnas incluyen,
entre otras: `task_text`, `words`, `edit_count`, `ai_chars_inserted`,
`paste_count`, `ai_generated_pct`, `ai_paraphrased_pct`,
`policy_restrictiveness`, `used_ai_button`, `used_external_ai`, las escalas
Likert de las pantallas 7 y 7b, y un `email` de contacto opcional.

> Todos los datos se recogen de forma **anónima** y con fines exclusivamente
> académicos y de investigación. El `subject_id` es un código aleatorio que no
> identifica a la persona.

---

## 4. Arquitectura

```
Navegador (jsPsych)                Backend (Flask)                Servicios
────────────────────               ───────────────                ─────────
public/index.html      ──┐
public/css/style.css     │  HTTP   app.py
public/js/experiment.js ─┘ ─────►  ├── /log, /log-batch  ───────► Google Sheets
                                    ├── /finalize         ───────► (hoja results)
                                    ├── /ai-suggest       ───────► OpenAI API
                                    ├── /flush-events
                                    └── /health
```

- **Frontend** (`public/`): construye el experimento con jsPsych, registra
  métricas conductuales y las envía en lotes al backend. No contiene ninguna
  clave de API.
- **Backend** (`app.py`): servidor Flask que sirve los archivos estáticos,
  recibe los eventos, los escribe en Google Sheets (con caché de conexión,
  cola de eventos y reintentos) y actúa de intermediario seguro con la API de
  OpenAI para las sugerencias de IA.

### Endpoints del backend

| Endpoint | Método | Función |
|----------|--------|---------|
| `/` y `/<archivo>` | GET | Sirve los archivos estáticos del frontend. |
| `/log` | POST | Encola un evento para escritura por lotes. |
| `/log-batch` | POST | Recibe varios eventos y los escribe directamente. |
| `/flush-events` | POST | Fuerza el volcado de los eventos pendientes. |
| `/finalize` | POST | Guarda el resumen final del participante. |
| `/ai-suggest` | POST | Genera una sugerencia de texto con OpenAI. |
| `/health` | GET | Diagnóstico de conexión con Google Sheets. |

---

## 5. Estructura del proyecto

```
shadowai-experiment/
├── app.py                 # Backend Flask (API + Google Sheets + OpenAI)
├── requirements.txt       # Dependencias de Python
├── .env.example           # Plantilla de variables de entorno
├── .gitignore
├── README.md
└── public/                # Frontend estático
    ├── index.html         # Página y carga de jsPsych
    ├── css/style.css       # Estilos (incluye modo oscuro y responsive)
    └── js/experiment.js    # Lógica del experimento (timeline de pantallas)
```

---

## 6. Tecnologías

- **Python 3.11** + **Flask** (servidor y API REST).
- **gspread** + **google-auth** (escritura en Google Sheets).
- **OpenAI API** (`gpt-4o-mini`) para las sugerencias de la "Ayuda de IA".
- **jsPsych 7.3.3** (cargado por CDN) para construir el experimento en el navegador.

---

## 7. Configuración y ejecución local

### Requisitos previos

1. **Python 3.11** o superior.
2. Una **cuenta de servicio de Google** con la API de Google Sheets y de Drive
   habilitadas, y un documento de Google Sheets compartido con el correo de esa
   cuenta de servicio (permiso de edición).
3. (Opcional) Una **clave de API de OpenAI** para habilitar las sugerencias de IA.

### Pasos

```bash
# 1. Clonar el repositorio e instalar dependencias
pip install -r requirements.txt

# 2. Configurar las variables de entorno
cp .env.example .env        # y rellenar los valores reales

# 3. Exportar las variables (o usar un gestor como python-dotenv)
export OPENAI_API_KEY="sk-..."
export GOOGLE_SHEETS_CREDENTIALS='{"type":"service_account", ...}'
export GOOGLE_SHEET_NAME="Shadow AI - Experimento"

# 4. Arrancar el servidor
python app.py
```

La aplicación queda disponible en `http://localhost:5000`.

Puedes comprobar el estado de la conexión con Google Sheets visitando
`http://localhost:5000/health`.

### Variables de entorno

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `GOOGLE_SHEETS_CREDENTIALS` | Sí | JSON de la cuenta de servicio de Google (en una sola línea). |
| `GOOGLE_SHEET_NAME` | No | Nombre del documento de Sheets (por defecto: `Shadow AI - Experimento`). |
| `OPENAI_API_KEY` | No | Clave de OpenAI. Sin ella, el botón de IA queda inoperativo pero el resto funciona. |

> Si falta `GOOGLE_SHEETS_CREDENTIALS`, el servidor arranca igualmente y avisa
> por consola, pero **no podrá guardar datos**.

---

## 8. Despliegue

El proyecto está preparado para desplegarse en plataformas tipo **Render** u
otras compatibles con Python/Flask:

- Comando de instalación: `pip install -r requirements.txt`
- Comando de arranque: `python app.py` (o un servidor WSGI como `gunicorn app:app`).
- Las variables de entorno se configuran en el panel de la plataforma, no en el código.

---

## 9. Privacidad y ética

- La participación es **voluntaria** y requiere consentimiento explícito.
- Los datos se recogen de forma **anónima** y se usan únicamente con fines
  académicos y de investigación.
- El correo electrónico solo se solicita de forma **opcional** al final, para
  quienes deseen recibir información sobre los resultados.
- Para consultas o para retirar los datos: `pmartinmartinez@alu.comillas.edu`.
