#!/usr/bin/env node
/**
 * scripts/graze.mjs — Chunk C: offline batch grazer
 *
 * Fresh build, per direct confirmation — NOT an adaptation of
 * auto_seed.mjs/StoneHub. StoneHub's discovery is real but wired to the
 * old reputation-scored model (build-stats.mjs); this reimplements
 * decision 1's design (GitHub-repo Public Jars, topic-search discovery)
 * against the new Henge/Public-Jar/manifest architecture instead.
 *
 * Flow (grill-session decision 2: offline batch, not live):
 *   1. Discover candidate Public Jars via GitHub topic search.
 *   2. Fetch + validate each Jar's brain-jar-manifest.json — skip anything
 *      with an incompatible schema_version (lib/manifest.mjs, decision 4).
 *   3. Fetch seeds/<stack>.json for each declared stack.
 *   4. Shallow-score each candidate seed against the LOCAL Jar's own
 *      declared metadata only — its manifest (stacks/domains/facets), its
 *      active profile (profiles.json's active_facets/active_domains,
 *      decision 7), and its own seed corpus text for relevance (BM25-lite
 *      + tag Jaccard, reusing mcp-server/index.mjs's tokenizer for
 *      consistency). Never reads remote OR local brain/memory content.
 *   5. Write staged candidates to a JSON file. NEVER auto-merges — Chunk D
 *      reads this file for human review.
 *
 * Usage:
 *   node scripts/graze.mjs                          # discover via GitHub, score, stage
 *   node scripts/graze.mjs --topic=brain-jar          # override discovery topic
 *   node scripts/graze.mjs --max-jars=10
 *   node scripts/graze.mjs --profile=web-developer    # score against a specific local profile
 *   node scripts/graze.mjs --local-fixture=<dir>      # skip GitHub entirely, read a local
 *                                                       directory of {owner}__{repo}/ folders
 *                                                       instead (each containing a manifest +
 *                                                       seeds/) — for testing without network
 *                                                       or a live tagged repo to graze from.
 *
 * Environment:
 *   GITHUB_TOKEN — raises the unauthenticated 60 req/hr rate limit.
 *                  Works without one, just slower for large discovery runs.
 *
 * Known cold-start problem: no repos are tagged with the new discovery
 * topic yet (StoneHub used topic "lodestone" under the old reputation
 * model, being retired alongside it — see grill-session Chunk H). This
 * script's GitHub path is real and correct but has nothing to discover
 * until Jar owners start tagging repos. --local-fixture exists precisely
 * to test the scoring/staging logic in the meantime.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, MANIFEST_FILENAME } from '../lib/manifest.mjs';
import { isSchemaVersionCompatible, structuralLint } from '../lib/seed-schema.mjs';
// Discovery trio extracted to lib/discover-jars.mjs (Chunk E) so the slim
// MCP server's list_jars tool and this grazer share ONE implementation.
import { discoverPublicJars, fetchAndValidateManifest, fetchStackSeeds, DEFAULT_TOPIC } from '../lib/discover-jars.mjs';
import { resolveJarRoot } from '../lib/jar-root.mjs';

const ROOT = resolveJarRoot(import.meta.url);
const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const PROFILES_FILE = path.join(ROOT, 'profiles.json');
const STAGED_OUTPUT = path.join(LODESTONE_DIR, 'graze-staged.json');

// Same tokenizer as mcp-server/index.mjs's duplicate-detection Jaccard
// check, reused deliberately for scoring consistency across the codebase.
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
const flag = (name) => args.includes(`--${name}`);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

/** --local-fixture path: read {owner}__{repo}/ dirs instead of hitting GitHub. */
function loadLocalFixtureJars(fixtureDir) {
  const entries = fs.readdirSync(fixtureDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  return entries.map((e) => {
    const [owner, repo] = e.name.split('__');
    return { owner: owner || e.name, repo: repo || e.name, _fixtureDir: path.join(fixtureDir, e.name) };
  });
}

function fixtureManifest(jarWithFixture) {
  const manifestPath = path.join(jarWithFixture._fixtureDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return { jar: jarWithFixture, skip: `no ${MANIFEST_FILENAME} in fixture` };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { ok, errors } = validateManifest(manifest);
  if (!ok) return { jar: jarWithFixture, skip: `malformed manifest: ${errors.join('; ')}` };
  if (!isSchemaVersionCompatible(manifest.schema_version)) {
    return { jar: jarWithFixture, skip: `incompatible schema_version ${manifest.schema_version}` };
  }
  return { jar: jarWithFixture, manifest, skip: null };
}

function fixtureStackSeeds(jarWithFixture, stack) {
  const seedPath = path.join(jarWithFixture._fixtureDir, 'seeds', `${stack}.json`);
  if (!fs.existsSync(seedPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Loads the local Jar's own declared metadata: manifest, active profile, own seed corpus. */
function loadLocalContext(profileName) {
  const localManifestPath = path.join(ROOT, MANIFEST_FILENAME);
  const localManifest = fs.existsSync(localManifestPath)
    ? JSON.parse(fs.readFileSync(localManifestPath, 'utf8'))
    : null;

  let profile = { active_facets: [], active_domains: [] };
  if (fs.existsSync(PROFILES_FILE)) {
    const profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    const name = profileName || 'generalist';
    if (profiles[name]) profile = profiles[name];
  }

  // Own seed corpus text, for tag/token overlap — reads only what the local
  // Jar itself already declares as public (seeds/*.json, personal/
  // equivalent excluded), matching the "never reads brain content" rule.
  const seedsDir = path.join(ROOT, 'seeds');
  const ownTokens = new Set();
  const ownIds = new Set();
  const ownTags = new Set();
  if (fs.existsSync(seedsDir)) {
    for (const file of fs.readdirSync(seedsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const seeds = JSON.parse(fs.readFileSync(path.join(seedsDir, file), 'utf8'));
        for (const s of Array.isArray(seeds) ? seeds : []) {
          if (s.id) ownIds.add(s.id);
          for (const t of tokenize(`${s.wrong ?? ''} ${s.correct ?? ''} ${s.content ?? ''}`)) ownTokens.add(t);
          for (const t of s.tags || []) ownTags.add(t);
        }
      } catch {}
    }
  }

  return { localManifest, profile, ownTokens, ownIds, ownTags };
}

/**
 * Shallow score a candidate seed against local context only. Two signals:
 *   - profile match: does the candidate's domain/facet fall within the
 *     active profile's filters? (empty filter = no restriction, matching
 *     profiles.json's own "generalist" semantics exactly)
 *   - tag/token overlap: Jaccard-style overlap between the candidate's
 *     tags/text and the local corpus's own tag/token vocabulary — a proxy
 *     for "this is relevant to what I already work on," not a duplicate
 *     check (that's Chunk D's job, run against full local content).
 * Returns a 0–1 score. Never inspects brain/memory content.
 */
function scoreCandidate(seed, localContext) {
  const { profile, ownTokens, ownTags } = localContext;

  const facetOk = !profile.active_facets?.length || profile.active_facets.includes(seed.facet);
  const domainOk = !profile.active_domains?.length || profile.active_domains.includes(seed.domain);
  if (!facetOk || !domainOk) return 0; // hard filter, matches profile semantics

  const seedTokens = new Set(tokenize(`${seed.wrong ?? ''} ${seed.correct ?? ''} ${seed.content ?? ''}`));
  const tokenOverlap = seedTokens.size
    ? [...seedTokens].filter((t) => ownTokens.has(t)).length / seedTokens.size
    : 0;

  const seedTags = new Set(seed.tags || []);
  const tagOverlap = seedTags.size
    ? [...seedTags].filter((t) => ownTags.has(t)).length / seedTags.size
    : 0;

  // Weighted toward tag overlap — tags are curated signal, token overlap is
  // noisier free-text signal. Simple, transparent, no learned weights.
  return Math.min(1, 0.4 * tokenOverlap + 0.6 * tagOverlap);
}

async function main() {
  const topic = value('topic') || DEFAULT_TOPIC;
  const maxJars = Number(value('max-jars')) || 20;
  const profileName = value('profile');
  const localFixture = value('local-fixture');

  const localContext = loadLocalContext(profileName);
  console.log(`Local profile: ${profileName || 'generalist'} (facets: ${localContext.profile.active_facets?.join(',') || 'none'}, domains: ${localContext.profile.active_domains?.join(',') || 'none'})`);
  console.log(`Local corpus: ${localContext.ownIds.size} known seed id(s), ${localContext.ownTags.size} distinct tag(s).\n`);

  let jars;
  let manifestResults;
  if (localFixture) {
    console.log(`--local-fixture set: reading ${localFixture} instead of GitHub.\n`);
    jars = loadLocalFixtureJars(localFixture);
    manifestResults = jars.map(fixtureManifest);
  } else {
    console.log(`Discovering Public Jars via GitHub topic "${topic}"...`);
    jars = await discoverPublicJars(topic, maxJars);
    console.log(`Found ${jars.length} candidate repo(s).\n`);
    manifestResults = await Promise.all(jars.map(fetchAndValidateManifest));
  }

  const validJars = manifestResults.filter((r) => !r.skip);
  const skippedJars = manifestResults.filter((r) => r.skip);

  for (const s of skippedJars) {
    console.log(`  skip ${s.jar.owner}/${s.jar.repo}: ${s.skip}`);
  }
  console.log(`\n${validJars.length} Jar(s) passed manifest validation.\n`);

  const staged = [];
  for (const { jar, manifest } of validJars) {
    for (const stack of manifest.stacks) {
      const seeds = localFixture ? fixtureStackSeeds(jar, stack) : await fetchStackSeeds(jar, stack);
      for (const seed of seeds) {
        if (localContext.ownIds.has(seed.id)) continue; // cheap id-level skip; full dedup is Chunk D
        const structural = structuralLint(seed);
        const score = scoreCandidate(seed, localContext);
        if (score <= 0) continue; // profile filter rejected it, or zero relevance signal

        // grazed_from: accumulate rather than overwrite, so a seed that's
        // been re-shared across multiple Jars keeps its full upstream
        // chain (decision 13's citation-graph-for-free requirement, and
        // Chunk D's "full upstream chain if a candidate has itself been
        // grazed before" display need). If this seed already carries a
        // grazed_from history from a PRIOR graze cycle upstream, extend
        // it; don't clobber it.
        const priorChain = Array.isArray(seed.grazed_from) ? seed.grazed_from : [];
        const seedWithProvenance = {
          ...seed,
          grazed_from: [...priorChain, { jar: `${jar.owner}/${jar.repo}`, grazed_at: new Date().toISOString().slice(0, 10) }],
        };

        staged.push({
          seed: seedWithProvenance,
          score,
          source_jar: `${jar.owner}/${jar.repo}`,
          source_manifest: { jar_name: manifest.jar_name, seed_count: manifest.seed_count, last_updated: manifest.last_updated },
          structural_ok: structural.ok,
          structural_errors: structural.errors,
        });
      }
    }
  }

  staged.sort((a, b) => b.score - a.score);

  fs.mkdirSync(LODESTONE_DIR, { recursive: true });
  fs.writeFileSync(STAGED_OUTPUT, JSON.stringify(staged, null, 2));

  console.log(`Staged ${staged.length} candidate(s) to ${STAGED_OUTPUT}.`);
  console.log(`Nothing was merged — this is input for the review queue (Chunk D), not a final action.`);
  if (staged.length) {
    console.log(`\nTop candidates:`);
    for (const c of staged.slice(0, 5)) {
      console.log(`  [${c.score.toFixed(2)}] ${c.seed.id} (${c.source_jar}, ${c.structural_ok ? 'structurally OK' : 'STRUCTURAL ISSUES'})`);
    }
  }
}

main().catch((e) => {
  console.error(`graze.mjs failed: ${e.message}`);
  process.exit(1);
});
