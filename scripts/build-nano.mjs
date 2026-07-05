#!/usr/bin/env node
/**
 * scripts/build-nano.mjs
 *
 * Generates three formats optimised for different context budgets:
 *
 * 1. lodestone-nano.md   (~600 tokens)
 *    The "always in context" front door. Contains every critical seed in full
 *    WRONG/CORRECT/Symptom format, a symptom quick-lookup table for high-blast
 *    seeds, the available-stacks inventory, and navigation instructions.
 *    Upload to a Claude Project's custom instructions, or paste into CLAUDE.md.
 *
 * 2. generated/claude-projects/instructions.md
 *    Ready-to-paste Claude Project instructions. Tells the model which file to
 *    look in for which stack, how to use the symptom index, and when to call
 *    the MCP lookup tool vs. searching an uploaded file.
 *
 * 3. generated/claude-projects/{stack}-SKILL.md   (compressed)
 *    Per-stack skill files compressed for upload. Compression rules:
 *      Critical  → full WRONG + CORRECT + Symptom (always read)
 *      High      → CORRECT + Symptom (skip WRONG to save tokens)
 *      Medium    → Symptom + id reference only
 *      Low       → title + id (summary list)
 *    Saves ~40% vs. the full SKILL.md while preserving all actionable content.
 *
 * Usage:
 *   node scripts/build-nano.mjs                    # all stacks
 *   node scripts/build-nano.mjs --stacks react,typescript  # specific stacks only
 *   node scripts/build-nano.mjs --context          # use detectActiveStacks() for the stacks
 *
 * Output is written to:
 *   lodestone-nano.md
 *   generated/claude-projects/
 *
 * MIT License — https://github.com/alexbkirby-glitch/Distill
 */

import fs            from 'fs';
import path          from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, '..');
const SEEDS_DIR   = path.join(ROOT, 'seeds');
const GEN_DIR     = path.join(ROOT, 'generated');
const CP_DIR      = path.join(GEN_DIR, 'claude-projects');

fs.mkdirSync(CP_DIR, { recursive: true });

// ── CLI ───────────────────────────────────────────────────────────────────────

