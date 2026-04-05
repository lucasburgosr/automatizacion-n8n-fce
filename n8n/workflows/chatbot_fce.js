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
  output: [{ body: { entry: [{ changes: [{ value: { contacts: [{ wa_id: '5492615550000', profile: { name: 'Estudiante FCE' } }], messages: [{ id: 'wamid-123', timestamp: '1710000000', type: 'text', text: { body: 'Hola' } }] } }] }] } }]
});

const normalizeInbound = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Inbound Payload',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return items.map((item) => { const value = item.json.body?.entry?.[0]?.changes?.[0]?.value || {}; const contact = value.contacts?.[0] || {}; const message = value.messages?.[0] || {}; const interactive = message.interactive || {}; const listReply = interactive.list_reply || {}; const buttonReply = interactive.button_reply || {}; const interactiveReplyId = listReply.id || buttonReply.id || null; const interactiveReplyTitle = listReply.title || buttonReply.title || null; const interactiveReplyDescription = listReply.description || buttonReply.description || null; const text = message.text?.body || interactiveReplyTitle || ''; return { json: { message_id: message.id || null, phone: contact.wa_id || null, user_name: contact.profile?.name || null, message_type: message.type || 'unknown', interactive_reply_type: listReply.id ? 'list_reply' : buttonReply.id ? 'button_reply' : null, interactive_reply_id: interactiveReplyId, interactive_reply_title: interactiveReplyTitle, interactive_reply_description: interactiveReplyDescription, text, timestamp: message.timestamp || null, raw_payload: item.json.body || item.json } }; });"
    },
    position: [540, 320]
  },
  output: [{ message_id: 'wamid-123', phone: '5492615550000', user_name: 'Estudiante FCE', message_type: 'text', text: 'Hola', timestamp: '1710000000', raw_payload: {} }]
});

const upsertUser = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Upsert User',
    parameters: {
      operation: 'executeQuery',
      query: expr('{{ "insert into users (phone, full_name, last_seen_at) values (\'" + $json.phone + "\', \'" + String($json.user_name || "").split("\'").join("\'\'") + "\', now()) on conflict (phone) do update set full_name = excluded.full_name, last_seen_at = now() returning id, phone, full_name;" }}')
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
      query: expr('{{ "with existing as (select id from conversations where user_id = \'" + $json.id + "\' and status = \'open\' order by last_message_at desc limit 1), created as (insert into conversations (user_id, status, started_at, last_message_at) select \'" + $json.id + "\', \'open\', now(), now() where not exists (select 1 from existing) returning id) select id from existing union all select id from created limit 1;" }}')
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
      jsCode: "const normalized = $('Normalize Inbound Payload').item.json; const conversation = items[0]?.json || {}; const originalText = String(normalized.text || '').trim(); const normalizedText = originalText.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9\\s]/g, ' ').replace(/\\s+/g, ' ').trim(); const interactiveId = String(normalized.interactive_reply_id || ''); const isTextLike = normalized.message_type === 'text' || normalized.message_type === 'interactive'; const isThemeSelection = interactiveId.startsWith('theme::'); const isFaqSelection = interactiveId.startsWith('faq::'); const selectedFaqId = isFaqSelection ? interactiveId.slice('faq::'.length) : null; const selectedTopic = isThemeSelection ? String(normalized.interactive_reply_title || '').trim() : null; const genericGreetings = new Set(['hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'inicio', 'menu', 'ayuda', 'help']); let route_hint = 'classify'; if (!isTextLike) { route_hint = 'unsupported'; } else if (isThemeSelection) { route_hint = 'topic_menu'; } else if (isFaqSelection) { route_hint = 'selected_faq'; } else if (genericGreetings.has(normalizedText)) { route_hint = 'welcome_menu'; } else if (originalText.length < 4) { route_hint = 'clarification_needed'; } return [{ json: { ...normalized, text: originalText, original_text: originalText, conversation_id: conversation.id || null, route_hint, selected_topic: selectedTopic, selected_faq_id: selectedFaqId } }];"
    },
    position: [1440, 320]
  },
  output: [{ message_id: 'wamid-123', phone: '5492615550000', user_name: 'Estudiante FCE', message_type: 'text', text: 'Hola', conversation_id: 'conversation-id', route_hint: 'welcome_menu' }]
});

