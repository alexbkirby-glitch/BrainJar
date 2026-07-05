#!/usr/bin/env node
/**
 * scripts/detect-relationships.mjs
 *
 * Analyses the seed library and suggests (or writes) four relationship types:
 *
 *   supersedes — same-stack seed that replaces an older one
 *   implies    — loading seed A should also surface seed B
 *   conflicts  — seeds that give contradictory advice (inject only one)
 *   see_also   — cross-stack seeds covering the same pattern
 *
 * Usage:
 *   node scripts/detect-relationships.mjs          # report to stdout
 *   node scripts/detect-relationships.mjs --write  # apply to seed files
 *   node scripts/detect-relationships.mjs --dry    # show what --write would do
 *
 * After --write, run build-index.mjs to rebuild the relationship graph
 * (api/symptom-index.json) which the MCP server reads at startup.
 *
 * MIT License — https://github.com/alexbkirby-glitch/Distill
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SEEDS_DIR = path.join(ROOT, 'seeds');

const WRITE = process.argv.includes('--write');
const DRY   = process.argv.includes('--dry');

// ── Helpers ───────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','and','for','not','with','this','that','from','are','was','but','all',
  'can','its','has','have','when','been','does','did','will','would','could',
  'should','than','then','into','over','after','out','due','per','via','any',
  'each','even','also','may','use','used','set','just','let','very','more',
]);

function tokenize(str) {
  return (str ?? '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

function extractSection(content, marker) {
  const re = new RegExp(`${marker}:\\s*([\\s\\S]*?)(?=WRONG:|CORRECT:|Symptom:|$)`, 'i');
  return (content ?? '').match(re)?.[1]?.trim() ?? '';
}

function extractSymptom(content) {
  return (content ?? '').match(/Symptom:\s*([\s\S]*?)(?=WRONG:|CORRECT:|$)/i)?.[1]?.trim() ?? '';
}

function extractWrong(content) {
  return (content ?? '').match(/WRONG:\s*([\s\S]*?)(?=CORRECT:|Symptom:|$)/i)?.[1]?.trim() ?? '';
}

// ── Load seeds ────────────────────────────────────────────────────────────────

function loadAllSeeds() {
  const all = [];
  for (const fname of fs.readdirSync(SEEDS_DIR).sort()) {
    if (!fname.endsWith('.json')) continue;
    const stack = fname.replace('.json', '');
    try {
      const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
      if (!Array.isArray(seeds)) continue;
      for (const s of seeds) {
        if (s.type && s.type !== 'knowledge') continue; // skip workflow/tool seeds
        all.push({ ...s, _stack: stack });
      }
    } catch {}
  }
  return all;
}

// ── Stack composition implies ─────────────────────────────────────────────────
//
// When you're using stack A, seeds from stack B are almost always relevant too.
// These are definitional (not statistical) — derived from framework relationships.
// Format: childStack → [parentStacks whose top seeds should be implied]

const STACK_IMPLIES = {
  // Frontend frameworks
  nextjs:              ['react', 'typescript'],
  'react-testing':     ['react', 'jest'],
  'react-apollo':      ['react', 'graphql'],
  rxjs:                ['typescript'],
  svelte:              ['typescript'],
  vue:                 ['typescript'],
  // Python ecosystem
  django:              ['python'],
  fastapi:             ['python'],
  flask:               ['python'],
  'django-celery':     ['django', 'celery', 'python'],
  'django-postgresql': ['django', 'postgresql', 'python'],
  pytest:              ['python'],
  pandas:              ['python', 'numpy'],
  pytorch:             ['python', 'numpy'],
  numpy:               ['python'],
  // Mathematics & data science
  mathematics:         ['numpy', 'python'],
  'llm-integration':   ['python', 'json'],
  // Mobile
  'flutter-firebase':  ['flutter'],
  reactnative:         ['react', 'typescript'],
  // JVM
  spring:              ['java'],
  'spring-docker':     ['spring', 'docker', 'java'],
  kafka:               ['java'],
  scala:               ['java'],
  kotlin:              ['java'],
  // Infrastructure
  kubernetes:          ['docker'],
  ansible:             ['bash'],
  terraform:           ['git'],
  'python-docker':     ['python', 'docker'],
  'nextjs-docker':     ['nextjs', 'docker'],
  nginx:               ['docker'],
  // Game dev
  'godot-csharp':      ['csharp'],
  'glsl-godot':        ['gdscript'],
  gamedev:             ['git'],
  unity:               ['csharp'],
  // Data / search
  elasticsearch:       ['python'],
  mongodb:             ['javascript'],
  // Testing
  playwright:          ['typescript'],
  jest:                ['typescript'],
  // API / protocols
  graphql:             ['typescript'],
  grpc:                ['python'],
  // Web security & quality
  'web-security':      ['nginx', 'express', 'django', 'fastapi'],
  'web-a11y':          ['css'],
  'web-performance':   ['css', 'nginx'],
  // Embedded / systems
  wasm:                ['rust', 'cpp'],
  // Databases
  'django-postgresql': ['postgresql'],
  prisma:              ['typescript', 'postgresql'],
  sqlite:              ['python'],
  mysql:               ['sql'],
};

// ── Conflict keyword pairs ────────────────────────────────────────────────────
// If two seeds in the same stack have similar titles but these opposing terms
// appear in their content, they likely give contradictory advice.

const OPPOSING_PAIRS = [
  ['always ', 'never '],
  ['use sync', 'use async'],
  ['synchronous', 'asynchronous'],
  ['mutable', 'immutable'],
  ['eager', 'lazy'],
  ['inline', 'external'],
  ['class component', 'function component'],
];

// ── Blast priority for choosing which seeds to imply ─────────────────────────
const BLAST_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

// ── Main detector ─────────────────────────────────────────────────────────────

function detect(allSeeds) {
  const suggestions = { supersedes: [], implies: [], conflicts: [], see_also: [] };
  const byStack = {};
  for (const s of allSeeds) (byStack[s._stack] = byStack[s._stack] ?? []).push(s);

  // 1. Stack composition implies
  for (const [childStack, parentStacks] of Object.entries(STACK_IMPLIES)) {
    const childSeeds = byStack[childStack] ?? [];
    if (!childSeeds.length) continue;

    for (const parentStack of parentStacks) {
      const parentSeeds = (byStack[parentStack] ?? [])
        .sort((a, b) => (BLAST_RANK[b.blast_radius ?? 'medium'] - BLAST_RANK[a.blast_radius ?? 'medium']))
        .slice(0, 4); // top 4 highest-blast seeds from parent
      if (!parentSeeds.length) continue;

      // The most critical child seeds imply the parent stack's top seeds
      const topChild = childSeeds
        .sort((a, b) => (BLAST_RANK[b.blast_radius ?? 'medium'] - BLAST_RANK[a.blast_radius ?? 'medium']))
        .slice(0, 3);

      for (const child of topChild) {
        for (const parent of parentSeeds) {
          if (child.id === parent.id) continue;
          suggestions.implies.push({
            from:       child.id,
            fromStack:  childStack,
            to:         parent.id,
            toStack:    parentStack,
            reason:     `${childStack} composes ${parentStack}`,
          });
        }
      }
    }
  }

  // 2. Cross-stack see_also by symptom + title token overlap
  // Now runs across ALL stacks (not a hardcoded subset)
  const allStackNames = Object.keys(byStack);

  for (let si = 0; si < allStackNames.length; si++) {
    for (let sj = si + 1; sj < allStackNames.length; sj++) {
      const stackA = allStackNames[si];
      const stackB = allStackNames[sj];
      const seedsA = byStack[stackA] ?? [];
      const seedsB = byStack[stackB] ?? [];

      for (const seedA of seedsA) {
        const symptomA = extractSymptom(seedA.content);
        const tokA = new Set(tokenize(`${seedA.title} ${symptomA}`));
        if (tokA.size < 3) continue;

        for (const seedB of seedsB) {
          const symptomB = extractSymptom(seedB.content);
          const tokB = new Set(tokenize(`${seedB.title} ${symptomB}`));
          if (tokB.size < 3) continue;

          const sharedTokens = [...tokA].filter(t => tokB.has(t)).length;
          const sim = sharedTokens / (tokA.size + tokB.size - sharedTokens);
          // Lowered threshold 0.25→0.18 with minimum shared-token guard
          if (sim >= 0.18 && sharedTokens >= 2) {
            suggestions.see_also.push({
              a: seedA.id, aStack: stackA,
              b: seedB.id, bStack: stackB,
              similarity:   Math.round(sim * 100) / 100,
              sharedTokens,
              reason: `symptom overlap (${Math.round(sim * 100)}%, ${sharedTokens} shared tokens)`,
            });
          }
        }
      }
    }
  }

  // 2b. Within-stack see_also by tag co-occurrence
  // Seeds in the same stack sharing ≥3 tags are linked as see_also
  for (const [stack, seeds] of Object.entries(byStack)) {
    for (let i = 0; i < seeds.length; i++) {
      for (let j = i + 1; j < seeds.length; j++) {
        const a = seeds[i], b = seeds[j];
        const tagsA = new Set(Array.isArray(a.tags) ? a.tags : []);
        const tagsB = new Set(Array.isArray(b.tags) ? b.tags : []);
        const sharedTags = [...tagsA].filter(t => tagsB.has(t));
        if (sharedTags.length >= 3) {
          suggestions.see_also.push({
            a: a.id, aStack: stack,
            b: b.id, bStack: stack,
            similarity:   Math.min(0.8, 0.4 + sharedTags.length * 0.1),
            sharedTokens: sharedTags.length,
            reason: `within-stack tag overlap (${sharedTags.join(', ')})`,
          });
        }
      }
    }
  }

  // 2c. Tag-cluster co_inject within stacks
  // Seeds sharing ≥3 tags get co_inject edges — bootstraps the cluster system
  // before session data accumulates (compute-clusters.mjs takes over later)
  suggestions.co_inject = suggestions.co_inject ?? [];
  for (const [stack, seeds] of Object.entries(byStack)) {
    for (let i = 0; i < seeds.length; i++) {
      for (let j = i + 1; j < seeds.length; j++) {
        const a = seeds[i], b = seeds[j];
        // Only co_inject peers at similar blast levels (don't force-inject low with critical)
        const blastDiff = Math.abs(
          (BLAST_RANK[a.blast_radius ?? 'medium'] || 2) -
          (BLAST_RANK[b.blast_radius ?? 'medium'] || 2)
        );
        if (blastDiff > 1) continue;

        const tagsA = new Set(Array.isArray(a.tags) ? a.tags : []);
        const tagsB = new Set(Array.isArray(b.tags) ? b.tags : []);
        const sharedTags = [...tagsA].filter(t => tagsB.has(t));
        if (sharedTags.length >= 3) {
          const confidence = Math.min(0.75, 0.45 + sharedTags.length * 0.08);
          suggestions.co_inject.push({
            a: a.id, aStack: stack,
            b: b.id, bStack: stack,
            confidence,
            reason: `tag cluster (${sharedTags.slice(0, 3).join(', ')})`,
          });
        }
      }
    }
  }

  // 3. Same-stack supersedes
  for (const [stack, seeds] of Object.entries(byStack)) {
    for (let i = 0; i < seeds.length; i++) {
      for (let j = i + 1; j < seeds.length; j++) {
        const a = seeds[i], b = seeds[j];
        const titleSim = jaccard(
          new Set(tokenize(a.title ?? '')),
          new Set(tokenize(b.title ?? ''))
        );

        // Deprecated flag is definitive
        if (a.deprecated && !b.deprecated && titleSim > 0.35) {
          suggestions.supersedes.push({
            newer: b.id, older: a.id, stack,
            reason: `${a.id} marked deprecated`,
          });
        } else if (b.deprecated && !a.deprecated && titleSim > 0.35) {
          suggestions.supersedes.push({
            newer: a.id, older: b.id, stack,
            reason: `${b.id} marked deprecated`,
          });
        }

        // Framework version difference — newer range supersedes older point
        if (titleSim > 0.55 && a.framework_version && b.framework_version) {
          const aIsRange = />=|>/.test(a.framework_version);
          const bIsRange = />=|>/.test(b.framework_version);
          if (aIsRange && !bIsRange) {
            suggestions.supersedes.push({ newer: a.id, older: b.id, stack, reason: 'version range vs point' });
          } else if (bIsRange && !aIsRange) {
            suggestions.supersedes.push({ newer: b.id, older: a.id, stack, reason: 'version range vs point' });
          }
        }
      }
    }
  }

  // 4. Same-stack conflicts by title similarity + opposing keyword pairs
  for (const [stack, seeds] of Object.entries(byStack)) {
    for (let i = 0; i < seeds.length; i++) {
      for (let j = i + 1; j < seeds.length; j++) {
        const a = seeds[i], b = seeds[j];
        const titleSim = jaccard(
          new Set(tokenize(a.title ?? '')),
          new Set(tokenize(b.title ?? ''))
        );
        if (titleSim < 0.3) continue;

        const ca = (a.content ?? '').toLowerCase();
        const cb = (b.content ?? '').toLowerCase();

        for (const [w1, w2] of OPPOSING_PAIRS) {
          if ((ca.includes(w1) && cb.includes(w2)) || (ca.includes(w2) && cb.includes(w1))) {
            suggestions.conflicts.push({
              a: a.id, b: b.id, stack,
              reason: `similar titles, opposing advice ("${w1.trim()}" vs "${w2.trim()}")`,
            });
            break;
          }
        }
      }
    }
  }

  // 3a. Requires detection — prerequisite patterns in CORRECT section
  // "before using X", "ensure Y first", "always Z before" → Z requires Y
  const REQUIRES_BEFORE = [
    /(?:always|must|first)\s+(.{5,60}?)\s+before\s+(?:using|applying|running|creating|calling)/i,
    /ensure\s+(.{5,60}?)\s+(?:exists?|is\s+(?:configured|set\s*up|running|ready))\s+(?:first|before)/i,
    /(?:prerequisite|requires?)\s*:?\s+(.{5,80}?)(?:\.|,|$)/i,
  ];

  for (const seed of allSeeds) {
    const correct = extractSection(seed.content ?? '', 'CORRECT');
    if (!correct) continue;

    for (const pattern of REQUIRES_BEFORE) {
      const m = correct.match(pattern);
      if (!m) continue;
      const phrase = m[1].trim();
      const phraseToks = new Set(tokenize(phrase));
      if (phraseToks.size < 2) continue;

      // Find same-stack seeds whose title tokens overlap strongly with the phrase
      for (const other of allSeeds) {
        if (other.id === seed.id || other._stack !== seed._stack) continue;
        const otherToks = new Set(tokenize(other.title ?? ''));
        const overlap = [...phraseToks].filter(t => otherToks.has(t)).length;
        if (overlap >= 2 && overlap / phraseToks.size >= 0.45) {
          suggestions.requires = suggestions.requires ?? [];
          suggestions.requires.push({
            from:       seed.id,
            to:         other.id,
            fromStack:  seed._stack,
            reason:     `"${phrase.slice(0,50)}" in CORRECT`,
            confidence: Math.min(0.9, 0.5 + overlap / phraseToks.size * 0.5),
            source:     'content-detected',
          });
          break; // one requires per pattern match
        }
      }
    }
  }

  // 3b. Temporal sequence detection — ordering language
  // "after X, do Y" → X precedes Y; "first X then Y" → X precedes Y
  const PRECEDES_PATTERNS = [
    /after\s+(.{5,50}?)(?:[,;]\s*|\s+(?:always|then|you|make))/i,
    /once\s+(.{5,50}?)\s+(?:is|are|has)\s+(?:complete|done|finished|ready)/i,
    /following\s+(.{5,50}?)(?:[,;]|$)/i,
  ];

  for (const seed of allSeeds) {
    const correct = extractSection(seed.content ?? '', 'CORRECT');
    const title   = seed.title ?? '';
    const text    = `${title} ${correct}`;

    for (const pattern of PRECEDES_PATTERNS) {
      const m = text.match(pattern);
      if (!m) continue;
      const phrase    = m[1].trim();
      const phraseToks = new Set(tokenize(phrase));
      if (phraseToks.size < 2) continue;

      for (const other of allSeeds) {
        if (other.id === seed.id || other._stack !== seed._stack) continue;
        const otherToks = new Set(tokenize(other.title ?? ''));
        const overlap = [...phraseToks].filter(t => otherToks.has(t)).length;
        if (overlap >= 2 && overlap / phraseToks.size >= 0.5) {
          suggestions.temporal_sequence = suggestions.temporal_sequence ?? [];
          // 'other' (the referenced action) precedes this 'seed'
          suggestions.temporal_sequence.push({
            before:    other.id,
            after:     seed.id,
            stack:     seed._stack,
            reason:    `"${phrase.slice(0,50)}" ordering in seed`,
            confidence: 0.65,
            source:    'content-detected',
          });
          break;
        }
      }
    }
  }

  // 3c. escalates_to — medium→high severity chains
  // If seed A (medium) and seed B (high/critical) share ≥2 tags AND
  // A's wrong approach tokens overlap with B's symptom, ignoring A leads to B
  suggestions.escalates_to = suggestions.escalates_to ?? [];
  for (const seed of allSeeds) {
    const seedBlast = BLAST_RANK[seed.blast_radius ?? 'medium'] || 2;
    if (seedBlast >= 3) continue; // only look at medium/low as sources

    const seedWrong = extractWrong(seed.content ?? '');
    const seedWrongToks = new Set(tokenize(seedWrong));
    if (seedWrongToks.size < 3) continue;

    const tagsA = new Set(Array.isArray(seed.tags) ? seed.tags : []);

    for (const other of allSeeds) {
      if (other.id === seed.id) continue;
      const otherBlast = BLAST_RANK[other.blast_radius ?? 'medium'] || 2;
      if (otherBlast <= seedBlast) continue; // only escalate upward

      const otherSymptom = extractSymptom(other.content ?? '');
      const otherSymToks = new Set(tokenize(otherSymptom));
      const overlap = [...seedWrongToks].filter(t => otherSymToks.has(t)).length;
      if (overlap < 2) continue;

      const tagsB = new Set(Array.isArray(other.tags) ? other.tags : []);
      const sharedTags = [...tagsA].filter(t => tagsB.has(t));
      if (sharedTags.length < 2) continue;

      suggestions.escalates_to.push({
        from:       seed.id,   fromStack: seed._stack,
        to:         other.id,  toStack:   other._stack,
        confidence: Math.min(0.85, 0.5 + overlap * 0.08 + sharedTags.length * 0.05),
        reason:     `wrong-approach tokens overlap symptom of higher-severity seed (${overlap} tokens, ${sharedTags.length} shared tags)`,
        source:     'severity-chain',
      });
    }
  }

  return suggestions;
}

// ── Edge format helpers ───────────────────────────────────────────────────────
// Seed files store relationships as either:
//   legacy: { "implies": ["seed_id"] }
//   weighted: { "implies": [{ "id": "seed_id", "confidence": 0.9, "source": "stack-rule" }] }
// Everything written by detect-relationships uses the weighted format.

// Edge weight in log-space: w = -log(1 - confidence)
// Converts [0,1] confidence to [0, ∞) for path-finding.
// In log-space, weights ADD — the shortest log-weight path is the max-likelihood path.
// 0.50 → 0.69  |  0.90 → 2.30  |  0.99 → 4.61  |  0.999 → 6.91
function logWeight(confidence) {
  const c = Math.min(Math.max(confidence, 0.001), 0.9999);
  return -Math.log1p(-c);  // numerically stable: -log(1-c)
}

function makeEdge(id, confidence, source, extra = {}) {
  return { id, confidence, log_weight: logWeight(confidence), source, ...extra };
}

function edgeId(e) { return typeof e === 'string' ? e : e.id; }

// ── Apply relationships to seed files ─────────────────────────────────────────

function buildChangeset(suggestions) {
  // cs[seed_id][rel] = Map<id → edge_object>
  const cs = {};

  const addEdge = (seedId, rel, edge) => {
    cs[seedId]      = cs[seedId]      ?? {};
    cs[seedId][rel] = cs[seedId][rel] ?? new Map();
    const existing = cs[seedId][rel].get(edge.id);
    // Keep highest-confidence edge if we see the same target twice
    if (!existing || edge.confidence > existing.confidence) {
      cs[seedId][rel].set(edge.id, edge);
    }
  };

  for (const e of suggestions.implies) {
    addEdge(e.from, 'implies', makeEdge(e.to,    e.confidence ?? 0.9, e.source ?? 'stack-rule'));
  }
  for (const e of suggestions.see_also) {
    addEdge(e.a, 'see_also', makeEdge(e.b, e.similarity ?? 0.6, 'similarity-detected'));
    addEdge(e.b, 'see_also', makeEdge(e.a, e.similarity ?? 0.6, 'similarity-detected'));
  }
  for (const e of suggestions.supersedes) {
    addEdge(e.newer, 'supersedes', makeEdge(e.older, 1.0, e.source ?? 'version-detected'));
  }
  for (const e of suggestions.conflicts) {
    addEdge(e.a, 'conflicts', makeEdge(e.b, e.confidence ?? 0.8, 'keyword-detected'));
    addEdge(e.b, 'conflicts', makeEdge(e.a, e.confidence ?? 0.8, 'keyword-detected'));
  }
  for (const e of (suggestions.requires ?? [])) {
    addEdge(e.from, 'requires', makeEdge(e.to, e.confidence ?? 0.75, e.source ?? 'content-detected'));
  }
  for (const e of (suggestions.temporal_sequence ?? [])) {
    addEdge(e.before, 'temporal_sequence',
      makeEdge(e.after, e.confidence ?? 0.7, e.source ?? 'content-detected', { position: 'precedes' }));
  }
  for (const e of (suggestions.co_inject ?? [])) {
    addEdge(e.a, 'co_inject', makeEdge(e.b, e.confidence ?? 0.65, 'tag-cluster'));
    addEdge(e.b, 'co_inject', makeEdge(e.a, e.confidence ?? 0.65, 'tag-cluster'));
  }
  for (const e of (suggestions.escalates_to ?? [])) {
    addEdge(e.from, 'escalates_to', makeEdge(e.to, e.confidence ?? 0.7, e.source ?? 'severity-chain'));
  }

  // Serialize Maps back to arrays
  const serialized = {};
  for (const [sid, rels] of Object.entries(cs)) {
    serialized[sid] = {};
    for (const [rel, edgeMap] of Object.entries(rels)) {
      serialized[sid][rel] = [...edgeMap.values()];
    }
  }
  return serialized;
}

function applyChangeset(cs, seedsDir, dry = false) {
  let totalFiles = 0, totalSeeds = 0;
  const summary = [];

  for (const fname of fs.readdirSync(seedsDir).sort()) {
    if (!fname.endsWith('.json')) continue;
    const fp = path.join(seedsDir, fname);
    let seeds;
    try { seeds = JSON.parse(fs.readFileSync(fp, 'utf8')); }
    catch { continue; }
    if (!Array.isArray(seeds)) continue;

    let modified = false;
    for (const seed of seeds) {
      const delta = cs[seed.id];
      if (!delta) continue;

      seed.relationships = seed.relationships ?? {};
      for (const [rel, newEdges] of Object.entries(delta)) {
        // Normalize existing edges to weighted format
        const existingMap = new Map(
          (seed.relationships[rel] ?? []).map(e =>
            typeof e === 'string' ? [e, makeEdge(e, 1.0, 'legacy')] : [e.id, e]
          )
        );
        const before = existingMap.size;
        for (const edge of newEdges) {
          const ex = existingMap.get(edge.id);
          if (!ex || edge.confidence > ex.confidence) existingMap.set(edge.id, edge);
        }
        if (existingMap.size > before || newEdges.some(e => {
          const ex = existingMap.get(e.id);
          return ex && e.confidence > (ex._written_confidence ?? 0);
        })) {
          seed.relationships[rel] = [...existingMap.values()];
          modified = true;
          totalSeeds++;
          summary.push(`  ${seed.id}: ${rel} (${existingMap.size} edges)`);
        }
      }
    }

    if (modified) {
      if (!dry) fs.writeFileSync(fp, JSON.stringify(seeds, null, 2));
      totalFiles++;
    }
  }

  return { totalFiles, totalSeeds, summary };
}

// ── Report ────────────────────────────────────────────────────────────────────

function report(suggestions) {
  const { supersedes, implies, conflicts, see_also } = suggestions;
  const requires     = suggestions.requires      ?? [];
  const temporal     = suggestions.temporal_sequence ?? [];
  const co_inject    = suggestions.co_inject     ?? [];
  const escalates_to = suggestions.escalates_to  ?? [];

  console.log(`\nRelationship detection results:\n`);
  console.log(`  ${implies.length.toString().padStart(5)}  implies`);
  console.log(`  ${see_also.length.toString().padStart(5)}  see_also`);
  console.log(`  ${co_inject.length.toString().padStart(5)}  co_inject (tag-cluster)`);
  console.log(`  ${requires.length.toString().padStart(5)}  requires`);
  console.log(`  ${escalates_to.length.toString().padStart(5)}  escalates_to`);
  console.log(`  ${temporal.length.toString().padStart(5)}  temporal_sequence`);
  console.log(`  ${supersedes.length.toString().padStart(5)}  supersedes`);
  console.log(`  ${conflicts.length.toString().padStart(5)}  conflicts\n`);

  if (see_also.length) {
    console.log(`── Cross-stack + within-stack see_also (top 10 by similarity) ──`);
    const top = [...see_also].sort((a, b) => b.similarity - a.similarity).slice(0, 10);
    for (const { a, aStack, b, bStack, similarity, reason } of top) {
      console.log(`  [${aStack}] ${a} ↔ [${bStack}] ${b}  (${similarity}) — ${reason}`);
    }
    if (see_also.length > 10) console.log(`  … and ${see_also.length - 10} more`);
    console.log('');
  }

  if (co_inject.length) {
    console.log(`── co_inject clusters (sample) ──`);
    for (const { a, b, aStack, confidence, reason } of co_inject.slice(0, 6)) {
      console.log(`  [${aStack}] ${a} ⟺ ${b}  (${confidence.toFixed(2)}) — ${reason}`);
    }
    if (co_inject.length > 6) console.log(`  … and ${co_inject.length - 6} more`);
    console.log('');
  }

  if (escalates_to.length) {
    console.log(`── escalates_to severity chains (sample) ──`);
    for (const { from, fromStack, to, toStack, confidence } of escalates_to.slice(0, 6)) {
      console.log(`  [${fromStack}] ${from} → [${toStack}] ${to}  (${confidence.toFixed(2)})`);
    }
    if (escalates_to.length > 6) console.log(`  … and ${escalates_to.length - 6} more`);
    console.log('');
  }

  if (implies.length) {
    console.log(`── Stack implies (sample) ──`);
    for (const { from, fromStack, to, toStack, reason } of implies.slice(0, 8)) {
      console.log(`  [${fromStack}] ${from} → [${toStack}] ${to}  (${reason})`);
    }
    if (implies.length > 8) console.log(`  … and ${implies.length - 8} more`);
    console.log('');
  }

  if (supersedes.length) {
    console.log(`── Supersedes ──`);
    for (const { newer, older, stack, reason } of supersedes.slice(0, 6)) {
      console.log(`  [${stack}] ${newer} supersedes ${older}  (${reason})`);
    }
    console.log('');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('detect-relationships.mjs\n');

const allSeeds = loadAllSeeds();
console.log(`Loaded ${allSeeds.length} knowledge seeds across ${new Set(allSeeds.map(s => s._stack)).size} stacks`);

const suggestions = detect(allSeeds);
report(suggestions);

if (WRITE || DRY) {
  const cs = buildChangeset(suggestions);
  const { totalFiles, totalSeeds, summary } = applyChangeset(cs, SEEDS_DIR, DRY);

  console.log(DRY ? '── Dry run — would write ──' : '── Writing relationships ──');
  summary.slice(0, 20).forEach(l => console.log(l));
  if (summary.length > 20) console.log(`  … and ${summary.length - 20} more`);
  console.log(`\n${DRY ? 'Would update' : 'Updated'} ${totalSeeds} seeds across ${totalFiles} files.`);
  if (!DRY) console.log('Run node scripts/build-index.mjs to rebuild the graph.');
} else {
  console.log('Run with --write to apply relationships, --dry to preview.');
}
