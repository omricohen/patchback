/**
 * `pnpm --filter widget-playground dev` — boots the fake-pipeline API and
 * the Vite dev server together. Zero extra dependencies (node child_process
 * only); Ctrl-C tears both down.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const children = [];

function run(command, args, name) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    console.log(`[playground] ${name} exited (${code ?? 'signal'})`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('node', [join(here, 'dev-api.mjs')], 'dev-api');
run('pnpm', ['exec', 'vite'], 'vite');
