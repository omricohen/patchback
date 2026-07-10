import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Repo-reader: collects a target repo's conventions so adapters can brief the
 * agent accurately (which package manager, which scripts, what the project's
 * own docs say). Read-only; never executes anything from the target repo.
 */

export type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

export interface RepoConventions {
  /** Detected from lockfiles, then package.json `packageManager`, else npm. */
  packageManager: PackageManager;
  /** `scripts` from the repo root package.json ({} when absent). */
  scripts: Record<string, string>;
  /** Root package.json `name`, if present. */
  packageName?: string;
  /** Doc contents, each truncated to the cap. Absent files are omitted. */
  docs: {
    readme?: string;
    contributing?: string;
    agents?: string;
  };
}

export interface ReadRepoConventionsOptions {
  /** Max characters kept per doc file. Default 8000. */
  docCharCap?: number;
}

const DEFAULT_DOC_CHAR_CAP = 8000;

/** Lockfile → package manager, in priority order (first hit wins). */
const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

const DOC_CANDIDATES: ReadonlyArray<
  readonly [keyof RepoConventions['docs'], readonly string[]]
> = [
  ['readme', ['README.md', 'README', 'readme.md', 'Readme.md']],
  [
    'contributing',
    ['CONTRIBUTING.md', 'CONTRIBUTING', '.github/CONTRIBUTING.md'],
  ],
  ['agents', ['AGENTS.md', 'CLAUDE.md']],
];

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n… [truncated by patchback repo-reader]`;
}

function packageManagerFromField(field: unknown): PackageManager | undefined {
  if (typeof field !== 'string') return undefined;
  const name = field.split('@')[0];
  if (name === 'pnpm' || name === 'yarn' || name === 'npm' || name === 'bun') {
    return name;
  }
  return undefined;
}

/**
 * Read a target repo's conventions from `repoDir` (the repo root).
 * Missing/unparsable files degrade gracefully — this never throws for an
 * imperfect repo, only for a missing directory.
 */
export async function readRepoConventions(
  repoDir: string,
  options?: ReadRepoConventionsOptions,
): Promise<RepoConventions> {
  const docCharCap = options?.docCharCap ?? DEFAULT_DOC_CHAR_CAP;

  let scripts: Record<string, string> = {};
  let packageName: string | undefined;
  let pmField: PackageManager | undefined;

  const rawPackageJson = await readTextIfExists(
    path.join(repoDir, 'package.json'),
  );
  if (rawPackageJson !== undefined) {
    try {
      const parsed: unknown = JSON.parse(rawPackageJson);
      if (parsed !== null && typeof parsed === 'object') {
        const pkg = parsed as Record<string, unknown>;
        if (typeof pkg.name === 'string') packageName = pkg.name;
        pmField = packageManagerFromField(pkg.packageManager);
        if (pkg.scripts !== null && typeof pkg.scripts === 'object') {
          for (const [key, value] of Object.entries(
            pkg.scripts as Record<string, unknown>,
          )) {
            if (typeof value === 'string') scripts[key] = value;
          }
        }
      }
    } catch {
      // Unparsable package.json: proceed with empty scripts.
      scripts = {};
    }
  }

  let packageManager: PackageManager | undefined;
  for (const [lockfile, pm] of LOCKFILES) {
    if ((await readTextIfExists(path.join(repoDir, lockfile))) !== undefined) {
      packageManager = pm;
      break;
    }
  }
  packageManager = packageManager ?? pmField ?? 'npm';

  const docs: RepoConventions['docs'] = {};
  for (const [key, candidates] of DOC_CANDIDATES) {
    for (const candidate of candidates) {
      const content = await readTextIfExists(path.join(repoDir, candidate));
      if (content !== undefined) {
        docs[key] = truncate(content, docCharCap);
        break;
      }
    }
  }

  const conventions: RepoConventions = { packageManager, scripts, docs };
  if (packageName !== undefined) conventions.packageName = packageName;
  return conventions;
}
