# Estado actual del proyecto

## Resumen

Hasta este punto se implemento la base funcional del MVP:

- base de datos lista en PostgreSQL 17
- `pgvector` instalado y habilitado
- FAQs cargadas con embeddings
- workflows creados en n8n
- workflow principal enlazado con sus sub-workflows
- respuesta outbound migrada al nodo oficial de WhatsApp

## Proceso ejecutado

### 1. Contrato y estructura del proyecto

Se actualizo el contrato en [AGENTS.md](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/AGENTS.md) para alinear la fuente real de FAQs con estas columnas normalizadas:

- `tema`
- `subtemas`
- `posible_pregunta`
- `respuesta`

Tambien se agregaron:

- [db/schema.sql](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/db/schema.sql)
- [scripts/ingest_faqs.py](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/scripts/ingest_faqs.py)
- [tests/test_ingest_faqs.py](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/tests/test_ingest_faqs.py)
- [scripts/install_pgvector_windows.ps1](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/scripts/install_pgvector_windows.ps1)

### 2. Instalacion de pgvector

Entorno detectado:

- PostgreSQL Server 17.6 en Windows

Acciones realizadas:

- instalacion de Visual Studio Build Tools 2022
- compilacion de `pgvector v0.8.1`
- copia de los binarios y scripts SQL a la instalacion de PostgreSQL
- ejecucion de `CREATE EXTENSION IF NOT EXISTS vector;` en la base `chatbot_fce`

Resultado confirmado:

- extension `vector` instalada en la base
- version detectada: `0.8.1`

### 3. Aplicacion del esquema SQL

Se aplico [db/schema.sql](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/db/schema.sql) sobre `chatbot_fce`.

Objetos creados:

- tablas: `users`, `conversations`, `messages`, `faqs`, `documents`, `document_chunks`, `handoff_requests`, `interaction_logs`
- funciones: `match_faqs`, `match_document_chunks`, `set_updated_at`
- triggers de `updated_at` para `faqs` y `documents`

Resultado confirmado:

- `faqs.embedding` es tipo `vector`
- las funciones de matching semantico existen

### 4. Ingesta inicial de FAQs

Se ejecuto la carga real desde [preguntas_frecuentes.csv](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/preguntas_frecuentes.csv) con OpenAI y Postgres.

Resultado:

- `39` FAQs cargadas
- `39` FAQs activas
- `39` FAQs con embeddings

La ingesta:

- normaliza cabeceras
- corrige mojibake
- deduplica por pregunta normalizada
- genera embeddings para `posible_pregunta`
- hace upsert en `faqs`

### 5. Creacion de workflows en n8n

Se crearon estos workflows en la instancia local de n8n:

- `faq_answer_flow` -> `Q9pkNtiBoYRR0sXd`
- `document_rag_flow` -> `eZ37dnCoNwU380ZE`
- `hybrid_answer_flow` -> `nIp0C17sxu0hycMv`
- `clarification_flow` -> `5ozyKlf1VKe7Qb6a`
- `handoff_flow` -> `Su3JQJ8jE0jTLebj`
- `unsupported_message_flow` -> `2gMSYsq7rFTUSKKg`
- `Chatbot - FCE` -> `CEZclpUTGbOnapvk`

### 6. Ajustes de los workflows

Se hicieron estos ajustes relevantes:

- se inyectaron IDs reales de sub-workflows en el workflow principal
- se elimino la dependencia de variables de entorno para OpenAI dentro de n8n
- se fijaron:
  - embeddings: `https://api.openai.com/v1/embeddings`
  - chat completions: `https://api.openai.com/v1/chat/completions`
  - modelo chat: `gpt-4.1-mini`
  - modelo embeddings: `text-embedding-3-small`
- se reemplazo el nodo `HTTP Request` de salida por el nodo oficial `WhatsApp Business Cloud`

## Estado operativo actual

### Listo

- base `chatbot_fce`
- extension `vector`
- esquema SQL
- FAQs cargadas
- sub-workflows creados
- workflow principal creado
- envio outbound por nodo oficial de WhatsApp

### Pendiente

- asignar manualmente credenciales OpenAI en n8n
- verificar la credencial `WhatsApp Cloud API` en el nodo de envio
- revisar payload real del webhook de WhatsApp inbound
- activar/publicar `Chatbot - FCE`

## Credenciales necesarias en n8n

- `Postgres`
- `OpenAI API Key`
- `WhatsApp Cloud API`

Asignacion manual OpenAI pendiente en:

- `faq_answer_flow` -> `Get Query Embedding`
- `document_rag_flow` -> `Get Query Embedding`
- `document_rag_flow` -> `Generate Grounded Answer`
- `Chatbot - FCE` -> `Intent Classifier`

## Riesgos o limitaciones actuales

- el `Webhook WhatsApp Inbound` todavia no fue validado contra un payload real de Meta dentro de esta implementacion
- la clasificacion usa `HTTP Request` a OpenAI, no el nodo oficial de OpenAI
- no se publico todavia el workflow principal
- no hay aun carga de documentos institucionales en `documents` y `document_chunks`, por lo que `document_rag_flow` queda listo en estructura pero no con corpus real

## Comandos y verificaciones ya ejecutadas

- tests Python de normalizacion: OK
- dry run de ingesta: OK
- carga real de FAQs: OK
- verificacion SQL de tablas: OK
- verificacion SQL de funciones: OK
- verificacion SQL de embeddings cargados: OK
- validacion de workflows con el SDK de n8n: OK en las versiones actualizadas
