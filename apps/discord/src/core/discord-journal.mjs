import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function openDiscordJournal(file, { maxMessages = 20000, maxRequests = 32, maxRequestBytes = 8 * 1024 * 1024 } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000; PRAGMA max_page_count=65536;
    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, channel TEXT NOT NULL,
      guild TEXT, author TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL,
      at INTEGER NOT NULL, pending INTEGER NOT NULL DEFAULT 0, digested INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS message_channel ON messages(channel,seq);
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, key TEXT NOT NULL, payload TEXT NOT NULL,
      accepted INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS request_sources (
      message TEXT PRIMARY KEY REFERENCES messages(id), request TEXT NOT NULL REFERENCES requests(id));
    CREATE TABLE IF NOT EXISTS digests (
      channel TEXT PRIMARY KEY, id TEXT NOT NULL, sources TEXT NOT NULL,
      result TEXT, exported INTEGER NOT NULL DEFAULT 0, attempted INTEGER NOT NULL DEFAULT 0,
      session TEXT);
    CREATE TABLE IF NOT EXISTS digest_clock (channel TEXT PRIMARY KEY, at INTEGER NOT NULL);`);
  function tx(action) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const read = row => row && ({ ...row, sources: JSON.parse(row.sources) });
  return {
    observe(message) {
      if (db.prepare('SELECT 1 FROM messages WHERE id=?').get(message.id)) return false;
      if (db.prepare('SELECT COUNT(*) AS n FROM messages').get().n >= maxMessages) {
        throw new Error('Discord journal is full; intake was not persisted. Resolve storage/backlog before retrying.');
      }
      db.prepare('INSERT INTO messages(id,channel,guild,author,name,text,at) VALUES(?,?,?,?,?,?,?)')
        .run(message.id, message.channelId, message.guildId ?? null, message.authorId,
          message.name, message.text.slice(0, 4000), message.at);
      return true;
    },
    queue(id) { db.prepare('UPDATE messages SET pending=1 WHERE id=?').run(id); },
    settle(ids) {
      tx(() => { for (const id of ids) db.prepare('UPDATE messages SET pending=0 WHERE id=?').run(id); });
    },
    cancelConversation(key) {
      return tx(() => {
        const [kind, id] = key.split(':');
        const rows = db.prepare(kind === 'ch'
          ? 'SELECT id FROM messages WHERE channel=? AND pending=1'
          : 'SELECT id FROM messages WHERE author=? AND guild IS NULL AND pending=1').all(id);
        for (const row of rows) db.prepare('UPDATE messages SET pending=0 WHERE id=?').run(row.id);
        // 0=pending, 1=admitted, 2=explicitly cancelled by conversation reset.
        db.prepare('UPDATE requests SET accepted=2 WHERE key=? AND accepted=0').run(key);
        return rows.map(row => row.id);
      });
    },
    pendingMessages() {
      return db.prepare(`SELECT * FROM messages m WHERE pending=1 AND NOT EXISTS
        (SELECT 1 FROM request_sources s WHERE s.message=m.id) ORDER BY seq`).iterate();
    },
    prepare(key, payload, ids, now = Date.now()) {
      return tx(() => {
        const existing = db.prepare('SELECT payload,accepted FROM requests WHERE id=?').get(payload.requestId);
        if (existing?.accepted === 2) throw new Error('Prepared request was explicitly cancelled');
        if (existing) return JSON.parse(existing.payload);
        const encoded = JSON.stringify(payload);
        if (Buffer.byteLength(encoded) > maxRequestBytes) throw new Error('Prepared Discord request exceeds journal byte limit');
        if (db.prepare('SELECT COUNT(*) AS n FROM requests WHERE accepted=0').get().n >= maxRequests) {
          throw new Error('Too many unacknowledged Discord requests; input remains pending in the journal');
        }
        db.prepare('INSERT INTO requests(id,key,payload,created) VALUES(?,?,?,?)').run(payload.requestId, key, encoded, now);
        for (const id of ids) db.prepare('INSERT INTO request_sources(message,request) VALUES(?,?)').run(id, payload.requestId);
        return payload;
      });
    },
    accept(id) {
      tx(() => {
        db.prepare('UPDATE requests SET accepted=1 WHERE id=? AND accepted=0').run(id);
        db.prepare('UPDATE messages SET pending=0 WHERE id IN (SELECT message FROM request_sources WHERE request=?)').run(id);
      });
    },
    pendingRequests() {
      return db.prepare('SELECT id,key,payload FROM requests WHERE accepted=0 ORDER BY created').iterate();
    },
    channels() { return db.prepare(`SELECT DISTINCT channel FROM messages WHERE guild IS NOT NULL AND digested=0
      UNION SELECT channel FROM digests WHERE exported=0`).all(); },
    source(id) { return id ? db.prepare('SELECT * FROM messages WHERE id=?').get(id) : undefined; },
    digest(channel) { return read(db.prepare('SELECT * FROM digests WHERE channel=?').get(channel)); },
    beginDigest(channel, { now = Date.now(), intervalMs = 3600000, maxChars = 6000, maxMessages: count = 100 } = {}) {
      return tx(() => {
        const current = read(db.prepare('SELECT * FROM digests WHERE channel=?').get(channel));
        if (current && (!current.exported || current.result === null)) {
          if (current.result === null && current.attempted && now - current.attempted < intervalMs) return null;
          return current;
        }
        const last = db.prepare('SELECT at FROM digest_clock WHERE channel=?').get(channel);
        const rows = db.prepare('SELECT * FROM messages WHERE channel=? AND digested=0 ORDER BY seq LIMIT ?').all(channel, count);
        if (!rows.length || now - (last?.at ?? rows[0].at) < intervalMs) return null;
        let chars = 0;
        const selected = [];
        for (const row of rows) {
          const size = row.text.length + row.name.length + row.author.length + 120;
          if (selected.length && chars + size > maxChars) break;
          selected.push(row); chars += size;
        }
        const job = { channel, id: randomUUID(), sources: selected, result: null, exported: 0, attempted: 0, session: null };
        db.prepare(`INSERT OR REPLACE INTO digests(channel,id,sources,result,exported,attempted,session)
          VALUES(?,?,?,NULL,0,0,NULL)`).run(channel, job.id, JSON.stringify(selected));
        return job;
      });
    },
    attemptDigest(channel, now = Date.now()) { db.prepare('UPDATE digests SET attempted=? WHERE channel=?').run(now, channel); },
    digestSession(channel, id) { db.prepare('UPDATE digests SET session=? WHERE channel=?').run(id, channel); },
    completeDigest(channel, result, now = Date.now()) {
      tx(() => {
        const job = read(db.prepare('SELECT * FROM digests WHERE channel=?').get(channel));
        if (!job || !result.trim()) throw new Error('A nonempty digest result is required');
        db.prepare('UPDATE digests SET result=? WHERE channel=?').run(result, channel);
        for (const source of job.sources) db.prepare('UPDATE messages SET digested=1 WHERE id=?').run(source.id);
        db.prepare('INSERT OR REPLACE INTO digest_clock(channel,at) VALUES(?,?)').run(channel, now);
      });
    },
    exportDigest(channel) { db.prepare('UPDATE digests SET exported=1 WHERE channel=? AND result IS NOT NULL').run(channel); },
    prune(now = Date.now(), retentionMs = 14 * 86400000) {
      tx(() => {
        db.prepare(`DELETE FROM request_sources WHERE request IN (SELECT id FROM requests WHERE accepted<>0 AND created<?)`).run(now - retentionMs);
        db.prepare('DELETE FROM requests WHERE accepted<>0 AND created<?').run(now - retentionMs);
        db.prepare(`DELETE FROM messages WHERE pending=0 AND (guild IS NULL OR digested=1) AND at<?
          AND NOT EXISTS (SELECT 1 FROM request_sources s WHERE s.message=messages.id)`).run(now - retentionMs);
      });
    },
    close() { db.close(); },
  };
}
