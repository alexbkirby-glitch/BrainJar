#!/usr/bin/env node
/**
 * scripts/rename-pass.mjs — Chunk A: Lodestone → Brain Jar rename pass
 *
 * DELIBERATELY NOT a blind `s/Lodestone/Brain Jar/g`. The corpus has a
 * self-referential "lodestone" stack (seeds/lodestone.json, the
 * wiki/stacks/lodestone.md meta-stack) whose STACK ID must not be renamed
 * — see grill-session decision 17 (kept as legacy label, avoids a
 * project-name collision). A blind regex would silently corrupt that
 * stack's id wherever it appears as `stack: "lodestone"`,
 * `seeds/lodestone.json`, `` `lodestone` ``, or `stacks/lodestone` wikilinks.
 *
 * Strategy instead:
 *   1. PHRASE_RULES — exact, known-safe phrase substitutions, hand-audited
 *      against this repo. Applied in --write mode.
 *   2. WORD_RULES — Stone→Jar, Henge→Public Jar. Safe as whole-word regex;
 *      audited to have zero collisions with unrelated words in this corpus
 *      (does NOT touch "Jar" as in "Layered Jar" — that word is never a
 *      rename target, only a source).
 *   3. EXCLUDE_PATTERNS — files skipped entirely (the lodestone meta-stack,
 *      any seeds/<id>.json where id itself is "lodestone"). These are
 *      Chunk H candidates, not Chunk A targets — see grill-session decision
 *      16 (vault subsystem, which lodestone.md documents, is being
 *      archived, not renamed).
 *   4. SCAN-ONLY reporters — grazeable-field usage and old-sense
 *      manifest.json/manifest references are NEVER auto-replaced (both
 *      need human judgment: grazeable-folding is a logic change, not a
 *      rename; manifest has two live senses post-decision-15 and
 *      disambiguating them by regex alone is unsafe). These print findings
 *      with file/line/context and stop there.
 *   5. Residual scan — after phrase+word rules run, anything still matching
 *      /lodestone/i outside an excluded file gets reported, not touched.
 *      A hit here means the phrase list missed a real usage — that's a bug
 *      in this script, not something to auto-fix blindly.
 *
 * Usage:
 *   node scripts/rename-pass.mjs <target-dir>              # dry run (default)
 *   node scripts/rename-pass.mjs <target-dir> --write      # actually rewrite files
 *
 * Does NOT rename the git repo / directory name itself (lodestone-wiki/,
 * github.com/alexbkirby-glitch/lodestone) — that's a repo-level operation
 * (GitHub rename + redirect, local remote update) outside what a content
 * script should touch. Do that by hand once PyPI/domain checks clear.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';

const EXCLUDE_PATTERNS = [
  /(^|\/)wiki\/stacks\/lodestone\.md$/,
  /(^|\/)seeds\/lodestone\.json$/,
  /(^|\/)generated\/skills\/lodestone-SKILL\.md$/,
  /node_modules/,
  /\.git\//,
];

// Exact phrase substitutions, hand-audited against this repo's actual text.
// Order matters: longer/more specific phrases first so shorter ones can't
// partially clobber them.
const PHRASE_RULES = [
  ['— Lodestone SKILL', '— Brain Jar SKILL'],
  ['auto-generated from the Lodestone seed library', 'auto-generated from the Brain Jar seed library'],
  ['conversion of the Lodestone seed corpus', 'conversion of the Brain Jar seed corpus'],
  ['Converts the Lodestone seed corpus', 'Converts the Brain Jar seed corpus'],
  ['# Lodestone Wiki — Index', '# Brain Jar Wiki — Index'],
  ["'# Lodestone Wiki — Index\\n'", "'# Brain Jar Wiki — Index\\n'"], // literal in build-wiki.mjs source
  ['Maintenance Schema for the Lodestone Wiki', 'Maintenance Schema for the Brain Jar Wiki'],
  ["Lodestone's equivalent of", "Brain Jar's equivalent of"],
];

// Whole-word rules. Audited: zero collisions found in this corpus (e.g.
// does not touch "Layered Jar" in spring-docker.md, since that's "Jar"
// used as a *source* word we never match against, not "Stone"/"Henge").
const WORD_RULES = [
  [/\bStone\b/g, 'Jar'],
  [/\bHenge\b/g, 'Public Jar'],
];

// Report-only: never auto-replaced. Printed for manual follow-up.
const SCAN_ONLY_PATTERNS = [
  { id: 'grazeable_field', pattern: /\bgrazeable\b/gi, note: 'Fold into "tagging = consent" per decision 8 — this is a logic change, not a text rename. Handle by hand.' },
  { id: 'manifest_reference', pattern: /\bmanifest(\.json)?\b/gi, note: 'Ambiguous post-decision-15: OLD project-wide seed index (→ rename to seeds-index.json) vs NEW per-Jar schema_version file (Chunk B, stays "manifest"). Confirm which sense before touching.' },
  { id: 'vault_subsystem', pattern: /\bvault_(pull|promote)\b|\.lodestone\/vault/g, note: 'Chunk H archive candidate (decision 16) — superseded by Henge/Jar. Do not rename; remove or fork to legacy repo instead.' },
];

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((re) => re.test(filePath));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|\.git$/.test(entry.name)) walk(full, out);
    } else if (/\.(md|mjs|js|json)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function runScanOnly(files) {
  const findings = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const { id, pattern, note } of SCAN_ONLY_PATTERNS) {
      lines.forEach((line, i) => {
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          findings.push({ file, line: i + 1, ruleId: id, text: line.trim(), note });
        }
      });
    }
  }
  return findings;
}

function runResidualScan(fileTextMap) {
  const findings = [];
  for (const [file, text] of Object.entries(fileTextMap)) {
    if (isExcluded(file)) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (/lodestone/i.test(line)) {
        findings.push({ file, line: i + 1, text: line.trim() });
      }
    });
  }
  return findings;
}

function applyRules(text) {
  let result = text;
  let changeCount = 0;
  for (const [from, to] of PHRASE_RULES) {
    const count = result.split(from).length - 1;
    if (count > 0) {
      result = result.split(from).join(to);
      changeCount += count;
    }
  }
  for (const [pattern, to] of WORD_RULES) {
    const matches = result.match(pattern);
    if (matches) {
      result = result.replace(pattern, to);
      changeCount += matches.length;
    }
  }
  return { result, changeCount };
}

async function main() {
  const targetDir = process.argv[2];
  const write = process.argv.includes('--write');

  if (!targetDir) {
    console.error('Usage: node scripts/rename-pass.mjs <target-dir> [--write]');
    process.exit(1);
  }

  const files = walk(targetDir);
  const eligibleFiles = files.filter((f) => !isExcluded(f));

  console.log(`Scanning ${files.length} files (${files.length - eligibleFiles.length} excluded)...\n`);

  // 1. Apply phrase + word rules to eligible files. Build a map of
  // file -> final text (post-transformation for eligible files, unchanged
  // original for excluded files) so the residual scan checks reality
  // rather than stale on-disk content that dry-run mode hasn't written yet.
  const fileTextMap = {};
  let filesChanged = 0;
  let totalChanges = 0;
  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    if (isExcluded(file)) {
      fileTextMap[file] = original;
      continue;
    }
    const { result, changeCount } = applyRules(original);
    fileTextMap[file] = result;
    if (changeCount > 0) {
      filesChanged++;
      totalChanges += changeCount;
      console.log(`${write ? 'WRITE' : 'DRY-RUN'}  ${file}  (${changeCount} change${changeCount === 1 ? '' : 's'})`);
      if (write) fs.writeFileSync(file, result, 'utf8');
    }
  }
  console.log(`\n${filesChanged} file(s), ${totalChanges} substitution(s) ${write ? 'applied' : 'would be applied'}.\n`);

  // 2. Residual scan — anything the phrase list missed, checked against
  // the POST-transformation text (what the file will actually look like),
  // not a stale disk read.
  const residual = runResidualScan(fileTextMap);
  if (residual.length > 0) {
    console.log(`⚠ RESIDUAL "lodestone" matches outside excluded files (not auto-touched — review manually):`);
    for (const r of residual) console.log(`  ${r.file}:${r.line}: ${r.text}`);
    console.log();
  }

  // 3. Report-only scans (grazeable, manifest, vault) — always run against
  // original on-disk content; these are never rewritten by this script
  // regardless of --write, so original text is the correct thing to scan.
  const scanFindings = runScanOnly(files);
  if (scanFindings.length > 0) {
    console.log(`ℹ REPORT-ONLY findings (never auto-replaced, need a human decision):`);
    const byRule = {};
    for (const f of scanFindings) (byRule[f.ruleId] ||= []).push(f);
    for (const [ruleId, items] of Object.entries(byRule)) {
      console.log(`\n  [${ruleId}] ${items[0].note}`);
      for (const item of items) console.log(`    ${item.file}:${item.line}: ${item.text}`);
    }
    console.log();
  }

  if (!write) {
    console.log('This was a dry run. Re-run with --write to apply the phrase/word substitutions above.');
  }
}

main();
