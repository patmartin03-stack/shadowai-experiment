# =============================================================
# Shadow AI — Backend Flask con Google Sheets (v2.0)
# =============================================================

import os, json, requests
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import gspread
from google.oauth2.service_account import Credentials

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

        # Crear credenciales
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        try:
            credentials = Credentials.from_service_account_info(creds_dict, scopes=scopes)
        except ValueError as e:
            print(f"⚠️ ERROR: Credenciales de servicio inválidas: {e}")
            return None
        except Exception as e:
            print(f"⚠️ ERROR: Error creando credenciales: {type(e).__name__}: {e}")
            return None

        # Conectar con Google Sheets (gspread 6+: usar Client(auth=) en lugar de authorize())
        try:
            client = gspread.Client(auth=credentials)
            return client
        except Exception as e:
            print(f"⚠️ ERROR: Error autorizando con Google Sheets: {type(e).__name__}: {e}")
            return None

    except Exception as e:
        print(f"⚠️ ERROR inesperado conectando con Google Sheets: {type(e).__name__}: {e}")
        return None

def get_or_create_worksheet(client, sheet_name, worksheet_name, headers):
    """Obtener o crear una hoja de trabajo con los encabezados especificados"""
    if not client:
        print(f"⚠️ ERROR: Cliente de Google Sheets es None, no se puede acceder a worksheet {worksheet_name}")
        return None

    try:
        # Abrir o crear el spreadsheet
        try:
            spreadsheet = client.open(sheet_name)
        except gspread.exceptions.SpreadsheetNotFound:
            try:
                spreadsheet = client.create(sheet_name)
                print(f"✅ Creado nuevo Google Sheet: {sheet_name}")
            except gspread.exceptions.APIError as e:
                print(f"⚠️ ERROR: Error de API al crear spreadsheet '{sheet_name}': {e}")
                return None
            except Exception as e:
                print(f"⚠️ ERROR: No se pudo crear spreadsheet '{sheet_name}': {type(e).__name__}: {e}")
                return None
        except gspread.exceptions.APIError as e:
            print(f"⚠️ ERROR: Error de API al abrir spreadsheet '{sheet_name}': {e}")
            return None
        except Exception as e:
            print(f"⚠️ ERROR: No se pudo abrir spreadsheet '{sheet_name}': {type(e).__name__}: {e}")
            return None

        # Abrir o crear la worksheet
        worksheet_exists = False
        try:
            worksheet = spreadsheet.worksheet(worksheet_name)
            worksheet_exists = True
        except gspread.exceptions.WorksheetNotFound:
            try:
                worksheet = spreadsheet.add_worksheet(title=worksheet_name, rows=1000, cols=len(headers))
                # Usar update para poner headers específicamente en la fila 1
                worksheet.update([headers], 'A1', value_input_option='RAW')
                print(f"✅ Creada nueva hoja: {worksheet_name} con encabezados")
                return worksheet
            except gspread.exceptions.APIError as e:
                print(f"⚠️ ERROR: Error de API al crear worksheet '{worksheet_name}': {e}")
                return None
            except Exception as e:
                print(f"⚠️ ERROR: No se pudo crear worksheet '{worksheet_name}': {type(e).__name__}: {e}")
                return None
        except gspread.exceptions.APIError as e:
            print(f"⚠️ ERROR: Error de API al acceder a worksheet '{worksheet_name}': {e}")
            return None
        except Exception as e:
            print(f"⚠️ ERROR: No se pudo acceder a worksheet '{worksheet_name}': {type(e).__name__}: {e}")
            return None

        # Si la worksheet ya existía, verificar que tenga encabezados
        if worksheet_exists:
            try:
                # Verificar si la primera fila está vacía o no coincide con los headers esperados
                first_row = worksheet.row_values(1)

                print(f"🔍 Verificando worksheet '{worksheet_name}':")
                print(f"   - Primera fila actual: {first_row[:3] if first_row else '(vacía)'}...")
                print(f"   - Headers esperados: {headers[:3]}...")

                if not first_row or all(cell == '' for cell in first_row) or first_row != headers:
                    # La primera fila está vacía o los headers no coinciden
                    print(f"⚠️ WARNING: Worksheet '{worksheet_name}' necesita encabezados")

                    # Usar update para escribir ESPECÍFICAMENTE en la fila 1
                    try:
                        worksheet.update([headers], 'A1', value_input_option='RAW')
                        print(f"✅ Encabezados actualizados en fila 1 de '{worksheet_name}'")
                    except Exception as update_error:
                        print(f"⚠️ ERROR actualizando headers: {type(update_error).__name__}: {update_error}")
                else:
                    print(f"✅ Hoja '{worksheet_name}' ya tiene encabezados correctos")

            except gspread.exceptions.APIError as e:
                print(f"⚠️ WARNING: No se pudo verificar encabezados de '{worksheet_name}': {e}")
                # Continuar de todos modos
            except Exception as e:
                print(f"⚠️ WARNING: Error verificando encabezados de '{worksheet_name}': {type(e).__name__}: {e}")
                # Continuar de todos modos

        return worksheet

    except Exception as e:
        print(f"⚠️ ERROR inesperado obteniendo worksheet '{worksheet_name}': {type(e).__name__}: {e}")
        return None

