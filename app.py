# =============================================================
# Shadow AI — Backend Flask con Google Sheets (v2.0)
# =============================================================

import os
import os.path
import json
import time as _time
import threading
import traceback
import requests
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import gspread

# =============================================================
# CONFIGURACIÓN — VARIABLES DE ENTORNO
# =============================================================
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GOOGLE_SHEETS_CREDENTIALS = os.getenv("GOOGLE_SHEETS_CREDENTIALS")  # JSON de credenciales
GOOGLE_SHEET_NAME = os.getenv("GOOGLE_SHEET_NAME", "Shadow AI - Experimento")  # Nombre de tu Google Sheet

# =============================================================
# VALIDACIÓN DE CONFIGURACIÓN AL INICIO
# =============================================================
def validate_environment():
    """Valida que las variables de entorno requeridas estén configuradas correctamente"""
    errors = []

    # Validar OpenAI API Key (solo advertencia, no crítico)
    if not OPENAI_API_KEY:
        print("⚠️ WARNING: OPENAI_API_KEY no configurado - la funcionalidad de sugerencias de IA no estará disponible")
    elif len(OPENAI_API_KEY.strip()) < 20:
        print("⚠️ WARNING: OPENAI_API_KEY parece inválido (muy corto)")

    # Validar Google Sheets Credentials (crítico para guardar datos)
    if not GOOGLE_SHEETS_CREDENTIALS:
        errors.append("GOOGLE_SHEETS_CREDENTIALS no está configurado")
    else:
        try:
            creds_dict = json.loads(GOOGLE_SHEETS_CREDENTIALS)
            required_keys = ['type', 'project_id', 'private_key', 'client_email']
            missing_keys = [key for key in required_keys if key not in creds_dict]
            if missing_keys:
                errors.append(f"GOOGLE_SHEETS_CREDENTIALS falta las claves: {', '.join(missing_keys)}")
        except json.JSONDecodeError as e:
            errors.append(f"GOOGLE_SHEETS_CREDENTIALS contiene JSON inválido: {str(e)}")
        except Exception as e:
            errors.append(f"Error validando GOOGLE_SHEETS_CREDENTIALS: {str(e)}")

    # Reportar errores
    if errors:
        print("\n" + "="*60)
        print("❌ ERRORES DE CONFIGURACIÓN CRÍTICOS:")
        for error in errors:
            print(f"   • {error}")
        print("="*60 + "\n")
        print("⚠️  El experimento puede fallar al guardar datos.")
        print("⚠️  Por favor, configura las variables de entorno correctamente.")
        print()
    else:
        print("✅ Configuración validada correctamente")

    return len(errors) == 0

# Validar al cargar el módulo
validate_environment()

# =============================================================
# INICIALIZAR GOOGLE SHEETS
# =============================================================
def get_google_sheets_client():
    """Conectar con Google Sheets usando credenciales de servicio"""
    try:
        if not GOOGLE_SHEETS_CREDENTIALS:
            print("⚠️ ERROR: GOOGLE_SHEETS_CREDENTIALS no configurado")
            return None

        # Parsear credenciales desde variable de entorno
        try:
            creds_dict = json.loads(GOOGLE_SHEETS_CREDENTIALS)
        except json.JSONDecodeError as e:
            print(f"⚠️ ERROR: GOOGLE_SHEETS_CREDENTIALS contiene JSON inválido: {e}")
            return None

        # Validar que tenga las claves necesarias
        required_keys = ['type', 'project_id', 'private_key', 'client_email']
        missing_keys = [key for key in required_keys if key not in creds_dict]
        if missing_keys:
            print(f"⚠️ ERROR: Credenciales falta claves requeridas: {', '.join(missing_keys)}")
            return None

        # Conectar con Google Sheets usando service_account_from_dict (compatible gspread 5.x y 6.x)
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        try:
            client = gspread.service_account_from_dict(creds_dict, scopes=scopes)
            # Verificar que el cliente funciona intentando listar spreadsheets
            print(f"✅ Google Sheets autenticado como: {creds_dict.get('client_email', '?')}")
            return client
        except Exception as e:
            print(f"⚠️ ERROR: Error autenticando con Google Sheets: {type(e).__name__}: {e}")
            return None

    except Exception as e:
        print(f"⚠️ ERROR inesperado conectando con Google Sheets: {type(e).__name__}: {e}")
        return None

