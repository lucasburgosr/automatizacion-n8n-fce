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
    position: [240, 320]
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
    position: [540, 320]
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
    position: [840, 320]
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
    position: [1140, 320]
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
      jsCode: "const normalized = $('Normalize Inbound Payload').item.json; const conversation = items[0]?.json || {}; const text = String(normalized.text || '').trim(); const isText = normalized.message_type === 'text'; const route_hint = !isText ? 'unsupported' : text.length < 4 ? 'clarification_needed' : 'classify'; return [{ json: { ...normalized, text, conversation_id: conversation.id || null, route_hint } }];"
    },
    position: [1440, 320]
  },
  output: [{ message_id: 'wamid-123', phone: '5492615550000', user_name: 'Estudiante FCE', message_type: 'text', text: '¿Cómo extiendo la regularidad?', conversation_id: 'conversation-id', route_hint: 'classify' }]
});

const getQueryEmbedding = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Get Query Embedding',
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/embeddings',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ { model: "text-embedding-3-small", input: $json.text } }}')
    },
    credentials: { httpHeaderAuth: newCredential('OpenAI API Key') },
    position: [1740, 320]
  },
  output: [{ data: [{ embedding: [0.1, 0.2, 0.3] }], text: '¿Cómo extiendo la regularidad?' }]
});

const faqCandidateLookup = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'FAQ Candidate Lookup',
    parameters: {
      operation: 'executeQuery',
      query: expr('{{ "with best as (select f.id, f.tema, f.subtemas, f.posible_pregunta, f.respuesta, 1 - (f.embedding <=> \'" + JSON.stringify($json.data[0].embedding) + "\'::vector) as similarity from faqs f where f.active = true and f.embedding is not null order by f.embedding <=> \'" + JSON.stringify($json.data[0].embedding) + "\'::vector limit 1) select id, tema, subtemas, posible_pregunta, respuesta, coalesce(similarity, 0) as similarity from best union all select null::uuid as id, null::text as tema, null::text as subtemas, null::text as posible_pregunta, null::text as respuesta, 0::double precision as similarity where not exists (select 1 from best);" }}')
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [2040, 220]
  },
  output: [{ id: 'faq-id', tema: 'Cursadas', subtemas: 'Regularidad', posible_pregunta: '¿Cuánto me dura la regularidad de una materia?', respuesta: 'La regularidad dura 14 mesas ordinarias.', similarity: 0.93 }]
});

const documentCandidateLookup = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Document Candidate Lookup',
    parameters: {
      operation: 'executeQuery',
      query: expr('{{ "with best as (select c.id, c.document_id, c.chunk_index, c.chunk_text, 1 - (c.embedding <=> \'" + JSON.stringify($(\"Get Query Embedding\").item.json.data[0].embedding) + "\'::vector) as similarity from document_chunks c join documents d on d.id = c.document_id where d.active = true and c.embedding is not null order by c.embedding <=> \'" + JSON.stringify($(\"Get Query Embedding\").item.json.data[0].embedding) + "\'::vector limit 1) select id, document_id, chunk_index, chunk_text, coalesce(similarity, 0) as similarity from best union all select null::uuid as id, null::uuid as document_id, null::integer as chunk_index, null::text as chunk_text, 0::double precision as similarity where not exists (select 1 from best);" }}')
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [2040, 420]
  },
  output: [{ id: 'chunk-id', document_id: 'doc-id', chunk_index: 0, chunk_text: 'La extensión de regularidad se puede solicitar por casos especiales.', similarity: 0.81 }]
});

const composeCandidateSignals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compose Candidate Signals',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const base = $('Basic Guardrails').item.json; const faq = $('FAQ Candidate Lookup').item?.json || {}; const doc = $('Document Candidate Lookup').item?.json || {}; return [{ json: { ...base, faq_candidate: { id: faq.id || null, tema: faq.tema || null, subtemas: faq.subtemas || null, posible_pregunta: faq.posible_pregunta || null, respuesta_preview: faq.respuesta ? String(faq.respuesta).slice(0, 280) : null, similarity: Number(faq.similarity || 0) }, document_candidate: { id: doc.id || null, document_id: doc.document_id || null, chunk_index: doc.chunk_index ?? null, chunk_preview: doc.chunk_text ? String(doc.chunk_text).slice(0, 280) : null, similarity: Number(doc.similarity || 0) } } }];"
    },
    position: [2340, 320]
  },
  output: [{ text: '¿Cómo extiendo la regularidad?', route_hint: 'classify', faq_candidate: { id: 'faq-id', posible_pregunta: '¿Cuánto me dura la regularidad de una materia?', similarity: 0.93 }, document_candidate: { id: 'chunk-id', similarity: 0.81 } }]
});

