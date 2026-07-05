#!/usr/bin/env node
/**
 * scripts/detect-relationships-llm.mjs
 *
 * LLM-assisted relationship proposal layer.
 * Sits ABOVE detect-relationships.mjs — runs periodically to find semantic
 * connections that token-based methods structurally cannot detect.
 *
 * Design principles:
 *   - Targets orphan seeds only (no existing edges after static detection)
 *   - All proposals require human review — never writes directly
 *   - Degrades gracefully: if no API key / model unavailable → exits 0
 *   - Confidence threshold: only keep proposals ≥ 0.75
 *   - Deduplicates against edges already written by detect-relationships.mjs
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/detect-relationships-llm.mjs
 *   node scripts/detect-relationships-llm.mjs --dry      # report only, no file
 *   node scripts/detect-relationships-llm.mjs --batch 8  # seeds per API call
 *   node scripts/detect-relationships-llm.mjs --stacks mathematics,numpy
 *
 * Output:
 *   .lodestone/proposed-relationships.json   (read by the GitHub Actions PR step)
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, '..');
const SEEDS_DIR    = path.join(ROOT, 'seeds');
const LODESTONE_DIR = path.join(ROOT, '.lodestone');
const OUTPUT_FILE  = path.join(LODESTONE_DIR, 'proposed-relationships.json');

const DRY         = process.argv.includes('--dry');
const BATCH_SIZE  = parseInt(process.argv[process.argv.indexOf('--batch') + 1] ?? '10', 10) || 10;
const STACK_FILTER= (process.argv[process.argv.indexOf('--stacks') + 1] ?? '').split(',').filter(Boolean);
const MIN_CONF    = 0.75;
const API_KEY     = process.env.ANTHROPIC_API_KEY ?? process.env.LODESTONE_API_KEY ?? '';
const MODEL       = 'claude-sonnet-4-20250514';

// ── Graceful degradation ──────────────────────────────────────────────────────

if (!API_KEY) {
  console.log('detect-relationships-llm: no API key found — skipping (base pipeline unaffected)');
  console.log('Set ANTHROPIC_API_KEY to enable LLM relationship proposals.');
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadAllSeeds() {
  const all = [];
  for (const fname of fs.readdirSync(SEEDS_DIR).sort()) {
    if (!fname.endsWith('.json')) continue;
    const stack = fname.replace('.json', '');
    if (STACK_FILTER.length && !STACK_FILTER.includes(stack)) continue;
    try {
      const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
      if (!Array.isArray(seeds)) continue;
      for (const s of seeds) {
        if (s.type && s.type !== 'knowledge') continue;
        all.push({ ...s, _stack: stack });
      }
    } catch {}
  }
  return all;
}

function isOrphan(seed) {
  const rels = seed.relationships;
  if (!rels) return true;
  if (Array.isArray(rels)) return rels.length === 0;
  if (typeof rels === 'object') return Object.keys(rels).length === 0;
  return true;
}

function existingEdgeIds(seed) {
  const ids = new Set();
  const rels = seed.relationships;
  if (!rels || typeof rels !== 'object' || Array.isArray(rels)) return ids;
  for (const edges of Object.values(rels)) {
    if (!Array.isArray(edges)) continue;
    for (const e of edges) {
      if (typeof e === 'string') ids.add(e);
      else if (e?.id) ids.add(e.id);
    }
  }
  return ids;
}

function seedSummary(seed) {
  // Compact representation for LLM context
  const c = seed.content ?? '';
  const wrongM   = c.match(/WRONG:\s*([\s\S]*?)(?=CORRECT:|Symptom:|$)/i);
  const correctM = c.match(/CORRECT:\s*([\s\S]*?)(?=WRONG:|Symptom:|$)/i);
  const symptomM = c.match(/Symptom:\s*([\s\S]*?)(?=WRONG:|CORRECT:|$)/i);
  return {
    id:           seed.id,
    stack:        seed._stack,
    blast_radius: seed.blast_radius ?? 'medium',
    title:        seed.title ?? '',
    wrong:        (seed.wrong ?? wrongM?.[1]  ?? '').trim().slice(0, 200),
    correct:      (seed.correct ?? correctM?.[1] ?? '').trim().slice(0, 200),
    symptom:      (symptomM?.[1] ?? '').trim().slice(0, 150),
    tags:         Array.isArray(seed.tags) ? seed.tags.slice(0, 6) : [],
  };
}

// ── LLM call ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are analyzing a library of software antipattern seeds.
Each seed encodes one mistake: a WRONG approach, the CORRECT fix, and the observable Symptom.

For the given group of seeds, suggest relationship edges between them.

Relationship types (use exactly these names):
  requires        — loading seed A always means B is also relevant (prerequisite pattern)
  see_also        — seeds cover related concepts that genuinely inform each other
  co_inject       — seeds should often be shown together in the same session
  escalates_to    — ignoring seed A often leads to encountering seed B (B must have higher blast_radius)
  implies         — if A is relevant, B is probably also relevant (weaker than requires)

Return ONLY a JSON array — no markdown, no explanation, no surrounding text:
[
  {
    "from": "seed_id",
    "to": "seed_id",
    "type": "requires|see_also|co_inject|escalates_to|implies",
    "confidence": 0.0,
    "justification": "one specific sentence explaining the relationship"
  }
]

Rules:
- Only include edges with confidence ≥ 0.70
- escalates_to requires the 'to' seed to have strictly higher blast_radius
- Do not suggest edges that are trivially obvious from shared stack names
- Justification must be specific enough for a human reviewer to evaluate
- If no confident relationships exist, return []`;

async function callLLM(seeds, retries = 2) {
  const userMsg = `Here are ${seeds.length} seeds. Suggest relationship edges between them:\n\n${JSON.stringify(seeds, null, 2)}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: 1500,
          system:     SYSTEM_PROMPT,
          messages:   [{ role: 'user', content: userMsg }],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        if (res.status === 429 && attempt < retries) {
          // Rate limited — wait and retry
          const wait = 15000 * (attempt + 1);
          console.log(`  Rate limited, retrying in ${wait / 1000}s…`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`API ${res.status}: ${err.slice(0, 200)}`);
      }

      const data  = await res.json();
      const text  = data.content?.find(b => b.type === 'text')?.text ?? '[]';
      const clean = text.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);

    } catch (e) {
      if (attempt < retries && e.message?.includes('fetch')) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw e;
    }
  }
  return [];
}

// ── Batching strategy ─────────────────────────────────────────────────────────
// Group orphans by stack, then by blast_radius within stack.
// Include up to 3 non-orphan seeds from the same or related stacks as context.

function buildBatches(orphans, allSeeds) {
  const batches = [];
  const byStack = {};
  for (const s of orphans) {
    (byStack[s._stack] = byStack[s._stack] ?? []).push(s);
  }

  // Related stack seeds for context (non-orphans, high blast)
  const contextSeeds = allSeeds
    .filter(s => !isOrphan(s))
    .sort((a, b) => (b.blast_radius === 'critical' ? 1 : b.blast_radius === 'high' ? 0.5 : 0) -
                    (a.blast_radius === 'critical' ? 1 : a.blast_radius === 'high' ? 0.5 : 0));

  for (const [stack, seeds] of Object.entries(byStack)) {
    // Chunk into BATCH_SIZE groups
    for (let i = 0; i < seeds.length; i += BATCH_SIZE) {
      const chunk = seeds.slice(i, i + BATCH_SIZE);
      // Add up to 3 context seeds from same or implied stacks
      const ctx = contextSeeds
        .filter(s => s._stack === stack || s._stack === 'universal')
        .slice(0, 3);
      batches.push({ stack, seeds: [...chunk, ...ctx].map(seedSummary) });
    }
  }

  // Cross-stack batch: orphans from different stacks with overlapping tags
  // This catches the semantic connections that within-stack batching misses
  const tagIndex = {};
  for (const s of orphans) {
    for (const tag of (Array.isArray(s.tags) ? s.tags : [])) {
      (tagIndex[tag] = tagIndex[tag] ?? []).push(s);
    }
  }
  for (const [tag, tagged] of Object.entries(tagIndex)) {
    if (tagged.length < 2 || tagged.length > 20) continue;
    const uniqueStacks = new Set(tagged.map(s => s._stack));
    if (uniqueStacks.size < 2) continue; // skip single-stack groups
    batches.push({ stack: `cross:${tag}`, seeds: tagged.map(seedSummary) });
  }

  return batches;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('detect-relationships-llm.mjs\n');

const allSeeds = loadAllSeeds();
console.log(`Loaded ${allSeeds.length} seeds across ${new Set(allSeeds.map(s => s._stack)).size} stacks`);

const orphans = allSeeds.filter(isOrphan);
console.log(`Orphan seeds (no existing edges): ${orphans.length}`);

if (orphans.length === 0) {
  console.log('No orphans to process — static detection has fully covered the library.');
  process.exit(0);
}

const batches = buildBatches(orphans, allSeeds);
console.log(`Processing ${batches.length} batches (${BATCH_SIZE} seeds/batch)\n`);

// Build a set of all existing edges to deduplicate against
const existingPairs = new Set();
for (const s of allSeeds) {
  for (const targetId of existingEdgeIds(s)) {
    existingPairs.add(`${s.id}→${targetId}`);
    existingPairs.add(`${targetId}→${s.id}`); // bidirectional dedup
  }
}

const proposals = [];
const idSet     = new Set(allSeeds.map(s => s.id));
let   batchNum  = 0;

for (const { stack, seeds } of batches) {
  batchNum++;
  process.stdout.write(`  [${batchNum}/${batches.length}] ${stack} (${seeds.length} seeds)… `);

  let edges = [];
  try {
    edges = await callLLM(seeds);
    process.stdout.write(`${edges.length} raw suggestions\n`);
  } catch (e) {
    process.stdout.write(`ERROR: ${e.message.slice(0, 60)}\n`);
    continue;
  }

  // Filter and validate each proposed edge
  for (const edge of edges) {
    if (!edge?.from || !edge?.to || !edge?.type || typeof edge?.confidence !== 'number') continue;
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;          // unknown IDs
    if (edge.from === edge.to) continue;                                   // self-loop
    if (edge.confidence < MIN_CONF) continue;                              // below threshold
    if (existingPairs.has(`${edge.from}→${edge.to}`)) continue;           // already connected
    if (!['requires','see_also','co_inject','escalates_to','implies'].includes(edge.type)) continue;

    // Validate escalates_to severity direction
    if (edge.type === 'escalates_to') {
      const fromSeed = allSeeds.find(s => s.id === edge.from);
      const toSeed   = allSeeds.find(s => s.id === edge.to);
      const blastRank = { critical: 4, high: 3, medium: 2, low: 1 };
      if ((blastRank[fromSeed?.blast_radius] ?? 2) >= (blastRank[toSeed?.blast_radius] ?? 2)) continue;
    }

    proposals.push({
      from:          edge.from,
      to:            edge.to,
      type:          edge.type,
      confidence:    Math.round(edge.confidence * 100) / 100,
      justification: (edge.justification ?? '').slice(0, 300),
      source:        'llm-proposal',
      proposed_at:   new Date().toISOString(),
      batch_context: stack,
    });
    existingPairs.add(`${edge.from}→${edge.to}`); // prevent duplicates from later batches
  }

  // Polite rate limiting between batches
  if (batchNum < batches.length) await new Promise(r => setTimeout(r, 500));
}

console.log(`\n── Results ──`);
console.log(`  ${proposals.length} proposals above confidence ${MIN_CONF}`);

// Group by type for summary
const byType = {};
for (const p of proposals) (byType[p.type] = byType[p.type] ?? []).push(p);
for (const [type, ps] of Object.entries(byType)) {
  console.log(`  ${ps.length.toString().padStart(4)}  ${type}`);
}

if (proposals.length === 0) {
  console.log('\nNo qualifying proposals. Nothing to write.');
  process.exit(0);
}

// Show sample
console.log('\n── Sample proposals ──');
for (const p of proposals.slice(0, 8)) {
  console.log(`  [${p.confidence}] ${p.from} →${p.type}→ ${p.to}`);
  console.log(`         ${p.justification.slice(0, 80)}`);
}
if (proposals.length > 8) console.log(`  … and ${proposals.length - 8} more`);

if (DRY) {
  console.log('\n── Dry run — not writing ──');
  process.exit(0);
}

// Write output for GitHub Actions PR step
fs.mkdirSync(LODESTONE_DIR, { recursive: true });
const output = {
  schema_version: '1',
  generated_at:   new Date().toISOString(),
  model:          MODEL,
  total_proposals: proposals.length,
  min_confidence: MIN_CONF,
  proposals,
};
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
console.log(`\nWritten: ${OUTPUT_FILE}`);
console.log('GitHub Actions will open a draft PR for human review.');