const CONTEXT_MODE  = process.argv.includes('--context');
const STACKS_ARG    = (() => {
  const i = process.argv.indexOf('--stacks');
  return i !== -1 ? process.argv[i + 1].split(',').map(s => s.trim()) : null;
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

const BLAST_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const STOPWORDS  = new Set(['the','and','for','not','with','this','that','from','are','was',
  'but','all','can','its','has','have','when','been','does','did','will','use','used','set']);

function tokenize(s) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function extractSection(content, marker) {
  const re = new RegExp(`${marker}:\\s*([\\s\\S]*?)(?=WRONG:|CORRECT:|Symptom:|$)`, 'i');
  return (content ?? '').match(re)?.[1]?.trim() ?? '';
}

function sortByBlast(seeds) {
  return [...seeds].sort((a, b) =>
    (BLAST_RANK[a.blast_radius ?? 'medium'] ?? 2) - (BLAST_RANK[b.blast_radius ?? 'medium'] ?? 2)
  );
}

// ── Seed loading ──────────────────────────────────────────────────────────────

function loadStack(stack) {
  const fp = path.join(SEEDS_DIR, `${stack}.json`);
  if (!fs.existsSync(fp)) return [];
  try {
    const seeds = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Array.isArray(seeds)
      ? seeds.filter(s => !s.type || s.type === 'knowledge')
      : [];
  } catch { return []; }
}

function loadAllStacks() {
  return fs.readdirSync(SEEDS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

function stackSummary(stack, seeds) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  seeds.forEach(s => { if (counts[s.blast_radius ?? 'medium'] !== undefined) counts[s.blast_radius ?? 'medium']++; });
  return { stack, total: seeds.length, ...counts };
}

// ── Nano front door ─────────────────────────────────────────────────────────
// Target: 600–900 tokens. Fits in Claude Project custom instructions field.
// Strategy: navigation instructions + condensed symptom index + top critical refs.
// Full critical seeds go in lodestone-critical.md (separate uploadable file).

function buildNano(allStackSummaries, allSeeds) {
  const now  = new Date().toISOString().slice(0, 10);
  const repo = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name ?? 'Lodestone'; }
    catch { return 'Lodestone'; }
  })();

  const criticals = allSeeds.filter(s => s.blast_radius === 'critical');
  const highSeeds = allSeeds.filter(s => s.blast_radius === 'high');
  const total     = allSeeds.length;

  const lines = [
    `# Lodestone — ${repo}`,
    `> ${total} seeds · ${allStackSummaries.length} stacks · ${criticals.length} critical · ${now}`,
    ``,
    `## How to use`,
    ``,
    `1. **Before writing code** — check if the relevant stack SKILL file has a matching seed`,
    `2. **Error in context** — find the symptom below, fetch that stack's SKILL file`,
    `3. **MCP available** — call \`lookup_symptom("paste error here")\` for full search`,
    `4. **Critical patterns** — always read \`lodestone-critical.md\` for the active stack`,
    ``,
    `Seed format: **WRONG** (antipattern) → **CORRECT** (fix) → **Symptom** (observable failure).`,
    `When applying a seed, note: "Applying \`{seed_id}\` — {reason}."`,
    ``,
    `## Critical seeds (${criticals.length} total — read lodestone-critical.md)`,
    ``,
  ];

  // One-line refs for critical seeds — title + stack + symptom excerpt
  for (const s of criticals.slice(0, 20)) {
    const symptom = s.symptom || extractSection(s.content, 'Symptom');
    lines.push(`- ⚠ **[${s._stack}]** \`${s.id}\` — ${(symptom || s.title).slice(0, 80)}`);
  }
  if (criticals.length > 20) lines.push(`- _(+ ${criticals.length - 20} more in lodestone-critical.md)_`);
  lines.push(``);

  // Compact symptom index — top 25 high-blast seeds
  lines.push(`## Symptom index (high blast — see SKILL files for detail)`);
  lines.push(``);
  const topHigh = highSeeds.slice(0, 25);
  for (const s of topHigh) {
    const symptom = s.symptom || extractSection(s.content, 'Symptom');
    if (!symptom) continue;
    lines.push(`- \`${s.id}\` [${s._stack}] — ${symptom.slice(0, 80)}${symptom.length > 80 ? '…' : ''}`);
  }
  lines.push(``);

  // Stack inventory (condensed)
  const inv = allStackSummaries
    .filter(s => s.total > 0)
    .sort((a, b) => b.critical - a.critical || b.high - a.high || b.total - a.total)
    .slice(0, 20)
    .map(s => `${s.stack}${s.critical ? `(⚠${s.critical})` : ''}`)
    .join(' · ');
  lines.push(`## Stacks: ${inv}`);
  lines.push(``);
  lines.push(`Files: \`lodestone-nano.md\` (this) · \`lodestone-critical.md\` · \`{stack}-SKILL.md\` per stack`);

  return lines.join('\n');
}

// ── Critical seeds file ───────────────────────────────────────────────────────
// Separate uploadable file — all critical seeds in full WRONG/CORRECT/Symptom.
// Small enough to upload (35 seeds ≈ 2,000 tokens) but detailed enough to act on.

function buildCriticalFile(allSeeds) {
  const criticals = allSeeds.filter(s => s.blast_radius === 'critical');
  const now       = new Date().toISOString().slice(0, 10);

  const lines = [
    `# Lodestone — Critical Patterns`,
    `> ${criticals.length} seeds · data loss / security / correctness · ${now}`,
    `> **Always apply these. Never skip. Check before writing code in the relevant stack.**`,
    ``,
  ];

  // Group by stack
  const byStack = {};
  for (const s of criticals) (byStack[s._stack] = byStack[s._stack] ?? []).push(s);

  for (const [stack, seeds] of Object.entries(byStack).sort()) {
    lines.push(`## ${stack}`);
    lines.push(``);
    for (const s of seeds) {
      const wrong   = s.wrong   || extractSection(s.content, 'WRONG');
      const correct = s.correct || extractSection(s.content, 'CORRECT');
      const symptom = s.symptom || extractSection(s.content, 'Symptom');
      lines.push(`### ${s.title}`);
      lines.push(`\`${s.id}\``);
      if (wrong)   lines.push(`**WRONG:** ${wrong}`);
      if (correct) lines.push(`**CORRECT:** ${correct}`);
      if (symptom) lines.push(`**Symptom:** ${symptom}`);
      lines.push(``);
    }
  }

  return lines.join('\n');
}

