import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('guard accepts real progress beyond its deadline, then terminates an idle child and exits IPC', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tomato-guard-test-'));
  const source = await readFile(join(__dirname, 'tomato-runtime-guard.ts'), 'utf8');
  const guard = join(root, 'guard.cjs');
  await writeFile(
    guard,
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  );
  const helper = join(root, 'helper');
  await writeFile(helper, '#!/bin/sh\nexec ' + JSON.stringify(process.execPath) + ' -e "setInterval(()=>{},1000)"\n', { mode: 0o700 });
  const processGuard = spawn(process.execPath, [guard, helper, root, String(process.pid), '1000'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(processGuard, 'exit');
  const progress = setInterval(() => {
    if (processGuard.connected) processGuard.send({ type: 'progress' });
  }, 100);
  try {
    await delay(2200);
    expect(processGuard.exitCode).toBeNull();
    clearInterval(progress);
    await Promise.race([
      exited,
      delay(4000).then(() => {
        throw new Error('guard did not stop its idle child or disconnect IPC');
      }),
    ]);
    expect(processGuard.exitCode).toBe(1);
  } finally {
    clearInterval(progress);
    if (processGuard.exitCode === null) processGuard.kill('SIGTERM');
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});
