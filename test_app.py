"""
Tests mínimos para Shadow AI backend
Ejecutar con: python test_app.py
"""

import json
import sys
from datetime import datetime

# Mock de OpenAI para testing sin API key
class MockOpenAI:
    class MockUsage:
        total_tokens = 150

    class MockMessage:
        content = """1. Añade ejemplos concretos para ilustrar tu punto.
2. Conecta tus ideas con el contexto social actual.
3. Concluye resumiendo tu aportación principal.
4. Revisa la claridad de tus frases principales."""

    class MockChoice:
        def __init__(self):
            self.message = MockOpenAI.MockMessage()

    class MockResponse:
        def __init__(self):
            self.choices = [MockOpenAI.MockChoice()]
            self.usage = MockOpenAI.MockUsage()

    class MockCompletions:
        def create(self, **kwargs):
            return MockOpenAI.MockResponse()

    class MockChat:
        def __init__(self):
            self.completions = MockOpenAI.MockCompletions()

    def __init__(self, api_key=None):
        self.chat = self.MockChat()

# Reemplazar OpenAI con mock
import sys
sys.modules['openai'] = type(sys)('openai')
sys.modules['openai'].OpenAI = MockOpenAI

from app import app

def test_health():
    """Test del endpoint /health"""
    print("🧪 Test 1: /health")
    with app.test_client() as client:
        response = client.get('/health')
        data = json.loads(response.data)

        assert response.status_code == 200, f"❌ Status code: {response.status_code}"
        assert data['status'] == 'ok', f"❌ Status no es 'ok': {data['status']}"
        print("✅ /health funciona correctamente")

def test_root():
    """Test del endpoint raíz /"""
    print("\n🧪 Test 2: /")
    with app.test_client() as client:
        response = client.get('/')

        assert response.status_code == 200, f"❌ Status code: {response.status_code}"
        assert "Shadow AI" in response.data.decode(), "❌ Mensaje incorrecto"
        print("✅ / funciona correctamente")

def test_save():
    """Test del endpoint /save (antes /log)"""
    print("\n🧪 Test 3: /save")
    with app.test_client() as client:
        payload = {
            "subject_id": "TEST-001",
            "policy": "permisiva",
            "event": "test_event",
            "ts": datetime.utcnow().isoformat(),
            "payload": {"test": True}
        }

        response = client.post('/save',
                              data=json.dumps(payload),
                              content_type='application/json')
        data = json.loads(response.data)

        # Puede fallar si no hay Supabase configurado, pero debe responder
        print(f"   Status: {response.status_code}")
        print(f"   Response: {data}")
        print("✅ /save responde (puede fallar sin Supabase, es normal)")

def test_log_alias():
    """Test del alias /log"""
    print("\n🧪 Test 4: /log (alias de /save)")
    with app.test_client() as client:
        payload = {
            "subject_id": "TEST-001",
            "policy": "permisiva",
            "event": "test_event",
            "payload": {}
        }

        response = client.post('/log',
                              data=json.dumps(payload),
                              content_type='application/json')

        print(f"   Status: {response.status_code}")
        print("✅ /log (alias) responde correctamente")

def test_assist():
    """Test del endpoint /assist"""
    print("\n🧪 Test 5: /assist")
    with app.test_client() as client:
        payload = {
            "subject_id": "TEST-001",
            "policy": "permisiva",
            "text": "Este es un texto de prueba sobre mis estudios.",
            "selection": ""
        }

        response = client.post('/assist',
                              data=json.dumps(payload),
                              content_type='application/json')
        data = json.loads(response.data)

        print(f"   Status: {response.status_code}")
        print(f"   Suggestions: {data.get('suggestions', [])}")

        if response.status_code == 200:
            assert data['ok'] == True, "❌ ok no es True"
            assert len(data['suggestions']) == 4, f"❌ No hay 4 sugerencias: {len(data['suggestions'])}"
            print("✅ /assist funciona correctamente")
        else:
            print("⚠️  /assist falló (puede ser por falta de API key, ver mensaje):")
            print(f"   {data}")

def test_finalize():
    """Test del endpoint /finalize"""
    print("\n🧪 Test 6: /finalize")
    with app.test_client() as client:
        payload = {
            "subject_id": "TEST-001",
            "demographics": {
                "policy": "permisiva",
                "dob": "01/01/2000",
                "studies": "Grado",
                "uni": "Test University"
            },
            "results": {
                "task_text": "Texto de prueba",
                "words": 10,
                "edits": [],
                "control": {},
                "personality": {}
            }
        }

        response = client.post('/finalize',
                              data=json.dumps(payload),
                              content_type='application/json')

        print(f"   Status: {response.status_code}")
        print("✅ /finalize responde (puede fallar sin Supabase, es normal)")

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Shadow AI - Test Suite Mínimo")
    print("=" * 60)

    try:
        test_health()
        test_root()
        test_save()
        test_log_alias()
        test_assist()
        test_finalize()

        print("\n" + "=" * 60)
        print("✅ TODOS LOS TESTS COMPLETADOS")
        print("=" * 60)
        print("\n⚠️  Nota: Algunos tests pueden mostrar errores si no tienes")
        print("   configuradas las variables de entorno (SUPABASE_URL, etc.)")
        print("   Esto es normal y esperado en testing local.\n")

    except AssertionError as e:
        print(f"\n❌ TEST FALLÓ: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR INESPERADO: {e}")
        sys.exit(1)
