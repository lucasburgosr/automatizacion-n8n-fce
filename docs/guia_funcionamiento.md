# Guia breve de funcionamiento

## Objetivo

Esta guia resume como funciona hoy el MVP del chatbot FCE y que revisar para
probarlo sin perder tiempo en la arquitectura interna.

## Flujo principal

El workflow [chatbot_fce.js](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/n8n/workflows/chatbot_fce.js) sigue este orden:

1. recibe el mensaje por webhook
2. normaliza el payload de WhatsApp
3. identifica o crea el usuario
4. abre o reutiliza una conversacion
5. aplica guardrails basicos
6. si detecta un saludo generico arma un menu inicial por temas desde `faqs`
7. si el usuario elige un tema arma una segunda lista con hasta 5 preguntas
8. si el usuario elige una FAQ responde directamente esa respuesta
9. si no aplica menu, genera embedding de la consulta
10. busca la mejor FAQ candidata y el mejor candidato documental
11. clasifica el tipo de consulta
12. aplica una politica de resolucion
13. ejecuta el sub-flujo correspondiente
14. envia la respuesta por WhatsApp via `HTTP Request`
15. registra trazabilidad en Postgres

## Como decide responder

El sistema no le pide al clasificador que adivine si algo "es FAQ" o "es
documento". Primero recupera evidencia real y despues decide.

Senales usadas:

- score de la mejor FAQ
- score del mejor chunk documental
- tipo de consulta clasificado por OpenAI
- senales de caso personal, excepcion o derivacion

Posibles salidas:

- `guided_menu`
- `faq`
- `document_search`
- `hybrid`
- `clarification_needed`
- `human_handoff`
- `unsupported`

## Path FAQ

El path FAQ ya esta validado.

Consulta probada:

- `cuanto me dura la regularidad de una materia?`

Comportamiento esperado:

- `FAQ Candidate Lookup` recupera una FAQ con score alto
- `Resolution Policy` decide `faq`
- se ejecuta `faq_answer_flow`
- la respuesta sale desde la tabla `faqs`

## Sub-flujos

- [faq_answer_flow.js](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/n8n/workflows/faq_answer_flow.js): busca FAQs por similitud semantica
- [document_rag_flow.js](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/n8n/workflows/document_rag_flow.js): busca chunks documentales y genera respuesta acotada al contexto
- [hybrid_answer_flow.js](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/n8n/workflows/hybrid_answer_flow.js): combina evidencia FAQ y documental
- [clarification_flow.js](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/n8n/workflows/clarification_flow.js): pide una aclaracion
- [handoff_flow.js](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/n8n/workflows/handoff_flow.js): deriva a humano
- [unsupported_message_flow.js](/C:/Users/User/Desktop/Lucas/FCE/automatizacion-n8n-fce/n8n/workflows/unsupported_message_flow.js): maneja mensajes fuera de alcance

## Credenciales necesarias en n8n

- `Postgres`
- `OpenAI API Key`
- `WhatsApp Cloud API`

Asignacion manual pendiente solo para embeddings:

- `faq_answer_flow` -> `Get Query Embedding`
- `document_rag_flow` -> `Get Query Embedding`

## Donde mirar si algo falla

Base de datos:

- tabla `messages` para ver mensajes inbound
- tabla `interaction_logs` para ver `intent`, `reason` y `routing_evidence`

Workflows:

- `Route Conversation Entry` para ver si entró en menu guiado, FAQ elegida o flujo estandar
- `FAQ Candidate Lookup` para verificar score FAQ
- `Parse Query Type` para ver si OpenAI devolvio un formato parseable
- `Resolution Policy` para confirmar el intent final
- `Build WhatsApp Request` para confirmar el payload final y la normalizacion `549 -> 54`

## Troubleshooting rapido

Si una consulta FAQ termina en clarificacion:

1. revisar `interaction_logs`
2. confirmar `faq_score`
3. confirmar `query_type`
4. verificar si `Parse Query Type` produjo `invalid_classifier_output`

Si no responde por WhatsApp:

1. revisar credencial `WhatsApp Cloud API`
2. revisar `phoneNumberId`
3. revisar `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_GRAPH_VERSION`
4. revisar el payload `whatsapp_request_body` en `Build WhatsApp Request`
5. revisar que `to` salga normalizado de `549...` a `54...`
6. revisar que cada `row.title` no supere 24 caracteres y `row.description` no supere 72

Si no encuentra FAQs:

1. confirmar que `faqs.active = true`
2. confirmar que `faqs.embedding` no sea `null`
3. volver a correr la ingesta si hace falta
