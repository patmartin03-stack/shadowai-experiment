# Shadow AI Experiment

Experimento de investigación académica sobre el uso de IA en escritura académica con 3 políticas: **permisiva**, **difusa** y **restrictiva**.

## 📋 Descripción

- **Front-end**: jsPsych en `/public/index.html`
- **Back-end**: Flask en `app.py` conectado a OpenAI y Supabase
- **Hosting**: Render
- **Objetivo**: Registrar clics en botón IA, tiempo de uso, palabras escritas, y disclosure

## 🔧 Configuración

### Variables de entorno requeridas

```bash
OPENAI_API_KEY=sk-...                    # API key de OpenAI
SUPABASE_URL=https://xxx.supabase.co     # URL de tu proyecto Supabase
SUPABASE_SERVICE_ROLE_KEY=eyJ...         # Service role key de Supabase
```

### Instalación local

```bash
# 1. Clonar el repositorio
git clone <tu-repo>
cd shadowai-experiment

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Configurar variables de entorno
export OPENAI_API_KEY="tu-api-key"
export SUPABASE_URL="tu-url"
export SUPABASE_SERVICE_ROLE_KEY="tu-key"

# 4. Ejecutar el servidor
python app.py
```

El servidor estará disponible en `http://localhost:5000`

## 🌐 Endpoints disponibles

### `GET /`
Mensaje de bienvenida del servidor.

### `GET /health`
Health check para Render y otros monitores.
- **Response**: `{"status": "ok", "timestamp": "...", "supabase_configured": true, "openai_configured": true}`

### `POST /save` (alias: `/log`)
Guarda eventos del experimento en Supabase (tabla `shadowai.events`).
- **Body**: `{"subject_id": "S-ABC", "policy": "permisiva", "event": "click", "payload": {...}}`
- **Response**: `{"ok": true, "inserted": true}`

### `POST /assist`
Llama a OpenAI para generar sugerencias de escritura basadas en el texto del usuario.
- **Body**: `{"subject_id": "S-ABC", "policy": "permisiva", "text": "...", "selection": "..."}`
- **Response**: `{"ok": true, "suggestions": ["...", "...", "...", "..."], "model": "gpt-4o-mini", "tokens": 150}`

### `POST /finalize`
Guarda el resumen final del experimento en Supabase (tabla `shadowai.results`).
- **Body**: `{"subject_id": "S-ABC", "demographics": {...}, "results": {...}}`
- **Response**: `{"ok": true, "finalized": true}`

## 🧪 Testing

### Tests mínimos

```bash
# Ejecutar suite de tests
python test_app.py
```

Los tests verifican:
- ✅ `/health` responde correctamente
- ✅ `/` responde con mensaje de bienvenida
- ✅ `/save` acepta eventos (puede fallar sin Supabase)
- ✅ `/log` funciona como alias de `/save`
- ✅ `/assist` genera 4 sugerencias (requiere OpenAI API key)
- ✅ `/finalize` acepta datos finales (puede fallar sin Supabase)

**Nota**: Algunos tests pueden fallar si no tienes configuradas las variables de entorno. Esto es normal en testing local.

### Tests manuales con curl

```bash
# Test /health
curl http://localhost:5000/health

# Test /assist
curl -X POST http://localhost:5000/assist \
  -H "Content-Type: application/json" \
  -d '{
    "subject_id": "TEST-001",
    "policy": "permisiva",
    "text": "Mis estudios en ingeniería me ayudarán a...",
    "selection": ""
  }'

# Test /save
curl -X POST http://localhost:5000/save \
  -H "Content-Type: application/json" \
  -d '{
    "subject_id": "TEST-001",
    "policy": "permisiva",
    "event": "test_click",
    "payload": {"test": true}
  }'
```

## 📁 Estructura del proyecto

```
shadowai-experiment/
├── app.py                 # Backend Flask con endpoints
├── requirements.txt       # Dependencias Python
├── test_app.py           # Suite de tests mínimos
├── README.md             # Esta documentación
└── public/
    ├── index.html        # Página principal con jsPsych
    ├── css/
    │   └── style.css     # Estilos personalizados
    └── js/
        └── experiment.js  # Lógica del experimento (8 pantallas)
```

## 🚀 Deploy en Render

1. Conecta tu repositorio de GitHub a Render
2. Crea un nuevo **Web Service**
3. Configura:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app` (añade `gunicorn` a requirements.txt)
4. Añade las variables de entorno en la configuración de Render
5. Render detectará automáticamente `/health` para health checks

## 📊 Base de datos Supabase

### Tabla `shadowai.events`
Registra todos los eventos del experimento (clics, entradas/salidas de pantalla, etc.)

### Tabla `shadowai.results`
Registra el resumen final de cada participante (texto escrito, demografía, cuestionarios)

### Tabla `shadowai.participants`
Registra información demográfica de los participantes

## ⚠️ Notas importantes

- ✅ **Solo OpenAI**: Todas las llamadas a LLM usan OpenAI, no Anthropic
- ✅ **Variables de entorno**: Usa las 3 variables especificadas arriba
- ✅ **Endpoints fijos**: Solo usa `/assist`, `/save`, `/health`, `/finalize` y `/`
- ✅ **Comentarios**: Todo el código incluye comentarios en español
- ✅ **Tests**: Ejecuta `python test_app.py` antes de hacer deploy

## 📝 Cómo probar localmente

1. Instala dependencias: `pip install -r requirements.txt`
2. Configura variables de entorno (ver sección Configuración)
3. Ejecuta tests: `python test_app.py`
4. Inicia servidor: `python app.py`
5. Abre en navegador: `http://localhost:5000/public/index.html`

## 📧 Contacto

Para preguntas sobre el experimento:
- Email: pmartinmartinez@alu.comillas.edu
- Universidad: Universidad Pontificia Comillas