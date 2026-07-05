/**
 * mcp-server/tools.mjs — Brain Jar tool implementations (Chunk E)
 *
 * The nine surviving tools' logic, separated from MCP registration
 * (index.mjs) so each handler is directly importable/testable and so
 * Chunk H gets a clean seam between "live Brain Jar" and the legacy
 * 44-tool monolith (index.legacy.mjs, untouched).
 *
 * Surviving surface (grill-session Chunk E, amended 2026-07-04):
 *   Supply side — capture_seed, capture_fix, publish, list_jars, graze,
 *                 validate_schema
 *   Demand side — get_seed, list_stacks, lookup_symptom (BM25-lite; the
 *                 embedding/SPLADE/RAPTOR stack is NOT loaded here — that
 *                 pipeline's fate is Chunk H's open question, and a
 *                 consuming brain's own retrieval serves imported seeds)
 *
 * capture_fix is ported from index.legacy.mjs verbatim where possible,
 * including its Chunk-0-retrofit privacy gate — per Section 0's ruling
 * that capture_fix (in-session reflex → personal-patterns.json, enriched
 * later) and capture_seed (full-schema authoring → seeds/personal/
 * captured.json) are different jobs, not duplicates.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { captureSeed } from '../lib/capture-seed.mjs';
import { structuralLint, SCHEMA_VERSION, VALID_BLAST_LEVELS } from '../lib/seed-schema.mjs';
import { privacyLint as privacyLintSeed } from '../lib/privacy-lint.mjs';
import { validateManifest, MANIFEST_FILENAME } from '../lib/manifest.mjs';
import { discoverPublicJars, fetchAndValidateManifest, DEFAULT_TOPIC } from '../lib/discover-jars.mjs';
import { resolveJarRoot, resolvePkgRoot } from '../lib/jar-root.mjs';
import { privacyLint as privacyLintChunk, formatPrivacyWarning } from './privacy-lint.mjs';

// Two roots (see lib/jar-root.mjs): PKG_ROOT locates sibling scripts to
// spawn; ROOT (the JAR root) locates the user's data. They coincide in a
// repo checkout and diverge under `npx brain-jar-mcp`.
const PKG_ROOT = resolvePkgRoot(import.meta.url);
export const ROOT = resolveJarRoot(import.meta.url);
const SEEDS_DIR = path.join(ROOT, 'seeds');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const PERSONAL_FILE = path.join(LODESTONE_DIR, 'personal-patterns.json');
const STAGING_FILE = path.join(SEEDS_DIR, 'personal', 'captured.json');
const REVIEW_QUEUE = path.join(LODESTONE_DIR, 'graze-review-queue.md');

// ── Tokenizer (shared) ────────────────────────────────────────────────────────
// Same tokenizer as graze.mjs / review-graze.mjs / index.legacy.mjs —
// fourth call site now, still deliberately not forked into variants.

const STOPWORDS = new Set([
  'the','and','for','not','with','this','that','from','are','was','but',
  'all','can','its','has','have','when','been','does','did','will','would',
  'could','should','than','then','into','over','after','out','due','per',
  'via','any','each','even','also','may','use','used','set','just','let',
]);

export function tokenize(str) {
  return String(str ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// ── Local corpus loading ──────────────────────────────────────────────────────

export function loadLocalSeeds(stack) {
  const fp = path.join(SEEDS_DIR, `${stack}.json`);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

export function listLocalStacks() {
  try {
    return fs.readdirSync(SEEDS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const stack = f.replace('.json', '');
        const chunks = loadLocalSeeds(stack) ?? [];
        const tags = [...new Set(chunks.flatMap((c) => c.tags ?? []))].slice(0, 5);
        return { stack, chunks: chunks.length, top_tags: tags };
      });
  } catch { return []; }
}

export function loadPersonalPatterns() {
  try {
    if (fs.existsSync(PERSONAL_FILE)) return JSON.parse(fs.readFileSync(PERSONAL_FILE, 'utf8'));
  } catch (_) {}
  return [];
}

function savePersonalPatterns(patterns) {
  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  fs.writeFileSync(PERSONAL_FILE, JSON.stringify(patterns, null, 2));
}

// ── BM25-lite symptom index ───────────────────────────────────────────────────
// Deliberately shallow: token-set + tag scoring over the raw corpus, same
// transparent math family as graze.mjs's scoreCandidate. No embeddings, no
// SPLADE, no RRF — a consuming brain's own retrieval is the deep path.

let _index = null;

function bustIndex() { _index = null; }

function buildIndex() {
  if (_index) return _index;
  const docs = [];
  for (const { stack } of listLocalStacks()) {
    for (const seed of loadLocalSeeds(stack) ?? []) {
      docs.push({
        stack,
        seed,
        tokens: new Set(tokenize(`${seed.wrong ?? ''} ${seed.correct ?? ''} ${seed.content ?? ''} ${seed.symptom ?? ''} ${seed.title ?? ''}`)),
        tags: new Set((seed.tags ?? []).map((t) => String(t).toLowerCase())),
      });
    }
  }
  for (const seed of loadPersonalPatterns()) {
    docs.push({
      stack: '_personal',
      seed,
      tokens: new Set(tokenize(`${seed.wrong ?? ''} ${seed.correct ?? ''} ${seed.content ?? ''} ${seed.title ?? ''}`)),
      tags: new Set((seed.tags ?? []).map((t) => String(t).toLowerCase())),
    });
  }
  // Document frequency for IDF-ish downweighting of ubiquitous tokens.
  const df = Object.create(null);
  for (const d of docs) for (const t of d.tokens) df[t] = (df[t] ?? 0) + 1;
  _index = { docs, df, n: docs.length };
  return _index;
}

/**
 * lookup_symptom (lite). Score = sum over matched query tokens of
 * idf(token), normalized by total query idf mass, + 0.5 bonus per exact
 * tag hit (tags are curated signal — same weighting philosophy as
 * graze.mjs's 0.6 tag / 0.4 token split).
 */
