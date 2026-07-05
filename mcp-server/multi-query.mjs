/**
 * mcp-server/multi-query.mjs — Gap 2: Multi-Query Ensemble
 *
 * Generates 2-3 alternative query formulations and merges their retrieval
 * results with the primary BM25+dense results via RRF.
 *
 * Why multi-query helps: a developer describing "stale value in callback" may
 * be looking for the same seed that another session found via "closure captures
 * old snapshot." The alternative phrasings surface seeds that the original
 * query vocabulary doesn't reach, improving recall for ambiguous descriptions.
 *
 * Two tiers of alternatives:
 *   Mechanical (always active, zero latency):
 *     - Tag expansion: distinctive tags from the top BM25 result
 *     - Symptom boost: symptom text of the best-matching seed appended to query
 *
 *   LLM-optional (config: retrieval.multi_query.llm_enabled = true):
 *     - claude-haiku generates 2 alternative technical phrasings (~300ms)
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

const STOP = new Set(['the','and','for','not','with','this','that','from','are','was',
  'but','all','can','its','has','have','when','been','does','did','will','would',
  'could','should','than','then','into','over','after','out','due','per','via',
  'any','each','even','also','may','use','used','set','just','let','you','your']);

function tokenize(str) {
  return (str ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOP.has(t));
}

// ── Mechanical alternatives ────────────────────────────────────────────────

/**
 * mechanicalAlternatives(errorText, topCandidates)
 *
 * Returns [{text, weight, source}] — alternative query strings to retrieve with.
 * Always works without any model or API key.
 *
 * weight [0,1]: how much to trust results from this alternative
 *   (discounted because alternative queries are less certain than the primary)
 */
export function mechanicalAlternatives(errorText, topCandidates) {
  const alts = [];
  const origTokens = new Set(tokenize(errorText));

  // Alt 1: top tags from the top-3 BM25 results
  // Seeds often use tag vocabulary that developers don't type in queries
  const topTags = (topCandidates ?? [])
    .slice(0, 3)
    .flatMap(c => c.entry?.tags ?? c.tags ?? [])
    .filter(Boolean);
  const uniqueTags = [...new Set(topTags)]
    .filter(t => !origTokens.has(t.toLowerCase()))
    .slice(0, 8);
  if (uniqueTags.length >= 2) {
    alts.push({
      text:   uniqueTags.join(' '),
      weight: 0.70,
      source: 'tag_expansion',
    });
  }

  // Alt 2: symptom text of best candidate (if it differs meaningfully from query)
  const topSym = topCandidates?.[0]?.entry?.symptom ?? '';
  const symTokens = tokenize(topSym);
  const novelSymTokens = symTokens.filter(t => !origTokens.has(t)).slice(0, 6);
  if (novelSymTokens.length >= 3) {
    alts.push({
      text:   `${errorText} ${novelSymTokens.join(' ')}`,
      weight: 0.60,
      source: 'symptom_boost',
    });
  }

  return alts;
}

// ── LLM alternatives ───────────────────────────────────────────────────────

/**
 * llmAlternatives(errorText)
 *
 * Calls claude-haiku to generate 2 alternative technical phrasings of the query.
 * Returns [] when ANTHROPIC_API_KEY is absent or the call fails.
 * Adds ~300ms latency when active.
 */
export async function llmAlternatives(errorText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return [];

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',
        max_tokens: 180,
        messages: [{
          role:    'user',
          content: `A developer is experiencing: "${errorText.slice(0, 300)}"\n\n` +
                   `Write exactly 2 alternative technical phrasings of this problem, ` +
                   `one per line, no numbering or labels. Use different vocabulary.`,
        }],
      }),
    });

    if (!res.ok) return [];
    const data  = await res.json();
    const lines = (data.content?.[0]?.text ?? '').split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 12 && l.length < 250);

    return lines.slice(0, 2).map(text => ({ text, weight: 0.65, source: 'llm_phrasing' }));
  } catch {
    return [];
  }
}
