# Configuración de Google Sheets para Shadow AI Experimento

Sigue estos pasos **en orden** para configurar Google Sheets como almacenamiento de datos.

---

## PASO 1: Crear proyecto en Google Cloud (2 minutos)

1. **Ve a Google Cloud Console**:
   https://console.cloud.google.com/

2. **Crea un nuevo proyecto**:
   - Click en el dropdown de proyectos (arriba a la izquierda)
   - Click en "New Project"
   - Nombre: `shadow-ai-experiment`
   - Click "Create"

3. **Espera** a que se cree el proyecto (10-30 segundos)

4. **Selecciona el proyecto** que acabas de crear desde el dropdown

---

## PASO 2: Habilitar Google Sheets API (1 minuto)

1. **Ve a APIs & Services**:
   https://console.cloud.google.com/apis/dashboard

2. **Click en "+ ENABLE APIS AND SERVICES"** (botón azul arriba)

3. **Busca** "Google Sheets API"

4. **Click** en "Google Sheets API"

5. **Click** en "ENABLE"

6. **Repite** para "Google Drive API":
   - Vuelve atrás
   - Busca "Google Drive API"
   - Click en "Google Drive API"
   - Click en "ENABLE"

---

## PASO 3: Crear credenciales de servicio (2 minutos)

1. **Ve a Credentials**:
   https://console.cloud.google.com/apis/credentials

2. **Click** en "CREATE CREDENTIALS" → "Service account"

3. **Rellena**:
   - Service account name: `shadowai-sheets-writer`
   - Service account ID: (se rellena automático)
   - Click "CREATE AND CONTINUE"

4. **Grant access** (dejar en blanco, click "CONTINUE")

5. **Grant users access** (dejar en blanco, click "DONE")

6. **Click** en la cuenta de servicio que acabas de crear

7. **Ve a la pestaña "KEYS"**

8. **Click** en "ADD KEY" → "Create new key"

9. **Selecciona** "JSON"

10. **Click** "CREATE"

11. **Se descargará un archivo JSON** - ¡Guárdalo! Lo necesitas en el paso siguiente

---

## PASO 4: Crear el Google Sheet (30 segundos)

1. **Ve a Google Sheets**:
   https://sheets.google.com/

2. **Crea un nuevo sheet** (en blanco)

3. **Nómbralo**: `Shadow AI - Experimento`

4. **Copia la URL** (la necesitarás para compartir)

5. **IMPORTANTE - Comparte el sheet con la cuenta de servicio**:
   - Click en "Share" (Compartir)
   - Pega el email de la cuenta de servicio (está en el JSON que descargaste, campo `client_email`)
   - Ejemplo: `shadowai-sheets-writer@shadow-ai-experiment.iam.gserviceaccount.com`
   - Dale permisos de **Editor**
   - **Desmarca** "Notify people"
   - Click "Share"

---

## PASO 5: Configurar variables de entorno en Render (2 minutos)

1. **Ve a Render Dashboard**:
   https://dashboard.render.com/

2. **Selecciona** tu servicio `shadowai-experiment`

3. **Ve a Settings** → **Environment**

4. **Elimina** estas variables (ya no las necesitas):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

5. **Agrega** esta variable:
   - Key: `GOOGLE_SHEETS_CREDENTIALS`
   - Value: **Todo el contenido del archivo JSON que descargaste**
   - **IMPORTANTE**: Copia TODO el JSON, debe empezar con `{` y terminar con `}`
   - Ejemplo:
   ```json
   {
     "type": "service_account",
     "project_id": "shadow-ai-experiment",
     "private_key_id": "abc123...",
     "private_key": "-----BEGIN PRIVATE KEY-----\n...",
     "client_email": "shadowai-sheets-writer@...",
     ...
   }
   ```

6. **Verifica** que también tengas:
   - `OPENAI_API_KEY` (para sugerencias de IA)

7. **Opcional**: Agrega esta variable si quieres cambiar el nombre del sheet:
   - Key: `GOOGLE_SHEET_NAME`
   - Value: `Shadow AI - Experimento`
   - (Si no la agregas, usa este nombre por defecto)

8. **Click** "Save Changes"

---

## PASO 6: Deploy (3 minutos)

1. **Haz merge del Pull Request a main** (como hiciste antes)

2. **En Render** → Click "Manual Deploy" → "Deploy latest commit"

3. **Espera** a que despliegue (2-3 minutos)

4. **Verifica** que el status sea "Live" (verde)

---

## PASO 7: Verificar que funciona (1 minuto)

1. **Abre** tu experimento: https://shadowai-experiment.onrender.com/

2. **Completa** el consentimiento y algunos campos

3. **Ve a tu Google Sheet**: https://sheets.google.com/

4. **Deberías ver** que se crearon automáticamente dos hojas:
   - **events**: registra cada click y acción
   - **results**: resultados finales de cada participante

5. **Si ves datos**, ¡funciona! 🎉

---

## Estructura de las hojas

### Hoja "events"
Columnas:
- `timestamp`: cuándo ocurrió el evento
- `subject_id`: ID del participante
- `policy`: política asignada (permisiva/difusa/restrictiva)
- `event`: tipo de evento (click, screen_enter, ai_help_use, etc.)
- `payload_json`: datos adicionales en formato JSON

### Hoja "results"
Columnas:
- `timestamp`: cuándo terminó el experimento
- `subject_id`: ID del participante
- `policy`: política asignada
- **Demográficos**: dob, studies, grad_year, uni, field, city, gpa
- **Tarea**: task_text, words, edit_count
- **Uso de IA**: ai_generated_pct, ai_paraphrased_pct
- **Control**: noticed_policy, used_ai_button, used_external_ai
- **Personalidad**: personality_q1, q2, q3

---

## Exportar datos para análisis

Para analizar los datos en R, Python, SPSS, etc.:

1. **Abre** el Google Sheet

2. **Selecciona** la hoja "results"

3. **File** → **Download** → **Comma Separated Values (.csv)**

4. **Importa** el CSV en tu software de análisis favorito

---

## Solución de problemas

### "Error al guardar datos"
- Verifica que compartiste el sheet con el email de la cuenta de servicio
- Verifica que el JSON en `GOOGLE_SHEETS_CREDENTIALS` esté completo
- Mira los logs en Render para ver errores específicos

### "No aparecen las hojas"
- Las hojas se crean automáticamente cuando llega el primer dato
- Completa el experimento al menos una vez

### "Permission denied"
- El sheet no está compartido con la cuenta de servicio
- Ve al sheet → Share → agrega el `client_email` del JSON

---

## Seguridad

✅ El archivo JSON contiene credenciales sensibles
✅ **NO** lo subas a GitHub
✅ Solo ponlo en la variable de entorno de Render
✅ Guarda una copia en lugar seguro por si necesitas reconfigurar

---

¡Listo! Ahora tu experimento guarda todo en Google Sheets automáticamente.
