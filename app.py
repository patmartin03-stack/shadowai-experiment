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
# INICIALIZAR GOOGLE SHEETS
# =============================================================
def get_google_sheets_client():
    """Conectar con Google Sheets usando credenciales de servicio"""
    try:
        if not GOOGLE_SHEETS_CREDENTIALS:
            print("⚠️ GOOGLE_SHEETS_CREDENTIALS no configurado")
            return None

        # Parsear credenciales desde variable de entorno
        creds_dict = json.loads(GOOGLE_SHEETS_CREDENTIALS)

        # Crear credenciales
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        credentials = Credentials.from_service_account_info(creds_dict, scopes=scopes)

        # Conectar con Google Sheets
        client = gspread.authorize(credentials)
        return client
    except Exception as e:
        print(f"⚠️ Error conectando con Google Sheets: {e}")
        return None

def get_or_create_worksheet(client, sheet_name, worksheet_name, headers):
    """Obtener o crear una hoja de trabajo con los encabezados especificados"""
    try:
        # Abrir o crear el spreadsheet
        try:
            spreadsheet = client.open(sheet_name)
        except gspread.exceptions.SpreadsheetNotFound:
            spreadsheet = client.create(sheet_name)
            print(f"✅ Creado nuevo Google Sheet: {sheet_name}")

        # Abrir o crear la worksheet
        try:
            worksheet = spreadsheet.worksheet(worksheet_name)
        except gspread.exceptions.WorksheetNotFound:
            worksheet = spreadsheet.add_worksheet(title=worksheet_name, rows=1000, cols=len(headers))
            worksheet.append_row(headers)
            print(f"✅ Creada nueva hoja: {worksheet_name}")

        return worksheet
    except Exception as e:
        print(f"⚠️ Error obteniendo worksheet {worksheet_name}: {e}")
        return None

# =============================================================
# INICIALIZAR FLASK
# =============================================================
app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)

# =============================================================
# RUTAS API (deben ir ANTES de las rutas estáticas)
# =============================================================

# ENDPOINT 1: /log  → guarda cada evento en Google Sheets
@app.route("/log", methods=["POST"])
def log_event():
    try:
        data = request.get_json(force=True)
        timestamp = data.get("ts") or datetime.utcnow().isoformat()

        # Conectar con Google Sheets
        client = get_google_sheets_client()
        if not client:
            print("⚠️ Google Sheets no disponible, evento no guardado")
            return jsonify({"ok": True, "inserted": False, "note": "Google Sheets no configurado"}), 200

        # Headers para la hoja de eventos
        headers = ["timestamp", "subject_id", "policy", "event", "payload_json"]
        worksheet = get_or_create_worksheet(client, GOOGLE_SHEET_NAME, "events", headers)

        if not worksheet:
            return jsonify({"ok": False, "error": "No se pudo acceder a la hoja"}), 500

        # Preparar fila
        row = [
            timestamp,
            data.get("subject_id", ""),
            data.get("policy", ""),
            data.get("event", ""),
            json.dumps(data.get("payload", {}))
        ]

        # Insertar fila
        worksheet.append_row(row, value_input_option='RAW')

        return jsonify({"ok": True, "inserted": True}), 200
    except Exception as e:
        print("⚠️ Error en /log:", e)
        # No fallar el experimento si Google Sheets falla
        return jsonify({"ok": True, "inserted": False, "error": str(e)}), 200