const routeConversationEntry = switchCase({
  version: 3.4,
  config: {
    name: 'Route Conversation Entry',
    parameters: {
      mode: 'expression',
      output: '={{ ["welcome_menu","topic_menu","selected_faq","classify","clarification_needed","unsupported"].indexOf($json.route_hint) >= 0 ? ["welcome_menu","topic_menu","selected_faq","classify","clarification_needed","unsupported"].indexOf($json.route_hint) : 4 }}',
      numberOfOutputs: 6
    },
    position: [1740, 320]
  }
});

const loadFaqThemes = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Load FAQ Themes',
    parameters: {
      operation: 'executeQuery',
      query: "select tema, count(*)::int as faq_count from faqs where active = true and coalesce(trim(tema), '') <> '' group by tema order by lower(tema) limit 10;"
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [2040, 80]
  },
  output: [{ tema: 'Cursadas', faq_count: 8 }]
});

const buildWelcomeMenu = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Welcome Menu',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const truncate = (value, max) => { const text = String(value || '').trim().replace(/\\s+/g, ' '); if (text.length <= max) return text; const suffix = '...'; return `${text.slice(0, Math.max(0, max - suffix.length)).trim()}${suffix}`; }; const rows = items.map((item) => { const theme = String(item.json.tema || '').trim(); const count = Number(item.json.faq_count || 0); return theme ? { id: `theme::${theme.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, title: truncate(theme, 24), description: truncate(`${count} consultas frecuentes`, 72) } : null; }).filter(Boolean).slice(0, 10); if (!rows.length) { return [{ json: { status: 'guided_menu_unavailable', response_text: 'Hola. Puedo ayudarte con consultas academicas y administrativas de la FCE. Si queres, escribime tu pregunta directamente y sigo por el flujo habitual.', source_type: 'guided_menu', source_ids: [], confidence: 1, needs_clarification: false, needs_handoff: false, reply_kind: 'text' } }]; } return [{ json: { status: 'guided_menu', response_text: 'Hola. Te comparto temas frecuentes para orientarte.', source_type: 'guided_menu', source_ids: [], confidence: 1, needs_clarification: false, needs_handoff: false, reply_kind: 'interactive_list', outbound_payload: { type: 'interactive', interactive: { type: 'list', header: { type: 'text', text: 'Asistente FCE' }, body: { text: 'Hola. Elegi un tema para ver consultas frecuentes. Si no encontras tu opcion, escribi tu pregunta y sigo por el flujo habitual.' }, footer: { text: 'Tambien podes escribir tu consulta libremente.' }, action: { button: 'Ver temas', sections: [{ title: 'Temas', rows }] } } } } }];"
    },
    position: [2340, 80]
  },
  output: [{ status: 'guided_menu', response_text: 'Hola. Te comparto temas frecuentes para orientarte.', source_type: 'guided_menu', source_ids: [], confidence: 1, needs_handoff: false, reply_kind: 'interactive_list' }]
});

const loadThemeQuestions = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Load Theme Questions',
    parameters: {
      operation: 'executeQuery',
      query: expr('{{ "select id, tema, posible_pregunta from faqs where active = true and lower(tema) = lower(\'" + String($("Basic Guardrails").item.json.selected_topic || "").split("\'").join("\'\'") + "\') order by posible_pregunta asc limit 5;" }}')
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [2040, 180]
  },
  output: [{ id: 'faq-id', tema: 'Cursadas', posible_pregunta: 'Cuanto dura la regularidad de una materia?' }]
});

