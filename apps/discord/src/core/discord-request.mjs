import { randomUUID } from 'node:crypto';

// Keep the same receipt identity when an offline job is replayed after a lost ACK.
// This identity currently lasts only as long as the in-memory job.
export function promptRequestForJob(job, { sessionId, content }) {
  job.requestId ??= randomUUID();
  return { sessionId, mode: 'queue', requestId: job.requestId, content };
}