def get_or_create_worksheet(client, sheet_name, worksheet_name, headers):
    """Obtener o crear una hoja de trabajo. Si ya existe, asegura que tenga suficientes columnas."""
    if not client:
        print(f"⚠️ ERROR: Cliente de Google Sheets es None")
        return None

    try:
        spreadsheet = client.open(sheet_name)
    except gspread.exceptions.SpreadsheetNotFound:
        print(f"⚠️ ERROR: Spreadsheet '{sheet_name}' no encontrado")
        return None
    except Exception as e:
        print(f"⚠️ ERROR abriendo spreadsheet: {type(e).__name__}: {e}")
        return None

    # Obtener o crear la worksheet
    try:
        worksheet = spreadsheet.worksheet(worksheet_name)
        print(f"✅ Worksheet '{worksheet_name}' encontrada")
    except gspread.exceptions.WorksheetNotFound:
        try:
            worksheet = spreadsheet.add_worksheet(title=worksheet_name, rows=2000, cols=len(headers))
            worksheet.append_row(headers, value_input_option='RAW')
            print(f"✅ Creada nueva worksheet '{worksheet_name}' con {len(headers)} columnas")
            return worksheet
        except Exception as e:
            print(f"⚠️ ERROR creando worksheet '{worksheet_name}': {type(e).__name__}: {e}")
            return None
    except Exception as e:
        print(f"⚠️ ERROR accediendo a worksheet '{worksheet_name}': {type(e).__name__}: {e}")
        return None

    # ── CRÍTICO: Asegurar que la worksheet tiene suficientes columnas ──
    # El worksheet "events" fue creado originalmente con 5 columnas y ahora
    # necesita 8. Google Sheets rechaza writes que excedan el grid → resize.
    try:
        current_cols = worksheet.col_count
        if current_cols < len(headers):
            print(f"⚠️ Worksheet '{worksheet_name}' tiene {current_cols} columnas, necesita {len(headers)}. Redimensionando...")
            worksheet.resize(rows=max(worksheet.row_count, 2000), cols=len(headers))
            print(f"✅ Worksheet '{worksheet_name}' redimensionada a {len(headers)} columnas")
            # Actualizar cabeceras sólo si la primera fila no las tiene
            try:
                first_row = worksheet.row_values(1)
                if not first_row or first_row[:len(headers)] != headers:
                    worksheet.update('A1', [headers], value_input_option='RAW')
                    print(f"✅ Cabeceras actualizadas en '{worksheet_name}'")
            except Exception as e:
                print(f"⚠️ No se pudieron actualizar cabeceras (no crítico): {e}")
    except Exception as e:
        print(f"⚠️ No se pudo verificar/redimensionar columnas de '{worksheet_name}': {type(e).__name__}: {e}")
        # Continuamos igualmente — append_rows intentará escribir

    return worksheet

# =============================================================
# CACHÉ DE GOOGLE SHEETS (evita reconectar en cada request)
# =============================================================
_sheets_cache = {
    "client": None,
    "worksheets": {},         # worksheet_name → worksheet object
    "last_auth": 0,           # timestamp de última autenticación exitosa
    "last_auth_failure": 0    # timestamp del último fallo de autenticación
}

AUTH_TTL = 300              # Reautenticar cada 5 minutos
AUTH_FAILURE_COOLDOWN = 60  # Esperar 60s antes de reintentar tras fallo de auth

_cache_lock = threading.Lock()  # Protege lectura/escritura de _sheets_cache
_auth_lock  = threading.Lock()  # Serializa llamadas a get_google_sheets_client() (evita thundering herd)

def get_cached_client():
    """Obtiene cliente de Google Sheets con caché, thread-safe.
    Usa double-checked locking para evitar thundering herd bajo carga concurrente."""
    now = _time.time()

    # Fast path: verificar bajo _cache_lock
    with _cache_lock:
        failure = _sheets_cache["last_auth_failure"]
        if failure > 0 and (now - failure) < AUTH_FAILURE_COOLDOWN:
            return _sheets_cache["client"]
        if _sheets_cache["client"] and (now - _sheets_cache["last_auth"]) < AUTH_TTL:
            return _sheets_cache["client"]

    # Slow path: necesitamos reautenticar; _auth_lock serializa para que solo un thread lo haga
    with _auth_lock:
        now = _time.time()
        with _cache_lock:
            failure = _sheets_cache["last_auth_failure"]
            if failure > 0 and (now - failure) < AUTH_FAILURE_COOLDOWN:
                return _sheets_cache["client"]
            if _sheets_cache["client"] and (now - _sheets_cache["last_auth"]) < AUTH_TTL:
                return _sheets_cache["client"]

        client = get_google_sheets_client()
        with _cache_lock:
            if client:
                _sheets_cache["client"] = client
                _sheets_cache["last_auth"] = now
                _sheets_cache["last_auth_failure"] = 0
                _sheets_cache["worksheets"] = {}  # Limpiar worksheets al reautenticar
            else:
                _sheets_cache["last_auth_failure"] = now
                print(f"⚠️ get_cached_client: auth fallida, cooldown de {AUTH_FAILURE_COOLDOWN}s")
        return client