# =============================================================
# FUNCIONES AUXILIARES PARA GOOGLE SHEETS
# =============================================================
def sanitize_for_sheets(value):
    """
    Sanitiza un valor para Google Sheets, preservando el contenido pero evitando problemas de formato.
    - Convierte None a string vacío
    - Convierte números y booleanos a su representación de string
    - Para strings, preserva saltos de línea y caracteres especiales
    """
    if value is None:
        return ""
    if isinstance(value, (int, float, bool)):
        return value  # Google Sheets maneja estos nativamente
    if not isinstance(value, str):
        return str(value)

    # Para strings, retornar tal cual - Google Sheets API maneja el escaping automáticamente
    return value

# =============================================================
# CACHÉ DE GOOGLE SHEETS (evita reconectar en cada request)
# =============================================================
_sheets_cache = {
    "client": None,
    "worksheets": {},         # worksheet_name → worksheet object
    "last_auth": 0,           # timestamp de última autenticación exitosa
    "last_auth_failure": 0    # timestamp del último fallo de autenticación
}
import time as _time

AUTH_TTL = 300           # Reautenticar cada 5 minutos
AUTH_FAILURE_COOLDOWN = 60  # Esperar 60s antes de reintentar tras fallo de auth

def get_cached_client():
    """Obtiene cliente de Google Sheets con caché (evita autenticar en cada request)"""
    now = _time.time()

    # Cooldown tras fallo de auth: no bombardear la API si las credenciales fallan
    if (_sheets_cache["last_auth_failure"] > 0 and
            (now - _sheets_cache["last_auth_failure"]) < AUTH_FAILURE_COOLDOWN):
        return _sheets_cache["client"]  # None si no hay cliente válido todavía

    # Cliente válido y TTL no vencido
    if _sheets_cache["client"] and (now - _sheets_cache["last_auth"]) < AUTH_TTL:
        return _sheets_cache["client"]

    client = get_google_sheets_client()
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
    """Obtiene worksheet con caché para evitar abrir/verificar en cada request"""
    if worksheet_name in _sheets_cache["worksheets"]:
        return _sheets_cache["worksheets"][worksheet_name]
    ws = get_or_create_worksheet(client, sheet_name, worksheet_name, headers)
    if ws:
        _sheets_cache["worksheets"][worksheet_name] = ws
    return ws

# =============================================================
# COLA DE EVENTOS PENDIENTES (batch insert)
# =============================================================
import threading

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
    acquired = _flush_lock.acquire(blocking=True, timeout=25)
    if not acquired:
        print("⚠️ flush_events: timeout esperando lock, omitiendo este ciclo")
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
            _sheets_cache["worksheets"].pop("events", None)
            return False
        except Exception as e:
            print(f"⚠️ flush_events: error insertando {len(batch)} eventos: {type(e).__name__}: {e}")
            with _events_lock:
                _events_queue[:0] = batch
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

