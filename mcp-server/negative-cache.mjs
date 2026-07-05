/**
 * mcp-server/negative-cache.mjs — Loop #9: Negative Cache Runtime
 *
 * Loads api/negative-cache.json and, given the current query embedding,
 * returns a penalty map: {seedId: penaltyCount} for seeds that were
 * contradicted on past queries with high cosine similarity to the current query.
 *
 * Penalty semantics:
 *   penaltyCount = number of similar past sessions where this seed was contradicted
 *   Applied as a multiplicative factor: rrf_score × 0.5^penaltyCount
 *   One contradiction halves the score. Two contradictions quarter it.
 *   Seeds are never eliminated entirely — only deprioritised.
 *
 * The NEGATIVE_THRESHOLD (0.85) is intentionally high. Negative suppression
 * is context-specific: a seed wrong for "stale closure in callback" might be
 * correct for "memoization in Vue" — the threshold prevents cross-context bleed.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const ROOT            = path.resolve(__dirname, '..');
const CACHE_PATH      = path.join(ROOT, 'api', 'negative-cache.json');

// ── Tuning ─────────────────────────────────────────────────────────────────

/** Minimum cosine similarity to a past contradicted query to trigger penalty. */
const NEGATIVE_THRESHOLD = 0.85;

/** Score multiplier per contradiction count: score × 0.5^n */
const PENALTY_FACTOR = 0.5;

// ── Cache loading (cached in memory) ───────────────────────────────────────

let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000; // reload from disk after 60s to pick up new builds

export function loadNegativeCache() {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL) return _cache;
  try {
    _cache     = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    _cacheTime = now;
  } catch {
    _cache = [];
  }
  return _cache;
}

export function bustNegativeCacheMemory() { _cache = null; }

// ── Cosine similarity ──────────────────────────────────────────────────────

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ── Penalty computation ────────────────────────────────────────────────────

/**
 * getNegativePenalties(queryVec)
 *
 * Returns a map of {seedId: penaltyCount} for seeds that appeared in
 * contradicted_seed_ids of past sessions whose query embedding is
 * cosine-similar to queryVec at or above NEGATIVE_THRESHOLD.
 *
 * Returns {} when the cache is empty or no matches found.
 *
 * @param {number[]} queryVec — L2-normalised query embedding from embed()
 */
export function getNegativePenalties(queryVec) {
  const cache = loadNegativeCache();
  if (!cache.length) return {};

  const penalties = {};

  for (const entry of cache) {
    const ev = entry.query_embedding;
    if (!ev || ev.length !== queryVec.length) continue;

    const sim = dotProduct(queryVec, ev);
    if (sim < NEGATIVE_THRESHOLD) continue;

    for (const seedId of (entry.contradicted_ids ?? [])) {
      penalties[seedId] = (penalties[seedId] ?? 0) + 1;
    }
  }

  return penalties;
}

// ── Penalty application ────────────────────────────────────────────────────

/**
 * applyNegativePenalties(candidates, penalties)
 *
 * Applies multiplicative score penalties to RRF candidates in-place.
 * Returns a new sorted candidates array (does not mutate input).
 *
 * For each candidate whose seed ID has a penalty count n:
 *   rrf_score  *= 0.5^n    (halved per contradiction)
 *   score      *= 0.5^n    (BM25 score similarly reduced)
 *   _negative_penalty = n  (stored for _debug output)
 *
 * @param {Array}  candidates — from the RRF or BM25 pipeline
 * @param {Object} penalties  — {seedId: penaltyCount} from getNegativePenalties
 */
export function applyNegativePenalties(candidates, penalties) {
  const penalised = candidates.map(c => {
    const n = penalties[c.entry?.id];
    if (!n) return c;
    const factor = Math.pow(PENALTY_FACTOR, n);
    return {
      ...c,
      score:            c.score  * factor,
      rrf_score:        c.rrf_score  != null ? c.rrf_score  * factor : c.rrf_score,
      _negative_penalty: n,
    };
  });

  // Re-sort: penalised seeds sink down the ranking
  penalised.sort((a, b) =>
    ((b.rrf_score ?? 0) || (b.score ?? 0)) - ((a.rrf_score ?? 0) || (a.score ?? 0))
  );
  return penalised;
}