def get_cached_worksheet(client, sheet_name, worksheet_name, headers):
    """Obtiene worksheet con caché, thread-safe."""
    with _cache_lock:
        ws = _sheets_cache["worksheets"].get(worksheet_name)
    if ws:
        return ws
    ws = get_or_create_worksheet(client, sheet_name, worksheet_name, headers)
    if ws:
        with _cache_lock:
            _sheets_cache["worksheets"][worksheet_name] = ws
    return ws

# =============================================================
# COLA DE EVENTOS PENDIENTES (batch insert)
# =============================================================
_events_lock = threading.Lock()
_events_queue = []
_flush_lock   = threading.Lock()   # Evita flushes concurrentes (escrituras duplicadas)

EVENTS_HEADERS = ["timestamp", "subject_id", "policy", "event", "trial_index",
                   "time_on_screen_sec", "element_clicked", "payload_json"]

def flush_events():
    """Escribe todos los eventos pendientes a Google Sheets.
    Usa _flush_lock para evitar ejecuciones simultáneas que puedan duplicar datos.
    Los eventos que fallen se re-insertan AL INICIO de la cola para preservar el orden."""

    # Intentar adquirir el lock sin bloquear; si ya hay un flush en curso, salir
    acquired = _flush_lock.acquire(blocking=False)
    if not acquired:
        print("⚠️ flush_events: flush en curso, omitiendo este ciclo")
        return False

    batch = []
    try:
        with _events_lock:
            if not _events_queue:
                return True
            batch = list(_events_queue)
            _events_queue.clear()

        client = get_cached_client()
        if not client:
            print(f"⚠️ flush_events: Google Sheets no disponible, {len(batch)} eventos re-encolados")
            with _events_lock:
                _events_queue[:0] = batch   # Prepend: preserva orden cronológico
            return False

        worksheet = get_cached_worksheet(client, GOOGLE_SHEET_NAME, "events", EVENTS_HEADERS)
        if not worksheet:
            print(f"⚠️ flush_events: worksheet no disponible, {len(batch)} eventos re-encolados")
            with _events_lock:
                _events_queue[:0] = batch
            with _cache_lock:
                _sheets_cache["worksheets"].pop("events", None)
            return False

        try:
            worksheet.append_rows(batch, value_input_option='RAW')
            print(f"✅ flush_events: {len(batch)} eventos guardados en Google Sheets")
            return True
        except gspread.exceptions.APIError as e:
            print(f"⚠️ flush_events: APIError insertando {len(batch)} eventos: {e}")
            with _events_lock:
                _events_queue[:0] = batch
            with _cache_lock:
                _sheets_cache["worksheets"].pop("events", None)
            return False
        except Exception as e:
            print(f"⚠️ flush_events: error insertando {len(batch)} eventos: {type(e).__name__}: {e}")
            with _events_lock:
                _events_queue[:0] = batch
            with _cache_lock:
                _sheets_cache["worksheets"].pop("events", None)
            return False

    except Exception as e:
        print(f"⚠️ flush_events: error inesperado: {type(e).__name__}: {e}")
        if batch:
            with _events_lock:
                _events_queue[:0] = batch
        return False
    finally:
        _flush_lock.release()

# Timer para flush periódico
_flush_timer = None
_flush_timer_lock = threading.Lock()  # Evita crear múltiples timers

def schedule_flush():
    """Programa un flush de eventos cada 10 segundos (solo un timer activo a la vez)"""
    global _flush_timer
    with _flush_timer_lock:
        if _flush_timer and _flush_timer.is_alive():
            return  # Ya hay un timer activo
        _flush_timer = threading.Timer(10.0, _do_periodic_flush)
        _flush_timer.daemon = True
        _flush_timer.start()

def _do_periodic_flush():
    """Ejecuta flush periódico y reprograma"""
    flush_events()
    schedule_flush()

# Arrancar el flush periódico
schedule_flush()

# =============================================================
# INICIALIZAR FLASK
# =============================================================
app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)

# =============================================================
# RUTAS API (deben ir ANTES de las rutas estáticas)
# =============================================================

