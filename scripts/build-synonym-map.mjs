#!/usr/bin/env node
/**
 * scripts/build-synonym-map.mjs — Phase 4b: Corpus PMI Synonym Map
 *
 * Mines the seed corpus for near-synonym term pairs using Pointwise Mutual
 * Information (PMI). Terms that frequently co-occur in the same seed's symptom
 * field within a stack, but rarely co-occur across stacks, are treated as
 * stack-local synonyms for query expansion.
 *
 * Output: api/term-synonyms.json
 *   { "react": { "stale": ["closure","snapshot"], "hook": ["effect","dep"] }, ... }
 *
 * Algorithm:
 *   For each stack with ≥ MIN_SEEDS seeds:
 *     1. Tokenise every seed's WRONG + Symptom text (same stopwords as BM25)
 *     2. Count per-seed token presence (binary — not frequency)
 *     3. Compute PMI for all token pairs: log(P(t1∩t2) / (P(t1) × P(t2)))
 *     4. Pairs with PMI ≥ PMI_THRESHOLD and co-occurrence ≥ MIN_CO become synonyms
 *
 * Usage:
 *   node scripts/build-synonym-map.mjs
 *   npm run build:synonyms
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SEEDS_DIR = path.join(ROOT, 'seeds');
const OUTPUT    = path.join(ROOT, 'api', 'term-synonyms.json');

const MIN_SEEDS      = 8;    // skip stacks with fewer seeds (PMI unreliable)
const MIN_CO         = 2;    // min co-occurrences for a synonym pair
const PMI_THRESHOLD  = 1.5;  // log-PMI threshold (≥2 in ideal conditions; 1.5 is pragmatic)
const MAX_SYNONYMS   = 5;    // max synonyms per term (sorted by PMI desc)

// ── Tokeniser (mirrors index.mjs + build-embeddings.mjs) ─────────────────

const STOPWORDS = new Set([
  'the','and','for','not','with','this','that','from','are','was','but',
  'all','can','its','has','have','when','been','does','did','will','would',
  'could','should','than','then','into','over','after','out','due','per',
  'via','any','each','even','also','may','use','used','set','just','let',
]);

function tokenize(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

// ── Extract symptom + wrong text from a seed ──────────────────────────────

function getTextForPMI(seed) {
  const content  = seed.content ?? '';
  const wrongM   = content.match(/WRONG:\s*([\s\S]*?)(?=CORRECT:|Symptom:|$)/i);
  const symptomM = content.match(/Symptom:\s*([\s\S]*?)(?=WRONG:|CORRECT:|$)/i);
  const wrong    = wrongM   ? wrongM[1].trim()   : '';
  const symptom  = symptomM ? symptomM[1].trim() : '';
  return `${wrong} ${symptom}`.trim();
}

// ── Load all seeds grouped by stack ──────────────────────────────────────

const stacks = {};
const stackFiles = fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'));

for (const fname of stackFiles) {
  const stack = fname.replace('.json', '');
  try {
    const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
    if (Array.isArray(seeds) && seeds.length >= MIN_SEEDS) {
      stacks[stack] = seeds;
    }
  } catch {}
}

console.error(`[build-synonym-map] ${Object.keys(stacks).length} stacks (≥${MIN_SEEDS} seeds each).`);

// ── PMI computation ───────────────────────────────────────────────────────

const synonymMap = {};
let totalPairs   = 0;

for (const [stack, seeds] of Object.entries(stacks)) {
  const N = seeds.length;

  // Binary token-per-doc matrix (set of tokens per seed)
  const docTokenSets = seeds.map(s => new Set(tokenize(getTextForPMI(s))));

  // Count document frequency (how many seeds contain each token)
  const df = new Map();
  for (const tokSet of docTokenSets) {
    for (const t of tokSet) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  // Count co-document frequency (how many seeds contain both tokens)
  const co = new Map(); // `${t1}|${t2}` → count
  for (const tokSet of docTokenSets) {
    const toks = [...tokSet];
    for (let i = 0; i < toks.length; i++) {
      for (let j = i + 1; j < toks.length; j++) {
        const key = toks[i] < toks[j]
          ? `${toks[i]}|${toks[j]}`
          : `${toks[j]}|${toks[i]}`;
        co.set(key, (co.get(key) ?? 0) + 1);
      }
    }
  }

  // Compute PMI and collect synonym pairs
  const stackSyns = {}; // term → [{term, pmi}]

  for (const [key, coCount] of co.entries()) {
    if (coCount < MIN_CO) continue;
    const [t1, t2] = key.split('|');
    const df1 = df.get(t1) ?? 0;
    const df2 = df.get(t2) ?? 0;
    if (!df1 || !df2) continue;

    // PMI = log(P(t1,t2) / (P(t1) * P(t2))) = log(coCount * N / (df1 * df2))
    const pmi = Math.log(coCount * N / (df1 * df2));
    if (pmi < PMI_THRESHOLD) continue;

    stackSyns[t1] = stackSyns[t1] ?? [];
    stackSyns[t2] = stackSyns[t2] ?? [];
    stackSyns[t1].push({ term: t2, pmi });
    stackSyns[t2].push({ term: t1, pmi });
  }

  // Sort by PMI desc, keep top MAX_SYNONYMS, flatten to string arrays
  const stackOut = {};
  for (const [term, pairs] of Object.entries(stackSyns)) {
    const sorted = pairs.sort((a, b) => b.pmi - a.pmi).slice(0, MAX_SYNONYMS);
    if (sorted.length) {
      stackOut[term] = sorted.map(p => p.term);
      totalPairs++;
    }
  }

  if (Object.keys(stackOut).length) {
    synonymMap[stack] = stackOut;
  }

  process.stderr.write(`  ${stack.padEnd(24)} ${Object.keys(stackOut).length} terms with synonyms\n`);
}

// ── Write output ──────────────────────────────────────────────────────────

fs.mkdirSync(path.join(ROOT, 'api'), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(synonymMap, null, 2));

const sizekB = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
console.error(`\n[build-synonym-map] ✓ ${Object.keys(synonymMap).length} stacks, ${totalPairs} synonym entries → api/term-synonyms.json (${sizekB}kB)`);
