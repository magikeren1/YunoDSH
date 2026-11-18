import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const deployment = process.argv.includes('--deployment');
const references = process.argv.includes('--references');
let failures = 0;
function check(label, action, required = true) {
  try {
    console.log(`OK   ${label}: ${action()}`);
  } catch (error) {
    console.log(`${required ? 'FAIL' : 'INFO'} ${label}: ${error.message}`);
    if (required) failures += 1;
  }
}
function run(command, args) {
  return execFileSync(command, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

check('Node', () => {
  if (Number(process.versions.node.split('.')[0]) !== 26) {
    throw new Error(`expected Node 26.x, found ${process.version}`);
  }
  return process.version;
});
check('DSH runtime', () => {
  const installed = JSON.parse(readFileSync(new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url), 'utf8'));
  const declared = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies['@deepseek-ai/dsh'];
  if (installed.version !== declared) throw new Error(`expected ${declared}, found ${installed.version}`);
  return installed.version;
});
const lock = JSON.parse(readFileSync(new URL('../upstream.lock.json', import.meta.url), 'utf8'));
// Upstream source clones are optional research material, not runtime dependencies.
// A fresh bridge-only checkout must not require a Harness source checkout.
for (const repo of references ? lock.repositories : []) {
  check(repo.name, () => {
    const directory = resolve(root, repo.path);
    if (!directory.startsWith(resolve(root, 'upstream') + sep)) {
      throw new Error('reference checkout must be inside upstream/');
    }
    const gitArgs = ['-c', `safe.directory=${directory.replaceAll('\\', '/')}`, '-C', directory];
    const head = run('git', [...gitArgs, 'rev-parse', 'HEAD']);
    if (head !== repo.commit) throw new Error(`expected ${repo.commit}, found ${head}`);
    const changes = run('git', [...gitArgs, 'status', '--porcelain', '--untracked-files=no']);
    if (changes) throw new Error('reference checkout has tracked modifications');
    return head;
  });
}
if (!references) console.log('INFO Upstream provenance: upstream.lock.json; use --references to verify optional local clones.');
for (const command of ['ffmpeg', 'ffprobe']) {
  check(command, () => run(command, ['-version']).split(/\r?\n/)[0], deployment);
}
console.log('This check does not connect to Discord or start DSH.');
process.exitCode = failures ? 1 : 0;
