#!/usr/bin/env node
/**
 * scripts/build-embeddings.mjs — Phase 1: Seed Embedding Build
 *
 * Reads all seeds from seeds/*.json and computes 384-dimensional L2-normalised
 * vectors using Xenova/all-MiniLM-L6-v2. Writes the result to
 * api/seed-embeddings.json.
 *
 * Incremental by default: skips seeds whose content hasn't changed (tracked via
 * a SHA-256 hash of the embedding text). Use --force to rebuild everything.
 *
 * Model weights (~22MB ONNX) are downloaded to ~/.cache/huggingface/transformers/
 * on first run and cached for all subsequent runs.
 *
 * Usage:
 *   node scripts/build-embeddings.mjs          # incremental update
 *   node scripts/build-embeddings.mjs --force  # full rebuild
 *
 * Or via npm:
 *   npm run build:embeddings
 *   npm run build:embeddings:force
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs           from 'fs';
import path         from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SEEDS_DIR = path.join(ROOT, 'seeds');
const OUTPUT    = path.join(ROOT, 'api', 'seed-embeddings.json');

const FORCE      = process.argv.includes('--force');
const BATCH_SIZE = 32; // seeds per embedding batch — reduce if OOM

// ── Load transformers ───────────────────────────────────────────────────────

let tf;
try       { tf = await import('@xenova/transformers'); }
catch (_) {
  try     { tf = await import('@huggingface/transformers'); }
  catch   {
    console.error('[build-embeddings] ERROR: transformers package not found.');
    console.error('  Run: npm install @xenova/transformers');
    process.exit(1);
  }
}

const { pipeline } = tf;

// ── Domain model auto-detection ─────────────────────────────────────────────
// If fine-tune-embeddings.py has been run, prefer the domain model.
// Compute a model ID hash so we can detect when the model changes and
// re-embed seeds that were built with an older model version.

const domainOnnx  = path.join(ROOT, 'models', 'lodestone-embeddings-onnx');
const hasDomain   = fs.existsSync(path.join(domainOnnx, 'model.onnx')) ||
                    fs.existsSync(path.join(domainOnnx, 'model_quantized.onnx'));
const MODEL_PATH  = hasDomain ? domainOnnx : 'Xenova/all-MiniLM-L6-v2';
const MODEL_ID    = createHash('sha256').update(MODEL_PATH).digest('hex').slice(0, 12);

if (hasDomain) {
  console.error('[build-embeddings] Using domain-tuned model:', domainOnnx);
} else {
  console.error('[build-embeddings] Loading Xenova/all-MiniLM-L6-v2 (quantized INT8)...');
  console.error('[build-embeddings] First run: downloads ~22MB to ~/.cache/huggingface/transformers/');
}

const extractor = await pipeline('feature-extraction', MODEL_PATH, { quantized: true });
console.error('[build-embeddings] Model ready.\n');

// ── Load existing embeddings for incremental update ─────────────────────────

let existing = {};
if (!FORCE && fs.existsSync(OUTPUT)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    existing = Object.fromEntries(loaded.map(e => [e.id, e]));
    console.error(`[build-embeddings] Loaded ${Object.keys(existing).length} cached embeddings.`);
  } catch {
    existing = {};
  }
}

// ── Embedding text extraction ───────────────────────────────────────────────
// Retrieval surface: symptom (what you observe) + wrong approach (the mistake) + tags.
// Excludes CORRECT deliberately — we match against the problem, not the solution.
// This ensures dense retrieval triggers on symptoms, not on correct behaviour.

function getEmbeddingText(seed) {
  const content  = seed.content ?? '';
  const wrongM   = content.match(/WRONG:\s*([\s\S]*?)(?=CORRECT:|Symptom:|$)/i);
  const symptomM = content.match(/Symptom:\s*([\s\S]*?)(?=WRONG:|CORRECT:|$)/i);
  const wrong    = wrongM   ? wrongM[1].trim()   : '';
  const symptom  = symptomM ? symptomM[1].trim() : '';
  const tags     = (seed.tags ?? []).join(' ');
  // ~512 tokens max — MiniLM truncates at 512 tokens anyway (≈2048 chars)
  return `${symptom} ${wrong} ${tags}`.trim().slice(0, 2048);
}

function contentHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ── Load all seeds ──────────────────────────────────────────────────────────

const allSeeds   = [];
const stackFiles = fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'));

for (const fname of stackFiles) {
  const stack = fname.replace('.json', '');
  try {
    const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
    if (Array.isArray(seeds)) {
      seeds.forEach(s => allSeeds.push({ ...s, _stack: stack }));
    }
  } catch (err) {
    console.error(`[build-embeddings] Warning: could not parse seeds/${fname}: ${err.message}`);
  }
}

console.error(`[build-embeddings] Found ${allSeeds.length} seeds across ${stackFiles.length} stacks.`);

// ── Partition: skip unchanged, embed new/modified ──────────────────────────

const toEmbed = [];
const reused  = [];

for (const seed of allSeeds) {
  if (!seed.id) continue;
  const text = getEmbeddingText(seed);
  if (!text) continue; // nothing to embed
  const hash   = contentHash(text);
  const cached = existing[seed.id];
  // Re-embed if: content changed OR was built with a different model
  if (!FORCE && cached && cached.hash === hash && cached.model_id === MODEL_ID) {
    reused.push(cached);
  } else {
    toEmbed.push({ seed, text, hash });
  }
}

console.error(`[build-embeddings] ${reused.length} unchanged (reused), ${toEmbed.length} to embed.`);
if (toEmbed.length === 0) {
  console.error('[build-embeddings] Nothing to update. Use --force to rebuild all.');
}

// ── Embed in batches ────────────────────────────────────────────────────────

const fresh = [];

for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
  const batch = toEmbed.slice(i, i + BATCH_SIZE);
  const texts = batch.map(b => b.text);
  const total = Math.ceil(toEmbed.length / BATCH_SIZE);
  process.stderr.write(
    `[build-embeddings] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${total}` +
    ` (seeds ${i + 1}–${Math.min(i + BATCH_SIZE, toEmbed.length)} / ${toEmbed.length})  \r`
  );

  const output  = await extractor(texts, { pooling: 'mean', normalize: true });
  const dimSize = output.dims[1]; // 384 for MiniLM-L6-v2

  for (let j = 0; j < batch.length; j++) {
    const { seed, hash } = batch[j];
    fresh.push({
      id:       seed.id,
      stack:    seed._stack,
      hash,
      model_id: MODEL_ID,   // re-embed automatically when model changes
      // Store as plain array (JSON-serialisable). dotProduct in embeddings.mjs reads this.
      vector: Array.from(output.data.slice(j * dimSize, (j + 1) * dimSize)),
    });
  }
}

if (toEmbed.length > 0) process.stderr.write('\n');

// ── Write output ────────────────────────────────────────────────────────────

const combined = [...reused, ...fresh];
fs.mkdirSync(path.join(ROOT, 'api'), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(combined));

const sizeMB = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
console.error(`\n[build-embeddings] ✓ ${combined.length} embeddings → api/seed-embeddings.json (${sizeMB} MB)`);
console.error(`[build-embeddings]   Dim: 384 (all-MiniLM-L6-v2)  |  Seeds: ${combined.length}  |  Stacks: ${stackFiles.length}`);