# =============================================================
# ENDPOINT 2: /finalize  → guarda resumen final en Google Sheets
# =============================================================
@app.route("/finalize", methods=["POST"])
def finalize():
    try:
        data = request.get_json(force=True)
        subject_id = data.get("subject_id")
        demographics = data.get("demographics", {})
        results = data.get("results", {})

        # Conectar con Google Sheets
        client = get_google_sheets_client()
        if not client:
            print("⚠️ Google Sheets no disponible, resultados no guardados")
            return jsonify({"ok": True, "finalized": False, "note": "Google Sheets no configurado"}), 200

        # Headers para la hoja de resultados
        headers = [
            "timestamp", "subject_id", "policy",
            # Demográficos
            "dob", "studies", "grad_year", "uni", "field", "city", "gpa",
            # Tarea
            "task_text", "words", "edit_count",
            # Uso de IA
            "ai_generated_pct", "ai_paraphrased_pct",
            # Control
            "noticed_policy", "used_ai_button", "used_external_ai",
            # Personalidad
            "personality_q1", "personality_q2", "personality_q3"
        ]
        worksheet = get_or_create_worksheet(client, GOOGLE_SHEET_NAME, "results", headers)

        if not worksheet:
            return jsonify({"ok": False, "error": "No se pudo acceder a la hoja"}), 500

        # Preparar fila con todos los datos
        row = [
            datetime.utcnow().isoformat(),
            subject_id,
            demographics.get("policy", ""),
            # Demográficos
            demographics.get("dob", ""),
            demographics.get("studies", ""),
            demographics.get("grad_year", ""),
            demographics.get("uni", ""),
            demographics.get("field", ""),
            demographics.get("city", ""),
            demographics.get("gpa", ""),
            # Tarea
            results.get("task_text", ""),
            results.get("words", 0),
            len(results.get("edits", [])),
            # Uso de IA
            results.get("ai_usage", {}).get("generated_pct", 0),
            results.get("ai_usage", {}).get("paraphrased_pct", 0),
            # Control
            results.get("control", {}).get("noticed_policy", ""),
            results.get("control", {}).get("used_ai_button", ""),
            results.get("control", {}).get("used_external_ai", ""),
            # Personalidad
            results.get("personality", {}).get("q1", ""),
            results.get("personality", {}).get("q2", ""),
            results.get("personality", {}).get("q3", "")
        ]

        # Insertar fila
        worksheet.append_row(row, value_input_option='RAW')

        return jsonify({"ok": True, "finalized": True}), 200
    except Exception as e:
        print("⚠️ Error en /finalize:", e)
        # No fallar el experimento si Google Sheets falla
        return jsonify({"ok": True, "finalized": False, "error": str(e)}), 200

# =============================================================
# ENDPOINT 3: /ai-suggest  → sugerencia de IA con OpenAI
# =============================================================
@app.route("/ai-suggest", methods=["POST"])
def ai_suggest():
    try:
        data = request.get_json(force=True)
        text = data.get("text", "")
        selection = data.get("selection", "")
        policy = data.get("policy", "")

        # Construir prompt basado en contexto
        if selection:
            prompt = f"El usuario está escribiendo sobre cómo sus estudios le ayudarán en el futuro. Ha seleccionado este texto: '{selection}'. Proporciona una sugerencia breve (máximo 20 palabras) para mejorar o reescribir esta parte. Responde solo con la sugerencia, sin explicaciones adicionales."
        else:
            prompt = f"El usuario está escribiendo sobre cómo sus estudios le ayudarán en el futuro. Lleva escrito esto hasta ahora: '{text[:200]}...'. Proporciona una sugerencia breve (máximo 20 palabras) de qué podría añadir para enriquecer el texto. Responde solo con la sugerencia, sin explicaciones adicionales."

        # Llamar a OpenAI API
        openai_response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-3.5-turbo",
                "messages": [
                    {"role": "system", "content": "Eres un asistente de escritura académica. Das sugerencias breves y útiles."},
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": 100,
                "temperature": 0.7
            },
            timeout=10
        )
        openai_response.raise_for_status()

        result = openai_response.json()
        suggestion = result["choices"][0]["message"]["content"].strip()

        return jsonify({"ok": True, "suggestion": suggestion}), 200

    except requests.exceptions.Timeout:
        return jsonify({"ok": False, "error": "OpenAI timeout"}), 504
    except Exception as e:
        print("⚠️ Error en /ai-suggest:", e)
        return jsonify({"ok": False, "error": str(e)}), 500

# =============================================================
# SERVIR ARCHIVOS ESTÁTICOS
# =============================================================
@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def serve_static(path):
    """Sirve archivos estáticos desde la carpeta public/"""
    try:
        return send_from_directory('public', path)
    except Exception as e:
        print(f"⚠️ Error sirviendo {path}:", e)
        # Si el archivo no existe, devolver 404
        return f"Archivo no encontrado: {path}", 404

# =============================================================
# EJECUCIÓN LOCAL (solo si corres manualmente)
# =============================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