// ── Claude Projects instructions ──────────────────────────────────────────────
// ── Claude Projects instructions ──────────────────────────────────────────────
// Paste this into the Claude Project's "Custom instructions" field.

function buildProjectInstructions(stackSummaries, activeStacks = null) {
  const stacks = activeStacks
    ? stackSummaries.filter(s => activeStacks.includes(s.stack))
    : stackSummaries.filter(s => s.total > 0).slice(0, 12);

  const stackList = stacks
    .sort((a, b) => b.critical - a.critical || b.high - a.high)
    .map(s => {
      const flags = [s.critical && `⚠${s.critical} critical`, s.high && `${s.high} high`].filter(Boolean).join(', ');
      return `- **${s.stack}** — ${s.total} seeds${flags ? ` (${flags})` : ''}`;
    })
    .join('\n');

  return `# Lodestone — Developer context

You have access to a Lodestone seed library. Seeds are structured WRONG→CORRECT→Symptom patterns
from real development work. Use them to catch antipatterns before writing code.

## Uploaded seed files
${stackList}

## How to use

**Before writing code:** Check whether the stack's SKILL file contains a relevant seed.
If you see a symptom that matches a seed, apply the CORRECT pattern and note which seed it is.

**When you encounter an error:** Look up the symptom in \`lodestone-nano.md\` (the symptom index).
Then fetch the matching stack SKILL file for the full WRONG/CORRECT/Symptom detail.

**Priority order:**
1. ⚠ Critical seeds in \`lodestone-nano.md\` — always apply, never skip
2. High-blast seeds in the relevant stack SKILL file — check proactively for the active stack
3. Medium seeds — reference when a symptom matches; don't inject unless relevant

## Seed format
Each seed has:
- **id** — snake_case identifier (e.g. \`react_stale_closure\`)
- **WRONG** — what the code was doing incorrectly
- **CORRECT** — the right approach
- **Symptom** — the exact error or observable failure

When applying a seed, briefly note: "Applying seed \`{id}\` — {reason}."
`;
}

// ── Compressed per-stack SKILL.md ─────────────────────────────────────────────
// Token-efficient variant: critical=full, high=correct+symptom, medium=symptom only, low=title list.

