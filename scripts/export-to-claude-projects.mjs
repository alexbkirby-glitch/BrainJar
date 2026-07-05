#!/usr/bin/env node
/**
 * scripts/export-to-claude-projects.mjs — Claude Projects export transform
 *
 * Generates four files into api/claude-projects/ that make Lodestone seeds
 * usable directly in Claude Projects (without the MCP server):
 *
 *   index.md        — compact one-line-per-seed reference (~30K tokens)
 *                     First thing Claude reads to identify candidate seeds
 *
 *   seeds.md        — full seeds in compressed markdown (~160K tokens)
 *                     Organized by category: security first, then data-loss,
 *                     concurrency, performance, correctness, readability
 *
 *   symptom-map.md  — symptom vocabulary → seed IDs (~15K tokens)
 *                     Maps developer problem vocabulary to relevant seeds
 *                     Lets Claude narrow from 1,971 seeds to 5-10 quickly
 *
 *   CLAUDE.md       — usage instructions for no-server mode
 *                     Explains the two-phase retrieval pattern
 *
 * Token economics:
 *   JSON (full seeds):        ~1.0–1.5M tokens — doesn't fit in context
 *   These files combined:     ~210K tokens — fits in extended context
 *   Just index + symptom-map: ~45K tokens — lightweight option
 *
 * Usage:
 *   node scripts/export-to-claude-projects.mjs
 *   npm run build:claude-projects
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const SEEDS_DIR  = path.join(ROOT, 'seeds');
const OUT_DIR    = path.join(ROOT, 'api', 'claude-projects');

fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────────────

const STOP = new Set(['the','and','for','not','with','this','that','from','are','was',
  'but','all','can','its','has','have','when','been','does','did','will','would',
  'could','should','than','then','into','also','may','use','used','set','let',
  'you','your','my','just','per','via','any','each','even','over','out']);

function tokenize(str) {
  return (str ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOP.has(t));
}

function brief(text, maxChars = 100) {
  if (!text) return '';
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s;
}

function briefTriggers(triggers, max = 2) {
  return (triggers ?? [])
    .slice(0, max)
    .map(t => `"${brief(t, 80)}"`)
    .join(' | ') || '—';
}

// ── Load all seeds (privacy-gated per SCHEMA.md contract MUST-4) ────────────
// Chunk H rescue note: this script was build-claude-projects.mjs; it is now
// a kept export transform (sibling of export-to-gbrain.mjs) since its output
// leaves the machine — uploaded into Claude Projects. Blocking seeds are
// excluded by default; --force includes them (private-project use only).

import { privacyLint } from '../lib/privacy-lint.mjs';
const FORCE = process.argv.includes('--force');

const allSeeds = [];
let privacySkipped = 0;
for (const fname of fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'))) {
  try {
    const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
    for (const s of seeds) {
      if (!s.id) continue;
      const privacy = privacyLint(s);
      if (privacy.blocking && !FORCE) {
        privacySkipped++;
        console.error(`  ⚠ excluded (privacy): ${s.id} — ${privacy.findings.map(f => f.ruleId).join(', ')}`);
        continue;
      }
      allSeeds.push(s);
    }
  } catch {}
}
if (privacySkipped) console.error(`[export-to-claude-projects] ${privacySkipped} seed(s) excluded by privacy lint (--force overrides).`);

// Category order: highest-stakes first
const CAT_ORDER = ['security','data-loss','concurrency','performance','correctness','readability'];
const CAT_EMOJI = {
  'security':    '🔒',
  'data-loss':   '💾',
  'concurrency': '⚡',
  'performance': '🐢',
  'correctness': '✓',
  'readability': '📖',
};

function catOf(seed) {
  return CAT_ORDER.includes(seed.antipattern_category)
    ? seed.antipattern_category : 'correctness';
}

const byCategory = {};
for (const cat of CAT_ORDER) byCategory[cat] = [];
for (const seed of allSeeds) byCategory[catOf(seed)].push(seed);

console.error(`[export-to-claude-projects] ${allSeeds.length} seeds across ${CAT_ORDER.length} categories`);

// ══════════════════════════════════════════════════════════════════════════
// FILE 1: index.md — compact one-line-per-seed reference
// ══════════════════════════════════════════════════════════════════════════

const indexLines = [
  '# Lodestone Seed Index',
  '',
  'One line per seed. Format: `id [stack|category] summary`',
  'Use this file to identify candidate seeds, then read their full entry in seeds.md.',
  '',
];

for (const cat of CAT_ORDER) {
  const seeds = byCategory[cat];
  if (!seeds.length) continue;
  indexLines.push(`## ${CAT_EMOJI[cat]} ${cat.toUpperCase()} (${seeds.length})`);
  for (const s of seeds.sort((a, b) => (a.stack ?? '').localeCompare(b.stack ?? ''))) {
    const stack = s.stack ?? 'universal';
    const sum   = brief(s.summary, 70); // tighter to keep index scannable
    indexLines.push(`${s.id} [${stack}] ${sum}`);
  }
  indexLines.push('');
}

fs.writeFileSync(path.join(OUT_DIR, 'index.md'), indexLines.join('\n'));
const indexTokenEst = Math.round(indexLines.join('\n').length / 4);
console.error(`  index.md: ${indexLines.length} lines (~${indexTokenEst} tokens)`);

// ══════════════════════════════════════════════════════════════════════════
// FILE 2: seeds.md — full seeds in compressed markdown
// ══════════════════════════════════════════════════════════════════════════

const seedLines = [
  '# Lodestone Seeds — Full Reference',
  '',
  'Seeds are organized by category: security and data-loss first (always check these),',
  'then concurrency, performance, correctness, readability.',
  '',
  'Per-seed format:',
  '  **Triggers** — example developer phrasings that should match this pattern',
  '  **Wrong**    — the common mistake causing the problem',
  '  **Correct**  — the right approach',
  '  **Symptom**  — what the developer observes',
  '',
];

for (const cat of CAT_ORDER) {
  const seeds = byCategory[cat];
  if (!seeds.length) continue;

  seedLines.push(`---`);
  seedLines.push(`# ${CAT_EMOJI[cat]} ${cat.toUpperCase()} — ${seeds.length} seeds`);
  seedLines.push('');

for (const s of seeds) {
    const t1  = brief(s.example_triggers?.[0] ?? s.symptom ?? '', 90);
    const t2  = s.example_triggers?.[1] ? `  "${brief(s.example_triggers[1], 90)}"` : '';
    const w   = brief(s.wrong   || '', 100);
    const c   = brief(s.correct || '', 100);
    const sum = brief(s.summary, 110);

    seedLines.push(`**${s.id}** [${s.stack ?? 'universal'}${s.blast_radius === 'high' ? '·⚡' : ''}]`);
    seedLines.push(sum);
    if (t1) seedLines.push(`T: "${t1}"${t2}`);
    if (w)  seedLines.push(`W: ${w}`);
    if (c)  seedLines.push(`C: ${c}`);
    seedLines.push('');
  }
}

fs.writeFileSync(path.join(OUT_DIR, 'seeds.md'), seedLines.join('\n'));
const seedTokenEst = Math.round(seedLines.join('\n').length / 4);
console.error(`  seeds.md: ${seedLines.length} lines (~${seedTokenEst} tokens)`);

// ── Per-category files (seeds-security.md, seeds-correctness.md, etc.) ────
// Lets users include only the categories relevant to their work:
//   seeds-security.md  (~21K tokens) — always worth including
//   seeds-correctness.md (~130K tokens) — largest, most general

for (const cat of CAT_ORDER) {
  const seeds = byCategory[cat];
  if (!seeds.length) continue;

  const catLines = [
    `# Lodestone Seeds — ${CAT_EMOJI[cat]} ${cat.toUpperCase()}`,
    '',
    `${seeds.length} seeds in this category. ` +
    (cat === 'security'    ? 'Always inject relevant security seeds even at low match confidence.' :
     cat === 'data-loss'   ? 'Always check — these antipatterns have irreversible consequences.' :
     cat === 'concurrency' ? 'Check when working with async code, goroutines, threads, or queues.' :
     cat === 'performance' ? 'Check when performance is the explicit topic.' :
     cat === 'correctness' ? 'Inject when the pattern clearly matches the described problem.' :
     'Mention when context allows and the problem is explicitly about code quality.'),
    '',
  ];

  for (const s of seeds) {
    const t1  = brief(s.example_triggers?.[0] ?? s.symptom ?? '', 90);
    const t2  = s.example_triggers?.[1] ? `  "${brief(s.example_triggers[1], 90)}"` : '';
    const w   = brief(s.wrong   || '', 100);
    const c   = brief(s.correct || '', 100);
    const sum = brief(s.summary, 110);

    catLines.push(`**${s.id}** [${s.stack ?? 'universal'}${s.blast_radius === 'high' ? '·⚡' : ''}]`);
    catLines.push(sum);
    if (t1) catLines.push(`T: "${t1}"${t2}`);
    if (w)  catLines.push(`W: ${w}`);
    if (c)  catLines.push(`C: ${c}`);
    catLines.push('');
  }

  const catFile = path.join(OUT_DIR, `seeds-${cat}.md`);
  fs.writeFileSync(catFile, catLines.join('\n'));
  const catEst  = Math.round(catLines.join('\n').length / 4);
  console.error(`  seeds-${cat}.md: ${seeds.length} seeds (~${catEst} tokens)`);
}

// ══════════════════════════════════════════════════════════════════════════
// FILE 3: symptom-map.md — vocabulary → seed IDs mapping
// ══════════════════════════════════════════════════════════════════════════
// Build an inverted index from symptom/trigger vocabulary to seed IDs.
// Only keeps tokens that appear in 2-15 seeds — specific enough to be useful,
// not so common they match everything.

const tokenIndex = new Map(); // token → Set<seed_id>

for (const seed of allSeeds) {
  const text = [
    seed.symptom  ?? '',
    ...(seed.example_triggers ?? []),
    seed.wrong    ?? '',
  ].join(' ');

  for (const tok of tokenize(text)) {
    if (!tokenIndex.has(tok)) tokenIndex.set(tok, new Set());
    tokenIndex.get(tok).add(seed.id);
  }
}

// Filter to useful range: 2–15 seeds per token
const usefulTokens = [...tokenIndex.entries()]
  .filter(([, ids]) => ids.size >= 2 && ids.size <= 15)
  .sort((a, b) => a[1].size - b[1].size); // most specific first

// Group tokens by the seed sets they point to (tokens pointing to same seeds = same cluster)
const seedSetKey = (ids) => [...ids].sort().join(',');
const clusters   = {}; // seedKey → {seeds, tokens[]}

for (const [tok, ids] of usefulTokens) {
  // Find the most overlapping existing cluster
  let bestKey = null, bestOverlap = 0;
  for (const [key] of Object.entries(clusters)) {
    const clusterIds = new Set(key.split(','));
    const inter = [...ids].filter(id => clusterIds.has(id)).length;
    const overlap = inter / Math.max(ids.size, clusterIds.size);
    if (overlap >= 0.6 && inter > bestOverlap) { bestOverlap = inter; bestKey = key; }
  }
  if (bestKey) {
    clusters[bestKey].tokens.push(tok);
  } else {
    clusters[seedSetKey(ids)] = { seeds: [...ids], tokens: [tok] };
  }
}

const mapLines = [
  '# Lodestone Symptom Vocabulary Map',
  '',
  'Maps developer problem vocabulary to relevant seed IDs.',
  'Use this as a pre-filter: identify the 5-10 seeds to read in detail from seeds.md.',
  '',
  '**How to use:**',
  '1. Find vocabulary terms that match what the developer described',
  '2. Note the seed IDs listed under those terms',
  '3. Look up those seeds in seeds.md for the full WRONG/CORRECT pattern',
  '',
];

// Sort clusters by smallest seed count first (most specific first)
const sortedClusters = Object.values(clusters)
  .filter(c => c.tokens.length >= 1)
  .sort((a, b) => a.seeds.length - b.seeds.length);

for (const cluster of sortedClusters.slice(0, 300)) { // cap at 300 clusters
  const vocab = cluster.tokens.slice(0, 6).map(t => `"${t}"`).join(' · ');
  const ids   = cluster.seeds.slice(0, 6).join(', ') +
    (cluster.seeds.length > 6 ? ` (+${cluster.seeds.length - 6} more)` : '');
  mapLines.push(`**${vocab}**`);
  mapLines.push(`→ ${ids}`);
  mapLines.push('');
}

fs.writeFileSync(path.join(OUT_DIR, 'symptom-map.md'), mapLines.join('\n'));
const mapTokenEst = Math.round(mapLines.join('\n').length / 4);
console.error(`  symptom-map.md: ${sortedClusters.length} clusters, ${mapLines.length} lines (~${mapTokenEst} tokens)`);

// ══════════════════════════════════════════════════════════════════════════
// FILE 4: CLAUDE.md — usage instructions for Claude Projects
// Written below as a literal file
// ══════════════════════════════════════════════════════════════════════════

const totalEst = indexTokenEst + seedTokenEst + mapTokenEst;
console.error(`\n[export-to-claude-projects] ✓ All files written to api/claude-projects/`);
console.error(`  Combined token estimate: ~${totalEst} (~${Math.round(totalEst/1000)}K)`);
console.error(`  Lightweight option (index + symptom-map only): ~${Math.round((indexTokenEst+mapTokenEst)/1000)}K tokens`);