const buildThemeQuestionMenu = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Theme Question Menu',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const truncate = (value, max) => { const text = String(value || '').trim().replace(/\\s+/g, ' '); if (text.length <= max) return text; const suffix = '...'; return `${text.slice(0, Math.max(0, max - suffix.length)).trim()}${suffix}`; }; const base = $('Basic Guardrails').item.json; const theme = String(base.selected_topic || '').trim(); if (!theme || !items.length) { return [{ json: { status: 'guided_menu_theme_empty', response_text: `No encontre preguntas frecuentes para ${theme || 'ese tema'}. Si queres, escribime tu consulta directamente y sigo por el flujo habitual.`, source_type: 'guided_menu', source_ids: [], confidence: 1, needs_clarification: false, needs_handoff: false, reply_kind: 'text' } }]; } const rows = items.map((item, index) => ({ id: `faq::${item.json.id}`, title: truncate(`Pregunta ${index + 1}`, 24), description: truncate(String(item.json.posible_pregunta || ''), 72) })).slice(0, 5); return [{ json: { status: 'guided_menu_topic', response_text: `Estas son algunas consultas frecuentes sobre ${theme}.`, source_type: 'guided_menu', source_ids: items.map((item) => item.json.id), confidence: 1, needs_clarification: false, needs_handoff: false, reply_kind: 'interactive_list', outbound_payload: { type: 'interactive', interactive: { type: 'list', header: { type: 'text', text: truncate(theme, 60) }, body: { text: `Elegi una consulta frecuente sobre ${theme}. Si no esta aca, escribi tu pregunta y sigo por el flujo habitual.` }, footer: { text: 'Podes escribir una consulta distinta cuando quieras.' }, action: { button: 'Ver preguntas', sections: [{ title: truncate(theme, 24), rows }] } } } } }];"
    },
    position: [2340, 180]
  },
  output: [{ status: 'guided_menu_topic', response_text: 'Estas son algunas consultas frecuentes sobre Cursadas.', source_type: 'guided_menu', source_ids: ['faq-id'], confidence: 1, needs_handoff: false, reply_kind: 'interactive_list' }]
});

const loadSelectedFaq = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Load Selected FAQ',
    parameters: {
      operation: 'executeQuery',
      query: expr('{{ "select id, tema, subtemas, posible_pregunta, respuesta from faqs where active = true and id = \'" + String($("Basic Guardrails").item.json.selected_faq_id || "").split("\'").join("\'\'") + "\' limit 1;" }}')
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [2040, 280]
  },
  output: [{ id: 'faq-id', posible_pregunta: 'Cuanto dura la regularidad de una materia?', respuesta: 'La regularidad dura 14 mesas ordinarias.' }]
});

const buildSelectedFaqReply = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Selected FAQ Reply',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const selected = items[0]?.json || null; if (!selected?.id) { return [{ json: { status: 'clarification_needed', response_text: 'No pude recuperar esa opcion. Si queres, escribime tu consulta directamente y sigo por el flujo habitual.', source_type: 'faq_menu_selection', source_ids: [], confidence: 0, needs_clarification: true, needs_handoff: false } }]; } return [{ json: { status: 'answered', response_text: selected.respuesta || 'No encontre una respuesta para esa opcion.', source_type: 'faq', source_ids: [selected.id], confidence: 1, needs_clarification: false, needs_handoff: false, matched_question: selected.posible_pregunta || null } }];"
    },
    position: [2340, 280]
  },
  output: [{ status: 'answered', response_text: 'La regularidad dura 14 mesas ordinarias.', source_type: 'faq', source_ids: ['faq-id'], confidence: 1, needs_handoff: false }]
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
    position: [2040, 420]
  },
  output: [{ data: [{ embedding: [0.1, 0.2, 0.3] }], text: 'Como extiendo la regularidad?' }]
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
    position: [2340, 320]
  },
  output: [{ id: 'faq-id', tema: 'Cursadas', subtemas: 'Regularidad', posible_pregunta: 'Cuanto me dura la regularidad de una materia?', respuesta: 'La regularidad dura 14 mesas ordinarias.', similarity: 0.93 }]
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
    position: [2340, 520]
  },
  output: [{ id: 'chunk-id', document_id: 'doc-id', chunk_index: 0, chunk_text: 'La extension de regularidad se puede solicitar por casos especiales.', similarity: 0.81 }]
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
    position: [2640, 420]
  },
  output: [{ text: 'Como extiendo la regularidad?', route_hint: 'classify', faq_candidate: { similarity: 0.93 }, document_candidate: { similarity: 0.81 } }]
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
    position: [2940, 420]
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
      jsCode: "const base = $('Compose Candidate Signals').item.json; const candidate = items[0]?.json || {}; const raw = candidate?.output?.[0]?.content?.[0]?.text ?? candidate?.output?.[0]?.content?.[0] ?? candidate?.text ?? candidate?.response ?? candidate; let parsed = raw; if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch { parsed = { query_type: 'ambiguous', confidence: 0, reason: 'invalid_classifier_output' }; } } if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { const nested = parsed.output?.[0]?.content?.[0]?.text; if (nested && typeof nested === 'object' && !Array.isArray(nested)) { parsed = nested; } } const queryType = typeof parsed?.query_type === 'string' ? parsed.query_type : 'ambiguous'; const classifierConfidence = Number(parsed?.confidence || 0); const classifierReason = parsed?.reason || (queryType === 'ambiguous' ? 'missing_query_type' : null); return [{ json: { ...base, query_type: queryType, classifier_confidence: classifierConfidence, classifier_reason: classifierReason } }];"
    },
    position: [3240, 420]
  },
  output: [{ text: 'Como extiendo la regularidad?', query_type: 'general_information', classifier_confidence: 0.88, classifier_reason: 'consulta general con posible respaldo institucional' }]
});

