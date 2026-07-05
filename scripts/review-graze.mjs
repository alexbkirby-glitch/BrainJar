#!/usr/bin/env node
/**
 * scripts/review-graze.mjs — Chunk D: review queue / surfacing
 *
 * Reads Chunk C's staged candidates (.lodestone/graze-staged.json) and
 * produces a human-readable review queue. Per grill-session decision 9:
 * provenance surfacing + structural lint + duplicate flagging, using
 * EXISTING scoring math pointed in a new direction — no new capability
 * required, no reputation/trust system (that's what StoneHub/build-stats.mjs
 * had, and it's being cut, see Chunk H).
 *
 * Duplicate detection reuses the EXACT Jaccard formula and 0.45 threshold
 * already live in mcp-server/index.mjs's captureFix() near-duplicate
 * check — same tokenizer, same math, run "inward" against the real local
 * corpus instead of against other personal captures. Consistency over
 * reinventing a second similarity metric.
 *
 * This produces a REPORT ONLY. Nothing here merges a candidate into
 * seeds/<stack>.json — that's a human decision (and an unbuilt "graft"
 * action; the old vault.mjs's graftExternal() is NOT reused, since it's
 * part of the subsystem being archived in Chunk H and had its own
 * path-traversal history).
 *
 * Usage:
 *   node scripts/review-graze.mjs                       # read the default staged file, print + write report
 *   node scripts/review-graze.mjs --input=<path>          # use a different staged-candidates file
 *   node scripts/review-graze.mjs --dup-threshold=0.45     # override the duplicate-flag threshold
 *   node scripts/review-graze.mjs --output=<path>          # override the markdown report path
 *
 * Output: both a console summary (quick glance) and a markdown file
 * (persistent, git-friendly, matches the project's WIKI.md/MANIFEST.md
 * convention) — resolves the original chunk spec's open question of
 * "CLI, markdown, or web view, not yet decided."
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveJarRoot } from '../lib/jar-root.mjs';

const ROOT = resolveJarRoot(import.meta.url);
const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const DEFAULT_INPUT = path.join(LODESTONE_DIR, 'graze-staged.json');
const DEFAULT_OUTPUT = path.join(LODESTONE_DIR, 'graze-review-queue.md');
const DEFAULT_DUP_THRESHOLD = 0.45; // matches captureFix()'s DUP_THRESHOLD exactly

// Same tokenizer as mcp-server/index.mjs and scripts/graze.mjs — third
// call site now, still the same STOPWORDS/logic, deliberately not forked.
const STOPWORDS = new Set([
  'the','and','for','not','with','this','that','from','are','was','but',
  'all','can','its','has','have','when','been','does','did','will','would',
  'could','should','than','then','into','over','after','out','due','per',
  'via','any','each','even','also','may','use','used','set','just','let',
]);
function tokenize(str) {
  return String(str ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

const args = process.argv.slice(2);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

/** Same formula as captureFix()'s jaccardScore, generalized to any two seed-shaped objects. */
function jaccardScore(seedA, seedB) {
  const tokensA = new Set(tokenize(`${seedA.wrong ?? ''} ${seedA.correct ?? ''} ${seedA.content ?? ''} ${seedA.symptom ?? ''}`));
  const tokensB = new Set(tokenize(`${seedB.wrong ?? ''} ${seedB.correct ?? ''} ${seedB.content ?? ''} ${seedB.symptom ?? ''}`));
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

/** Loads the local corpus for one stack — the "run inward" side of duplicate detection. */
function loadLocalStackSeeds(stack) {
  const seedPath = path.join(ROOT, 'seeds', `${stack}.json`);
  if (!fs.existsSync(seedPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Finds the most similar local seed in the same stack, if any exceed the threshold. */
function findNearestDuplicate(candidate, threshold) {
  const localSeeds = loadLocalStackSeeds(candidate.stack);
  let best = null;
  let bestScore = 0;
  for (const local of localSeeds) {
    if (local.id === candidate.id) continue;
    const score = jaccardScore(candidate, local);
    if (score > bestScore) {
      bestScore = score;
      best = local;
    }
  }
  return bestScore >= threshold ? { id: best.id, title: best.title || best.id, score: bestScore } : null;
}

function formatGrazedFrom(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return '(direct capture, no prior graze history)';
  return chain.map((hop) => `${hop.jar} (${hop.grazed_at})`).join(' → ');
}

function reviewCandidate(staged, dupThreshold) {
  const { seed, score, source_jar, source_manifest, structural_ok, structural_errors } = staged;
  const duplicate = findNearestDuplicate(seed, dupThreshold);

  const flags = [];
  if (!structural_ok) flags.push('structural');
  if (duplicate) flags.push('duplicate');

  let recommendation;
  if (flags.length === 0) {
    recommendation = '✓ Clean — safe to review for grafting';
  } else if (flags.includes('structural') && flags.includes('duplicate')) {
    recommendation = `⚠ Structural issues AND likely duplicate of "${duplicate.id}" (${Math.round(duplicate.score * 100)}% overlap) — fix or discard`;
  } else if (flags.includes('structural')) {
    recommendation = '⚠ Structural issues — fix before grafting';
  } else {
    recommendation = `⚠ Likely duplicate of "${duplicate.id}" (${Math.round(duplicate.score * 100)}% overlap) — consider refining that seed instead`;
  }

  return {
    id: seed.id,
    title: seed.title || seed.wrong?.slice(0, 60) || seed.id,
    score,
    source_jar,
    source_manifest,
    grazed_from: formatGrazedFrom(seed.grazed_from),
    structural_ok,
    structural_errors,
    duplicate,
    recommendation,
    clean: flags.length === 0,
  };
}

function renderMarkdown(reviews, inputPath) {
  const lines = [];
  lines.push('# Graze Review Queue');
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString().slice(0, 10)} from \`${path.relative(ROOT, inputPath)}\`. Nothing here has been merged — every candidate below needs a human decision._`);
  lines.push('');
  const cleanCount = reviews.filter((r) => r.clean).length;
  lines.push(`**${reviews.length} candidate(s)** — ${cleanCount} clean, ${reviews.length - cleanCount} flagged for review.`);
  lines.push('');

  for (const r of reviews) {
    lines.push(`## ${r.id}`);
    lines.push('');
    lines.push(`**${r.title}**`);
    lines.push('');
    lines.push(`- Relevance score: ${r.score.toFixed(2)}`);
    lines.push(`- Source: \`${r.source_jar}\` (${r.source_manifest.jar_name}, ${r.source_manifest.seed_count} seeds, last updated ${r.source_manifest.last_updated})`);
    lines.push(`- Grazed via: ${r.grazed_from}`);
    lines.push(`- Structural lint: ${r.structural_ok ? '✓ OK' : `✗ ${r.structural_errors.join('; ')}`}`);
    lines.push(`- Duplicate check: ${r.duplicate ? `⚠ ${Math.round(r.duplicate.score * 100)}% overlap with "${r.duplicate.id}"` : '✓ no local match ≥ threshold'}`);
    lines.push(`- **${r.recommendation}**`);
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  const inputPath = value('input') || DEFAULT_INPUT;
  const outputPath = value('output') || DEFAULT_OUTPUT;
  const dupThreshold = value('dup-threshold') ? Number(value('dup-threshold')) : DEFAULT_DUP_THRESHOLD;

  if (!fs.existsSync(inputPath)) {
    console.error(`No staged-candidates file at ${inputPath}. Run scripts/graze.mjs first.`);
    process.exit(1);
  }

  const staged = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(staged) || staged.length === 0) {
    console.log('No staged candidates to review.');
    return;
  }

  const reviews = staged.map((s) => reviewCandidate(s, dupThreshold));

  console.log(`${reviews.length} candidate(s) reviewed (duplicate threshold: ${dupThreshold}):\n`);
  for (const r of reviews) {
    console.log(`  ${r.id} [score ${r.score.toFixed(2)}] — ${r.recommendation}`);
  }

  const markdown = renderMarkdown(reviews, inputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown);
  console.log(`\nFull report written to ${outputPath}`);
}

main();
