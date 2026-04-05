import { workflow, trigger, node, sticky } from '@n8n/workflow-sdk';

const inbound = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'Execute Workflow Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'faq_result', type: 'object' },
          { name: 'document_result', type: 'object' },
          { name: 'faq_candidate', type: 'object' },
          { name: 'document_candidate', type: 'object' }
        ]
      }
    },
    position: [240, 300]
  },
  output: [{ faq_result: { status: 'answered', response_text: 'La regularidad dura 14 mesas ordinarias.', confidence: 0.91, source_ids: ['faq-id'] }, document_result: { status: 'answered', response_text: 'La extensión puede solicitarse en casos especiales.', confidence: 0.87, source_ids: ['chunk-id'] } }]
});

const mergeAnswer = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Merge Answers',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return items.map((item) => { const faq = item.json.faq_result || (item.json.faq_candidate ? { response_text: item.json.faq_candidate.respuesta_preview || null, confidence: item.json.faq_candidate.similarity || 0, source_ids: item.json.faq_candidate.id ? [item.json.faq_candidate.id] : [] } : {}); const documentResult = item.json.document_result || (item.json.document_candidate ? { response_text: item.json.document_candidate.chunk_preview || null, confidence: item.json.document_candidate.similarity || 0, source_ids: item.json.document_candidate.id ? [item.json.document_candidate.id] : [] } : {}); const parts = [faq.response_text, documentResult.response_text].filter(Boolean); const confidence = Math.max(Number(faq.confidence || 0), Number(documentResult.confidence || 0)); return { json: { status: parts.length ? 'answered' : 'low_confidence', response_text: parts.join('\\n\\n'), source_type: 'hybrid', source_ids: [...(faq.source_ids || []), ...(documentResult.source_ids || [])], confidence, needs_clarification: confidence < 0.84, needs_handoff: false } }; });"
    },
    position: [540, 300]
  },
  output: [{ status: 'answered', response_text: 'La regularidad dura 14 mesas ordinarias.\n\nLa extensión puede solicitarse en casos especiales.', source_type: 'hybrid', source_ids: ['faq-id', 'chunk-id'], confidence: 0.91, needs_clarification: false, needs_handoff: false }]
});

export default workflow('hybrid-answer-flow', 'hybrid_answer_flow')
  .add(sticky('## Hybrid answer\nCombina la mejor respuesta FAQ con el mejor contexto documental.', [mergeAnswer], { color: 6 }))
  .add(inbound)
  .to(mergeAnswer);
