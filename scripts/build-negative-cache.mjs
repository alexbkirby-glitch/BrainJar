#!/usr/bin/env node
/**
 * scripts/build-negative-cache.mjs — Loop #9: Negative Document Cache
 *
 * Reads all archived sessions in .lodestone/sessions/, extracts
 * (query_embedding, contradicted_seed_ids) pairs, and writes them to
 * api/negative-cache.json.
 *
 * At retrieval time, lookup_symptom loads this cache and applies soft
 * multiplicative penalties to seeds that were contradicted on past queries
 * with high embedding similarity to the current query (≥ 0.85 cosine).
 *
 * Why this is a new loop rather than duplicating Loop 1 (Laplace confidence drain):
 *   Loop 1 is a GLOBAL signal — confidence drains everywhere for all queries.
 *   Loop 9 is a LOCAL signal — suppression only fires for similar queries.
 *   A seed may be wrong for "stale value in React callback" but correct for
 *   "Vue 3 ref not reactive" — Loop 1 would unjustly drain it globally,
 *   Loop 9 targets the specific context where it failed.
 *
 * Incremental: sessions already in the cache (matched by session_id) are
 * skipped on rebuild. Existing cache entries from deleted sessions are pruned.
 *
 * Usage:
 *   node scripts/build-negative-cache.mjs          # incremental update
 *   node scripts/build-negative-cache.mjs --force  # full rebuild
 *   npm run build:negative-cache
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, '..');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const SESSIONS_DIR  = path.join(LODESTONE_DIR, 'sessions');
const OUTPUT        = path.join(ROOT, 'api', 'negative-cache.json');

const FORCE = process.argv.includes('--force');

// ── Load existing cache for incremental update ────────────────────────────

let existing = [];
if (!FORCE && fs.existsSync(OUTPUT)) {
  try {
    existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    console.error(`[build-negative-cache] Loaded ${existing.length} existing entries.`);
  } catch { existing = []; }
}
const existingBySession = new Set(existing.map(e => e.session_id).filter(Boolean));

// ── Load embedding model ──────────────────────────────────────────────────

let embedFn = null;
try {
  const { embed } = await import('../mcp-server/embeddings.mjs');
  embedFn = embed;
  await embedFn(['warmup']); // trigger model load
  console.error('[build-negative-cache] Embedding model ready.');
} catch (err) {
  console.error(`[build-negative-cache] Warning: embedding model unavailable (${err.message})`);
  console.error('  Sessions with stored initial_query_embedding will still be indexed.');
  console.error('  Sessions without embeddings will be skipped.\n');
}

// ── Process sessions ──────────────────────────────────────────────────────

if (!fs.existsSync(SESSIONS_DIR)) {
  console.error('[build-negative-cache] No sessions directory found. Run some sessions first.');
  process.exit(0);
}

const sessionFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
console.error(`[build-negative-cache] Scanning ${sessionFiles.length} session files...`);

const newEntries = [];
let skipped = 0, noNegatives = 0, noEmbedding = 0;

for (const fname of sessionFiles) {
  let session;
  try { session = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, fname), 'utf8')); }
  catch { continue; }

  const sid             = session.session_id ?? session.generated_at;
  const contradicted    = session.contradicted_seed_ids ?? [];
  const query           = session.query ?? '';

  // Skip if no negatives to record
  if (!contradicted.length) { noNegatives++; continue; }
  // Skip if already in cache (incremental mode)
  if (!FORCE && sid && existingBySession.has(sid)) { skipped++; continue; }

  // Use stored embedding when available (Phase 6 stores initial_query_embedding)
  let queryVec = session.initial_query_embedding ?? null;

  // Fall back to computing the embedding from the query text
  if (!queryVec && query && embedFn) {
    try {
      const vecs = await embedFn([query]);
      queryVec = vecs?.[0] ?? null;
    } catch { queryVec = null; }
  }

  if (!queryVec) { noEmbedding++; continue; }

  newEntries.push({
    session_id:       sid ?? createHash('sha256').update(query).digest('hex').slice(0, 16),
    query_hash:       createHash('sha256').update(query).digest('hex').slice(0, 16),
    query_text:       query.slice(0, 200), // truncate for readability
    query_embedding:  queryVec,
    contradicted_ids: contradicted,
    recorded_at:      session.recorded_at ?? new Date().toISOString(),
  });
}

// ── Merge and write ───────────────────────────────────────────────────────

const combined = FORCE ? newEntries : [...existing, ...newEntries];

fs.mkdirSync(path.join(ROOT, 'api'), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(combined));

const sizekB = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
console.error(`
[build-negative-cache] ✓ Done
  New entries:      ${newEntries.length}
  Reused:           ${existing.length - (FORCE ? existing.length : 0)}
  Skipped:          ${skipped} (already indexed)
  No negatives:     ${noNegatives} (clean sessions — nothing to suppress)
  No embedding:     ${noEmbedding} (no query text or model unavailable)
  Total in cache:   ${combined.length}
  Output:           api/negative-cache.json (${sizekB} kB)
`);

if (combined.length === 0) {
  console.error('No negative entries yet — run more sessions and record contradictions.');
  console.error('Pass contradicted_seed_ids to record_outcome to populate this cache.\n');
}
