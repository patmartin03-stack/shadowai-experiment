# =============================================================
# Shadow AI — Backend Flask conectado a Supabase (v1.0)
# =============================================================

import os, json, requests
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# =============================================================
# CONFIGURACIÓN — PON AQUÍ TUS VARIABLES DE SUPABASE
# =============================================================
import os

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# No toques lo de abajo
SUPABASE_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json"
}

# =============================================================
# INICIALIZAR FLASK
# =============================================================
app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)

# =============================================================
# RUTAS API (deben ir ANTES de las rutas estáticas)
# =============================================================

# ENDPOINT 1: /log  → guarda cada evento
@app.route("/log", methods=["POST"])
def log_event():
    try:
        data = request.get_json(force=True)
        data["ts"] = data.get("ts") or datetime.utcnow().isoformat()

        payload = {
            "subject_id": data.get("subject_id"),
            "policy": data.get("policy"),
            "event": data.get("event"),
            "ts": data["ts"],
            "trial_type": data.get("payload", {}).get("trial_type"),
            "rt_ms": data.get("payload", {}).get("rt_ms"),
            "clicks": data.get("payload", {}).get("clicks"),
            "idle_ms": data.get("payload", {}).get("idle_ms"),
            "suggestion_index": data.get("payload", {}).get("suggestion_index"),
            "selection_chars": data.get("payload", {}).get("selection_chars"),
            "words": data.get("payload", {}).get("words"),
            "text_len": data.get("payload", {}).get("text_len"),
            "payload": data.get("payload", {}),
        }

        # Inserta en shadowai.events
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/shadowai.events",
            headers=SUPABASE_HEADERS,
            data=json.dumps(payload)
        )
        r.raise_for_status()

        return jsonify({"ok": True, "inserted": True}), 200
    except Exception as e:
        print("⚠️ Error en /log:", e)
        return jsonify({"ok": False, "error": str(e)}), 500

# =============================================================
# ENDPOINT 2: /finalize  → guarda resumen final + demografía
# =============================================================
@app.route("/finalize", methods=["POST"])
def finalize():
    try:
        data = request.get_json(force=True)
        subject_id = data.get("subject_id")
        demographics = data.get("demographics", {})
        results = data.get("results", {})

        # 1️⃣ Actualizar o insertar participante
        participant_payload = {
            "subject_id": subject_id,
            "policy": demographics.get("policy"),
            "dob": demographics.get("dob"),
            "studies": demographics.get("studies"),
            "grad_year": demographics.get("grad_year"),
            "uni": demographics.get("uni"),
            "field": demographics.get("field"),
            "city": demographics.get("city"),
            "gpa": demographics.get("gpa"),
            "raw_demographics": demographics,
            "last_seen": datetime.utcnow().isoformat()
        }

        requests.post(
            f"{SUPABASE_URL}/rest/v1/shadowai.participants",
            headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
            data=json.dumps(participant_payload)
        )

        # 2️⃣ Insertar resultado final
        results_payload = {
            "subject_id": subject_id,
            "policy": demographics.get("policy"),
            "task_text": results.get("task_text"),
            "words": results.get("words"),
            "edit_count": len(results.get("edits", [])),
            "control_noticed_policy": results.get("control", {}).get("noticed_policy"),
            "control_used_ai_button": results.get("control", {}).get("used_ai_button"),
            "control_used_external_ai": results.get("control", {}).get("used_external_ai"),
            "control": results.get("control"),
            "personality_q1": results.get("personality", {}).get("q1"),
            "personality_q2": results.get("personality", {}).get("q2"),
            "personality_q3": results.get("personality", {}).get("q3"),
            "personality": results.get("personality"),
            "edits": results.get("edits"),
            "demographics": demographics
        }

        r2 = requests.post(
            f"{SUPABASE_URL}/rest/v1/shadowai.results",
            headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
            data=json.dumps(results_payload)
        )
        r2.raise_for_status()

        return jsonify({"ok": True, "finalized": True}), 200
    except Exception as e:
        print("⚠️ Error en /finalize:", e)
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

