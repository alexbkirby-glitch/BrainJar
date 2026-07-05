#!/usr/bin/env node
/**
 * scripts/build-stats.mjs
 *
 * Computes reputation scores, earned achievements, and verification signals
 * from the local Lodestone data. Writes lodestone-stats.json — read by StoneHub
 * to display author reputation without requiring a backend.
 *
 * Stats are self-published, which means they can be gamed. The trust model
 * treats self-published stats as a starting signal, not a guarantee. StoneHub
 * cross-references GitHub identity (repo ownership) and provenance depth
 * (how many chains trace back here) to weight the signal.
 *
 * Called by build-index.mjs automatically on every build.
 *
 * MIT License — https://github.com/alexbkirby-glitch/Distill
 */

import fs   from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, '..');
const SEEDS_DIR   = path.join(ROOT, 'seeds');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadSeeds() {
  const all = [];
  for (const fname of fs.readdirSync(SEEDS_DIR).sort()) {
    if (!fname.endsWith('.json')) continue;
    const stack = fname.replace('.json', '');
    try {
      const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
      if (!Array.isArray(seeds)) continue;
      seeds.filter(s => !s.type || s.type === 'knowledge')
           .forEach(s => all.push({ ...s, _stack: stack }));
    } catch {}
  }
  return all;
}

function loadOutcomeData() {
  try { return JSON.parse(fs.readFileSync(path.join(LODESTONE_DIR, 'seed-confidence.json'), 'utf8')); }
  catch { return {}; }
}

function loadDriftCache() {
  try { return JSON.parse(fs.readFileSync(path.join(LODESTONE_DIR, 'drift-cache.json'), 'utf8')); }
  catch { return null; }
}

function getRepoInfo() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const url = pkg.repository?.url ?? '';
    const m   = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    return m ? { owner: m[1], repo: m[2] } : { owner: 'unknown', repo: 'unknown' };
  } catch { return { owner: 'unknown', repo: 'unknown' }; }
}

// ── Achievement definitions ───────────────────────────────────────────────────
// Each achievement has: id, name, description, icon, and a check function
// that receives the computed stats and returns true/false.

const ACHIEVEMENTS = [
  // Seed authorship
  {
    id: 'first_stone',
    name: 'First Stone',
    description: 'Published 10+ seeds',
    icon: '🪨',
    tier: 'bronze',
    check: s => s.total_seeds >= 10,
  },
  {
    id: 'chiseled',
    name: 'Chiseled',
    description: '50+ seeds published',
    icon: '⛏',
    tier: 'silver',
    check: s => s.total_seeds >= 50,
  },
  {
    id: 'geologist',
    name: 'Geologist',
    description: '200+ seeds published',
    icon: '🏔',
    tier: 'gold',
    check: s => s.total_seeds >= 200,
  },
  {
    id: 'polymath',
    name: 'Polymath',
    description: 'Seeds across 5+ stacks',
    icon: '🗺',
    tier: 'silver',
    check: s => s.stacks_covered >= 5,
  },
  {
    id: 'seed_author',
    name: 'Seed Author',
    description: 'Has personal (battle-tested) seeds',
    icon: '✍',
    tier: 'bronze',
    check: s => s.personal_seeds > 0,
  },
  {
    id: 'battle_tested',
    name: 'Battle Tested',
    description: '10+ personal seeds from real debugging sessions',
    icon: '🔥',
    tier: 'silver',
    check: s => s.personal_seeds >= 10,
  },
  // Quality signals
  {
    id: 'well_sourced',
    name: 'Well Sourced',
    description: '50%+ of seeds link to official documentation',
    icon: '📚',
    tier: 'bronze',
    check: s => s.total_seeds > 0 && (s.seeds_with_doc_ref / s.total_seeds) >= 0.5,
  },
  {
    id: 'fully_documented',
    name: 'Fully Documented',
    description: '90%+ of seeds have doc references',
    icon: '📖',
    tier: 'gold',
    check: s => s.total_seeds > 0 && (s.seeds_with_doc_ref / s.total_seeds) >= 0.9,
  },
  {
    id: 'precise',
    name: 'Precise',
    description: 'All seeds have explicit Symptom fields',
    icon: '🎯',
    tier: 'silver',
    check: s => s.seeds_with_symptom_ratio >= 0.95,
  },
  // Reliability
  {
    id: 'validated',
    name: 'Validated',
    description: 'Publishes outcome tracking data',
    icon: '✅',
    tier: 'silver',
    check: s => s.has_outcome_data,
  },
  {
    id: 'high_confidence',
    name: 'High Confidence',
    description: 'Average session confidence > 0.75 across 10+ tracked seeds',
    icon: '💎',
    tier: 'gold',
    check: s => s.tracked_seeds >= 10 && s.avg_confidence > 0.75,
  },
  {
    id: 'drift_free',
    name: 'Drift-Free',
    description: 'No stale doc references',
    icon: '🧲',
    tier: 'silver',
    check: s => s.has_drift_check && s.drift_stale === 0,
  },
  // Community (self-reported; StoneHub cross-references)
  {
    id: 'provenance_rich',
    name: 'Provenance Rich',
    description: 'Seeds carry full provenance chains',
    icon: '🔗',
    tier: 'bronze',
    check: s => s.grafted_seeds_ratio > 0 || s.personal_seeds > 5,
  },
  {
    id: 'universal_contributor',
    name: 'Universal Contributor',
    description: 'Has universal seeds (cross-language patterns)',
    icon: '🌐',
    tier: 'bronze',
    check: s => s.has_universal_stack,
  },
];

