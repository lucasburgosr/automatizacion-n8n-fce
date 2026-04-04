# Chatbot FCE - Automatizacion con n8n

MVP de un asistente academico para la Facultad de Ciencias Economicas
(UNCUYO) sobre WhatsApp Business Cloud, n8n, Postgres, pgvector y OpenAI.

## Estado actual

El proyecto ya tiene implementada la base operativa:

- `pgvector` compilado e instalado sobre PostgreSQL 17
- extension `vector` creada en la base `chatbot_fce`
- esquema SQL aplicado
- FAQs cargadas en Postgres con embeddings reales
- sub-workflows y workflow principal creados en n8n
- envio de respuestas por el nodo oficial `WhatsApp Business Cloud`

Detalle del estado y del proceso ejecutado:

- [docs/estado_actual.md](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/docs/estado_actual.md)

## Estructura

- [AGENTS.md](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/AGENTS.md): contrato funcional del proyecto
- [db/schema.sql](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/db/schema.sql): tablas, indices y funciones SQL
- [scripts/ingest_faqs.py](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/scripts/ingest_faqs.py): carga de FAQs a Postgres + pgvector
- [scripts/install_pgvector_windows.ps1](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/scripts/install_pgvector_windows.ps1): instalacion de pgvector en Windows
- [tests/test_ingest_faqs.py](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/tests/test_ingest_faqs.py): tests basicos de normalizacion e ingesta
- [n8n/workflows](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/n8n/workflows): fuentes SDK de los workflows
- [preguntas_frecuentes.csv](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/preguntas_frecuentes.csv): dataset inicial

## Base de datos

La base objetivo actual es `chatbot_fce`.

El esquema crea:

- `users`
- `conversations`
- `messages`
- `faqs`
- `documents`
- `document_chunks`
- `handoff_requests`
- `interaction_logs`

Tambien crea las funciones:

- `match_faqs`
- `match_document_chunks`
- `set_updated_at`

## Ingesta FAQ

Dry run:

```powershell
.\.venv\Scripts\python .\scripts\ingest_faqs.py --dry-run --skip-embeddings
```

Carga real:

```powershell
.\.venv\Scripts\python .\scripts\ingest_faqs.py
```

Contrato esperado del CSV:

- `tema`
- `subtemas`
- `posible_pregunta`
- `respuesta`

## Workflows n8n

Fuentes locales:

1. `faq_answer_flow.js`
2. `document_rag_flow.js`
3. `hybrid_answer_flow.js`
4. `clarification_flow.js`
5. `handoff_flow.js`
6. `unsupported_message_flow.js`
7. `chatbot_fce.js`

El workflow principal depende de:

- clasificacion con OpenAI por `HTTP Request`
- sub-workflows ejecutados via `Execute Workflow`
- envio por `WhatsApp Business Cloud`
- persistencia en Postgres

## Credenciales requeridas en n8n

Necesarias:

- `Postgres`
- `OpenAI API Key`
- `WhatsApp Cloud API`

Nodos que todavia requieren asignacion manual de credencial OpenAI:

- `faq_answer_flow` -> `Get Query Embedding`
- `document_rag_flow` -> `Get Query Embedding`
- `document_rag_flow` -> `Generate Grounded Answer`
- `Chatbot - FCE` -> `Intent Classifier`

## Configuracion pendiente para operacion real

- asignar manualmente credenciales OpenAI en n8n
- verificar la credencial de WhatsApp en `Send WhatsApp Reply`
- revisar el `webhook` de entrada con payload real de Meta
- activar/publicar el workflow principal cuando el wiring final este validado

## Notas sobre .env

El `.env` del repo se usa para scripts locales, no para resolver automaticamente
credenciales dentro de n8n.

Los workflows de n8n ya no dependen de variables de entorno para OpenAI:

- URL fija: `https://api.openai.com/v1`
- modelo de chat fijo: `gpt-4.1-mini`
- modelo de embeddings fijo: `text-embedding-3-small`
