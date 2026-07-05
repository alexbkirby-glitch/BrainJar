#!/usr/bin/env node
/**
 * build-index.mjs
 *
 * Builds two derived files from the seed library:
 *
 *   api/symptom-index.json  — reverse index: error tokens → chunk IDs
 *   llms.txt                — machine-readable site summary for LLM clients
 *
 * Run locally:     node scripts/build-index.mjs
 * Run in CI:       automatically triggered before every GitHub Pages deploy
 *
 * Both output files are generated fresh on every run. Commit them if you
 * want them available during local development; CI always regenerates them.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SEEDS_DIR = path.join(ROOT, 'seeds');
const API_DIR   = path.join(ROOT, 'api');

// ── Helpers ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','and','for','not','with','this','that','from','are','was','but','all',
  'can','its','has','have','when','been','does','did','will','would','could',
  'should','than','then','into','over','after','out','due','per','via','any',
  'each','even','also','may','more','than','been','being','between','both',
  'either','else','here','how','its','just','let','like','most','name','new',
  'now','our','own','same','see','set','such','use','used','very','want','way',
  'which','who','why','yet','you','your',
]);

function tokenize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function extractSymptom(content) {
  const m = content.match(/Symptom:\s*(.+?)(?:\.\s|$)/i);
  return m ? m[1].trim() : null;
}

// ── Domain-expansion registry ─────────────────────────────────────────────────
// Loaded once to power the injection gate. Missing file is tolerated — all
// chunks without domain_tier behave as tier 0 and are unaffected.

let DOMAIN_SOURCES = null;
const DOMAIN_SOURCES_PATH = path.join(ROOT, 'domain-sources.json');
if (fs.existsSync(DOMAIN_SOURCES_PATH)) {
  try {
    DOMAIN_SOURCES = JSON.parse(fs.readFileSync(DOMAIN_SOURCES_PATH, 'utf8'));
  } catch (e) {
    console.warn(`  ⚠ Could not parse domain-sources.json: ${e.message} — domain injection gates skipped`);
  }
}

/**
 * Returns true if a chunk should be included in the symptom index and served
 * via the published API. Mirrors buildProjectAPI's injectableChunks filter.
 *
 * Rules:
 *   - Tier 2 below steward-verified: never injected (must earn steward sign-off first)
 *   - Tier 1 in a closed domain (allowlist is empty): held until domain opens
 *   - All other chunks (including all legacy code chunks without domain_tier): injected
 */
function isInjectable(chunk) {
  if (chunk.domain_tier === 2 && chunk.verification_status !== 'steward-verified') return false;
  if (chunk.verification_status === 'disputed') return false; // dispute pending resolution
  if (chunk.domain_tier === 1 && chunk.domain) {
    const allowlist = DOMAIN_SOURCES?.domains?.[chunk.domain];
    // null = domain not registered at all; array with length 0 = registered but not yet opened
    if (allowlist !== undefined && allowlist !== null && allowlist.length === 0) return false;
  }
  return true;
}

// ── Load all seeds ────────────────────────────────────────────────────────────

function loadSeeds() {
  const stacks = [];
  const allChunks = [];
  let parseErrors = 0;

  for (const fname of fs.readdirSync(SEEDS_DIR).sort()) {
    if (!fname.endsWith('.json')) continue;
    const stack = fname.replace('.json', '');
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
    } catch (e) {
      console.warn(`  ⚠ Skipping ${fname}: ${e.message}`);
      parseErrors++;
      continue;
    }
    if (!Array.isArray(data)) continue;
    stacks.push({ stack, count: data.length });
    for (const chunk of data) {
      allChunks.push({ ...chunk, _stack: stack });
    }
  }

  return { stacks, allChunks, parseErrors };
}

// ── Build symptom index ───────────────────────────────────────────────────────

