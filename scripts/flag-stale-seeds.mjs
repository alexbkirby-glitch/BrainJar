#!/usr/bin/env node
/**
 * scripts/flag-stale-seeds.mjs — Seed Dating: Stale Candidate Flagging
 *
 * Identifies seeds in volatile stacks that have not been reviewed since a
 * framework version change and writes a review queue to .lodestone/stale-review.json.
 *
 * A seed is a stale candidate when:
 *   1. Its stack appears in docs/framework-versions.json with volatile: true
 *   2. The stack has a new version in api/framework-versions-current.json
 *   3. The seed's reviewed_at field is before the framework's last version change
 *      (or reviewed_at is absent — never reviewed)
 *
 * NOT flagged: seeds in stable stacks (math, universal, go, rust, etc.)
 * NOT auto-deleted or auto-modified: flags are informational, human reviews
 *
 * Usage:
 *   node scripts/flag-stale-seeds.mjs              # check all volatile stacks
 *   node scripts/flag-stale-seeds.mjs --stack react # check one stack
 *   node scripts/flag-stale-seeds.mjs --report-only # print, don't write file
 *   npm run flag:stale
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, '..');
const SEEDS_DIR   = path.join(ROOT, 'seeds');
const CONFIG_FILE = path.join(ROOT, 'docs', 'framework-versions.json');
const VER_FILE    = path.join(ROOT, 'api', 'framework-versions-current.json');
const OUT_FILE    = path.join(ROOT, '.lodestone', 'stale-review.json');

const STACK_FILTER = (() => { const i = process.argv.indexOf('--stack'); return i >= 0 ? process.argv[i + 1] : null; })();
const REPORT_ONLY  = process.argv.includes('--report-only');

// ── Load config ────────────────────────────────────────────────────────────

const fwConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const verCurrent = fs.existsSync(VER_FILE) ? JSON.parse(fs.readFileSync(VER_FILE, 'utf8')) : {};

// Map of volatile stacks that have version data
const volatileWithVersion = new Set(
  Object.entries(fwConfig)
    .filter(([k, v]) => !k.startsWith('_') && v.volatile && verCurrent[k])
    .map(([k]) => k)
);

// ── Scan seeds ─────────────────────────────────────────────────────────────

const queue = [];
const stackFiles = fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'));

for (const fname of stackFiles) {
  const stack = fname.replace('.json', '');

  // Skip if not volatile, or not in our filter
  if (!volatileWithVersion.has(stack)) continue;
  if (STACK_FILTER && stack !== STACK_FILTER) continue;

  const verInfo    = verCurrent[stack];
  const checkedAt  = verInfo?.checked_at ? new Date(verInfo.checked_at) : null;

  let seeds;
  try { seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8')); }
  catch { continue; }

  for (const seed of seeds) {
    if (!seed.id) continue;

    const reviewedAt = seed.reviewed_at ? new Date(seed.reviewed_at) : null;

    // Stale if: never reviewed, OR reviewed before the last version check date
    const isStale = !reviewedAt || (checkedAt && reviewedAt < checkedAt);
    if (!isStale) continue;

    queue.push({
      id:              seed.id,
      stack,
      title:           seed.title ?? seed.id,
      reviewed_at:     seed.reviewed_at ?? null,
      framework:       `${stack} ${verInfo.version}`,
      version_changed: verInfo.version,
      version_at_last_review: seed.framework_version_at_review ?? null,
      doc_reference:   seed.doc_reference ?? null,
      reason:          !reviewedAt
        ? 'never reviewed'
        : `reviewed before version ${verInfo.tracked} was released`,
    });
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

const byStack = {};
for (const item of queue) {
  if (!byStack[item.stack]) byStack[item.stack] = [];
  byStack[item.stack].push(item);
}

console.error(`\n[flag-stale] Stale seed candidates: ${queue.length} across ${Object.keys(byStack).length} stacks\n`);

for (const [stack, items] of Object.entries(byStack)) {
  const ver = verCurrent[stack]?.version ?? '?';
  console.error(`  ${stack} (${ver}): ${items.length} seeds`);
  for (const item of items.slice(0, 5)) {
    const rev = item.reviewed_at ? item.reviewed_at.slice(0, 10) : 'never';
    console.error(`    - ${item.id} (last reviewed: ${rev})`);
  }
  if (items.length > 5) console.error(`    ... and ${items.length - 5} more`);
  console.error('');
}

if (!REPORT_ONLY && queue.length > 0) {
  fs.mkdirSync(path.join(ROOT, '.lodestone'), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    total:        queue.length,
    stacks:       Object.keys(byStack),
    queue,
  }, null, 2));
  console.error(`[flag-stale] Review queue written to .lodestone/stale-review.json`);
  console.error(`[flag-stale] Review seeds, update content, then set reviewed_at and framework_version_at_review.`);
  console.error(`[flag-stale] Lodestone MCP: use get_seed / capture_fix to update seeds in-session.`);
} else if (queue.length === 0) {
  console.error(`[flag-stale] All seeds in volatile stacks are up to date.`);
}
