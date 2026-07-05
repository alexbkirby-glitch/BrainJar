#!/usr/bin/env node
/**
 * scripts/compute-rag-metrics.mjs — Phase 5: Automated RAG Eval Harness
 *
 * Computes retrieval quality metrics from the .lodestone/sessions/ archive.
 * Designed to run before any RAG phase change (baseline) and after each phase
 * (verification). All metrics derived from local files — no LLM, no API.
 *
 * Metrics:
 *   Hit Rate       — sessions where ≥1 injected seed was cited by the model
 *   Precision@k    — fraction of injected seeds that were cited
 *   MRR            — 1 / rank of the first cited seed (higher = cited seed ranked higher)
 *   Recall (approx) — cited / (cited + contradicted-but-not-injected) — approximation
 *   Outcome rate   — clean vs regression distribution
 *   Injection ROI  — average inject_weight across injected seeds
 *
 * Note on availability:
 *   Hit Rate / Precision / MRR require `cited_seed_ids` in the archive.
 *   These are populated starting from Phase 5 when record_outcome is called.
 *   Older sessions contribute to outcome rate and injection count only.
 *
 * Usage:
 *   node scripts/compute-rag-metrics.mjs                   # compute and print
 *   node scripts/compute-rag-metrics.mjs --save            # save to rag-metrics.json
 *   node scripts/compute-rag-metrics.mjs --baseline        # save as baseline snapshot
 *   node scripts/compute-rag-metrics.mjs --compare         # diff against baseline
 *   node scripts/compute-rag-metrics.mjs --json            # machine-readable output only
 *   node scripts/compute-rag-metrics.mjs --stack react     # filter to one stack
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, '..');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const SESSIONS_DIR  = path.join(LODESTONE_DIR, 'sessions');
const METRICS_FILE  = path.join(LODESTONE_DIR, 'rag-metrics.json');
const BASELINE_FILE = path.join(LODESTONE_DIR, 'rag-metrics-baseline.json');

const ARGS         = new Set(process.argv.slice(2));
const FLAG_SAVE    = ARGS.has('--save') || ARGS.has('--baseline');
const FLAG_BASELINE = ARGS.has('--baseline');
const FLAG_COMPARE = ARGS.has('--compare');
const FLAG_JSON    = ARGS.has('--json');
const STACK_FILTER = (() => {
  const idx = process.argv.indexOf('--stack');
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

// ── Load all sessions ─────────────────────────────────────────────────────

function loadSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const sessions = [];
  for (const f of fs.readdirSync(SESSIONS_DIR).filter(x => x.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
      // Normalise injected field: may be [{id,stack,...}] or array of strings
      s._injectedIds = (s.injected ?? s.injected_ids ?? []).map(x =>
        typeof x === 'string' ? x : x.id
      ).filter(Boolean);
      sessions.push(s);
    } catch {}
  }
  sessions.sort((a, b) => (a.recorded_at ?? '') < (b.recorded_at ?? '') ? -1 : 1);
  return sessions;
}

// ── Metric computation ────────────────────────────────────────────────────

function computeMetrics(sessions, stackFilter = null) {
  const filtered = stackFilter
    ? sessions.filter(s =>
        (s.injected ?? []).some(x => (typeof x === 'object' ? x.stack : null) === stackFilter) ||
        s.query_stack === stackFilter
      )
    : sessions;

  const total  = filtered.length;
  if (!total) return null;

  // Sessions split by data availability
  const withCited     = filtered.filter(s => Array.isArray(s.cited_seed_ids));
  const withRanks     = filtered.filter(s =>
    Array.isArray(s.cited_seed_ids) &&
    (s.injected ?? []).some(x => typeof x === 'object' && x.rank != null)
  );
  const withOutcome   = filtered.filter(s => s.outcome);
  const cleanSessions = withOutcome.filter(s => s.outcome === 'clean');

  // ── Hit Rate ─────────────────────────────────────────────────────────────
  // Of sessions where cited_seed_ids is known, what fraction had ≥1 cited seed?
  const hitsWithData = withCited.filter(s => s.cited_seed_ids.length > 0).length;
  const hitRate = withCited.length ? hitsWithData / withCited.length : null;

  // ── Precision@k ──────────────────────────────────────────────────────────
  // Mean over sessions: |cited ∩ injected| / |injected|
  let precisions = [];
  for (const s of withCited) {
    const injSet  = new Set(s._injectedIds);
    const citSet  = new Set(s.cited_seed_ids ?? []);
    const overlap = [...citSet].filter(id => injSet.has(id)).length;
    if (injSet.size > 0) precisions.push(overlap / injSet.size);
  }
  const precision = precisions.length ? mean(precisions) : null;

  // ── MRR (Mean Reciprocal Rank) ────────────────────────────────────────────
  // For sessions with both cited IDs and injection ranks, find where the first
  // cited seed appeared in the ranked injection list.
  let recipRanks = [];
  for (const s of withRanks) {
    const citSet = new Set(s.cited_seed_ids ?? []);
    const injected = s.injected ?? [];
    // Sort by rank (1-indexed), find first cited
    const ranked = injected
      .filter(x => typeof x === 'object' && x.rank != null)
      .sort((a, b) => a.rank - b.rank);
    const firstCited = ranked.find(x => citSet.has(x.id));
    if (firstCited) recipRanks.push(1 / firstCited.rank);
  }
  const mrr = recipRanks.length ? mean(recipRanks) : null;

  // ── Recall (approximation) ────────────────────────────────────────────────
  // cited / (cited + contradicted_and_not_injected)
  // contradicted_and_not_injected = seeds in contradicted_seed_ids that weren't injected
  let recalls = [];
  for (const s of withCited) {
    const injSet    = new Set(s._injectedIds);
    const citSet    = new Set(s.cited_seed_ids ?? []);
    const contraSet = new Set(s.contradicted_seed_ids ?? []);
    const cited     = [...citSet].filter(id => injSet.has(id)).length;
    const missedErr = [...contraSet].filter(id => !injSet.has(id)).length;
    if (cited + missedErr > 0) recalls.push(cited / (cited + missedErr));
  }
  const recall = recalls.length ? mean(recalls) : null;

  // ── Outcome distribution ──────────────────────────────────────────────────
  const outcomeRate = withOutcome.length
    ? cleanSessions.length / withOutcome.length
    : null;

  // ── Average injections per session ───────────────────────────────────────
  const avgInjections = mean(filtered.map(s => s._injectedIds.length));

  // ── Injection ROI ─────────────────────────────────────────────────────────
  const roiValues = filtered.flatMap(s =>
    (s.injected ?? [])
      .filter(x => typeof x === 'object' && x.inject_weight != null)
      .map(x => x.inject_weight)
  );
  const avgROI = roiValues.length ? mean(roiValues) : null;

  // ── Retrieval method distribution ─────────────────────────────────────────
  const allInjected = filtered.flatMap(s =>
    (s.injected ?? []).filter(x => typeof x === 'object')
  );
  const hybridCount = allInjected.filter(x => x.retrieval === 'hybrid').length;
  const denseCount  = allInjected.filter(x => x.retrieval === 'dense').length;
  const bm25Count   = allInjected.filter(x => x.retrieval === 'bm25').length;
  const rerankCount = allInjected.filter(x => x._reranked).length;

  // ── Date range ────────────────────────────────────────────────────────────
  const timestamps = filtered.map(s => s.recorded_at ?? s.generated_at).filter(Boolean).sort();

  return {
    sessions_analyzed:    total,
    sessions_with_outcome: withOutcome.length,
    sessions_with_cited:   withCited.length,
    sessions_with_ranks:   withRanks.length,
    date_range: {
      earliest: timestamps[0] ?? null,
      latest:   timestamps[timestamps.length - 1] ?? null,
    },
    metrics: {
      hit_rate:             round(hitRate),
      precision_at_k:       round(precision),
      mrr:                  round(mrr),
      recall_approx:        round(recall),
      outcome_clean_rate:   round(outcomeRate),
      avg_injections:       round(avgInjections, 1),
      avg_inject_roi:       round(avgROI),
    },
    retrieval_mix: {
      hybrid_pct: allInjected.length ? round(hybridCount / allInjected.length) : null,
      dense_pct:  allInjected.length ? round(denseCount  / allInjected.length) : null,
      bm25_pct:   allInjected.length ? round(bm25Count   / allInjected.length) : null,
      reranked_pct: allInjected.length ? round(rerankCount / allInjected.length) : null,
    },
  };
}

function computeByStack(sessions) {
  const stacks = {};
  for (const s of sessions) {
    for (const x of (s.injected ?? [])) {
      const stack = typeof x === 'object' ? x.stack : null;
      if (stack) stacks[stack] = (stacks[stack] ?? 0) + 1;
    }
  }
  const stackNames = Object.entries(stacks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([s]) => s);

  return Object.fromEntries(
    stackNames.map(stack => [stack, computeMetrics(sessions, stack)])
  );
}

function computeOverTime(sessions) {
  const byMonth = {};
  for (const s of sessions) {
    const ts = s.recorded_at ?? s.generated_at;
    if (!ts) continue;
    const month = ts.slice(0, 7); // YYYY-MM
    byMonth[month] = byMonth[month] ?? [];
    byMonth[month].push(s);
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([month, slist]) => {
      const m = computeMetrics(slist);
      return { month, sessions: slist.length, ...m?.metrics ?? {} };
    });
}

// ── Compare against baseline ──────────────────────────────────────────────

function compare(current, baseline) {
  const rows = [];
  const m1 = current.metrics ?? {};
  const m2 = baseline.metrics ?? {};
  for (const key of Object.keys({ ...m1, ...m2 })) {
    const v1 = m1[key], v2 = m2[key];
    if (v1 == null && v2 == null) continue;
    const delta = (v1 != null && v2 != null) ? v1 - v2 : null;
    rows.push({ metric: key, current: v1, baseline: v2, delta });
  }
  return rows;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function round(v, dp = 3) {
  if (v == null) return null;
  return Math.round(v * 10 ** dp) / 10 ** dp;
}

function pct(v) {
  if (v == null) return 'n/a';
  return `${Math.round(v * 100)}%`;
}

function fmt(v, dp = 3) {
  if (v == null) return 'n/a';
  return v.toFixed(dp);
}

function deltaStr(d) {
  if (d == null) return '';
  const sign = d > 0 ? '+' : '';
  return `  (${sign}${(d * 100).toFixed(1)} pp)`;
}

// ── Output ────────────────────────────────────────────────────────────────

function printMetrics(m, baseline = null) {
  if (!m) { console.log('No sessions found.'); return; }
  const b = baseline?.metrics ?? {};

  console.log(`\n${'═'.repeat(52)}`);
  console.log(' Lodestone RAG Eval Metrics');
  console.log('═'.repeat(52));
  console.log(` Sessions analyzed:  ${m.sessions_analyzed}  (${m.sessions_with_cited} with cited data, ${m.sessions_with_ranks} with ranks)`);
  if (m.date_range.earliest) {
    console.log(` Date range:         ${m.date_range.earliest?.slice(0, 10)} → ${m.date_range.latest?.slice(0, 10)}`);
  }
  console.log('');
  console.log(' Core retrieval metrics (require cited_seed_ids in archive):');
  console.log(`   Hit Rate:         ${pct(m.metrics.hit_rate).padEnd(8)}${deltaStr(m.metrics.hit_rate != null && b.hit_rate != null ? m.metrics.hit_rate - b.hit_rate : null)}`);
  console.log(`   Precision@k:      ${pct(m.metrics.precision_at_k).padEnd(8)}${deltaStr(m.metrics.precision_at_k != null && b.precision_at_k != null ? m.metrics.precision_at_k - b.precision_at_k : null)}`);
  console.log(`   MRR:              ${fmt(m.metrics.mrr).padEnd(8)}${deltaStr(m.metrics.mrr != null && b.mrr != null ? m.metrics.mrr - b.mrr : null)}`);
  console.log(`   Recall (approx):  ${pct(m.metrics.recall_approx).padEnd(8)}`);
  console.log('');
  console.log(' Session quality:');
  console.log(`   Clean rate:       ${pct(m.metrics.outcome_clean_rate)}`);
  console.log(`   Avg injections:   ${fmt(m.metrics.avg_injections, 1)}`);
  console.log(`   Avg ROI:          ${fmt(m.metrics.avg_inject_roi)}`);
  console.log('');
  if (Object.values(m.retrieval_mix).some(v => v != null)) {
    console.log(' Retrieval mix (when RRF active):');
    if (m.retrieval_mix.hybrid_pct != null) console.log(`   hybrid (BM25+dense): ${pct(m.retrieval_mix.hybrid_pct)}`);
    if (m.retrieval_mix.dense_pct  != null) console.log(`   dense-only:          ${pct(m.retrieval_mix.dense_pct)}`);
    if (m.retrieval_mix.bm25_pct   != null) console.log(`   bm25-only:           ${pct(m.retrieval_mix.bm25_pct)}`);
    if (m.retrieval_mix.reranked_pct != null) console.log(`   reranked (Phase 3):  ${pct(m.retrieval_mix.reranked_pct)}`);
    console.log('');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

const sessions    = loadSessions();
const metrics     = computeMetrics(sessions, STACK_FILTER);
const byStack     = STACK_FILTER ? null : computeByStack(sessions);
const overTime    = STACK_FILTER ? null : computeOverTime(sessions);

const output = {
  generated_at:   new Date().toISOString(),
  stack_filter:   STACK_FILTER ?? null,
  ...(metrics ?? { error: 'No sessions found' }),
  by_stack:       byStack,
  over_time:      overTime,
};

if (FLAG_JSON) {
  console.log(JSON.stringify(output, null, 2));
} else {
  let baseline = null;
  if (FLAG_COMPARE && fs.existsSync(BASELINE_FILE)) {
    try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch {}
  }
  printMetrics(metrics, baseline);

  if (byStack && !STACK_FILTER) {
    const stackEntries = Object.entries(byStack)
      .filter(([, m]) => m?.sessions_analyzed >= 3)
      .sort(([, a], [, b]) => (b?.metrics?.hit_rate ?? 0) - (a?.metrics?.hit_rate ?? 0));
    if (stackEntries.length) {
      console.log(' Hit rate by stack (≥3 sessions):');
      for (const [stack, m] of stackEntries.slice(0, 8)) {
        console.log(`   ${stack.padEnd(22)} ${pct(m?.metrics?.hit_rate).padEnd(6)} (${m?.sessions_analyzed} sessions)`);
      }
      console.log('');
    }
  }

  if (FLAG_COMPARE && baseline) {
    const rows = compare(metrics, baseline);
    const meaningful = rows.filter(r => r.delta != null && Math.abs(r.delta) > 0.0005);
    console.log(` Δ vs baseline (${baseline.generated_at?.slice(0, 10) ?? 'unknown'}):`);
    if (!meaningful.length) {
      console.log('   No meaningful change vs baseline.\n');
    } else {
      for (const r of meaningful) {
        const arrow = r.delta > 0 ? '↑' : '↓';
        console.log(`   ${arrow} ${r.metric.padEnd(20)} ${pct(r.current).padEnd(7)} ← was ${pct(r.baseline)}`);
      }
      console.log('');
    }
  }

  if (!sessions.length) {
    console.log('');
    console.log(' No sessions archived yet. To generate sessions:');
    console.log('   1. Run lookup_symptom during a coding session');
    console.log('   2. Call record_outcome with cited_seed_ids when done');
    console.log('   3. Re-run this script\n');
  } else if (!metrics?.sessions_with_cited) {
    console.log(' Sessions found but none have cited_seed_ids yet.');
    console.log(' Pass cited_seed_ids to record_outcome to unlock Hit Rate, Precision, and MRR.\n');
  }
}

if (FLAG_SAVE) {
  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  const targetPath = FLAG_BASELINE ? BASELINE_FILE : METRICS_FILE;
  fs.writeFileSync(targetPath, JSON.stringify(output, null, 2));
  if (!FLAG_JSON) {
    console.log(` ✓ Saved to ${path.relative(ROOT, targetPath)}`);
    if (FLAG_BASELINE) console.log(' Use --compare in future runs to measure improvement.\n');
  }
}