const resolutionPolicy = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Resolution Policy',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const payload = items[0]?.json || {}; const text = String(payload.text || '').toLowerCase(); const faqScore = Number(payload.faq_candidate?.similarity || 0); const docScore = Number(payload.document_candidate?.similarity || 0); const faqStrong = faqScore >= 0.88; const faqWeak = faqScore >= 0.78; const docStrong = docScore >= 0.85; const docWeak = docScore >= 0.75; const humanSignals = /(rechaz|deneg|apel|error|problema|caso|situaci[oó]n|excepci[oó]n|ya present[eé]|me pasa|mi tr[aá]mite)/i.test(text); let intent = 'clarification_needed'; let reason = payload.classifier_reason || 'policy_default'; if (payload.query_type === 'human_handoff') { intent = 'human_handoff'; } else if (payload.query_type === 'personal_case' && humanSignals) { intent = 'human_handoff'; reason = 'personal_case_requires_review'; } else if (faqStrong && docStrong) { intent = 'hybrid'; reason = 'strong_faq_and_document_candidates'; } else if (faqStrong) { intent = 'faq'; reason = 'strong_faq_candidate'; } else if (docStrong) { intent = 'document_search'; reason = 'strong_document_candidate'; } else if (payload.query_type === 'personal_case') { intent = docWeak ? 'document_search' : 'clarification_needed'; reason = docWeak ? 'personal_case_with_document_support' : 'personal_case_needs_details'; } else if (payload.query_type === 'ambiguous' || faqWeak || docWeak) { intent = 'clarification_needed'; reason = faqWeak || docWeak ? 'medium_confidence_candidates' : 'ambiguous_query_type'; } else { intent = 'clarification_needed'; reason = 'no_grounded_source'; } return [{ json: { ...payload, intent, confidence: Math.max(faqScore, docScore, Number(payload.classifier_confidence || 0)), reason, routing_evidence: { faq_score: faqScore, document_score: docScore, classifier_confidence: Number(payload.classifier_confidence || 0), query_type: payload.query_type, faq_candidate_id: payload.faq_candidate?.id || null, document_candidate_id: payload.document_candidate?.id || null } } }];"
    },
    position: [3540, 420]
  },
  output: [{ text: 'Como extiendo la regularidad?', intent: 'faq', confidence: 0.93, reason: 'strong_faq_candidate' }]
});
const routeByIntent = switchCase({
  version: 3.4,
  config: {
    name: 'Route by Intent',
    parameters: {
      mode: 'expression',
      output: '={{ ["faq","document_search","hybrid","clarification_needed","human_handoff"].indexOf($json.intent) >= 0 ? ["faq","document_search","hybrid","clarification_needed","human_handoff"].indexOf($json.intent) : 3 }}',
      numberOfOutputs: 5
    },
    position: [3840, 420]
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
    position: [4140, 220]
  },
  output: [{ status: 'answered', response_text: 'La regularidad dura 14 mesas ordinarias.', source_type: 'faq', source_ids: ['faq-id'], confidence: 0.93, needs_handoff: false }]
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
    position: [4140, 320]
  },
  output: [{ status: 'answered', response_text: 'La extension puede solicitarse en casos especiales.', source_type: 'document', source_ids: ['chunk-id'], confidence: 0.87, needs_handoff: false }]
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
    position: [4140, 420]
  },
  output: [{ status: 'answered', response_text: 'Respuesta hibrida', source_type: 'hybrid', source_ids: ['faq-id', 'chunk-id'], confidence: 0.9, needs_handoff: false }]
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
          text: expr('{{ $("Basic Guardrails").item.json.text }}'),
          reason: expr('{{ $("Basic Guardrails").item.json.route_hint === "clarification_needed" ? "short_message_without_signal" : $("Resolution Policy").item.json.reason }}')
        }
      }
    },
    position: [4140, 520]
  },
  output: [{ status: 'clarification_needed', response_text: 'Necesito mas detalle para ayudarte.', source_type: 'clarification', source_ids: [], confidence: 0, needs_handoff: false }]
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
    position: [4140, 620]
  },
  output: [{ status: 'handoff', response_text: 'La consulta fue derivada.', source_type: 'handoff', source_ids: ['handoff-id'], confidence: 0, needs_handoff: true }]
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
          text: expr('{{ $("Basic Guardrails").item.json.text }}')
        }
      }
    },
    position: [4140, 720]
  },
  output: [{ status: 'unsupported', response_text: 'Por ahora solo respondo texto.', source_type: 'unsupported', source_ids: [], confidence: 0, needs_handoff: false }]
});