export function lookupSymptom(errorText, { limit = 5, stack = null } = {}) {
  const { docs, df, n } = buildIndex();
  if (n === 0) return { query: errorText, results: [], note: 'no seeds found in local corpus' };

  const qTokens = [...new Set(tokenize(errorText))];
  if (qTokens.length === 0) return { query: errorText, results: [], note: 'query produced no usable tokens' };

  const idf = (t) => Math.log(1 + n / (1 + (df[t] ?? 0)));
  const qMass = qTokens.reduce((s, t) => s + idf(t), 0) || 1;

  const scored = [];
  for (const d of docs) {
    if (stack && d.stack !== stack) continue;
    let s = 0;
    let tagHits = 0;
    for (const t of qTokens) {
      if (d.tokens.has(t)) s += idf(t);
      if (d.tags.has(t)) tagHits += 1;
    }
    const score = s / qMass + 0.5 * Math.min(tagHits, 4) / 4;
    if (score > 0.05) scored.push({ score, d, tagHits });
  }
  scored.sort((a, b) => b.score - a.score);

  return {
    query: errorText,
    engine: 'bm25-lite (token idf + tag overlap — no embedding stack loaded)',
    results: scored.slice(0, limit).map(({ score, d, tagHits }) => ({
      score: Number(score.toFixed(3)),
      stack: d.stack,
      id: d.seed.id,
      title: d.seed.title ?? d.seed.id,
      wrong: d.seed.wrong ?? null,
      correct: d.seed.correct ?? null,
      symptom: d.seed.symptom ?? ((d.seed.content ?? '').split('Symptom:')[1]?.trim() || null),
      blast_radius: d.seed.blast_radius ?? null,
      tag_hits: tagHits,
    })),
  };
}

