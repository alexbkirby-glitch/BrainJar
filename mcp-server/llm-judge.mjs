/**
 * mcp-server/llm-judge.mjs — Gap 5: LLM-as-Judge Reranking
 *
 * Uses claude-haiku to rate candidate seed relevance in a single batched call,
 * providing a more accurate relevance signal than the cross-encoder for subtle
 * cases where context, intent, or technical nuance matters.
 *
 * When to enable:
 *   The cross-encoder (Phase 3) is excellent for most queries. Enable the LLM
 *   judge for high-stakes sessions (complex architectural debugging, security
 *   review, production incidents) where the extra accuracy justifies ~600ms.
 *
 * Config: retrieval.llm_judge.enabled = true in .lodestone/config.json
 * Requires: ANTHROPIC_API_KEY in env
 * Latency: ~500-700ms for 10 candidates (one batched API call, claude-haiku)
 *
 * The judge scores each seed 0-10. Scores are normalized to [0,1] and stored
 * as llm_judge_score in _debug alongside the cross-encoder score.
 *
 * Pipeline position: after Phase 3 (cross-encoder), before evaluateInjection.
 * When active, llm_judge_score replaces reranker_score as the primary similarity
 * signal in the evaluateInjection call.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

const JUDGE_MODEL  = 'claude-haiku-4-5';
const JUDGE_TOP_K  = 10;  // max candidates to judge per call (latency budget)

/**
 * llmJudgeRerank(queryText, candidates, { enabled })
 *
 * Rates candidates via LLM and re-sorts by llm_judge_score (desc).
 * Returns candidates unchanged when disabled, key absent, or call fails.
 *
 * Each returned candidate gains llm_judge_score ∈ [0,1] in its data.
 */
export async function llmJudgeRerank(queryText, candidates, { enabled = false } = {}) {
  if (!enabled || !candidates?.length) return candidates;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return candidates;

  const toJudge = candidates.slice(0, JUDGE_TOP_K);

  // Build compact seed descriptions for the prompt
  const seedLines = toJudge.map((c, i) => {
    const e = c.entry ?? {};
    const sym = (e.symptom ?? '').slice(0, 130);
    return `[${i}] ${e.title ?? e.id ?? '?'}: ${sym}`;
  }).join('\n');

  const prompt =
    `You are evaluating which seeds (antipattern records) are most relevant to a developer's problem.\n\n` +
    `Problem: "${queryText.slice(0, 300)}"\n\n` +
    `Rate each seed 0–10 (0 = completely irrelevant, 10 = directly addresses this problem).\n` +
    `Respond with ONLY a JSON array of integers, one per seed, e.g.: [8,3,7,...]\n\n` +
    `Seeds:\n${seedLines}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      JUDGE_MODEL,
        max_tokens: 80,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return candidates;
    const data  = await res.json();
    const text  = data.content?.[0]?.text ?? '';

    // Extract JSON array robustly
    const match  = text.match(/\[[\s\d,]+\]/);
    if (!match) return candidates;
    const scores = JSON.parse(match[0]);

    // Annotate and re-sort the judged portion
    const judged = toJudge.map((c, i) => ({
      ...c,
      llm_judge_score: scores[i] != null ? Math.max(0, Math.min(10, scores[i])) / 10 : null,
    }));
    judged.sort((a, b) => (b.llm_judge_score ?? 0) - (a.llm_judge_score ?? 0));

    return [...judged, ...candidates.slice(JUDGE_TOP_K)];
  } catch {
    return candidates; // graceful fallback
  }
}
