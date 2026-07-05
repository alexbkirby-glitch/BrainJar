/**
 * mcp-server/splade.mjs — Learned Sparse Retrieval (SPLADE)
 *
 * SPLADE (Sparse Lexical and Expansion Model) produces sparse vocabulary-weight
 * vectors that capture semantic expansion: "fires twice" expands toward
 * "double invocation", "StrictMode", "effect cleanup" without those terms
 * appearing in the query. BM25 misses this entirely; dense retrieval captures
 * it but requires both texts to be near in embedding space.
 *
 * SPLADE occupies a third retrieval regime — learned sparse — that complements
 * both BM25 (exact token match) and dense (semantic similarity):
 *
 *   BM25:   "react useEffect fires twice" → exact match on those tokens
 *   Dense:  query embedding near "double mount StrictMode" embedding
 *   SPLADE: "fires twice" expands to include StrictMode-related vocab terms
 *
 * Implementation:
 *   At index time: encode each seed → sparse weight vector over the 30K-token
 *     vocabulary. Non-zero entries (~100-500 per seed) stored in index.
 *   At query time: encode query → sparse vector, dot-product with each seed's
 *     sparse vector, return top-K by score.
 *
 * Model: naver/splade-cocondenser-distil (via Xenova/transformers ONNX format).
 *   ~90MB download. Config: retrieval.splade.model to override.
 *
 * Graceful degradation:
 *   - Disabled by default (retrieval.splade.enabled: false)
 *   - Model not downloaded → silently skipped, falls back to BM25+dense
 *   - Index not built → silently skipped
 *   - Any error → candidates returned unchanged
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'api', 'splade-index.json');

// ── Model singleton ────────────────────────────────────────────────────────

let _tokenizer  = null;
let _model      = null;
let _vocab      = null;   // tokenizer's vocab (id → token string)
let _loadError  = false;

async function getSpladeModel(modelName = 'Xenova/splade-cocondenser-distil') {
  if (_tokenizer && _model) return { tokenizer: _tokenizer, model: _model };
  if (_loadError) return null;

  let tf;
  try       { tf = await import('@xenova/transformers'); }
  catch (_) {
    try     { tf = await import('@huggingface/transformers'); }
    catch   { _loadError = true; return null; }
  }

  try {
    // MaskedLM head produces the logits SPLADE needs for vocabulary weighting
    const { AutoTokenizer, AutoModelForMaskedLM } = tf;
    _tokenizer   = await AutoTokenizer.from_pretrained(modelName, { quantized: true });
    _model       = await AutoModelForMaskedLM.from_pretrained(modelName, { quantized: true });
    return { tokenizer: _tokenizer, model: _model };
  } catch (err) {
    console.error('[splade] Model load failed:', err.message);
    console.error('  Install model: npm run build:splade (downloads ~90MB)');
    _loadError = true;
    return null;
  }
}

// ── Sparse encoding ────────────────────────────────────────────────────────

/**
 * encode(texts, modelName)
 *
 * Returns an array of sparse vectors, one per text.
 * Each sparse vector is {vocab_idx: weight} — only non-zero entries stored.
 *
 * SPLADE formula: max over sequence tokens of log(1 + relu(MLM_logit))
 *   - Max pooling: each vocab term's weight = its peak activation across all
 *     positions in the input. The position that most strongly evokes a term wins.
 *   - log(1+relu): standard SPLADE activation — suppresses negatives, compresses
 *     large positive logits into a manageable range.
 *
 * Typical output: ~100–500 non-zero entries per text at the 0.001 threshold.
 */
export async function encode(texts, modelName = 'Xenova/splade-cocondenser-distil') {
  const mods = await getSpladeModel(modelName);
  if (!mods) return null;

  const { tokenizer, model } = mods;
  const inputs  = await tokenizer(texts, { padding: true, truncation: true, max_length: 256 });
  const outputs = await model(inputs);

  // logits: [batch, seq_len, vocab_size]
  const [B, S, V] = outputs.logits.dims;
  const data       = outputs.logits.data;

  const results = [];
  for (let b = 0; b < B; b++) {
    // Max-pool over sequence tokens for each vocab term
    const maxVals = new Float32Array(V).fill(-Infinity);
    for (let s = 0; s < S; s++) {
      const offset = (b * S + s) * V;
      for (let v = 0; v < V; v++) {
        if (data[offset + v] > maxVals[v]) maxVals[v] = data[offset + v];
      }
    }

    // Apply log(1 + relu(x)) and keep only significant activations
    const sparse = {};
    for (let v = 0; v < V; v++) {
      const w = Math.log1p(Math.max(0, maxVals[v]));
      if (w > 0.001) sparse[v] = Math.round(w * 1000) / 1000; // 3dp
    }
    results.push(sparse);
  }
  return results;
}

// ── Sparse dot product ─────────────────────────────────────────────────────

function sparseDot(a, b) {
  // Iterate over the smaller vector for efficiency
  const [small, large] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  let score = 0;
  for (const [idx, w] of Object.entries(small)) {
    if (large[idx]) score += w * large[idx];
  }
  return score;
}

// ── Index I/O ──────────────────────────────────────────────────────────────

let _index = null;

export function loadSpladeIndex() {
  if (_index) return _index;
  try { _index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); }
  catch { _index = []; }
  return _index;
}

export function bustSpladeCache() { _index = null; }

// ── Query-time retrieval ───────────────────────────────────────────────────

/**
 * spladeRetrieve(queryText, topK, modelName)
 *
 * Encodes queryText as a SPLADE sparse vector and retrieves the topK seeds
 * with the highest dot-product score.
 *
 * Returns [] when disabled, index empty, or model unavailable.
 * Never throws — SPLADE is always supplementary to BM25+dense.
 */
export async function spladeRetrieve(queryText, topK = 50, modelName) {
  const index = loadSpladeIndex();
  if (!index.length) return [];

  const vecs = await encode([queryText], modelName);
  if (!vecs?.[0]) return [];

  const queryVec = vecs[0];

  return index
    .map(entry => ({ id: entry.id, score: sparseDot(queryVec, entry.sparse) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
