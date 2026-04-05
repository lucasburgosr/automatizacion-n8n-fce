import { workflow, trigger, node, expr, newCredential, sticky } from '@n8n/workflow-sdk';

const inbound = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'Execute Workflow Trigger',
    parameters: {
      workflowInputs: {
        values: [
          { name: 'conversation_id', type: 'string' },
          { name: 'reason', type: 'string' },
          { name: 'text', type: 'string' }
        ]
      }
    },
    position: [240, 300]
  },
  output: [{ conversation_id: 'conv-id', reason: 'outside_scope', text: 'Necesito validar una excepción con una persona' }]
});

const registerHandoff = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Create Handoff Request',
    parameters: {
      operation: 'executeQuery',
      query: expr("{{ \"insert into handoff_requests (conversation_id, reason) values ('\" + $json.conversation_id + \"', '\" + String($json.reason || 'outside_scope').split(\"'\").join(\"''\") + \"') returning id, status;\" }}")
    },
    credentials: { postgres: newCredential('Postgres') },
    position: [540, 300]
  },
  output: [{ id: 'handoff-id', status: 'pending' }]
});

const buildHandoff = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Handoff Message',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return [{ json: { status: 'handoff', response_text: 'Tu consulta requiere revisión humana. Ya registré la derivación para que el equipo la continúe.', source_type: 'handoff', source_ids: items.map((item) => item.json.id), confidence: 0, needs_clarification: false, needs_handoff: true } }];"
    },
    position: [840, 300]
  },
  output: [{ status: 'handoff', response_text: 'Tu consulta requiere revisión humana. Ya registré la derivación para que el equipo la continúe.', source_type: 'handoff', source_ids: ['handoff-id'], confidence: 0, needs_clarification: false, needs_handoff: true }]
});

export default workflow('handoff-flow', 'handoff_flow')
  .add(sticky('## Human handoff\nRegistra la derivación y devuelve una respuesta estándar al usuario.', [registerHandoff, buildHandoff], { color: 4 }))
  .add(inbound)
  .to(registerHandoff)
  .to(buildHandoff);
