/**
 * mcp-server/query-expansion.mjs — Phase 4: Query Expansion
 *
 * Three sub-phases that broaden the token set before BM25 retrieval, catching
 * seeds where vocabulary diverges from the query:
 *
 *   4a  graphExpand  — uses see_also / implies edges from the relationship graph.
 *                      Mechanical. No model, no build step.
 *
 *   4b  synonymExpand — uses corpus-mined PMI synonyms from api/term-synonyms.json.
 *                       Mechanical. Needs `npm run build:synonyms` first.
 *
 *   4c  hydeEmbed    — generates a hypothetical seed via LLM, returns its embedding
 *                      vector for use as a second dense query. LLM-optional; needs
 *                      ANTHROPIC_API_KEY in env. Safe no-op if unavailable.
 *
 * Main export:
 *   expandTokens(tokens, relGraph, termIndex, indexed, synonymMap, maxNew?)
 *     → string[]  (original tokens + expansion terms, ready for BM25)
 *
 *   hydeEmbed(queryText)
 *     → Promise<number[] | null>  (embedding vector or null)
 *
 *   loadSynonymMap(rootPath)
 *     → Object | null  (cached; null when not built yet)
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';

// ── Shared tokenizer (mirrors the one in index.mjs) ────────────────────────

const STOPWORDS = new Set([
  'the','and','for','not','with','this','that','from','are','was','but',
  'all','can','its','has','have','when','been','does','did','will','would',
  'could','should','than','then','into','over','after','out','due','per',
  'via','any','each','even','also','may','use','used','set','just','let',
]);

function tokenize(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

// ── Synonym map cache ──────────────────────────────────────────────────────

let _synonymMap     = undefined; // undefined = not loaded; null = absent; {} = loaded
let _synonymMapPath = '';

export function loadSynonymMap(rootPath) {
  const p = path.join(rootPath, 'api', 'term-synonyms.json');
  if (_synonymMap !== undefined && p === _synonymMapPath) return _synonymMap;
  _synonymMapPath = p;
  try {
    _synonymMap = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    _synonymMap = null; // not built yet — graceful no-op
  }
  return _synonymMap;
}

// ── 4a: Graph-based expansion ──────────────────────────────────────────────
//
// Finds the top-3 seeds for the current tokens via a fast index lookup, then
// pulls distinctive terms from their see_also / implies neighbours.
// Only adds tokens that are specific (IDF < 0.30) and not already in the query.

function graphExpand(tokens, relGraph, termIndex, indexed, maxNew = 8) {
  if (!relGraph || !Object.keys(relGraph).length) return tokens;
  if (!tokens.length || !indexed.length) return tokens;

  // Fast initial hit-count (no full BM25 needed)
  const hitCount = new Map();
  for (const t of tokens) {
    for (const entry of (termIndex[t] ?? [])) {
      hitCount.set(entry.id, (hitCount.get(entry.id) ?? 0) + 1);
    }
  }
  const topIds = [...hitCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  if (!topIds.length) return tokens;

  // IDF guard: skip tokens that appear in > 30% of indexed entries (too generic)
  const N = indexed.length;
  const isTooCommon = t => (termIndex[t]?.length ?? 0) / N > 0.30;

  const entryById    = Object.fromEntries(indexed.map(e => [e.id, e]));
  const currentToks  = new Set(tokens);
  const newToks      = new Set();

  for (const seedId of topIds) {
    const rels = relGraph[seedId] ?? {};
    const neighbourIds = [
      ...(rels.see_also ?? []).map(e => typeof e === 'string' ? e : e.id),
      ...(rels.implies  ?? []).map(e => typeof e === 'string' ? e : e.id),
    ].slice(0, 5); // cap neighbours per seed

    for (const nid of neighbourIds) {
      const nb = entryById[nid];
      if (!nb) continue;
      const nbToks = tokenize(`${nb.title ?? ''} ${nb.symptom ?? ''}`);
      for (const t of nbToks) {
        if (!currentToks.has(t) && !isTooCommon(t) && !newToks.has(t)) {
          newToks.add(t);
        }
        if (newToks.size >= maxNew) break;
      }
      if (newToks.size >= maxNew) break;
    }
    if (newToks.size >= maxNew) break;
  }

  return newToks.size ? [...tokens, ...newToks] : tokens;
}

// ── 4b: Synonym expansion ──────────────────────────────────────────────────
//
// Detects the probable stack from the top BM25 hit, then for each query token
// adds corpus-mined PMI synonyms from api/term-synonyms.json.
// Stack-scoped to prevent cross-domain noise.

function detectStack(termIndex, tokens) {
  const stackCount = new Map();
  for (const t of tokens) {
    for (const entry of (termIndex[t] ?? [])) {
      stackCount.set(entry.stack, (stackCount.get(entry.stack) ?? 0) + 1);
    }
  }
  if (!stackCount.size) return null;
  return [...stackCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function synonymExpand(tokens, termIndex, synonymMap, maxNew = 6) {
  if (!synonymMap) return tokens;
  const stack = detectStack(termIndex, tokens);
  if (!stack) return tokens;
  const stackSyns = synonymMap[stack];
  if (!stackSyns) return tokens;

  const current = new Set(tokens);
  const newToks  = [];

  for (const t of tokens) {
    for (const syn of (stackSyns[t] ?? [])) {
      if (!current.has(syn) && !newToks.includes(syn)) {
        newToks.push(syn);
        if (newToks.length >= maxNew) break;
      }
    }
    if (newToks.length >= maxNew) break;
  }

  return newToks.length ? [...tokens, ...newToks] : tokens;
}

// ── Main expand entry point ────────────────────────────────────────────────

/**
 * expandTokens(tokens, relGraph, termIndex, indexed, synonymMap, maxNew?)
 *
 * Applies 4a (graph) then 4b (synonyms) in sequence. Returns the expanded
 * token array. Never throws — returns original tokens on any error.
 *
 * @param {string[]} tokens      — original tokenize(query) output
 * @param {Object}   relGraph    — loadRelationshipGraph() result
 * @param {Object}   termIndex   — getLocalIndex().index
 * @param {Array}    indexed     — getLocalIndex().indexed
 * @param {Object}   synonymMap  — loadSynonymMap(ROOT) result (null = disabled)
 * @param {number}   maxNew      — max expansion terms (split evenly between 4a/4b)
 */
