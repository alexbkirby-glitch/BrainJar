#!/usr/bin/env node
/**
 * scripts/build-graph-communities.mjs — Gap 6: GraphRAG Community Detection
 *
 * Detects semantic communities in the seed corpus using label propagation on
 * the relationship graph (implies/see_also edges) + tag co-occurrence.
 * Writes api/graph-communities.json.
 *
 * Communities answer corpus-wide questions: "what antipatterns exist around X?"
 * where X is a topic, not a specific error message. Per-seed retrieval can't
 * answer these because relevant seeds may be scattered across the index.
 *
 * Algorithm:
 *   1. Build a similarity graph: two seeds are connected if they share ≥2 tags
 *      OR are linked by implies/see_also in the relationship graph.
 *   2. Run label propagation: randomly assign community labels, then
 *      repeatedly update each seed to the most common label among its neighbours.
 *      Converges in ~20 iterations for typical corpora.
 *   3. For each community: generate a label (most distinctive tag) + summary
 *      (mechanical or LLM) + centroid embedding (mean of member embeddings).
 *   4. Filter tiny communities (<= 3 seeds) into the nearest larger community.
 *
 * Usage:
 *   node scripts/build-graph-communities.mjs
 *   node scripts/build-graph-communities.mjs --llm   # LLM summaries
 *   npm run build:communities
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const SEEDS_DIR  = path.join(ROOT, 'seeds');
const REL_FILE   = path.join(ROOT, 'api', 'relationship-graph.json');
const EMB_FILE   = path.join(ROOT, 'api', 'seed-embeddings.json');
const OUTPUT     = path.join(ROOT, 'api', 'graph-communities.json');

const USE_LLM    = process.argv.includes('--llm');
const MIN_SIZE   = 4;   // minimum community size
const MAX_ITER   = 25;  // label propagation iterations

// ── Helpers ────────────────────────────────────────────────────────────────

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function meanVec(vecs) {
  if (!vecs.length) return null;
  const dim = vecs[0].length;
  const m = new Array(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) m[i] += v[i] / vecs.length;
  const n = Math.sqrt(m.reduce((s, x) => s + x * x, 0));
  return n > 0 ? m.map(x => x / n) : m;
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
console.error(`[build-communities] ${allSeeds.length} seeds loaded`);

// ── Build similarity graph ────────────────────────────────────────────────

// Edge: seeds that share ≥2 tags OR are connected in relationship graph
const tagIndex = {}; // tag → [seedId]
for (const s of allSeeds) {
  for (const t of (s.tags ?? [])) {
    if (!Array.isArray(tagIndex[t])) tagIndex[t] = [];
    tagIndex[t].push(s.id);
  }
}

// Relationship graph edges
const relAdj = {};
try {
  const rg = JSON.parse(fs.readFileSync(REL_FILE, 'utf8'));
  const adj = rg.adjacency ?? {};
  for (const [from, rels] of Object.entries(adj)) {
    for (const type of ['implies', 'see_also']) {
      for (const edge of rels[type] ?? []) {
        const to = typeof edge === 'string' ? edge : edge.id;
        if (!relAdj[from]) relAdj[from] = new Set();
        if (!relAdj[to])   relAdj[to]   = new Set();
        relAdj[from].add(to);
        relAdj[to].add(from);
      }
    }
  }
  console.error(`[build-communities] Relationship graph: ${Object.keys(adj).length} nodes`);
} catch { console.error('[build-communities] No relationship graph — using tag-only graph'); }

// Build adjacency list
const adj = {}; // seedId → Set<seedId>
for (const s of allSeeds) adj[s.id] = new Set();

// Add tag-based edges (shared ≥2 tags)
const tagPairs = {};
for (const ids of Object.values(tagIndex)) {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = [ids[i], ids[j]].sort().join('|');
      tagPairs[key] = (tagPairs[key] ?? 0) + 1;
    }
  }
}
for (const [key, count] of Object.entries(tagPairs)) {
  if (count >= 2) {
    const [a, b] = key.split('|');
    adj[a]?.add(b);
    adj[b]?.add(a);
  }
}

// Add relationship graph edges
for (const [from, neighbours] of Object.entries(relAdj)) {
  for (const to of neighbours) {
    adj[from]?.add(to);
    adj[to]?.add(from);
  }
}

const totalEdges = Object.values(adj).reduce((s, n) => s + n.size, 0) / 2;
console.error(`[build-communities] Graph: ${allSeeds.length} nodes, ${Math.round(totalEdges)} edges`);

// ── Label propagation ─────────────────────────────────────────────────────

const labels = {}; // seedId → communityId
for (const s of allSeeds) labels[s.id] = s.id; // start: each seed is own community

const ids = allSeeds.map(s => s.id);
for (let iter = 0; iter < MAX_ITER; iter++) {
  let changed = 0;
  // Shuffle to reduce order dependence
  const shuffled = [...ids].sort(() => Math.random() - 0.5);
  for (const id of shuffled) {
    const neighbours = [...(adj[id] ?? [])];
    if (!neighbours.length) continue;
    // Count neighbour labels
    const freq = {};
    for (const n of neighbours) {
      const l = labels[n];
      freq[l] = (freq[l] ?? 0) + 1;
    }
    const dominant = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (dominant && dominant !== labels[id]) {
      labels[id] = dominant;
      changed++;
    }
  }
  if (changed === 0) { console.error(`[build-communities] Converged at iteration ${iter + 1}`); break; }
}

// Group seeds by community label
const communities = {};
for (const s of allSeeds) {
  const l = labels[s.id];
  if (!communities[l]) communities[l] = [];
  communities[l].push(s);
}

// Merge tiny communities into the nearest larger one (by shared tags)
const large = Object.entries(communities).filter(([, m]) => m.length >= MIN_SIZE);
const tiny  = Object.entries(communities).filter(([, m]) => m.length <  MIN_SIZE);
for (const [, members] of tiny) {
  for (const s of members) {
    // Find largest community sharing the most tags with this seed
    let bestComm = null, bestOverlap = -1;
    for (const [lbl, comm] of large) {
      const commTags = new Set(comm.flatMap(c => c.tags ?? []));
      const overlap  = (s.tags ?? []).filter(t => commTags.has(t)).length;
      if (overlap > bestOverlap) { bestOverlap = overlap; bestComm = lbl; }
    }
    if (bestComm) large.find(([l]) => l === bestComm)?.[1].push(s);
  }
}

console.error(`[build-communities] ${large.length} communities (≥${MIN_SIZE} seeds) after merging`);

// ── Load embeddings ───────────────────────────────────────────────────────

let embById = {};
if (fs.existsSync(EMB_FILE)) {
  const embs = JSON.parse(fs.readFileSync(EMB_FILE, 'utf8'));
  embById = Object.fromEntries(embs.map(e => [e.id, e.vector]));
}

// ── Build community summaries ─────────────────────────────────────────────

async function llmSummary(seeds, label) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const lines = seeds.slice(0, 8).map(s => `- ${s.title ?? s.id}`).join('\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5', max_tokens: 130,
        messages: [{ role: 'user', content: `Describe this cluster of developer antipatterns in 2 sentences for a developer asking "what antipatterns exist around ${label}":\n${lines}` }]
      })
    });
    return (await res.json()).content?.[0]?.text?.trim() ?? null;
  } catch { return null; }
}

const index = [];
let ci = 0;

for (const [, members] of large.sort((a, b) => b[1].length - a[1].length)) {
  // Label: most distinctive shared tag
  const tagFreq = {};
  for (const s of members) for (const t of s.tags ?? []) tagFreq[t] = (tagFreq[t] ?? 0) + 1;
  const sortedTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]);
  const label = sortedTags[0]?.[0] ?? members[0]?._stack ?? `community-${ci}`;
  const topTags = sortedTags.slice(0, 5).map(([t]) => t).join(', ');

  // Summary
  const mechanicalSummary = `Antipatterns around ${topTags}: ` +
    members.slice(0, 4).map(s => s.title ?? s.id).join('; ') +
    (members.length > 4 ? ` (+ ${members.length - 4} more)` : '') + '.';
  const summary = USE_LLM ? (await llmSummary(members, label) ?? mechanicalSummary) : mechanicalSummary;

  // Centroid embedding (mean of member embeddings)
  const centroid = meanVec(members.map(s => embById[s.id]).filter(Boolean));

  const repSeeds = members
    .slice(0, 5)
    .map(s => ({ id: s.id, title: s.title, stack: s._stack }));

  index.push({
    community_id:         `comm-${ci.toString().padStart(3, '0')}`,
    label,
    top_tags:             topTags,
    summary,
    seed_count:           members.length,
    seed_ids:             members.map(s => s.id),
    representative_seeds: repSeeds,
    embedding:            centroid,
  });

  process.stderr.write(`  [${ci + 1}/${large.length}] ${label} (${members.length} seeds)\r`);
  ci++;
}
process.stderr.write('\n');

fs.mkdirSync(path.join(ROOT, 'api'), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(index));

const sizeKB = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
console.error(`[build-communities] ✓ ${index.length} communities → api/graph-communities.json (${sizeKB} kB)`);
console.error(`  ${index.filter(c => c.embedding).length} with centroid embeddings`);