const queryTypeClassifier = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.1,
  config: {
    name: 'Query Type Classifier',
    parameters: {
      resource: 'text',
      operation: 'response',
      modelId: { mode: 'id', value: 'gpt-4.1-mini' },
      responses: {
        values: [
          {
            role: 'system',
            type: 'text',
            content: 'Clasifica la consulta segun su naturaleza, no segun la fuente de respuesta. Etiquetas permitidas: general_information, personal_case, ambiguous, human_handoff. Usa la evidencia recuperada solo como contexto auxiliar. Devuelve solo JSON con keys query_type, confidence y reason.'
          },
          {
            role: 'user',
            type: 'text',
            content: expr('{{ "Consulta del usuario: " + $json.text + "\\n\\nMejor FAQ candidata: " + ($json.faq_candidate?.posible_pregunta || "ninguna") + "\\nScore FAQ: " + Number($json.faq_candidate?.similarity || 0).toFixed(3) + "\\n\\nMejor documento candidato: " + ($json.document_candidate?.chunk_preview || "ninguno") + "\\nScore documento: " + Number($json.document_candidate?.similarity || 0).toFixed(3) }}')
          }
        ]
      },
      simplify: true,
      options: {
        instructions: 'Devuelve solo un JSON valido. No agregues texto adicional.',
        temperature: 0,
        store: false,
        textFormat: {
          textOptions: [
            {
              type: 'json_object'
            }
          ]
        }
      }
    },
    credentials: { openAiApi: newCredential('OpenAI API Key') },
    position: [2640, 320]
  },
  output: [{ output: [{ content: [{ text: { query_type: 'general_information', confidence: 0.88, reason: 'consulta general con posible respaldo institucional' } }] }] }]
});

const parseQueryType = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Query Type',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const base = $('Compose Candidate Signals').item.json; if (base.route_hint !== 'classify') { return [{ json: { ...base, query_type: base.route_hint === 'unsupported' ? 'unsupported' : 'ambiguous', classifier_confidence: 0, classifier_reason: 'guardrail' } }]; } const candidate = items[0]?.json || {}; const raw = candidate?.output?.[0]?.content?.[0]?.text ?? candidate?.output?.[0]?.content?.[0] ?? candidate?.text ?? candidate?.response ?? candidate; let parsed = raw; if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch { parsed = { query_type: 'ambiguous', confidence: 0, reason: 'invalid_classifier_output' }; } } if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { const nested = parsed.output?.[0]?.content?.[0]?.text; if (nested && typeof nested === 'object' && !Array.isArray(nested)) { parsed = nested; } } const queryType = typeof parsed?.query_type === 'string' ? parsed.query_type : 'ambiguous'; const classifierConfidence = Number(parsed?.confidence || 0); const classifierReason = parsed?.reason || (queryType === 'ambiguous' ? 'missing_query_type' : null); return [{ json: { ...base, query_type: queryType, classifier_confidence: classifierConfidence, classifier_reason: classifierReason } }];"
    },
    position: [2940, 320]
  },
  output: [{ text: '¿Cómo extiendo la regularidad?', query_type: 'general_information', classifier_confidence: 0.88, classifier_reason: 'consulta general con posible respaldo institucional', faq_candidate: { similarity: 0.93 }, document_candidate: { similarity: 0.81 } }]
});

