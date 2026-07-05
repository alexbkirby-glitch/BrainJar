#!/usr/bin/env node
/**
 * scripts/manage-personal.mjs — Personal Pattern Management
 *
 * The CLI capture_fix's own tool output has been promising since before
 * this file existed: `promote_later: node scripts/manage-personal.mjs
 * promote ${id}` and `Access later with: node scripts/manage-personal.mjs
 * list`. Neither command existed anywhere in the repo — a broken promise
 * shipped in a live tool. This is that script.
 *
 * `promote` reuses the exact strip/rebuild transform captureFix() already
 * does inline for its `actions.upload.chunk_json` (drop captured_at/
 * project/source/verification_status, rebuild source:'community',
 * verification_status:'unverified') and runs the same privacy-lint gate
 * added to captureFix() in this pass — nothing here should be MORE
 * permissive than the in-session upload path, since this is the exact
 * same "personal → shareable" boundary, just invoked later / out of
 * session. `promote` also builds the actual GitHub issue URL that
 * captureFix()'s "note" field has always referenced but never
 * constructed — with a real, working one-click path if GITHUB_TOKEN is
 * set, and a manual pre-filled URL either way.
 *
 * Usage:
 *   node scripts/manage-personal.mjs list                    # list all personal patterns
 *   node scripts/manage-personal.mjs list --stack=react       # filter by stack
 *   node scripts/manage-personal.mjs promote <id>             # privacy-lint, then upload/print URL
 *   node scripts/manage-personal.mjs promote <id> --dry-run   # lint + preview, don't create an issue
 *   node scripts/manage-personal.mjs promote <id> --force     # bypass privacy block (loud warning)
 *
 * Environment:
 *   GITHUB_TOKEN — if set, `promote` creates the GitHub issue directly via
 *                  the API. If unset, prints a manual pre-filled issue URL
 *                  to open in a browser instead. Matches the same env var
 *                  already referenced by captureFix()'s "note" field and
 *                  .lodestone/config.json's github_token setting.
 *
 * Config (.lodestone/config.json):
 *   community_repo — "owner/repo" to file the upload issue against.
 *                    Defaults to 'alexbkirby-glitch/lodestone' below —
 *                    UPDATE this default once the Brain Jar rename/repo
 *                    move is final; it is a placeholder, not a discovery.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privacyLint, formatPrivacyWarning } from '../mcp-server/privacy-lint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const PERSONAL_FILE = path.join(LODESTONE_DIR, 'personal-patterns.json');
const CONFIG_FILE = path.join(LODESTONE_DIR, 'config.json');

// Placeholder — see header comment. Not a discovered value, an assumption.
const DEFAULT_COMMUNITY_REPO = 'alexbkirby-glitch/lodestone';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(`--${name}`);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

function loadPersonalPatterns() {
  try {
    if (fs.existsSync(PERSONAL_FILE)) return JSON.parse(fs.readFileSync(PERSONAL_FILE, 'utf8'));
  } catch (_) {}
  return [];
}

function savePersonalPatterns(patterns) {
  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  fs.writeFileSync(PERSONAL_FILE, JSON.stringify(patterns, null, 2));
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function communityRepo() {
  return loadConfig().community_repo || DEFAULT_COMMUNITY_REPO;
}

function githubToken() {
  return process.env.GITHUB_TOKEN || loadConfig().github_token || null;
}

/** Same strip/rebuild captureFix() does inline for actions.upload.chunk_json. */
function toCommunityChunk(pattern) {
  const { captured_at, project, source, verification_status, ...rest } = pattern;
  return { ...rest, source: 'community', verification_status: 'unverified' };
}

