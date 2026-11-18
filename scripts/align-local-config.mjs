import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Explicit, narrow alignment of the initialized local config. Preserve credentials,
// allowlists, model selection, and every unrelated user setting.
const file = new URL('../apps/discord/config.json', import.meta.url);
if (!existsSync(file)) throw new Error('Run project:init before aligning the local configuration.');
const config = JSON.parse(readFileSync(file, 'utf8'));
config.discord.memory = { ...config.discord.memory, enabled: true };
config.discord.notes = { ...config.discord.notes, enabled: true,
  digest: { enabled: true, intervalMinutes: 60, maxMessages: 100, maxChars: 6000, timeoutMs: 90000, ...config.discord.notes?.digest } };
config.discord.media = { concurrency: 1, maxQueued: 4, downloadConcurrency: 1,
  maxDownloadsQueued: 4, ...config.discord.media };
writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
console.log('Aligned memory, channel notes, hourly digest and bounded media defaults. Existing custom values preserved.');
