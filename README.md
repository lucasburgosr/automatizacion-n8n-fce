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
- envio de respuestas por `HTTP Request` a la Cloud API de WhatsApp
- menu guiado inicial por temas y preguntas frecuentes
- workflow `Chatbot - FCE` sincronizado en la instancia local de n8n
- path FAQ validado con recuperacion semantica real y ruteo correcto hacia
  `faq_answer_flow`

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
- [docs/guia_funcionamiento.md](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/docs/guia_funcionamiento.md): guia breve de funcionamiento y pruebas

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

- menu guiado inicial por temas y preguntas frecuentes
- embedding de consulta + chequeos candidatos FAQ/documento
- clasificacion de tipo de consulta con el nodo oficial `OpenAI`
- politica de resolucion basada en evidencia recuperada
- sub-workflows ejecutados via `Execute Workflow`
- envio por `HTTP Request` hacia la Cloud API de WhatsApp
- persistencia en Postgres

Adicionalmente, la salida WhatsApp normaliza telefonos argentinos con
`549 -> 54` y recorta titulos/descripciones de listas para respetar los
limites del payload interactivo de Meta.

### Politica de clasificacion y routing

El clasificador principal ya no decide categorias de fuente como `faq` o
`document_search` a ciegas. El orden actual es:

1. generar embedding de la consulta
2. buscar la mejor FAQ candidata
3. buscar el mejor chunk documental candidato
4. clasificar el tipo de consulta:
   - `general_information`
   - `personal_case`
   - `ambiguous`
   - `human_handoff`
5. aplicar una politica de resolucion que combina:
   - score FAQ
   - score documental
   - tipo de consulta
   - senales textuales de caso personal o excepcion

Con esto, `faq` pasa a ser una decision de resolucion respaldada por
recuperacion semantica real, no una etiqueta inferida sin evidencia.

### Estado del path FAQ

El camino de FAQs ya fue probado con la consulta:

- `cuanto me dura la regularidad de una materia?`

Resultado verificado:

- se recupera una FAQ con score alto
- el ruteo entra en `faq_answer_flow`
- la respuesta sale desde la base `faqs`

El ajuste clave fue robustecer `Parse Query Type` para tolerar distintos
formatos de salida del nodo oficial de OpenAI y no degradar a
`clarification_needed` cuando la evidencia FAQ ya era suficiente.

## Credenciales requeridas en n8n

Necesarias:

- `Postgres`
- `OpenAI API Key`
- `WhatsApp Cloud API`

Nodos que todavia requieren asignacion manual de credencial OpenAI:

- `faq_answer_flow` -> `Get Query Embedding`
- `document_rag_flow` -> `Get Query Embedding`

## Configuracion pendiente para operacion real

- asignar manualmente credenciales OpenAI en n8n
- revisar el `webhook` de entrada con payload real de Meta
- activar/publicar el workflow principal cuando el wiring final este validado

## Notas sobre .env

El `.env` del repo se usa para scripts locales, no para resolver automaticamente
credenciales dentro de n8n.

Los workflows de n8n ya no dependen de variables de entorno para OpenAI:

- los nodos de chat usan el nodo oficial `OpenAI`
- modelo de chat fijo: `gpt-4.1-mini`
- modelo de embeddings fijo: `text-embedding-3-small`

Los embeddings siguen usando `HTTP Request` porque el nodo oficial de embeddings
de n8n es un subnodo LangChain y no expone de forma simple el vector crudo para
el SQL actual. La clasificacion y la generacion documental ya quedaron migradas
al nodo oficial de OpenAI, que conserva mejor la asignacion de credenciales en
actualizaciones de workflow.
