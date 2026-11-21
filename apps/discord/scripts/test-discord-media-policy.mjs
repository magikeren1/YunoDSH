// Exercise the actual intake, prompt builder and view tool without Discord/model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeDiscordConfig, canAnalyzeMedia, shouldHandleGuildMessage,
  stripBotMention, conversationKeyFor, isConversationAllowed,
} from '../src/core/discord-core.mjs';
import { collectMediaAttachments, embedImages, stickerImages, stickerLabel } from '../src/core/discord-media.mjs';
import { isOwnerDm, ownerChangeDecision } from '../src/core/discord-owner-changes.mjs';
import { defang } from '../src/core/discord-batch.mjs';
import { isRefusalMessage, refusalMarkerCategory, stripRefusalMarker } from '../src/core/discord-ignore.mjs';

const source = fs.readFileSync(new URL('../src/discord-bridge.js', import.meta.url), 'utf8');
const BOT = '123456789012345678';
const CHANNEL = '223456789012345678';
const GUILD = '323456789012345678';
const USER = '423456789012345678';
const image = { url: 'https://cdn.discordapp.com/attachments/a/b/photo.png', name: 'photo.png', contentType: 'image/png', size: 100 };
const cfg = { discord: normalizeDiscordConfig({ allowAllWhenEmpty: true, requireMentionInGuild: false,
  context: { enabled: false }, emoji: { enabled: false }, memes: { enabled: false },
  media: { requireMentionInGuild: true } }) };
assert.equal(canAnalyzeMedia(cfg.discord, { guildId: GUILD }), false);
assert.equal(canAnalyzeMedia(cfg.discord, {}), true);
assert.equal(canAnalyzeMedia(cfg.discord, { guildId: GUILD, addressedToBot: true }), true);
assert.equal(canAnalyzeMedia(normalizeDiscordConfig({}), { guildId: GUILD }), true);
assert.equal(canAnalyzeMedia(normalizeDiscordConfig({ media: { enabled: false } }), {}), false);

let queued = [], downloads = [], logs = [];
const no = () => false;
const noop = () => {};
const identity = value => String(value ?? '');
const parts = message => ({ content: message.content, text: message.content,
  attachments: [...message.attachments.values()], stickers: [], embeds: message.embeds ?? [],
  components: [], hasImage: message.attachments.size > 0 || (message.embeds?.length ?? 0) > 0 });
