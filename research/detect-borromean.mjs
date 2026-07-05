#!/usr/bin/env node
/**
 * scripts/detect-borromean.mjs
 *
 * Finds seed triads with Borromean ring co-occurrence structure:
 * three seeds where no two are strongly linked pairwise, but all
 * three together co-occur significantly more than pairwise rates predict.
 *
 * The Borromean rings (Celtic knot topology): three rings that are
 * inseparably linked as a set, but any two are completely unlinked.
 * Remove any one ring and the other two fall apart.
 *
 * Applied to seeds: A triad {A,B,C} is Borromean when:
 *   P(A∩B∩C) >> max(P(A∩B), P(A∩C), P(B∩C))
 *
 * This reveals cluster structure that pairwise co_inject analysis
 * cannot detect — seeds whose value is collective, not individual.
 *
 * Usage:
 *   node scripts/detect-borromean.mjs           # report only
 *   node scripts/detect-borromean.mjs --write   # write borromean-rings.json
 *   node scripts/detect-borromean.mjs --min 5   # minimum triple co-occurrence
 *   node scripts/detect-borromean.mjs --top 20  # show top N candidates
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, '..');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const SESSIONS_DIR  = path.join(LODESTONE_DIR, 'sessions');
const OUTPUT_FILE   = path.join(LODESTONE_DIR, 'borromean-rings.json');
const SEEDS_DIR     = path.join(ROOT, 'seeds');

const args      = process.argv.slice(2);
const WRITE     = args.includes('--write');
const MIN_N_ARG = args.indexOf('--min');
const TOP_ARG   = args.indexOf('--top');
const MIN_TRIPLE = MIN_N_ARG !== -1 ? parseInt(args[MIN_N_ARG + 1], 10) : 3;
const TOP_N      = TOP_ARG  !== -1 ? parseInt(args[TOP_ARG  + 1], 10) : 15;

// ── Session loading ───────────────────────────────────────────────────────────

function loadSessions() {
  const sessions = [];
  if (!fs.existsSync(SESSIONS_DIR)) return sessions;
  for (const fname of fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, fname), 'utf8'));
      if (s.injected && Array.isArray(s.injected)) sessions.push(s);
    } catch {}
  }
  return sessions;
}

function getIds(session) {
  return [...new Set(
    (session.injected ?? []).map(c => typeof c === 'string' ? c : (c.id ?? c)).filter(Boolean)
  )];
}

// ── Co-occurrence matrices ────────────────────────────────────────────────────

function buildCoOccurrence(sessions) {
  const appears  = Object.create(null); // id → count
  const pairwise = Object.create(null); // "a|b" → count  (a < b lexicographically)
  const triple   = Object.create(null); // "a|b|c" → count

  for (const s of sessions) {
    const ids = getIds(s);
    for (const id of ids) appears[id] = (appears[id] ?? 0) + 1;

    // Pairwise
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join('|');
        pairwise[key] = (pairwise[key] ?? 0) + 1;
      }
    }

    // Triples — O(n³) over injected set; session inject sets are small (≤ 8)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        for (let k = j + 1; k < ids.length; k++) {
          const key = [ids[i], ids[j], ids[k]].sort().join('|');
          triple[key] = (triple[key] ?? 0) + 1;
        }
      }
    }
  }

  return { appears, pairwise, triple, total: sessions.length };
}

// ── Borromean score ───────────────────────────────────────────────────────────
//
// A triad {A,B,C} is Borromean when the triple conditional exceeds all pairwise:
//
//   borromean_score = P(A∩B∩C) / max(P(A∩B), P(A∩C), P(B∩C))
//
// where P(X∩Y) = count(X,Y) / (appears(X) + appears(Y) - count(X,Y))
// (Jaccard-like: intersection / union of session sets)
//
// Score > 2.0 → strong Borromean structure (trio far more linked than pairs)
// Score 1.2–2.0 → weak Borromean (mild collective enhancement)
// Score < 1.2 → pairwise relationships explain the triple (normal cluster)

function jaccard(countAB, freqA, freqB) {
  const union = freqA + freqB - countAB;
  return union > 0 ? countAB / union : 0;
}

function borromeanScore(a, b, c, appears, pairwise, triple) {
  const freqA = appears[a] ?? 0;
  const freqB = appears[b] ?? 0;
  const freqC = appears[c] ?? 0;
  const minAppear = Math.min(freqA, freqB, freqC);
  if (minAppear < 1) return null;

  const pairKeys = [
    [a,b].sort().join('|'),
    [a,c].sort().join('|'),
    [b,c].sort().join('|'),
  ];
  const tripleKey = [a,b,c].sort().join('|');

  const countAB = pairwise[pairKeys[0]] ?? 0;
  const countAC = pairwise[pairKeys[1]] ?? 0;
  const countBC = pairwise[pairKeys[2]] ?? 0;
  const countABC = triple[tripleKey] ?? 0;

  if (countABC < MIN_TRIPLE) return null;

  const jAB  = jaccard(countAB, freqA, freqB);
  const jAC  = jaccard(countAC, freqA, freqC);
  const jBC  = jaccard(countBC, freqB, freqC);
  const maxPair = Math.max(jAB, jAC, jBC);

  // Triple Jaccard: |A∩B∩C| / |A∪B∪C| (approximate using inclusion-exclusion)
  const unionABC = freqA + freqB + freqC - countAB - countAC - countBC + countABC;
  const jABC = unionABC > 0 ? countABC / unionABC : 0;

  const score = maxPair > 0 ? jABC / maxPair : (jABC > 0 ? Infinity : 0);

  return {
    seeds:  [a, b, c].sort(),
    triple_count:    countABC,
    pair_counts:     { ab: countAB, ac: countAC, bc: countBC },
    triple_jaccard:  Math.round(jABC * 1000) / 1000,
    max_pair_jaccard: Math.round(maxPair * 1000) / 1000,
    borromean_score: Math.round(score * 100) / 100,
    appears:         { [a]: freqA, [b]: freqB, [c]: freqC },
    borromean_type:  score > 2.0 ? 'strong' : score > 1.2 ? 'weak' : 'pairwise-explained',
  };
}

// ── Candidate generation ──────────────────────────────────────────────────────

function findBorromeanCandidates(appears, pairwise, triple) {
  const results = [];
  const seen    = new Set();

  // Iterate over all known triples
  for (const key of Object.keys(triple)) {
    if (seen.has(key)) continue;
    seen.add(key);

    const [a, b, c] = key.split('|');
    const result = borromeanScore(a, b, c, appears, pairwise, triple);
    if (result && result.borromean_type !== 'pairwise-explained') {
      results.push(result);
    }
  }

  return results.sort((a, b) => b.borromean_score - a.borromean_score);
}

// ── Seed title lookup ─────────────────────────────────────────────────────────

function buildTitleIndex() {
  const index = Object.create(null);
  if (!fs.existsSync(SEEDS_DIR)) return index;
  for (const f of fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, f), 'utf8'));
      if (Array.isArray(seeds)) {
        for (const s of seeds) { if (s.id && s.title) index[s.id] = s.title; }
      }
    } catch {}
  }
  return index;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const sessions = loadSessions();

if (sessions.length < 5) {
  console.log('Borromean ring detection requires ≥ 5 archived sessions.');
  console.log(`Found: ${sessions.length} session(s) in ${SESSIONS_DIR}`);
  console.log('Record more outcomes with: node scripts/outcome-tracker.mjs --clean');
  process.exit(0);
}

const { appears, pairwise, triple, total } = buildCoOccurrence(sessions);
const candidates = findBorromeanCandidates(appears, pairwise, triple);
const titles = buildTitleIndex();

const top = candidates.slice(0, TOP_N);

console.log(`\nBorromean ring analysis — ${total} sessions, ${Object.keys(triple).length} unique triples`);
console.log(`Minimum triple co-occurrence: ${MIN_TRIPLE}  |  Showing top ${TOP_N}\n`);

if (top.length === 0) {
  console.log('No Borromean candidates found.');
  console.log('Run more sessions and try again, or lower --min threshold.');
  process.exit(0);
}

const strong = top.filter(r => r.borromean_type === 'strong');
const weak   = top.filter(r => r.borromean_type === 'weak');

console.log(`  Strong Borromean (score > 2.0): ${strong.length}`);
console.log(`  Weak Borromean   (score 1.2–2.0): ${weak.length}`);

console.log('\n── Strong Borromean triads ─────────────────────────────────────────────\n');
for (const r of strong) {
  console.log(`  Triad: ${r.seeds.join(' + ')}`);
  for (const id of r.seeds) {
    const t = titles[id] ? ` — ${titles[id]}` : '';
    console.log(`    • ${id}${t}`);
  }
  console.log(`  Score: ${r.borromean_score}  |  Triple count: ${r.triple_count}  |  Max pair Jaccard: ${r.max_pair_jaccard}`);
  console.log(`  Pairwise counts: ab=${r.pair_counts.ab}, ac=${r.pair_counts.ac}, bc=${r.pair_counts.bc}`);
  console.log(`  → These seeds form a collective cluster. Consider adding a group-level`);
  console.log(`    co_inject relationship referencing all three, or minting a parent seed`);
  console.log(`    that implies all three via 'requires' edges.\n`);
}

if (weak.length > 0) {
  console.log('── Weak Borromean triads ───────────────────────────────────────────────\n');
  for (const r of weak) {
    console.log(`  ${r.seeds.join(' + ')}  score=${r.borromean_score}  triple=${r.triple_count}  max_pair=${r.max_pair_jaccard}`);
  }
}

// Write output
if (WRITE) {
  const output = {
    generated_at: new Date().toISOString(),
    sessions_analysed: total,
    min_triple_count: MIN_TRIPLE,
    candidates: candidates,
    summary: {
      total_triples: Object.keys(triple).length,
      strong_borromean: strong.length,
      weak_borromean: weak.length,
    },
  };
  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✓ Written to ${OUTPUT_FILE}`);
  console.log('  Review the candidates and add group-level relationships with:');
  console.log('    detect-relationships.mjs --write');
}
