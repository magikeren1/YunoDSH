import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linuxLaunchers } from './managed-linux.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const state = join(root, 'state');
const script = join(root, 'scripts/project.mjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function existingLaunchers() {
  if (process.platform === 'linux') return linuxLaunchers(root);
  const query = "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', query], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
  const parsed = raw ? JSON.parse(raw) : [];
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  const target = script.replaceAll('\\', '/').toLowerCase();
  return processes.flatMap(info => {
    const command = String(info.CommandLine ?? '').replaceAll('\\', '/').trim().toLowerCase();
    const mode = ['dsh', 'discord'].find(mode => command.endsWith(`"${target}" ${mode}`) || command.endsWith(`${target} ${mode}`));
    return mode ? [{ ...info, mode }] : [];
  });
}

async function start(mode) {
  const out = openSync(join(state, `mvp-${mode}.stdout.log`), 'w');
  const err = openSync(join(state, `mvp-${mode}.stderr.log`), 'w');
  let child;
  try {
    child = spawn(process.execPath, [script, mode], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    writeFileSync(join(state, `mvp-${mode}-launcher.pid`), String(child.pid));
    child.unref();
  } finally { closeSync(out); closeSync(err); }
  return child;
}

async function main() {
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('This startup helper supports Windows and Linux.');
  mkdirSync(state, { recursive: true });
  const launchers = existingLaunchers();
  if (launchers.some(item => item.mode === 'discord') || launchers.filter(item => item.mode === 'dsh').length > 1) {
    throw new Error('A Discord launcher or multiple DSH launchers are already running. No process was started.');
  }
  const existingDsh = launchers.find(item => item.mode === 'dsh');
  if (existingDsh && readFileSync(join(state, 'mvp-dsh-launcher.pid'), 'utf8').trim() !== String(existingDsh.ProcessId)) {
    throw new Error('The running DSH launcher does not match the saved PID; no process was started.');
  }
  const dsh = existingDsh ? null : await start('dsh');
  let ready = false;
  for (let i = 0; i < 180; i++) {
    if (dsh && dsh.exitCode !== null) break;
    const log = readFileSync(join(state, 'mvp-dsh.stdout.log'), 'utf8');
    const url = log.match(/dsh web: (http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+)/)?.[1];
    if (url) {
      writeFileSync(join(state, 'MVP_ACCESS.md'), `# Local DSH\n\n[Open DSH](${url})\n`, { mode: 0o600 });
      ready = true;
      break;
    }
    await sleep(1000);
  }
  if (!ready) throw new Error('DSH did not report readiness within 180 seconds. Check state/mvp-dsh.stderr.log; Discord was not started. The DSH launcher may still be running.');
  const discord = await start('discord');
  await sleep(2000);
  if (discord.exitCode !== null) throw new Error('Discord launcher exited during startup. Check state/mvp-discord.stderr.log.');
  console.log('DSH started; Discord launcher started. Login link: state/MVP_ACCESS.md');
  console.log('Check Discord connection in state/mvp-discord.stdout.log.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