// ── Reputation score ──────────────────────────────────────────────────────────
// 0–100 composite. Weighted toward signal quality over raw quantity.

function computeReputation(stats) {
  let score = 0;

  // Seed count (0–20)
  if (stats.total_seeds >= 200) score += 20;
  else if (stats.total_seeds >= 50)  score += 15;
  else if (stats.total_seeds >= 10)  score += 8;
  else score += Math.floor(stats.total_seeds / 2);

  // Stack coverage (0–15)
  if (stats.stacks_covered >= 10) score += 15;
  else if (stats.stacks_covered >= 5) score += 10;
  else score += Math.floor(stats.stacks_covered * 1.5);

  // Personal seeds (0–15)
  if (stats.personal_seeds >= 20) score += 15;
  else if (stats.personal_seeds >= 5) score += 10;
  else score += stats.personal_seeds;

  // Documentation quality (0–20)
  const docRatio = stats.total_seeds > 0 ? stats.seeds_with_doc_ref / stats.total_seeds : 0;
  score += Math.floor(docRatio * 20);

  // Outcome data (0–15)
  if (stats.has_outcome_data) {
    score += 5;
    if (stats.tracked_seeds >= 10) score += 5;
    if (stats.avg_confidence > 0.75) score += 5;
  }

  // Drift health (0–10)
  if (stats.has_drift_check) {
    score += stats.drift_stale === 0 ? 10 : Math.max(0, 10 - stats.drift_stale * 2);
  }

  // Symptom quality (0–5)
  score += Math.floor(stats.seeds_with_symptom_ratio * 5);

  return Math.min(100, Math.round(score));
}

// ── Verification signals ──────────────────────────────────────────────────────
// These are signals, not guarantees. StoneHub displays them honestly.

