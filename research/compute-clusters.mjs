#!/usr/bin/env node
/**
 * scripts/compute-clusters.mjs
 *
 * Analyses the session archive to find seeds that consistently co-occur in
 * successful (clean) sessions. When seeds A, B, and C are injected together
 * in ≥60% of clean sessions, they form a cluster — and co_inject edges are
 * written between them.
 *
 * co_inject edges let the MCP server:
 *   1. Pre-fetch entire clusters in one pass instead of discovering members
 *      through implication chains (fewer round-trips)
 *   2. Treat cluster members as a unit for confidence tracking
 *   3. Surface co-inject notes in lookup results so users understand groupings
 *
 * The relationship only becomes reliable after enough sessions — this script
 * enforces a minimum session threshold before writing any edge.
 *
 * Usage:
 *   node scripts/compute-clusters.mjs          # report clusters, don't write
 *   node scripts/compute-clusters.mjs --write  # write co_inject edges to seeds
 *   node scripts/compute-clusters.mjs --min 5  # override minimum session count (default 10)
 *   node scripts/compute-clusters.mjs --threshold 0.5  # override co-occurrence threshold (default 0.6)
 *
 * MIT License — https://github.com/alexbkirby-glitch/Distill
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, '..');
const SEEDS_DIR    = path.join(ROOT, 'seeds');
const LODESTONE_DIR  = path.join(ROOT, '.lodestone');
const SESSIONS_DIR = path.join(LODESTONE_DIR, 'sessions');
const CONFIDENCE_FILE = path.join(LODESTONE_DIR, 'seed-confidence.json');

const WRITE     = process.argv.includes('--write');
const MIN_N_ARG = process.argv.indexOf('--min');
const THR_ARG   = process.argv.indexOf('--threshold');
const MIN_SESSIONS  = MIN_N_ARG  !== -1 ? parseInt(process.argv[MIN_N_ARG  + 1], 10) : 10;
const CO_THRESHOLD  = THR_ARG    !== -1 ? parseFloat(process.argv[THR_ARG  + 1])      : 0.6;

// ── Load session archive ──────────────────────────────────────────────────────

function loadSessions() {
  const sessions = [];

  // Primary source: session archive files (.lodestone/sessions/*.json)
  if (fs.existsSync(SESSIONS_DIR)) {
    for (const fname of fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'))) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, fname), 'utf8'));
        if (s.injected && Array.isArray(s.injected)) sessions.push(s);
      } catch {}
    }
  }

  // Secondary source: last-session.json (single most recent session)
  try {
    const last = JSON.parse(fs.readFileSync(path.join(LODESTONE_DIR, 'last-session.json'), 'utf8'));
    if (last?.injected && Array.isArray(last.injected)) {
      // Only add if not already in archive
      const lastId = last.session_id ?? last.generated_at;
      if (lastId && !sessions.some(s => (s.session_id ?? s.generated_at) === lastId)) {
        sessions.push(last);
      }
    }
  } catch {}

  return sessions;
}

function getCleanSessions(sessions) {
  // A session is "clean" if it has an outcome field of "clean", or if it has
  // no outcome field (we conservatively treat un-recorded sessions as neutral
  // but include them since they represent sessions where no problem was noted).
  return sessions.filter(s => s.outcome === 'clean' || s.outcome == null);
}

function getInjectedIds(session) {
  return (session.injected ?? []).map(c => typeof c === 'string' ? c : (c.id ?? c)).filter(Boolean);
}

// ── Co-occurrence computation ─────────────────────────────────────────────────

function computeCoOccurrence(sessions) {
  // co[idA][idB] = number of sessions where both A and B were injected
  const co      = Object.create(null);
  const appears = Object.create(null); // how many sessions each seed appears in

  for (const session of sessions) {
    const ids = getInjectedIds(session);
    const uniq = [...new Set(ids)];

    for (const id of uniq) {
      appears[id] = (appears[id] ?? 0) + 1;
    }

    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const [a, b] = [uniq[i], uniq[j]].sort();
        co[a]    = co[a]    ?? Object.create(null);
        co[a][b] = (co[a][b] ?? 0) + 1;
      }
    }
  }

  return { co, appears };
}

function findClusters(co, appears, totalSessions, minSessions, threshold) {
  const clusters = [];

  for (const [idA, bMap] of Object.entries(co)) {
    for (const [idB, count] of Object.entries(bMap)) {
      // How often do A and B co-occur, relative to how often each appears?
      const freqA = appears[idA] ?? 0;
      const freqB = appears[idB] ?? 0;
      if (freqA < minSessions || freqB < minSessions) continue;

      // Jaccard co-occurrence: |A∩B| / |A∪B|
      const union     = freqA + freqB - count;
      const coJaccard = count / union;

      // Also compute symmetric conditional probabilities
      const condAB    = count / freqA; // P(B|A)
      const condBA    = count / freqB; // P(A|B)
      const minCond   = Math.min(condAB, condBA);

      if (minCond >= threshold) {
        clusters.push({
          a:          idA,
          b:          idB,
          count,
          freqA,
          freqB,
          coJaccard:  Math.round(coJaccard * 100) / 100,
          minCond:    Math.round(minCond * 100) / 100,
          confidence: Math.round((0.5 * coJaccard + 0.5 * minCond) * 100) / 100,
        });
      }
    }
  }

  return clusters.sort((a, b) => b.confidence - a.confidence);
}

// ── Write co_inject edges ─────────────────────────────────────────────────────

function writeCoInjectEdges(clusters, seedsDir, dry = false) {
  // Build changeset: seed_id → [{ id, confidence, source }]
  const cs = Object.create(null);
  for (const c of clusters) {
    cs[c.a] = cs[c.a] ?? [];
    cs[c.b] = cs[c.b] ?? [];
    const edgeA = { id: c.b, confidence: c.confidence, source: 'session-derived', count: c.count };
    const edgeB = { id: c.a, confidence: c.confidence, source: 'session-derived', count: c.count };
    if (!cs[c.a].find(e => e.id === c.b)) cs[c.a].push(edgeA);
    if (!cs[c.b].find(e => e.id === c.a)) cs[c.b].push(edgeB);
  }

  let modifiedFiles = 0, modifiedSeeds = 0;
  for (const fname of fs.readdirSync(seedsDir).sort()) {
    if (!fname.endsWith('.json')) continue;
    const fp = path.join(seedsDir, fname);
    let seeds;
    try { seeds = JSON.parse(fs.readFileSync(fp, 'utf8')); }
    catch { continue; }
    if (!Array.isArray(seeds)) continue;

    let modified = false;
    for (const seed of seeds) {
      const newEdges = cs[seed.id];
      if (!newEdges?.length) continue;

      seed.relationships = seed.relationships ?? {};
      const existing = new Map(
        (seed.relationships.co_inject ?? []).map(e =>
          typeof e === 'string' ? [e, { id: e, confidence: 0 }] : [e.id, e]
        )
      );
      for (const edge of newEdges) {
        const ex = existing.get(edge.id);
        if (!ex || edge.confidence > ex.confidence) existing.set(edge.id, edge);
      }
      seed.relationships.co_inject = [...existing.values()];
      modified = true;
      modifiedSeeds++;
    }

    if (modified) {
      if (!dry) fs.writeFileSync(fp, JSON.stringify(seeds, null, 2));
      modifiedFiles++;
    }
  }
  return { modifiedFiles, modifiedSeeds };
}

// ── Upward cascade detection ──────────────────────────────────────────────────
//
// Kolmogorov cascade insight: energy flows from large eddies → small eddies,
// but the INVERSE also holds. Small eddies that consistently appear together
// are collectively acting as a large eddy — a parent seed should exist that
// captures their shared pattern.
//
// A cascade parent candidate is a clique of ≥ 3 seeds where:
//   - All pairwise co-occurrence rates exceed the threshold
//   - No existing seed already has 'implies' or 'requires' edges to all members
//   - The seeds collectively appear in enough sessions to be statistically meaningful
//
// This is distinct from Borromean rings (which have LOW pairwise but HIGH triple).
// Upward cascade candidates have HIGH pairwise AND HIGH triple — they're a genuine
// coherent cluster that should be given a single identity.

function findCascadeParentCandidates(clusters, appears, minSessions) {
  // Build adjacency list from cluster pairs
  const adj = Object.create(null);
  for (const c of clusters) {
    if (c.confidence < CO_THRESHOLD) continue;
    adj[c.a] = adj[c.a] ?? new Set();
    adj[c.b] = adj[c.b] ?? new Set();
    adj[c.a].add(c.b);
    adj[c.b].add(c.a);
  }

  // Find maximal cliques of size ≥ 3 using Bron-Kerbosch (small graph, manageable)
  const cliques = [];
  const nodes   = Object.keys(adj);

  function bronKerbosch(R, P, X) {
    if (P.length === 0 && X.length === 0) {
      if (R.length >= 3) cliques.push([...R]);
      return;
    }
    // Pivot: choose vertex u in P∪X to minimise branches
    const pivot = [...P, ...X].reduce((best, v) =>
      (adj[v]?.size ?? 0) > (adj[best]?.size ?? 0) ? v : best, P[0] ?? X[0]);
    const pivotNeighbours = adj[pivot] ?? new Set();
    for (const v of P.filter(x => !pivotNeighbours.has(x))) {
      const N = [...(adj[v] ?? [])];
      bronKerbosch([...R, v], P.filter(x => N.includes(x)), X.filter(x => N.includes(x)));
      P = P.filter(x => x !== v);
      X = [...X, v];
    }
  }

  bronKerbosch([], nodes, []);

  // Score cliques by average pairwise confidence and total sessions covered
  return cliques.map(clique => {
    const pairs = [];
    for (let i = 0; i < clique.length; i++) {
      for (let j = i + 1; j < clique.length; j++) {
        const c = clusters.find(c => (c.a === clique[i] && c.b === clique[j]) || (c.a === clique[j] && c.b === clique[i]));
        if (c) pairs.push(c);
      }
    }
    const avgConf    = pairs.length ? pairs.reduce((s, p) => s + p.confidence, 0) / pairs.length : 0;
    const minAppear  = Math.min(...clique.map(id => appears[id] ?? 0));
    const minPairN   = pairs.length ? Math.min(...pairs.map(p => p.count)) : 0;

    return {
      clique:        clique.sort(),
      size:          clique.length,
      avg_confidence: Math.round(avgConf * 100) / 100,
      min_pair_count: minPairN,
      min_appear:    minAppear,
      suggested_id:  clique.slice(0, 3).map(s => s.split('_')[0]).join('_') + '_cluster',
    };
  })
  .filter(c => c.min_pair_count >= minSessions && c.min_appear >= minSessions)
  .sort((a, b) => b.avg_confidence - a.avg_confidence || b.size - a.size);
}

// ── Report ────────────────────────────────────────────────────────────────────

function report(clusters, sessions, cleanSessions) {
  console.log(`\nSession archive: ${sessions.length} total, ${cleanSessions.length} clean`);
  console.log(`Co-occurrence threshold: ${CO_THRESHOLD} · Minimum sessions: ${MIN_SESSIONS}`);
  console.log(`\nClusters found: ${clusters.length}\n`);

  if (clusters.length === 0) {
    console.log('No clusters yet — need more sessions with recorded outcomes.');
    console.log(`Run \`npm run outcome:clean\` after each successful session.`);
    console.log(`A minimum of ${MIN_SESSIONS} sessions per seed is required.\n`);
    return;
  }

  console.log(`  ${'Seed A'.padEnd(42)} ↔  ${'Seed B'.padEnd(42)}  Conf  Count`);
  console.log(`  ${'─'.repeat(100)}`);
  for (const c of clusters.slice(0, 20)) {
    console.log(
      `  ${c.a.slice(0,41).padEnd(42)} ↔  ${c.b.slice(0,41).padEnd(42)} ` +
      `${c.confidence.toFixed(2)}  ${c.count}`
    );
  }
  if (clusters.length > 20) console.log(`  … and ${clusters.length - 20} more pairs`);
}

function reportCascade(candidates) {
  if (!candidates.length) return;
  console.log(`\n── Upward cascade candidates — parent seeds to mint ──────────────────────\n`);
  console.log(`  These seed cliques co-occur strongly enough to warrant a parent seed.`);
  console.log(`  A parent seed would inject all members preventively and provide a`);
  console.log(`  higher-level pattern description (the large eddy above the small ones).\n`);

  for (const c of candidates.slice(0, 8)) {
    console.log(`  Clique (${c.size} seeds)  avg_conf=${c.avg_confidence}  min_count=${c.min_pair_count}`);
    for (const id of c.clique) console.log(`    • ${id}`);
    console.log(`  Suggested parent ID: ${c.suggested_id}`);
    console.log(`  Action: use capture_fix to create a parent seed with:`);
    console.log(`    - content describing the shared high-level antipattern`);
    console.log(`    - relationships: { requires: [${c.clique.map(s => `"${s}"`).join(', ')}] }`);
    console.log('');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('compute-clusters.mjs\n');

const allSessions   = loadSessions();
const cleanSessions = getCleanSessions(allSessions);

if (!cleanSessions.length) {
  console.log(`No session data found in ${SESSIONS_DIR}`);
  console.log('Sessions are archived automatically by outcome-tracker.mjs after each recorded outcome.');
  console.log('Run a few sessions with `npm run outcome:clean` to populate the archive.\n');
  process.exit(0);
}

const { co, appears }     = computeCoOccurrence(cleanSessions);
const clusters            = findClusters(co, appears, cleanSessions.length, MIN_SESSIONS, CO_THRESHOLD);
const cascadeCandidates   = findCascadeParentCandidates(clusters, appears, MIN_SESSIONS);

report(clusters, allSessions, cleanSessions);
reportCascade(cascadeCandidates);

if (WRITE && clusters.length) {
  const { modifiedFiles, modifiedSeeds } = writeCoInjectEdges(clusters, SEEDS_DIR);
  console.log(`\n✓ Wrote co_inject edges to ${modifiedSeeds} seeds across ${modifiedFiles} files.`);

  // Write cascade candidates to a draft file for human review
  if (cascadeCandidates.length) {
    const draftPath = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), '.lodestone', 'cascade-parents-draft.json');
    const draft = {
      generated_at:  new Date().toISOString(),
      candidates:    cascadeCandidates,
      instructions:  'Review each candidate and use capture_fix to mint the parent seed. Set relationships.requires to all clique members.',
    };
    fs.mkdirSync(path.dirname(draftPath), { recursive: true });
    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
    console.log(`✓ Cascade candidates written to ${draftPath}`);
  }

  console.log('Run node scripts/build-index.mjs to rebuild the relationship graph.\n');
} else if (!WRITE && clusters.length) {
  console.log('\nRun with --write to apply co_inject edges and save cascade candidates.\n');
}