function buildManualIssueUrl(repo, communityChunk) {
  const title = `[seed] ${communityChunk.title || communityChunk.id}`;
  const body = [
    'Submitted via `manage-personal.mjs promote` — paste-ready seed JSON below.',
    '',
    '```json',
    JSON.stringify(communityChunk, null, 2),
    '```',
  ].join('\n');
  const params = new URLSearchParams({ title, body, labels: 'seed-submission' });
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

async function createIssueViaApi(repo, communityChunk, token) {
  const title = `[seed] ${communityChunk.title || communityChunk.id}`;
  const body = [
    'Submitted via `manage-personal.mjs promote` (one-click, GITHUB_TOKEN set).',
    '',
    '```json',
    JSON.stringify(communityChunk, null, 2),
    '```',
  ].join('\n');

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'manage-personal.mjs',
    },
    body: JSON.stringify({ title, body, labels: ['seed-submission'] }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function cmdList() {
  const patterns = loadPersonalPatterns();
  const stackFilter = value('stack');
  const filtered = stackFilter ? patterns.filter((p) => p.stack === stackFilter) : patterns;

  if (filtered.length === 0) {
    console.log(stackFilter
      ? `No personal patterns found for stack "${stackFilter}".`
      : 'No personal patterns captured yet. Use capture_fix to record one.');
    return;
  }

  console.log(`${filtered.length} personal pattern(s)${stackFilter ? ` (stack: ${stackFilter})` : ''}:\n`);
  for (const p of filtered) {
    console.log(`  ${p.id}`);
    console.log(`    ${p.title || '(no title)'} — ${p.stack || 'no stack'} — blast_radius: ${p.blast_radius || 'unset'}`);
    console.log(`    captured: ${p.captured_at || 'unknown'}`);
    console.log();
  }
  console.log(`Promote one with: node scripts/manage-personal.mjs promote <id>`);
}

async function cmdPromote(id) {
  if (!id) {
    console.error('Usage: node scripts/manage-personal.mjs promote <id>');
    process.exit(1);
  }

  const patterns = loadPersonalPatterns();
  const pattern = patterns.find((p) => p.id === id);
  if (!pattern) {
    console.error(`No personal pattern with id "${id}" found. Run "list" to see available ids.`);
    process.exit(1);
  }

  const communityChunk = toCommunityChunk(pattern);
  const result = privacyLint(communityChunk);
  const force = flag('force');
  const dryRun = flag('dry-run');

  if (!result.ok) {
    console.error(formatPrivacyWarning(result));
    console.error();
    if (result.blocking && !force) {
      console.error('✗ Refusing to promote — fix the flagged fields above, or re-run with --force if you\'re certain this is a false positive.');
      process.exit(1);
    }
    if (result.blocking && force) {
      console.error('⚠ --force set: promoting anyway despite the findings above. This is your call.');
    }
  }

  const repo = communityRepo();
  const manualUrl = buildManualIssueUrl(repo, communityChunk);

  console.log(`Seed "${id}" ready for community upload to ${repo}:\n`);
  console.log(JSON.stringify(communityChunk, null, 2));
  console.log();

  if (dryRun) {
    console.log('--dry-run: not creating an issue. Manual URL would be:');
    console.log(manualUrl);
    return;
  }

  const token = githubToken();
  if (token) {
    try {
      const issue = await createIssueViaApi(repo, communityChunk, token);
      console.log(`✓ Created issue: ${issue.html_url}`);
    } catch (e) {
      console.error(`✗ One-click upload failed (${e.message}). Falling back to manual URL:`);
      console.error(manualUrl);
      process.exit(1);
    }
  } else {
    console.log('No GITHUB_TOKEN set — open this URL to file the submission manually:');
    console.log(manualUrl);
  }
}

async function main() {
  if (command === 'list') {
    cmdList();
  } else if (command === 'promote') {
    await cmdPromote(args[1]);
  } else {
    console.error('Usage:');
    console.error('  node scripts/manage-personal.mjs list [--stack=<stack>]');
    console.error('  node scripts/manage-personal.mjs promote <id> [--dry-run] [--force]');
    process.exit(1);
  }
}

main();