function computeVerification(stats, repoInfo) {
  return {
    github_identity: repoInfo.owner !== 'unknown',  // repo has a github.com URL
    has_personal_seeds: stats.personal_seeds > 0,    // self-authored content
    has_outcome_data: stats.has_outcome_data,         // publishes session results
    has_provenance: stats.seeds_with_provenance > 0, // seeds have origin chains
    // The following require StoneHub backend (Phase 2):
    // community_grafts: null,  // how many users have grafted from this Lodestone
    // trust_depth: null,       // how many trusted authors link to this Lodestone
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const seeds      = loadSeeds();
const outcomes   = loadOutcomeData();
const drift      = loadDriftCache();
const repoInfo   = getRepoInfo();

// Compute raw stats
const BLAST_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const stacksSet  = new Set(seeds.map(s => s._stack));
const blastDist  = { critical: 0, high: 0, medium: 0, low: 0, unset: 0 };
let withDocRef = 0, withSymptom = 0, personalCount = 0, graftedCount = 0;

for (const s of seeds) {
  if (s.blast_radius && blastDist[s.blast_radius] !== undefined) blastDist[s.blast_radius]++;
  else blastDist.unset++;
  if (s.doc_reference) withDocRef++;
  if (s.source === 'personal') personalCount++;
  if (s.provenance) graftedCount++;
  const content = s.content ?? '';
  if (s.symptom || /Symptom:/i.test(content)) withSymptom++;
}

const outcomeRecords  = Object.values(outcomes);
const trackedSeeds    = outcomeRecords.filter(r => r.injections >= 3);
const avgConfidence   = trackedSeeds.length
  ? trackedSeeds.reduce((s, r) => s + r.confidence, 0) / trackedSeeds.length
  : 0;

// ── Readiness tier system ─────────────────────────────────────────────────────
// Each diagnostic tier has a data prerequisite. Metrics below the current tier
// show their unlock condition rather than "skipped" — this makes the path forward
// visible and avoids training users to ignore repeated failure messages.
//
// Pass --full to print all metrics regardless of tier (useful for debugging
// or exploring a well-populated Stone).

const FULL = process.argv.includes('--full');

const graphPath      = path.join(ROOT, 'api', 'relationship-graph.json');
const graphData      = (() => { try { return fs.existsSync(graphPath) ? JSON.parse(fs.readFileSync(graphPath, 'utf8')) : null; } catch { return null; } })();
const graphNodes     = graphData?.nodes?.length ?? 0;
const graphEdges     = graphData?.edges?.length ?? 0;
const nashPath       = path.join(ROOT, '.lodestone', 'nash-equilibrium.json');
const stabilityPath  = path.join(ROOT, '.lodestone', 'injection-stability.json');
const homologyPath   = path.join(ROOT, '.lodestone', 'persistent-homology.json');

const seedsWithRichInjections = outcomeRecords.filter(r => r.injections >= 5).length;

const TIER = {
  T1_DISTRIBUTION: trackedSeeds.length >= 5,              // Kolmogorov + Carnot
  T2_ENTROPY:      trackedSeeds.length >= 15,             // Gibbs entropy
  T3_GRAPH:        graphNodes >= 20 && graphEdges >= 30,  // Fiedler + Euler
  T4_NASH:         fs.existsSync(nashPath),               // Nash (separate script)
  T4_STABILITY:    fs.existsSync(stabilityPath),          // Lyapunov (separate script)
  T4_HOMOLOGY:     fs.existsSync(homologyPath),           // Persistent homology (separate script)
};

// Single-line dormant message — shows unlock condition, not a failure
function dormant(metric, condition, command = null) {
  if (FULL) return false; // --full bypasses all dormant gates
  const cmd = command ? `  →  ${command}` : '';
  console.log(`  ↻ ${metric}: ${condition}${cmd}`);
  return true; // caller should skip the block
}

const stats = {
  total_seeds:            seeds.length,
  personal_seeds:         personalCount,
  stacks_covered:         stacksSet.size,
  seeds_with_doc_ref:     withDocRef,
  seeds_with_provenance:  graftedCount,
  blast_distribution:     blastDist,
  has_universal_stack:    stacksSet.has('universal'),
  has_outcome_data:       trackedSeeds.length >= 3,
  tracked_seeds:          trackedSeeds.length,
  avg_confidence:         Math.round(avgConfidence * 100) / 100,
  has_drift_check:        drift !== null,
  drift_stale:            drift?.stale ?? 0,
  seeds_with_symptom_ratio: seeds.length > 0 ? withSymptom / seeds.length : 0,
  grafted_seeds_ratio:    seeds.length > 0 ? graftedCount / seeds.length : 0,
};

// Compute achievements
const earned = ACHIEVEMENTS
  .filter(a => a.check(stats))
  .map(a => ({
    id:          a.id,
    name:        a.name,
    description: a.description,
    icon:        a.icon,
    tier:        a.tier,
    earned_at:   new Date().toISOString().slice(0, 10),
  }));

// Compute reputation and verification
const reputation   = computeReputation(stats);
const verification = computeVerification(stats, repoInfo);

const output = {
  schema_version: '1',
  generated_at:   new Date().toISOString(),
  owner:          repoInfo.owner,
  repo:           repoInfo.repo,
  stats,
  achievements: earned,
  reputation_score: reputation,
  reputation_grade: reputation >= 90 ? 'S' : reputation >= 75 ? 'A' : reputation >= 60 ? 'B' : reputation >= 40 ? 'C' : 'D',
  verification,
};

fs.writeFileSync(path.join(ROOT, 'lodestone-stats.json'), JSON.stringify(output, null, 2));

console.log(`lodestone-stats.json`);
console.log(`  Reputation: ${reputation}/100 (${output.reputation_grade})`);
console.log(`  Achievements: ${earned.length} earned (${ACHIEVEMENTS.length} total)`);
earned.forEach(a => console.log(`    ${a.icon} ${a.name} [${a.tier}]`));
console.log(`  Verification: ${Object.entries(verification).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none'}`);

// ── Facet and domain breakdown ────────────────────────────────────────────────
// Shows how the corpus is distributed across the modular context structure.
// Active profile is displayed so users can see which seeds are in scope for
// their current configuration.

{
  const cfg         = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.lodestone', 'config.json'), 'utf8')); } catch { return {}; } })();
  const activeProf  = cfg.profile ?? 'generalist';
  const facetsActive = cfg.active_facets ?? [];
  const domsActive   = cfg.active_domains ?? [];

  const byFacet  = {};
  const byDomain = {};
  seeds.forEach(s => {
    const f = s.facet  ?? 'unclassified';
    const d = s.domain ?? 'unclassified';
    byFacet[f]  = (byFacet[f]  ?? 0) + 1;
    byDomain[d] = (byDomain[d] ?? 0) + 1;
  });

  console.log('\n── Corpus structure ─────────────────────────────────────────────────────');
  console.log(`  Active profile: ${activeProf}${facetsActive.length ? '  →  facets: ' + facetsActive.join(', ') : '  (generalist — all seeds active)'}`);
  console.log(`\n  Seeds by facet:`);
  Object.entries(byFacet).sort((a,b) => b[1]-a[1]).forEach(([f,n]) => {
    const active = !facetsActive.length || facetsActive.includes(f) || f === 'universal';
    console.log(`    ${active ? '✓' : '○'} ${f.padEnd(14)} ${n}`);
  });
  console.log(`\n  Top domains:`);
  Object.entries(byDomain).sort((a,b) => b[1]-a[1]).slice(0,10).forEach(([d,n]) => {
    const active = !domsActive.length || domsActive.includes(d);
    console.log(`    ${active ? '✓' : '○'} ${d.padEnd(14)} ${n}`);
  });
  console.log(`\n  Use set_profile (via Claude) or set "profile" in .lodestone/config.json`);
  console.log(`  to scope injection to your context. list_profiles shows all 14 options.`);
}

// ── Distribution health (Tiers 1–4) ──────────────────────────────────────────
// Four diagnostics, each unlocking with more data. On a fresh Stone the section
// is silent except for the unlock guidance. On a mature Stone all four fire.

console.log('\n── Distribution health ──────────────────────────────────────────────────');

// ── Tier 1: Kolmogorov cascade + Carnot efficiency ────────────────────────────
// Kolmogorov: injection frequency rank-frequency power law slope.
// Carnot:     compression ratio across all seed content (always computable).
// Both fire together at Tier 1 — they're fast, cheap, and most broadly useful.

const confPath = path.join(ROOT, '.lodestone', 'seed-confidence.json');

if (!dormant('Distribution health', `record ${5 - trackedSeeds.length} more seed outcomes (npm run outcome:clean)`, null) || FULL) {
  // Kolmogorov cascade
  try {
    const conf = fs.existsSync(confPath) ? JSON.parse(fs.readFileSync(confPath, 'utf8')) : {};
    const injectCounts = Object.values(conf)
      .map(r => r.injections ?? 0)
      .filter(n => n > 0)
      .sort((a, b) => b - a);

    if (injectCounts.length >= 5) {
      const n  = injectCounts.length;
      const xs = injectCounts.map((_, i) => Math.log(i + 1));
      const ys = injectCounts.map(f => Math.log(f));
      const xm = xs.reduce((a, b) => a + b, 0) / n;
      const ym = ys.reduce((a, b) => a + b, 0) / n;
      const num = xs.reduce((s, x, i) => s + (x - xm) * (ys[i] - ym), 0);
      const den = xs.reduce((s, x) => s + (x - xm) ** 2, 0);
      const m   = den !== 0 ? num / den : 0;
      const health = m > -1.0 ? 'LAMINAR (too flat — seeds too uniform)'
                   : m < -2.5 ? 'MONOPOLAR (1–2 seeds dominate)'
                   : m < -2.0 ? 'SLIGHTLY STEEP'
                   : '✓ HEALTHY (Kolmogorov range)';
      console.log(`  Kolmogorov cascade:  slope m = ${m.toFixed(3)}  (target −2.0 to −1.0)  ${health}`);
      output.kolmogorov = { slope: Math.round(m * 1000) / 1000, health_label: health.split(' ')[0], seeds_measured: n };
    }
  } catch (e) { console.log(`  Kolmogorov cascade: error — ${e.message}`); }

  // Carnot efficiency (always has data — just needs seed content)
  try {
    const allContent = seeds.map(s => s.content ?? '').join('\n---SEED---\n');
    const rawSize    = Buffer.byteLength(allContent, 'utf8');
    const compressed = zlib.gzipSync(allContent);
    const eta        = rawSize > 0 ? 1 - compressed.length / rawSize : 0;
    const label      = eta > 0.6 ? '✓ HIGH (information-dense)'
                     : eta > 0.3 ? '○ MODERATE'
                     : '⚠ LOW — high Landauer redundancy';
    console.log(`  Carnot efficiency:   η = ${eta.toFixed(3)}  (${(rawSize/1024).toFixed(0)} KB → ${(compressed.length/1024).toFixed(0)} KB)  ${label}`);
    output.carnot = { eta: Math.round(eta * 1000) / 1000, raw_kb: Math.round(rawSize/1024), compressed_kb: Math.round(compressed.length/1024) };
  } catch (e) { console.log(`  Carnot efficiency: error — ${e.message}`); }
}

// ── Tier 2: Gibbs entropy ─────────────────────────────────────────────────────
// Upgrades Kolmogorov with a direct confidence-distribution metric.
// Requires more tracked seeds to be meaningful (otherwise entropy just reflects
// the Laplace prior, not real session evidence).

if (!TIER.T2_ENTROPY) {
  dormant('Gibbs entropy', `needs ${15 - trackedSeeds.length} more tracked seeds`);
} else {
  try {
    const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    const ps   = Object.values(conf)
      .map(r => r.effective_confidence ?? r.confidence ?? 0.5)
      .filter(p => p > 0.001 && p < 0.999);
    if (ps.length >= 15) {
      const H_gibbs = -ps.reduce((s, p) => s + p * Math.log(p) + (1 - p) * Math.log(1 - p), 0) / ps.length;
      const H_norm  = H_gibbs / Math.log(2);
      const label   = H_norm < 0.4 ? '✓ COMMITTED (confident corpus)'
                    : H_norm > 0.7 ? '⚠ HIGH UNCERTAINTY (many seeds near 0.5)'
                    : '○ MODERATE';
      console.log(`  Gibbs entropy:       H = ${H_gibbs.toFixed(3)} nats  (normalised ${H_norm.toFixed(3)})  ${label}`);
      output.gibbs_entropy = { H: Math.round(H_gibbs * 1000) / 1000, H_norm: Math.round(H_norm * 1000) / 1000, seeds_measured: ps.length };
    }
  } catch (e) { console.log(`  Gibbs entropy: error — ${e.message}`); }
}

// ── Tier 3: Fiedler value + Euler characteristic ──────────────────────────────
// Requires a populated relationship graph. Graph must have ≥20 nodes and ≥30
// edges before the Fiedler value is structurally meaningful.

console.log('\n── Graph structure ──────────────────────────────────────────────────────');

if (!TIER.T3_GRAPH) {
  const nodeNeed = Math.max(0, 20 - graphNodes);
  const edgeNeed = Math.max(0, 30 - graphEdges);
  const msg = graphNodes === 0
    ? 'no graph yet — run detect-relationships.mjs --write'
    : `needs ${nodeNeed > 0 ? nodeNeed + ' more nodes, ' : ''}${edgeNeed > 0 ? edgeNeed + ' more edges' : ''}`;
  dormant('Fiedler λ₂ + Euler χ', msg, nodeNeed === 0 && edgeNeed === 0 ? null : 'npm run detect-relationships:write');
} else {
  try {
    const nodes = graphData.nodes;
    const edges = graphData.edges;
    const nodeIdx = new Map(nodes.map((n, i) => [n.id ?? n, i]));
    const N       = nodes.length;
    const degree  = new Float64Array(N);
    const adj     = Array.from({ length: N }, () => []);

    for (const e of edges) {
      const i = nodeIdx.get(e.source ?? e.from);
      const j = nodeIdx.get(e.target ?? e.to);
      if (i == null || j == null || i === j) continue;
      const w = e.confidence ?? e.weight ?? 1.0;
      adj[i].push({ j, w }); adj[j].push({ j: i, w });
      degree[i] += w; degree[j] += w;
    }

    function laplacianMul(v) {
      const out = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        out[i] = degree[i] * v[i];
        for (const { j, w } of adj[i]) out[i] -= w * v[j];
      }
      return out;
    }
    const dot  = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]*b[i]; return s; };
    const norm = a => Math.sqrt(dot(a, a));
    const deflate = v => { const m = v.reduce((s,x)=>s+x,0)/N; return v.map(x=>x-m); };
    const shift = degree.reduce((s,d)=>s+d,0)/N;
    let v = new Float64Array(Array.from({length:N},(_,i)=>Math.sin(i+1)));
    const n0 = norm(v); for (let i=0;i<N;i++) v[i]/=n0;
    v = new Float64Array(deflate(Array.from(v)));

    for (let iter = 0; iter < 80; iter++) {
      const Lv  = laplacianMul(v);
      const sv  = v.map((x,i) => shift*x - Lv[i]);
      const pj  = new Float64Array(deflate(Array.from(sv)));
      const n   = norm(pj);
      if (n < 1e-12) break;
      for (let i=0;i<N;i++) v[i]=pj[i]/n;
    }
    const Lv      = laplacianMul(v);
    const lambda2 = dot(v, Lv);
    const chi     = N - edges.length;
    const b1_est  = Math.max(0, edges.length - N + 1);
    const connLabel = lambda2 < 0.05 ? '⚠ NEAR-DISCONNECTED' : lambda2 < 0.3 ? '↓ LOW' : lambda2 > 5.0 ? '⚠ OVER-CONNECTED' : '✓ HEALTHY';

    console.log(`  Fiedler λ₂:          ${lambda2.toFixed(4)}  (connectivity)  ${connLabel}`);
    console.log(`  Euler χ:             ${chi}  (V=${N} E=${edges.length})  b₁ cycles ≈ ${b1_est}${b1_est > 0 ? ' — run loops:homology for Goldstone gap detail' : ''}`);
    output.fiedler = { lambda2: Math.round(lambda2*10000)/10000, nodes: N, edges: edges.length, euler_chi: chi, b1_estimate: b1_est };
    fs.writeFileSync(path.join(ROOT, 'lodestone-stats.json'), JSON.stringify(output, null, 2));
  } catch (e) { console.log(`  Fiedler / Euler: error — ${e.message}`); }
}

