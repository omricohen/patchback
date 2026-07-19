/**
 * Mechanism (a): a babel plugin that STATICALLY injects
 * `data-pb-source="relative/file.tsx:line"` as a JSX attribute on host
 * elements. This is the production opt-in (internal apps) and the escape
 * hatch for setups where the jsx-runtime mechanism cannot be used (custom
 * `jsxImportSource` already taken by Emotion/theme-ui, non-automatic
 * runtimes, …).
 *
 * Registered like any babel plugin:
 *
 *   plugins: [['@patchback/provenance/babel', { root, elements }]]
 *
 * Fail closed like the runtime: files outside the repo root (or with no
 * discoverable root) are left untouched.
 */
import type { PluginObj, PluginPass, types as BabelTypes } from '@babel/core';

import { PROVENANCE_ATTRIBUTE } from '@patchback/types';

import { findRepoRoot, relativizeAbsolute } from './node.js';

export interface ProvenanceBabelOptions {
  /**
   * Repo root to relativize against. Default: nearest `.git` ancestor of
   * each file being transformed.
   */
  root?: string;
  /**
   * Which host elements to stamp. `'all'` (default) stamps every host
   * element; `'interactive'` bounds DOM cost for production opt-ins.
   */
  elements?: 'all' | 'interactive';
}

/** Static tag list for `elements: 'interactive'`. */
export const INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'form',
  'label',
  'summary',
  'details',
]);

interface BabelApi {
  types: typeof BabelTypes;
}

/** Memoized per-directory root discovery (one fs walk per new directory). */
const rootByDir = new Map<string, string | undefined>();

function discoverRoot(fileDir: string): string | undefined {
  if (rootByDir.has(fileDir)) {
    return rootByDir.get(fileDir);
  }
  const root = findRepoRoot(fileDir);
  rootByDir.set(fileDir, root);
  return root;
}

export default function patchbackProvenanceBabel(api: BabelApi): PluginObj {
  const t = api.types;
  return {
    name: 'patchback-provenance',
    visitor: {
      JSXOpeningElement(path, state: PluginPass) {
        const options = (state.opts ?? {}) as ProvenanceBabelOptions;
        const nameNode = path.node.name;
        // Host elements only: lowercase JSXIdentifier. Components,
        // member expressions (<Foo.Bar>) and namespaced names are skipped.
        if (nameNode.type !== 'JSXIdentifier') {
          return;
        }
        const tag = nameNode.name;
        if (!/^[a-z]/.test(tag)) {
          return;
        }
        if (
          (options.elements ?? 'all') === 'interactive' &&
          !INTERACTIVE_TAGS.has(tag)
        ) {
          return;
        }
        // A manually authored attribute always wins.
        const hasManual = path.node.attributes.some(
          (attribute) =>
            attribute.type === 'JSXAttribute' &&
            attribute.name.type === 'JSXIdentifier' &&
            attribute.name.name === PROVENANCE_ATTRIBUTE,
        );
        if (hasManual) {
          return;
        }
        const fileName = state.file.opts.filename;
        const line = path.node.loc?.start.line;
        if (
          typeof fileName !== 'string' ||
          fileName === '' ||
          line === undefined
        ) {
          return;
        }
        const lastSlash = Math.max(
          fileName.lastIndexOf('/'),
          fileName.lastIndexOf('\\'),
        );
        const fileDir = lastSlash > 0 ? fileName.slice(0, lastSlash) : '.';
        const root = options.root ?? discoverRoot(fileDir);
        if (root === undefined) {
          return; // Fail closed: no repo boundary, no stamp.
        }
        const relative = relativizeAbsolute(fileName, root);
        if (relative === undefined) {
          return;
        }
        path.node.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier(PROVENANCE_ATTRIBUTE),
            t.stringLiteral(`${relative}:${line}`),
          ),
        );
      },
    },
  };
}
