#!/usr/bin/env node
/**
 * scripts/build-raptor-index.mjs — Gap 4: RAPTOR Hierarchical Index Builder
 *
 * Clusters the seed corpus into semantic groups and generates a summary for
 * each cluster. Writes api/raptor-index.json.
 *
 * Two clustering strategies (auto-selected):
 *   Embedding-based (preferred): k-means-like clustering on seed embeddings.
 *     Requires api/seed-embeddings.json (run npm run build:embeddings first).
 *   Tag-based (fallback): seeds sharing the most distinctive tags form clusters.
 *     Works without any model.
 *
 * Cluster summaries:
 *   Mechanical (default): "Antipatterns in {top tags}: {seed titles}..."
 *   LLM (opt-in via --llm): claude-haiku writes a natural language summary.
 *
 * Usage:
 *   node scripts/build-raptor-index.mjs          # tag-based
 *   node scripts/build-raptor-index.mjs --embed  # embedding-based (needs embeddings)
 *   node scripts/build-raptor-index.mjs --llm    # + LLM summaries
 *   npm run build:raptor
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SEEDS_DIR = path.join(ROOT, 'seeds');
const EMB_FILE  = path.join(ROOT, 'api', 'seed-embeddings.json');
const OUTPUT    = path.join(ROOT, 'api', 'raptor-index.json');

const USE_EMBED = process.argv.includes('--embed');
const USE_LLM   = process.argv.includes('--llm');
const TARGET_K  = 20; // target cluster count (√(N/5) heuristic)

// ── Helpers ───────────────────────────────────────────────────────────────

const STOP = new Set(['the','and','for','not','with','this','that','from','are','was',
  'but','all','can','its','has','have','when','been','does','did','will','would',
  'should','use','used','set','let','any','may','also','even','over']);

function tokenize(str) {
  return (str ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOP.has(t));
}

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function meanVec(vecs) {
  if (!vecs.length) return null;
  const dim = vecs[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) mean[i] += v[i] / vecs.length;
  const norm = Math.sqrt(mean.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? mean.map(x => x / norm) : mean;
}

// ── Load seeds ────────────────────────────────────────────────────────────

const allSeeds = [];
for (const fname of fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'))) {
  const stack = fname.replace('.json', '');
  try {
    const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
    for (const s of seeds) if (s.id) allSeeds.push({ ...s, _stack: stack });
  } catch {}
}
console.error(`[build-raptor] Loaded ${allSeeds.length} seeds from ${fs.readdirSync(SEEDS_DIR).filter(f=>f.endsWith('.json')).length} stacks`);

// ── Embedding-based clustering (k-means, 10 iterations) ───────────────────

async function embeddingClusters(k) {
  if (!fs.existsSync(EMB_FILE)) {
    console.error('[build-raptor] No seed embeddings found — falling back to tag clustering');
    return null;
  }
  const embeddings = JSON.parse(fs.readFileSync(EMB_FILE, 'utf8'));
  const byId = Object.fromEntries(embeddings.map(e => [e.id, e.vector]));
  const seeds = allSeeds.filter(s => byId[s.id]);
  if (seeds.length < k * 2) return null;

  // Random centroid initialisation (k-means++)
  const centroids = [];
  centroids.push(byId[seeds[Math.floor(Math.random() * seeds.length)].id]);
  while (centroids.length < k) {
    const dists = seeds.map(s => {
      const v = byId[s.id];
      const maxSim = Math.max(...centroids.map(c => dotProduct(v, c)));
      return 1 - maxSim; // distance = 1 - similarity
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * total, i = 0;
    while (r > 0 && i < dists.length) { r -= dists[i++]; }
    centroids.push(byId[seeds[i - 1].id]);
  }

  let assignments = new Array(seeds.length).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    assignments = seeds.map(s => {
      const v = byId[s.id];
      let best = 0, bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = dotProduct(v, centroids[c]);
        if (sim > bestSim) { bestSim = sim; best = c; }
      }
      return best;
    });
    for (let c = 0; c < k; c++) {
      const members = seeds.filter((_, i) => assignments[i] === c);
      if (members.length) {
        const newCentroid = meanVec(members.map(s => byId[s.id]));
        if (newCentroid) centroids[c] = newCentroid;
      }
    }
  }

  return centroids.map((centroid, c) => ({
    centroid,
    seeds: seeds.filter((_, i) => assignments[i] === c),
  }));
}

// ── Tag-based clustering (fallback) ──────────────────────────────────────

function tagClusters(k) {
  // Count tag frequencies
  const tagFreq = {};
  for (const s of allSeeds) {
    for (const t of s.tags ?? []) tagFreq[t] = (tagFreq[t] ?? 0) + 1;
  }

  // IDF: tags appearing in 30-70% of seeds are most discriminating
  const N = allSeeds.length;
  const distinctiveTags = Object.entries(tagFreq)
    .filter(([, f]) => f >= 3 && f <= N * 0.4)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  // Assign each seed to its most distinctive tag (primary cluster key)
  const clusters = {};
  for (const s of allSeeds) {
    const primaryTag = (s.tags ?? []).find(t => distinctiveTags.includes(t)) ??
                       s._stack ?? 'general';
    if (!clusters[primaryTag]) clusters[primaryTag] = [];
    clusters[primaryTag].push(s);
  }

  // Merge very small clusters (< 3 seeds) into a catch-all
  const merged = {};
  for (const [tag, seeds] of Object.entries(clusters)) {
    const key = seeds.length < 3 ? (s => s._stack)(seeds[0]) : tag;
    if (!merged[key]) merged[key] = [];
    merged[key].push(...seeds);
  }

  return Object.entries(merged).map(([tag, seeds]) => ({ tag, seeds, centroid: null }));
}

// ── Mechanical summary ────────────────────────────────────────────────────

function mechanicalSummary(seeds, label) {
  const topTags = [...new Set(seeds.flatMap(s => s.tags ?? []))].slice(0, 6).join(', ');
  const titles  = seeds.slice(0, 5).map(s => s.title ?? s.id).join('; ');
  return `${label}: Antipatterns covering ${topTags}. Examples: ${titles}${seeds.length > 5 ? ` (+ ${seeds.length - 5} more)` : ''}.`;
}

// ── LLM summary ───────────────────────────────────────────────────────────

async function llmSummary(seeds, label) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return mechanicalSummary(seeds, label);
  try {
    const seedLines = seeds.slice(0, 8).map(s => `- ${s.title ?? s.id}`).join('\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5', max_tokens: 120,
        messages: [{ role: 'user', content: `Summarize this group of developer antipatterns in 1-2 sentences:\n${seedLines}` }]
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text?.trim() ?? mechanicalSummary(seeds, label);
  } catch { return mechanicalSummary(seeds, label); }
}

// ── Build clusters ────────────────────────────────────────────────────────

console.error(`[build-raptor] Strategy: ${USE_EMBED ? 'embedding' : 'tag'}-based clustering`);

let rawClusters = USE_EMBED ? await embeddingClusters(TARGET_K) : null;
if (!rawClusters) rawClusters = tagClusters(TARGET_K);

console.error(`[build-raptor] ${rawClusters.length} clusters found`);

// ── Load embeddings for cluster centroids (when using tag clusters) ───────

let embById = {};
if (fs.existsSync(EMB_FILE)) {
  const embs = JSON.parse(fs.readFileSync(EMB_FILE, 'utf8'));
  embById = Object.fromEntries(embs.map(e => [e.id, e.vector]));
}

// ── Build final index ─────────────────────────────────────────────────────

const index = [];
let ci = 0;
for (const cluster of rawClusters) {
  const seeds = cluster.seeds;
  if (!seeds?.length) continue;

  const label = cluster.tag
    ? seeds[0]?.tags?.[0] ?? cluster.tag
    : seeds.sort((a, b) => (b.blast_radius === 'high' ? 1 : 0) - (a.blast_radius === 'high' ? 1 : 0))[0]?.title ?? `cluster-${ci}`;

  const summary = USE_LLM
    ? await llmSummary(seeds, label)
    : mechanicalSummary(seeds, label);

  // Centroid: use pre-computed (embedding mode) or compute from available embeddings
  const centroid = cluster.centroid ??
    meanVec(seeds.map(s => embById[s.id]).filter(Boolean)) ??
    null;

  const representativeSeeds = seeds
    .sort((a, b) => (b.blast_radius === 'high' ? 1 : 0) - (a.blast_radius === 'high' ? 1 : 0))
    .slice(0, 5)
    .map(s => ({ id: s.id, title: s.title, stack: s._stack ?? s.stack }));

  index.push({
    community_id:         `raptor-${ci.toString().padStart(3, '0')}`,
    label:                String(label).slice(0, 60),
    summary,
    seed_count:           seeds.length,
    seed_ids:             seeds.map(s => s.id),
    representative_seeds: representativeSeeds,
    embedding:            centroid,
  });

  process.stderr.write(`  [${ci + 1}/${rawClusters.length}] ${label}: ${seeds.length} seeds\r`);
  ci++;
}

process.stderr.write('\n');
fs.mkdirSync(path.join(ROOT, 'api'), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(index));

const sizeKB = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
console.error(`[build-raptor] ✓ ${index.length} clusters → api/raptor-index.json (${sizeKB} kB)`);
console.error(`  ${index.filter(c => c.embedding).length} clusters have centroid embeddings (used for query-time boosting)`);
