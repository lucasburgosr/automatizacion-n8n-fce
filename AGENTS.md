# AGENTS.md

## Propósito

Construir un MVP funcional de un asistente académico por WhatsApp para la
Facultad de Ciencias Económicas (UNCUYO) usando:

- n8n como orquestador principal
- WhatsApp Business / Cloud API como canal
- Postgres + pgvector para almacenamiento, FAQ e indexación semántica
- OpenAI API institucional para clasificación, embeddings y generación de
  respuestas cuando aporte valor

El objetivo del MVP es responder consultas frecuentes académicas y
administrativas con buena precisión, recuperar contenido desde documentos
institucionales vectorizados, y derivar a atención humana cuando la confianza
sea baja o la consulta exceda el alcance del bot.

## Resultado esperado del MVP

El sistema debe poder:

1. recibir mensajes entrantes de WhatsApp
2. identificar al usuario y mantener contexto conversacional básico
3. clasificar la intención de la consulta
4. responder por múltiples vías (FAQ, documentos, híbrido, fallback o
   derivación)
5. registrar trazabilidad de cada interacción
6. permitir evolución incremental

## Arquitectura lógica

### Componentes

- Canal: WhatsApp Business API
- Orquestación: n8n
- Base de datos: Postgres
- Búsqueda semántica: pgvector
- LLM/embeddings: OpenAI API

## Workflow principal en n8n

Nombre: Chatbot - FCE

### Nodos principales

1. Webhook WhatsApp Inbound
2. Normalize Inbound Payload
3. Upsert User
4. Open Or Resume Conversation
5. Basic Guardrails
6. Intent Classifier
7. Route by Intent

## Sub-workflows

- faq_answer_flow
- document_rag_flow
- hybrid_answer_flow
- clarification_flow
- handoff_flow
- unsupported_message_flow

## Reglas clave

- No inventar información
- Priorizar contenido institucional
- Usar fallback o derivación ante baja confianza
- Mantener logs estructurados de todas las decisiones

## Uso de OpenAI

- Clasificación de intención
- Embeddings
- Generación final acotada a contexto

## Definición de done

- Flujo implementado
- Manejo de errores
- Contratos claros
- Casos de prueba básicos
- Persistencia correcta

## Fuente inicial de FAQs

- En el archivo `preguntas_frecuentes.csv` se encuentran las preguntas
  frecuentes y sus respuestas.

### Formato esperado del CSV

El archivo contiene al menos las siguientes columnas normalizadas:

- `tema`
- `subtemas`
- `posible_pregunta`
- `respuesta`

Los nombres pueden venir capitalizados en el archivo fuente, pero el contrato
interno del proyecto debe tratarlos como esos nombres normalizados en minúsculas.

### Instrucciones de procesamiento

Codex debe:

1. leer el archivo CSV
2. limpiar y normalizar los textos y cabeceras
3. mapear las columnas fuente al contrato `tema`, `subtemas`,
   `posible_pregunta`, `respuesta`
4. generar embeddings para cada `posible_pregunta`
5. insertar los datos en la tabla `faqs` en Postgres
6. almacenar el embedding en el campo `embedding` (pgvector)
7. marcar los registros como `active = true`

### Reglas

- no duplicar FAQs existentes
- si una `posible_pregunta` ya existe, actualizar su `respuesta`
- mantener consistencia de `tema` y `subtemas`
- registrar logs del proceso de ingesta

### Uso en runtime

- las FAQs deben ser consultadas primero en `faq_answer_flow`
- usar búsqueda semántica sobre `embedding`
- aplicar threshold de similitud antes de responder
