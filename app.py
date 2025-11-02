# =============================================================
# Shadow AI — Backend Flask conectado a Supabase (v1.0)
# =============================================================

import os, json, requests
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI

# =============================================================
# CONFIGURACIÓN — VARIABLES DE ENTORNO
# =============================================================
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Inicializar cliente de OpenAI
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# No toques lo de abajo
SUPABASE_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json"
}

# =============================================================
# INICIALIZAR FLASK
# =============================================================
app = Flask(__name__)
CORS(app)

# =============================================================
# ENDPOINT 1: /save  → guarda cada evento (antes /log)
# =============================================================
@app.route("/save", methods=["POST"])
@app.route("/log", methods=["POST"])  # Alias para compatibilidad
def log_event():
    """
    Endpoint para guardar eventos del experimento en Supabase.

    Request body esperado:
    {
      "subject_id": "S-ABC123",
      "policy": "permisiva" | "difusa" | "restrictiva",
      "event": "screen_enter" | "screen_leave" | "click" | etc.,
      "ts": "2025-11-02T12:34:56.789Z",
      "payload": { ... datos específicos del evento ... }
    }
    """
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
# ENDPOINT 3: /assist  → llama a OpenAI para generar sugerencias
# =============================================================
@app.route("/assist", methods=["POST"])
def assist():
    """
    Endpoint que llama a OpenAI para generar sugerencias de escritura.

    Request body esperado:
    {
      "subject_id": "S-ABC123",
      "policy": "permisiva" | "difusa" | "restrictiva",
      "text": "texto actual del usuario",
      "selection": "texto seleccionado (opcional)"
    }

    Response:
    {
      "ok": true,
      "suggestions": ["sugerencia 1", "sugerencia 2", ...],
      "model": "gpt-4o-mini",
      "tokens": 150
    }
    """
    try:
        # Validar que OpenAI esté configurado
        if not openai_client:
            return jsonify({
                "ok": False,
                "error": "OpenAI no está configurado. Verifica OPENAI_API_KEY."
            }), 500

        # Extraer datos del request
        data = request.get_json(force=True)
        subject_id = data.get("subject_id", "unknown")
        policy = data.get("policy", "permisiva")
        text = data.get("text", "")
        selection = data.get("selection", "")

        # Construir prompt según la política
        system_prompt = """Eres un asistente de escritura académica.
Ayuda al usuario a mejorar su texto proporcionando sugerencias concretas y accionables.
Devuelve exactamente 4 sugerencias breves (máximo 15 palabras cada una)."""

        user_prompt = f"""Texto actual: {text[:500]}
{"Texto seleccionado: " + selection if selection else ""}

Proporciona 4 sugerencias específicas para mejorar este texto académico."""

        # Llamar a OpenAI
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",  # Modelo económico y rápido
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=300,
            temperature=0.7
        )

        # Extraer sugerencias del response
        raw_text = response.choices[0].message.content
        suggestions = [line.strip("- ").strip()
                      for line in raw_text.split("\n")
                      if line.strip() and len(line.strip()) > 10][:4]

        # Si no se generaron 4, rellenar con sugerencias genéricas
        if len(suggestions) < 4:
            fallback = [
                "Añade ejemplos concretos para ilustrar tu punto.",
                "Conecta tus ideas con el contexto social actual.",
                "Concluye resumiendo tu aportación principal.",
                "Revisa la claridad de tus frases principales."
            ]
            suggestions.extend(fallback[:(4 - len(suggestions))])

        # Registrar en Supabase (tabla events)
        try:
            log_payload = {
                "subject_id": subject_id,
                "policy": policy,
                "event": "ai_assist_request",
                "ts": datetime.utcnow().isoformat(),
                "payload": {
                    "text_len": len(text),
                    "selection_len": len(selection),
                    "model": "gpt-4o-mini",
                    "tokens": response.usage.total_tokens
                }
            }
            requests.post(
                f"{SUPABASE_URL}/rest/v1/shadowai.events",
                headers=SUPABASE_HEADERS,
                data=json.dumps(log_payload)
            )
        except Exception as log_err:
            print("⚠️ Error al registrar en Supabase:", log_err)

        return jsonify({
            "ok": True,
            "suggestions": suggestions,
            "model": "gpt-4o-mini",
            "tokens": response.usage.total_tokens
        }), 200

    except Exception as e:
        print("⚠️ Error en /assist:", e)
        return jsonify({"ok": False, "error": str(e)}), 500

# =============================================================
# ENDPOINT 4: /health  → health check para Render
# =============================================================
@app.route("/health", methods=["GET"])
def health():
    """
    Endpoint de health check para monitores de Render y otros servicios.
    Verifica que el servidor esté activo y las variables estén configuradas.
    """
    status = {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY),
        "openai_configured": bool(OPENAI_API_KEY)
    }
    return jsonify(status), 200

# =============================================================
# RAÍZ: mensaje de estado
# =============================================================
@app.route("/")
def home():
    return "✅ Shadow AI backend activo y conectado a Supabase."

# =============================================================
# EJECUCIÓN LOCAL (solo si corres manualmente)
# =============================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

