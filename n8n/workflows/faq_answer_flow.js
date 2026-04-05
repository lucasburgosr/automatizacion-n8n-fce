import { workflow, trigger, node, expr, newCredential, sticky } from '@n8n/workflow-sdk';

const inbound = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'Execute Workflow Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'text', type: 'string' },
          { name: 'similarityThreshold', type: 'number' },
          { name: 'maxMatches', type: 'number' }
        ]
      }
    },
    position: [240, 300]
  },
  output: [{ text: 'Necesito saber cuánto dura la regularidad de una materia', similarityThreshold: 0.84, maxMatches: 3 }]
});

const normalizeInput = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize FAQ Input',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return items.map((item) => { const text = String(item.json.text || '').trim(); return { json: { ...item.json, text, similarityThreshold: Number(item.json.similarityThreshold || 0.84), maxMatches: Number(item.json.maxMatches || 3) } }; });"
    },
    position: [540, 300]
  },
  output: [{ text: 'Necesito saber cuánto dura la regularidad de una materia', similarityThreshold: 0.84, maxMatches: 3 }]
});

const getEmbedding = node({
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
    position: [840, 300]
  },
  output: [{ data: [{ embedding: [0.1, 0.2, 0.3] }], text: 'Necesito saber cuánto dura la regularidad de una materia', similarityThreshold: 0.84, maxMatches: 3 }]
});

const queryFaqs = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Search FAQ Matches',
    parameters: {
      operation: 'executeQuery',
      query: expr('{{ "select * from match_faqs(\'" + JSON.stringify($json.data[0].embedding) + "\'::vector, " + ($json.similarityThreshold || 0.84) + ", " + ($json.maxMatches || 3) + ");" }}')
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [1140, 300]
  },
  output: [{ id: 'faq-id', tema: 'Cursadas', subtemas: 'Regularidad', posible_pregunta: '¿Cuánto me dura la regularidad de una materia?', respuesta: 'La regularidad dura 14 mesas ordinarias.', similarity: 0.93 }]
});

const buildResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build FAQ Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "if (!items.length) { return [{ json: { status: 'no_match', response_text: null, source_type: 'faq', source_ids: [], confidence: 0, needs_clarification: true, needs_handoff: false } }]; } const best = items[0].json; return [{ json: { status: best.similarity >= 0.84 ? 'answered' : 'low_confidence', response_text: best.respuesta || null, source_type: 'faq', source_ids: [best.id], confidence: Number(best.similarity || 0), needs_clarification: Number(best.similarity || 0) < 0.84, needs_handoff: false, matched_question: best.posible_pregunta || null } }];"
    },
    position: [1440, 300]
  },
  output: [{ status: 'answered', response_text: 'La regularidad dura 14 mesas ordinarias.', source_type: 'faq', source_ids: ['faq-id'], confidence: 0.93, needs_clarification: false, needs_handoff: false }]
});

export default workflow('faq-answer-flow', 'faq_answer_flow')
  .add(sticky('## FAQ semantic search\nGenera embedding, consulta `match_faqs` y devuelve un resultado estructurado.', [normalizeInput, getEmbedding, queryFaqs, buildResult], { color: 7 }))
  .add(inbound)
  .to(normalizeInput)
  .to(getEmbedding)
  .to(queryFaqs)
  .to(buildResult);
