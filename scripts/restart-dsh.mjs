import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linuxPidIsRunning, linuxProcessInfo, stopLinuxLauncher } from './managed-linux.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function isManagedDsh(processInfo, workspace) {
  const command = String(processInfo?.CommandLine ?? '').replaceAll('\\', '/').trim().toLowerCase();
  const script = join(workspace, 'scripts/project.mjs').replaceAll('\\', '/').toLowerCase();
  return processInfo?.Name?.toLowerCase() === 'node.exe'
    && (command.endsWith(`"${script}" dsh`) || command.endsWith(`${script} dsh`));
}

async function restart() {
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('This helper supports Windows and Linux.');
  const pidFile = join(root, 'state/mvp-dsh-launcher.pid');
  const pidText = readFileSync(pidFile, 'utf8').trim();
  if (!/^[1-9]\d*$/.test(pidText) || Number(pidText) > 2147483647) throw new Error('Invalid saved DSH launcher PID');
  if (process.platform === 'linux') {
    const info = linuxProcessInfo(pidText, root);
    if (process.argv.includes('--check')) {
      if (info && info.mode === 'dsh' && info.group === Number(pidText)) console.log('Managed DSH launcher verified. No process stopped.');
      else if (info) throw new Error('Saved PID is not this workspace\'s detached DSH launcher.');
      else {
        if (!linuxPidIsRunning(pidText)) { console.log('Saved DSH launcher is not running.'); return; }
        throw new Error('Saved PID is not this workspace\'s managed DSH launcher.');
      }
      return;
    }
    await stopLinuxLauncher(pidText, 'dsh', root);
  } else {
    const query = 'Get-CimInstance Win32_Process -Filter "ProcessId = $env:YUNODSH_RESTART_PID" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', query], {
      env: { ...process.env, YUNODSH_RESTART_PID: pidText }, encoding: 'utf8', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
    }).trim();
    if (raw) {
      const info = JSON.parse(raw);
      if (Number(info.ProcessId) !== Number(pidText) || !isManagedDsh(info, root)) {
        throw new Error('Saved PID is not this workspace\'s managed DSH launcher; refused to stop it.');
      }
      if (process.argv.includes('--check')) { console.log('Managed DSH launcher verified. No process stopped.'); return; }
      execFileSync('taskkill.exe', ['/PID', pidText, '/T', '/F'], { windowsHide: true, stdio: 'pipe', timeout: 15000 });
    } else if (process.argv.includes('--check')) {
      console.log('Saved DSH launcher is not running.'); return;
    }
  }
  const output = join(root, 'state/mvp-dsh.stdout.log');
  const errors = join(root, 'state/mvp-dsh.stderr.log');
  const outFd = openSync(output, 'w');
  const errFd = openSync(errors, 'w');
  let child;
  try {
    child = spawn(process.execPath, [join(root, 'scripts/project.mjs'), 'dsh'], {
      cwd: root, env: process.env, detached: true, windowsHide: true, stdio: ['ignore', outFd, errFd],
    });
    await new Promise((ready, fail) => { child.once('spawn', ready); child.once('error', fail); });
    writeFileSync(pidFile, String(child.pid));
    child.unref();
  } finally { closeSync(outFd); closeSync(errFd); }
  for (let attempt = 0; attempt < 30; attempt++) {
    const log = existsSync(output) ? readFileSync(output, 'utf8') : '';
    const url = log.match(/dsh web: (http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+)/)?.[1];
    if (url) {
      writeFileSync(join(root, 'state/MVP_ACCESS.md'), `# Local DSH\n\n[Open DSH](${url})\n`, { mode: 0o600 });
      console.log('DSH restarted. Conversation files preserved; the Discord bridge reconnects automatically.');
      console.log('Updated login link: state/MVP_ACCESS.md');
      return;
    }
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new Error('DSH did not report readiness within 30 seconds. Check state/mvp-dsh.stderr.log.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  restart().catch(error => { console.error(error.message); process.exitCode = 1; });
}
