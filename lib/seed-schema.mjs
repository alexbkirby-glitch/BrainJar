/**
 * lib/seed-schema.mjs — Canonical seed schema + structural lint
 *
 * This is the schema every capture, graze, and publish path validates
 * against. It matches what's actually in seeds/*.json today (lean core),
 * plus nullable enrichment fields for bridge/universal seeds that benefit
 * from domain/facet routing.
 *
 * Deliberately does NOT include RAG-synthesis fields (summary,
 * example_triggers, antipattern_category, applies_when, structural_pattern)
 * — those belong to the wiki-build pass (see WIKI.md), derived from the raw
 * triple later, not authored at capture time. Forcing capture to also
 * produce synthesized prose is friction that kills the capture reflex.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

// Mandatory fields — every seed, no exceptions. Matches seeds/*.json as-is.
export const MANDATORY_FIELDS = [
  'id',
  'stack',
  'blast_radius',
  'source',
  'wrong',
  'correct',
  'symptom',
  'tags',
];
// doc_reference is intentionally NOT mandatory — it's nullable by design
// (blankSeed() defaults it to null) and 391 real corpus seeds legitimately
// omit the key entirely rather than nulling it (found running Chunk B's
// generator against the real 2,156-seed corpus). Still type-checked below
// when present.

// Optional, nullable, additive. Only set when cheap/known at capture time.
// Absence never blocks capture or publish.
export const OPTIONAL_FIELDS = ['domain', 'facet', 'confidence'];

export const VALID_BLAST_LEVELS = ['low', 'medium', 'high', 'critical'];

/**
 * The canonical seed schema's own version number — NOT the same axis as a
 * Jar's content/corpus version (e.g. the flagship's "v48"). This tracks
 * breaking changes to the SHAPE defined in this file (field names, types,
 * required-ness). Bump by exactly 1 whenever a change here would break a
 * grazer or export-transform written against the previous shape. Additive,
 * backwards-compatible changes (a new optional nullable field) do NOT
 * require a bump — see decision 15's additive-fields principle.
 *
 * This is the value every Public Jar manifest declares as `schema_version`
 * (see lib/manifest.mjs, grill-session decision 4: N-1 compatibility only).
 */
export const SCHEMA_VERSION = 1;

/**
 * N-1 compatibility check (grill-session decision 4). A grazer built
 * against `current` must accept manifests declaring `current` or
 * `current - 1`, and reject anything older — no permanent migration-shim
 * tax, one version's grace period only.
 */
export function isSchemaVersionCompatible(declaredVersion, current = SCHEMA_VERSION) {
  const declared = Number(declaredVersion);
  if (!Number.isInteger(declared)) return false;
  return declared === current || declared === current - 1;
}

/**
 * Minimal slug-safe id check: lowercase, digits, underscores only.
 * Matches the style already used in seeds/personal/*.json
 * (e.g. "existence_check_without_status_check_authz").
 */
const ID_PATTERN = /^[a-z0-9_]+$/;

/**
 * Structural lint — the pre-existing "are WRONG/CORRECT/Symptom populated,
 * is blast_radius sane" check referenced in the grill session (Chunk D).
 * Returns { ok, errors, warnings }. Never throws.
 *
 * This does NOT check privacy/anonymizability — see lib/privacy-lint.mjs
 * for that. Structural lint and privacy lint are deliberately separate
 * passes: one asks "is this a valid seed," the other asks "is this safe
 * to make public." Capture always runs both; publish hard-gates on both.
 */
export function structuralLint(seed) {
  const errors = [];
  const warnings = [];

  if (!seed || typeof seed !== 'object') {
    return { ok: false, errors: ['seed is not an object'], warnings };
  }

  for (const field of MANDATORY_FIELDS) {
    if (!(field in seed)) {
      errors.push(`missing mandatory field: ${field}`);
    }
  }

  if (seed.id && !ID_PATTERN.test(seed.id)) {
    errors.push(`id "${seed.id}" must be lowercase snake_case (a-z, 0-9, _)`);
  }

  for (const field of ['wrong', 'correct', 'symptom']) {
    if (typeof seed[field] === 'string' && seed[field].trim().length < 20) {
      errors.push(`${field} is too short to be useful (< 20 chars) — this is likely a placeholder, not a real seed`);
    }
  }

  if (seed.blast_radius && !VALID_BLAST_LEVELS.includes(seed.blast_radius)) {
    errors.push(`blast_radius "${seed.blast_radius}" is not one of: ${VALID_BLAST_LEVELS.join(', ')}`);
  }

  if (!Array.isArray(seed.tags) || seed.tags.length === 0) {
    warnings.push('no tags set — this seed will be nearly unfindable by BM25/tag-overlap scoring');
  }

  if (seed.doc_reference !== null && typeof seed.doc_reference !== 'string') {
    warnings.push('doc_reference should be a string or explicit null, not omitted/undefined');
  }

  // Optional-field sanity, only if present — never required.
  if (seed.confidence !== undefined && seed.confidence !== null) {
    const c = Number(seed.confidence);
    if (Number.isNaN(c) || c < 0 || c > 1) {
      errors.push('confidence, if set, must be a number between 0 and 1');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Build a seed skeleton with every mandatory field present (nulled where
 * unknown) so downstream code never has to guess about missing keys.
 * Optional fields are omitted entirely, not nulled, per the additive rule.
 */
export function blankSeed(overrides = {}) {
  return {
    id: null,
    stack: null,
    blast_radius: null,
    source: 'personal',
    wrong: null,
    correct: null,
    symptom: null,
    tags: [],
    doc_reference: null,
    ...overrides,
  };
}
