import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../apps/discord/node_modules/js-yaml/index.js';
import { renderPatch, patchFileFor } from '../apps/discord/scripts/build-agent-preset-patches.mjs';

function withoutPersona(tree) {
  const copy = structuredClone(tree);
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.id === 'persona') value.config = null;
    else for (const child of Object.values(value)) visit(child);
  }
  visit(copy);
  return copy;
}

export function validatePersonaOnly(previous, next) {
  if (JSON.stringify(withoutPersona(yaml.load(previous))) !== JSON.stringify(withoutPersona(yaml.load(next)))) {
    throw new Error('Preset has non-persona differences. Review those changes before regenerating the complete preset.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const target = patchFileFor('dc-chat');
  const before = readFileSync(target, 'utf8');
  const after = renderPatch('dc-chat');
  validatePersonaOnly(before, after);
  if (before === after) console.log('dc-chat persona source and loaded bundle already match.');
  else {
    const backup = new URL(`../state/preset-backups/dc-chat-${Date.now()}.patch.yml`, import.meta.url);
    mkdirSync(dirname(fileURLToPath(backup)), { recursive: true });
    copyFileSync(target, backup);
    writeFileSync(target, after, 'utf8');
    console.log('Applied dc-chat persona from its source file. Non-persona preset settings preserved.');
  }
  console.log('Reload DSH before the next model request to ensure an existing Session uses the update.');
}
