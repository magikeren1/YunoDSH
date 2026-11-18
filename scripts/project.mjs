import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = join(root, 'apps/discord');
const dshCli = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
// Isolate credentials, profiles, and Session logs from the user's global DSH home.
process.env.DSH_HOME = join(root, 'state/dsh');
// Child MCP servers must find the same Node installation even when launched by
// a service manager with a minimal PATH (for example a workspace-local Node).
process.env.PATH = [
  dirname(process.execPath),
  ...(process.platform === 'win32' ? [
    join(root, '.tools'),
    join(root, '.tools/node-v26.13.1-win-x64'),
    join(root, '.tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin'),
  ] : []),
  join(root, 'node_modules/.bin'), process.env.PATH,
].filter(Boolean).join(delimiter);

function run(file, args, cwd = root) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd, env: process.env, stdio: 'inherit', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${file}`);
}
function initialize() {
  // The state tree contains credentials and conversation history. Existing
  // directories are left untouched so re-initialization preserves operator settings.
  mkdirSync(join(root, 'state'), { recursive: true, mode: 0o700 });
  mkdirSync(process.env.DSH_HOME, { recursive: true, mode: 0o700 });
  if (!existsSync(join(root, '.env'))) {
    writeFileSync(join(root, '.env'), readFileSync(join(root, '.env.example')), { mode: 0o600 });
  }
  const local = join(app, 'config.json');
  if (!existsSync(local)) {
    const config = JSON.parse(readFileSync(join(app, 'config.example.json'), 'utf8'));
    config.dsh.provider = '';
    config.dsh.model = '';
    config.dsh.reasoningEffort = '';
    config.discord.workspaceTitle = 'yunodsh Discord';
    writeFileSync(local, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  }
  const prepared = spawnSync(process.execPath, [dshCli, '--profile', 'web', '--dump-config'], {
    cwd: root, env: process.env, encoding: 'utf8', windowsHide: true, timeout: 120000,
  });
  if (prepared.error) throw prepared.error;
  if (prepared.status !== 0) throw new Error(`DSH profile initialization failed: ${prepared.stderr}`);
  console.log('DSH web profile initialized.');
  const profileManifest = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'profiles/web/package.json'), 'utf8'));
  if (profileManifest.dsh?.profile?.bundles?.includes('dc-agent-presets')
    && existsSync(join(process.env.DSH_HOME, 'plugins/dc-agent-presets'))
    && !process.argv.includes('--refresh-presets')) {
    console.log('Existing Discord preset configuration preserved. Manage persona changes directly in DSH.');
    const personaSource = join(app, 'dsh/agent-presets/dc-chat/agent.cordis.yml');
    const personaBundle = join(app, 'plugins/dc-agent-presets/presets/dc-chat.patch.yml');
    if (existsSync(personaBundle) && statSync(personaSource).mtimeMs > statSync(personaBundle).mtimeMs) {
      console.log('dc-chat source is newer than its loaded bundle. Run persona:apply after manual persona edits, then reload DSH.');
    }
    return;
  }
  process.env.QQ_BRIDGE_SKIP_DSH_INSTALL = '1';
  run(join(app, 'scripts/setup-dsh.mjs'), ['--discord', 'web'], app);
  // PRTS is retained as an optional integration, pending its external service.
  const patchFile = join(process.env.DSH_HOME, 'profiles/web/cordis.patch.yml');
  const patch = readFileSync(patchFile, 'utf8');
  writeFileSync(patchFile, patch.replace(/(    - id: mcp-prts\r?\n)(?!      disabled:)/g, '$1      disabled: true\n'));
  console.log('Initialized local DSH web profile and Discord presets. PRTS awaits its external service.');
}

try {
  switch (process.argv[2]) {
    case 'init': initialize(); break;
    case 'dsh': run(dshCli, ['--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '3080']); break;
    case 'smoke':
      run(join(app, 'scripts/test-dsh-auth.mjs'), [], app);
      run(join(app, 'scripts/smoke-dsh-init.mjs'), [], app);
      break;
    case 'discord':
      if (!existsSync(join(app, 'config.json'))) throw new Error('Run project:init first.');
      if (!process.env.DISCORD_TOKEN && !JSON.parse(readFileSync(join(app, 'config.json'), 'utf8')).discord.token) {
        throw new Error('Discord is prepared. Add DISCORD_TOKEN to local .env before a live connection.');
      }
      run(join(app, 'src/discord-bridge.js'), [], app); break;
    default: throw new Error('Expected init, dsh, smoke, or discord.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
