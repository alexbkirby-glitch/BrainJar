# Auto-seed Pipeline: Anti-Bias Plan
*Preventing self-reinforcing epistemic drift in the Lodestone SeedBank*

---

## The Problem

The auto-seed pipeline discovers seeds from public Henges and stages them for grafting. Left unchecked, it creates a feedback loop: popular patterns get referenced more often → more Henges adopt them → they surface more frequently in discovery → they accumulate even higher scores. Seeds from less-visible authors, minority frameworks, or contrarian-but-correct positions get systematically underweighted. Over time, the SeedBank stops representing the best-known patterns and starts representing the most-repeated ones.

Three concrete failure modes:

**Popularity drift** — Seeds from high-star Henges are encountered more often in discovery. They accumulate provenance links, confidence scores, and co-occurrence signals that self-reinforce their own ranking.

**Stack monoculture** — Stacks with large communities (React, Python, TypeScript) naturally produce more Henges and more seeds. Smaller stacks become proportionally underrepresented even when their seeds are higher quality per-capita.

**Temporal lock-in** — Seeds written early accumulate more provenance chains. Later-arriving seeds for the same pattern (including corrections) score lower simply because they have fewer relationships, regardless of correctness.

---

## Proposed Mitigations

### 1. Source Diversity Floor

*Prevents any single Henge from dominating the SeedBank.*

For any new seed entering staging, if more than **20% of existing seeds in that stack** already trace provenance to the same `source_henge`, the candidate is held in a `deferred/` staging area rather than the normal `staged/` area. The next auto-seed run re-evaluates it against a freshness score that decays hold time.

**Implementation:**
- In `scripts/auto-seed.mjs`, before writing to `seeds/staged/`, check `provenance.source_henge` against the stack's existing seeds
- Add a `deferred_reason: "source_concentration"` field and `retry_after` timestamp
- Weekly runs clear deferred candidates if the concentration threshold is no longer exceeded

**Target:** No single Henge should contribute more than 20% of any stack's seeds in steady state.

---

### 2. Provenance Chain Length Normalisation

*Prevents early seeds from permanently outscoring later ones.*

Current scoring includes a `provenance_depth` signal — seeds with longer chains of co-occurrence score higher. This compounds over time. Normalise by dividing chain length by the seed's `created_at` age in months, so a seed with 12 provenance links created 12 months ago scores similarly to a seed with 1 link created 1 month ago.

**Implementation:**
- In `scripts/build-stats.mjs`, add an `age_normalised_provenance` field to each seed's stats
- Replace raw `provenance_depth` in the reputation scorer with the normalised value
- Existing seeds get a one-time backfill using their `created_at` date

---

### 3. Adversarial Seed Sampling

*Actively seeks under-represented perspectives during discovery.*

Once per quarter (in addition to the regular weekly run), the auto-seed workflow runs in "adversarial mode": it specifically searches for Henges whose seeds contradict, qualify, or update patterns already in the SeedBank. Concretely, it queries Henges for seeds whose `wrong` field matches the `correct` field of an existing seed (a reversal), or whose `title` matches an existing `title` with a different `correct` field.

These candidates are flagged `adversarial_candidate: true` and routed to a dedicated PR titled "⚡ Adversarial review" with elevated priority labels.

**Implementation:**
- Add `--mode adversarial` flag to `scripts/auto-seed.mjs`
- Schedule a separate quarterly cron in `.github/workflows/auto-seed.yml`
- Flag candidates in staging JSON and separate PR template

---

### 4. Stack Coverage Quota

*Prevents large stacks from crowding out small ones.*

Each auto-seed run allocates a maximum number of staged seeds per stack: `min(10, Math.ceil(total_candidates * (1 / num_active_stacks) * 1.5))`. Seeds for stacks below the SeedBank average (currently ~18 seeds/stack) get a 2× multiplier on their blast-radius scoring to compensate for sparse coverage.

**Implementation:**
- Add `per_stack_quota` calculation at the start of `scripts/auto-seed.mjs`
- Add `coverage_boost_applied: true` to seeds from underrepresented stacks
- Log quota decisions in the PR body for reviewer transparency

---

### 5. Correctness Decay for Unverified Seeds

*Removes seeds that accumulate zero outcome signal over time.*

Seeds enter the SeedBank as `verification_status: "community-reviewed"`. If a seed receives zero `record_outcome(clean)` calls after 6 months of being in circulation, it is automatically flagged `staleness_warning: true` in the next `build-stats.mjs` run. If the flag persists for another 3 months, the seed is moved to `seeds/deprecated/` and removed from the symptom index.

This creates natural pressure: bad or misleading seeds that nobody confirms as useful age out automatically without requiring explicit curation.

**Implementation:**
- Track `last_confirmed_at` and `clean_outcome_count` in `lodestone-stats.json` per seed
- Add staleness logic to `scripts/build-stats.mjs`
- Add a quarterly GitHub Actions job that opens a PR to move staleness-flagged seeds to `deprecated/`

---

### 6. Human Review Trigger: Concentration Alert

*Surfaces bias patterns before they compound.*

The validate workflow (already in place) should additionally run a concentration check on every PR that touches `seeds/`:

- If the PR would cause any single `source_henge` to represent >20% of a stack's seeds: **block merge** with a clear explanation
- If the PR would raise any single `tag` to >40% of a stack's seeds: **add a label** `high-tag-concentration` but don't block
- If the PR adds >5 seeds from the same author in one commit: **add a label** `bulk-addition — review carefully`

**Implementation:**
- Add a `check-concentration.mjs` script (≈80 lines)
- Call it from `.github/workflows/validate.yml` on seed-touching PRs
- Emit structured output as a step summary for clear PR reporting

---

## Metrics to Track

Once implemented, monitor these in the analytics page:

| Metric | Target | Warning threshold |
|--------|--------|-------------------|
| Henge concentration (max % from one source per stack) | < 20% | > 30% |
| Stack seed variance (std dev across stacks) | Decreasing | Increasing QoQ |
| Adversarial candidates accepted per quarter | ≥ 2 | 0 for two quarters |
| Seeds deprecated via staleness | > 0 per quarter | 0 for three quarters |
| Mean provenance chain age (normalised) | Stable | Rising > 10% QoQ |

---

## Implementation Order

These mitigations are independent and can be shipped in any order. Suggested sequence by impact-to-effort ratio:

1. **Source diversity floor** — highest impact, ~100 lines in auto-seed.mjs
2. **Human review concentration alert** — surfaces problems immediately, ~80 lines
3. **Correctness decay** — requires outcome tracking to be active first
4. **Provenance normalisation** — backfill cost, do after decay is running
5. **Stack coverage quota** — refinement once floor and alert are in place
6. **Adversarial sampling** — quarterly run, lowest urgency, highest insight value
