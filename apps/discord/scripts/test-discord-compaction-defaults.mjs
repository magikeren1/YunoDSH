import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { normalizeDiscordConfig, shouldAutoCompact } from '../src/core/discord-core.mjs';

test('research context near 80k does not cause a second bridge compaction by default', () => {
  const cfg = normalizeDiscordConfig({});
  assert.equal(shouldAutoCompact({ tokens: 83580, threshold: cfg.autoCompactTokens,
    lastAt: 0, now: 2000000, cooldownMs: 600000 }), false);
  assert.equal(shouldAutoCompact({ tokens: 83580, threshold: 80000,
    lastAt: 0, now: 2000000, cooldownMs: 600000 }), true, 'explicit legacy overrides remain supported');
});

test('the chat preset and shipped bundle use DSH model-window pressure, without changing persona', () => {
  const source = yaml.load(readFileSync(new URL('../dsh/agent-presets/dc-chat/agent.cordis.yml', import.meta.url), 'utf8'));
  const group = source.find(row => row.id === 'compaction');
  assert.equal(group.config.find(row => row.id === 'compaction-basic').config.thresholdRatio, 0.8);
  const bundle = yaml.load(readFileSync(new URL('../plugins/dc-agent-presets/presets/dc-chat.patch.yml', import.meta.url), 'utf8'));
  function find(value) {
    if (!value || typeof value !== 'object') return;
    if (value.id === 'compaction-basic') return value;
    for (const child of Object.values(value)) {
      const result = find(child); if (result) return result;
    }
  }
  assert.equal(find(bundle).config.thresholdRatio, 0.8);
  const example = JSON.parse(readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'));
  assert.equal(example.discord.autoCompactTokens, 0);
});