# ENDPOINT 0: /health  → diagnóstico de conexión a Google Sheets
@app.route("/health", methods=["GET"])
def health_check():
    """Endpoint de diagnóstico: verifica conexión a Google Sheets y estado del sistema"""
    with _events_lock:
        queue_size = len(_events_queue)
    with _cache_lock:
        cache_client  = _sheets_cache["client"] is not None
        cache_wsheets = list(_sheets_cache["worksheets"].keys())

    status = {
        "server": "ok",
        "gspread_version": getattr(gspread, '__version__', 'unknown'),
        "google_sheets_configured": bool(GOOGLE_SHEETS_CREDENTIALS),
        "openai_configured": bool(OPENAI_API_KEY),
        "events_in_queue": queue_size,
        "cache_client": cache_client,
        "cache_worksheets": cache_wsheets,
    }

    # Intentar conectar a Google Sheets
    try:
        client = get_cached_client()
        if client:
            status["sheets_auth"] = "ok"
            try:
                spreadsheet = client.open(GOOGLE_SHEET_NAME)
                status["spreadsheet"] = "ok"
                status["spreadsheet_name"] = GOOGLE_SHEET_NAME
                worksheets = [ws.title for ws in spreadsheet.worksheets()]
                status["worksheets_found"] = worksheets

                # Verificar hoja de eventos
                if "events" in worksheets:
                    events_ws = spreadsheet.worksheet("events")
                    status["events_rows"] = events_ws.row_count
                    status["events_last_row"] = len(events_ws.get_all_values())

                # Verificar hoja de resultados
                if "results" in worksheets:
                    results_ws = spreadsheet.worksheet("results")
                    status["results_rows"] = results_ws.row_count
                    status["results_last_row"] = len(results_ws.get_all_values())
                else:
                    status["results_sheet"] = "NO EXISTE - se creará en el primer /finalize"

            except Exception as e:
                status["spreadsheet"] = f"error: {type(e).__name__}: {e}"
        else:
            status["sheets_auth"] = "FAILED - no se pudo autenticar"
    except Exception as e:
        status["sheets_auth"] = f"error: {type(e).__name__}: {e}"

    return jsonify(status), 200

# ENDPOINT 1: /log  → encola evento para batch insert en Google Sheets
@app.route("/log", methods=["POST"])
def log_event():
    try:
        if not request.is_json and not request.data:
            return jsonify({"ok": True, "queued": False, "error": "Request debe contener JSON"}), 200

        try:
            data = request.get_json(force=True)
        except Exception as e:
            return jsonify({"ok": True, "queued": False, "error": "JSON inválido"}), 200

        if data is None:
            return jsonify({"ok": True, "queued": False, "error": "JSON vacío"}), 200

        row = _build_event_row(data)
        with _events_lock:
            _events_queue.append(row)
            queue_size = len(_events_queue)

        event_type = data.get("event", "unknown")
        subject_id = data.get("subject_id", "unknown")
        print(f"📊 /log encolado: event={event_type}, subject={subject_id[:8]}..., cola={queue_size}")

        # Flush inmediato si la cola tiene 15+ eventos
        if queue_size >= 15:
            threading.Thread(target=flush_events, daemon=True).start()

        return jsonify({"ok": True, "queued": True}), 200

    except Exception as e:
        print(f"⚠️ ERROR inesperado en /log: {type(e).__name__}: {e}")
        return jsonify({"ok": True, "queued": False, "error": str(e)}), 200

# ENDPOINT 1b: /log-batch  → recibe múltiples eventos y los escribe directamente a Sheets
@app.route("/log-batch", methods=["POST"])
def log_batch():
    try:
        if not request.is_json and not request.data:
            return jsonify({"ok": True, "written": 0}), 200

        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({"ok": False, "error": "JSON inválido"}), 400

        events = data if isinstance(data, list) else data.get("events", [])
        if not events:
            return jsonify({"ok": True, "written": 0}), 200

        rows = [_build_event_row(evt) for evt in events if isinstance(evt, dict)]
        if not rows:
            return jsonify({"ok": True, "written": 0}), 200

        # Escribir directamente a Google Sheets (síncrono, igual que /finalize)
        # Esto garantiza que los eventos no se pierdan si el proceso se reinicia.
        client = get_cached_client()
        if not client:
            print(f"⚠️ /log-batch: Google Sheets no disponible, {len(rows)} eventos no guardados")
            return jsonify({"ok": False, "error": "Google Sheets no disponible"}), 503

        worksheet = get_cached_worksheet(client, GOOGLE_SHEET_NAME, "events", EVENTS_HEADERS)
        if not worksheet:
            print(f"⚠️ /log-batch: worksheet 'events' no disponible")
            with _cache_lock:
                _sheets_cache["worksheets"].pop("events", None)
            return jsonify({"ok": False, "error": "Worksheet no disponible"}), 503

        try:
            worksheet.append_rows(rows, value_input_option='RAW')
            print(f"✅ /log-batch: {len(rows)} eventos escritos a Sheets")
            return jsonify({"ok": True, "written": len(rows)}), 200
        except gspread.exceptions.APIError as e:
            print(f"⚠️ /log-batch: APIError escribiendo {len(rows)} eventos: {e}")
            with _cache_lock:
                _sheets_cache["worksheets"].pop("events", None)
            return jsonify({"ok": False, "error": f"APIError: {e}"}), 503
        except Exception as e:
            print(f"⚠️ /log-batch: Error escribiendo {len(rows)} eventos: {type(e).__name__}: {e}")
            with _cache_lock:
                _sheets_cache["worksheets"].pop("events", None)
            return jsonify({"ok": False, "error": str(e)}), 503

    except Exception as e:
        print(f"⚠️ ERROR en /log-batch: {type(e).__name__}: {e}")
        return jsonify({"ok": False, "error": str(e)}), 503

