#!/usr/bin/env node
/**
 * scripts/migrate-seed-schema.mjs — Seed Schema Migration
 *
 * Adds five new fields to every seed in the corpus:
 *
 *   wrong / correct / symptom  — separate fields extracted from content string
 *                                (15% of seeds already have these; 85% need parsing)
 *
 *   summary                    — single-line description for Claude Projects scanning:
 *                                "Topic: mistake — solution" (max ~120 chars)
 *
 *   example_triggers           — 2-4 natural developer phrasings that should match
 *                                this seed in a Claude Projects context where BM25
 *                                and synonyms don't run
 *
 *   antipattern_category       — type of harm: security | data-loss | concurrency |
 *                                performance | readability | correctness
 *
 *   applies_when               — conditions object {stack, facet, domain, min_version}
 *                                describing when this seed is relevant
 *
 * Mechanical inference runs for all seeds (fast, no API key needed).
 * LLM enhancement (--llm) improves summary and example_triggers via claude-haiku
 * using batched JSON-structured calls (~100 API calls for full corpus, ~$2).
 *
 * Usage:
 *   node scripts/migrate-seed-schema.mjs              # mechanical only
 *   node scripts/migrate-seed-schema.mjs --llm        # + LLM enhancement
 *   node scripts/migrate-seed-schema.mjs --stack react # single stack
 *   node scripts/migrate-seed-schema.mjs --dry-run    # preview, no writes
 *   npm run migrate:schema
 *
 * Idempotent: seeds that already have all fields are skipped.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const SEEDS_DIR  = path.join(ROOT, 'seeds');

const USE_LLM    = process.argv.includes('--llm');
const DRY_RUN    = process.argv.includes('--dry-run');
const STACK_ONLY = (() => { const i = process.argv.indexOf('--stack'); return i >= 0 ? process.argv[i+1] : null; })();
const LLM_BATCH  = 20; // seeds per claude-haiku call

// ── Parsing helpers ────────────────────────────────────────────────────────

function extractParts(content) {
  const wrongM   = content.match(/WRONG:\s*([\s\S]*?)(?=CORRECT:|Symptom:|$)/i);
  const correctM = content.match(/CORRECT:\s*([\s\S]*?)(?=WRONG:|Symptom:|$)/i);
  const symptomM = content.match(/Symptom:\s*([\s\S]*?)(?=WRONG:|CORRECT:|$)/i);
  return {
    wrong:   wrongM   ? wrongM[1].trim()   : '',
    correct: correctM ? correctM[1].trim() : '',
    symptom: symptomM ? symptomM[1].trim() : '',
  };
}

// ── Mechanical inference ───────────────────────────────────────────────────

function inferCategory(seed) {
  const text = [seed.content, ...(seed.tags ?? [])].join(' ').toLowerCase();
  if (/\b(security|xss|csrf|inject|sanitiz|escape|vuln|attack|exploit|password|token|auth(?:enticat|oriz))\b/.test(text))
    return 'security';
  if (/\b(data.?loss|corrupt|overwrite|irrecoverab|permanent.?delet|wipe)\b/.test(text))
    return 'data-loss';
  if (/\b(race.?condition|deadlock|concurren|mutex|atomic|goroutine|thread|lock|semaphore)\b/.test(text))
    return 'concurrency';
  if (/\b(performance|memory.?leak|slow|latency|timeout|cache|optim|efficienc)\b/.test(text))
    return 'performance';
  if (/\b(readab|format|naming|style|convention|maintainab)\b/.test(text))
    return 'readability';
  return 'correctness';
}

function inferAppliesWhen(seed) {
  const conds = {};
  const skip  = new Set(['universal', 'bridge', 'lodestone', 'meta']);
  if (seed.stack  && !skip.has(seed.stack))  conds.stack  = seed.stack;
  if (seed.facet  && !skip.has(seed.facet))  conds.facet  = seed.facet;
  if (seed.domain && !skip.has(seed.domain)) conds.domain = seed.domain;
  const verM = (seed.content ?? '').match(/\bv?(\d+\.\d+(?:\.\d+)?)\b/);
  if (verM) conds.note = `Written for v${verM[1]} context`;
  return Object.keys(conds).length ? conds : null;
}

function mechanicalSummary(seed) {
  const sym  = (seed.symptom || extractParts(seed.content ?? '').symptom || '').trim();
  const base = seed.title ?? seed.id ?? '';
  return sym
    ? `${base}: ${sym.split('.')[0].slice(0, 100)}`
    : base.slice(0, 120);
}

function mechanicalTriggers(seed) {
  const sym = (seed.symptom || extractParts(seed.content ?? '').symptom || '').trim();
  return sym ? [sym.slice(0, 150)] : [];
}

function needsMigration(seed) {
  return !(seed.wrong && seed.correct && seed.symptom &&
           seed.summary && seed.example_triggers?.length &&
           seed.antipattern_category && seed.applies_when !== undefined);
}

// ── LLM enhancement ────────────────────────────────────────────────────────

async function llmEnhanceBatch(seeds) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const items = seeds.map((s, i) => ({
    idx: i,
    id:  s.id,
    title: s.title ?? s.id,
    wrong: (s.wrong || extractParts(s.content ?? '').wrong).slice(0, 200),
    correct: (s.correct || extractParts(s.content ?? '').correct).slice(0, 200),
    symptom: (s.symptom || extractParts(s.content ?? '').symptom).slice(0, 150),
  }));

  const prompt =
    `For each antipattern seed below, generate:\n` +
    `1. "summary": One line (max 100 chars), format: "{Topic}: {wrong approach} — {right approach}"\n` +
    `2. "example_triggers": Array of 3 short phrases a developer might say when experiencing this bug (natural speech, not jargon)\n\n` +
    `Return ONLY a JSON array: [{"id":"...", "summary":"...", "example_triggers":["...","...","..."]}]\n\n` +
    `Seeds:\n${JSON.stringify(items, null, 1)}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const results = JSON.parse(match[0]);
    return Object.fromEntries(results.map(r => [r.id, r]));
  } catch { return null; }
}

// ── Main migration ─────────────────────────────────────────────────────────

const stackFiles = fs.readdirSync(SEEDS_DIR)
  .filter(f => f.endsWith('.json'))
  .filter(f => !STACK_ONLY || f === `${STACK_ONLY}.json`);

let totalSeeds = 0, migratedCount = 0, llmEnhancedCount = 0;

for (const fname of stackFiles) {
  const fpath = path.join(SEEDS_DIR, fname);
  let seeds;
  try { seeds = JSON.parse(fs.readFileSync(fpath, 'utf8')); }
  catch (e) { console.error(`  ✗ ${fname}: parse error — ${e.message}`); continue; }

  const toMigrate = seeds.filter(needsMigration);
  totalSeeds += seeds.length;

  if (!toMigrate.length) { process.stderr.write(`  ✓ ${fname} (all up to date)\n`); continue; }

  // ── LLM enhancement (batched) ──────────────────────────────────────────
  let llmResults = {};
  if (USE_LLM && toMigrate.length) {
    for (let i = 0; i < toMigrate.length; i += LLM_BATCH) {
      const batch = toMigrate.slice(i, i + LLM_BATCH);
      process.stderr.write(`  [llm] ${fname}: batch ${Math.floor(i/LLM_BATCH)+1}/${Math.ceil(toMigrate.length/LLM_BATCH)}\r`);
      const res = await llmEnhanceBatch(batch);
      if (res) Object.assign(llmResults, res);
    }
    if (toMigrate.length) process.stderr.write('\n');
  }

  // ── Apply migrations ───────────────────────────────────────────────────
  const updated = seeds.map(seed => {
    if (!needsMigration(seed)) return seed;

    const parts = extractParts(seed.content ?? '');
    const wrong   = seed.wrong   || parts.wrong;
    const correct = seed.correct || parts.correct;
    const symptom = seed.symptom || parts.symptom;
    const llm     = llmResults[seed.id];

    migratedCount++;
    if (llm) llmEnhancedCount++;

    return {
      ...seed,
      // Extracted structural fields
      ...(wrong   && !seed.wrong   ? { wrong   } : {}),
      ...(correct && !seed.correct ? { correct } : {}),
      ...(symptom && !seed.symptom ? { symptom } : {}),
      // New schema fields
      summary:              seed.summary     ?? llm?.summary           ?? mechanicalSummary({ ...seed, wrong, correct, symptom }),
      example_triggers:     seed.example_triggers?.length ? seed.example_triggers
                            : (llm?.example_triggers ?? mechanicalTriggers({ ...seed, symptom })),
      antipattern_category: seed.antipattern_category ?? inferCategory(seed),
      applies_when:         seed.applies_when !== undefined ? seed.applies_when : inferAppliesWhen(seed),
    };
  });

  if (DRY_RUN) {
    console.error(`  [dry] ${fname}: ${toMigrate.length} seeds would be updated`);
  } else {
    fs.writeFileSync(fpath, JSON.stringify(updated, null, 2));
    console.error(`  ✓ ${fname}: ${toMigrate.length} seeds migrated${llmResults && Object.keys(llmResults).length ? ' (+llm)' : ''}`);
  }
}

console.error(`\n[migrate-schema] Done.`);
console.error(`  Total seeds:    ${totalSeeds}`);
console.error(`  Migrated:       ${migratedCount}`);
if (USE_LLM) console.error(`  LLM-enhanced:   ${llmEnhancedCount}`);
console.error(DRY_RUN ? '  (dry run — no files written)' : '  Run npm run build:index to rebuild retrieval indexes.');
