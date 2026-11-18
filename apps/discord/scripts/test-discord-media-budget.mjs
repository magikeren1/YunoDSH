import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaQueue, fetchDiscordMedia } from '../src/core/discord-media.mjs';

test('a full media waiting queue refuses new work, then recovers after active work finishes', async () => {
  const queue = createMediaQueue(1, { maxWaiting: 1 });
  let release;
  const first = queue(() => new Promise(resolve => { release = resolve; }));
  const second = queue(async () => 'second');
  await assert.rejects(queue(async () => 'overflow'), /queue is full/);
  await new Promise(resolve => setImmediate(resolve));
  release('first');
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.equal(await queue(async () => 'later'), 'later');
});

test('a CDN stream without Content-Length is stopped at the byte budget', async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024)); },
    cancel() { cancelled = true; },
  }));
  try {
    await assert.rejects(fetchDiscordMedia('https://cdn.discordapp.com/test.bin', { maxBytes: 1500 }), /超過/);
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = originalFetch; }
});