# ENDPOINT 1c: /flush-events  → fuerza escritura de todos los eventos pendientes
@app.route("/flush-events", methods=["POST"])
def flush_events_endpoint():
    try:
        success = flush_events()
        return jsonify({"ok": True, "flushed": success}), 200
    except Exception as e:
        print(f"⚠️ ERROR en /flush-events: {type(e).__name__}: {e}")
        return jsonify({"ok": False, "error": str(e)}), 200

def _build_event_row(data):
    """Construye una fila de evento a partir del JSON recibido"""
    timestamp = data.get("ts") or datetime.utcnow().isoformat()
    payload   = data.get("payload", {})
    if not isinstance(payload, dict):
        payload = {}

    # trial_index como entero cuando es posible
    raw_trial = payload.get("trial_index", "")
    try:
        trial_index = int(raw_trial) if raw_trial != "" else ""
    except (TypeError, ValueError):
        trial_index = raw_trial

    # time_on_screen_sec como entero cuando es posible
    raw_time = payload.get("time_on_screen_seconds", "")
    try:
        time_on_screen_sec = int(raw_time) if raw_time != "" else ""
    except (TypeError, ValueError):
        time_on_screen_sec = raw_time

    element_clicked = ""
    if data.get("event") == "click" and "element" in payload:
        elem = payload.get("element", {})
        if isinstance(elem, dict):
            tag       = elem.get('tag') or ''
            elem_id   = elem.get('id') or ''
            elem_class= elem.get('class') or ''
            id_part   = f"#{elem_id}"    if elem_id    else ''
            class_part= f".{elem_class}" if elem_class else ''
            element_clicked = f"{tag}{id_part}{class_part}"

    # Serializar payload de forma segura
    try:
        payload_json = json.dumps(payload, ensure_ascii=False)
    except (TypeError, ValueError):
        payload_json = json.dumps({k: str(v) for k, v in payload.items()})

    return [
        timestamp,
        data.get("subject_id", ""),
        data.get("policy", ""),
        data.get("event", ""),
        trial_index,
        time_on_screen_sec,
        element_clicked,
        payload_json
    ]

