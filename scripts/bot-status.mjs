import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStatusText } from '../apps/discord/src/core/discord-status.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const prompt = createInterface({ input: stdin, output: stdout });
try {
  console.log('Discord presence: online, idle, dnd, or invisible.');
  const status = (await prompt.question('Presence: ')).trim().toLowerCase();
  if (!['online', 'idle', 'dnd', 'invisible'].includes(status)) throw new Error('Choose online, idle, dnd, or invisible.');
  const text = parseStatusText(await prompt.question('Custom status text (leave blank for none): '));
  const dir = join(root, 'apps/discord/state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'discord-owner-presence.json'), JSON.stringify({ status, text }, null, 2) + '\n', { mode: 0o600 });
  console.log('Saved. Restart the bridge with shutdown and startup to apply.');
  console.log('This presence is visible across servers and overrides model-set status.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { prompt.close(); }
