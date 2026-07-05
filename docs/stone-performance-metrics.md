# Stone Performance Metrics
*A quantitative and qualitative breakdown of how Lodestone Stones perform across key dimensions.*
*Based on 1,633 seeds across 87 stacks.*

---

## 1. Context Absorption
*How well does a Stone detect what you're working on and load the right seeds proactively?*

**What it means:** Before an error occurs, can the system recognise the current stack and task and pre-load relevant seeds? This is the preflight script's job for Claude Code sessions, and the extension's job for Claude.ai.

| Mechanism | Trigger | Latency | Accuracy |
|---|---|---|---|
| Extension (claude.ai) | Conversation scan every 2.5s | ~100ms | ~85% stack detection on named tech |
| Preflight script (Claude Code) | Run before session | ~200ms | ~90% on repos with clear file structure |
| Project instructions (Claude.ai, no MCP) | Error reported by developer | 0ms (passive) | Depends on Claude's initiative |
| MCP `get_session_brief` | Session start | ~50ms | Reads git context directly |

**Strengths:** The extension's pattern matching covers language keywords, import statements, and code block fences well. Stack detection is reliable for any of the 87 supported stacks once a code snippet appears in conversation.

**Weaknesses:** Pure intent detection (knowing what you're *about to* write vs what's already broken) is not implemented. The system is reactive for most users. Multi-stack sessions (e.g., a React frontend calling a FastAPI backend) are detected but seeds are only loaded for the primary stack — no cross-stack preflight.

**Score: 6/10.** Solid for reactive use; limited for proactive prevention.

---

## 2. Seed Discovery (Symptom Matching)
*Given an error message or symptom, how reliably does the system find the right seed?*

**Symptom index stats (1,633 seeds, 6,412 tokens):**

| Metric | Value | Interpretation |
|---|---|---|
| Unique-match tokens | 3,138 (48%) | Half of all tokens map to exactly one seed — highly specific matches |
| High-collision tokens (>3 seeds) | 1,773 (27%) | Common words ('float', 'error', 'null') match many seeds — scoring needed |
| Avg seeds per token | 4.48 | Moderate disambiguation burden on the BM25 scorer |
| Seeds with WRONG+CORRECT+SYMPTOM | 1,538 / 1,606 (95%) | Near-complete W→C→S triad |
| Seeds with all three sections | 95% | Schema integrity is very high |

**Lookup pipeline quality:**

- **Local MCP (BM25 + graph):** Excellent. BM25 handles IDF properly, graph expansion pulls in `requires` co-seeds. The 48% unique-match rate means roughly half of all queries return a near-certain match with no disambiguation needed.
- **Remote (token count, Claude.ai):** Adequate. Degrades gracefully on common-word queries; specific error strings (stack traces, named exceptions) still produce clean matches.
- **Cold queries (no matching token):** Unhandled — returns empty. No semantic fallback exists without embeddings.

**The main gap:** Semantic similarity is absent. A query for *"my floating point subtraction gives garbage results"* matches `catastrophic_cancellation` via tokens like `floating`, `subtraction`, `results`. But *"my numbers stop making sense near equal values"* would miss it entirely — no token overlap. Embeddings would close this, but add significant infrastructure weight for a static site.

**Score: 7.5/10** for token-rich error strings. **4/10** for natural language descriptions without technical keywords.

---

## 3. Seed Creation (Capture Quality)
*How well does a Stone grow its own seeds from real sessions?*

**The `capture_fix` flow (MCP):**

1. Developer solves a bug
2. Calls `capture_fix(wrong, correct, symptom, stack)`
3. MCP server writes a new seed JSON to `seeds/{stack}.json`
4. `build-index.mjs` regenerates the index on next run (or GitHub Actions on push)

**Strengths:**
- Zero friction: one MCP call captures everything
- Provenance is automatic — `source: "capture_fix"`, timestamp, session context
- New seeds are immediately available to `lookup_symptom` in the same MCP session (in-memory index refresh)
- The schema is simple enough that most developers write valid seeds on first attempt

**Weaknesses:**
- Duplicate detection is manual — if you fix the same bug twice, you get two seeds. `review-seeds.mjs` catches duplicates in batch, but it's not called at capture time.
- Symptom quality depends entirely on what the developer types. Seeds captured mid-frustration often have vague symptoms ("it just doesn't work") that produce low lookup accuracy.
- No guided capture — the MCP call accepts anything. A lightweight prompt ("does your symptom contain the exact error string you'd paste into a search engine?") at capture time would materially improve seed quality.
- No bulk-capture from git blame — you can't point `capture_fix` at a commit diff and have it propose seeds automatically. This is a significant gap for retroactive seeding.

**Score: 7/10.** Frictionless capture is genuinely excellent. Quality variance is high.

---

## 4. Context Injection Quality
*Once seeds are selected, how well are they injected into the AI session?*

**Blast-radius coverage:**

| Level | Count | % of SeedBank | Injection priority |
|---|---|---|---|
| Critical | 35 | 2% | Always injected if matched |
| High | 129 | 8% | Injected up to 90% context pressure |
| Medium | 1,397 | 86% | Injected below 60% context pressure |
| Low | 45 | 2% | Injected below 20% context pressure |

The 86% medium concentration is the right shape for a mature library — most patterns are real but not catastrophic. The 35 critical seeds (data loss, security, silent corruption) form a hard floor that survives even high context pressure.

**Injection mechanism quality:**

The context pressure model (Kelly-inspired threshold math) is sophisticated. Seeds don't simply queue in blast order — they're re-scored against the session's current intent vector and context fill percentage. A high-blast seed irrelevant to the current task yields to a medium-blast seed that's directly relevant. This is the correct behaviour.

