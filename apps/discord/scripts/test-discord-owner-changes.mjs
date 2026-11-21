import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import {
  applyOwnerProjectChange, createOwnerChangeQueue, inspectOwnerProject, isOwnerDm,
  ownerChangeDecision, prepareOwnerDiscordChange, prepareOwnerProjectChange,
} from '../src/core/discord-owner-changes.mjs';

test('owner actions require the verified owner DM, with single-use confirmation tied to the session', () => {
  const ownerIds = new Set(['owner']);
  assert.ok(isOwnerDm({ key: 'dm:owner', userId: 'owner', ownerIds }));
  assert.ok(!isOwnerDm({ key: 'ch:owner', guildId: 'guild', userId: 'owner', ownerIds }));
  assert.ok(!isOwnerDm({ key: 'dm:owner', userId: 'another', ownerIds }));
  assert.ok(!isOwnerDm({ key: 'dm:another', userId: 'another', ownerIds }));
  let time = 0;
  const queue = createOwnerChangeQueue({ now: () => time, ttlMs: 100 });
  const plan = { label: 'change' };
  const first = queue.stage('dm:owner', 'session', plan);
  const approval = ownerChangeDecision(`/approve-change ${first}`);
  assert.deepEqual(approval, { approved: true, code: first });
  assert.equal(queue.consume('ch:owner', 'session', first), null);
  assert.equal(queue.consume('dm:other', 'session', first), null);
  assert.equal(queue.consume('dm:owner', 'session', '123456789012'), null);
  assert.throws(() => queue.stage('dm:owner', 'session', plan));
  assert.equal(queue.consume('dm:owner', 'session', approval.code), plan);
  assert.equal(queue.consume('dm:owner', 'session', approval.code), null);
  const second = queue.stage('dm:owner', 'session', plan);
  assert.equal(queue.consume('dm:owner', 'new-session', second), null);
  const third = queue.stage('dm:owner', 'new-session', plan);
  time = 100;
  assert.equal(queue.consume('dm:owner', 'new-session', third), null);
});

test('approved file edits revalidate the original state and protect private paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-change-test-'));
  try {
    execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
    fs.writeFileSync(path.join(root, 'test.txt'), 'first\nnext\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n');
    assert.match(inspectOwnerProject(root, { file: 'test.txt', start_line: 2 }), /next/);
    assert.match(inspectOwnerProject(root, {}), /test\.txt/);
    const plan = prepareOwnerProjectChange(root, { operation: 'replace', file: 'test.txt', before: 'first', after: 'updated' });
    assert.equal(fs.readFileSync(path.join(root, 'test.txt'), 'utf8'), 'first\nnext\n');
    applyOwnerProjectChange(root, plan);
    assert.equal(fs.readFileSync(path.join(root, 'test.txt'), 'utf8'), 'updated\nnext\n');
    assert.throws(() => applyOwnerProjectChange(root, plan), /已變更/);
    const create = prepareOwnerProjectChange(root, { operation: 'create', file: 'src/new.txt', after: 'new\n' });
    applyOwnerProjectChange(root, create);
    const remove = prepareOwnerProjectChange(root, { operation: 'delete', file: 'src/new.txt' });
    applyOwnerProjectChange(root, remove);
    assert.ok(!fs.existsSync(path.join(root, 'src/new.txt')));
    for (const file of ['../outside', '.env', 'apps/discord/config.json', 'state/key', '.git/config', 'ignored.txt']) {
      assert.throws(() => prepareOwnerProjectChange(root, { operation: 'create', file, after: 'x' }));
    }
    if (process.platform !== 'win32') {
      fs.symlinkSync(os.tmpdir(), path.join(root, 'link'), 'dir');
      assert.throws(() => prepareOwnerProjectChange(root, { operation: 'create', file: 'link/elsewhere', after: 'x' }));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Discord proposals use fixed mutation paths and preserve the exact preview', () => {
  const id = '123456789012345678';
  const data = { topic: 'New topic' };
  assert.deepEqual(prepareOwnerDiscordChange({ method: 'PATCH', route: `/channels/${id}`, data }), {
    kind: 'discord', channelId: id, preview: { method: 'PATCH', route: `/channels/${id}`, data },
  });
  assert.equal(prepareOwnerDiscordChange({ method: 'POST', route: `/guilds/${id}/roles`, data: { name: 'test' } }).guildId, id);
  for (const [method, route] of [
    ['GET', `/channels/${id}`], ['PATCH', `https://discord.com/channels/${id}`],
    ['PATCH', `/channels/${id}?extra=true`], ['PATCH', `/channels/${id}/../webhooks`],
    ['DELETE', `/guilds/${id}`], ['POST', `/webhooks/${id}/token`],
  ]) assert.throws(() => prepareOwnerDiscordChange({ method, route }));
});