const buildReply = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Final Reply',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const result = items[0]?.json || {}; const base = $('Basic Guardrails').item.json; let resolution = {}; try { resolution = $('Resolution Policy').item.json || {}; } catch {} return [{ json: { ...base, ...resolution, reply_text: result.response_text || 'No pude resolver tu consulta en este momento.', source_type: result.source_type || 'fallback', source_ids: result.source_ids || [], final_confidence: Number(result.confidence || 0), needs_handoff: Boolean(result.needs_handoff), status: result.status || 'fallback', reply_kind: result.reply_kind || 'text', outbound_payload: result.outbound_payload || null, matched_question: result.matched_question || null } }];"
    },
    position: [4440, 420]
  },
  output: [{ phone: '5492615550000', conversation_id: 'conversation-id', reply_text: 'La regularidad dura 14 mesas ordinarias.', source_type: 'faq', source_ids: ['faq-id'], final_confidence: 0.93, status: 'answered', needs_handoff: false, reply_kind: 'text' }]
});

const buildWhatsappRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build WhatsApp Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return items.map((item) => { const reply = item.json; const normalizedPhone = String(reply.phone || '').replace('549', '54'); const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: normalizedPhone }; const payload = reply.reply_kind === 'interactive_list' && reply.outbound_payload?.interactive ? { ...base, type: 'interactive', interactive: reply.outbound_payload.interactive } : { ...base, type: 'text', text: { preview_url: false, body: reply.reply_text } }; return { json: { ...reply, phone: normalizedPhone, whatsapp_request_body: payload } }; });"
    },
    position: [4740, 420]
  },
  output: [{ phone: '542615550000', whatsapp_request_body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: '542615550000', type: 'text', text: { preview_url: false, body: 'La regularidad dura 14 mesas ordinarias.' } } }]
});

const persistInboundMessage = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Persist Inbound Message',
    parameters: {
      operation: 'executeQuery',
      query: expr('{{ "insert into messages (conversation_id, external_message_id, direction, message_type, body, raw_payload) values (\'" + $json.conversation_id + "\', \'" + String($json.message_id || "").split("\'").join("\'\'") + "\', \'inbound\', \'" + String($json.message_type || "unknown").split("\'").join("\'\'") + "\', \'" + String($json.original_text || $json.text || "").split("\'").join("\'\'") + "\', \'" + JSON.stringify($json.raw_payload || {}).split("\'").join("\'\'") + "\'::jsonb) returning id;" }}')
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [4740, 240]
  },
  output: [{ id: 'message-id' }]
});