function buildSymptomIndex(allChunks) {
  // token → array of {stack, id, title, symptom}
  const index = Object.create(null); // Object.create(null) avoids prototype key collisions
  const indexed = [];
  let withSymptom = 0;

  for (const chunk of allChunks) {
    // Mirror buildProjectAPI's injection gate — chunks held by governance rules
    // (tier 2 awaiting steward, tier 1 in a not-yet-opened domain) must not
    // appear in the symptom index. Indexing them creates dangling pointers:
    // tokens that point at chunk IDs that never actually get injected.
    if (!isInjectable(chunk)) continue;

    const symptom = extractSymptom(chunk.content ?? '');
    if (!symptom) continue;
    withSymptom++;

    const entry = {
      stack: chunk._stack,
      id:    chunk.id,
      title: chunk.title,
      symptom,
      // Included so evaluateInjection() can run on MCP results without a
      // secondary fetch of the full seed JSON. Defaults to 'medium' when absent.
      blast_radius: chunk.blast_radius ?? 'medium',
    };
    indexed.push(entry);

    // Index symptom tokens + title tokens + tag tokens for broad matching
    const tokens = new Set([
      ...tokenize(symptom),
      ...tokenize(chunk.title ?? ''),
      ...(chunk.tags ?? []).flatMap(t => tokenize(t)),
    ]);

    for (const token of tokens) {
      if (!index[token]) index[token] = [];
      index[token].push(entry);
    }
  }

  return { index, indexed, withSymptom };
}

// ── Build llms.txt ────────────────────────────────────────────────────────────
//
// llms.txt is an auto-generated plain-text description of this site for
// LLM clients. It is regenerated on every deploy — do not edit it by hand.
//
// Format follows the llms.txt convention: Markdown, root of site, describes
// what the site contains and how a model should interact with it.

function buildLlmsTxt(stacks, allChunks, stats) {
  const stackList = stacks
    .filter(s => s.stack !== 'universal')
    .sort((a, b) => a.stack.localeCompare(b.stack))
    .map(s => `- **${s.stack}** — ${s.count} chunks — \`/seeds/${s.stack}.json\``)
    .join('\n');

  const universalChunks = allChunks
    .filter(c => c._stack === 'universal')
    .map(c => `- **${c.title}** — ${c.id}`)
    .join('\n');

  return `# Brain Jar

> A decentralized antipattern seed library that feeds second brains.

Brain Jar is a decentralized antipattern seed library. This flagship Jar holds **${stats.totalChunks} knowledge chunks** across **${stats.stackCount} technology stacks**, each encoding a specific antipattern as a structured WRONG → CORRECT → Symptom triple. Chunks are injected into AI sessions based on semantic similarity to the developer's current intent, reducing context waste and preventing known failure modes.

This file is auto-generated. Do not edit it by hand.

## How to use Brain Jar as an LLM

If you are an LLM assistant helping a developer, you can use Brain Jar seeds in three ways:

**1. Fetch project-specific context (recommended)**
\`\`\`
GET /api/projects/{slug}-min.json
\`\`\`
Returns a minimal JSON object with \`session_start\` (ready-to-use context block) and the top 5 pre-scored chunks for the project. Inject \`session_start\` into your system prompt.

**2. Fetch full project context**
\`\`\`
GET /api/projects/{slug}.json
\`\`\`
Returns all knowledge chunks, pre-scored against common developer intents. Filter by \`base_score >= 0.35\` and take the top 5–10 chunks.

**3. Look up by error symptom**
\`\`\`
GET /api/symptom-index.json
\`\`\`
Returns a token index mapping error message words to chunk IDs. Tokenize the developer's error message, look up tokens in the index, and surface matching chunks directly. No embedding required.

**4. Fetch a stack seed directly**
\`\`\`
GET /seeds/{stack}.json
\`\`\`
Returns all community knowledge chunks for a specific technology stack. Use when project-specific context is unavailable.

## API endpoints

| Endpoint | Description |
|---|---|
| \`/api/manifest.json\` | Index of all published project contexts |
| \`/api/seeds/index.json\` | Index of all community seed stacks with chunk counts and tags |
| \`/api/symptom-index.json\` | Error token → chunk reverse index (${stats.indexedChunks} chunks, ${stats.tokenCount} tokens) |
| \`/api/projects/{slug}.json\` | Full scored project context |
| \`/api/projects/{slug}-min.json\` | Minimal context: session_start + top 5 chunks |
| \`/api/projects/{slug}.txt\` | Plain text context for direct injection |
| \`/api/projects/{slug}-SKILL.md\` | Installable Claude skill file |
| \`/seeds/{stack}.json\` | Community seed chunks for a stack (JSON) |
| \`/seeds/{stack}.txt\` | Community seed chunks for a stack (plain text, no parsing needed) |

## Universal chunks (injected for all stacks)

These patterns apply regardless of language or framework:

${universalChunks}

## Available stacks

${stackList}

## Chunk schema

Every chunk follows this structure:
\`\`\`json
{
  "id": "snake_case_antipattern_name",
  "title": "Under Eight Words",
  "content": "WRONG: what was done wrong. CORRECT: specific fix. Symptom: exact observable failure.",
  "wrong": "Short description of the antipattern (optional structured field)",
  "correct": "Short description of the fix (optional structured field)",
  "tags": ["tag1", "tag2"],
  "source": "community",
  "stack": "stackname",
  "framework_version": ">=4.0",
  "valid_through": "2027-01-01",
  "deprecated": false
}
\`\`\`

## Source

MIT License — https://github.com/alexbkirby-glitch/lodestone

Generated: ${new Date().toISOString()}
Stacks: ${stats.stackCount} · Chunks: ${stats.totalChunks} · Indexed: ${stats.indexedChunks}
`;
}

