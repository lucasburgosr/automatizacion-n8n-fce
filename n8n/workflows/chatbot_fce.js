import { workflow, trigger, node, switchCase, expr, newCredential, sticky } from '@n8n/workflow-sdk';

const webhookInbound = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook WhatsApp Inbound',
    parameters: {
      path: 'whatsapp/fce/inbound',
      httpMethod: 'POST',
      responseMode: 'responseNode'
    },
    position: [240, 300]
  },
  output: [{ body: { entry: [{ changes: [{ value: { contacts: [{ wa_id: '5492615550000', profile: { name: 'Estudiante FCE' } }], messages: [{ id: 'wamid-123', timestamp: '1710000000', type: 'text', text: { body: '¿Cómo extiendo la regularidad?' } }] } }] }] } }]
});

const normalizeInbound = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Inbound Payload',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return items.map((item) => { const value = item.json.body?.entry?.[0]?.changes?.[0]?.value || {}; const contact = value.contacts?.[0] || {}; const message = value.messages?.[0] || {}; return { json: { message_id: message.id || null, phone: contact.wa_id || null, user_name: contact.profile?.name || null, message_type: message.type || 'unknown', text: message.text?.body || '', timestamp: message.timestamp || null, raw_payload: item.json.body || item.json } }; });"
    },
    position: [540, 300]
  },
  output: [{ message_id: 'wamid-123', phone: '5492615550000', user_name: 'Estudiante FCE', message_type: 'text', text: '¿Cómo extiendo la regularidad?', timestamp: '1710000000', raw_payload: {} }]
});

const upsertUser = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Upsert User',
    parameters: {
      operation: 'executeQuery',
      query: expr("{{ \"insert into users (phone, full_name, last_seen_at) values ('\" + $json.phone + \"', '\" + String($json.user_name || '').split(\"'\").join(\"''\") + \"', now()) on conflict (phone) do update set full_name = excluded.full_name, last_seen_at = now() returning id, phone, full_name;\" }}")
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [840, 300]
  },
  output: [{ id: 'user-id', phone: '5492615550000', full_name: 'Estudiante FCE' }]
});

const openConversation = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Open Or Resume Conversation',
    parameters: {
      operation: 'executeQuery',
      query: expr("{{ \"with existing as (select id from conversations where user_id = '\" + $json.id + \"' and status = 'open' order by last_message_at desc limit 1), created as (insert into conversations (user_id, status, started_at, last_message_at) select '\" + $json.id + \"', 'open', now(), now() where not exists (select 1 from existing) returning id) select id from existing union all select id from created limit 1;\" }}")
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [1140, 300]
  },
  output: [{ id: 'conversation-id' }]
});

const guardrails = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Basic Guardrails',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const normalized = $('Normalize Inbound Payload').item.json; const conversation = items[0]?.json || {}; const text = String(normalized.text || '').trim(); const isText = normalized.message_type === 'text'; const route_hint = !isText ? 'unsupported' : text.length < 4 ? 'clarification_needed' : 'classify'; return [{ json: { ...normalized, conversation_id: conversation.id || null, route_hint } }];"
    },
    position: [1440, 300]
  },
  output: [{ message_id: 'wamid-123', phone: '5492615550000', user_name: 'Estudiante FCE', message_type: 'text', text: '¿Cómo extiendo la regularidad?', conversation_id: 'conversation-id', route_hint: 'classify' }]
});

const intentClassifier = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Intent Classifier',
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ { model: "gpt-4.1-mini", temperature: 0, messages: [ { role: "system", content: "Clasifica la consulta en una sola etiqueta JSON: faq, document_search, hybrid, clarification_needed, human_handoff, unsupported. Responde solo JSON con keys intent, confidence y reason." }, { role: "user", content: $json.text } ] } }}')
    },
    credentials: { httpHeaderAuth: newCredential('OpenAI API Key') },
    position: [1740, 300]
  },
  output: [{ choices: [{ message: { content: '{"intent":"faq","confidence":0.91,"reason":"consulta frecuente sobre regularidad"}' } }] }]
});

