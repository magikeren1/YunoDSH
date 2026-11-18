import assert from 'node:assert/strict';
import { promptRequestForJob } from '../src/core/discord-request.mjs';

const receipts = new Map();
let loseAck = true;
function submit(job) {
  const request = promptRequestForJob(job, {
    sessionId: 'test-session', content: [{ type: 'text', text: 'hello' }],
  });
  if (!receipts.has(request.requestId)) receipts.set(request.requestId, request.content);
  if (loseAck) { loseAck = false; throw new Error('admitted, but acknowledgement lost'); }
  return request;
}
const job = {};
assert.throws(() => submit(job), /acknowledgement lost/);
const receiptId = job.requestId;
assert.equal(submit(job).requestId, receiptId);
assert.equal(receipts.size, 1, 'retry must identify the already admitted input');
submit({});
assert.equal(receipts.size, 2, 'distinct jobs must not share a receipt');
console.log('PASS: lost-ACK replay preserves identity; distinct jobs remain distinct.');