// ── StoneHub meta-index ───────────────────────────────────────────────────────
//
// lodestone-meta.json — lightweight index for StoneHub public discovery.
// Contains ID + title + stack + blast_radius + tags + extracted symptom per seed.
// Lets StoneHub index this entire Lodestone in one fetch (~800KB, cached 30 min)
// rather than 87 individual seed-file requests.
//
// Served at /lodestone-meta.json — StoneHub fetches it first and falls back
// to crawling the seeds/ directory if it's absent.

function extractSymptomText(content) {
  if (!content) return '';
  const m = content.match(/Symptom:\s*([\s\S]*?)(?=WRONG:|CORRECT:|$)/i);
  if (!m) return '';
  return m[1].replace(/\n/g, ' ').trim().slice(0, 200);
}

function writeLodestoneMetaJson(stacks, allChunks) {
  const seeds = allChunks
    .filter(isInjectable)
    .map(c => {
      const symptom = extractSymptomText(c.content ?? '');
      // Compact search blob: title + symptom + tags
      // StoneHub scores search against this field — no need for full content
      const searchContent = [c.title ?? '', symptom, (c.tags ?? []).join(' ')]
        .filter(Boolean).join(' ');
      return {
        id:           c.id,
        title:        c.title,
        stack:        c._stack,
        blast_radius: c.blast_radius ?? 'medium',
        tags:         c.tags ?? [],
        symptom,
        content:      searchContent,
      };
    });

  const output = {
    schema_version: '1',
    generated_at:   new Date().toISOString(),
    total_seeds:    seeds.length,
    stacks:         stacks.map(s => s.stack),
    seeds,
  };

  const outPath = path.join(ROOT, 'lodestone-meta.json');
  fs.writeFileSync(outPath, JSON.stringify(output));
  return outPath;
}



function buildRelationshipGraph(allChunks) {
  // Build an id → weighted-relationships map for every injectable chunk.
  // Supports both legacy string-array format and the new weighted-edge format.
  //
  // All 6 relationship types:
  //   supersedes        — this seed replaces the older one
  //   implies           — surfacing A should also surface B (soft)
  //   requires          — surfacing A MUST also include B (hard prerequisite)
  //   conflicts         — A and B give contradictory advice; inject only one
  //   see_also          — cross-stack seeds covering the same pattern
  //   temporal_sequence — ordering: A precedes B in a workflow
  //   co_inject         — empirically co-occur in successful sessions

  const injectableIds = new Set(allChunks.filter(isInjectable).map(c => c.id));
  const ALL_REL_TYPES = ['supersedes','implies','requires','conflicts','see_also','temporal_sequence','co_inject'];
  const graph = Object.create(null);

  // Normalise a raw edge to weighted format, filtering non-injectable targets.
  function normaliseEdge(raw) {
    if (typeof raw === 'string') {
      return injectableIds.has(raw) ? { id: raw, confidence: 1.0, source: 'legacy' } : null;
    }
    if (!raw?.id || !injectableIds.has(raw.id)) return null;
    return { id: raw.id, confidence: raw.confidence ?? 1.0, source: raw.source ?? 'unknown',
             ...(raw.position ? { position: raw.position } : {}) };
  }

  for (const chunk of allChunks) {
    if (!isInjectable(chunk)) continue;
    if (!chunk.relationships) continue;

    const entry = {};
    for (const key of ALL_REL_TYPES) {
      const raw = chunk.relationships[key] ?? [];
      const edges = raw.map(normaliseEdge).filter(Boolean);
      if (edges.length) entry[key] = edges;
    }
    if (Object.keys(entry).length) graph[chunk.id] = entry;
  }
  return graph;
}

