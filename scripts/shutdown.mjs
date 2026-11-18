import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopLinuxLauncher } from './managed-linux.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function readPid(name) {
  let value;
  try { value = readFileSync(join(root, 'state', name), 'utf8').trim(); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) throw new Error(`Invalid saved PID: ${name}`);
  return value;
}

function processInfo(pid) {
  const query = 'Get-CimInstance Win32_Process -Filter "ProcessId = $env:YUNODSH_SHUTDOWN_PID" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', query], {
    env: { ...process.env, YUNODSH_SHUTDOWN_PID: pid }, encoding: 'utf8', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
  }).trim();
  return raw ? JSON.parse(raw) : null;
}

function managed(info, kind) {
  const command = String(info?.CommandLine ?? '').replaceAll('\\', '/').trim().toLowerCase();
  const script = join(root, 'scripts/project.mjs').replaceAll('\\', '/').toLowerCase();
  const name = String(info?.Name ?? '').toLowerCase();
  if (name !== 'node.exe') return false;
  const mode = kind === 'discord' ? 'discord' : 'dsh';
  return command.endsWith(`"${script}" ${mode}`) || command.endsWith(`${script} ${mode}`);
}

async function stop(kind, file) {
  const pid = readPid(file);
  if (!pid) { console.log(`No saved ${kind} launcher PID.`); return; }
  if (process.platform === 'linux') {
    const stopped = await stopLinuxLauncher(pid, kind, root);
    console.log(stopped ? `Stopped ${kind} launcher.` : `${kind} launcher is not running.`);
    return;
  }
  const info = processInfo(pid);
  if (!info) { console.log(`${kind} launcher is not running.`); return; }
  if (Number(info.ProcessId) !== Number(pid) || !managed(info, kind)) {
    throw new Error(`Saved ${kind} PID is not this workspace's managed launcher; refused to stop it.`);
  }
  execFileSync('taskkill.exe', ['/PID', pid, '/T', '/F'], { windowsHide: true, stdio: 'pipe', timeout: 15000 });
  console.log(`Stopped ${kind} launcher.`);
}

if (!['win32', 'linux'].includes(process.platform)) throw new Error('This helper supports Windows and Linux.');
try {
  await stop('discord', 'mvp-discord-launcher.pid');
  await stop('dsh', 'mvp-dsh-launcher.pid');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
