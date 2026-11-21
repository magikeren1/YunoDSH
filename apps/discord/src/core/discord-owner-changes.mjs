import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SNOWFLAKE = '\\d{17,20}';
const PROJECT_BYTES = 1024 * 1024;
const CHANGE_BYTES = 28_000;
const PRIVATE_PARTS = new Set([
  '.git', '.agents', '.aws', '.codex', '.dsh', '.tools', 'node_modules', 'state', 'tmp', 'config.json',
]);
const HASH = (value) => createHash('sha256').update(value).digest('hex');

export function isOwnerDm({ key, guildId, userId, ownerIds }) {
  return Boolean(userId && !guildId && key === `dm:${userId}` && ownerIds.has(userId));
}

export function ownerChangeDecision(text) {
  const match = /^\/(approve-change|reject-change)\s+([a-f0-9]{12})\s*$/i.exec(String(text ?? '').trim());
  return match ? { approved: match[1].toLowerCase() === 'approve-change', code: match[2].toLowerCase() } : null;
}

export function createOwnerChangeQueue({ now = Date.now, ttlMs = 600_000 } = {}) {
  const pending = new Map();
  return {
    stage(key, sessionId, plan) {
      const current = pending.get(key);
      if (current?.sessionId === sessionId && current.expires > now()) throw new Error('已有一個待確認變更，請先確認或拒絕');
      const code = randomBytes(6).toString('hex');
      pending.set(key, { code, sessionId, plan, expires: now() + ttlMs });
      return code;
    },
    consume(key, sessionId, code) {
      const current = pending.get(key);
      if (!current || current.code !== code) return null;
      pending.delete(key);
      return current.sessionId === sessionId && current.expires > now() ? current.plan : null;
    },
  };
}

function isProjectPath(name) {
  if (typeof name !== 'string' || !name || name.length > 250 || /[\\:\x00-\x1f\x7f]/.test(name)) return false;
  return name.split('/').every((part) => {
    const lower = part.toLowerCase();
    return part && part !== '.' && part !== '..' && part === part.trim()
      && !PRIVATE_PARTS.has(lower) && !lower.startsWith('state.') && !lower.startsWith('config.json.')
      && (lower === '.env.example' || !lower.startsWith('.env'))
      && !/\.(pem|key|bundle|tar\.gz)$/i.test(part);
  });
}

function projectPath(root, name) {
  if (!isProjectPath(name)) throw new Error('請使用專案內的公開來源檔相對路徑');
  const ignored = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', name], {
    timeout: 2500, stdio: 'ignore', windowsHide: true,
  });
  if (ignored.status !== 1) throw new Error('這個路徑未開放專案工具讀寫');
  const parts = name.split('/');
  let current = root;
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    const item = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!item) continue;
    if (i === parts.length - 1 ? !item.isFile() : !item.isDirectory()) {
      throw new Error('專案工具只讀寫一般檔案與目錄');
    }
  }
  return current;
}

function readProjectText(file) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.size > PROJECT_BYTES) throw new Error('檔案太大，請在管理端處理');
  const bytes = fs.readFileSync(file);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('專案工具支援 UTF-8 文字檔');
  return { text, hash: HASH(bytes), mode: stat.mode & 0o777 };
}

export function inspectOwnerProject(root, { file, query, start_line = 1 }) {
  if (file) {
    if (!Number.isSafeInteger(start_line) || start_line < 1) throw new Error('start_line 必須是正整數');
    const existing = readProjectText(projectPath(root, file));
    if (!existing) throw new Error('找不到檔案');
    const lines = existing.text.split('\n');
    const text = lines.slice(start_line - 1, start_line + 199).join('\n');
    return `${file}（從第 ${start_line} 行，共 ${lines.length} 行）\n${text.slice(0, 18_000)}`;
  }
  const git = spawnSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8', timeout: 2500, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  });
  if (git.status !== 0) throw new Error('讀不到專案檔案清單');
  const files = [...new Set(git.stdout.split('\0'))].filter((name) => isProjectPath(name)
    && name.toLowerCase().includes(String(query ?? '').toLowerCase())).sort();
  return `${files.length} 個符合的路徑，列出前 120 個\n${files.slice(0, 120).join('\n')}`;
}