function writeSymptomIndex(index, indexed, stacks, totalChunks, relationshipGraph) {
  fs.mkdirSync(API_DIR, { recursive: true });

  const output = {
    schema_version: '1.1',
    built_at: new Date().toISOString(),
    stats: {
      stacks:  stacks.length,
      total_chunks: totalChunks,
      indexed_chunks: indexed.length,
      tokens: Object.keys(index).length,
      chunks_with_relationships: Object.keys(relationshipGraph).length,
    },
    usage: {
      description: 'Reverse index mapping error message tokens to relevant chunk IDs. Use for instant O(1) lookup without embeddings.',
      how_to_query: 'Tokenize the error message or symptom string (lowercase, split on non-alphanumeric, drop stopwords, min 3 chars). Look up each token in index{}. Collect all matching entries. Deduplicate by id. Surface the top matches.',
      example_query: '"Cannot read properties of undefined" → tokens: ["cannot","read","properties","undefined"] → look up each in index → collect matching chunks',
      endpoints: {
        full:    'GET /api/symptom-index.json',
      },
    },
    // token → [{stack, id, title, symptom, blast_radius}]
    index,
    // flat list for full-text search fallback
    chunks: indexed,
    // chunk_id → { supersedes?, implies?, conflicts?, see_also? }
    // used by the MCP server and preflight to avoid redundant injection
    // and to surface related patterns alongside direct matches
    relationship_graph: relationshipGraph,
  };

  const outPath = path.join(API_DIR, 'symptom-index.json');
  fs.writeFileSync(outPath, JSON.stringify(output));
  return outPath;
}

function writeLlmsTxt(content) {
  const outPath = path.join(ROOT, 'llms.txt');
  fs.writeFileSync(outPath, content);
  return outPath;
}

// ── Seeds index builder ───────────────────────────────────────────────────────
//
// api/seeds/index.json — machine-readable catalog of all available seeds.
// The seeds equivalent of api/manifest.json for projects.
// Lets LLMs and tools discover available stacks without reading 81 files.

function buildSeedsIndex(stacks, allChunks) {
  const builtAt = new Date().toISOString();

  const entries = stacks.map(({ stack, count }) => {
    const chunks = allChunks.filter(c => c._stack === stack);

    // Collect top tags by frequency
    const tagFreq = Object.create(null);
    for (const c of chunks) {
      for (const t of (c.tags ?? [])) {
        tagFreq[t] = (tagFreq[t] ?? 0) + 1;
      }
    }
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t);

    // Whether any chunk carries version-pinning metadata
    const hasVersionPinning = chunks.some(c => c.framework_version || c.valid_through);
    const hasDeprecated     = chunks.some(c => c.deprecated === true);

    return {
      stack,
      chunks:            count,
      top_tags:          topTags,
      has_version_pinning: hasVersionPinning,
      has_deprecated:    hasDeprecated,
      urls: {
        json: `/seeds/${stack}.json`,
        txt:  `/seeds/${stack}.txt`,
      },
    };
  });

  // Domain groupings derived from common stack name patterns
  const domains = {
    frontend:    entries.filter(e => ['react','vue','svelte','angular','htmx','nextjs','typescript','css','rxjs'].includes(e.stack)),
    backend:     entries.filter(e => ['python','fastapi','flask','django','express','rails','spring','laravel','php','go','elixir','scala'].includes(e.stack)),
    mobile:      entries.filter(e => ['flutter','reactnative','android','swift','kotlin'].includes(e.stack)),
    systems:     entries.filter(e => ['rust','cpp','zig','assembly','wasm','haskell'].includes(e.stack)),
    gamedev:     entries.filter(e => ['gdscript','godot-csharp','gdextension','glsl-godot','unity','unreal','gamedev'].includes(e.stack)),
    data_ml:     entries.filter(e => ['python','numpy','pandas','pytorch','tensorflow','elasticsearch'].includes(e.stack)),
    infra:       entries.filter(e => ['docker','kubernetes','terraform','ansible','nginx','github','git'].includes(e.stack)),
    databases:   entries.filter(e => ['postgresql','mysql','sqlite','mongodb','redis','kafka','prisma','sql'].includes(e.stack)),
    testing:     entries.filter(e => ['pytest','jest','playwright','react-testing'].includes(e.stack)),
    universal:   entries.filter(e => e.stack === 'universal'),
  };

  return {
    schema_version: '1.0',
    built_at:       builtAt,
    stats: {
      total_stacks: stacks.length,
      total_chunks: allChunks.length,
    },
    usage: {
      description: 'Index of all available community seed files. Use to discover which stacks this Jar has coverage for before fetching a full seed.',
      fetch_seed:  'GET /seeds/{stack}.json  — full JSON seed with all chunks',
      fetch_txt:   'GET /seeds/{stack}.txt   — plain-text seed for direct injection (no parsing needed)',
      this_url:    '/api/seeds/index.json',
    },
    domains,
    stacks: entries,
  };
}