// ── get_seed / list_stacks (local-only ports from index.legacy.mjs) ──────────
// REMOTE mode (LODESTONE_REMOTE_URL) deliberately dropped: a library serves
// its own shelf; cross-Jar reads are graze's job, not a live fetch path.

export function getSeed(stack, format = 'text') {
  const chunks = loadLocalSeeds(stack);
  if (!chunks) return { error: `No seed file found for stack "${stack}" in local seeds/` };
  if (format === 'json') return { stack, format: 'json', chunks, count: chunks.length };
  const text = chunks.map((c) =>
    `### ${c.title}\nWRONG: ${c.wrong ?? ''}\nCORRECT: ${c.correct ?? ''}\nSymptom: ${c.symptom ?? ((c.content ?? '').split('Symptom:')[1]?.trim() ?? '')}`
  ).join('\n\n---\n\n');
  return { stack, format: 'text', content: text };
}

export function listStacks(query) {
  let stacks = listLocalStacks();
  if (query) {
    const q = query.toLowerCase();
    stacks = stacks.filter((s) => s.stack.includes(q) || (s.top_tags ?? []).some((t) => t.includes(q)));
  }
  const personal = loadPersonalPatterns();
  if (personal.length > 0) {
    stacks.push({ stack: '_personal', chunks: personal.length, top_tags: ['personal', 'captured'] });
  }
  return { mode: 'local', total: stacks.length, stacks };
}

// ── capture_seed (Chunk 0 wiring — the wrapper sketched in lib/capture-seed.mjs) ──

export async function captureSeedTool(input) {
  const result = await captureSeed(input, { stagingPath: STAGING_FILE });
  bustIndex();
  return result;
}

// ── capture_fix (ported from index.legacy.mjs, privacy gate intact) ──────────