export function prepareOwnerProjectChange(root, { operation, file, before, after }) {
  const existing = readProjectText(projectPath(root, file));
  if (operation === 'create') {
    if (existing || typeof after !== 'string') throw new Error('新增需要尚不存在的檔案及內容');
  } else if (operation === 'replace') {
    if (!existing || typeof before !== 'string' || !before || typeof after !== 'string') throw new Error('替換需要現有檔案、原文及新文字');
    const start = existing.text.indexOf(before);
    if (start < 0 || start !== existing.text.lastIndexOf(before) || before === after) throw new Error('原文必須在檔案內恰好出現一次，且新文字要有變更');
  } else if (operation !== 'delete' || !existing) {
    throw new Error('刪除需要現有檔案');
  }
  const preview = { operation, file, ...(operation === 'replace' ? { before, after } : operation === 'create' ? { after } : {}) };
  if (Buffer.byteLength(JSON.stringify(preview)) > CHANGE_BYTES) throw new Error('變更過大，請分段提案');
  return { kind: 'project', preview, hash: existing?.hash ?? null, mode: existing?.mode ?? null };
}

export function applyOwnerProjectChange(root, { preview, hash, mode }) {
  const { operation, file, before, after } = preview;
  const target = projectPath(root, file);
  const existing = readProjectText(target);
  if ((existing?.hash ?? null) !== hash || (existing?.mode ?? null) !== mode) throw new Error('檔案已變更，請重新確認新的變更');
  if (operation === 'delete') {
    fs.unlinkSync(target);
    return;
  }
  const contents = operation === 'create' ? after : existing.text.replace(before, () => after);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.owner-change-${randomBytes(8).toString('hex')}`);
  try {
    fs.writeFileSync(temp, contents, { flag: 'wx', mode: mode ?? 0o644 });
    if (mode != null) fs.chmodSync(temp, mode);
    if (operation === 'create') fs.linkSync(temp, target);
    else fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Discord 路徑採精確範圍，主機、查詢字串、webhook token 或任意路徑都不進 REST。
const endpoint = (methods, suffix) => [methods.split(' '), new RegExp(`^${suffix.replaceAll(':id', SNOWFLAKE)}$`)];
const GUILD_MUTATIONS = [
  endpoint('PATCH', ''), endpoint('POST PATCH', '/channels'), endpoint('POST PATCH', '/roles'),
  endpoint('PATCH DELETE', '/roles/:id'), endpoint('PATCH DELETE', '/members/:id'),
  endpoint('PUT DELETE', '/members/:id/roles/:id'), endpoint('PUT DELETE', '/bans/:id'),
  endpoint('POST', '/emojis'), endpoint('PATCH DELETE', '/emojis/:id'),
  endpoint('POST', '/auto-moderation/rules'), endpoint('PATCH DELETE', '/auto-moderation/rules/:id'),
  endpoint('POST', '/scheduled-events'), endpoint('PATCH DELETE', '/scheduled-events/:id'),
  endpoint('PATCH', '/welcome-screen'), endpoint('PUT', '/onboarding'),
];
const CHANNEL_MUTATIONS = [
  endpoint('PATCH DELETE', ''), endpoint('PUT DELETE', '/permissions/:id'),
  endpoint('POST', '/messages'), endpoint('DELETE PATCH', '/messages/:id'),
  endpoint('POST', '/messages/bulk-delete'), endpoint('PUT DELETE', '/messages/pins/:id'),
  endpoint('POST', '/threads'), endpoint('POST', '/messages/:id/threads'),
  endpoint('PUT DELETE', '/thread-members/:id'),
];

export function prepareOwnerDiscordChange({ method, route, data }) {
  const target = new RegExp(`^/(guilds|channels)/(${SNOWFLAKE})(/[-a-z0-9/]+)?$`).exec(String(route ?? ''));
  const endpoints = target?.[1] === 'guilds' ? GUILD_MUTATIONS : CHANNEL_MUTATIONS;
  if (!target || !endpoints.some(([verbs, suffix]) => verbs.includes(method) && suffix.test(target[3] ?? ''))) {
    throw new Error('這不是已支援的 Discord 修改路徑');
  }
  if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data))) throw new Error('Discord 變更的資料必須是 JSON 物件');
  const preview = { method, route, ...(data === undefined ? {} : { data }) };
  if (Buffer.byteLength(JSON.stringify(preview)) > CHANGE_BYTES) throw new Error('變更過大，請分成較小的提案');
  return { kind: 'discord', preview, ...(target[1] === 'guilds' ? { guildId: target[2] } : { channelId: target[2] }) };
}
