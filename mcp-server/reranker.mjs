/**
 * mcp-server/reranker.mjs — Phase 3: Cross-encoder Reranking
 *
 * After hybrid RRF retrieves top candidates, a cross-encoder rescores each
 * (query, seed) pair jointly. Unlike bi-encoders (Phase 1), the cross-encoder
 * sees both texts simultaneously and models their interaction — catching subtle
 * relevance signals that independent representations miss.
 *
 * Model: Xenova/ms-marco-MiniLM-L-6-v2
 *   ~22MB quantized ONNX (same package as Phase 1, separate model download)
 *   ~5–10ms per (query, seed) pair → ~100–180ms for 20 candidates
 *   Trained on MS MARCO (passage retrieval); generalises well to short technical text
 *
 * Passage representation: "{title}. {symptom}"
 *   Title gives the pattern name; symptom describes what the developer observes.
 *   Deliberately excludes CORRECT to match against the problem, not the fix.
 *
 * Scores: [0, 1] where 1 = maximally relevant.
 *   ms-marco cross-encoders output logits; we sigmoid-transform to [0, 1].
 *   The score flows into evaluateInjection() as the similarity parameter —
 *   more accurate than BM25 or cosine because it's query-conditioned.
 *
 * Graceful no-op: returns candidates unchanged if model unavailable.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

const MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

let _pipe      = null;
let _pipeError = false;

// ── Pipeline loader ────────────────────────────────────────────────────────

async function getPipeline() {
  if (_pipe)      return _pipe;
  if (_pipeError) return null;

  let tf;
  try       { tf = await import('@xenova/transformers'); }
  catch (_) {
    try     { tf = await import('@huggingface/transformers'); }
    catch   { _pipeError = true; return null; }
  }

  try {
    const { pipeline } = tf;
    // quantized=true: INT8 weights (~22MB). Downloads to ~/.cache/huggingface/transformers/
    // on first use — separate from the Phase 1 embedding model.
    _pipe = await pipeline('text-classification', MODEL, { quantized: true });
    return _pipe;
  } catch (err) {
    console.error('[reranker] Failed to load model:', err.message);
    _pipeError = true;
    return null;
  }
}

// ── Score extraction ───────────────────────────────────────────────────────
// ms-marco cross-encoders are binary classifiers:
//   LABEL_0 = not relevant
//   LABEL_1 = relevant  ← we want this score
//
// @xenova/transformers returns either:
//   topk=1:    {label: 'LABEL_X', score: N}          — pick top label
//   topk=null: [{label:'LABEL_0',score:N}, {...}]    — find LABEL_1 directly
//
// If the top label is LABEL_0, score is the probability of NOT being relevant,
// so we flip: relevance = 1 − score.

function extractScore(result) {
  if (Array.isArray(result)) {
    const pos = result.find(r => r.label === 'LABEL_1');
    if (pos) return pos.score;
    // Fallback: if labels are unexpected, use the top score
    return [...result].sort((a, b) => b.score - a.score)[0]?.score ?? 0;
  }
  if (result?.label === 'LABEL_0') return 1 - (result.score ?? 0.5);
  return result?.score ?? 0;
}

// ── Rerank ─────────────────────────────────────────────────────────────────

/**
 * rerank(queryText, candidates)
 *
 * Scores each candidate against queryText using a cross-encoder and returns
 * candidates sorted descending by reranker_score. Does not slice — the caller
 * decides how many to use from the front of the returned array.
 *
 * Each returned candidate gains a `reranker_score: number` field in [0, 1].
 *
 * Graceful no-op: returns the original `candidates` array if the model fails
 * to load or inference throws — BM25+RRF ordering is preserved as fallback.
 *
 * @param {string} queryText — the raw symptom / error text from lookup_symptom
 * @param {Array}  candidates — candidate objects from the RRF phase
 * @returns {Array} candidates with reranker_score, sorted by reranker_score desc
 */
export async function rerank(queryText, candidates) {
  if (!candidates || candidates.length === 0) return candidates;

  const pipe = await getPipeline();
  if (!pipe) return candidates; // no-op

  // Build (query, passage) pairs.
  // Passage = title + symptom — the signal the cross-encoder should judge.
  const pairs = candidates.map(c => {
    const symptom = c.entry.symptom ?? '';
    const title   = c.entry.title   ?? '';
    return {
      text:      queryText,
      text_pair: symptom ? `${title}. ${symptom}` : title,
    };
  });

  let rawResults;
  try {
    // topk: null → get all label scores so we can always find LABEL_1 directly
    rawResults = await pipe(pairs, { topk: null });
  } catch (err) {
    console.error('[reranker] Inference error:', err.message);
    return candidates; // graceful fallback
  }

  // Attach scores and sort
  const scored = candidates.map((c, i) => ({
    ...c,
    reranker_score: extractScore(rawResults[i]),
  }));
  scored.sort((a, b) => b.reranker_score - a.reranker_score);
  return scored;
}