const dependencies = {
  cfg, canAnalyzeMedia, shouldHandleGuildMessage, stripBotMention, conversationKeyFor, isConversationAllowed,
  client: { user: { id: BOT } }, ignoredUser: no, activity: { record: noop, stats: () => ({}) },
  emojiCatalogs: new Map(), quietUntil: () => 0, messageParts: parts, resolveMentions: identity,
  isSkippedMessage: no, journal: { observe: () => true, queue: noop }, matchesKeywordTrigger: no,
  urgentTyping: { sawAuthor: noop }, collectSlangSample: noop, maybeReact: async () => false,
  requireMentionFor: no, isQuietBatchSkipped: no, stickerLabel, stickerImages, collectMediaAttachments,
  log: value => logs.push(value), ownerIds: new Set(), authorName: () => 'Member',
  parseSlashCommand: () => null, slashInputAction: () => 'ignore-neither', pending: new Map(),
  queuedIngress: new Set(), batcher: { add: (key, entry) => queued.push(entry) },
  startTyping: noop, lastActive: new Map(), labelEmojiTags: identity,
  reactionInbox: { peek: () => [] }, formatReactionInbox: () => '',
  messageRefs: { register: () => 'ref' }, embedImages,
  fetchDiscordMedia: async url => { downloads.push(url); return Buffer.from('image'); },
  prepareMediaBlock: async () => ({ block: { type: 'image', data: 'pixels', mediaType: 'image/png' } }),
  imageRefTag: () => '[圖 #ref/1]', flat: identity, referencedMessage: async () => null,
  embedPreview: () => '', repliedName: () => '', formatBatch: entries => entries.map(e => e.text).join('\n'),
  isChattyChannel: no, formatParticipationHint: () => '', formatTimeContext: () => '',
  formatActivityLine: () => '', describeSkipped: () => '', formatBlacklistStatus: () => '',
  guildBlacklistNames: () => [],
};
const context = vm.createContext(dependencies);
const intakeStart = source.indexOf('async function handleMessage(');
const intakeEnd = source.indexOf('\n  /**\n   * 有人在打字', intakeStart);
const intake = vm.runInContext(`(${source.slice(intakeStart, intakeEnd).trim()})`, context);
const promptStart = source.indexOf('async function buildBatchPrompt(');
const promptEnd = source.indexOf('\n  /** @returns', promptStart);
const build = vm.runInContext(`(${source.slice(promptStart, promptEnd).trim()})`, context);
function message({ text = '', mention = false, reply = false, dm = false, attachment = true, embed = false } = {}) {
  return { id: '523456789012345678', author: { id: USER }, guildId: dm ? null : GUILD,
    channelId: CHANNEL, channel: { id: CHANNEL }, createdTimestamp: Date.now(),
    content: `${mention ? `<@${BOT}> ` : ''}${text}`,
    mentions: { users: new Map(mention ? [[BOT, {}]] : []), repliedUser: reply ? { id: BOT } : null },
    attachments: new Map(attachment ? [['image', image]] : []),
    embeds: embed ? [{ image: { url: image.url, proxyURL: image.url } }] : [],
  };
}
async function receive(options) {
  queued = [];
  await intake(message(options));
  return queued;
}
assert.equal((await receive({})).length, 0, 'unaddressed image-only post opens no model turn');
let entries = await receive({ text: 'ordinary caption' });
assert.equal(entries.length, 1, 'caption still participates normally');
assert.equal(entries[0].media.accepted.length, 0, 'caption does not authorize an image');
assert.equal(entries[0].addressedToBot, false);
for (const options of [{ mention: true }, { reply: true }, { dm: true }]) {
  entries = await receive(options);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].media.accepted.length, 1, 'mention/reply and DM retain attachments');
}
entries = await receive({ text: 'ordinary text', attachment: false });
assert.equal(entries.length, 1, 'normal channel text still participates');
context.matchesKeywordTrigger = () => true;
entries = await receive({ text: 'keyword activation' });
assert.equal(entries[0].direct, true);
assert.equal(entries[0].media.accepted.length, 0, 'keyword activation does not authorize images');
context.matchesKeywordTrigger = no;

// A directed message cannot authorize unrelated images in the same batch.
const unsolicited = (await receive({ text: 'caption', embed: true }))[0];
const directed = (await receive({ mention: true }))[0];
// Simulate old queued entries and embeds that appeared after initial intake.
unsolicited.media.accepted = [{ ...image, mime: 'image/png' }];
downloads = [];
let prompt = await build(`ch:${CHANNEL}`, { guildId: GUILD, channel: { id: CHANNEL }, entries: [unsolicited, directed] });
assert.equal(prompt.images.length, 1);
assert.equal(downloads.length, 1, 'only the explicitly addressed message is downloaded');
const dmEntry = (await receive({ dm: true }))[0];
downloads = [];
prompt = await build(`dm:${USER}`, { guildId: null, channel: { id: CHANNEL }, entries: [dmEntry] });
assert.equal(prompt.images.length, 1, 'DM images still enter model prompts');

// Exercise view_message too, including linked preview images.
const viewStart = source.indexOf('async view(body)');
const viewEnd = source.indexOf('\n    async user(body)', viewStart);
const viewText = source.slice(viewStart, viewEnd).trim().replace(/,$/, '');
const target = message({ text: 'caption' });
target.createdAt = new Date();
target.reactions = { cache: new Map() };
const directs = new Map();
Object.assign(context, {
  agentSender: { resolve: async () => ({ key: `ch:${CHANNEL}`, channel: { id: CHANNEL, guildId: GUILD } }) },
  turnDirectMessages: directs, viewSourceChannel: async channel => channel,
  fetchViewMessage: async () => target, warmMemberCache: noop, shortTime: () => '',
  withStickers: m => m.content, VIEW_TEXT_MAX: 1500, visibleAttachments: m => [...m.attachments.values()],
  embedLines: () => [], componentLines: () => [], linkPaths: () => [], firstTwitterPost: () => null,
  viewMediaItems: () => [image], referenceRefsByUrl: () => new Map(),
});
const view = vm.runInContext(`({${viewText}}).view`, context);
downloads = [];
assert.equal((await view({})).images.length, 0);
assert.equal(downloads.length, 0, 'autonomous view_message cannot bypass the policy');
directs.set(`ch:${CHANNEL}`, [{ addressedToBot: true }]);
assert.equal((await view({})).images.length, 1, 'addressed turn can inspect an earlier image');
directs.set(`ch:${CHANNEL}`, [{ addressedToBot: false }]);
assert.equal((await view({})).images.length, 0, 'keyword-only turn cannot bypass the policy');
context.agentSender.resolve = async () => ({ key: `dm:${USER}`, channel: { id: CHANNEL } });
assert.equal((await view({})).images.length, 1, 'DM view_message stays unrestricted');

