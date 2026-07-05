#!/usr/bin/env node
/**
 * scripts/export-to-gbrain.mjs — Chunk G: the ONE reference export transform
 *
 * Converts canonical Brain Jar seeds into GBrain's markdown-page format for
 * `gbrain import <dir>`. This is a worked example of SCHEMA.md's export
 * transform contract — read that first if you're writing your own
 * export-to-<brain>.mjs. Explicitly NOT a commitment to maintain transforms
 * for other brains (grill-session decision 6).
 *
 * GBrain contract targeted (verified against garrytan/gbrain v0.42.56.0
 * source, 2026-07-02 — src/core/markdown.ts + src/core/import-file.ts +
 * docs/GBRAIN_RECOMMENDED_SCHEMA.md schema-version 0.5.0):
 *   - One markdown page per seed. YAML frontmatter; `type`, `title`, `tags`
 *     are honored structurally, every OTHER frontmatter key is preserved as
 *     queryable metadata (maps to GBrain's fact store).
 *   - Body splits at the first timeline sentinel into compiled truth
 *     (above) and append-only timeline (below). We emit `<!-- timeline -->`,
 *     the preferred sentinel; `--- timeline ---` and `---` + `## Timeline`
 *     are the fallback spellings GBrain also recognizes.
 *   - [[wikilinks]] are parsed by GBrain's regex inference cascade into
 *     typed graph edges — see_also/relationships become real edges free.
 *   - Canonical slugs: lowercase kebab; the filename IS the identity.
 *   - RESERVED frontmatter keys we must NEVER emit (v0.42 trust boundary,
 *     gbrain #1699): `quarantine`, `content_flag`, `embed_skip`. GBrain
 *     strips these from remote input; a local `gbrain import` of our files
 *     is TRUSTED input, so emitting them would actually take effect. Seeds
 *     can arrive via grazing from strangers — sanitize accordingly.
 *   - GBrain moves fast (v0.38→v0.42 in ~6 weeks). This transform targets
 *     the markdown-import contract, the most stable surface (markdown repo
 *     is GBrain's system of record) — not its MCP tools or DB schema.
 *
 * Output layout (a directory you point `gbrain import` at):
 *   <out>/code-antipatterns/README.md       — the MECE resolver GBrain's
 *                                             schema doc requires per directory
 *   <out>/code-antipatterns/<slug>.md       — one page per seed
 *
 * Type choice: `type: concept`. GBrain's own disambiguation rule — "could
 * you teach it as a framework? → concept" — fits an antipattern exactly,
 * and `concept` is in the gbrain-base taxonomy so page-type inference
 * won't fight us. The antipattern-ness lives in dedicated frontmatter
 * fields (`antipattern_category`, `blast_radius`, …), not in a custom
 * type GBrain has never heard of.
 *
 * Usage:
 *   node scripts/export-to-gbrain.mjs                     # all public stacks → export/gbrain/
 *   node scripts/export-to-gbrain.mjs --stack=react       # one stack
 *   node scripts/export-to-gbrain.mjs --out=/tmp/pages    # custom output dir
 *   node scripts/export-to-gbrain.mjs --include-deprecated
 *   node scripts/export-to-gbrain.mjs --force             # include privacy-BLOCKING seeds (don't)
 *   node scripts/export-to-gbrain.mjs --dry-run           # report, write nothing
 *
 * Then: gbrain import <out>
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuralLint, SCHEMA_VERSION } from '../lib/seed-schema.mjs';
import { privacyLint } from '../lib/privacy-lint.mjs';
import { MANIFEST_FILENAME } from '../lib/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS_DIR = path.join(ROOT, 'seeds');
const PAGE_DIR_NAME = 'code-antipatterns';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

// GBrain v0.42 gate-owned frontmatter markers — emitting any of these from
// grazed (stranger-authored) seed content would be a privilege escalation
// into GBrain's trust machinery. Contract rule MUST-5.
const GBRAIN_RESERVED_KEYS = new Set(['quarantine', 'content_flag', 'embed_skip']);

/** seed id (snake_case) → GBrain canonical slug (kebab-case). Reversible: s/-/_/g. */
function slugify(id) {
  return String(id).toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Sanitize seed free text for embedding in a GBrain page body.
 * Two attack surfaces (contract rule MUST-5):
 *   1. Timeline sentinels — a seed containing "<!-- timeline -->" (or the
 *      alternate spellings) would truncate the page's compiled truth and
 *      inject attacker text into the append-only evidence layer.
 *   2. Frontmatter fences — a line of "---" at body start can't occur here
 *      (we always prefix with our own text), but neutralize full-line
 *      horizontal rules anyway since a plain `---` before a `## Timeline`
 *      header is also a recognized sentinel.
 */
function sanitizeBody(text) {
  return String(text ?? '')
    .replace(/<!--\s*timeline\s*-->/gi, '(timeline-marker removed)')
    .replace(/^---\s*timeline\s*---\s*$/gim, '(timeline-marker removed)')
    .replace(/^\s*(---+|\*\*\*+|___+)\s*$/gm, ' ')     // full-line horizontal rules
    .replace(/^##\s+(Timeline|History)\b/gim, '### $1'); // demote sentinel-adjacent headers
}

/** Sanitize a value destined for YAML frontmatter (single-line, quoted). */
function yamlString(v) {
  return JSON.stringify(String(v ?? '')); // JSON string is valid YAML 1.2 scalar
}

function yamlList(arr) {
  return `[${arr.map(yamlString).join(', ')}]`;
}

function loadPublicSeedFiles() {
  return fs.readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ stack: f.replace(/\.json$/, ''), file: path.join(SEEDS_DIR, f) }));
}

