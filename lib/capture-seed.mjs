/**
 * lib/capture-seed.mjs — the capture engine (Chunk 0)
 *
 * "Seeds get authored in the thirty seconds after a bug bites, or not at
 * all." This is that thirty-second path: take whatever the calling brain/
 * human has on hand from the live session, fill in the rest of the schema,
 * lint it twice (structural + privacy), and append it to the local Jar's
 * staging file. Nothing here ever touches a Public Jar or the network —
 * capture is 100% local. Publishing is a separate, later, human-driven step
 * (see privacy-lint.mjs's assertPublishable).
 *
 * Exported as a plain async function so it can be wired into whatever MCP
 * server framework the existing 26-tool server uses — this repo snapshot
 * doesn't include that server, so this is deliberately framework-agnostic.
 * A minimal MCP tool wrapper would look like:
 *
 *   server.tool('capture_seed', schema, async (input) => {
 *     const result = await captureSeed(input);
 *     return { content: [{ type: 'text', text: JSON.stringify(result) }] };
 *   });
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { structuralLint, blankSeed } from './seed-schema.mjs';
import { privacyLint } from './privacy-lint.mjs';

const DEFAULT_STAGING_PATH = path.join('seeds', 'personal', 'captured.json');

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

/**
 * Derive a reasonable id if the caller didn't supply one — from the wrong
 * field, since that's almost always present and descriptive. Caller-
 * supplied ids are always preferred; this is a fallback, not a policy.
 */
function deriveId(seed) {
  if (seed.id) return seed.id;
  const basis = seed.wrong || seed.symptom || 'untitled_seed';
  const words = slugify(basis).split('_').filter(Boolean).slice(0, 8);
  return words.join('_') || `seed_${Date.now()}`;
}

function loadStagingFile(stagingPath) {
  if (!fs.existsSync(stagingPath)) return [];
  const raw = fs.readFileSync(stagingPath, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${stagingPath} does not contain a JSON array — refusing to append`);
  }
  return parsed;
}

/**
 * Append-only write, matching WIKI.md's "Raw layer is append-only" rule.
 * Never rewrites or reorders existing entries.
 */
function appendToStagingFile(stagingPath, seed) {
  const existing = loadStagingFile(stagingPath);
  if (existing.some((s) => s.id === seed.id)) {
    throw new Error(`A seed with id "${seed.id}" already exists in ${stagingPath} — ids must be unique per file. Pick a different id or edit the existing entry directly (append-only applies to new content, not to fixing a real duplicate).`);
  }
  existing.push(seed);
  fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
  fs.writeFileSync(stagingPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
}

/**
 * captureSeed — the main entry point.
 *
 * @param {object} input — partial seed fields from session context.
 *   Expected shape mirrors seeds/*.json: { id?, stack, blast_radius, wrong,
 *   correct, symptom, tags?, doc_reference?, domain?, facet?, confidence? }
 *   `stack`, `wrong`, `correct`, `symptom` are the practical minimum for a
 *   useful seed; everything else has a sane default or is optional.
 * @param {object} [opts]
 * @param {string} [opts.stagingPath] — override the default staging file.
 *   Defaults to seeds/personal/captured.json, relative to cwd.
 * @param {boolean} [opts.dryRun] — lint and report, but don't write.
 *
 * @returns {{ staged: boolean, seed: object, structural: object,
 *             privacy: object, path: string }}
 *   Never throws on lint failures — those come back in the result so a
 *   calling brain can surface them conversationally instead of crashing.
 *   Throws only on genuine I/O problems (bad staging file, duplicate id).
 */
export async function captureSeed(input, opts = {}) {
  const stagingPath = opts.stagingPath || DEFAULT_STAGING_PATH;

  const seed = blankSeed({
    ...input,
    id: deriveId(input),
    tags: input.tags && input.tags.length ? input.tags : [],
  });

  const structural = structuralLint(seed);
  const privacy = privacyLint(seed);

  // Structural validity is non-negotiable even for a private, local-only
  // seed — a broken seed is useless to the person who just captured it.
  // Privacy findings are advisory here (capture is local); they become a
  // hard gate later at publish time via assertPublishable.
  if (!structural.ok) {
    return { staged: false, seed, structural, privacy, path: stagingPath };
  }

  if (!opts.dryRun) {
    appendToStagingFile(stagingPath, seed);
  }

  return { staged: !opts.dryRun, seed, structural, privacy, path: stagingPath };
}
