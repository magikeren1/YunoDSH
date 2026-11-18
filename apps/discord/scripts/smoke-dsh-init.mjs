import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';

const client = new NodeApiClient('http://127.0.0.1:3080', 15000, {});
const presets = unwrap(await client.agentPresets.list({}), 'agentPresets/list').presets;
assert(presets.some(preset => preset.id === 'dc-chat'));
const workspacePath = resolve('state/dsh-smoke-workspace');
mkdirSync(workspacePath, { recursive: true });
const workspace = unwrap(await client.workspace.create({ path: workspacePath }), 'workspace/create').workspace;
let sessionId;
try {
  ({ sessionId } = unwrap(await client.sessions.create({
    workspaceId: workspace.workspaceId, agentPreset: 'dc-chat',
  }), 'session/create'));
  assert(sessionId);
  const state = await client.callUnary('session/state', { sessionId });
  assert(state.result.ok, JSON.stringify(state.result.error));
  await client.stopSessionWork(sessionId);
  console.log('PASS: dc-chat registration, workspace/Session creation, state, and cancellation. No model request sent.');
} finally {
  if (sessionId) {
    unwrap(await client.workspace.archiveSession({ sessionId }), 'workspace/archiveSession');
    await client.stopSessionWork(sessionId);
  }
}
