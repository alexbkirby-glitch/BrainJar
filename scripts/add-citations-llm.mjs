#!/usr/bin/env node
/**
 * scripts/add-citations-llm.mjs
 *
 * Improves doc_reference quality beyond what the static keyword mapper produces.
 * The static mapper adds correct base-level URLs (e.g. react.dev/reference/react).
 * This script finds the SPECIFIC page for each seed's exact antipattern.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/add-citations-llm.mjs
 *   node scripts/add-citations-llm.mjs --stack react        # single stack
 *   node scripts/add-citations-llm.mjs --generic-only       # only seeds with base URLs
 *   node scripts/add-citations-llm.mjs --dry                # report without writing
 *   node scripts/add-citations-llm.mjs --batch 15           # seeds per API call
 *
 * Degrades gracefully: if no API key, exits 0 (base citations from static mapper remain).
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, '..');
const SEEDS_DIR   = path.join(ROOT, 'seeds');

const DRY          = process.argv.includes('--dry');
const GENERIC_ONLY = process.argv.includes('--generic-only');
const STACK_FILTER = process.argv[process.argv.indexOf('--stack') + 1] ?? '';
const BATCH_SIZE   = parseInt(process.argv[process.argv.indexOf('--batch') + 1] ?? '12', 10) || 12;
const API_KEY      = process.env.ANTHROPIC_API_KEY ?? process.env.LODESTONE_API_KEY ?? '';
const MODEL        = 'claude-haiku-4-5-20251001';  // fast + cheap for citation lookup

if (!API_KEY) {
  console.log('add-citations-llm: no API key — skipping (base citations from static mapper remain)');
  process.exit(0);
}

// ── "Generic" URLs are base docs pages that lack specificity ─────────────────
// These patterns identify URLs that could be improved with a specific page.
const GENERIC_PATTERNS = [
  /\/docs\/?$/, /\/guide\/?$/, /\/reference\/?$/, /\/manual\/?$/,
  /\/getting-started\/?$/, /\/introduction\/?$/, /\/overview\/?$/,
  /wikipedia\.org\/wiki\/Mathematics$/,
];

function isGeneric(url) {
  return GENERIC_PATTERNS.some(p => p.test(url));
}

function loadSeeds() {
  const all = [];
  for (const fname of fs.readdirSync(SEEDS_DIR).sort()) {
    if (!fname.endsWith('.json')) continue;
    const stack = fname.replace('.json', '');
    if (STACK_FILTER && stack !== STACK_FILTER) continue;
    try {
      const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
      if (!Array.isArray(seeds)) continue;
      for (const s of seeds) {
        if (s?.id) all.push({ ...s, _stack: stack, _file: fname });
      }
    } catch {}
  }
  return all;
}

// ── LLM citation call ─────────────────────────────────────────────────────────

const SYSTEM = `You are a technical documentation specialist.
For each software antipattern seed, find the single most authoritative and specific
documentation URL that supports the CORRECT approach described.

Return ONLY a JSON array — no markdown, no explanation:
[
  {
    "id": "seed_id",
    "url": "https://...",
    "confidence": 0.0,
    "reason": "one sentence why this is the right page"
  }
]

Rules:
- URLs must be real, stable, official documentation pages (not blog posts or StackOverflow)
- Prefer the specific section/anchor over a general docs homepage
- If the current_url is already very specific, return confidence < 0.5 to skip it
- If you're not confident (< 0.7), return the current_url unchanged
- Only suggest URLs from the official docs for that technology`;

async function getCitations(seeds) {
  const payload = seeds.map(s => ({
    id:          s.id,
    stack:       s._stack,
    title:       s.title,
    wrong:       (s.wrong   ?? '').slice(0, 150),
    correct:     (s.correct ?? '').slice(0, 150),
    current_url: s.doc_reference ?? null,
  }));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,      MAX_TOKENS: 2000,
          system:     SYSTEM,
          messages:   [{ role: 'user', content:
            `Here are ${payload.length} seeds. Find the best specific documentation URL for each:\n\n${JSON.stringify(payload, null, 2)}`
          }],
        }),
      });

      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 20000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`API ${res.status}`);

      const data  = await res.json();
      const text  = data.content?.find(b => b.type === 'text')?.text ?? '[]';
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (e) {
      if (attempt === 2) return [];
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  return [];
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('add-citations-llm.mjs\n');

const allSeeds  = loadSeeds();
// Target: seeds with no citation OR seeds with generic base-page citations
const targets   = allSeeds.filter(s =>
  !s.doc_reference ||
  (GENERIC_ONLY && isGeneric(s.doc_reference))
);

console.log(`Loaded ${allSeeds.length} seeds`);
console.log(`Targets (${GENERIC_ONLY ? 'generic URLs' : 'missing + generic'}): ${targets.length}\n`);

if (targets.length === 0) {
  console.log('All seeds already have specific citations.');
  process.exit(0);
}

// Group by stack for coherent batching
const byStack = {};
for (const s of targets) (byStack[s._stack] = byStack[s._stack] ?? []).push(s);

const updates = {};  // id → new URL
let improved = 0;

for (const [stack, seeds] of Object.entries(byStack)) {
  process.stdout.write(`  [${stack}] ${seeds.length} seeds… `);

  for (let i = 0; i < seeds.length; i += BATCH_SIZE) {
    const batch = seeds.slice(i, i + BATCH_SIZE);
    const results = await getCitations(batch);

    for (const r of results) {
      if (!r?.id || !r?.url || r.confidence < 0.7) continue;
      const seed = batch.find(s => s.id === r.id);
      if (!seed) continue;
      if (r.url === seed.doc_reference) continue;  // no change
      if (!r.url.startsWith('https://')) continue;  // safety check
      updates[r.id] = { url: r.url, file: seed._file, reason: r.reason };
      improved++;
    }

    if (i + BATCH_SIZE < seeds.length) await new Promise(r => setTimeout(r, 600));
  }
  process.stdout.write(`done\n`);
}

console.log(`\nImproved ${improved} citations\n`);

if (improved === 0 || DRY) {
  if (DRY && improved > 0) {
    console.log('── Dry run — proposed improvements ──');
    for (const [id, { url, reason }] of Object.entries(updates).slice(0, 10)) {
      console.log(`  ${id} → ${url}`);
      console.log(`         ${reason}`);
    }
  }
  process.exit(0);
}

// Write improvements back to seed files
const byFile = {};
for (const [id, update] of Object.entries(updates)) {
  (byFile[update.file] = byFile[update.file] ?? []).push({ id, url: update.url });
}

for (const [fname, changes] of Object.entries(byFile)) {
  const fpath = path.join(SEEDS_DIR, fname);
  const seeds = JSON.parse(fs.readFileSync(fpath, 'utf8'));
  for (const { id, url } of changes) {
    const s = seeds.find(s => s.id === id);
    if (s) s.doc_reference = url;
  }
  fs.writeFileSync(fpath, JSON.stringify(seeds, null, 2));
}

console.log(`Updated ${Object.keys(byFile).length} seed files.`);
console.log('Run node scripts/build-index.mjs to rebuild the index.');
