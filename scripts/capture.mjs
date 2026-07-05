/**
 * scripts/capture.mjs — CLI wrapper around lib/capture-seed.mjs
 *
 * For testing the capture path standalone, before it's wired into the MCP
 * server as the `capture_seed` tool. Not meant to be the primary interface
 * — the whole point of Chunk 0 is that capture happens *inside* a live
 * session via MCP, not via a human typing flags into a terminal after the
 * fact (that's the friction this chunk exists to remove).
 *
 * Usage:
 *   node scripts/capture.mjs \
 *     --stack=react \
 *     --blast-radius=high \
 *     --wrong="..." --correct="..." --symptom="..." \
 *     --tags=hooks,useEffect \
 *     [--id=custom_id] [--domain=...] [--facet=...] [--confidence=0.8] \
 *     [--staging=seeds/personal/captured.json] [--dry-run]
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import { captureSeed } from '../lib/capture-seed.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const input = {
  id: value('id') || undefined,
  stack: value('stack'),
  blast_radius: value('blast-radius'),
  wrong: value('wrong'),
  correct: value('correct'),
  symptom: value('symptom'),
  tags: value('tags') ? value('tags').split(',').map((t) => t.trim()) : [],
  doc_reference: value('doc-reference') || null,
  domain: value('domain'),
  facet: value('facet'),
  confidence: value('confidence') ? Number(value('confidence')) : undefined,
  source: 'personal',
};

const opts = {
  stagingPath: value('staging'),
  dryRun: flag('dry-run'),
};

const result = await captureSeed(input, opts);

console.log(JSON.stringify(result, null, 2));

if (!result.structural.ok) {
  console.error('\n✗ Structural lint failed — seed NOT staged. Fix the errors above and retry.');
  process.exit(1);
}

if (result.privacy.blocking) {
  console.error('\n⚠ Privacy lint found high-severity issues. Staged locally (private jars are fine), but this seed will be BLOCKED from publish until fixed. Run again with the offending text edited, or handle at publish time.');
} else if (!result.privacy.ok) {
  console.warn('\n⚠ Privacy lint found minor issues — review before publishing, not blocking.');
}

if (result.staged) {
  console.log(`\n✓ Staged to ${result.path}`);
} else if (opts.dryRun) {
  console.log('\n(dry run — nothing written)');
}
