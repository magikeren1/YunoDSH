import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { validatePersonaOnly } from '../../../scripts/apply-persona.mjs';

const fixture = prefix => [{ insert: [{ id: 'preset-dc-chat', config: { plugins: [
  { id: 'persona', config: { prefix, complete: false } },
  { id: 'tools', config: { enabled: true } },
] } }] }];

test('persona synchronization permits text changes and rejects unrelated tool/config changes', () => {
  const oldPreset = yaml.dump(fixture('original'));
  const newPreset = yaml.dump(fixture('agreed custom text'));
  assert.doesNotThrow(() => validatePersonaOnly(oldPreset, newPreset));
  const changedTools = fixture('agreed custom text');
  changedTools[0].insert[0].config.plugins[1].config.enabled = false;
  assert.throws(() => validatePersonaOnly(oldPreset, yaml.dump(changedTools)), /non-persona differences/);
});