// ── Tier 4: Separate-script diagnostics (load from output files) ──────────────
// These are run explicitly via `npm run loops:*`. build-stats just reports
// their most recent output if available — no recomputation here.

const tier4Lines = [];
if (TIER.T4_NASH) {
  try {
    const nash = JSON.parse(fs.readFileSync(nashPath, 'utf8'));
    const kl   = nash.kl_divergence ?? '?';
    const ok   = kl < 0.1 ? '✓ near-equilibrium' : kl < 0.5 ? '○ moderate' : '⚠ unstable';
    tier4Lines.push(`  Nash distance:       KL = ${typeof kl==='number'?kl.toFixed(4):kl}  ${ok}  (${nash.generated_at?.slice(0,10) ?? '?'})`);
    if (nash.dominant_seeds?.length) tier4Lines.push(`    ${nash.dominant_seeds.length} dominant-strategy seed(s) — see .lodestone/nash-equilibrium.json`);
  } catch {}
}
if (TIER.T4_STABILITY) {
  try {
    const stab = JSON.parse(fs.readFileSync(stabilityPath, 'utf8'));
    const ok   = stab.dissipation_healthy ? '✓ dissipative (Σλ < 0)' : '⚠ non-dissipative';
    tier4Lines.push(`  Injection stability: Σλ = ${stab.sum_lambda?.toFixed(3) ?? '?'}  ${ok}  (${stab.generated_at?.slice(0,10) ?? '?'})`);
    if (stab.chaotic_stacks?.length) tier4Lines.push(`    Chaotic stacks: ${stab.chaotic_stacks.join(', ')}`);
  } catch {}
}
if (TIER.T4_HOMOLOGY) {
  try {
    const hom = JSON.parse(fs.readFileSync(homologyPath, 'utf8'));
    const gaps = hom.goldstone_gaps?.length ?? 0;
    tier4Lines.push(`  Persistent homology: χ=${hom.euler_chi}  b₁=${hom.final_b1}  Goldstone gaps=${gaps}  (${hom.generated_at?.slice(0,10) ?? '?'})`);
  } catch {}
}