const parseIntent = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Intent',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const base = $('Basic Guardrails').item.json; if (base.route_hint !== 'classify') { return [{ json: { ...base, intent: base.route_hint, confidence: 0, reason: 'guardrail' } }]; } const raw = items[0]?.json?.choices?.[0]?.message?.content || '{}'; let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { intent: 'clarification_needed', confidence: 0, reason: 'invalid_classifier_output' }; } return [{ json: { ...base, intent: parsed.intent || 'clarification_needed', confidence: Number(parsed.confidence || 0), reason: parsed.reason || null } }];"
    },
    position: [2040, 300]
  },
  output: [{ message_id: 'wamid-123', phone: '5492615550000', user_name: 'Estudiante FCE', message_type: 'text', text: '¿Cómo extiendo la regularidad?', conversation_id: 'conversation-id', intent: 'faq', confidence: 0.91, reason: 'consulta frecuente sobre regularidad' }]
});

const routeByIntent = switchCase({
  version: 3.4,
  config: {
    name: 'Route by Intent',
    parameters: {
      mode: 'expression',
      output: '={{ ["faq","document_search","hybrid","clarification_needed","human_handoff","unsupported"].indexOf($json.intent) >= 0 ? ["faq","document_search","hybrid","clarification_needed","human_handoff","unsupported"].indexOf($json.intent) : 3 }}',
      numberOfOutputs: 6
    },
    position: [2340, 300]
  }
});

const faqFlow = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3, config: { name: 'faq_answer_flow', parameters: { mode: 'once', workflowId: 'Q9pkNtiBoYRR0sXd' }, position: [2640, 80] }, output: [{ status: 'answered', response_text: 'La regularidad dura 14 mesas ordinarias.', source_type: 'faq', source_ids: ['faq-id'], confidence: 0.93, needs_clarification: false, needs_handoff: false }] });
const documentFlow = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3, config: { name: 'document_rag_flow', parameters: { mode: 'once', workflowId: 'eZ37dnCoNwU380ZE' }, position: [2640, 180] }, output: [{ status: 'answered', response_text: 'La extensión puede solicitarse en casos especiales.', source_type: 'document', source_ids: ['chunk-id'], confidence: 0.87, needs_clarification: false, needs_handoff: false }] });
const hybridFlow = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3, config: { name: 'hybrid_answer_flow', parameters: { mode: 'once', workflowId: 'nIp0C17sxu0hycMv' }, position: [2640, 280] }, output: [{ status: 'answered', response_text: 'Respuesta híbrida', source_type: 'hybrid', source_ids: ['faq-id', 'chunk-id'], confidence: 0.9, needs_clarification: false, needs_handoff: false }] });
const clarificationFlow = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3, config: { name: 'clarification_flow', parameters: { mode: 'once', workflowId: '5ozyKlf1VKe7Qb6a' }, position: [2640, 380] }, output: [{ status: 'clarification_needed', response_text: 'Necesito más detalle para ayudarte.', source_type: 'clarification', source_ids: [], confidence: 0, needs_clarification: true, needs_handoff: false }] });
const handoffFlow = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3, config: { name: 'handoff_flow', parameters: { mode: 'once', workflowId: 'Su3JQJ8jE0jTLebj' }, position: [2640, 480] }, output: [{ status: 'handoff', response_text: 'La consulta fue derivada.', source_type: 'handoff', source_ids: ['handoff-id'], confidence: 0, needs_clarification: false, needs_handoff: true }] });
const unsupportedFlow = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3, config: { name: 'unsupported_message_flow', parameters: { mode: 'once', workflowId: '2gMSYsq7rFTUSKKg' }, position: [2640, 580] }, output: [{ status: 'unsupported', response_text: 'Por ahora solo respondo texto.', source_type: 'unsupported', source_ids: [], confidence: 0, needs_clarification: false, needs_handoff: false }] });

