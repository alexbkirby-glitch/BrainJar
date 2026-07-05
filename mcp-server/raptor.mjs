/**
 * mcp-server/raptor.mjs — Gap 4: RAPTOR Hierarchical Retrieval (Runtime)
 *
 * Loads the pre-built RAPTOR cluster index (api/raptor-index.json) and provides
 * two things at retrieval time:
 *
 *   1. Cluster context: when a query matches a cluster summary, surface the
 *      cluster's topic as _raptor_context in the lookup_symptom response.
 *      This gives the LLM a "landscape view" of the antipattern territory.
 *
 *   2. Cluster boosting: seeds from a highly-matched cluster get their
 *      retrieval score boosted, improving recall for queries that match the
 *      cluster concept but not individual seed vocabulary.
 *
 * Build the index with: npm run build:raptor
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, '..');
const RAPTOR_PATH   = path.join(ROOT, 'api', 'raptor-index.json');

// ── Similarity ────────────────────────────────────────────────────────────

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ── Cache ─────────────────────────────────────────────────────────────────

let _index = null;

export function loadRaptorIndex() {
  if (_index) return _index;
  try { _index = JSON.parse(fs.readFileSync(RAPTOR_PATH, 'utf8')); }
  catch { _index = []; }
  return _index;
}

export function bustRaptorCache() { _index = null; }

// ── Query ─────────────────────────────────────────────────────────────────

/**
 * raptorContext(queryVec, topK = 2)
 *
 * Returns the top-K cluster summaries most similar to the query embedding.
 * Returns [] when the index isn't built or embeddings aren't available.
 *
 * @param {number[]} queryVec — L2-normalised query embedding
 * @param {number}   topK
 * @returns {Array<{cluster_id, label, summary, seed_ids, sim}>}
 */
export function raptorContext(queryVec, topK = 2) {
  const index = loadRaptorIndex();
  if (!index.length || !queryVec?.length) return [];

  return index
    .filter(c => c.embedding?.length === queryVec.length)
    .map(c => ({ ...c, sim: dotProduct(queryVec, c.embedding) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK)
    .filter(c => c.sim > 0.30) // only include meaningfully similar clusters
    .map(({ embedding: _e, ...rest }) => rest); // drop embedding from response
}

/**
 * raptorBoostSeeds(candidates, queryVec, boostFactor = 0.15)
 *
 * For candidates whose seed ID appears in a highly-matched RAPTOR cluster,
 * boost their rrf_score by boostFactor (additive, capped at 1.0).
 *
 * Encourages seeds from a relevant cluster to surface even when their
 * individual embedding/BM25 scores are slightly below threshold.
 */
export function raptorBoostSeeds(candidates, queryVec, boostFactor = 0.15) {
  const clusters = raptorContext(queryVec, 3);
  if (!clusters.length) return candidates;

  // Build boost map: seed_id → max cluster similarity
  const boostMap = {};
  for (const cluster of clusters) {
    for (const seedId of (cluster.seed_ids ?? [])) {
      if ((cluster.sim ?? 0) > (boostMap[seedId] ?? 0)) {
        boostMap[seedId] = cluster.sim;
      }
    }
  }

  return candidates.map(c => {
    const clusterSim = boostMap[c.entry?.id];
    if (!clusterSim) return c;
    const boost = boostFactor * clusterSim;
    return {
      ...c,
      rrf_score: c.rrf_score != null ? Math.min(1, c.rrf_score + boost) : c.rrf_score,
      _raptor_boost: Math.round(boost * 100) / 100,
    };
  });
}
