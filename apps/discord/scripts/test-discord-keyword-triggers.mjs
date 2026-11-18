import assert from 'node:assert/strict';
import { matchesKeywordTrigger, normalizeDiscordConfig } from '../src/core/discord-core.mjs';

const channel = '910364273056813108';
const cfg = normalizeDiscordConfig({ keywordTriggers: { [channel]: ['由乃', 'yuno', 'DJ妹妹', '天使牛奶', '千石由乃'] } });
for (const text of ['由乃你好', 'YUNO?', 'dj妹妹', '天使牛奶', '千石由乃']) {
  assert.equal(matchesKeywordTrigger(cfg, channel, text), true, text);
}
assert.equal(matchesKeywordTrigger(cfg, channel, 'yunohana'), false);
assert.equal(matchesKeywordTrigger(cfg, channel, '其他內容'), false);
assert.equal(matchesKeywordTrigger(cfg, '999999999999999999', 'yuno'), false);
assert.throws(() => normalizeDiscordConfig({ keywordTriggers: { [channel]: [''] } }));
console.log('Keyword trigger checks passed.');