# ENDPOINT 1b: /log-batch  → recibe múltiples eventos de golpe
@app.route("/log-batch", methods=["POST"])
def log_batch():
    try:
        if not request.is_json and not request.data:
            return jsonify({"ok": True, "queued": 0}), 200

        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({"ok": True, "queued": 0, "error": "JSON inválido"}), 200

        events = data if isinstance(data, list) else data.get("events", [])
        if not events:
            return jsonify({"ok": True, "queued": 0}), 200

        rows = [_build_event_row(evt) for evt in events if isinstance(evt, dict)]

        with _events_lock:
            _events_queue.extend(rows)
            queue_size = len(_events_queue)

        print(f"📊 /log-batch encolados: {len(rows)} eventos, cola total={queue_size}")

        # Flush inmediato
        threading.Thread(target=flush_events, daemon=True).start()

        return jsonify({"ok": True, "queued": len(rows)}), 200

    except Exception as e:
        print(f"⚠️ ERROR en /log-batch: {type(e).__name__}: {e}")
        return jsonify({"ok": True, "queued": 0, "error": str(e)}), 200

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
            # Personalidad (Sobre tu forma de trabajar)
            "personality_q1", "personality_q2", "personality_q3",
            # Actitudes hacia la IA (Qué piensas de la IA)
            "ai_overconfidence_1", "ai_overconfidence_2",
            "ai_norm_internalization_1", "ai_norm_internalization_2",
            "ai_reference_group_1", "ai_reference_group_2",
            "ai_peer_group_1", "ai_peer_group_2"
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
            # Personalidad
            personality.get("q1", ""),
            personality.get("q2", ""),
            personality.get("q3", ""),
            # Actitudes hacia la IA
            ai_motivation.get("overconfidence_1", ""),
            ai_motivation.get("overconfidence_2", ""),
            ai_motivation.get("norm_internalization_1", ""),
            ai_motivation.get("norm_internalization_2", ""),
            ai_motivation.get("reference_group_1", ""),
            ai_motivation.get("reference_group_2", ""),
            ai_motivation.get("peer_group_1", ""),
            ai_motivation.get("peer_group_2", "")
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
                _sheets_cache["worksheets"].pop("results", None)
                if attempt < 2:
                    _time.sleep(2 ** attempt)  # 1s, 2s antes del 3er intento
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                print(f"⚠️ /finalize error intento {attempt+1}/3: {last_error}")
                if attempt < 2:
                    _time.sleep(2 ** attempt)

        print(f"❌ /finalize: todos los reintentos fallaron para {subject_id}: {last_error}")
        return jsonify({"ok": False, "error": f"Error guardando datos tras 3 intentos: {last_error}"}), 503

    except Exception as e:
        print(f"⚠️ ERROR CRÍTICO inesperado en /finalize: {type(e).__name__}: {e}")
        import traceback
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

        # Construir prompt basado en contexto
        if selection:
            prompt = f"El usuario está escribiendo sobre cómo sus estudios le ayudarán en el futuro. Ha seleccionado este texto: '{selection}'. Proporciona una sugerencia breve (máximo 20 palabras) para mejorar o reescribir esta parte. Responde solo con la sugerencia, sin explicaciones adicionales."
        else:
            prompt = f"El usuario está escribiendo sobre cómo sus estudios le ayudarán en el futuro. Lleva escrito esto hasta ahora: '{text[:200]}...'. Proporciona una sugerencia breve (máximo 20 palabras) de qué podría añadir para enriquecer el texto. Responde solo con la sugerencia, sin explicaciones adicionales."

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
                        {"role": "system", "content": "Eres un asistente de escritura académica. Das sugerencias breves y útiles."},
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 100,
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
        import traceback
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
        import os.path
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