const sendWhatsappReply = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Send WhatsApp Reply',
    parameters: {
      method: 'POST',
      url: expr('{{ "https://graph.facebook.com/" + ($env.WHATSAPP_GRAPH_VERSION || "v22.0") + "/" + ($env.WHATSAPP_PHONE_NUMBER_ID || "replace-me") + "/messages" }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'whatsAppApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ ...($json.whatsapp_request_body || { messaging_product: "whatsapp", recipient_type: "individual", type: "text", text: { preview_url: false, body: $json.reply_text || "No pude resolver tu consulta en este momento." } }), to: ($json.phone || $json.whatsapp_request_body?.to || "").replace("549", "54") }) }}')
    },
    credentials: { whatsAppApi: newCredential('WhatsApp Cloud API') },
    position: [5040, 420]
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
      query: expr('{{ "insert into interaction_logs (conversation_id, step, decision, confidence, payload_json) values (\'" + $("Build Final Reply").item.json.conversation_id + "\', \'final_response\', \'" + String($("Build Final Reply").item.json.status || "fallback").split("\'").join("\'\'") + "\', " + Number($("Build Final Reply").item.json.final_confidence || 0) + ", \'" + JSON.stringify({ source_type: $("Build Final Reply").item.json.source_type, source_ids: $("Build Final Reply").item.json.source_ids, reply_kind: $("Build Final Reply").item.json.reply_kind, matched_question: $("Build Final Reply").item.json.matched_question, route_hint: $("Build Final Reply").item.json.route_hint, selected_topic: $("Build Final Reply").item.json.selected_topic, selected_faq_id: $("Build Final Reply").item.json.selected_faq_id, intent: $("Build Final Reply").item.json.intent || null, reason: $("Build Final Reply").item.json.reason || null, routing_evidence: $("Build Final Reply").item.json.routing_evidence || null, needs_handoff: $("Build Final Reply").item.json.needs_handoff }).split("\'").join("\'\'") + "\'::jsonb);" }}')
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [5340, 420]
  },
  output: [{}]
});

const webhookResponse = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond To Webhook',
    parameters: { respondWith: 'json', responseBody: '={"ok":true}' },
    position: [5640, 420]
  },
  output: [{ ok: true }]
});
export default workflow('chatbot-fce', 'Chatbot - FCE')
  .add(sticky('## Entrada y menu guiado\nNormaliza el payload, detecta saludos y selecciones interactivas, y arma menus dinamicos desde `faqs`.', [normalizeInbound, upsertUser, openConversation, guardrails, routeConversationEntry, loadFaqThemes, buildWelcomeMenu, loadThemeQuestions, buildThemeQuestionMenu, loadSelectedFaq, buildSelectedFaqReply], { color: 7 }))
  .add(sticky('## Resolucion estandar\nSi no aplica menu guiado, obtiene evidencia FAQ/documento, clasifica y resuelve por politica.', [getQueryEmbedding, faqCandidateLookup, documentCandidateLookup, composeCandidateSignals, queryTypeClassifier, parseQueryType, resolutionPolicy, routeByIntent], { color: 6 }))
  .add(sticky('## Reply and logs\nArma el payload de WhatsApp, envia por HTTP Request a Meta y registra trazabilidad.', [faqFlow, documentFlow, hybridFlow, clarificationFlow, handoffFlow, unsupportedFlow, buildReply, buildWhatsappRequest, persistInboundMessage, sendWhatsappReply, persistInteractionLog, webhookResponse], { color: 5 }))
  .add(webhookInbound)
  .to(normalizeInbound)
  .to(upsertUser)
  .to(openConversation)
  .to(guardrails)
  .to(routeConversationEntry
    .onCase(0, loadFaqThemes.to(buildWelcomeMenu).to(buildReply))
    .onCase(1, loadThemeQuestions.to(buildThemeQuestionMenu).to(buildReply))
    .onCase(2, loadSelectedFaq.to(buildSelectedFaqReply).to(buildReply))
    .onCase(3, getQueryEmbedding
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
        .onCase(4, handoffFlow.to(buildReply))))
    .onCase(4, clarificationFlow.to(buildReply))
    .onCase(5, unsupportedFlow.to(buildReply)))
  .add(buildReply)
  .to(buildWhatsappRequest)
  .to(persistInboundMessage)
  .to(sendWhatsappReply)
  .to(persistInteractionLog)
  .to(webhookResponse);
