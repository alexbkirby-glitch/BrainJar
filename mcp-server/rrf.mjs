/**
 * mcp-server/rrf.mjs — Phase 2: Reciprocal Rank Fusion
 *
 * Merges a BM25 ranked list and a dense ranked list into a single ranking
 * using the Reciprocal Rank Fusion formula (Cormack, Clarke & Buettcher, 2009):
 *
 *   score(seed) = 1/(k + rank_BM25(seed)) + 1/(k + rank_dense(seed))
 *
 * Seeds absent from one list contribute 0 from that leg. The k=60 constant
 * prevents high-ranked seeds from dominating and is robust across list lengths.
 *
 * Why rank-based fusion (vs score-based):
 *   BM25 scores are raw token-frequency counts (unbounded, scale varies with
 *   query length). Dense cosine scores are in [-1, 1]. No normalization can
 *   reliably bridge those scales. Rank-based fusion sidesteps the problem
 *   entirely — only the ordering matters, not the magnitude.
 *
 * rrf_normalized maps the raw RRF score to [0, 1]:
 *   1.0 = top rank in BOTH lists simultaneously (rarest, most agreed-upon result)
 *   0.5 = top rank in exactly ONE list (good, single-retriever signal)
 *   0.0 = last rank in both lists
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

/**
 * rrf(bm25Results, denseResults, k = 60)
 *
 * @param {Array<{entry: {id: string}, score: number}>} bm25Results
 *   Output from buildBM25() — sorted descending by BM25 score.
 *
 * @param {Array<{id: string, score: number}>} denseResults
 *   Output from denseRetrieve() — sorted descending by cosine score.
 *
 * @param {number} k
 *   RRF constant (default 60). Higher k = slower rank-score decay, more weight
 *   to lower-ranked items. 60 is the canonical value from the original paper.
 *
 * @returns {Array<{id, rrf_score, rrf_normalized, bm25_rank, dense_rank}>}
 *   Merged list sorted descending by rrf_score.
 *   rrf_normalized ∈ [0, 1]: 1.0 = top in both, 0.5 = top in one.
 *   bm25_rank / dense_rank: 1-indexed position in source list; null if absent.
 */
export function rrf(bm25Results, denseResults, k = 60) {
  const scores = new Map(); // id → {rrf_score, bm25_rank, dense_rank}

  // BM25 contributions — 1-indexed rank
  for (let i = 0; i < bm25Results.length; i++) {
    const id  = bm25Results[i].entry.id;
    const rec = scores.get(id) ?? { rrf_score: 0, bm25_rank: null, dense_rank: null };
    rec.rrf_score += 1 / (k + i + 1);
    rec.bm25_rank  = i + 1;
    scores.set(id, rec);
  }

  // Dense contributions — 1-indexed rank
  for (let i = 0; i < denseResults.length; i++) {
    const id  = denseResults[i].id;
    const rec = scores.get(id) ?? { rrf_score: 0, bm25_rank: null, dense_rank: null };
    rec.rrf_score += 1 / (k + i + 1);
    rec.dense_rank  = i + 1;
    scores.set(id, rec);
  }

  // Normalise: 2/(k+1) is the maximum achievable score (rank 1 in both lists)
  const maxScore = 2 / (k + 1);

  return [...scores.entries()]
    .map(([id, { rrf_score, bm25_rank, dense_rank }]) => ({
      id,
      rrf_score,
      rrf_normalized: rrf_score / maxScore, // [0, 1]
      bm25_rank,
      dense_rank,
    }))
    .sort((a, b) => b.rrf_score - a.rrf_score);
}

/**
 * rrfMulti(rankedLists, k = 60)
 *
 * N-list generalisation of rrf(). Each list is an array of {id} objects
 * sorted descending by relevance. Supports any number of retrievers.
 * Used when SPLADE contributes a third list alongside BM25 and dense.
 *
 * Normalisation: N/(k+1) — maximum score when rank-1 in ALL N lists.
 *
 * @param {Array<Array<{id: string, [any]: any}>>} rankedLists
 * @param {number} k
 * @returns {Array<{id, rrf_normalized, list_ranks: number[]}>}
 */
export function rrfMulti(rankedLists, k = 60) {
  const N      = rankedLists.length;
  const scores = new Map(); // id → {score, listRanks: []}

  for (let l = 0; l < N; l++) {
    const list = rankedLists[l];
    for (let i = 0; i < list.length; i++) {
      const id  = list[i].id ?? list[i].entry?.id;
      if (!id) continue;
      const rec = scores.get(id) ?? { score: 0, listRanks: new Array(N).fill(null) };
      rec.score       += 1 / (k + i + 1);
      rec.listRanks[l] = i + 1;
      scores.set(id, rec);
    }
  }

  const maxScore = N / (k + 1);

  return [...scores.entries()]
    .map(([id, { score, listRanks }]) => ({
      id,
      rrf_normalized: score / maxScore,
      list_ranks: listRanks,
    }))
    .sort((a, b) => b.rrf_normalized - a.rrf_normalized);
}
