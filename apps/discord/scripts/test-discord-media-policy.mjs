// Exercise the actual intake, prompt builder and view tool without Discord/model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeDiscordConfig, canAnalyzeMedia, shouldHandleGuildMessage,
  stripBotMention, conversationKeyFor, isConversationAllowed,
} from '../src/core/discord-core.mjs';
import { collectMediaAttachments, embedImages, stickerImages, stickerLabel } from '../src/core/discord-media.mjs';

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
console.log('Media policy: intake, mixed batches, previews, view_message, DMs and rollback passed.');