const resolutionPolicy = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Resolution Policy',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const payload = items[0]?.json || {}; const text = String(payload.text || '').toLowerCase(); const faqScore = Number(payload.faq_candidate?.similarity || 0); const docScore = Number(payload.document_candidate?.similarity || 0); const faqStrong = faqScore >= 0.88; const faqWeak = faqScore >= 0.78; const docStrong = docScore >= 0.85; const docWeak = docScore >= 0.75; const humanSignals = /(rechaz|deneg|apel|error|problema|caso|situaci[oó]n|excepci[oó]n|ya present[eé]|me pasa|mi tr[aá]mite)/i.test(text); let intent = 'clarification_needed'; let reason = payload.classifier_reason || 'policy_default'; if (payload.route_hint === 'unsupported' || payload.query_type === 'unsupported') { intent = 'unsupported'; reason = 'unsupported_message_type'; } else if (payload.route_hint !== 'classify') { intent = 'clarification_needed'; reason = 'guardrail'; } else if (payload.query_type === 'human_handoff') { intent = 'human_handoff'; } else if (payload.query_type === 'personal_case' && humanSignals) { intent = 'human_handoff'; reason = 'personal_case_requires_review'; } else if (faqStrong && docStrong) { intent = 'hybrid'; reason = 'strong_faq_and_document_candidates'; } else if (faqStrong) { intent = 'faq'; reason = 'strong_faq_candidate'; } else if (docStrong) { intent = 'document_search'; reason = 'strong_document_candidate'; } else if (payload.query_type === 'personal_case') { if (docWeak) { intent = 'document_search'; reason = 'personal_case_with_document_support'; } else { intent = 'clarification_needed'; reason = 'personal_case_needs_details'; } } else if (payload.query_type === 'ambiguous') { intent = faqWeak || docWeak ? 'clarification_needed' : 'clarification_needed'; reason = faqWeak || docWeak ? 'medium_confidence_candidates' : 'ambiguous_query_type'; } else if (faqWeak || docWeak) { intent = 'clarification_needed'; reason = 'medium_confidence_candidates'; } else { intent = 'clarification_needed'; reason = 'no_grounded_source'; } return [{ json: { ...payload, intent, confidence: Math.max(faqScore, docScore, Number(payload.classifier_confidence || 0)), reason, routing_evidence: { faq_score: faqScore, document_score: docScore, classifier_confidence: Number(payload.classifier_confidence || 0), query_type: payload.query_type, faq_candidate_id: payload.faq_candidate?.id || null, document_candidate_id: payload.document_candidate?.id || null } } }];"
    },
    position: [3240, 320]
  },
  output: [{ text: '¿Cómo extiendo la regularidad?', intent: 'faq', confidence: 0.93, reason: 'strong_faq_candidate', routing_evidence: { faq_score: 0.93, document_score: 0.81, classifier_confidence: 0.88, query_type: 'general_information', faq_candidate_id: 'faq-id', document_candidate_id: 'chunk-id' } }]
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
    position: [3540, 320]
  }
});

const faqFlow = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'faq_answer_flow',
    parameters: {
      mode: 'once',
      workflowId: 'Q9pkNtiBoYRR0sXd',
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          text: expr('{{ $("Resolution Policy").item.json.text }}'),
          similarityThreshold: 0.84,
          maxMatches: 3
        }
      }
    },
    position: [3840, 100]
  },
  output: [{ status: 'answered', response_text: 'La regularidad dura 14 mesas ordinarias.', source_type: 'faq', source_ids: ['faq-id'], confidence: 0.93, needs_clarification: false, needs_handoff: false }]
});

const documentFlow = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'document_rag_flow',
    parameters: {
      mode: 'once',
      workflowId: 'eZ37dnCoNwU380ZE',
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          text: expr('{{ $("Resolution Policy").item.json.text }}'),
          similarityThreshold: 0.8,
          maxMatches: 5
        }
      }
    },
    position: [3840, 200]
  },
  output: [{ status: 'answered', response_text: 'La extensión puede solicitarse en casos especiales.', source_type: 'document', source_ids: ['chunk-id'], confidence: 0.87, needs_clarification: false, needs_handoff: false }]
});

const hybridFlow = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'hybrid_answer_flow',
    parameters: {
      mode: 'once',
      workflowId: 'nIp0C17sxu0hycMv',
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          faq_candidate: expr('{{ $("Compose Candidate Signals").item.json.faq_candidate }}'),
          document_candidate: expr('{{ $("Compose Candidate Signals").item.json.document_candidate }}')
        }
      }
    },
    position: [3840, 300]
  },
  output: [{ status: 'answered', response_text: 'Respuesta híbrida', source_type: 'hybrid', source_ids: ['faq-id', 'chunk-id'], confidence: 0.9, needs_clarification: false, needs_handoff: false }]
});

const clarificationFlow = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'clarification_flow',
    parameters: {
      mode: 'once',
      workflowId: '5ozyKlf1VKe7Qb6a',
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          text: expr('{{ $("Resolution Policy").item.json.text }}'),
          reason: expr('{{ $("Resolution Policy").item.json.reason }}')
        }
      }
    },
    position: [3840, 400]
  },
  output: [{ status: 'clarification_needed', response_text: 'Necesito más detalle para ayudarte.', source_type: 'clarification', source_ids: [], confidence: 0, needs_clarification: true, needs_handoff: false }]
});