function buildCompressedSkill(stack, seeds) {
  const sorted   = sortByBlast(seeds);
  const critical = sorted.filter(s => s.blast_radius === 'critical');
  const high     = sorted.filter(s => s.blast_radius === 'high');
  const medium   = sorted.filter(s => s.blast_radius === 'medium');
  const low      = sorted.filter(s => !['critical','high','medium'].includes(s.blast_radius ?? ''));
  const now      = new Date().toISOString().slice(0, 10);

  const tokenEst = (s) => Math.ceil(s.length / 4); // rough token estimate

  const lines = [
    `# ${stack} — Lodestone SKILL (compressed)`,
    ``,
    `> ${seeds.length} seeds · ${critical.length}⚠ critical · ${high.length} high · ${medium.length} medium`,
    `> ${now} · Full version: \`generated/claude-projects/${stack}-SKILL.md\``,
    ``,
  ];

  if (critical.length) {
    lines.push(`## ⚠ Critical`);
    lines.push(``);
    for (const s of critical) {
      const wrong   = s.wrong   || extractSection(s.content, 'WRONG');
      const correct = s.correct || extractSection(s.content, 'CORRECT');
      const symptom = s.symptom || extractSection(s.content, 'Symptom');
      lines.push(`### ${s.title}`);
      lines.push(`\`${s.id}\``);
      if (wrong)   lines.push(`**WRONG:** ${wrong}`);
      if (correct) lines.push(`**CORRECT:** ${correct}`);
      if (symptom) lines.push(`**Symptom:** ${symptom}`);
      lines.push(``);
    }
  }

  if (high.length) {
    lines.push(`## High blast`);
    lines.push(``);
    for (const s of high) {
      // High: CORRECT + Symptom. Skip WRONG — saves ~30% per seed.
      const correct = s.correct || extractSection(s.content, 'CORRECT');
      const symptom = s.symptom || extractSection(s.content, 'Symptom');
      lines.push(`**${s.title}** \`${s.id}\``);
      if (correct) lines.push(`CORRECT: ${correct.slice(0, 200)}${correct.length > 200 ? '…' : ''}`);
      if (symptom) lines.push(`Symptom: ${symptom.slice(0, 120)}${symptom.length > 120 ? '…' : ''}`);
      lines.push(``);
    }
  }

  if (medium.length) {
    lines.push(`## Medium — symptom reference`);
    lines.push(`*If you see these symptoms, fetch the full SKILL.md for details.*`);
    lines.push(``);
    for (const s of medium) {
      const symptom = s.symptom || extractSection(s.content, 'Symptom');
      if (symptom) {
        lines.push(`- \`${s.id}\` — ${symptom.slice(0, 100)}${symptom.length > 100 ? '…' : ''}`);
      } else {
        lines.push(`- \`${s.id}\` — ${s.title}`);
      }
    }
    lines.push(``);
  }

  if (low.length) {
    lines.push(`## Low blast`);
    lines.push(low.map(s => `- \`${s.id}\` ${s.title}`).join('\n'));
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`[Full detail](../skills/${stack}-SKILL.md) · [Raw JSON](../../seeds/${stack}.json)`);

  const content = lines.join('\n');
  const approxTokens = tokenEst(content);
  return { content, approxTokens };
}

// ── Better llms.txt ───────────────────────────────────────────────────────────
// Structured as a semantic router for LLMs, not just a sitemap for crawlers.