function jarName() {
  const mp = path.join(ROOT, MANIFEST_FILENAME);
  if (fs.existsSync(mp)) {
    try { return JSON.parse(fs.readFileSync(mp, 'utf8')).jar_name ?? path.basename(ROOT); }
    catch { /* fall through */ }
  }
  return path.basename(ROOT);
}

/** Collect every edge id (see_also + relationships, both legacy-string and weighted-object forms). */
function edgeIds(seed) {
  const ids = new Set();
  for (const id of seed.see_also ?? []) ids.add(typeof id === 'string' ? id : id?.id);
  for (const edges of Object.values(seed.relationships ?? {})) {
    if (!Array.isArray(edges)) continue;
    for (const e of edges) ids.add(typeof e === 'string' ? e : e?.id);
  }
  ids.delete(undefined); ids.delete(null);
  return [...ids];
}

function renderPage(seed, { jar, today, knownIds }) {
  const slug = slugify(seed.id);
  const title = seed.title ?? seed.id.replace(/_/g, ' ');
  const tags = [...new Set([...(seed.tags ?? []), 'antipattern', seed.stack].filter(Boolean))];

  // Frontmatter: type/title/tags honored structurally by GBrain; the rest
  // pass through as queryable metadata. Built from a fixed allowlist of
  // schema fields — arbitrary seed keys never reach frontmatter, so a
  // hostile seed can't smuggle GBrain-reserved markers (belt) — and we
  // assert the reserved set anyway (suspenders).
  const fm = [
    ['type', '"concept"'],
    ['title', yamlString(title)],
    ['tags', yamlList(tags)],
    ['stack', yamlString(seed.stack)],
    ['blast_radius', yamlString(seed.blast_radius)],
    ...(seed.antipattern_category ? [['antipattern_category', yamlString(seed.antipattern_category)]] : []),
    ...(seed.domain ? [['domain', yamlString(seed.domain)]] : []),
    ...(seed.facet ? [['facet', yamlString(seed.facet)]] : []),
    ...(seed.confidence !== undefined && seed.confidence !== null ? [['confidence', String(Number(seed.confidence))]] : []),
    ...(seed.verification_status ? [['verification_status', yamlString(seed.verification_status)]] : []),
    ...(seed.framework_version ? [['framework_version', yamlString(seed.framework_version)]] : []),
    ...(seed.valid_through ? [['valid_through', yamlString(seed.valid_through)]] : []),
    ['brain_jar_id', yamlString(seed.id)],
    ['brain_jar_name', yamlString(jar)],
    ['brain_jar_schema_version', String(SCHEMA_VERSION)],
  ];
  for (const [k] of fm) {
    if (GBRAIN_RESERVED_KEYS.has(k)) throw new Error(`refusing to emit GBrain-reserved frontmatter key: ${k}`);
  }

  const wrong = sanitizeBody(seed.wrong ?? seed.content ?? '');
  const correct = sanitizeBody(seed.correct ?? '');
  const symptom = sanitizeBody(seed.symptom ?? '');
  const summary = sanitizeBody(seed.summary ?? title);

  const seeAlso = edgeIds(seed)
    .filter((id) => knownIds.has(id))       // only wikilink pages this export actually creates
    .map((id) => `[[${slugify(id)}]]`);

  const triggers = (seed.example_triggers ?? []).map((t) => `- ${sanitizeBody(t)}`).join('\n');
  const aw = seed.applies_when ?? {};

  const lines = [
    '---',
    ...fm.map(([k, v]) => `${k}: ${v}`),
    '---',
    '',
    `# ${sanitizeBody(title)}`,
    '',
    summary,
    '',
    '## Wrong',
    '',
    wrong,
    '',
    '## Correct',
    '',
    correct,
    '',
    '## Symptom',
    '',
    symptom,
    '',
  ];

  if (aw.stack || aw.facet || aw.domain) {
    lines.push('## Applies When', '',
      [aw.stack && `stack: ${aw.stack}`, aw.facet && `facet: ${aw.facet}`, aw.domain && `domain: ${aw.domain}`]
        .filter(Boolean).join(' · '), '');
  }
  if (triggers) lines.push('## Example Triggers', '', triggers, '');
  if (seed.doc_reference) lines.push('## Reference', '', `Official docs: ${sanitizeBody(seed.doc_reference)}`, '');
  if (seeAlso.length) lines.push('## See Also', '', seeAlso.join(' · '), '');

  // Timeline: append-only provenance layer. GBrain's preferred sentinel.
  const provenance = [seed.source ?? 'community',
    seed.verification_status ? `verification: ${seed.verification_status}` : null,
    ...(Array.isArray(seed.grazed_from) ? seed.grazed_from.map((g) => `grazed from ${g?.jar ?? 'unknown'}`) : []),
  ].filter(Boolean).join(', ');
  lines.push('<!-- timeline -->', '',
    `- ${today} — imported from Brain Jar "${jar}" (seed \`${seed.id}\`, ${provenance}) via export-to-gbrain.mjs, schema_version ${SCHEMA_VERSION}.`,
    '');

  return { slug, content: lines.join('\n') };
}

