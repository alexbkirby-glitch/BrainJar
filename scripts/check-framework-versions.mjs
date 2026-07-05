#!/usr/bin/env node
/**
 * scripts/check-framework-versions.mjs — Seed Dating: Version Monitor
 *
 * Polls npm, PyPI, and GitHub for the current versions of volatile frameworks,
 * compares against the last-known versions stored in api/framework-versions-current.json,
 * and reports which stacks have changed.
 *
 * When a version change is detected, flag-stale-seeds.mjs can be run to identify
 * seeds for that stack that have not been reviewed since the change.
 *
 * Usage:
 *   node scripts/check-framework-versions.mjs           # check and report
 *   node scripts/check-framework-versions.mjs --update  # save current versions
 *   npm run check:versions
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, '..');
const CONFIG_FILE  = path.join(ROOT, 'docs', 'framework-versions.json');
const CURRENT_FILE = path.join(ROOT, 'api', 'framework-versions-current.json');

const UPDATE = process.argv.includes('--update');

// ── Version fetchers ──────────────────────────────────────────────────────

async function fetchNpm(pkg) {
  try {
    const res  = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.version ?? null;
  } catch { return null; }
}

async function fetchPypi(pkg) {
  try {
    const res  = await fetch(`https://pypi.org/pypi/${pkg}/json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.info?.version ?? null;
  } catch { return null; }
}

async function fetchGithub(repo) {
  try {
    const res  = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : { 'User-Agent': 'lodestone-version-check' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.tag_name ?? '').replace(/^v/, '') || null;
  } catch { return null; }
}

function majorMinor(version, trackMinor) {
  if (!version) return null;
  const parts = version.split('.');
  return trackMinor ? `${parts[0]}.${parts[1]}` : parts[0];
}

// ── Load config ────────────────────────────────────────────────────────────

const config  = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const current = fs.existsSync(CURRENT_FILE)
  ? JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf8'))
  : {};

const volatile = Object.entries(config)
  .filter(([k, v]) => !k.startsWith('_') && v.volatile && v.registry)
  .map(([stack, v]) => ({ stack, ...v }));

console.error(`[check-versions] Checking ${volatile.length} volatile stacks...\n`);

// ── Fetch current versions ─────────────────────────────────────────────────

const results = [];

for (const { stack, package: pkg, registry, track_major, track_minor } of volatile) {
  let version = null;
  if      (registry === 'npm')    version = await fetchNpm(pkg);
  else if (registry === 'pypi')   version = await fetchPypi(pkg);
  else if (registry === 'github') version = await fetchGithub(pkg);

  const tracked = majorMinor(version, track_minor ?? false);
  const prev    = current[stack]?.tracked;
  const changed = prev && tracked && prev !== tracked;

  results.push({ stack, version, tracked, prev, changed });

  const status = !version   ? '⚠ fetch failed'
               : !prev       ? '• first check'
               : changed     ? `↑ ${prev} → ${tracked}`
               :               '✓ unchanged';
  console.error(`  ${stack.padEnd(20)} ${(version ?? '?').padEnd(12)} ${status}`);
}

console.error('');

// ── Report changes ─────────────────────────────────────────────────────────

const changed = results.filter(r => r.changed);
if (changed.length) {
  console.error(`[check-versions] ${changed.length} stack(s) have new versions:\n`);
  for (const r of changed) {
    console.error(`  ${r.stack}: ${r.prev} → ${r.tracked}`);
    console.error(`    Run: node scripts/flag-stale-seeds.mjs --stack ${r.stack}\n`);
  }
} else {
  console.error('[check-versions] No version changes detected.');
}

// ── Save current versions (--update flag) ─────────────────────────────────

if (UPDATE) {
  const updated = { ...current };
  for (const r of results) {
    if (r.version) {
      updated[r.stack] = {
        version:    r.version,
        tracked:    r.tracked,
        checked_at: new Date().toISOString(),
      };
    }
  }
  fs.mkdirSync(path.join(ROOT, 'api'), { recursive: true });
  fs.writeFileSync(CURRENT_FILE, JSON.stringify(updated, null, 2));
  console.error(`[check-versions] Saved to api/framework-versions-current.json`);
  console.error(`[check-versions] Commit this file to track version history over time.`);
}