export function expandTokens(tokens, relGraph, termIndex, indexed, synonymMap, maxNew = 12) {
  try {
    const half = Math.ceil(maxNew / 2);
    let t = graphExpand(tokens, relGraph, termIndex, indexed, half);
        t = synonymExpand(t, termIndex, synonymMap, half);
    return t;
  } catch {
    return tokens; // never fail the lookup
  }
}

// ── 4c: HyDE (Hypothetical Document Embeddings) ────────────────────────────
//
// Generates a hypothetical ideal seed for the query using claude-haiku, then
// returns its embedding vector for use as a secondary dense query.
//
// Requires: ANTHROPIC_API_KEY in env, api/seed-embeddings.json built (Phase 1)
// Config:   retrieval.query_expansion.hyde_enabled = true in .lodestone/config.json
// Adds:     ~800–1400ms latency per lookup_symptom call when active

const HYDE_MODEL  = 'claude-haiku-4-5';
const HYDE_PROMPT = (symptom) =>
  `A developer is experiencing this problem:\n"${symptom}"\n\n` +
  `Write a concise technical antipattern seed. Use exactly this format:\n` +
  `WRONG: [the wrong approach, 1–2 sentences]\n` +
  `CORRECT: [the correct approach, 1–2 sentences]\n` +
  `Symptom: [what the developer observes, 1 sentence]\n\n` +
  `Be specific and technical. Use vocabulary a developer would search for.`;

async function callAnthropic(queryText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      HYDE_MODEL,
      max_tokens: 300,
      messages:   [{ role: 'user', content: HYDE_PROMPT(queryText) }],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? null;
}

let _embedFn = null; // injected on first call (lazy import avoids circular dep)

/**
 * hydeEmbed(queryText) → Promise<number[] | null>
 *
 * Generates a hypothetical seed via LLM and returns its embedding vector.
 * Returns null when the API key is absent, the call fails, or embeddings
 * are not built yet.
 */
export async function hydeEmbed(queryText) {
  try {
    // Lazy-load the embed function from embeddings.mjs to avoid circular import
    if (!_embedFn) {
      const mod = await import('./embeddings.mjs');
      _embedFn = mod.embed;
    }
    if (!_embedFn) return null;

    const hypotheticalSeed = await callAnthropic(queryText);
    if (!hypotheticalSeed) return null;

    const vecs = await _embedFn([hypotheticalSeed]);
    return vecs ? vecs[0] : null;
  } catch {
    return null;
  }
}
