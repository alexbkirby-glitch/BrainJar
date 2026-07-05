/**
 * mcp-server/datasources.mjs — Phase 7: External Data Sources
 *
 * Connector registry, chunk index I/O, per-source confidence tracking, and the
 * epistemic homeostasis bridge that applies Lodestone's signal layer to any
 * external content.
 *
 * "Everything around retrieval" applied to external sources:
 *   relevance_score     — from the external system's own ranking
 *   source_confidence   — Laplace-smoothed track record (per source, per stack)
 *   certainty           — F1(relevance, source_confidence), same formula as seeds
 *   session_fit         — volatility alignment with context pressure
 *   novelty             — Aberth-Ehrlich repulsion vs. already-injected seeds
 *   inject_recommended  — derived from certainty + novelty thresholds
 *
 * Source types supported:
 *   markdown-dir    — local directory of .md/.txt files
 *   rag_endpoint    — any external RAG API (query → results)
 *   sqlite          — stub: install connectors/sqlite.mjs
 *   duckdb          — stub: install connectors/duckdb.mjs
 *   csv_jsonl       — stub: install connectors/csv-jsonl.mjs
 *
 * Config:    .lodestone/datasources.json
 * Indexes:   api/datasource-index/{source_id}.json  (gitignored, generated)
 * Confidence: .lodestone/source-confidence.json
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

// ── Paths ──────────────────────────────────────────────────────────────────

const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const REGISTRY_FILE = path.join(LODESTONE_DIR, 'datasources.json');
const CONF_FILE     = path.join(LODESTONE_DIR, 'source-confidence.json');
const INDEX_DIR     = path.join(ROOT, 'api', 'datasource-index');

// ── Simple tokenizer (shared vocabulary with the BM25 pipeline) ───────────

const STOP = new Set(['the','and','for','not','with','this','that','from','are','was',
  'but','all','can','its','has','have','when','been','does','did','will','would',
  'could','should','than','then','into','over','after','out','due','per','via',
  'any','each','even','also','may','use','used','set','just','let']);

function tokenize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOP.has(t));
}

// ── Registry ───────────────────────────────────────────────────────────────

let _registry = null;

export function loadDatasourceRegistry() {
  if (_registry) return _registry;
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    _registry = Array.isArray(data) ? data : (data.datasources ?? []);
  } catch { _registry = []; }
  return _registry;
}

export function saveDatasourceRegistry(list) {
  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ datasources: list }, null, 2));
  _registry = list;
}

export function bustRegistryCache() { _registry = null; }

// ── Chunk index I/O ────────────────────────────────────────────────────────
// sourceId is used as a filename: api/datasource-index/{sourceId}.json
// Enforce strict character class to prevent path traversal attacks.

const SAFE_SOURCE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function assertSafeSourceId(id) {
  if (!SAFE_SOURCE_ID_RE.test(id)) {
    throw new Error(
      `Datasource ID "${id}" contains unsafe characters. ` +
      `IDs must be 1–64 characters of [a-zA-Z0-9_-] only.`
    );
  }
}

export function loadChunkIndex(sourceId) {
  assertSafeSourceId(sourceId);
  const p = path.join(INDEX_DIR, `${sourceId}.json`);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

export function saveChunkIndex(sourceId, chunks) {
  assertSafeSourceId(sourceId);
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  fs.writeFileSync(path.join(INDEX_DIR, `${sourceId}.json`), JSON.stringify(chunks));
}

// ── Source confidence (Laplace model, same as seed confidence) ─────────────
// Per-source tracking: how often has content from this source been helpful?
// Confidence = (clean_after + α) / (injections + 2α), α = 1.

const LAPLACE_α    = 1;
const NEW_SOURCE_PRIOR = 0.6; // neutral-positive prior for untracked sources

let _sourceConf = null;

export function loadSourceConfidence() {
  if (_sourceConf) return _sourceConf;
  try { _sourceConf = JSON.parse(fs.readFileSync(CONF_FILE, 'utf8')); }
  catch { _sourceConf = {}; }
  return _sourceConf;
}

function getSourceConf(sourceId) {
  const conf = loadSourceConfidence();
  const rec  = conf[sourceId];
  if (!rec) return NEW_SOURCE_PRIOR;
  return (rec.clean_after + LAPLACE_α) / ((rec.injections ?? 0) + 2 * LAPLACE_α);
}

/**
 * recordSourceOutcome(sourceId, outcome: 'clean'|'regression')
 * Update per-source confidence from a record_outcome call.
 */
export function recordSourceOutcome(sourceId, outcome) {
  const conf = loadSourceConfidence();
  const rec  = conf[sourceId] ?? { injections: 0, clean_after: 0 };
  rec.injections++;
  if (outcome === 'clean') rec.clean_after++;
  conf[sourceId] = rec;
  _sourceConf = conf;
  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  fs.writeFileSync(CONF_FILE, JSON.stringify(conf, null, 2));
}

// ── Connector loader ───────────────────────────────────────────────────────

async function loadConnector(type) {
  const knownTypes = {
    'markdown-dir': './connectors/markdown-dir.mjs',
    'rag_endpoint': './connectors/rag-endpoint.mjs',
  };
  const modPath = knownTypes[type];
  if (!modPath) {
    // Attempt to load a user-installed connector
    try { return await import(`./connectors/${type}.mjs`); }
    catch { throw new Error(`Unsupported datasource type '${type}'. Connector not found.`); }
  }
  return import(modPath);
}