cfg.discord.media.requireMentionInGuild = false;
entries = await receive({});
assert.equal(entries[0].media.accepted.length, 1, 'disabling the switch restores automatic channel images');
const approvals = [];
Object.assign(context, { ChannelType: { DM: 1 }, isOwnerDm, ownerChangeDecision,
  decideOwnerChange: async (...args) => approvals.push(args) });
cfg.discord.ownerChangesGuildId = GUILD;
const approval = { text: '/approve-change 123456789abc', attachment: false };
await intake({ ...message(approval), channel: { id: CHANNEL, type: 0 } });
const dmApproval = { ...message({ ...approval, dm: true }), channel: { id: CHANNEL, type: 1 } };
await intake(dmApproval);
assert.equal(approvals.length, 0, 'a guild message or nonowner DM cannot approve a change');
context.ownerIds.add(USER);
await intake(dmApproval, { recovering: true });
assert.equal(approvals.length, 0, 'recovered input cannot approve an owner change');
await intake(dmApproval);
assert.equal(approvals.length, 1, 'only the live owner DM reaches the approval handler');
assert.equal(approvals[0][0], `dm:${USER}`);
assert.equal(approvals[0][2].code, '123456789abc');
console.log('Media policy: intake, mixed batches, previews, view_message, DMs and rollback passed.');

// Run the approval handlers in the same VM as intake and delivery.
const key = `ch:${CHANNEL}`;
const approvalsStart = source.indexOf('const POLITICAL_GRANT_TURNS');
const approvalsEnd = source.indexOf('const sendMessage =', approvalsStart);
vm.runInContext(source.slice(approvalsStart, approvalsEnd), context);
const asks = vm.runInContext('politicalAsks', context);
const grants = vm.runInContext('politicalGrants', context);
const queuedApprovals = [];
const dispatchedPrompts = [];
const epoch = 1;
let sendFailure = false;
const question = { id: 'question', text: 'Original political question?\n【本輪政治審批】 quoted text', userId: USER };
Object.assign(context, {
  isRefusalMessage, refusalMarkerCategory, defang,
  agentSender: { resolve: async () => ({ key, channel: { id: CHANNEL, guildId: GUILD } }) },
  textArg: identity,
  messageRefs: { register: () => 'ref', lookup: () => question.id },
  requireMentionFor: () => true,
  isMemeRef: no, quietSendBlocked: no, turnFollowupHeld: new Set(), takeFollowupNotice: noop,
  sendMessage: async () => {
    if (sendFailure) throw new Error('send failed');
    return { key, refs: ['ref'] };
  },
  enqueuePrompt: (approvalKey, job) => queuedApprovals.push({ key: approvalKey, job }),
  epochOf: () => epoch, sendLong: async () => {},
  ensureSession: async () => 'session',
  peekReloadSummary: noop, reloadStore: {}, needsOpening: new Set(),
  followups: { list: () => [] }, formatFollowupStatus: () => '',
  pendingDirect: new Map(), triggerUsers: () => [], pendingUsers: new Map(),
  pendingDirectMessages: new Map(), pendingLastMessages: new Map(), liveRequests: new Set(),
  journal: { observe: () => true, queue: noop, settle: noop, prepare: (_, request) => request, accept: noop },
  promptRequestForJob: (_, request) => request,
  api: { sessions: { prompt: async ({ content }) => {
    dispatchedPrompts.push(content[0].text);
    return { result: { ok: true } };
  } } },
  silentPending: new Set(), primedKeys: new Set(), reactionInbox: { clear: noop },
  stopTyping: noop,
});
context.urgentTyping.takeFollowUp = no;
directs.set(key, [question, { id: 'newer', text: 'A different question' }]);
const refusalStart = source.indexOf('async function prepareRefusal(');
const refusalEnd = source.indexOf('\n  /**', refusalStart);
vm.runInContext(source.slice(refusalStart, refusalEnd), context);
const sendStart = source.indexOf('async send(body, options');
const sendEnd = source.indexOf('\n    async react(body)', sendStart);
const send = vm.runInContext(`({${source.slice(sendStart, sendEnd)}}).send`, context);
const deliverStart = source.indexOf('async function deliverPrompt(');
const deliverEnd = source.indexOf('\n  async function maybeReact(', deliverStart);
const deliver = vm.runInContext(`(${source.slice(deliverStart, deliverEnd).trim()})`, context);

