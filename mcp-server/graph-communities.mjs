/**
 * mcp-server/graph-communities.mjs — Gap 6: GraphRAG Community Summaries (Runtime)
 *
 * Loads the pre-built community index (api/graph-communities.json) and answers
 * corpus-wide retrieval questions — "what antipatterns exist around X?" —
 * that per-seed retrieval can't answer because it's inherently local.
 *
 * GraphRAG insight (Edge et al., 2024): for global sensemaking queries, you
 * need community summaries that describe the landscape, not individual records.
 * A developer asking "what are all the React state antipatterns?" wants an
 * overview, not the top-1 seed.
 *
 * Build the index with: npm run build:communities
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, '..');
const COMM_PATH   = path.join(ROOT, 'api', 'graph-communities.json');

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

let _communities = null;

export function loadCommunities() {
  if (_communities) return _communities;
  try { _communities = JSON.parse(fs.readFileSync(COMM_PATH, 'utf8')); }
  catch { _communities = []; }
  return _communities;
}

export function bustCommunityCache() { _communities = null; }

// ── Community lookup ───────────────────────────────────────────────────────

/**
 * relevantCommunities(queryVec, topK = 2, minSim = 0.35)
 *
 * Returns the top-K communities most similar to the query embedding.
 * Used to add _community_context to lookup_symptom responses.
 *
 * @param {number[]} queryVec — L2-normalised query embedding
 * @returns {Array<{community_id, label, summary, representative_seeds, sim}>}
 */
export function relevantCommunities(queryVec, topK = 2, minSim = 0.35) {
  const comms = loadCommunities();
  if (!comms.length || !queryVec?.length) return [];

  return comms
    .filter(c => c.embedding?.length === queryVec.length)
    .map(c => ({ ...c, sim: dotProduct(queryVec, c.embedding) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK)
    .filter(c => c.sim >= minSim)
    .map(({ embedding: _e, seed_ids: _s, ...rest }) => rest);
}

/**
 * searchCommunities(queryVec, topK = 5)
 *
 * For the seed_overview MCP tool — returns community summaries ranked by
 * query similarity with representative seeds included.
 */
export function searchCommunities(queryVec, topK = 5) {
  const comms = loadCommunities();
  if (!comms.length || !queryVec?.length) return [];

  return comms
    .filter(c => c.embedding?.length === queryVec.length)
    .map(c => ({
      community_id:         c.community_id,
      label:                c.label,
      summary:              c.summary,
      seed_count:           c.seed_count,
      representative_seeds: c.representative_seeds ?? [],
      sim:                  dotProduct(queryVec, c.embedding),
    }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK);
}
