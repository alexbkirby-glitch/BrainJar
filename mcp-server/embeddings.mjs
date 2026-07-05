/**
 * mcp-server/embeddings.mjs — Phase 1: Dense Retrieval
 *
 * Vector-similarity search alongside BM25. Seeds are embedded at build time
 * (scripts/build-embeddings.mjs → api/seed-embeddings.json). At query time
 * the symptom text is embedded and cosine-compared against all stored vectors.
 *
 * Graceful no-op when:
 *   - api/seed-embeddings.json does not exist (run: npm run build:embeddings)
 *   - @xenova/transformers / @huggingface/transformers is not installed
 *
 * embed() is exported for reuse by the Phase 7 datasource connector so a
 * single model instance is shared across the whole server.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const ROOT            = path.resolve(__dirname, '..');
const EMBEDDINGS_PATH = path.join(ROOT, 'api', 'seed-embeddings.json');

// ── Lazy-loaded state ──────────────────────────────────────────────────────

let _embeddings = null;   // [{id, stack, hash, vector: number[]}] from disk
let _pipe       = null;   // transformers FeatureExtractionPipeline
let _pipeError  = false;  // true → package unavailable, stop retrying

// ── Embedding pipeline ─────────────────────────────────────────────────────

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
    // Gap A: prefer domain-tuned model when fine-tune-embeddings.py has been run.
    // Falls back to base model with zero config change needed.
    const domainOnnx = path.join(ROOT, 'models', 'lodestone-embeddings-onnx');
    const hasDomain  = fs.existsSync(path.join(domainOnnx, 'model.onnx')) ||
                       fs.existsSync(path.join(domainOnnx, 'model_quantized.onnx'));
    const modelPath  = hasDomain ? domainOnnx : 'Xenova/all-MiniLM-L6-v2';
    if (hasDomain) console.error('[embeddings] Using domain-tuned model:', domainOnnx);

    // quantized=true uses INT8 ONNX weights (~22MB vs ~90MB). Negligible quality loss
    // for retrieval. First call downloads weights to ~/.cache/huggingface/transformers/.
    _pipe = await pipeline('feature-extraction', modelPath, {
      quantized: true,
    });
    return _pipe;
  } catch (err) {
    console.error('[embeddings] Failed to load model:', err.message);
    _pipeError = true;
    return null;
  }
}

// ── Core embed function (exported for Phase 7 datasource reuse) ────────────

/**
 * embed(texts: string[]) → float[][] | null
 *
 * Returns L2-normalised 384-dimensional vectors (all-MiniLM-L6-v2).
 * Returns null when the transformers package is unavailable.
 * Exported so Phase 7 datasource connectors share the same loaded model.
 */
export async function embed(texts) {
  if (!Array.isArray(texts)) texts = [texts];
  const pipe = await getPipeline();
  if (!pipe) return null;

  const output  = await pipe(texts, { pooling: 'mean', normalize: true });
  // Read directly from the underlying Float32Array to work across transformers versions
  const dimSize = output.dims[1]; // 384 for MiniLM-L6-v2
  return Array.from({ length: texts.length }, (_, i) =>
    Array.from(output.data.slice(i * dimSize, (i + 1) * dimSize))
  );
}

// ── Embeddings store ───────────────────────────────────────────────────────

function loadEmbeddings() {
  if (_embeddings) return _embeddings;
  if (!fs.existsSync(EMBEDDINGS_PATH)) return null;
  try {
    _embeddings = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf8'));
    return _embeddings;
  } catch {
    return null;
  }
}

/**
 * bustEmbeddingsCache() — invalidate in-memory store.
 * Called by capture_fix and vault operations when seeds change so the next
 * lookup picks up the updated embeddings file.
 */
export function bustEmbeddingsCache() {
  _embeddings = null;
}

// ── Cosine similarity ──────────────────────────────────────────────────────
// Vectors are L2-normalised by the model, so dot product = cosine similarity.

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ── Dense retrieval ────────────────────────────────────────────────────────

/**
 * denseRetrieve(queryText: string, topK: number) → {id, stack, score}[]
 *
 * Embeds queryText and returns the topK most similar seeds by cosine similarity.
 * Returns [] silently when:
 *   - api/seed-embeddings.json doesn't exist (run: npm run build:embeddings)
 *   - transformers package is unavailable
 *   - embedding model fails to load
 *
 * Scores are in [-1, 1]; in practice positive-dominant due to L2-normalisation.
 * A score near 1.0 indicates near-identical semantic content.
 */
export async function denseRetrieve(queryText, topK = 20) {
  const stored = loadEmbeddings();
  if (!stored || stored.length === 0) return [];

  const vecs = await embed([queryText]);
  if (!vecs) return [];
  const qVec = vecs[0];

  const scored = stored.map(({ id, stack, vector }) => ({
    id,
    stack,
    score: dotProduct(qVec, vector),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * denseRetrieveVector(queryVec: number[], topK: number) → {id, stack, score}[]
 *
 * Like denseRetrieve() but accepts a pre-computed embedding vector instead of
 * text. Used by Phase 4c (HyDE) to retrieve against the hypothetical seed
 * embedding without re-embedding the raw query text a second time.
 */
export async function denseRetrieveVector(queryVec, topK = 20) {
  const stored = loadEmbeddings();
  if (!stored || stored.length === 0) return [];

  const scored = stored.map(({ id, stack, vector }) => ({
    id,
    stack,
    score: dotProduct(queryVec, vector),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