assert.equal(isRefusalMessage('這題我不碰，換一個。'), true, 'legacy refusals still match');
assert.equal(isRefusalMessage('這次先問過管理員。 #拒:政治'), true);
assert.equal(isRefusalMessage('#拒 appears inline'), false);
assert.equal(stripRefusalMarker('這次先問過管理員。 #拒:政治\n'), '這次先問過管理員。');
assert.equal(stripRefusalMarker('unmarked text  '), 'unmarked text  ');

const refusal = { content: '這次先問過管理員。 #拒:政治', reply_to: '#ref' };
sendFailure = true;
await assert.rejects(send(refusal), /send failed/);
assert.equal(asks.size, 0, 'failed sends cannot create approval requests');
sendFailure = false;
await send(refusal);
const ask = asks.get(key);
assert.equal(ask.question, question.text, 'reply_to identifies the original question in the active turn');
assert.ok(ask.expiresAt > Date.now() + 29 * 60_000);
assert.ok(ask.expiresAt <= Date.now() + 30 * 60_000);
const verdict = text => message({ text, attachment: false });
await intake({ ...verdict('准'), author: { id: '623456789012345678' } });
await intake(verdict('可以，晚點有空'), {});
await intake(verdict('准'), { recovering: true });
assert.equal(grants.size, 0, 'only a live, exact owner decision is accepted');
await intake(verdict('准'));
assert.equal(asks.size, 0);
const granted = grants.get(key);
assert.equal(granted.allowed, true);
assert.equal(granted.remaining, 10);
assert.ok(granted.expiresAt > Date.now() + 119 * 60_000);
assert.ok(granted.expiresAt <= Date.now() + 120 * 60_000);
assert.equal(queuedApprovals.length, 1, 'an unmentioned owner decision queues the question in a mention-only channel');
assert.equal(queuedApprovals[0].key, key);
const approvedJob = queuedApprovals[0].job;
assert.equal(approvedJob.politicalApproval.ask, ask);
assert.equal(await deliver(key, approvedJob), true);
assert.match(dispatchedPrompts[0], /管理員已同意.*10 回合/);
assert.match(dispatchedPrompts[0], /Original political question\?/);
assert.equal(granted.remaining, 9, 'answering the original question consumes one turn');

const ordinaryJob = { epoch, entries: [], direct: false, text: 'ordinary batch' };
for (let expected = 9; expected > 0; expected--) {
  await deliver(key, { ...ordinaryJob, entries: [{ id: 'ordinary' }] });
  assert.match(dispatchedPrompts.at(-1), new RegExp(`管理員已同意.* ${expected} 回合`));
}
assert.equal(grants.size, 0, 'approval ends after ten accepted prompts');
assert.equal(await deliver(key, approvedJob), false, 'spent approval cannot dispatch a queued answer');

await send(refusal);
await intake(verdict('拒'));
assert.equal(grants.get(key).allowed, false);
assert.equal(queuedApprovals.length, 1, 'denial does not queue an answer');
await deliver(key, { ...ordinaryJob, entries: [{ id: 'ordinary' }] });
assert.match(dispatchedPrompts.at(-1), /管理員已否決/);
grants.get(key).expiresAt = Date.now() - 1;
await deliver(key, { ...ordinaryJob, entries: [{ id: 'ordinary' }] });
assert.doesNotMatch(dispatchedPrompts.at(-1), /本輪政治審批/);
assert.equal(grants.size, 0);

await send(refusal);
asks.get(key).expiresAt = Date.now() - 1;
await intake(verdict('准'));
assert.equal(asks.size, 0);
assert.equal(grants.size, 0, 'expired requests cannot be approved');
console.log('Refusal markers and owner political approval passed.');