function buildLlmsTxt(allStackSummaries, criticalSeeds, highSeeds) {
  const repo  = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name ?? 'Lodestone'; }
    catch { return 'Lodestone'; }
  })();
  const total = allStackSummaries.reduce((s, st) => s + st.total, 0);
  const now   = new Date().toISOString().slice(0, 10);

  const lines = [
    `# ${repo} — Lodestone`,
    `> AI-readable navigation layer · ${total} seeds · ${allStackSummaries.length} stacks · ${now}`,
    ``,
    `## What this is`,
    `A personal seed library of WRONG→CORRECT→Symptom patterns from real development work.`,
    `Seeds are structured antipattern records that prevent repeated mistakes in AI coding sessions.`,
    ``,
    `## How to use this library`,
    ``,
    `1. Read \`lodestone-nano.md\` first — it contains all critical patterns and a symptom index`,
    `2. For stack-specific work, fetch \`generated/claude-projects/{stack}-SKILL.md\``,
    `3. For full-text symptom search, use the MCP server: \`lookup_symptom("error message")\``,
    `4. For complete seed data, fetch \`seeds/{stack}.json\` and filter by \`id\``,
    ``,
    `## Symptom quick-lookup`,
    `> Match your error to a seed. Fetch the stack SKILL.md for the full pattern.`,
    ``,
  ];

  // Add top symptoms from critical and high seeds
  const lookupSeeds = [...criticalSeeds, ...highSeeds.slice(0, 30)];
  for (const s of lookupSeeds) {
    const symptom = s.symptom || extractSection(s.content, 'Symptom');
    if (!symptom) continue;
    const keywords = tokenize(symptom).slice(0, 4).join(', ');
    if (keywords) {
      lines.push(`- "${keywords}" → \`${s.id}\` [${s._stack}] [${s.blast_radius}]`);
    }
  }

  lines.push(``);
  lines.push(`## Available stack files`);
  lines.push(``);

  for (const s of allStackSummaries.sort((a, b) => b.total - a.total)) {
    const flags = [
      s.critical && `${s.critical} critical`,
      s.high     && `${s.high} high`,
    ].filter(Boolean).join(' · ');
    lines.push(`- \`generated/claude-projects/${s.stack}-SKILL.md\` — ${s.total} seeds${flags ? ` (${flags})` : ''}`);
  }

  lines.push(``);
  lines.push(`## Key files`);
  lines.push(``);
  lines.push(`| File | Purpose | When to use |`);
  lines.push(`|---|---|---|`);
  lines.push(`| \`lodestone-nano.md\` | Front door · critical seeds + symptom index | Always in context |`);
  lines.push(`| \`lodestone-meta.json\` | Lightweight index · id/title/symptom/blast per seed | MCP server indexing |`);
  lines.push(`| \`generated/claude-projects/{stack}-SKILL.md\` | Full stack skill with symptom table | Upload to Claude Project |`);
  lines.push(`| \`generated/claude-projects/{stack}-SKILL.md\` | Compressed skill (40% smaller) | Token-constrained projects |`);
  lines.push(`| \`seeds/{stack}.json\` | Complete seed data including relationships | Grafting · detailed analysis |`);
  lines.push(`| \`api/symptom-index.json\` | Reverse-index for O(1) token lookup | MCP server · browser demo |`);
  lines.push(``);
  lines.push(`## MCP tools (when server is running)`);
  lines.push(``);
  lines.push(`- \`lookup_symptom(error_text)\` — find seeds by full-text symptom search (BM25 + graph expansion)`);
  lines.push(`- \`get_seed(stack)\` — get all seeds for a stack`);
  lines.push(`- \`list_stacks()\` — list all available stacks with seed counts`);
  lines.push(`- \`generate_skill(intent)\` — generate a cross-stack contextual skill file`);
  lines.push(`- \`plan_workflow(goal)\` — compose a workflow from relevant seeds`);
  lines.push(`- \`capture_fix(...)\` — save a bug fix as a new personal seed`);
  lines.push(`- \`record_outcome(clean|regression)\` — update seed confidence scores`);

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('build-nano.mjs\n');

// Determine which stacks to process
let targetStacks;
if (CONTEXT_MODE) {
  const { detectActiveStacks } = await import('./context.mjs');
  const detected = detectActiveStacks(process.cwd());
  targetStacks = detected.map(s => s.stack);
  console.log(`Context mode — detected stacks: ${targetStacks.join(', ')}\n`);
} else if (STACKS_ARG) {
  targetStacks = STACKS_ARG;
  console.log(`Stack filter: ${targetStacks.join(', ')}\n`);
} else {
  targetStacks = loadAllStacks();
}

// Load all seeds
const allStackData = {};
for (const stack of targetStacks) {
  const seeds = loadStack(stack);
  if (seeds.length) allStackData[stack] = seeds.map(s => ({ ...s, _stack: stack }));
}

const allStackSummaries = Object.entries(allStackData).map(([stack, seeds]) => stackSummary(stack, seeds));
const allSeeds = Object.values(allStackData).flat().sort((a, b) =>
  (BLAST_RANK[a.blast_radius ?? 'medium'] ?? 2) - (BLAST_RANK[b.blast_radius ?? 'medium'] ?? 2)
);
const criticalSeeds = allSeeds.filter(s => s.blast_radius === 'critical');
const highSeeds     = allSeeds.filter(s => s.blast_radius === 'high');

console.log(`Loaded: ${allSeeds.length} seeds · ${criticalSeeds.length} critical · ${highSeeds.length} high\n`);

// 1. Nano front door
const nano        = buildNano(allStackSummaries, allSeeds);
const nanoPath    = path.join(ROOT, 'lodestone-nano.md');
fs.writeFileSync(nanoPath, nano);
const nanoTokens  = Math.ceil(nano.length / 4);
console.log(`✓ lodestone-nano.md (~${nanoTokens} tokens)  ← project instructions`);