// ── Per-seed .txt builder ─────────────────────────────────────────────────────
//
// /seeds/{stack}.txt — plain-text representation of a seed file.
// Each chunk rendered as a titled block: no JSON, directly injectable into
// a system prompt or CLAUDE.md without any parsing.

function buildSeedTxt(stack, chunks) {
  const active = chunks.filter(c => !c.deprecated);
  const lines = [
    `# Brain Jar seed: ${stack}`,
    `# ${active.length} chunks · generated ${new Date().toISOString()}`,
    `# Source: /seeds/${stack}.json`,
    '',
  ];

  for (const c of active) {
    lines.push(`## ${c.title}`);
    lines.push(c.content);
    lines.push('');
  }

  return lines.join('\n');
}

function writeSeedsIndex(index) {
  const dir = path.join(API_DIR, 'seeds');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, 'index.json');
  fs.writeFileSync(outPath, JSON.stringify(index, null, 2));
  return outPath;
}

function writeSeedTxtFiles(stacks, allChunks) {
  const dir = path.join(ROOT, 'seeds');
  const written = [];
  for (const { stack } of stacks) {
    const chunks = allChunks.filter(c => c._stack === stack);
    const txt    = buildSeedTxt(stack, chunks);
    const outPath = path.join(dir, `${stack}.txt`);
    fs.writeFileSync(outPath, txt);
    written.push(outPath);
  }
  return written;
}

// ── Sitemap builder ───────────────────────────────────────────────────────────

function writeSitemap(stacks, base = 'https://alexbkirby-glitch.github.io/lodestone') {
  const now = new Date().toISOString().split('T')[0];

  const staticUrls = [
    { loc: `${base}/`,                          priority: '1.0' },
    { loc: `${base}/llms.txt`,                  priority: '0.9' },
    { loc: `${base}/registry.html`,             priority: '0.9' },
    { loc: `${base}/demo.html`,                 priority: '0.9' },
    { loc: `${base}/api/seeds/index.json`,      priority: '0.8' },
    { loc: `${base}/api/manifest.json`,         priority: '0.8' },
    { loc: `${base}/api/symptom-index.json`,    priority: '0.8' },
  ];

  const seedUrls = stacks.flatMap(({ stack }) => [
    { loc: `${base}/seeds/${stack}.json`, priority: '0.6' },
    { loc: `${base}/seeds/${stack}.txt`,  priority: '0.6' },
  ]);

  const allUrls = [...staticUrls, ...seedUrls];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...allUrls.map(({ loc, priority }) =>
      `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${now}</lastmod>\n    <priority>${priority}</priority>\n  </url>`
    ),
    '</urlset>',
  ].join('\n');

  const outPath = path.join(ROOT, 'sitemap.xml');
  fs.writeFileSync(outPath, xml);
  return outPath;
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('Brain Jar — build-index.mjs\n');

console.log('Loading seeds...');
const { stacks, allChunks, parseErrors } = loadSeeds();
console.log(`  ${allChunks.length} chunks across ${stacks.length} stacks`);
if (parseErrors > 0) console.warn(`  ⚠ ${parseErrors} file(s) skipped due to parse errors`);

