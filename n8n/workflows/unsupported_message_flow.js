import { workflow, trigger, node } from '@n8n/workflow-sdk';

const inbound = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: { name: 'Execute Workflow Trigger', position: [240, 300] },
  output: [{ message_type: 'image' }]
});

const buildResponse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Unsupported Response',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return items.map((item) => ({ json: { status: 'unsupported', response_text: 'Por ahora solo puedo responder consultas por texto. Si querés, enviame tu consulta escrita y la reviso.', source_type: 'unsupported', source_ids: [], confidence: 0, needs_clarification: false, needs_handoff: false, message_type: item.json.message_type || 'unknown' } }));"
    },
    position: [540, 300]
  },
  output: [{ status: 'unsupported', response_text: 'Por ahora solo puedo responder consultas por texto. Si querés, enviame tu consulta escrita y la reviso.', source_type: 'unsupported', source_ids: [], confidence: 0, needs_clarification: false, needs_handoff: false }]
});

export default workflow('unsupported-message-flow', 'unsupported_message_flow')
  .add(inbound)
  .to(buildResponse);