if (tier4Lines.length) {
  console.log('\n── Advanced diagnostics (from separate script runs) ─────────────────────');
  tier4Lines.forEach(l => console.log(l));
}

// ── Unlock progress summary ───────────────────────────────────────────────────
// Shows what the next tier of diagnostics needs. Replaces "skipped" noise with
// a concrete roadmap. Only shown when there are dormant tiers.

const dormantTiers = [
  !TIER.T1_DISTRIBUTION && `Tier 1 (distribution health):   ${5 - trackedSeeds.length} more tracked seeds  →  npm run outcome:clean`,
  !TIER.T2_ENTROPY      && `Tier 2 (Gibbs entropy):          ${15 - trackedSeeds.length} more tracked seeds`,
  !TIER.T3_GRAPH        && `Tier 3 (graph structure):        run detect-relationships.mjs --write (needs ≥20 nodes, ≥30 edges)`,
  !TIER.T4_NASH         && `Tier 4 (Nash distance):          run npm run loops:nash  (needs ≥4 seeds with ≥2 injections)`,
  !TIER.T4_STABILITY    && `Tier 4 (injection stability):    run npm run loops:stability`,
  !TIER.T4_HOMOLOGY     && `Tier 4 (persistent homology):    run npm run loops:homology  (needs Tier 3 first)`,
].filter(Boolean);

if (dormantTiers.length && !FULL) {
  console.log('\n── Diagnostics that activate with more data ─────────────────────────────');
  dormantTiers.forEach(l => console.log(`  ↻ ${l}`));
  console.log(`\n  Run with --full to force all sections regardless of tier.`);
}

fs.writeFileSync(path.join(ROOT, 'lodestone-stats.json'), JSON.stringify(output, null, 2));

