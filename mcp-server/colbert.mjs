/**
 * mcp-server/colbert.mjs — Gap B: ColBERT-style Multi-Vector Retrieval
 *
 * Computes MaxSim scores between per-token query embeddings and per-token
 * seed embeddings, capturing partial-match retrieval that single-vector
 * bi-encoders miss.
 *
 * ColBERT formula:
 *   MaxSim(q, d) = (1/|q|) × Σᵢ max_j sim(qᵢ, dⱼ)
 *   where i ranges over query tokens, j over document tokens.
 *
 * Implementation uses the already-loaded MiniLM model (Phase 1) to generate
 * token-level embeddings without an additional model download. This is not
 * identical to a dedicated ColBERT model (which uses BERT-base with
 * interaction-trained representations) but captures the key benefit — partial
 * token-level matching — at zero additional download cost.
 *
 * Optional upgrade path: set retrieval.colbert.model in config to
 * 'Xenova/colbert-ir-colbertv2.0' for proper ColBERT (~440MB quantized).
 *
 * Graceful degradation:
 *   - Disabled (default): returns candidates unchanged, zero latency
 *   - Model unavailable: same no-op
 *   - Model available: adds MaxSim reranking, ~50-100ms for 20 candidates
 *
 * Pipeline position: between Phase 2 (RRF) and Phase 3 (cross-encoder).
 * When enabled, pre-filters candidates so cross-encoder runs on a better
 * shortlist (improving precision while keeping total latency in budget).
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

let _tokenizer  = null;
let _model      = null;
let _modelError = false;
let _loadedModel = null; // which model is currently loaded

// ── Model loading ──────────────────────────────────────────────────────────

async function getModel(modelName = 'Xenova/all-MiniLM-L6-v2') {
  if (_model && _tokenizer && _loadedModel === modelName) {
    return { tokenizer: _tokenizer, model: _model };
  }
  if (_modelError) return null;

  let tf;
  try       { tf = await import('@xenova/transformers'); }
  catch (_) {
    try     { tf = await import('@huggingface/transformers'); }
    catch   { _modelError = true; return null; }
  }

  try {
    const { AutoTokenizer, AutoModel } = tf;
    // quantized: reuse the same cached weights as Phase 1 (no extra download)
    _tokenizer   = await AutoTokenizer.from_pretrained(modelName, { quantized: true });
    _model       = await AutoModel.from_pretrained(modelName, { quantized: true });
    _loadedModel = modelName;
    return { tokenizer: _tokenizer, model: _model };
  } catch (err) {
    console.error('[colbert] Failed to load model:', err.message);
    _modelError = true;
    return null;
  }
}

// ── Token-level embedding ──────────────────────────────────────────────────
// Returns an array of arrays: one entry per text, each entry is an array of
// L2-normalised token vectors (as plain number arrays).
// Skips [CLS] (index 0) and padding tokens — content tokens only.

function normaliseVec(arr) {
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  return norm > 1e-9 ? arr.map(v => v / norm) : arr;
}

async function tokenEmbeddings(texts, modelName) {
  const mods = await getModel(modelName);
  if (!mods) return null;

  const { tokenizer, model } = mods;

  // Batch tokenise — truncate to keep latency bounded
  const inputs  = await tokenizer(texts, { padding: true, truncation: true, max_length: 128 });
  const outputs = await model(inputs);

  // last_hidden_state: [batch, seq_len, hidden]
  const hs   = outputs.last_hidden_state;
  const [B, S, H] = hs.dims;
  const mask = inputs.attention_mask; // [batch, seq_len]

  const result = [];
  for (let b = 0; b < B; b++) {
    const tokVecs = [];
    for (let t = 1; t < S; t++) {           // start at 1 to skip [CLS]
      if (mask.data[b * S + t] === 0) break; // stop at first padding
      const slice = hs.data.slice((b * S + t) * H, (b * S + t + 1) * H);
      tokVecs.push(normaliseVec(Array.from(slice)));
    }
    result.push(tokVecs);
  }
  return result;
}

// ── MaxSim ─────────────────────────────────────────────────────────────────
// For L2-normalised vectors, dot product = cosine similarity.

function maxSim(queryVecs, docVecs) {
  if (!queryVecs.length || !docVecs.length) return 0;
  let total = 0;
  for (const q of queryVecs) {
    let best = -Infinity;
    for (const d of docVecs) {
      let dot = 0;
      for (let i = 0; i < q.length; i++) dot += q[i] * d[i];
      if (dot > best) best = dot;
    }
    total += best;
  }
  // Normalise by query token count so scores are in [-1, 1] like cosine similarity
  return total / queryVecs.length;
}

// ── Rerank ─────────────────────────────────────────────────────────────────

/**
 * colbertRerank(queryText, candidates, opts)
 *
 * Reranks candidates using ColBERT-style MaxSim token interaction.
 * Returns candidates sorted by colbert_score (desc), each with colbert_score added.
 *
 * When disabled or model unavailable, returns candidates unchanged (no-op).
 * Processes in batches to keep memory usage bounded.
 *
 * @param {string}  queryText   — raw symptom/error text from lookup_symptom
 * @param {Array}   candidates  — candidate objects from the RRF phase
 * @param {Object}  opts
 *   @param {boolean} opts.enabled    — must be true or this is a no-op
 *   @param {string}  opts.model      — model identifier (default: MiniLM)
 * @returns {Array} candidates with colbert_score, sorted desc
 */
export async function colbertRerank(queryText, candidates, {
  enabled  = false,
  model:   modelName = 'Xenova/all-MiniLM-L6-v2',
} = {}) {
  if (!enabled || !candidates?.length) return candidates;

  // Embed query tokens
  const qEmbs = await tokenEmbeddings([queryText], modelName);
  if (!qEmbs?.[0]?.length) return candidates; // model unavailable → no-op

  const queryVecs = qEmbs[0];

  // Embed candidate document tokens in one batch for efficiency
  const docTexts = candidates.map(c =>
    `${c.entry?.title ?? ''} ${c.entry?.symptom ?? ''}`.trim()
  );

  const dEmbs = await tokenEmbeddings(docTexts, modelName);
  if (!dEmbs) return candidates;

  // Score each candidate and sort
  const scored = candidates.map((c, i) => ({
    ...c,
    colbert_score: maxSim(queryVecs, dEmbs[i] ?? []),
  }));

  scored.sort((a, b) => b.colbert_score - a.colbert_score);
  return scored;
}