# =============================================================
# ENDPOINT 2: /finalize  → guarda resumen final en Google Sheets
# =============================================================
@app.route("/finalize", methods=["POST"])
def finalize():
    try:
        # Validar que la petición contiene JSON
        if not request.is_json and not request.data:
            print("⚠️ ERROR en /finalize: Request no contiene JSON")
            return jsonify({"ok": False, "error": "Request debe contener JSON"}), 400

        # Parsear JSON con manejo de errores
        try:
            data = request.get_json(force=True)
        except Exception as e:
            print(f"⚠️ ERROR en /finalize: JSON inválido: {type(e).__name__}: {e}")
            return jsonify({"ok": False, "error": "JSON inválido"}), 400

        # Validar que data no sea None
        if data is None:
            print("⚠️ ERROR en /finalize: JSON parseado es None")
            return jsonify({"ok": False, "error": "JSON vacío"}), 400

        # Validar campos requeridos
        subject_id = data.get("subject_id")
        if not subject_id:
            print("⚠️ ERROR en /finalize: subject_id es requerido")
            return jsonify({"ok": False, "error": "subject_id es requerido"}), 400

        demographics = data.get("demographics", {})
        if not isinstance(demographics, dict):
            print("⚠️ ERROR en /finalize: demographics debe ser un objeto")
            demographics = {}

        results = data.get("results", {})
        if not isinstance(results, dict):
            print("⚠️ ERROR en /finalize: results debe ser un objeto")
            results = {}

        # Debug: Log task_text length y preview
        task_text = results.get("task_text", "")
        has_newlines = '\n' in task_text
        print(f"📝 Finalizando participante {subject_id}:")
        print(f"   - task_text length: {len(task_text)} caracteres")
        print(f"   - words: {results.get('words', 0)} palabras")
        print(f"   - task_text preview (primeros 100 chars): {task_text[:100] if task_text else '(vacío)'}")
        print(f"   - task_text tiene saltos de línea: {'Sí' if has_newlines else 'No'}")

        # Flush de eventos pendientes ANTES de guardar resultados
        print(f"🔄 Flushing eventos pendientes antes de finalizar...")
        flush_events()

        # Conectar con Google Sheets (usando caché)
        client = get_cached_client()
        if not client:
            print("⚠️ ERROR CRÍTICO: Google Sheets no disponible en /finalize")
            return jsonify({"ok": False, "error": "Google Sheets no configurado - datos no guardados"}), 503

        # Headers para la hoja de resultados
        # IMPORTANTE: deben coincidir EXACTAMENTE con los name= del frontend
        headers = [
            "timestamp", "subject_id", "policy",
            # Demográficos
            "dob", "sex", "studies", "grad_year", "uni", "field", "gpa",
            # Tarea
            "task_text", "words", "edit_count",
            # Métricas conductuales de IA y copy/paste (registradas automáticamente)
            "ai_chars_inserted", "paste_count", "paste_total_chars",
            # Declaración de uso de IA (autoreportado)
            "ai_generated_pct", "ai_paraphrased_pct",
            # Control
            "noticed_policy", "used_ai_button", "used_external_ai",
            # Tu entorno y la IA (Pantalla 7 — coincide con name= del form)
            "subj_norm_desc_1", "subj_norm_inj_1",
            "pbc_evasion_1", "pbc_capacity_1", "opp_perceived_1",
            "norm_clarity_1", "pressure_1", "ai_frequency",
            # Valores y motivaciones (Pantalla 7b — coincide con name= del form)
            "motiv_orient_1",
            "moral_intern_1", "moral_guilt_1", "moral_principles_1",
            "rationaliz_util_1", "rationaliz_norm_1",
            # Contacto (opcional)
            "email"
        ]
        worksheet = get_cached_worksheet(client, GOOGLE_SHEET_NAME, "results", headers)

        if not worksheet:
            print("⚠️ ERROR CRÍTICO: No se pudo obtener worksheet 'results' en /finalize")
            return jsonify({"ok": False, "error": "No se pudo acceder a la hoja de resultados"}), 503

        # Extraer datos de forma segura
        ai_usage     = results.get("ai_usage", {})     if isinstance(results.get("ai_usage"),     dict) else {}
        control      = results.get("control", {})      if isinstance(results.get("control"),      dict) else {}
        personality  = results.get("personality", {})  if isinstance(results.get("personality"),  dict) else {}
        ai_motivation= results.get("ai_motivation", {})if isinstance(results.get("ai_motivation"),dict) else {}
        edits        = results.get("edits", [])        if isinstance(results.get("edits"),        list) else []

        # Preparar fila con todos los datos (debe coincidir exactamente con headers)
        row = [
            datetime.utcnow().isoformat(),
            subject_id,
            demographics.get("policy", ""),
            # Demográficos
            demographics.get("dob", ""),
            demographics.get("sex", ""),
            demographics.get("studies", ""),
            demographics.get("grad_year", ""),
            demographics.get("uni", ""),
            demographics.get("field", ""),
            demographics.get("gpa", ""),
            # Tarea
            task_text,
            results.get("words", 0),
            len(edits),
            # Métricas conductuales
            results.get("ai_chars_inserted", 0),
            results.get("paste_count", 0),
            results.get("paste_total_chars", 0),
            # Declaración autoreportada
            ai_usage.get("generated_pct", 0),
            ai_usage.get("paraphrased_pct", 0),
            # Control
            control.get("noticed_policy", ""),
            control.get("used_ai_button", ""),
            control.get("used_external_ai", ""),
            # Tu entorno y la IA (Pantalla 7)
            personality.get("subj_norm_desc_1", ""),
            personality.get("subj_norm_inj_1", ""),
            personality.get("pbc_evasion_1", ""),
            personality.get("pbc_capacity_1", ""),
            personality.get("opp_perceived_1", ""),
            personality.get("norm_clarity_1", ""),
            personality.get("pressure_1", ""),
            personality.get("ai_frequency", ""),
            # Valores y motivaciones (Pantalla 7b)
            ai_motivation.get("motiv_orient_1", ""),
            ai_motivation.get("moral_intern_1", ""),
            ai_motivation.get("moral_guilt_1", ""),
            ai_motivation.get("moral_principles_1", ""),
            ai_motivation.get("rationaliz_util_1", ""),
            ai_motivation.get("rationaliz_norm_1", ""),
            # Contacto (opcional)
            data.get("email", "")
        ]

        # Verificar coherencia entre headers y fila antes de escribir
        if len(row) != len(headers):
            print(f"⚠️ INCONSISTENCIA en /finalize: {len(row)} valores vs {len(headers)} headers")
            return jsonify({"ok": False, "error": "Error interno: longitud de fila incorrecta"}), 500

        # Insertar con reintentos (hasta 3 intentos con backoff exponencial)
        last_error = None
        for attempt in range(3):
            try:
                worksheet.append_row(row, value_input_option='RAW')
                print(f"✅ Datos finales guardados para {subject_id} (intento {attempt+1})")
                return jsonify({"ok": True, "finalized": True}), 200
            except gspread.exceptions.APIError as e:
                last_error = str(e)
                print(f"⚠️ /finalize APIError intento {attempt+1}/3: {e}")
                with _cache_lock:
                    _sheets_cache["worksheets"].pop("results", None)
                if attempt < 2:
                    _time.sleep(2 ** attempt)  # 1s, 2s antes del 3er intento
                    worksheet = get_cached_worksheet(client, GOOGLE_SHEET_NAME, "results", headers)
                    if not worksheet:
                        last_error = "worksheet 'results' no disponible tras reintento"
                        break
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                print(f"⚠️ /finalize error intento {attempt+1}/3: {last_error}")
                if attempt < 2:
                    _time.sleep(2 ** attempt)
                    worksheet = get_cached_worksheet(client, GOOGLE_SHEET_NAME, "results", headers)
                    if not worksheet:
                        last_error = "worksheet 'results' no disponible tras reintento"
                        break

        print(f"❌ /finalize: todos los reintentos fallaron para {subject_id}: {last_error}")
        return jsonify({"ok": False, "error": f"Error guardando datos tras 3 intentos: {last_error}"}), 503

    except Exception as e:
        print(f"⚠️ ERROR CRÍTICO inesperado en /finalize: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"ok": False, "error": f"Error del servidor: {str(e)}"}), 500

# =============================================================
# ENDPOINT 3: /ai-suggest  → sugerencia de IA con OpenAI
# =============================================================
@app.route("/ai-suggest", methods=["POST"])
def ai_suggest():
    try:
        # Validar que OpenAI API Key está configurado
        if not OPENAI_API_KEY:
            print("⚠️ ERROR en /ai-suggest: OPENAI_API_KEY no configurado")
            return jsonify({"ok": False, "error": "Servicio de IA no disponible"}), 503

        # Validar que la petición contiene JSON
        if not request.is_json and not request.data:
            print("⚠️ ERROR en /ai-suggest: Request no contiene JSON")
            return jsonify({"ok": False, "error": "Request debe contener JSON"}), 400

        # Parsear JSON con manejo de errores
        try:
            data = request.get_json(force=True)
        except Exception as e:
            print(f"⚠️ ERROR en /ai-suggest: JSON inválido: {type(e).__name__}: {e}")
            return jsonify({"ok": False, "error": "JSON inválido"}), 400

        # Validar que data no sea None
        if data is None:
            print("⚠️ ERROR en /ai-suggest: JSON parseado es None")
            return jsonify({"ok": False, "error": "JSON vacío"}), 400

        text = data.get("text", "")
        selection = data.get("selection", "")
        policy = data.get("policy", "")

        # Construir prompt: devuelve fragmentos de texto listo para copiar/pegar,
        # no ideas ni sugerencias abstractas sobre qué escribir.
        system_prompt = (
            "Eres un asistente de redacción académica en español. "
            "Tu tarea es escribir fragmentos de texto concretos y listos para copiar y pegar, "
            "acordes con lo que el usuario ya ha escrito. "
            "NUNCA expliques qué podría escribir el usuario ni des consejos. "
            "SÓLO escribe el fragmento de texto directamente, como si fuera parte del texto del usuario. "
            "El fragmento debe ser natural, fluido y coherente con el texto existente."
        )
        if selection:
            # Reescribir la selección manteniendo el sentido pero mejorando la redacción
            prompt = (
                f"El usuario escribe sobre cómo sus estudios le ayudarán en el futuro. "
                f"Texto completo hasta ahora:\n\"{text[:400]}\"\n\n"
                f"Ha seleccionado esta parte para mejorarla: \"{selection}\"\n\n"
                f"Reescribe esa parte seleccionada con mejor redacción. "
                f"Devuelve SÓLO el fragmento reescrito (máximo 40 palabras), sin comillas ni explicaciones."
            )
        else:
            # Continuar el texto con un fragmento concreto
            prompt = (
                f"El usuario escribe sobre cómo sus estudios le ayudarán en el futuro. "
                f"Lo que lleva escrito hasta ahora:\n\"{text[:400]}\"\n\n"
                f"Escribe una oración o frase corta (máximo 30 palabras) que continúe o complemente "
                f"de forma natural lo que ya ha escrito. "
                f"Devuelve SÓLO el fragmento, sin comillas ni explicaciones."
            )

        # Llamar a OpenAI API con manejo robusto de errores
        try:
            openai_response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 80,
                    "temperature": 0.7
                },
                timeout=10
            )
        except requests.exceptions.Timeout:
            print("⚠️ ERROR en /ai-suggest: Timeout llamando a OpenAI API")
            return jsonify({"ok": False, "error": "Timeout - la IA tardó demasiado en responder"}), 504
        except requests.exceptions.ConnectionError as e:
            print(f"⚠️ ERROR en /ai-suggest: Error de conexión: {e}")
            return jsonify({"ok": False, "error": "Error de conexión con el servicio de IA"}), 503
        except requests.exceptions.RequestException as e:
            print(f"⚠️ ERROR en /ai-suggest: Error de red: {type(e).__name__}: {e}")
            return jsonify({"ok": False, "error": "Error de red"}), 503

        # Validar código de estado HTTP
        if openai_response.status_code == 401:
            print("⚠️ ERROR en /ai-suggest: API Key inválido (401)")
            return jsonify({"ok": False, "error": "Servicio de IA mal configurado"}), 503
        elif openai_response.status_code == 429:
            print("⚠️ ERROR en /ai-suggest: Rate limit excedido (429)")
            return jsonify({"ok": False, "error": "Límite de uso de IA excedido, intenta de nuevo más tarde"}), 429
        elif openai_response.status_code == 500:
            print("⚠️ ERROR en /ai-suggest: Error del servidor de OpenAI (500)")
            return jsonify({"ok": False, "error": "El servicio de IA está teniendo problemas"}), 503
        elif openai_response.status_code != 200:
            print(f"⚠️ ERROR en /ai-suggest: Status code {openai_response.status_code}")
            try:
                error_detail = openai_response.json()
                print(f"   Detalle: {error_detail}")
            except (ValueError, Exception):
                pass
            return jsonify({"ok": False, "error": f"Error del servicio de IA (código {openai_response.status_code})"}), 503

        # Parsear respuesta JSON
        try:
            result = openai_response.json()
        except json.JSONDecodeError as e:
            print(f"⚠️ ERROR en /ai-suggest: Respuesta de OpenAI no es JSON válido: {e}")
            return jsonify({"ok": False, "error": "Respuesta inválida del servicio de IA"}), 500

        # Validar estructura de respuesta
        if not isinstance(result, dict):
            print(f"⚠️ ERROR en /ai-suggest: Respuesta de OpenAI no es un diccionario: {type(result)}")
            return jsonify({"ok": False, "error": "Respuesta inválida del servicio de IA"}), 500

        if "choices" not in result or not isinstance(result["choices"], list) or len(result["choices"]) == 0:
            print(f"⚠️ ERROR en /ai-suggest: Respuesta de OpenAI sin 'choices': {result}")
            return jsonify({"ok": False, "error": "Respuesta incompleta del servicio de IA"}), 500

        if "message" not in result["choices"][0] or "content" not in result["choices"][0]["message"]:
            print(f"⚠️ ERROR en /ai-suggest: Respuesta de OpenAI sin 'content': {result['choices'][0]}")
            return jsonify({"ok": False, "error": "Respuesta incompleta del servicio de IA"}), 500

        suggestion = result["choices"][0]["message"]["content"].strip()

        if not suggestion:
            print("⚠️ WARNING en /ai-suggest: OpenAI devolvió sugerencia vacía")
            return jsonify({"ok": False, "error": "El servicio de IA no pudo generar una sugerencia"}), 500

        return jsonify({"ok": True, "suggestion": suggestion}), 200

    except Exception as e:
        print(f"⚠️ ERROR inesperado en /ai-suggest: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"ok": False, "error": "Error del servidor"}), 500

# =============================================================
# SERVIR ARCHIVOS ESTÁTICOS
# =============================================================
@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def serve_static(path):
    """Sirve archivos estáticos desde la carpeta public/"""
    try:
        # Validación de seguridad: evitar path traversal
        # Normalizar el path para eliminar .. y otros intentos de escape
        normalized_path = os.path.normpath(path)

        # Verificar que el path no intenta escapar del directorio público
        if normalized_path.startswith('..') or normalized_path.startswith('/'):
            print(f"⚠️ SEGURIDAD: Intento de acceso fuera de public/: {path}")
            return "Acceso denegado", 403

        # Usar send_from_directory que ya tiene protecciones contra path traversal
        return send_from_directory('public', normalized_path)
    except FileNotFoundError:
        print(f"⚠️ Archivo no encontrado: {path}")
        return f"Archivo no encontrado: {path}", 404
    except PermissionError:
        print(f"⚠️ Permiso denegado al acceder a: {path}")
        return "Acceso denegado", 403
    except Exception as e:
        print(f"⚠️ Error inesperado sirviendo {path}: {type(e).__name__}: {e}")
        return "Error del servidor", 500

# =============================================================
# EJECUCIÓN LOCAL (solo si corres manualmente)
# =============================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

