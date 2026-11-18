import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./build-discord-emojis.mjs', import.meta.url), 'utf8');
const loadStart = source.indexOf('function loadConfig()');
const loadEnd = source.indexOf('\nfunction readCatalog', loadStart);
const runStart = source.indexOf('async function runBatch(');
const runEnd = source.indexOf('\nasync function main()', runStart);
const selection = { provider: 'configured-provider', model: 'configured-model' };
for (const configured of [false, true]) {
  const selected = [], prompts = [], cleaned = [];
  let onPrompt;
  const prompted = new Promise(resolve => { onPrompt = resolve; });
  const api = {
    workspace: { create: async () => ({ workspace: { workspaceId: 'workspace' } }),
      archiveSession: async () => cleaned.push('archive') },
    sessions: { create: async () => ({ sessionId: 'session' }),
      selectModel: async value => { selected.push(value); return {}; },
      prompt: async value => { prompts.push(value); onPrompt(); return { result: { ok: true } }; } },
    stopSessionWork: async () => cleaned.push('stop'),
    events: { follow: () => {}, mux: async function* () {
      yield { payload: { type: 'session/snapshot', sessionId: 'session' } };
      await prompted;
      yield { payload: { type: 'session/event', sessionId: 'session', event: {} } };
    } },
  };
  const context = vm.createContext({
    fs: { readFileSync: () => JSON.stringify({ dsh: configured ? selection : {} }) },
    CONFIG_FILE: 'unused', normalizeDiscordConfig: () => ({ agentPreset: 'dc-chat' }),
    path: { join: (...args) => args.join('/') }, STATE_DIR: 'state', unwrap: value => value,
    AbortController, setTimeout, clearTimeout, BATCH_TIMEOUT_MS: 120000,
    prompt: () => 'describe emoji', extractJsonArray: JSON.parse,
    createTurnCollector: () => ({ push: () => ({ reason: { kind: 'completed' }, text: '[]' }) }),
  });
  const loadConfig = vm.runInContext(`(${source.slice(loadStart, loadEnd)})`, context);
  const runBatch = vm.runInContext(`(${source.slice(runStart, runEnd)})`, context);
  const cfg = loadConfig();
  if (!configured) assert.equal(cfg.dsh.provider + cfg.dsh.model, '', 'blank model inherits the DSH profile');
  await runBatch(api, cfg, [{ emoji: { name: 'smile' }, block: { type: 'image', data: 'pixels' } }]);
  assert.equal(selected.length, configured ? 1 : 0);
  if (configured) assert.equal(selected[0].model, selection.model);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].content[1].type, 'image');
  assert.deepEqual(cleaned, ['stop', 'archive']);
}
const matchStart = source.indexOf('const matchedIds = new Set();');
const matchEnd = source.indexOf('\n        await sleep(300);', matchStart);
const entries = new Map();
vm.runInNewContext(source.slice(matchStart, matchEnd), {
  entries, prepared: [
    { emoji: { id: 'one', name: 'same' }, hash: 'a' },
    { emoji: { id: 'two', name: 'same' }, hash: 'b' },
  ], result: [
    { name: 'same', description: 'first image', tags: [] },
    { name: 'same', description: 'second image', tags: [] },
  ],
});
assert.equal(entries.size, 2, 'duplicate emoji names retain both Discord IDs');
assert.equal(entries.get('two').description, 'second image');
console.log('Emoji builder: DSH model inheritance, explicit selection and duplicate names passed.');
