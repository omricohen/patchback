import { readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

/**
 * Minimal .env handling — no dependency, no interpolation, no multiline
 * values. Loaded values are applied to `process.env` (existing environment
 * wins) and are NEVER echoed to the terminal or written to any log.
 */

export const ENV_FILE_NAME = '.env';

/** Parse KEY=VALUE lines; `#` comments and blanks ignored; quotes stripped. */
export function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/**
 * Load `.env` from `cwd` into `env` (default `process.env`). Variables
 * already present in the environment win — the file only fills gaps.
 * Returns the keys that were applied (names only, never values).
 */
export async function loadDotEnv(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  let source: string;
  try {
    source = await readFile(path.join(cwd, ENV_FILE_NAME), 'utf8');
  } catch {
    return [];
  }
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseDotEnv(source))) {
    if (env[key] === undefined) {
      env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}

/**
 * Merge `entries` into `cwd/.env`, preserving unrelated lines. Existing
 * assignments for the same keys are replaced in place. The file is chmod
 * 600: it holds secrets. Values are never logged by this function or its
 * callers.
 */
export async function upsertDotEnv(
  cwd: string,
  entries: Record<string, string>,
): Promise<string> {
  const filePath = path.join(cwd, ENV_FILE_NAME);
  let existing: string;
  try {
    existing = await readFile(filePath, 'utf8');
  } catch {
    existing = '';
  }
  const pending = new Map(Object.entries(entries));
  const lines = existing === '' ? [] : existing.split(/\r?\n/);
  const output: string[] = [];
  for (const line of lines) {
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (pending.has(key)) {
      output.push(`${key}=${pending.get(key) ?? ''}`);
      pending.delete(key);
    } else {
      output.push(line);
    }
  }
  while (output.length > 0 && output[output.length - 1] === '') {
    output.pop();
  }
  if (pending.size > 0) {
    if (output.length > 0) output.push('');
    output.push('# Added by `patchback init` — secrets, never commit.');
    for (const [key, value] of pending) {
      output.push(`${key}=${value}`);
    }
  }
  await writeFile(filePath, `${output.join('\n')}\n`, 'utf8');
  await chmod(filePath, 0o600);
  return filePath;
}
