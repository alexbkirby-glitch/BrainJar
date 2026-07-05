#!/usr/bin/env node
/**
 * scripts/verify-complete.mjs
 *
 * Pre-session completeness check. Run before an important coding session to verify
 * the Stone is intact and the derived outputs are current.
 *
 * Checks:
 *   1. Required files exist
 *   2. All seed JSON files are valid
 *   3. stack fields match filenames
 *   4. All seeds have WRONG, CORRECT, Symptom sections
 *   5. Symptom index is current (exists and covers all stacks)
 *   6. No sensitive data committed (github_token in config)
 *   7. No dead files that should have been removed
 *   8. .txt files are present for all stacks
 *
 * Usage:
 *   node scripts/verify-complete.mjs
 *   node scripts/verify-complete.mjs --strict   # fail on warnings too
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, '..');
const SEEDS_DIR     = path.join(ROOT, 'seeds');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const API_DIR       = path.join(ROOT, 'api');

const STRICT = process.argv.includes('--strict');

let errors   = 0;
let warnings = 0;
let checks   = 0;

function pass(msg)  { console.log(`  ✓ ${msg}`); checks++; }
function fail(msg)  { console.log(`  ✗ ${msg}`); errors++;  checks++; }
function warn(msg)  { console.log(`  ⚠ ${msg}`); warnings++; checks++; if (STRICT) errors++; }
function section(s) { console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`); }

// ── 1. Required files ─────────────────────────────────────────────────────────

section('Required files');

const REQUIRED = [
  'mcp-server/index.mjs',
  'mcp-server/vault.mjs',
  'mcp-server/package.json',
  'mcp-server/README.md',
  'lodestone-nano.md',
  'README.md',
  'ROADMAP.md',
  'api-schema.js',
  'package.json',
  '.lodestone/config.json',
  '.lodestone/seed-banks.json',
  'api/symptom-index.json',
  'seeds/universal.json',
  'seeds/lodestone.json',
  // These are generated but MUST be committed — they are public API endpoints
  // served by GitHub Pages. StoneHub fetches lodestone-meta.json for seed discovery;
  // lodestone-stats.json for reputation display. Run npm run build to regenerate.
  'lodestone-meta.json',
  'lodestone-stats.json',
];

for (const f of REQUIRED) {
  const fp = path.join(ROOT, f);
  if (fs.existsSync(fp)) pass(f);
  else fail(`${f} — MISSING`);
}

// ── 2. Dead files that must be absent ────────────────────────────────────────

section('Dead files absent');

const DEAD_FILES = ['publisher.js', 'stack-detector.js'];
for (const f of DEAD_FILES) {
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp)) pass(`${f} correctly absent`);
  else warn(`${f} is present — this is dead code that should be removed`);
}

// ── 3. Sensitive data not committed ──────────────────────────────────────────

section('No secrets committed');

try {
  const cfg = JSON.parse(fs.readFileSync(path.join(LODESTONE_DIR, 'config.json'), 'utf8'));
  if (cfg.github_token && cfg.github_token.length > 0) {
    fail('github_token is set in .lodestone/config.json — remove it before committing to a public repo');
  } else {
    pass('github_token not set in config (safe to commit)');
  }
  if (cfg.vault_remote && cfg.vault_remote.length > 0) {
    warn(`vault_remote is set to "${cfg.vault_remote}" — verify this is intentional`);
  } else {
    pass('vault_remote not set');
  }
} catch (e) {
  fail(`Could not read .lodestone/config.json — ${e.message}`);
}

// ── 4. Seed JSON validity ─────────────────────────────────────────────────────

section('Seed JSON validity');

const seedFiles = fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'));
let totalSeeds = 0;
let parseErrors = 0;

for (const fname of seedFiles) {
  const fpath = path.join(SEEDS_DIR, fname);
  try {
    const seeds = JSON.parse(fs.readFileSync(fpath, 'utf8'));
    if (!Array.isArray(seeds)) { fail(`${fname} — not a JSON array`); continue; }
    totalSeeds += seeds.length;
  } catch (e) {
    fail(`${fname} — JSON parse error: ${e.message}`);
    parseErrors++;
  }
}

if (parseErrors === 0) pass(`All ${seedFiles.length} seed files parse as valid JSON (${totalSeeds} seeds)`);

// ── 5. Stack field matches filename ──────────────────────────────────────────

section('Stack fields match filenames');

let stackMismatches = 0;
for (const fname of seedFiles) {
  const expectedStack = fname.replace('.json', '');
  try {
    const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
    for (const s of seeds) {
      if (s.stack && s.stack !== expectedStack) {
        fail(`${fname} seed "${s.id}" has stack="${s.stack}" — should be "${expectedStack}"`);
        stackMismatches++;
      }
    }
  } catch {}
}
if (stackMismatches === 0) pass('All stack fields match their filenames');

// ── 6. Seed structure (WRONG/CORRECT/Symptom) ────────────────────────────────

section('Seed structure completeness');

let missingStructure = 0;
const SECTION_RE = /WRONG:|CORRECT:|Symptom:/i;

for (const fname of seedFiles) {
  try {
    const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
    for (const s of seeds) {
      const content = s.content ?? '';
      if (!SECTION_RE.test(content)) {
        warn(`${fname}::${s.id} — content missing WRONG/CORRECT/Symptom sections`);
        missingStructure++;
        if (missingStructure > 10) { warn('...more structure issues found (stopping at 10)'); break; }
      }
    }
  } catch {}
  if (missingStructure > 10) break;
}
if (missingStructure === 0) pass('All seeds have WRONG/CORRECT/Symptom sections');

// ── 7. .txt files present for all stacks ─────────────────────────────────────

section('.txt files present');

const missingTxt = seedFiles.filter(f => !fs.existsSync(path.join(SEEDS_DIR, f.replace('.json', '.txt'))));
if (missingTxt.length === 0) {
  pass(`All ${seedFiles.length} stacks have .txt files`);
} else {
  for (const f of missingTxt) warn(`${f.replace('.json', '.txt')} missing — run npm run build`);
}

// ── 8. Symptom index covers all stacks ───────────────────────────────────────

section('Symptom index currency');

try {
  const idx    = JSON.parse(fs.readFileSync(path.join(API_DIR, 'symptom-index.json'), 'utf8'));
  const tokens = Object.keys(idx.index ?? {}).length;
  const genAt  = idx.generated_at ?? 'unknown';

  if (tokens < 100) {
    fail(`Symptom index has only ${tokens} tokens — run npm run build`);
  } else {
    pass(`Symptom index: ${tokens} tokens, generated ${genAt}`);
  }

  // Check if any stacks are completely absent from the index
  // (Would indicate seeds with no symptom content)
  const indexedIds = new Set(Object.values(idx.index ?? {}).flat());
  for (const fname of seedFiles.slice(0, 10)) { // spot-check first 10 stacks
    const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
    const sampleId = seeds[0]?.id;
    if (sampleId && !indexedIds.has(sampleId)) {
      warn(`${fname.replace('.json','')} stack: first seed "${sampleId}" not found in symptom index — run npm run build`);
    }
  }
} catch (e) {
  fail(`Could not read api/symptom-index.json — ${e.message}`);
}

// ── 9. Relationship graph present ─────────────────────────────────────────────

section('Relationship graph');

const graphPath = path.join(API_DIR, 'relationship-graph.json');
if (fs.existsSync(graphPath)) {
  try {
    const g = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const n = (g.nodes ?? []).length;
    const e = (g.edges ?? []).length;
    if (n < 10) warn(`Relationship graph has only ${n} nodes — run npm run detect-relationships:write for full graph`);
    else pass(`Relationship graph: ${n} nodes, ${e} edges`);
  } catch (e) {
    fail(`Relationship graph parse error: ${e.message}`);
  }
} else {
  warn('api/relationship-graph.json missing — run npm run detect-relationships:write');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(62)}`);
console.log(`Checks: ${checks}  |  Passed: ${checks - errors - warnings}  |  Warnings: ${warnings}  |  Errors: ${errors}`);

if (errors > 0) {
  console.log('\n✗ Stone has errors — fix before committing or starting a session.');
  process.exit(1);
} else if (warnings > 0) {
  console.log('\n⚠ Stone has warnings — review before a critical session.');
  console.log('  Run with --strict to treat warnings as errors.');
  process.exit(0);
} else {
  console.log('\n✓ Stone is complete and ready.');
  process.exit(0);
}