export async function captureFix({ stack, error_observed, wrong_approach, correct_approach,
                                   blast_radius, file_path, tags, title, doc_reference, force = false }) {
  const rawTitle = title ?? `${stack ?? 'unknown'}: ${error_observed.slice(0, 40)}`;
  const id = rawTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
  const tagList = tags ?? tokenize(error_observed).slice(0, 4);
  const resolvedBlast = blast_radius ?? 'medium';

  const chunk = {
    id,
    title: rawTitle,
    content: `WRONG: ${wrong_approach} CORRECT: ${correct_approach} Symptom: ${error_observed}`,
    wrong: wrong_approach,
    correct: correct_approach,
    tags: tagList,
    source: 'personal',
    stack: stack ?? undefined,
    blast_radius: resolvedBlast,
    verification_status: 'unverified',
    captured_at: new Date().toISOString(),
    reviewed_at: new Date().toISOString(), // seed dating: mark as reviewed at creation
    project: process.cwd(),
    ...(doc_reference ? { doc_reference } : {}),
  };

  // ── Duplicate detection (token-overlap, write-time) ────────────────────────
  const newTokenSet = new Set(tokenize(`${wrong_approach} ${correct_approach} ${error_observed}`));

  function jaccardScore(seedA) {
    if (seedA.id === id) return 0;
    const otherTokens = new Set(tokenize(
      `${seedA.wrong ?? ''} ${seedA.correct ?? ''} ${seedA.content ?? ''}`
    ));
    const intersection = [...newTokenSet].filter((t) => otherTokens.has(t)).length;
    const union = new Set([...newTokenSet, ...otherTokens]).size;
    return union > 0 ? intersection / union : 0;
  }

  if (!force) {
    const DUP_THRESHOLD = 0.45;
    const personalPool = loadPersonalPatterns();
    const stackPool = stack ? (loadLocalSeeds(stack) ?? []) : [];
    const allPool = [...personalPool, ...stackPool];
    let nearDup = null;
    let nearDupScore = 0;
    for (const candidate of allPool) {
      const score = jaccardScore(candidate);
      if (score >= DUP_THRESHOLD && score > nearDupScore) {
        nearDup = candidate;
        nearDupScore = score;
      }
    }

    if (nearDup) {
      return {
        captured: false,
        duplicate_detected: true,
        similarity_score: Math.round(nearDupScore * 100),
        similar_seed: {
          id: nearDup.id,
          title: nearDup.title,
          wrong: nearDup.wrong ?? null,
          correct: nearDup.correct ?? null,
          stack: nearDup.stack ?? null,
        },
        suggestion:
          `This seed is ${Math.round(nearDupScore * 100)}% similar to existing seed ` +
          `"${nearDup.id}". Consider refining that seed instead of creating a duplicate.`,
        model_instruction:
          `A near-duplicate seed was detected (${Math.round(nearDupScore * 100)}% token overlap). ` +
          `Show the user the existing seed title and wrong/correct fields, then ask:\n` +
          `  1. Refine the existing seed (call capture_fix with the existing id)\n` +
          `  2. Capture as a new seed anyway (re-call capture_fix with force=true)\n` +
          `  3. Cancel — the existing seed is sufficient`,
      };
    }
  }

  // ── Seed quality scoring — advisory, does not block capture ────────────────
  const qualityIssues = [];
  const symptomTokens = tokenize(error_observed ?? '');
  if (symptomTokens.length < 4)
    qualityIssues.push({ dim: 'symptom_specificity', score: 0, note: 'Symptom is very short — add the specific error message or observable output' });
  const wrongLen = (wrong_approach ?? '').length;
  const rightLen = (correct_approach ?? '').length;
  if (wrongLen < 10)
    qualityIssues.push({ dim: 'wrong_specificity', score: 0, note: 'WRONG section is very short — show the specific incorrect code or pattern' });
  if (rightLen < 10)
    qualityIssues.push({ dim: 'correct_completeness', score: 0, note: 'CORRECT section is very short — add enough detail to apply without further research' });
  const totalLen = wrongLen + rightLen + (error_observed ?? '').length;
  if (totalLen > 700)
    qualityIssues.push({ dim: 'content_length', score: 1, note: `Total content is ${totalLen} chars — consider splitting into multiple seeds to avoid BM25 dilution` });
  if (!tags?.length)
    qualityIssues.push({ dim: 'tag_count', score: 0, note: 'No tags — add 3-6 search terms matching what a developer would type when hitting this error' });
  else if (tags.length > 8)
    qualityIssues.push({ dim: 'tag_count', score: 1, note: `${tags.length} tags — trim to 3-6 most specific retrieval terms` });
  const qualityScore = Math.max(0, 10 - qualityIssues.filter((q) => q.score === 0).length * 2 - qualityIssues.filter((q) => q.score === 1).length);

  bustIndex(); // next lookup_symptom picks up the new seed

  const patterns = loadPersonalPatterns();
  const existing = patterns.findIndex((p) => p.id === id);
  if (existing >= 0) patterns[existing] = chunk;
  else patterns.push(chunk);
  savePersonalPatterns(patterns);

  const { captured_at, project, source, verification_status, ...communityChunk } = chunk;
  const communityChunkJson = JSON.stringify({
    ...communityChunk, source: 'community', verification_status: 'unverified',
  }, null, 2);

  // ── Privacy lint (Chunk 0 retrofit) — gates ONLY the community-upload path ──
  const privacyResult = privacyLintChunk({ ...communityChunk, source: 'community' });
  const uploadBlocked = privacyResult.blocking;

  return {
    captured: true,
    chunk_id: id,
    saved_to_personal: true,
    personal_seed_location: PERSONAL_FILE,
    quality_score: qualityScore,
    quality_issues: qualityIssues.length ? qualityIssues : undefined,
    quality_note: qualityScore >= 8 ? '✓ Good seed quality'
      : qualityScore >= 5 ? '⚠ Acceptable — review the flagged dimensions'
      : '↓ Needs improvement before promoting to a stack file',
    pattern: { id, title: rawTitle, wrong: wrong_approach, correct: correct_approach, symptom: error_observed, blast_radius: resolvedBlast, stack },
    privacy_check: uploadBlocked ? { ok: false, findings: privacyResult.findings } : { ok: true },
    actions: {
      upload: uploadBlocked ? {
        description: 'BLOCKED — this seed looks like it contains PII or secrets',
        warning: formatPrivacyWarning(privacyResult),
        chunk_json: null,
      } : {
        description: 'Share this seed with the Brain Jar community (creates a GitHub issue)',
        note: 'Set GITHUB_TOKEN env var to enable one-click upload, or open the manual URL',
        chunk_json: communityChunkJson,
      },
      implement: {
        description: file_path ? `Apply the fix to ${file_path}` : 'Apply the fix to the relevant file',
        file_path: file_path ?? null,
        correct_approach,
        instruction_for_model: file_path
          ? `Read ${file_path}, find the code matching WRONG (${wrong_approach}), replace with CORRECT (${correct_approach}). Confirm before writing.`
          : `Find the file containing WRONG (${wrong_approach}) and replace with CORRECT (${correct_approach}). Confirm with the user first.`,
      },
      neither: {
        description: 'Saved locally. Access later with: node scripts/manage-personal.mjs list',
        promote_later: `node scripts/manage-personal.mjs promote ${id}`,
      },
    },
    model_instruction: uploadBlocked
      ? `Bug fix captured as personal seed "${id}" in personal-patterns.json.\n\n` +
        `⚠ Privacy check FAILED — do NOT offer to upload this seed as-is. Tell the user what was ` +
        `flagged (see privacy_check.findings / actions.upload.warning) and ask them to either edit ` +
        `the fields directly in personal-patterns.json, or re-capture with the sensitive details removed.\n\n` +
        `Implement and Neither are still safe to offer.`
      : `Bug fix captured as personal seed "${id}" in personal-patterns.json.\n\n` +
        `Ask the user what to do next:\n` +
        `  1. Upload — share with the Brain Jar community\n` +
        `  2. Implement — apply the fix to the code${file_path ? ` (${file_path})` : ''}\n` +
        `  3. Both\n` +
        `  4. Neither — keep locally only (already saved)\n\n` +
        `Then execute the chosen action using actions.{upload,implement,neither} instructions.`,
  };
}