function renderResolver({ jar, stacks, count, today }) {
  return `---
type: concept
title: "Code antipatterns (Brain Jar import) — resolver"
tags: ["antipattern", "resolver", "brain-jar"]
---

# code-antipatterns/ — resolver

**What goes here:** WRONG→CORRECT→Symptom code-antipattern pages imported
from the Brain Jar library "${jar}" (${count} seeds across ${stacks} stacks,
imported ${today}). One page per seed; the filename slug is the seed's
canonical id (kebab-cased, reversible via s/-/_/g).

**What does NOT go here:** hand-written concept pages (→ concepts/),
project-specific bug notes (→ the project's page), anything a human
authored directly in this brain. Pages in this directory are REGENERATED
by re-running \`export-to-gbrain.mjs\` — hand edits will be overwritten.
Correct a bad seed at the source Jar, then re-export.

<!-- timeline -->

- ${today} — directory created by export-to-gbrain.mjs.
`;
}

function main() {
  const onlyStack = value('stack');
  const outDir = path.resolve(value('out') ?? path.join(ROOT, 'export', 'gbrain'));
  const includeDeprecated = flag('include-deprecated');
  const force = flag('force');
  const dryRun = flag('dry-run');
  const today = new Date().toISOString().slice(0, 10);
  const jar = jarName();

  const files = loadPublicSeedFiles().filter((f) => !onlyStack || f.stack === onlyStack);
  if (files.length === 0) {
    console.error(onlyStack ? `No seed file for stack "${onlyStack}".` : 'No seed files found.');
    process.exit(1);
  }

  // Pass 1: load + normalize documented flagship quirks (SCHEMA.md "Known
  // flagship-corpus quirks"), THEN filter. Normalization is quirk-repair
  // only, never invention: absent `source` defaults to "community"; seeds
  // predating the explicit wrong/correct/symptom fields get them parsed
  // out of the legacy flattened `content` string when its WRONG/CORRECT/
  // Symptom markers are present. Anything still non-conforming after that
  // is genuinely broken and gets skipped.
  const kept = [];
  const skipped = { structural: 0, privacy: 0, deprecated: 0 };
  const CONTENT_SHAPE = /WRONG:\s*(.+?)\s*CORRECT:\s*(.+?)\s*Symptom:\s*(.+)$/s;
  for (const { stack, file } of files) {
    let seeds;
    try { seeds = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (!Array.isArray(seeds)) continue;
    for (const raw of seeds) {
      const seed = { ...raw };
      if (seed.source === undefined) seed.source = 'community';
      if ((!seed.wrong || !seed.correct || !seed.symptom) && typeof seed.content === 'string') {
        const m = seed.content.match(CONTENT_SHAPE);
        if (m) {
          seed.wrong ??= m[1];
          seed.correct ??= m[2];
          seed.symptom ??= m[3];
        }
      }
      if (!structuralLint(seed).ok) { skipped.structural++; continue; }       // MUST: skip non-conforming (SCHEMA.md quirks section)
      if (seed.deprecated === true && !includeDeprecated) { skipped.deprecated++; continue; } // SHOULD-10
      const privacy = privacyLint(seed);
      if (privacy.blocking && !force) { skipped.privacy++; console.error(`  ⚠ excluded (privacy): ${stack}/${seed.id} — ${privacy.findings.map((f) => f.ruleId).join(', ')}`); continue; } // MUST-4
      kept.push(seed);
    }
  }
  const knownIds = new Set(kept.map((s) => s.id));

  // Pass 2: render. Idempotent by construction except `today` in provenance.
  const pages = [];
  const slugSeen = new Map();
  for (const seed of kept) {
    const page = renderPage(seed, { jar, today, knownIds });
    if (slugSeen.has(page.slug)) {
      console.error(`  ⚠ slug collision: ${seed.id} and ${slugSeen.get(page.slug)} both map to ${page.slug} — suffixing`);
      page.slug = `${page.slug}-${slugSeen.size}`;
    }
    slugSeen.set(page.slug, seed.id);
    pages.push(page);
  }

  console.log(`Export: ${pages.length} page(s) from ${files.length} stack file(s) → ${outDir}/${PAGE_DIR_NAME}/`);
  console.log(`Skipped: ${skipped.structural} structural-lint failures, ${skipped.privacy} privacy-blocking, ${skipped.deprecated} deprecated.`);

  if (dryRun) { console.log('--dry-run: nothing written.'); return; }

  const pageDir = path.join(outDir, PAGE_DIR_NAME);
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'README.md'), renderResolver({ jar, stacks: files.length, count: pages.length, today }));
  for (const { slug, content } of pages) {
    fs.writeFileSync(path.join(pageDir, `${slug}.md`), content);
  }
  console.log(`\n✓ Wrote ${pages.length + 1} file(s). Import with:\n  gbrain import ${outDir}`);
}

main();
