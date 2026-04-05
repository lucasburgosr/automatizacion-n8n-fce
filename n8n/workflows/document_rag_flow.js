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
  output: [{ text: 'Necesito saber cómo pedir una extensión de regularidad', similarityThreshold: 0.8, maxMatches: 5 }]
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
    position: [540, 300]
  },
  output: [{ text: 'Necesito saber cómo pedir una extensión de regularidad', data: [{ embedding: [0.1, 0.2, 0.3] }], similarityThreshold: 0.8, maxMatches: 5 }]
});

const searchDocuments = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Search Document Chunks',
    parameters: {
      operation: 'executeQuery',
      query: expr('{{ "select * from match_document_chunks(\'" + JSON.stringify($json.data[0].embedding) + "\'::vector, " + ($json.similarityThreshold || 0.8) + ", " + ($json.maxMatches || 5) + ");" }}')
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [840, 300]
  },
  output: [{ id: 'chunk-1', document_id: 'doc-1', chunk_index: 0, chunk_text: 'La extensión de regularidad se puede solicitar por casos especiales.', similarity: 0.88 }]
});

const composeContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compose Context',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "if (!items.length) { return [{ json: { query: '', context: '', matches: [], best_similarity: 0 } }]; } const query = $('Execute Workflow Trigger').item.json.text || ''; const matches = items.map((item) => item.json); const context = matches.map((match, index) => `Fuente ${index + 1}: ${match.chunk_text}`).join('\\n\\n'); return [{ json: { query, context, matches, best_similarity: Number(matches[0].similarity || 0) } }];"
    },
    position: [1140, 300]
  },
  output: [{ query: 'Necesito saber cómo pedir una extensión de regularidad', context: 'Fuente 1: La extensión de regularidad se puede solicitar por casos especiales.', matches: [{ id: 'chunk-1', similarity: 0.88 }], best_similarity: 0.88 }]
});

const draftResponse = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.1,
  config: {
    name: 'Generate Grounded Answer',
    parameters: {
      resource: 'text',
      operation: 'response',
      modelId: { mode: 'id', value: 'gpt-4.1-mini' },
      responses: {
        values: [
          {
            role: 'system',
            type: 'text',
            content: 'Responde solo con informacion del contexto. Si el contexto no alcanza, dilo explicitamente.'
          },
          {
            role: 'user',
            type: 'text',
            content: expr('{{ "Consulta: " + $json.query + "\\n\\nContexto:\\n" + $json.context }}')
          }
        ]
      },
      simplify: true,
      options: {
        temperature: 0.1,
        store: false
      }
    },
    credentials: { openAiApi: newCredential('OpenAI API Key') },
    position: [1440, 300]
  },
  output: [{ output: [{ content: [{ text: 'Podes pedir una extension en casos especiales como licencias o movilidad estudiantil.' }] }] }]
});

const buildResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Document Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const root = items[0]?.json || {}; const source = $('Compose Context').item.json; const response = root.output?.[0]?.content?.[0]?.text || null; const confidence = Number(source.best_similarity || 0); return [{ json: { status: response && confidence >= 0.8 ? 'answered' : 'low_confidence', response_text: response, source_type: 'document', source_ids: (source.matches || []).map((item) => item.id), confidence, needs_clarification: confidence < 0.8, needs_handoff: false } }];"
    },
    position: [1740, 300]
  },
  output: [{ status: 'answered', response_text: 'Podés pedir una extensión en casos especiales como licencias o movilidad estudiantil.', source_type: 'document', source_ids: ['chunk-1'], confidence: 0.88, needs_clarification: false, needs_handoff: false }]
});

export default workflow('document-rag-flow', 'document_rag_flow')
  .add(sticky('## Document RAG\nConsulta `match_document_chunks` y genera una respuesta acotada al contexto recuperado.', [getEmbedding, searchDocuments, composeContext, draftResponse, buildResult], { color: 5 }))
  .add(inbound)
  .to(getEmbedding)
  .to(searchDocuments)
  .to(composeContext)
  .to(draftResponse)
  .to(buildResult);