// ── validate_schema ───────────────────────────────────────────────────────────

/**
 * mode 'seed'     — structural + privacy lint one seed object (or array).
 * mode 'manifest' — validate this Jar's brain-jar-manifest.json on disk.
 */
export function validateSchema({ seed = null, seeds = null, mode = 'seed' } = {}) {
  if (mode === 'manifest') {
    const mp = path.join(ROOT, MANIFEST_FILENAME);
    if (!fs.existsSync(mp)) {
      return { mode, ok: false, error: `${MANIFEST_FILENAME} not found at Jar root — run the publish tool (or scripts/generate-manifest.mjs) to create it` };
    }
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(mp, 'utf8')); }
    catch (e) { return { mode, ok: false, error: `manifest is not valid JSON: ${e.message}` }; }
    const { ok, errors } = validateManifest(manifest);
    return { mode, ok, errors: ok ? undefined : errors, manifest: ok ? manifest : undefined, schema_version_current: SCHEMA_VERSION };
  }

  const batch = seeds ?? (seed ? [seed] : []);
  if (batch.length === 0) return { mode, ok: false, error: 'no seed(s) provided' };
  const results = batch.map((s) => {
    const structural = structuralLint(s);
    const privacy = privacyLintSeed(s);
    return {
      id: s?.id ?? null,
      ok: structural.ok && !privacy.blocking,
      structural,
      privacy: { blocking: privacy.blocking, findings: privacy.findings },
    };
  });
  return {
    mode,
    schema_version: SCHEMA_VERSION,
    valid_blast_levels: VALID_BLAST_LEVELS,
    ok: results.every((r) => r.ok),
    results,
  };
}

