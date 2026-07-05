/**
 * scripts/generate-manifest.mjs — Chunk B: manifest generator CLI
 *
 * Run this whenever a Public Jar is built/published — same slot in the
 * workflow as build-wiki.mjs occupies for the wiki layer.
 *
 * Usage:
 *   node scripts/generate-manifest.mjs                  # scan + write brain-jar-manifest.json
 *   node scripts/generate-manifest.mjs --check           # scan + validate only, exit 1 on any violation, never writes
 *   node scripts/generate-manifest.mjs --jar-name=my-jar # override the jar_name field (defaults to repo dir name)
 *   node scripts/generate-manifest.mjs --force           # write even if privacy violations were found (loud warning, use deliberately)
 *
 * Refuses to write by default if any counted seed fails privacy lint —
 * this is the last checkpoint before a Jar's corpus stats go public via
 * the manifest, catching anything that skipped or bypassed capture_seed's
 * advisory check (e.g. a seed hand-edited directly into seeds/react.json).
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, validateManifest, MANIFEST_FILENAME } from '../lib/manifest.mjs';
import { resolveJarRoot } from '../lib/jar-root.mjs';

const ROOT = resolveJarRoot(import.meta.url);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function appendLog(summary) {
  const logPath = path.join(ROOT, 'wiki', 'log.md');
  if (!fs.existsSync(path.dirname(logPath))) return; // wiki/ layer optional, don't force it
  const entry = `\n## ${today()} — manifest generation\n\n${summary}\n\n---\n`;
  fs.appendFileSync(logPath, entry);
}

function main() {
  const checkOnly = flag('check');
  const force = flag('force');
  const jarName = value('jar-name');

  const { manifest, scan } = buildManifest(ROOT, { jarName });

  console.log(`Scanned ${scan.filesScanned} seed file(s) (seeds/personal/ excluded): ${scan.seedCount} seed(s) across ${scan.stacks.length} stack(s).`);

  if (scan.structuralViolations.length > 0) {
    console.error(`\n✗ ${scan.structuralViolations.length} seed(s) failed structural lint — these were still counted, but the corpus has real problems:`);
    for (const v of scan.structuralViolations.slice(0, 10)) {
      console.error(`  ${v.file}${v.id ? ` [${v.id}]` : ''}: ${v.errors ? v.errors.join('; ') : v.error}`);
    }
    if (scan.structuralViolations.length > 10) console.error(`  ...and ${scan.structuralViolations.length - 10} more.`);
  }

  if (scan.privacyViolations.length > 0) {
    console.error(`\n⚠ ${scan.privacyViolations.length} seed(s) failed privacy lint (high severity) — these MUST NOT be published:`);
    for (const v of scan.privacyViolations) {
      console.error(`  ${v.file} [${v.id}]:`);
      for (const f of v.findings) console.error(`    [${f.field}] ${f.ruleId}: ${f.message}`);
    }
    if (!force) {
      console.error(`\n✗ Refusing to write ${MANIFEST_FILENAME} — fix the seed(s) above, or re-run with --force if this is a private-only build (NOT recommended for anything you intend to tag public).`);
      process.exit(1);
    }
    console.error(`\n⚠ --force set: writing manifest anyway despite the privacy violations above. This is your call, but a Public Jar with these findings will leak PII/secrets the moment someone grazes it.`);
  }

  const { ok, errors } = validateManifest(manifest);
  if (!ok) {
    console.error(`\n✗ Generated manifest failed its own structural validation (this is a bug in generate-manifest.mjs, not your corpus):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }

  if (checkOnly) {
    console.log('\n--check mode: manifest would be valid. Not writing.');
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const outPath = path.join(ROOT, MANIFEST_FILENAME);
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  appendLog(`Generated ${MANIFEST_FILENAME}: ${manifest.seed_count} seeds, ${manifest.stacks.length} stacks, schema_version ${manifest.schema_version}.`);

  console.log(`\n✓ Wrote ${outPath}`);
  console.log(JSON.stringify(manifest, null, 2));
}

main();