// 1b. Critical seeds file (separate upload)
const critical        = buildCriticalFile(allSeeds);
const criticalPath    = path.join(ROOT, 'lodestone-critical.md');
fs.writeFileSync(criticalPath, critical);
const criticalTokens  = Math.ceil(critical.length / 4);
console.log(`✓ lodestone-critical.md (~${criticalTokens} tokens)  ← upload as project file`);

// Also write to claude-projects/
fs.writeFileSync(path.join(CP_DIR, 'lodestone-nano.md'), nano);
fs.writeFileSync(path.join(CP_DIR, 'lodestone-critical.md'), critical);

// 2. Claude Projects instructions
const instructions     = buildProjectInstructions(allStackSummaries,
  STACKS_ARG ?? (CONTEXT_MODE ? targetStacks : null));
const instructionsPath = path.join(CP_DIR, 'instructions.md');
fs.writeFileSync(instructionsPath, instructions);
console.log(`✓ generated/claude-projects/instructions.md`);

// 3. Compressed per-stack SKILL files
let totalCompressedTokens = 0;
let totalFullTokens       = 0;
console.log(`\nBuilding compressed SKILL files for ${Object.keys(allStackData).length} stacks...`);

for (const [stack, seeds] of Object.entries(allStackData)) {
  const { content, approxTokens } = buildCompressedSkill(stack, seeds);
  const outPath = path.join(CP_DIR, `${stack}-SKILL.md`);
  fs.writeFileSync(outPath, content);
  totalCompressedTokens += approxTokens;

  // Compare to full SKILL.md
  const fullPath = path.join(ROOT, 'generated', 'skills', `${stack}-SKILL.md`);
  if (fs.existsSync(fullPath)) {
    totalFullTokens += Math.ceil(fs.statSync(fullPath).size / 4);
  }
}

const savings = totalFullTokens
  ? Math.round((1 - totalCompressedTokens / totalFullTokens) * 100)
  : 0;

console.log(`  ✓ ${Object.keys(allStackData).length} files → generated/claude-projects/`);
console.log(`  ✓ ~${Math.round(totalCompressedTokens/1000)}K tokens total (vs ~${Math.round(totalFullTokens/1000)}K full — ${savings}% smaller)`);

// 4. Better llms.txt
const llmsTxt     = buildLlmsTxt(allStackSummaries, criticalSeeds, highSeeds);
const llmsPath    = path.join(ROOT, 'llms.txt');
const existingLlms = fs.existsSync(llmsPath) ? fs.readFileSync(llmsPath, 'utf8') : '';
// Append our navigation layer after whatever build-index.mjs wrote, or replace if it starts with the marker
if (!existingLlms.includes('## How to use this library')) {
  fs.writeFileSync(llmsPath, llmsTxt + '\n\n---\n\n' + existingLlms);
  console.log(`\n✓ llms.txt updated (navigation layer prepended)`);
} else {
  // Replace just the navigation section
  const markerEnd = existingLlms.indexOf('\n---\n\n');
  const tail      = markerEnd !== -1 ? existingLlms.slice(markerEnd) : '';
  fs.writeFileSync(llmsPath, llmsTxt + (tail || ''));
  console.log(`\n✓ llms.txt navigation layer refreshed`);
}

// Summary
console.log(`
Summary
  lodestone-nano.md            ~${nanoTokens} tokens  ← paste into Project instructions
  claude-projects/instructions.md       ← copy into Custom instructions field  
  claude-projects/{stack}-SKILL.md      ← upload relevant stacks as Project files
  llms.txt                     updated  ← semantic router for LLM navigation

For a typical 3-stack project (react + typescript + universal):
  lodestone-nano.md  +  3 compressed SKILL files  =  ~${nanoTokens + 3*Math.round(totalCompressedTokens/Object.keys(allStackData).length)} tokens total
  vs. uploading the full lodestone-meta.json:        ~200,000+ tokens
`);