**Token efficiency:** Average seed content is ~95 tokens. At a typical injection of 6 seeds, that's ~570 tokens of context — less than 2% of a 32K context window. The budget impact is negligible.

**The main gap:** Injection is one-directional. Seeds inform the session but the session doesn't update seeds. If Claude fixes a bug using a seed's guidance, there's no mechanism for the session to signal "this seed was helpful" without an explicit `record_outcome` call. Outcome signal collection rate is therefore low, which means confidence scores drift slowly and staleness detection doesn't get the signal it needs.

**Score: 8/10.** The pressure model and blast weighting are genuinely well-designed. Outcome feedback loop is underdeveloped.

---

## 5. Relationship Graph Density
*How well-connected are seeds to each other?*

This is the most visible gap in the current SeedBank:

| Metric | Value |
|---|---|
| Seeds with any relationship edges | 84 / 1,606 (5%) |
| Orphan seeds (no edges) | 1,522 (95%) |
| Mathematics stack (new) | 17 / 27 (62%) — notably better |

A seed with no edges is an island. When `lookup_symptom` finds it, it can't pull in the related patterns that a developer encountering that bug almost always also needs. The `requires` relationship type (which triggers mandatory co-injection) exists but is almost never populated.

The mathematics stack (just integrated) shows what a well-connected library looks like: 62% of seeds have relationship edges, often pointing to conceptually adjacent patterns (e.g., `catastrophic_cancellation` → `naive_variance_formula_instability` → `condition_number_ill_conditioned_system`). If the full SeedBank reached 30% relationship density, recall quality would improve substantially.

**Score: 2/10.** The infrastructure is good; the data isn't there yet. This is the highest-leverage improvement available.

---

## 6. Henge Discovery (Community Seeds)
*How well does Stonehub find and surface quality seeds from the community?*

**Current state:** The Henges tab queries `api.github.com/search/repositories?q=topic:lodestone`. At launch, this returns only the main repo itself. As the community grows, this will surface genuine Henges.

**Discovery quality (design):**
- Henge cards show stars, seed count, stacks, reputation grade, and stone_type badge — more signal than most package registries
- Seed cards within Henges are individually browsable and graftable
- The "Add a Henge" modal allows direct URL addition for unlisted Henges
- Preflight validation (HEAD check for `lodestone-stats.json`) prevents dead links

**Discovery quality (practice):**
- At current scale (1 Henge), meaningful community discovery doesn't exist yet
- No ranking beyond GitHub stars — a 0-star Henge with 200 excellent seeds ranks below a 5-star Henge with 5 mediocre ones
- No cross-Henge deduplication in the SeedBank tab — if two Henges have the same seed, both appear

**Score: N/A currently, design target: 7/10.** The architecture is solid; it needs a community to realise its potential. The reputation system is the right foundation once seeds accumulate outcome data.

---

## 7. Stack Coverage Uniformity
*Are all supported stacks equally well-served?*

| Metric | Value |
|---|---|
| Stack count | 87 |
| Mean seeds per stack | 18.5 |
| Median seeds per stack | 20 |
| Standard deviation | 3.8 |
| Stacks with < 10 seeds | 4 (`distill`, `web-privacy`, `web-seo-content`, `web-performance`) |
| Stacks with > 20 seeds | 2 (`gdscript` at 30, `threejs` at 21) |

The distribution is remarkably uniform. A 3.8 standard deviation on a mean of 18.5 means most stacks are within ±20% of the average. The four underpopulated stacks are all either meta-stacks (`distill` at 4, which should be renamed/merged) or newer domain-expansion stacks that haven't been fully seeded yet.

**Score: 8.5/10.** Better-distributed than most knowledge bases of this size.

---

## 8. Schema Integrity
*Are seeds well-formed?*

| Field | Present in | % |
|---|---|---|
| WRONG section | 1,565 / 1,606 | 97% |
| CORRECT section | 1,562 / 1,606 | 97% |
| SYMPTOM section | 1,606 / 1,606 | 100% |
| All three (W→C→S) | 1,538 / 1,606 | 95% |
| Tags | 1,606 / 1,606 | 100% |
| Relationship graph | 84 / 1,606 | 5% |
| Doc reference (main SeedBank) | 0 / 1,606 | 0% |
| Doc reference (mathematics) | 27 / 27 | 100% |

The 100% symptom coverage is the most important figure — it's what makes token matching work. The 0% doc reference rate in the main SeedBank is notable: the mathematics stack demonstrates what a fully-cited library looks like. Adding `doc_reference` to existing seeds should be a contribution priority.

**Score: 9/10.** Excellent field coverage on the critical fields. Relationship graph and doc references are the clear gaps.

---

## Summary

| Dimension | Score | Primary gap |
|---|---|---|
| Context absorption | 6/10 | Reactive only; no proactive injection before error |
| Seed discovery (specific errors) | 7.5/10 | Cold/natural-language queries unhandled |
| Seed creation | 7/10 | Quality variance; no duplicate detection at capture |
| Context injection quality | 8/10 | Outcome feedback loop underdeveloped |
| Relationship graph density | 2/10 | 95% of seeds are orphans |
| Henge discovery | N/A | Community too small to evaluate |
| Stack coverage uniformity | 8.5/10 | 4 underpopulated stacks |
| Schema integrity | 9/10 | Doc references missing; relationships sparse |

**Overall: 7/10** for a pre-launch system. The injection architecture and schema integrity are genuinely solid. The relationship graph is the single biggest opportunity — bringing it from 5% to 30% density would improve discovery recall more than any other change. The mathematics stack's 62% relationship density is the benchmark to aim for.
