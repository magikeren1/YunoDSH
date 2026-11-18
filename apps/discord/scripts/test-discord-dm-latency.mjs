import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatcher } from '../src/core/discord-batch.mjs';

test('DM batching uses a short window while guild batching keeps its configured delay', () => {
  const timers = new Map();
  const flushed = [];
  let time = 0, id = 0;
  const batcher = createBatcher({ debounceMs: 20000, maxWaitMs: 30000, maxMessages: 20,
    typingMs: 10000, now: () => time,
    timingForKey: key => key.startsWith('dm:') ? { debounceMs: 1200, maxWaitMs: 3000 } : {},
    setTimer: (callback, delay) => { const token = ++id; timers.set(token, { callback, at: time + delay }); return token; },
    clearTimer: token => timers.delete(token), onFlush: (key, items) => flushed.push({ key, items }),
  });
  batcher.add('dm:alice', { userId: 'alice', direct: true });
  batcher.add('ch:guild', { userId: 'bob', guildId: 'guild' });
  assert.deepEqual([...timers.values()].map(timer => timer.at), [1200, 20000]);
  time = 1100;
  batcher.extend('dm:alice', 'alice');
  assert([...timers.values()].some(timer => timer.at === 3000), 'typing cannot extend the DM batch past 3 seconds');
  time = 3000;
  for (const [token, timer] of timers) if (timer.at <= time) { timers.delete(token); timer.callback(); }
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].key, 'dm:alice');
});