const handoffFlow = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'handoff_flow',
    parameters: {
      mode: 'once',
      workflowId: 'Su3JQJ8jE0jTLebj',
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          conversation_id: expr('{{ $("Basic Guardrails").item.json.conversation_id }}'),
          reason: expr('{{ $("Resolution Policy").item.json.reason }}'),
          text: expr('{{ $("Resolution Policy").item.json.text }}')
        }
      }
    },
    position: [3840, 500]
  },
  output: [{ status: 'handoff', response_text: 'La consulta fue derivada.', source_type: 'handoff', source_ids: ['handoff-id'], confidence: 0, needs_clarification: false, needs_handoff: true }]
});

const unsupportedFlow = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'unsupported_message_flow',
    parameters: {
      mode: 'once',
      workflowId: '2gMSYsq7rFTUSKKg',
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          message_type: expr('{{ $("Basic Guardrails").item.json.message_type }}'),
          text: expr('{{ $("Resolution Policy").item.json.text }}')
        }
      }
    },
    position: [3840, 600]
  },
  output: [{ status: 'unsupported', response_text: 'Por ahora solo respondo texto.', source_type: 'unsupported', source_ids: [], confidence: 0, needs_clarification: false, needs_handoff: false }]
});

const buildReply = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Final Reply',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const result = items[0]?.json || {}; const base = $('Resolution Policy').item.json; return [{ json: { ...base, reply_text: result.response_text || 'No pude resolver tu consulta en este momento.', source_type: result.source_type || 'fallback', source_ids: result.source_ids || [], final_confidence: Number(result.confidence || 0), needs_handoff: Boolean(result.needs_handoff), status: result.status || 'fallback' } }];"
    },
    position: [4140, 320]
  },
  output: [{ phone: '5492615550000', conversation_id: 'conversation-id', reply_text: 'La regularidad dura 14 mesas ordinarias.', source_type: 'faq', source_ids: ['faq-id'], final_confidence: 0.93, status: 'answered', needs_handoff: false }]
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
    position: [4440, 220]
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
    position: [4440, 420]
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
      query: expr("{{ \"insert into interaction_logs (conversation_id, step, decision, confidence, payload_json) values ('\" + $(\"Build Final Reply\").item.json.conversation_id + \"', 'final_response', '\" + String($(\"Build Final Reply\").item.json.status || 'fallback').split(\"'\").join(\"''\") + \"', \" + Number($(\"Build Final Reply\").item.json.final_confidence || 0) + \", '\" + JSON.stringify({ source_type: $(\"Build Final Reply\").item.json.source_type, source_ids: $(\"Build Final Reply\").item.json.source_ids, intent: $(\"Build Final Reply\").item.json.intent, reason: $(\"Build Final Reply\").item.json.reason, needs_handoff: $(\"Build Final Reply\").item.json.needs_handoff, routing_evidence: $(\"Build Final Reply\").item.json.routing_evidence }).split(\"'\").join(\"''\") + \"'::jsonb);\" }}")
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [4740, 320]
  },
  output: [{}]
});

const webhookResponse = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond To Webhook',
    parameters: { respondWith: 'json', responseBody: '={"ok":true}' },
    position: [5040, 320]
  },
  output: [{ ok: true }]
});

export default workflow('chatbot-fce', 'Chatbot - FCE')
  .add(sticky('## Inbound flow\nNormaliza el payload, obtiene evidencia FAQ/documento, clasifica el tipo de consulta y aplica una política de resolución.', [normalizeInbound, upsertUser, openConversation, guardrails, getQueryEmbedding, faqCandidateLookup, documentCandidateLookup, composeCandidateSignals, queryTypeClassifier, parseQueryType, resolutionPolicy, routeByIntent], { color: 7 }))
  .add(sticky('## Reply and logs\nEnvía la respuesta por WhatsApp y registra trazabilidad completa.', [buildReply, persistInboundMessage, sendWhatsappReply, persistInteractionLog, webhookResponse], { color: 5 }))
  .add(webhookInbound)
  .to(normalizeInbound)
  .to(upsertUser)
  .to(openConversation)
  .to(guardrails)
  .to(getQueryEmbedding)
  .to(faqCandidateLookup)
  .to(documentCandidateLookup)
  .to(composeCandidateSignals)
  .to(queryTypeClassifier)
  .to(parseQueryType)
  .to(resolutionPolicy)
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
