#!/usr/bin/env node
/**
 * scripts/detect-homology.mjs — Loop 6: Euler Characteristic / Persistent Homology
 *
 * Filters the seed relationship graph by edge confidence from 1.0 → 0.0,
 * tracking topological features as they appear and disappear (birth/death pairs).
 *
 * Mathematical grounding:
 *   Euler characteristic χ = V − E + F  (Euler, 1750s)
 *   Betti numbers b₀ = connected components, b₁ = independent cycles, b₂ = voids
 *   χ = Σ (−1)ⁿ bₙ (alternating Betti sum)
 *
 *   Persistent homology: filter graph by edge confidence threshold θ from 1.0 → 0.0.
 *   At each step, edges are added; components merge (b₀ decreases) and cycles form (b₁ increases).
 *   A b₁ cycle that persists across a wide confidence range is a structural feature of the corpus.
 *   A b₁ cycle with no parent seed is a "broken generator" (Goldstone boson) — the missing
 *   parent seed that would restore structural symmetry.
 *
 * Per seeds/physics.json spontaneous_symmetry_breaking_goldstone:
 *   "Each broken generator produces a massless Goldstone boson."
 *   Here: each b₁ cycle (loop without a center) = one broken generator = one missing parent seed.
 *   mint_cascade_parent is the operation that "eats" the Goldstone boson (Higgs mechanism).
 *
 * Usage:
 *   node scripts/detect-homology.mjs              # report without writing
 *   node scripts/detect-homology.mjs --write      # write .lodestone/persistent-homology.json
 *   node scripts/detect-homology.mjs --steps 20   # number of filtration steps (default 20)
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, '..');
const GRAPH_PATH    = path.join(ROOT, 'api', 'relationship-graph.json');
const OUTPUT_PATH   = path.join(ROOT, '.lodestone', 'persistent-homology.json');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');

const WRITE = process.argv.includes('--write');
const STEPS = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--steps') ?? '20', 10);

// ── Union-Find (Disjoint Set Union) ──────────────────────────────────────────

class DSU {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank   = new Array(n).fill(0);
    this.count  = n;
  }
  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(x, y) {
    const px = this.find(x), py = this.find(y);
    if (px === py) return false; // already same component — adding this edge creates a cycle
    if (this.rank[px] < this.rank[py]) { this.parent[px] = py; }
    else if (this.rank[px] > this.rank[py]) { this.parent[py] = px; }
    else { this.parent[py] = px; this.rank[px]++; }
    this.count--;
    return true;
  }
}

// ── Load graph ────────────────────────────────────────────────────────────────

if (!fs.existsSync(GRAPH_PATH)) {
  console.error(`No relationship graph at ${GRAPH_PATH}`);
  console.error('Run: node scripts/detect-relationships.mjs first');
  process.exit(1);
}

const graph   = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
const nodes   = graph.nodes ?? [];
const edges   = graph.edges ?? [];

if (nodes.length < 3) {
  console.log('Too few nodes for homology analysis (need ≥3). Add relationship edges first.');
  process.exit(0);
}

const nodeIdx = new Map(nodes.map((n, i) => [n.id ?? n, i]));
const N       = nodes.length;

// Resolve edges to (i, j, confidence)
const resolvedEdges = edges
  .map(e => {
    const i = nodeIdx.get(e.source ?? e.from);
    const j = nodeIdx.get(e.target ?? e.to);
    const w = e.confidence ?? e.weight ?? 1.0;
    return (i != null && j != null && i !== j) ? { i, j, w } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.w - a.w); // descending confidence

// ── Persistent homology filtration ───────────────────────────────────────────
// Process edges from highest confidence to lowest.
// Each edge either:
//   (a) merges two components → b₀ decreases → "death" of a component
//   (b) creates a cycle within one component → b₁ increases → "birth" of a cycle
//
// Birth/death pairs: (θ_birth, θ_death) for each topological feature.
// Features with large (θ_birth − θ_death) "persistence" are structurally significant.

const thresholds = Array.from({ length: STEPS }, (_, k) => 1.0 - k / (STEPS - 1));

const b0_trace  = []; // [{ threshold, value }] — connected component count
const b1_trace  = []; // [{ threshold, value }] — cycle count
const births_b1 = []; // [{ threshold, cycle_edge: {i,j,w}, nodes: [id_a, id_b] }]

let b1 = 0;
let dsu = new DSU(N);
let edgePtr = 0;

for (const theta of thresholds) {
  // Add all edges with confidence >= theta
  while (edgePtr < resolvedEdges.length && resolvedEdges[edgePtr].w >= theta) {
    const { i, j, w } = resolvedEdges[edgePtr++];
    const merged = dsu.union(i, j);
    if (!merged) {
      // Cycle detected: this edge connects two already-connected nodes
      b1++;
      births_b1.push({
        birth_threshold: w,
        death_threshold: null, // persistent until lower threshold resolves
        node_a: nodes[i]?.id ?? String(i),
        node_b: nodes[j]?.id ?? String(j),
        edge_type: edges[edgePtr - 1]?.type ?? 'unknown',
        edge_confidence: w,
      });
    }
  }
  b0_trace.push({ threshold: Math.round(theta * 100) / 100, b0: dsu.count });
  b1_trace.push({ threshold: Math.round(theta * 100) / 100, b1 });
}

// ── Identify Goldstone gaps (b₁ cycles without parent seeds) ─────────────────
// Load the cascade-parents-draft.json if available (these are already-identified clusters)
const parentDraftPath = path.join(LODESTONE_DIR, 'cascade-parents-draft.json');
const existingParents = new Set();
try {
  const draft = JSON.parse(fs.readFileSync(parentDraftPath, 'utf8'));
  for (const c of (draft.candidates ?? [])) {
    if (c.suggested_id) existingParents.add(c.suggested_id);
  }
} catch {}

// Find cycles that persist across more than 2 threshold steps (structurally significant)
const persistentCycles = births_b1.filter(c => {
  // Persistence = birth_threshold (a cycle that forms early is more significant)
  return c.birth_threshold >= 0.3;
});

// ── Report ────────────────────────────────────────────────────────────────────

const finalB0 = dsu.count;
const finalB1 = b1;
const chi     = N - resolvedEdges.length + finalB1 + (finalB0 - 1);

console.log('detect-homology.mjs — Persistent Homology Filtration\n');
console.log(`Graph: ${N} nodes  ${resolvedEdges.length} edges`);
console.log(`Euler characteristic χ = ${N} − ${resolvedEdges.length} + ${finalB1} + (${finalB0}−1) = ${chi}`);
console.log(`\nFinal Betti numbers (at threshold 0.0):`);
console.log(`  b₀ = ${finalB0}  (connected components)`);
console.log(`  b₁ = ${finalB1}  (independent cycles — each is a potential Goldstone gap)`);

if (persistentCycles.length) {
  console.log(`\n── Persistent b₁ cycles (birth confidence ≥ 0.3) ─────────────────────`);
  console.log(`  These cycles formed at high confidence and persist — strong structural signal.`);
  console.log(`  Per Goldstone's theorem: each cycle without a parent seed is a broken generator.`);
  console.log(`  Use mint_cascade_parent to create the parent seed (Higgs mechanism — eats the Goldstone boson).\n`);
  for (const c of persistentCycles.slice(0, 12)) {
    const knownParent = existingParents.has(`parent_${c.node_a}_${c.node_b}`);
    console.log(`  Cycle: ${c.node_a} ↔ ${c.node_b}  [${c.edge_type}  conf=${c.birth_threshold.toFixed(2)}]${knownParent ? '  (parent already drafted)' : '  ← GOLDSTONE GAP'}`);
  }
} else {
  console.log(`\nNo persistent b₁ cycles found. Corpus topology is tree-like (no structural gaps).`);
}

// Connectivity profile
console.log('\n── b₀ trace (connected components at each filtration threshold) ──');
const b0Steps = b0_trace.filter((_, i) => i % Math.floor(STEPS / 5) === 0);
for (const s of b0Steps) console.log(`  θ=${s.threshold.toFixed(2)}  components=${s.b0}`);

if (WRITE) {
  const output = {
    generated_at:      new Date().toISOString(),
    nodes:             N,
    edges:             resolvedEdges.length,
    euler_chi:         chi,
    final_b0:          finalB0,
    final_b1:          finalB1,
    b0_trace,
    b1_trace,
    persistent_cycles: persistentCycles,
    goldstone_gaps:    persistentCycles.filter(c => !existingParents.has(`parent_${c.node_a}_${c.node_b}`)),
    instructions: 'Use mint_cascade_parent to create parent seeds for each Goldstone gap.',
  };
  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n✓ Written to ${OUTPUT_PATH}`);
} else {
  console.log('\nRun with --write to save persistent-homology.json');
}
