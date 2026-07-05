/**
 * mcp-server/session-retrieval.mjs — Phase 6: Session-Adaptive Retrieval
 *
 * Utility functions for the session_update MCP tool and drift detection in
 * lookup_symptom. These are pure computations — no file I/O, no async.
 * The tool handler in index.mjs owns state and side-effects.
 *
 * Exports:
 *   computeDrift(vecA, vecB)                          — cosine distance [0, 1]
 *   computeSessionDiff(session, newMatches, maxNew)   — diff between sessions
 *   DRIFT_THRESHOLD  (0.35)
 *   DRIFT_GRACE_CALLS (3)
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

// ── Tuning constants ───────────────────────────────────────────────────────

/**
 * Cosine distance above which a query shift is flagged as meaningful drift.
 * 0.35 ≈ ~70° angle between query vectors — substantial topic change.
 * Lower = more sensitive (flags earlier). Higher = less sensitive.
 */
export const DRIFT_THRESHOLD = 0.35;

/**
 * Number of lookup_symptom calls to let pass before drift is checked.
 * The first few calls in a session are often exploratory; checking too early
 * produces false positives.
 */
export const DRIFT_GRACE_CALLS = 3;

// ── Drift computation ──────────────────────────────────────────────────────

/**
 * computeDrift(vecA, vecB) → number | null
 *
 * Cosine distance between two L2-normalised vectors.
 * For normalised vectors: cosine distance = 1 − dot product.
 *
 * Returns:
 *   0.0  — identical queries (no drift)
 *   0.35 — meaningful topic shift (DRIFT_THRESHOLD)
 *   1.0  — completely orthogonal (maximum observable drift)
 *   null — if either vector is missing or mismatched
 */
export function computeDrift(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return null;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
  // Clamp to [0, 1] — floating-point noise can push dot slightly above 1
  return Math.max(0, Math.min(1, 1 - dot));
}

// ── Session diff computation ───────────────────────────────────────────────

/**
 * computeSessionDiff(currentSession, newMatches, maxNew = 5)
 *
 * Computes the delta between the current injection set and a new retrieval result.
 *
 * @param {Object|null} currentSession  — contents of last-session.json (or null)
 * @param {Array}       newMatches      — matches[] from lookupSymptom result
 * @param {number}      maxNew          — cap on supplement seeds returned
 *
 * @returns {{
 *   new_seeds: Seed[],       — recommended seeds NOT already in the injected set
 *   retired_seeds: string[], — injected seed IDs absent from the top-N new results
 *   existingIds: Set<string> — the current injected ID set (for caller reference)
 * }}
 */
export function computeSessionDiff(currentSession, newMatches, maxNew = 5) {
  const existingIds = new Set(
    (currentSession?.injected ?? [])
      .map(x => typeof x === 'string' ? x : x.id)
      .filter(Boolean)
  );

  // new_seeds: inject_recommended seeds not already in the session
  const new_seeds = newMatches
    .filter(m => m.id && !existingIds.has(m.id) && m.inject_recommended)
    .slice(0, maxNew);

  // retired_seeds: currently injected seeds that don't appear in the updated
  // top results — these are now less relevant to the refined diagnosis.
  // We look at a window of top-(maxNew + existingIds.size) to avoid prematurely
  // retiring seeds that ranked just outside the requested top-N.
  const lookWindow = maxNew + Math.max(existingIds.size, 5);
  const newTopIds  = new Set(newMatches.slice(0, lookWindow).map(m => m.id));
  const retired_seeds = [...existingIds].filter(id => !newTopIds.has(id));

  return { new_seeds, retired_seeds, existingIds };
}
