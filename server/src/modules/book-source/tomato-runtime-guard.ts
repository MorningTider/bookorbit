import { spawn } from 'node:child_process';

// A detached downloader must not survive a crashed application process indefinitely.
function runGuard() {
  const [binary, root, parent, duration] = process.argv.slice(2);
  const parentPid = Number(parent);
  const timeoutMs = Number(duration);
  if (!binary || !root || !Number.isSafeInteger(parentPid) || parentPid < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    process.exitCode = 1;
    return;
  }
  const child = spawn(binary, ['--server', '--data-dir', root], { cwd: root, stdio: 'ignore', detached: true, env: process.env });
  let progressedAt = Date.now();
  process.on('message', (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'progress') progressedAt = Date.now();
  });
  const stop = () => {
    if (!child.pid || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  };
  const watchdog = setInterval(() => {
    if (process.ppid !== parentPid || Date.now() - progressedAt > timeoutMs) stop();
  }, 250);
  watchdog.unref();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.once('disconnect', stop);
  child.once('error', () => {
    clearInterval(watchdog);
    process.exitCode = 1;
    if (process.connected) process.disconnect?.();
  });
  child.once('exit', (code) => {
    clearInterval(watchdog);
    process.exitCode = code === 0 ? 0 : 1;
    if (process.connected) process.disconnect?.();
  });
}

if (require.main === module) runGuard();
