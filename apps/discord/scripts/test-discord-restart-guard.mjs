import test from 'node:test';
import assert from 'node:assert/strict';
import { isManagedDsh } from '../../../scripts/restart-dsh.mjs';

test('hard reload recognizes only this workspace DSH launcher, not another process using a stale PID', () => {
  const root = 'C:/workspace/project';
  assert(isManagedDsh({ Name: 'node.exe', CommandLine: 'node.exe "C:/workspace/project/scripts/project.mjs" dsh' }, root));
  assert(isManagedDsh({ Name: 'node.exe', CommandLine: 'node.exe "C:/workspace/project/scripts/project.mjs" dsh  ' }, root));
  assert(!isManagedDsh({ Name: 'node.exe', CommandLine: 'node.exe "C:/other/scripts/project.mjs" dsh' }, root));
  assert(!isManagedDsh({ Name: 'node.exe', CommandLine: 'node.exe "C:/workspace/project/scripts/project.mjs" discord' }, root));
  assert(!isManagedDsh({ Name: 'node.exe', CommandLine: 'node.exe "C:/workspace/project/scripts/project.mjs" dsh-other' }, root));
  assert(!isManagedDsh({ Name: 'cmd.exe', CommandLine: 'echo C:/workspace/project/scripts/project.mjs dsh' }, root));
});