console.log('\nBuilding symptom index...');
const { index, indexed, withSymptom } = buildSymptomIndex(allChunks);
const tokenCount = Object.keys(index).length;
console.log(`  ${indexed.length}/${allChunks.length} chunks indexed · ${tokenCount} tokens`);

console.log('\nBuilding relationship graph...');
const relationshipGraph = buildRelationshipGraph(allChunks);
const graphSize = Object.keys(relationshipGraph).length;
console.log(`  ${graphSize} chunks with declared relationships`);

const stats = {
  stackCount:    stacks.length,
  totalChunks:   allChunks.length,
  indexedChunks: indexed.length,
  tokenCount,
};

console.log('\nBuilding seeds index...');
const seedsIndex = buildSeedsIndex(stacks, allChunks);

console.log('\nBuilding per-seed .txt files...');
const txtFiles = writeSeedTxtFiles(stacks, allChunks);
console.log(`  ${txtFiles.length} .txt files written`);

console.log('\nBuilding llms.txt...');
const llmsTxt = buildLlmsTxt(stacks, allChunks, stats);

// ── Optional: generate embeddings for hybrid semantic matching ─────────────
// Requires @xenova/transformers. If not installed, embeddings are skipped and
// the system falls back to lexical-only matching. This is a build-time step;
// the output (api/symptom-embeddings.json) is a separate file fetched lazily
// by the MCP server and preflight only when semantic matching is needed.

const generateEmbeddings = process.argv.includes('--embeddings');
let embeddingsPath = null;

if (generateEmbeddings) {
  console.log('\nGenerating semantic embeddings (this may take a few minutes)...');
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels  = false;
    env.useBrowserCache   = false;

    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    async function embed(text) {
      const out = await embedder(text, { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    }

    const embeddings = {};
    let done = 0;
    for (const entry of indexed) {
      const text = `${entry.title}. ${entry.symptom}`;
      embeddings[entry.id] = await embed(text);
      done++;
      if (done % 50 === 0) process.stdout.write(`  ${done}/${indexed.length}\r`);
    }

    fs.mkdirSync(API_DIR, { recursive: true });
    embeddingsPath = path.join(API_DIR, 'symptom-embeddings.json');
    fs.writeFileSync(embeddingsPath, JSON.stringify({
      schema_version: '1.0',
      model:          'Xenova/all-MiniLM-L6-v2',
      dimensions:     384,
      built_at:       new Date().toISOString(),
      embeddings,     // id → float[]
    }, null, 2));
    console.log(`\n  ✓ ${Object.keys(embeddings).length} embeddings written`);
  } catch (e) {
    console.warn(`  ⚠ Embedding generation failed (${e.message}) — skipping`);
    console.warn('    Install @xenova/transformers to enable semantic matching');
  }
} else {
  console.log('\n(Skipping embeddings — run with --embeddings to generate)');
}

console.log('\nWriting outputs...');
const indexPath    = writeSymptomIndex(index, indexed, stacks, allChunks.length, relationshipGraph);
const seedsPath    = writeSeedsIndex(seedsIndex);
const llmsPath     = writeLlmsTxt(llmsTxt);
const sitemapPath  = writeSitemap(stacks);
const metaPath     = writeLodestoneMetaJson(stacks, allChunks);
console.log(`  ✓ ${indexPath}`);
console.log(`  ✓ ${seedsPath}`);
console.log(`  ✓ ${llmsPath}`);
console.log(`  ✓ ${sitemapPath}`);
console.log(`  ✓ ${metaPath}`);
if (embeddingsPath) console.log(`  ✓ ${embeddingsPath}`);
console.log(`  ✓ ${txtFiles.length} seed .txt files in seeds/`);

console.log(`\nDone. ${stats.totalChunks} chunks \xb7 ${stats.stackCount} stacks \xb7 ${tokenCount} index tokens \xb7 ${graphSize} relationship edges`);

// Downstream artifacts (build-nano, demo index, registry) are chained by
// .github/workflows/deploy.yml — the ONE place build order is defined.
// (This script previously execSync'd generate-outputs/build-nano/
// build-starter here; generate-outputs and build-starter are gone and the
// double-chaining caused every deploy to run build-nano twice.)
