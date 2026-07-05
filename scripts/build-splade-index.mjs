#!/usr/bin/env node
/**
 * scripts/build-splade-index.mjs — SPLADE Learned Sparse Index Builder
 *
 * Encodes all seeds as SPLADE sparse vocabulary-weight vectors and writes
 * api/splade-index.json. The index enables SPLADE retrieval as a third
 * retrieval source alongside BM25 and dense embeddings.
 *
 * Requires the SPLADE model (~90MB download on first run):
 *   Model: naver/splade-cocondenser-distil (ONNX format via Xenova)
 *
 * Incremental: seeds whose content hash matches the stored entry are skipped.
 * Use --force to rebuild everything.
 *
 * Usage:
 *   node scripts/build-splade-index.mjs
 *   node scripts/build-splade-index.mjs --force
 *   npm run build:splade
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const SEEDS_DIR  = path.join(ROOT, 'seeds');
const OUTPUT     = path.join(ROOT, 'api', 'splade-index.json');
const FORCE      = process.argv.includes('--force');
const BATCH_SIZE = 8; // SPLADE is heavier than dense — smaller batches
const MODEL_NAME = process.env.SPLADE_MODEL ?? 'Xenova/splade-cocondenser-distil';

// ── Load SPLADE module ────────────────────────────────────────────────────

const { encode } = await import('../mcp-server/splade.mjs');

console.error(`[build-splade] Loading SPLADE model: ${MODEL_NAME}`);
console.error('[build-splade] First run: downloads ~90MB to ~/.cache/huggingface/transformers/');

// Warm up / verify model loads
const warmup = await encode(['test'], MODEL_NAME);
if (!warmup) {
  console.error('[build-splade] ERROR: SPLADE model could not be loaded.');
  console.error('  The model may not be available in Xenova format yet.');
  console.error('  Set SPLADE_MODEL env var to specify a different model.');
  console.error('  Alternatively: pip install splade and convert manually.');
  process.exit(1);
}
console.error('[build-splade] Model ready.\n');

// ── Helpers ────────────────────────────────────────────────────────────────

function contentHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function getEmbeddingText(seed) {
  const content  = seed.content ?? '';
  const wrongM   = content.match(/WRONG:\s*([\s\S]*?)(?=CORRECT:|Symptom:|$)/i);
  const symptomM = content.match(/Symptom:\s*([\s\S]*?)(?=WRONG:|CORRECT:|$)/i);
  const wrong    = wrongM   ? wrongM[1].trim()   : '';
  const symptom  = symptomM ? symptomM[1].trim() : '';
  const tags     = (seed.tags ?? []).join(' ');
  return `${symptom} ${wrong} ${tags}`.trim().slice(0, 512); // shorter for SPLADE
}

// ── Load seeds ─────────────────────────────────────────────────────────────

const allSeeds = [];
for (const fname of fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'))) {
  const stack = fname.replace('.json', '');
  try {
    const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
    for (const s of seeds) if (s.id) allSeeds.push({ ...s, _stack: stack });
  } catch {}
}
console.error(`[build-splade] ${allSeeds.length} seeds across ${fs.readdirSync(SEEDS_DIR).filter(f=>f.endsWith('.json')).length} stacks`);

// ── Load existing index for incremental update ─────────────────────────────

let existing = {};
if (!FORCE && fs.existsSync(OUTPUT)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    existing = Object.fromEntries(loaded.map(e => [e.id, e]));
    console.error(`[build-splade] Loaded ${Object.keys(existing).length} existing entries`);
  } catch { existing = {}; }
}

const toEncode = [];
const reused   = [];

for (const seed of allSeeds) {
  if (!seed.id) continue;
  const text = getEmbeddingText(seed);
  if (!text) continue;
  const hash   = contentHash(text);
  const cached = existing[seed.id];
  if (!FORCE && cached?.hash === hash) reused.push(cached);
  else toEncode.push({ seed, text, hash });
}

console.error(`[build-splade] ${reused.length} reused, ${toEncode.length} to encode\n`);

// ── Encode in batches ──────────────────────────────────────────────────────

const fresh = [];

for (let i = 0; i < toEncode.length; i += BATCH_SIZE) {
  const batch = toEncode.slice(i, i + BATCH_SIZE);
  const total = Math.ceil(toEncode.length / BATCH_SIZE);
  process.stderr.write(`[build-splade] Batch ${Math.floor(i/BATCH_SIZE)+1}/${total} (${i+1}–${Math.min(i+BATCH_SIZE,toEncode.length)}/${toEncode.length})\r`);

  const vecs = await encode(batch.map(b => b.text), MODEL_NAME);
  if (!vecs) { console.error('\n[build-splade] Encoding failed mid-batch'); break; }

  for (let j = 0; j < batch.length; j++) {
    const { seed, hash } = batch[j];
    fresh.push({
      id:     seed.id,
      stack:  seed._stack,
      hash,
      sparse: vecs[j],  // {vocab_idx: weight} — only non-zero entries
    });
  }
}

if (toEncode.length) process.stderr.write('\n');

// ── Write output ───────────────────────────────────────────────────────────

const combined = [...reused, ...fresh];
fs.mkdirSync(path.join(ROOT, 'api'), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(combined));

const sizeMB  = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
const avgNNZ  = Math.round(combined.reduce((s, e) => s + Object.keys(e.sparse ?? {}).length, 0) / combined.length);
console.error(`[build-splade] ✓ ${combined.length} entries → api/splade-index.json (${sizeMB} MB)`);
console.error(`[build-splade]   Avg non-zero entries per seed: ${avgNNZ}  (typical: 100–500)`);