const buildReply = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Final Reply',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const result = items[0]?.json || {}; const base = $('Parse Intent').item.json; return [{ json: { ...base, reply_text: result.response_text || 'No pude resolver tu consulta en este momento.', source_type: result.source_type || 'fallback', source_ids: result.source_ids || [], final_confidence: Number(result.confidence || 0), needs_handoff: Boolean(result.needs_handoff), status: result.status || 'fallback' } }];"
    },
    position: [2940, 300]
  },
  output: [{ phone: '5492615550000', conversation_id: 'conversation-id', reply_text: 'La extensión puede solicitarse en casos especiales.', source_type: 'faq', source_ids: ['faq-id'], final_confidence: 0.91, status: 'answered', needs_handoff: false }]
});

const persistInboundMessage = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Persist Inbound Message',
    parameters: {
      operation: 'executeQuery',
      query: expr("{{ \"insert into messages (conversation_id, external_message_id, direction, message_type, body, raw_payload) values ('\" + $json.conversation_id + \"', '\" + String($json.message_id || '').split(\"'\").join(\"''\") + \"', 'inbound', '\" + String($json.message_type || 'unknown').split(\"'\").join(\"''\") + \"', '\" + String($json.text || '').split(\"'\").join(\"''\") + \"', '\" + JSON.stringify($json.raw_payload || {}).split(\"'\").join(\"''\") + \"'::jsonb) returning id;\" }}")
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [3240, 200]
  },
  output: [{ id: 'message-id' }]
});

const sendWhatsappReply = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send WhatsApp Reply',
    parameters: {
      resource: 'message',
      operation: 'send',
      recipientPhoneNumber: expr('{{ $("Build Final Reply").item.json.phone }}'),
      textBody: expr('{{ $("Build Final Reply").item.json.reply_text }}')
    },
    credentials: { whatsAppApi: newCredential('WhatsApp Cloud API') },
    position: [3240, 400]
  },
  output: [{ messages: [{ id: 'wamid-out' }] }]
});

const persistInteractionLog = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Persist Interaction Log',
    parameters: {
      operation: 'executeQuery',
      query: expr("{{ \"insert into interaction_logs (conversation_id, step, decision, confidence, payload_json) values ('\" + $(\"Build Final Reply\").item.json.conversation_id + \"', 'final_response', '\" + String($(\"Build Final Reply\").item.json.status || 'fallback').split(\"'\").join(\"''\") + \"', \" + Number($(\"Build Final Reply\").item.json.final_confidence || 0) + \", '\" + JSON.stringify({ source_type: $(\"Build Final Reply\").item.json.source_type, source_ids: $(\"Build Final Reply\").item.json.source_ids, intent: $(\"Build Final Reply\").item.json.intent, reason: $(\"Build Final Reply\").item.json.reason, needs_handoff: $(\"Build Final Reply\").item.json.needs_handoff }).split(\"'\").join(\"''\") + \"'::jsonb);\" }}")
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [3540, 300]
  },
  output: [{}]
});

const webhookResponse = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: { name: 'Respond To Webhook', parameters: { respondWith: 'json', responseBody: '={"ok":true}' }, position: [3840, 300] },
  output: [{ ok: true }]
});

export default workflow('chatbot-fce', 'Chatbot - FCE')
  .add(sticky('## Inbound flow\nNormaliza el payload, registra contexto, clasifica intención y despacha a un sub-workflow.', [normalizeInbound, upsertUser, openConversation, guardrails, intentClassifier, parseIntent, routeByIntent], { color: 7 }))
  .add(sticky('## Reply and logs\nEnvía la respuesta por WhatsApp y registra trazabilidad completa.', [buildReply, persistInboundMessage, sendWhatsappReply, persistInteractionLog, webhookResponse], { color: 5 }))
  .add(webhookInbound)
  .to(normalizeInbound)
  .to(upsertUser)
  .to(openConversation)
  .to(guardrails)
  .to(intentClassifier)
  .to(parseIntent)
  .to(routeByIntent
    .onCase(0, faqFlow.to(buildReply))
    .onCase(1, documentFlow.to(buildReply))
    .onCase(2, hybridFlow.to(buildReply))
    .onCase(3, clarificationFlow.to(buildReply))
    .onCase(4, handoffFlow.to(buildReply))
    .onCase(5, unsupportedFlow.to(buildReply)))
  .add(buildReply)
  .to(persistInboundMessage)
  .to(sendWhatsappReply)
  .to(persistInteractionLog)
  .to(webhookResponse);
