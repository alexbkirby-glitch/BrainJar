/**
 * lib/jar-root.mjs — where is the Jar? (npm-packaging enabler)
 *
 * Historically every script computed ROOT relative to its own file, which
 * conflated two different roots that happen to coincide in a repo checkout:
 *
 *   PACKAGE root — where this code lives (the brain-jar npm package or the
 *                  flagship checkout). Used to locate sibling code/scripts.
 *   JAR root     — the directory whose seeds/, .lodestone/, profiles.json,
 *                  and brain-jar-manifest.json we operate on. The USER'S data.
 *
 * Under `npx brain-jar-mcp`, the package lives in a node_modules cache and
 * the Jar is wherever the user says it is. Resolution order:
 *
 *   1. BRAIN_JAR_ROOT env var        (explicit; also how the MCP server
 *                                     hands its jar root to spawned scripts)
 *   2. --jar=/path CLI argument      (explicit)
 *   3. package parent, IF it has seeds/  (repo-checkout mode — preserves
 *                                     every pre-existing behavior)
 *   4. process.cwd()                 (npx mode: serve the Jar you're in;
 *                                     seeds/ is created lazily on capture)
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} callerUrl  import.meta.url of the calling module
 * @param {object} [opts]
 * @param {string[]} [opts.argv]  defaults to process.argv
 * @returns {string} absolute Jar root
 */
export function resolveJarRoot(callerUrl, { argv = process.argv } = {}) {
  const env = process.env.BRAIN_JAR_ROOT;
  if (env) return path.resolve(env);

  const jarArg = argv.find((a) => a.startsWith('--jar='))?.split('=').slice(1).join('=');
  if (jarArg) return path.resolve(jarArg);

  // Package parent: lib/ and scripts/ and mcp-server/ all sit one level
  // below the package root, so callers pass their own import.meta.url.
  const pkgParent = path.resolve(path.dirname(fileURLToPath(callerUrl)), '..');
  if (fs.existsSync(path.join(pkgParent, 'seeds'))) return pkgParent;

  return process.cwd();
}

/** Package root (code location) — for locating sibling scripts to spawn. */
export function resolvePkgRoot(callerUrl) {
  return path.resolve(path.dirname(fileURLToPath(callerUrl)), '..');
}