// ── Epistemic homeostasis bridge ───────────────────────────────────────────
// Applies Lodestone's signal layer to externally-retrieved chunks.

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * applyHomeostasis(chunks, sourceId, contextPressureFrac, seedMatches)
 *
 * Takes raw chunks from any connector and enriches them with:
 *   certainty     — F1(relevance, source_confidence)
 *   session_fit   — volatility alignment with current context pressure
 *   novelty       — Aberth-Ehrlich repulsion vs. injected seed set
 *   inject_recommended
 *
 * Returns the enriched chunks, sorted by certainty, capped at 3 per source.
 */
function applyHomeostasis(chunks, sourceId, contextPressureFrac = 0, seedMatches = []) {
  const sourceConfidence = getSourceConf(sourceId);

  // Aberth-Ehrlich: compute token sets for already-injected seeds
  const seedTokenSets = (seedMatches ?? [])
    .filter(m => m.inject_recommended)
    .map(m => new Set(tokenize(`${m.title ?? ''} ${m.symptom ?? ''}`)));

  return chunks.map(chunk => {
    const relevance_score = chunk.score ?? 0;

    // certainty — harmonic mean (F1) of relevance × source_confidence
    const certainty = (relevance_score > 0 && sourceConfidence > 0)
      ? 2 * relevance_score * sourceConfidence / (relevance_score + sourceConfidence)
      : 0;

    // session_fit — proxy volatility from text length:
    //   short chunks ≈ high volatility (surface-level facts)
    //   long chunks  ≈ low volatility  (deep reference material)
    const textLen    = (chunk.text ?? '').length;
    const volatility = Math.max(0, Math.min(1, Math.exp(-textLen / 800)));
    const target     = 1 - contextPressureFrac;
    const session_fit = 1 - Math.abs(volatility - target);

    // novelty — Aberth-Ehrlich repulsion from the seed injection set
    // Prevents injecting external content that duplicates what seeds already cover
    const chunkToks = new Set(tokenize(chunk.text ?? ''));
    let repulsion = 0;
    for (const sToks of seedTokenSets) {
      const inter = [...chunkToks].filter(t => sToks.has(t)).length;
      const union = sToks.size + chunkToks.size - inter;
      const jac   = union > 0 ? inter / union : 0;
      if (jac > 0) repulsion += jac / (1 - jac + 1e-9);
    }
    const novelty = Math.max(0, 1 - repulsion / Math.max(1, seedTokenSets.length));

    const inject_recommended = certainty > 0.2 && novelty > 0.2 && session_fit > 0.3;

    return {
      chunk_id:          chunk.chunk_id,
      source_id:         sourceId,
      text:              chunk.text,
      metadata:          chunk.metadata ?? {},
      relevance_score:   Math.round(relevance_score  * 100) / 100,
      source_confidence: Math.round(sourceConfidence * 100) / 100,
      certainty:         Math.round(certainty        * 100) / 100,
      session_fit:       Math.round(session_fit      * 100) / 100,
      novelty:           Math.round(novelty          * 100) / 100,
      inject_recommended,
    };
  })
  .filter(c => c.inject_recommended)
  .sort((a, b) => b.certainty - a.certainty)
  .slice(0, 3); // cap: max 3 chunks per source
}

// ── Source indexing ────────────────────────────────────────────────────────

/**
 * indexSource(sourceId, embedFn)
 *
 * Runs the indexing pipeline for a local source and saves the chunk index.
 * For rag_endpoint sources, throws (no local indexing needed).
 */
export async function indexSource(sourceId, embedFn) {
  const registry = loadDatasourceRegistry();
  const src = registry.find(s => s.id === sourceId);
  if (!src) throw new Error(`Source '${sourceId}' not found in registry.`);

  const connector = await loadConnector(src.type);
  const existing  = loadChunkIndex(sourceId);
  const chunks    = await connector.index(src, embedFn, existing);
  saveChunkIndex(sourceId, chunks);

  // Update last_indexed timestamp in registry
  src.last_indexed = new Date().toISOString();
  saveDatasourceRegistry(registry);

  return { source_id: sourceId, chunks: chunks.length, with_vectors: chunks.filter(c => c.vector).length };
}

// ── Query pipeline ─────────────────────────────────────────────────────────

/**
 * querySource(sourceConfig, queryText, topK, embedFn)
 *
 * Queries a single source and returns raw chunks (before homeostasis).
 */
async function querySource(sourceConfig, queryText, topK, embedFn) {
  const connector   = await loadConnector(sourceConfig.type);
  const chunkIndex  = sourceConfig.type !== 'rag_endpoint'
    ? loadChunkIndex(sourceConfig.id)
    : null;
  return connector.query(sourceConfig, queryText, topK, chunkIndex, embedFn);
}

/**
 * queryAllDatasources(registry, queryText, seedMatches, contextPressureFrac, embedFn)
 *
 * Queries all registered and active datasources in parallel, applies the
 * epistemic homeostasis bridge to each, and returns a flat enriched list.
 * Never throws — sources that fail are silently skipped.
 */
export async function queryAllDatasources(registry, queryText, seedMatches = [], contextPressureFrac = 0, embedFn = null) {
  const active = registry.filter(s => s.enabled !== false);
  if (!active.length) return [];

  const results = await Promise.allSettled(
    active.map(async src => {
      try {
        const raw = await querySource(src, queryText, 8, embedFn);
        return applyHomeostasis(raw, src.id, contextPressureFrac, seedMatches);
      } catch (err) {
        console.error(`[datasources] ${src.id} query failed: ${err.message}`);
        return [];
      }
    })
  );

  // Flatten, annotate with source name, sort by certainty
  const flat = results
    .flatMap(r => r.status === 'fulfilled' ? r.value : [])
    .map(chunk => {
      const src = active.find(s => s.id === chunk.source_id);
      return { ...chunk, source_name: src?.name ?? chunk.source_id };
    });

  flat.sort((a, b) => b.certainty - a.certainty);
  return flat.slice(0, 6); // global cap: max 6 external chunks total
}
