// Runs the backend (tsx watch, :8000) and the Vite dev server (:3000, proxying /api and /socket.io) together.
import { spawn } from 'node:child_process';

const procs = [
  ['api', 'npm', ['--prefix', 'services', 'run', 'dev'], '\x1b[35m'],
  ['web', 'npm', ['--prefix', 'dashboard', 'run', 'dev'], '\x1b[36m'],
].map(([name, cmd, args, color]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const out = (buf) => buf.toString().split('\n').filter(Boolean).forEach((l) => console.log(`${color}[${name}]\x1b[0m ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => { console.log(`[${name}] exited with ${code}`); shutdown(code ?? 1); });
  return p;
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
