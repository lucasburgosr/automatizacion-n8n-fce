import { workflow, trigger, node } from '@n8n/workflow-sdk';

const inbound = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: { name: 'Execute Workflow Trigger', position: [240, 300] },
  output: [{ text: 'Necesito ayuda con una materia', reason: 'low_confidence' }]
});

const buildClarification = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Clarification Message',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return items.map((item) => ({ json: { status: 'clarification_needed', response_text: 'Necesito un poco más de detalle para ayudarte mejor. Contame la carrera, materia o trámite puntual que querés consultar.', source_type: 'clarification', source_ids: [], confidence: 0, needs_clarification: true, needs_handoff: false, reason: item.json.reason || 'low_confidence' } }));"
    },
    position: [540, 300]
  },
  output: [{ status: 'clarification_needed', response_text: 'Necesito un poco más de detalle para ayudarte mejor. Contame la carrera, materia o trámite puntual que querés consultar.', source_type: 'clarification', source_ids: [], confidence: 0, needs_clarification: true, needs_handoff: false }]
});

export default workflow('clarification-flow', 'clarification_flow')
  .add(inbound)
  .to(buildClarification);
