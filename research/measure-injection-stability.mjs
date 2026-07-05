#!/usr/bin/env node
/**
 * scripts/measure-injection-stability.mjs — Loop 7: Lorenz Chaos / Lyapunov Exponents
 *
 * Measures the injection Lyapunov exponent: how rapidly does a small change to
 * an input query cause the injection set to diverge?
 *
 * Mathematical grounding:
 *   Lorenz attractor → positive Lyapunov exponent λ → sensitive dependence on initial conditions
 *   Pesin's theorem: KS entropy = Σ positive Lyapunov exponents = information production rate
 *
 * CRITICAL physics insight from seeds/physics.json (liouville_theorem_phase_volume_preservation):
 *   "Dissipative chaos (Lorenz attractor) requires coupling to a heat bath;
 *    the full system+bath still obeys Liouville, but the reduced system does not."
 *
 *   The injection system IS dissipative (drain exists). So:
 *   - Σλᵢ < 0 is the healthy check (dissipation removes volume in phase space)
 *   - If Σλᵢ → 0 the corpus has lost effective drain — seeds are cycling endlessly
 *   - If λ_max > 0 for a stack, nearby queries produce unrelated injection sets (Butterfly Effect)
 *
 * Per-seed measurement:
 *   Perturb each query from the symptom index by removing one token.
 *   Compute Jaccard distance between injection set I(q) and I(q').
 *   log-divergence = log(|I(q) Δ I(q')| / max(|I(q)|, 1))
 *   λ_stack = mean log-divergence across all perturbations in that stack
 *
 * Healthy: λ ≈ −0.2 within a stack (small perturbation = small change)
 *          λ ≈ +0.5 at stack boundaries (queries near boundary diverge across stacks)
 * Unhealthy: λ > 0.8 within a stack (chaotic — vague symptom text)
 *            λ < −0.8 within a stack (frozen — every query hits the same seed)
 *
 * Usage:
 *   node scripts/measure-injection-stability.mjs              # report
 *   node scripts/measure-injection-stability.mjs --write      # save .lodestone/injection-stability.json
 *   node scripts/measure-injection-stability.mjs --stack react # one stack only
 *   node scripts/measure-injection-stability.mjs --samples 30  # queries per stack (default 20)
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, '..');
const SEEDS_DIR     = path.join(ROOT, 'seeds');
const INDEX_PATH    = path.join(ROOT, 'api', 'symptom-index.json');
const OUTPUT_PATH   = path.join(ROOT, '.lodestone', 'injection-stability.json');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');

const WRITE   = process.argv.includes('--write');
const STACK   = process.argv.find((a, i) => process.argv[i-1] === '--stack') ?? null;
const SAMPLES = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--samples') ?? '20', 10);
const MAX_INJECT = 5;

// ── Load symptom index ────────────────────────────────────────────────────────

if (!fs.existsSync(INDEX_PATH)) {
  console.error(`No symptom index at ${INDEX_PATH}`);
  console.error('Run: node scripts/build-index.mjs first');
  process.exit(1);
}

const indexData = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const index     = indexData.index ?? {};

// ── Load seeds ────────────────────────────────────────────────────────────────

function loadStack(stackName) {
  const p = path.join(SEEDS_DIR, `${stackName}.json`);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

function listStacks() {
  return fs.readdirSync(SEEDS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .filter(s => !STACK || s === STACK);
}

// ── Injection set computation ─────────────────────────────────────────────────

function tokenize(str) {
  return [...new Set(
    str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3)
  )];
}

function getInjectionSet(tokens) {
  const scores = {};
  const N      = Object.values(index).reduce((s, ids) => s + ids.length, 0);
  const avgDL  = 50; // approximate average document length in tokens

  for (const tok of tokens) {
    const ids = index[tok] ?? [];
    const idf = Math.log((N + 1) / (ids.length + 0.5));
    for (const id of ids) {
      scores[id] = (scores[id] ?? 0) + idf;
    }
  }
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_INJECT)
    .map(([id]) => id);
}

function jaccardSets(a, b) {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(x => sb.has(x)).length;
  const union  = sa.size + sb.size - inter;
  return union > 0 ? inter / union : 1;
}

// ── Measure Lyapunov exponent per stack ───────────────────────────────────────

function measureStack(stackName) {
  const seeds = loadStack(stackName);
  if (!seeds.length) return null;

  const queries  = []; // representative queries extracted from seed symptom tokens
  for (const seed of seeds) {
    const content = seed.content ?? seed.symptom ?? '';
    const tokens  = tokenize(content).slice(0, 8);
    if (tokens.length >= 2) queries.push(tokens);
  }

  if (!queries.length) return null;

  // Sample up to SAMPLES queries
  const sampled = queries.length <= SAMPLES
    ? queries
    : queries.filter((_, i) => i % Math.floor(queries.length / SAMPLES) === 0).slice(0, SAMPLES);

  const logDivergences = [];

  for (const q of sampled) {
    const I_q = getInjectionSet(q);
    if (!I_q.length) continue;

    // Perturb: remove each token once and measure divergence
    for (let drop = 0; drop < Math.min(q.length, 3); drop++) {
      const qPrime = q.filter((_, i) => i !== drop);
      if (!qPrime.length) continue;
      const I_qp = getInjectionSet(qPrime);

      // Jaccard divergence (1 - similarity)
      const sim      = jaccardSets(I_q, I_qp);
      const diverge  = 1 - sim;
      // Log-divergence: log of ratio of changed seeds to total seeds
      const sym_diff = [...I_q, ...I_qp].filter(x => !I_q.includes(x) || !I_qp.includes(x)).length;
      const logDiv   = Math.log(Math.max(sym_diff, 0.1) / Math.max(I_q.length, 1));
      logDivergences.push(logDiv);
    }
  }

  if (!logDivergences.length) return null;

  const lambda = logDivergences.reduce((s, x) => s + x, 0) / logDivergences.length;
  const stddev = Math.sqrt(logDivergences.reduce((s, x) => s + (x - lambda) ** 2, 0) / logDivergences.length);

  return {
    stack:   stackName,
    lambda:  Math.round(lambda * 1000) / 1000,
    stddev:  Math.round(stddev * 1000) / 1000,
    samples: logDivergences.length,
    seeds:   seeds.length,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('measure-injection-stability.mjs — Injection Lyapunov Diagnostic\n');
console.log('Physics grounding (liouville_theorem_phase_volume_preservation):');
console.log('  The injection system is DISSIPATIVE (drain exists) — unlike Hamiltonian systems.');
console.log('  Healthy corpus: Σλᵢ < 0 (dissipation removes phase volume — Lorenz territory).');
console.log('  Per-stack: λ ≈ 0 within domain, positive at boundaries.\n');

const stacks  = listStacks();
const results = [];

for (const s of stacks) {
  const r = measureStack(s);
  if (r) results.push(r);
}

if (!results.length) {
  console.log('No stacks with enough symptom data. Run node scripts/build-index.mjs first.');
  process.exit(0);
}

// Sort by lambda descending (most chaotic first)
results.sort((a, b) => b.lambda - a.lambda);

const sumLambda = results.reduce((s, r) => s + r.lambda, 0);
const avgLambda = sumLambda / results.length;

// Dissipation check (Liouville + Lorenz grounding)
const dissipationHealthy = sumLambda < 0;
const dissipationLabel   = dissipationHealthy
  ? `✓ DISSIPATIVE (Σλ = ${sumLambda.toFixed(3)} < 0 — healthy Lorenz dynamics)`
  : `⚠ NON-DISSIPATIVE (Σλ = ${sumLambda.toFixed(3)} ≥ 0 — drain may be insufficient)`;

console.log(`Σλᵢ (sum of all Lyapunov exponents) = ${sumLambda.toFixed(3)}`);
console.log(`${dissipationLabel}`);
console.log(`Average λ across ${results.length} stacks: ${avgLambda.toFixed(3)}\n`);

// Classify stacks
const chaotic = results.filter(r => r.lambda > 0.5);
const healthy = results.filter(r => r.lambda >= -0.5 && r.lambda <= 0.5);
const frozen  = results.filter(r => r.lambda < -0.5);

console.log(`── Per-stack Lyapunov spectrum ──────────────────────────────────────`);
console.log(`  Stack                          λ        σ      seeds  samples`);
console.log(`  ${'─'.repeat(65)}`);
for (const r of results) {
  const label = r.lambda > 0.5 ? '⚠ CHAOTIC' : r.lambda < -0.5 ? '↓ FROZEN' : '✓';
  console.log(`  ${r.stack.padEnd(30)} ${r.lambda.toFixed(3).padStart(7)}  ${r.stddev.toFixed(3).padStart(6)}  ${String(r.seeds).padStart(5)}  ${String(r.samples).padStart(7)}  ${label}`);
}

if (chaotic.length) {
  console.log(`\n⚠ Chaotic stacks (λ > 0.5): ${chaotic.map(r => r.stack).join(', ')}`);
  console.log(`  Small query changes produce unrelated injection sets. Improve symptom specificity.`);
}
if (frozen.length) {
  console.log(`\n↓ Frozen stacks (λ < -0.5): ${frozen.map(r => r.stack).join(', ')}`);
  console.log(`  Every query hits the same seed. Diversify symptom text or split the dominant seed.`);
}

if (WRITE) {
  const output = {
    generated_at:      new Date().toISOString(),
    sum_lambda:        Math.round(sumLambda * 1000) / 1000,
    avg_lambda:        Math.round(avgLambda * 1000) / 1000,
    dissipation_healthy: dissipationHealthy,
    stacks:            results,
    chaotic_stacks:    chaotic.map(r => r.stack),
    frozen_stacks:     frozen.map(r => r.stack),
    interpretation:    'Per Liouville theorem: dissipative corpus (Σλ<0) has Lorenz-type dynamics. Σλ≥0 means drain is insufficient.',
  };
  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n✓ Written to ${OUTPUT_PATH}`);
} else {
  console.log('\nRun with --write to save injection-stability.json');
}
