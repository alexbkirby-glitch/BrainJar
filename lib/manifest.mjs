/**
 * lib/manifest.mjs — Chunk B: manifest schema + builder
 *
 * The manifest is the file every Public Jar declares at its repo root
 * (grill-session decision 3). It serves three audiences at once:
 *   1. Grazers (Chunk C)   — read `schema_version` to decide N-1 compat,
 *                            read `stacks`/`domains`/`facets` for shallow
 *                            scoring against a local Jar's own metadata.
 *   2. Review queue (Chunk D) — reads `seed_count`, `last_updated` for
 *                            provenance surfacing (decision 9) instead of
 *                            a trust/reputation score.
 *   3. Registry page (Chunk I) — reads the exact same fields to render the
 *                            static discovery/attribution listing.
 * One file, one source of truth — see the note left for the user before
 * this chunk started: without this, D and I would each reinvent a second
 * file to carry the same data.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION, structuralLint } from './seed-schema.mjs';
import { privacyLint } from './privacy-lint.mjs';

export const MANIFEST_FILENAME = 'brain-jar-manifest.json';

// Project-prefixed on purpose — a bare "manifest.json" collides with PWA
// web app manifests, browser extension manifests, and assorted other
// tooling that also likes that filename at a repo root. Visible (not a
// dotfile) so it doubles as a human-readable "this is a Jar" signal,
// consistent with decision 13's attribution-over-central-authority stance.

const REQUIRED_MANIFEST_FIELDS = [
  'schema_version',
  'jar_name',
  'seed_count',
  'stacks',
  'last_updated',
];

/**
 * Recursively find seed JSON files under a Jar's seeds/ directory,
 * EXCLUDING seeds/personal/ — that's the non-anonymizable capture staging
 * area (Chunk 0), and it must never contribute to a published manifest's
 * public stats, independent of whatever privacy-lint findings its
 * individual seeds carry.
 */
function findPublicSeedFiles(seedsDir) {
  if (!fs.existsSync(seedsDir)) return [];
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'personal') continue; // hard exclude, not configurable
        walk(full);
      } else if (entry.name.endsWith('.json')) {
        results.push(full);
      }
    }
  };
  walk(seedsDir);
  return results;
}

function loadSeedsFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Scan every public seed file, lint each seed both ways, and aggregate
 * the stats a manifest needs. Never mutates or writes anything — pure
 * read + compute. Returns enough detail for the caller to decide whether
 * to actually write the manifest (see scripts/generate-manifest.mjs).
 */
export function scanCorpus(jarRoot) {
  const seedsDir = path.join(jarRoot, 'seeds');
  const files = findPublicSeedFiles(seedsDir);

  const stacks = new Set();
  const domains = new Set();
  const facets = new Set();
  let seedCount = 0;
  const structuralViolations = [];
  const privacyViolations = [];

  for (const file of files) {
    let seeds;
    try {
      seeds = loadSeedsFromFile(file);
    } catch (e) {
      structuralViolations.push({ file, error: `invalid JSON: ${e.message}` });
      continue;
    }

    for (const seed of seeds) {
      seedCount++;
      if (seed.stack) stacks.add(seed.stack);
      if (seed.domain) domains.add(seed.domain);
      if (seed.facet) facets.add(seed.facet);

      const structural = structuralLint(seed);
      if (!structural.ok) {
        structuralViolations.push({ file, id: seed.id, errors: structural.errors });
      }

      const privacy = privacyLint(seed);
      if (privacy.blocking) {
        privacyViolations.push({ file, id: seed.id, findings: privacy.findings.filter((f) => f.severity === 'high') });
      }
    }
  }

  return {
    seedCount,
    stacks: [...stacks].sort(),
    domains: [...domains].sort(),
    facets: [...facets].sort(),
    filesScanned: files.length,
    structuralViolations,
    privacyViolations,
  };
}

/**
 * Build the manifest object from a corpus scan. Does not write to disk —
 * see scripts/generate-manifest.mjs for the CLI that does, including the
 * privacy-violation hard gate.
 */
export function buildManifest(jarRoot, { jarName } = {}) {
  const scan = scanCorpus(jarRoot);
  const manifest = {
    schema_version: SCHEMA_VERSION,
    jar_name: jarName || path.basename(jarRoot),
    seed_count: scan.seedCount,
    stacks: scan.stacks,
    last_updated: new Date().toISOString().slice(0, 10),
  };
  // Optional aggregate fields — omitted entirely if empty, not nulled,
  // matching the additive-fields convention from decision 15.
  if (scan.domains.length) manifest.domains = scan.domains;
  if (scan.facets.length) manifest.facets = scan.facets;

  return { manifest, scan };
}

/**
 * Structural check for a manifest itself (distinct from a seed's
 * structural lint). Used by grazers (Chunk C) before trusting a fetched
 * manifest, and by generate-manifest.mjs --check for CI validation.
 */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest is not an object'] };
  }
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in manifest)) errors.push(`missing required manifest field: ${field}`);
  }
  if (manifest.schema_version !== undefined && !Number.isInteger(Number(manifest.schema_version))) {
    errors.push('schema_version must be an integer');
  }
  if (manifest.stacks !== undefined && !Array.isArray(manifest.stacks)) {
    errors.push('stacks must be an array');
  }
  if (manifest.seed_count !== undefined && (!Number.isInteger(manifest.seed_count) || manifest.seed_count < 0)) {
    errors.push('seed_count must be a non-negative integer');
  }
  return { ok: errors.length === 0, errors };
}
