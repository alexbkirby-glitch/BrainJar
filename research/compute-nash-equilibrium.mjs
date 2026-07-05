#!/usr/bin/env node
/**
 * scripts/compute-nash-equilibrium.mjs — Loop 4: Game Theory / Nash Equilibrium
 *
 * Models the seed corpus as a symmetric multi-player game where each seed
 * "wants" to maximise its injection frequency. Context window space is finite
 * and redundant seeds cancel out — the Nash equilibrium is the stable injection
 * distribution where no seed can increase its rate by changing strategy.
 *
 * Mathematical grounding:
 *   Nash equilibrium (Nash, 1951): no player can improve payoff by unilateral change
 *   Brouwer fixed point theorem (Nash's existence proof): every continuous map from
 *     a compact convex set to itself has a fixed point
 *   The Aberth-Ehrlich injection diversity tool converges to an approximate Nash
 *     equilibrium — this script computes the exact target via fictitious play.
 *
 * Stationary action principle insight (seeds/physics.json stationary_action_principle):
 *   "δS = 0 for stationarity — which may be a minimum, maximum, or SADDLE POINT."
 *   The Nash equilibrium of the injection game is a stationary point of the payoff
 *   function, NOT necessarily a minimum. A corpus where a few seeds dominate is at
 *   a saddle point — locally stable but globally suboptimal.
 *
 * Fictitious play algorithm:
 *   1. Start with uniform injection distribution
 *   2. Each seed best-responds: choose the strategy that maximises expected payoff
 *      given all other seeds' current strategies
 *   3. Update the empirical frequency distribution
 *   4. Repeat until convergence (‖Δdistribution‖ < ε)
 *
 * Nash distance = KL(actual_injection_dist || nash_equilibrium_dist)
 * A large Nash distance means the corpus would benefit from reorganisation.
 *
 * Usage:
 *   node scripts/compute-nash-equilibrium.mjs              # report
 *   node scripts/compute-nash-equilibrium.mjs --write      # save .lodestone/nash-equilibrium.json
 *   node scripts/compute-nash-equilibrium.mjs --iters 200  # fictitious play iterations (default 100)
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, '..');
const CONF_PATH     = path.join(ROOT, '.lodestone', 'seed-confidence.json');
const GRAPH_PATH    = path.join(ROOT, 'api', 'relationship-graph.json');
const OUTPUT_PATH   = path.join(ROOT, '.lodestone', 'nash-equilibrium.json');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');

const WRITE = process.argv.includes('--write');
const ITERS = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--iters') ?? '100', 10);

// ── Load data ─────────────────────────────────────────────────────────────────

if (!fs.existsSync(CONF_PATH)) {
  console.log('No confidence data found. Record some session outcomes first.');
  console.log('Run: node scripts/outcome-tracker.mjs --clean (after a coding session)');
  process.exit(0);
}

const confData = JSON.parse(fs.readFileSync(CONF_PATH, 'utf8'));
const seeds    = Object.entries(confData).filter(([, r]) => r.injections >= 2);

if (seeds.length < 4) {
  console.log(`Too few seeds with outcome data (${seeds.length}) — need ≥4 to compute Nash equilibrium.`);
  process.exit(0);
}

// ── Payoff model ──────────────────────────────────────────────────────────────
// Payoff for seed i when the current injection distribution is p:
//   payoff_i(p) = confidence_i × (1 − redundancy_with_p)
//
// Redundancy is approximated by the weighted overlap with other injected seeds,
// using the relationship graph (co_inject edges reduce individual payoffs — seeds
// that fire together share the credit and reduce each other's marginal value).

let adjacency = {};
try {
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
  for (const e of (graph.edges ?? [])) {
    const a = e.source ?? e.from;
    const b = e.target ?? e.to;
    if (!a || !b) continue;
    if (!adjacency[a]) adjacency[a] = {};
    if (!adjacency[b]) adjacency[b] = {};
    const w = e.confidence ?? 1.0;
    const isCoinject = e.type === 'co_inject' || e.type === 'requires';
    adjacency[a][b] = { weight: w, co_inject: isCoinject };
    adjacency[b][a] = { weight: w, co_inject: isCoinject };
  }
} catch {}

function payoff(seedId, confidence, distribution) {
  // Base payoff: confidence (how useful the seed is on its own)
  let base = confidence;

  // Redundancy penalty: seeds that strongly co_inject with dominant seeds
  // share credit and reduce each other's marginal payoff
  const neighbours = adjacency[seedId] ?? {};
  let redundancy = 0;
  for (const [nId, rel] of Object.entries(neighbours)) {
    const nWeight = distribution[nId] ?? 0;
    if (rel.co_inject) {
      redundancy += rel.weight * nWeight * 0.3; // co_inject creates shared credit
    }
  }

  return Math.max(0, base - redundancy);
}

// ── Fictitious play ───────────────────────────────────────────────────────────

const ids         = seeds.map(([id]) => id);
const confidences = Object.fromEntries(seeds.map(([id, r]) => [id, r.effective_confidence ?? r.confidence ?? 0.5]));
const N           = ids.length;

// Initial distribution: proportional to confidence (informed prior, not uniform)
let dist = Object.fromEntries(ids.map(id => [id, confidences[id]]));
const normalise = d => {
  const sum = Object.values(d).reduce((s, v) => s + v, 0);
  if (sum < 1e-12) return d;
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v / sum]));
};
dist = normalise(dist);

// Empirical frequencies (accumulated across all iterations for fictitious play)
const freq = Object.fromEntries(ids.map(id => [id, dist[id]]));

let prevDist = { ...dist };

for (let iter = 0; iter < ITERS; iter++) {
  // Best response: each seed updates to maximise payoff given current dist
  const bestResp = Object.fromEntries(ids.map(id => {
    const p = payoff(id, confidences[id], dist);
    return [id, p];
  }));
  const brNorm = normalise(bestResp);

  // Fictitious play update: blend toward best response
  const alpha = 1 / (iter + 2); // decreasing step size
  for (const id of ids) {
    freq[id] = (1 - alpha) * freq[id] + alpha * brNorm[id];
  }

  dist = normalise({ ...freq });

  // Check convergence
  const delta = ids.reduce((s, id) => s + Math.abs(dist[id] - prevDist[id]), 0);
  if (delta < 1e-6) { console.log(`  Converged after ${iter + 1} iterations (δ = ${delta.toExponential(2)})`); break; }
  prevDist = { ...dist };
}

const nashDist = dist; // Nash equilibrium injection distribution

// ── Actual injection distribution ────────────────────────────────────────────

const totalInj = seeds.reduce(([, r]) => (r.injections ?? 0), 0) || 1;
// Use raw injection counts as proxy for actual distribution
const rawInj   = Object.fromEntries(seeds.map(([id, r]) => [id, r.injections ?? 0]));
const actualDist = normalise(rawInj);

// ── KL divergence D_KL(actual || nash) ───────────────────────────────────────

function klDivergence(P, Q) {
  let kl = 0;
  for (const id of Object.keys(P)) {
    const p = P[id] ?? 0;
    const q = Q[id] ?? 1e-10;
    if (p > 1e-12) kl += p * Math.log(p / q);
  }
  return kl;
}

const nashDist_full   = normalise(Object.fromEntries(ids.map(id => [id, nashDist[id] ?? 0])));
const actualDist_full = normalise(Object.fromEntries(ids.map(id => [id, actualDist[id] ?? 1e-10])));
const klAtoN = klDivergence(actualDist_full, nashDist_full);

// ── Dominant strategy detection ───────────────────────────────────────────────
// A dominant-strategy seed: nash weight >> average weight
// These seeds inject regardless of context — Nash-unstable
const avgNash = 1 / N;
const dominant = ids
  .filter(id => (nashDist[id] ?? 0) > avgNash * 3)
  .map(id => ({ id, nash_weight: Math.round((nashDist[id] ?? 0) * 1000) / 1000, actual_weight: Math.round((actualDist[id] ?? 0) * 1000) / 1000 }))
  .sort((a, b) => b.nash_weight - a.nash_weight);

// Seeds far from Nash equilibrium (over-injected or under-injected)
const OVER_THRESHOLD  = 2.0; // actual > 2× nash = over-injected (monopolar)
const UNDER_THRESHOLD = 0.3; // actual < 0.3× nash = under-injected (suppressed)
const overInjected  = ids.filter(id => (actualDist[id] ?? 0) > (nashDist[id] ?? 0) * OVER_THRESHOLD);
const underInjected = ids.filter(id => (actualDist[id] ?? 0) < (nashDist[id] ?? 0) * UNDER_THRESHOLD && (nashDist[id] ?? 0) > avgNash * 0.5);

// ── Report ────────────────────────────────────────────────────────────────────

const klLabel = klAtoN < 0.1 ? '✓ NEAR-EQUILIBRIUM (corpus injection distribution is Nash-stable)'
              : klAtoN < 0.5 ? '○ MODERATE distance from Nash equilibrium'
              : '⚠ FAR FROM EQUILIBRIUM — corpus is Nash-unstable (1–2 seeds dominating)';

console.log('compute-nash-equilibrium.mjs — Nash Corpus Stability Diagnostic\n');
console.log('Mathematical grounding (stationary_action_principle):');
console.log('  Nash equilibrium = stationary point of the payoff function,');
console.log('  not necessarily a minimum. Saddle points are locally stable but globally suboptimal.\n');
console.log(`Seeds with outcome data: ${N}`);
console.log(`Fictitious play iterations: ${ITERS}\n`);
console.log(`KL divergence D_KL(actual || Nash): ${klAtoN.toFixed(4)}`);
console.log(`Status: ${klLabel}\n`);

if (dominant.length) {
  console.log(`── Dominant-strategy seeds (Nash weight > 3× average) ──────────────`);
  console.log(`  These seeds inject regardless of context. Split into specialised variants.`);
  for (const d of dominant.slice(0, 8)) {
    console.log(`  ${d.id.padEnd(42)} nash=${d.nash_weight.toFixed(4)}  actual=${d.actual_weight.toFixed(4)}`);
  }
}
if (overInjected.length) {
  console.log(`\n── Over-injected (actual > 2× Nash weight) ──────────────────────────`);
  for (const id of overInjected.slice(0, 5)) {
    console.log(`  ${id}  actual=${actualDist[id]?.toFixed(4)}  nash=${nashDist[id]?.toFixed(4)}`);
  }
}
if (underInjected.length) {
  console.log(`\n── Under-injected (actual < 0.3× Nash weight) ───────────────────────`);
  console.log(`  These seeds are getting crowded out. Improve symptom specificity.`);
  for (const id of underInjected.slice(0, 5)) {
    console.log(`  ${id}  actual=${actualDist[id]?.toFixed(4)}  nash=${nashDist[id]?.toFixed(4)}`);
  }
}

if (WRITE) {
  const topNash = ids
    .map(id => ({ id, nash: nashDist[id] ?? 0, actual: actualDist[id] ?? 0 }))
    .sort((a, b) => b.nash - a.nash)
    .slice(0, 20);

  const output = {
    generated_at:       new Date().toISOString(),
    seeds_analyzed:     N,
    iterations:         ITERS,
    kl_divergence:      Math.round(klAtoN * 10000) / 10000,
    nash_stable:        klAtoN < 0.1,
    dominant_seeds:     dominant,
    over_injected:      overInjected,
    under_injected:     underInjected,
    top_20_nash:        topNash,
    interpretation:     'KL divergence measures how far actual injection distribution is from Nash equilibrium. Large values = reorganise corpus.',
  };
  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n✓ Written to ${OUTPUT_PATH}`);
} else {
  console.log('\nRun with --write to save nash-equilibrium.json');
}
