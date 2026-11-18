// Helpers for launchers started with detached: true on Linux. Never signal a
// saved PID until /proc confirms its executable, arguments and process group.
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { basename, join } from 'node:path';

function procStat(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { state: fields[0], group: Number(fields[2]) };
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) return null;
    throw error;
  }
}

export function linuxPidIsRunning(pid) {
  const stat = procStat(pid);
  return Boolean(stat && stat.state !== 'Z');
}

export function linuxProcessInfo(pid, root) {
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    const executable = basename(readlinkSync(`/proc/${pid}/exe`));
    const stat = procStat(pid);
    if (!stat || stat.state === 'Z' || !/^node(?:js)?$/.test(executable)
      || args.length !== 3 || args[1] !== join(root, 'scripts/project.mjs')
      || !['dsh', 'discord'].includes(args[2])) return null;
    return { ProcessId: Number(pid), mode: args[2], group: stat.group };
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) return null;
    throw error;
  }
}

export function linuxLaunchers(root) {
  return readdirSync('/proc').filter(name => /^[1-9]\d*$/.test(name))
    .map(pid => linuxProcessInfo(pid, root)).filter(Boolean);
}

function groupIsRunning(group) {
  return readdirSync('/proc').some(pid => {
    if (!/^[1-9]\d*$/.test(pid)) return false;
    const stat = procStat(pid);
    return stat && stat.group === group && stat.state !== 'Z';
  });
}

export async function stopLinuxLauncher(pid, kind, root) {
  const info = linuxProcessInfo(pid, root);
  if (!info) {
    // A live PID with different arguments must never be treated as a stale PID.
    if (linuxPidIsRunning(pid)) {
      throw new Error(`Saved ${kind} PID is not this workspace's managed launcher; refused to stop it.`);
    }
    return false;
  }
  if (info.mode !== kind || info.group !== Number(pid)) {
    throw new Error(`Saved ${kind} PID is not this workspace's detached launcher; refused to stop it.`);
  }
  try { process.kill(-Number(pid), 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let i = 0; i < 100 && groupIsRunning(Number(pid)); i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (groupIsRunning(Number(pid))) {
    try { process.kill(-Number(pid), 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let i = 0; i < 50 && groupIsRunning(Number(pid)); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (groupIsRunning(Number(pid))) throw new Error(`Could not stop ${kind} process group.`);
  }
  return true;
}