// ── list_jars (discovery only — the read half of graze) ─────────────────────

export async function listJars({ topic = DEFAULT_TOPIC, maxJars = 20 } = {}) {
  const jars = await discoverPublicJars(topic, maxJars);
  if (jars.length === 0) {
    return {
      topic,
      jars: [],
      note: `No repos tagged "${topic}" found — cold-start is expected until Jar owners start tagging. ` +
            `Tagging a repo with this topic IS the consent act for discovery + grazing.`,
    };
  }
  const results = [];
  for (const jar of jars) {
    const { manifest, skip } = await fetchAndValidateManifest(jar);
    results.push(skip
      ? { owner: jar.owner, repo: jar.repo, valid: false, skip }
      : {
          owner: jar.owner, repo: jar.repo, valid: true,
          jar_name: manifest.jar_name, seed_count: manifest.seed_count,
          stacks: manifest.stacks, last_updated: manifest.last_updated,
          schema_version: manifest.schema_version,
        });
  }
  return { topic, jars: results };
}

// ── publish / graze — thin wrappers over the offline scripts ─────────────────
// Decision 2 (grazing is offline batch) survives: these tools TRIGGER the
// batch scripts on explicit request; nothing here runs during injection.

function runScript(script, args = [], timeoutMs = 120_000) {
  return new Promise((resolve) => {
    // Script code lives in the PACKAGE; the data it operates on lives in the
    // JAR — handed over via BRAIN_JAR_ROOT (resolution order rule 1).
    const child = spawn(process.execPath, [path.join(PKG_ROOT, 'scripts', script), ...args], {
      cwd: ROOT,
      env: { ...process.env, BRAIN_JAR_ROOT: ROOT },
      timeout: timeoutMs,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ script, args, code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', (e) => resolve({ script, args, code: -1, stdout: '', stderr: e.message }));
  });
}

export async function publish({ check = false, jarName = null, force = false } = {}) {
  const args = [];
  if (check) args.push('--check');
  if (force) args.push('--force');
  if (jarName) args.push(`--jar-name=${jarName}`);
  const run = await runScript('generate-manifest.mjs', args);
  return {
    ...run,
    ok: run.code === 0,
    next_steps: run.code !== 0
      ? 'Privacy or structural violations blocked the manifest — fix the seeds listed above. --force exists but is NOT recommended for anything you intend to tag public.'
      : check
        ? 'Manifest validates. Run publish without check to write it.'
        : `Manifest written. To make this a Public Jar: commit ${MANIFEST_FILENAME}, push, and add the GitHub topic "${DEFAULT_TOPIC}" to the repo — tagging IS the consent act for discovery + grazing.`,
  };
}

export async function graze({ topic = null, maxJars = null, profile = null, localFixture = null, dupThreshold = null } = {}) {
  const grazeArgs = [];
  if (topic) grazeArgs.push(`--topic=${topic}`);
  if (maxJars) grazeArgs.push(`--max-jars=${maxJars}`);
  if (profile) grazeArgs.push(`--profile=${profile}`);
  if (localFixture) grazeArgs.push(`--local-fixture=${localFixture}`);
  const grazeRun = await runScript('graze.mjs', grazeArgs, 300_000);

  if (grazeRun.code !== 0) {
    return { ok: false, graze: grazeRun, note: 'Graze failed — review queue not generated.' };
  }

  const reviewArgs = [];
  if (dupThreshold) reviewArgs.push(`--dup-threshold=${dupThreshold}`);
  const reviewRun = await runScript('review-graze.mjs', reviewArgs);

  return {
    ok: reviewRun.code === 0,
    graze: grazeRun,
    review: reviewRun,
    review_queue: fs.existsSync(REVIEW_QUEUE) ? REVIEW_QUEUE : null,
    note: 'Candidates are STAGED only — nothing auto-merges. Read the review queue and graft by hand (human decision, by design).',
  };
}
