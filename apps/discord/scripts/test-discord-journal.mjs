import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { openDiscordJournal } from '../src/core/discord-journal.mjs';
import { createDigestWorker, buildDigestPrompt } from '../src/core/discord-digest.mjs';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';
import { createTurnGate } from '../src/core/discord-batch.mjs';
import { createNotesStore, recordNote, loadNotesFile, saveNotesFile, NOTES_MAX_BYTES } from '../src/core/discord-notes.mjs';
import { createMemoryStore, rememberFact, loadMemoryFile, saveMemoryFile, forgetUser } from '../src/core/discord-memory.mjs';

const message = (id, overrides = {}) => ({ id, guildId: 'guild', channelId: 'channel',
  authorId: 'alice', name: 'Alice', text: `message ${id}`, at: 1000, ...overrides });
const source = { guildId: 'guild', channelId: 'channel', messageId: 'm1', authorId: 'alice', at: 1000 };
function fixture(t, options) {
  const dir = mkdtempSync(join(tmpdir(), 'discord-journal-'));
  const file = join(dir, 'journal.sqlite');
  let journal = openDiscordJournal(file, options);
  t.after(() => { journal.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, file, get journal() { return journal; },
    reopen() { journal.close(); journal = openDiscordJournal(file, options); return journal; } };
}

test('raw pending messages survive an abrupt child-process exit before batching', t => {
  const f = fixture(t);
  const module = pathToFileURL(join(import.meta.dirname, '../src/core/discord-journal.mjs')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { openDiscordJournal } from ${JSON.stringify(module)};
     const j=openDiscordJournal(${JSON.stringify(f.file)});
     j.observe(${JSON.stringify(message('raw'))}); j.queue('raw'); process.exit(17);`], { encoding: 'utf8' });
  assert.equal(child.status, 17, child.stderr);
  const recovered = [...f.journal.pendingMessages()];
  assert.equal(recovered[0].id, 'raw');
  assert.equal(recovered[0].author, 'alice');
  assert.equal(f.journal.observe(message('raw')), false, 'Gateway redelivery must not add another source row');
});

test('lost HTTP admission ACK survives journal reopening and uses the same DSH request ID', async t => {
  const f = fixture(t);
  const receipts = new Set();
  let lost = true;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const envelope = JSON.parse(body);
      receipts.add(envelope.payload.args.request.requestId);
      if (lost) { lost = false; response.destroy(); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId,
        result: { ok: true, value: { accepted: true } } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new NodeApiClient(`http://127.0.0.1:${server.address().port}`, 2000, {});
  // This fake Host deliberately has no credential exchange.
  client.hasAuth = () => false;
  f.journal.observe(message('m1')); f.journal.queue('m1');
  const payload = f.journal.prepare('ch:channel', { requestId: 'original-receipt', sessionId: 'session',
    mode: 'queue', content: [{ type: 'text', text: 'original frozen prompt' }] }, ['m1']);
  await assert.rejects(client.sessions.prompt(payload));
  f.reopen();
  const saved = [...f.journal.pendingRequests()][0];
  unwrap(await client.sessions.prompt(JSON.parse(saved.payload)), 'retry');
  f.journal.accept(saved.id);
  assert.equal(receipts.size, 1, 'the Host sees one logical request identity');
  assert.equal([...f.journal.pendingRequests()].length, 0);
  assert.equal([...f.journal.pendingMessages()].length, 0);
});

test('journal backpressure preserves older pending inputs rather than evicting them', t => {
  const f = fixture(t, { maxMessages: 1, maxRequests: 1, maxRequestBytes: 1000 });
  f.journal.observe(message('keep')); f.journal.queue('keep');
  assert.throws(() => f.journal.observe(message('overflow')), /full/);
  f.journal.prepare('ch:channel', { requestId: 'one', sessionId: 'session' }, ['keep']);
  assert.throws(() => f.journal.prepare('ch:channel', { requestId: 'two' }, []), /unacknowledged/);
  assert.equal([...f.journal.pendingRequests()][0].id, 'one');
  assert.equal(f.journal.source('keep').pending, 1);
});

test('empty/young channels do not invoke inference; new messages arriving during a digest remain pending', async t => {
  const f = fixture(t);
  let clock = 1000, calls = 0;
  const worker = createDigestWorker({ journal: f.journal, now: () => clock, allowed: async () => true,
    recoverSession: async () => {}, publish: async () => {}, summarize: async job => {
      calls++;
      assert(buildDigestPrompt(job).includes('"authorId":"alice"'));
      f.journal.observe(message('new', { at: clock, authorId: 'bob', name: 'Bob' }));
      return '已有共同決定';
    } });
  await worker(); assert.equal(calls, 0);
  f.journal.observe(message('old'));
  await worker(); assert.equal(calls, 0);
  clock += 3600000;
  await Promise.all([worker(), worker()]); assert.equal(calls, 1);
  assert.equal(f.journal.source('old').digested, 1);
  assert.equal(f.journal.source('new').digested, 0);
  await worker(); assert.equal(calls, 1, 'do not run another digest inside the hour');
});

test('crash after note persistence re-exports one note without another model request or duplicate note', async t => {
  const f = fixture(t);
  const notesFile = join(f.dir, 'notes.json');
  let clock = Date.now(), calls = 0, crash = true;
  let notes = createNotesStore();
  f.journal.observe(message('m1'));
  function publish(job) {
    recordNote(notes, { id: `digest-${job.id}`, guildId: 'guild', channelId: 'channel',
      text: job.result, by: 'summary', sources: [source], now: clock });
    saveNotesFile(notesFile, notes);
    if (crash) { crash = false; throw new Error('crash before export ACK'); }
  }
  const options = { now: () => clock, allowed: async () => true, recoverSession: async () => {},
    summarize: async () => { calls++; return '決定明天見'; }, publish };
  await createDigestWorker({ ...options, journal: f.journal })();
  assert.equal(f.journal.digest('channel').exported, 0);
  f.reopen();
  notes = loadNotesFile(notesFile).store;
  assert.equal(notes.notes.length, 1, 'the original note survived the crash');
  await createDigestWorker({ ...options, journal: f.journal })();
  assert.equal(calls, 1);
  assert.equal(notes.notes.length, 1);
  assert.equal(notes.notes[0].sources[0].authorId, 'alice');
  assert.equal(f.journal.digest('channel').exported, 1);
});

test('failed inference keeps frozen sources, throttles retries, and recovers the interrupted DSH Session', async t => {
  const f = fixture(t);
  f.journal.observe(message('m1'));
  let clock = 3601000, calls = 0;
  const recovered = [];
  const options = { journal: f.journal, now: () => clock, allowed: async () => true,
    publish: async () => {}, recoverSession: async id => recovered.push(id), summarize: async (job, onSession) => {
      calls++; onSession('interrupted-session');
      if (calls === 1) throw new Error('model timeout');
      assert.equal(job.sources.length, 1);
      return '恢復後的摘要';
    } };
  await createDigestWorker(options)();
  const id = f.journal.digest('channel').id;
  f.journal.observe(message('later', { at: clock }));
  await createDigestWorker(options)(); assert.equal(calls, 1);
  clock += 3600000;
  await createDigestWorker(options)();
  assert.equal(f.journal.digest('channel').id, id);
  assert.deepEqual(recovered, ['interrupted-session']);
  assert.equal(f.journal.source('later').digested, 0);
});

test('evidence survives memory/notes reload; wrong-speaker or cross-channel evidence is rejected', t => {
  const f = fixture(t);
  const memoryFile = join(f.dir, 'memory.json');
  const notesFile = join(f.dir, 'notes.json');
  const memory = createMemoryStore();
  assert.throws(() => rememberFact(memory, { userId: 'bob', fact: 'wrong person', sources: [source] }), /another Discord user/);
  rememberFact(memory, { userId: 'alice', name: 'Alice', fact: 'likes tea', sources: [source] });
  saveMemoryFile(memoryFile, memory);
  const restored = loadMemoryFile(memoryFile).store;
  assert.equal(restored.users.alice.facts[0].sources[0].messageId, 'm1');
  forgetUser(restored, { userId: 'alice' }); saveMemoryFile(memoryFile, restored);
  assert.equal(loadMemoryFile(memoryFile).store.users.alice, undefined);
  const notes = createNotesStore();
  assert.throws(() => recordNote(notes, { guildId: 'guild', channelId: 'other', text: 'bad', sources: [source] }), /another channel/);
  recordNote(notes, { guildId: 'guild', channelId: 'channel', text: 'good', sources: [source] });
  saveNotesFile(notesFile, notes);
  assert.equal(loadNotesFile(notesFile).store.notes[0].sources[0].authorId, 'alice');
  const previous = readFileSync(notesFile, 'utf8');
  assert.throws(() => saveNotesFile(notesFile, { notes: [{ text: 'x'.repeat(NOTES_MAX_BYTES) }] }), /byte limit/);
  assert.equal(readFileSync(notesFile, 'utf8'), previous, 'oversize writes must not destroy a readable store');
});

test('durable turn gating never merges a frozen request or drops older pending inputs', () => {
  const delivered = [];
  const gate = createTurnGate({ maxEntries: 2, preserveAllEntries: true, releaseMs: 1000,
    deliver: (_key, job) => delivered.push(job), setTimer: () => 1, clearTimer: () => {} });
  const job = id => ({ epoch: 0, entries: [{ id, at: 1 }], direct: false });
  gate.submit('key', job('busy'));
  gate.submit('key', { ...job('frozen'), requestId: 'receipt' });
  gate.submit('key', job('a')); gate.submit('key', job('b')); gate.submit('key', job('c'));
  for (let i = 0; i < 4; i++) gate.release('key');
  assert.deepEqual(delivered.flatMap(batch => batch.entries.map(entry => entry.id)), ['busy', 'frozen', 'a', 'b', 'c']);
  assert.equal(delivered[1].requestId, 'receipt');
  assert.equal(delivered[1].entries.length, 1);
});

test('explicit conversation reset cancels persisted jobs and never replays them into another Session', t => {
  const f = fixture(t);
  f.journal.observe(message('reset')); f.journal.queue('reset');
  f.journal.prepare('ch:channel', { requestId: 'old', sessionId: 'old-session' }, ['reset']);
  f.journal.cancelConversation('ch:channel');
  assert.throws(() => f.journal.prepare('ch:channel', { requestId: 'old', sessionId: 'old-session' }, ['reset']), /explicitly cancelled/);
  f.reopen();
  assert.equal([...f.journal.pendingRequests()].length, 0);
  assert.equal([...f.journal.pendingMessages()].length, 0);
});

test('live chat intake and admission remain usable while a digest is awaiting its model', async t => {
  const f = fixture(t);
  f.journal.observe(message('old'));
  let release;
  const model = new Promise(resolve => { release = resolve; });
  const worker = createDigestWorker({ journal: f.journal, now: () => 3601000,
    allowed: async () => true, recoverSession: async () => {}, publish: async () => {},
    summarize: async () => model });
  const digest = worker();
  await new Promise(resolve => setImmediate(resolve));
  f.journal.observe(message('chat', { authorId: 'bob', name: 'Bob' }));
  f.journal.queue('chat');
  f.journal.prepare('ch:channel', { requestId: 'chat-receipt', sessionId: 'session' }, ['chat']);
  f.journal.accept('chat-receipt');
  assert.equal(f.journal.source('chat').pending, 0);
  release('群組摘要'); await digest;
  assert.equal(f.journal.source('chat').digested, 0);
});
