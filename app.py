# app.py
# Backend Flask sencillo para registrar eventos (/log) y cierre (/finalize)
# Sirve archivos estáticos desde /public. NO usa ninguna clave de API.

import os, csv
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)  # permite que el frontend (misma URL o localhost) llame al backend

# ---------- Rutas de frontend (estático) ----------
@app.route('/')
def root():
    # Sirve index.html desde /public
    return send_from_directory(app.static_folder, 'index.html')

# ---------- API: registrar eventos de la sesión ----------
@app.route('/log', methods=['POST'])
def log_event():
    data = request.get_json(force=True, silent=True) or {}
    # Campos típicos: subject_id, event, payload (dict), ts
    subject_id = data.get('subject_id', 'unknown')
    event = data.get('event', 'unknown')
    payload = data.get('payload', {})
    ts = data.get('ts') or datetime.utcnow().isoformat()

    file_path = os.path.join(LOG_DIR, 'events.csv')
    write_header = not os.path.exists(file_path)

    with open(file_path, 'a', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['ts', 'subject_id', 'event', 'payload'])
        if write_header:
            writer.writeheader()
        writer.writerow({
            'ts': ts,
            'subject_id': subject_id,
            'event': event,
            'payload': str(payload)
        })
    return jsonify({'ok': True})

# ---------- API: finalizar experimento ----------
@app.route('/finalize', methods=['POST'])
def finalize():
    data = request.get_json(force=True, silent=True) or {}
    # Espera un resumen de la sesión (subject_id, demographics, results...)
    subject_id = data.get('subject_id', 'unknown')
    demographics = data.get('demographics', {})
    results = data.get('results', {})
    ts = datetime.utcnow().isoformat()

    file_path = os.path.join(LOG_DIR, 'final.csv')
    write_header = not os.path.exists(file_path)

    with open(file_path, 'a', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(
            f,
            fieldnames=['ts', 'subject_id', 'demographics', 'results']
        )
        if write_header:
            writer.writeheader()
        writer.writerow({
            'ts': ts,
            'subject_id': subject_id,
            'demographics': str(demographics),
            'results': str(results)
        })
    return jsonify({'ok': True})

# ---------- Ejecutar localmente (opcional) ----------
if __name__ == '__main__':
    # Para ejecutar local: python app.py  (requiere tener Python y paquetes instalados)
    app.run(host='0.0.0.0', port=5000, debug=True)
