/**
 * mcp-server/attribution.mjs — Gap D: Token-Level Attribution (Approximation)
 *
 * Provides a heuristic estimate of which injected seeds actually influenced
 * the LLM's response, based on content overlap between the response text and
 * each seed's CORRECT field.
 *
 * Two tiers of attribution (best available used):
 *
 *   Tier 1 — Token overlap (always available, mechanical):
 *     attribution = |tokens(response) ∩ tokens(CORRECT)| / |tokens(CORRECT)|
 *     Measures: what fraction of the seed's CORRECT vocabulary appeared
 *     in the response? High score → the LLM likely applied the correction.
 *
 *   Tier 2 — Sentence-level embedding similarity (when Phase 1 model available):
 *     For each sentence in the response, compute cosine similarity to the seed's
 *     CORRECT embedding. Take the max across sentences.
 *     Captures: paraphrased applications ("I used useRef" ← "useRef or useCallback").
 *
 * Final score: max(token_overlap, embedding_sim) when both available,
 *              token_overlap otherwise.
 *
 * Important caveat: this is a heuristic, not ground truth. The LLM may echo
 * CORRECT vocabulary without applying the advice, or apply it in words not
 * in the CORRECT text. Use the results as suggestions to confirm, not facts.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SEEDS_DIR = path.join(ROOT, 'seeds');

// ── Tokenizer (mirrors the BM25 / expansion tokenizer) ────────────────────

const STOP = new Set(['the','and','for','not','with','this','that','from','are','was',
  'but','all','can','its','has','have','when','been','does','did','will','would',
  'could','should','than','then','into','over','after','out','due','per','via',
  'any','each','even','also','may','use','used','set','just','let','you','your',
  'should','must','need','make','makes','made','using','used','ensure','always',
  'never','avoid','instead','returns','return','call','calls','called',
]);

function tokenize(str) {
  return (str ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOP.has(t));
}

// ── Seed corpus loader (lazy, cached) ─────────────────────────────────────

let _seedCorpus = null;

function loadSeedCorpus() {
  if (_seedCorpus) return _seedCorpus;
  _seedCorpus = {};
  for (const fname of fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'))) {
    const stack = fname.replace('.json', '');
    try {
      const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8'));
      for (const seed of seeds) {
        if (seed.id) _seedCorpus[seed.id] = { ...seed, _stack: stack };
      }
    } catch {}
  }
  return _seedCorpus;
}

export function bustCorpusCache() { _seedCorpus = null; }

// ── Text extraction ────────────────────────────────────────────────────────

function extractCorrect(content) {
  const m = (content ?? '').match(/CORRECT:\s*([\s\S]*?)(?=WRONG:|Symptom:|$)/i);
  return m ? m[1].trim().slice(0, 1024) : '';
}

function splitSentences(text) {
  // Split on sentence boundaries — simple but effective for dev text
  return text.split(/(?<=[.!?])\s+(?=[A-Z])|(?<=\n)\s*(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 20);
}

// ── Tier 1: Token overlap ──────────────────────────────────────────────────

function tokenOverlapScore(responseText, correctText) {
  if (!correctText) return 0;
  const rToks = new Set(tokenize(responseText));
  const cToks = tokenize(correctText);
  if (!cToks.length) return 0;
  const matches = cToks.filter(t => rToks.has(t)).length;
  return matches / cToks.length; // recall: what fraction of CORRECT was echoed?
}

// ── Tier 2: Sentence-level embedding similarity (optional) ─────────────────

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function embeddingSimScore(responseText, correctText, embedFn) {
  if (!embedFn || !correctText) return null;
  try {
    const sentences   = splitSentences(responseText).slice(0, 10); // cap for latency
    if (!sentences.length) return null;

    const texts       = [...sentences, correctText];
    const vecs        = await embedFn(texts);
    if (!vecs || vecs.length < texts.length) return null;

    const correctVec  = vecs[vecs.length - 1];
    const sentenceVecs = vecs.slice(0, sentences.length);

    const sims = sentenceVecs.map(v => dotProduct(v, correctVec));
    return Math.max(...sims); // best-matching sentence in the response
  } catch {
    return null;
  }
}

// ── Main attribution computation ───────────────────────────────────────────

/**
 * computeAttribution(responseText, injectedSeeds, embedFn?)
 *
 * Estimates which injected seeds influenced the LLM response.
 *
 * @param {string}   responseText   — the LLM's recent output text
 * @param {Array}    injectedSeeds  — from last-session.json .injected field
 * @param {Function} embedFn        — optional Phase 1 embed() for Tier 2
 * @param {number}   topK           — max results to return (default 5)
 *
 * @returns {AttributionResult}
 */
export async function computeAttribution(responseText, injectedSeeds, embedFn = null, topK = 5) {
  if (!responseText?.trim() || !injectedSeeds?.length) {
    return { attributed_seeds: [], suggested_cited_ids: [], tier: 'none' };
  }

  const corpus = loadSeedCorpus();
  const results = [];

  for (const inj of injectedSeeds) {
    const seedId = typeof inj === 'string' ? inj : inj.id;
    const rank   = typeof inj === 'object' ? (inj.rank ?? null) : null;
    if (!seedId) continue;

    const seed = corpus[seedId];
    if (!seed) continue;

    const correctText = seed.correct ?? extractCorrect(seed.content ?? '');
    if (!correctText) continue;

    // Tier 1: token overlap
    const tokenScore = tokenOverlapScore(responseText, correctText);

    // Tier 2: embedding similarity (optional, better for paraphrased applications)
    const embeddingScore = await embeddingSimScore(responseText, correctText, embedFn);

    // Final score: best available signal
    const score = embeddingScore != null
      ? Math.max(tokenScore, embeddingScore)
      : tokenScore;

    // Matching tokens (for transparency)
    const cToks    = new Set(tokenize(correctText));
    const rToks    = new Set(tokenize(responseText));
    const matching = [...cToks].filter(t => rToks.has(t)).slice(0, 8);

    results.push({
      id:               seedId,
      stack:            seed._stack ?? seed.stack,
      title:            seed.title,
      attribution_score: Math.round(score * 100) / 100,
      token_overlap:     Math.round(tokenScore * 100) / 100,
      ...(embeddingScore != null ? { embedding_sim: Math.round(embeddingScore * 100) / 100 } : {}),
      method:           embeddingScore != null ? 'token+embedding' : 'token_overlap',
      matching_tokens:  matching,
      inject_rank:      rank,
    });
  }

  results.sort((a, b) => b.attribution_score - a.attribution_score);
  const top = results.slice(0, topK);

  // Suggest seeds with score > 0.15 as likely-cited (threshold calibrated for token overlap)
  const CITE_THRESHOLD  = 0.15;
  const suggested = top
    .filter(r => r.attribution_score >= CITE_THRESHOLD)
    .map(r => r.id);

  const tier = results.some(r => r.method === 'token+embedding')
    ? 'token+embedding' : 'token_overlap';

  return {
    attributed_seeds:    top,
    suggested_cited_ids: suggested,
    tier,
    attribution_threshold: CITE_THRESHOLD,
  };
}
