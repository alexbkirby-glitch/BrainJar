# Lodestone — Development Roadmap

> Current state: v13 · 1,717 seeds · 88 stacks · 26 MCP tools · 20 scripts
> Mathematical framework: `docs/mathematical-framework.md`
> Quick start for new sessions: `node mcp-server/index.mjs --explain`

This roadmap is organised by mathematical loop. Each loop was identified as a
complete closure — the mathematics starts at a physical or historical anchor,
travels through several layers of theory, maps to a concrete system behaviour,
and returns to the starting point through a different path. The closure points
are mathematically precise, not metaphorical.

See `docs/mathematical-framework.md` for the fully-closed loops
(Westinghouse AC and Westinghouse gas pipes) that grounded the existing system.

---

## Implemented (v1–v13)

These loops are closed and their features are built:

- **Newton/Julia/Mandelbrot** → basin of attraction analysis, three failure modes
  (Julia-set chaotic, extraneous attractor, two-phase equilibrium)
- **Nova fractals** → personal seed c-perturbation slot
- **Aberth-Ehrlich electrostatics** → injection diversity (`_diverseTopK`)
- **Buddhabrot/Nebulabrot** → cited vs uncited vs contradicted attribution,
  session depth channels (`clean_short`, `clean_long`)
- **Kolmogorov cascade** → corpus health slope in `build-stats.mjs`
- **Latent heat / phase transitions** → drain latent heat accumulator, hysteresis,
  two-phase equilibrium detector, fractional distillation injector
- **Celtic knot topology** → Borromean ring detection, upward cascade detection,
  two-phase seed splitting
- **Westinghouse loop closure** → documented in 
- **Shannon–Boltzmann** → KL-weighted Bayesian confidence updates (`outcome-tracker.mjs`),
  Gibbs entropy corpus metric (`build-stats.mjs`), information-dense session flag, memory seeds
- **Carnot/Landauer** → compression-based redundancy check (`review-seeds.mjs`),
  Carnot corpus efficiency metric (`build-stats.mjs`)
- **Resonance/Fiedler** → Fiedler value λ₂ and Euler χ in `build-stats.mjs`,
  Fiedler trigger replaces density threshold in `compute-clusters.mjs`
- **Population genetics** → Kimura fixation probability in `vault_promote`,
  genetic drift warning in `review-seeds.mjs`
- **Euler/Persistent homology** → `scripts/detect-homology.mjs` (new) — b₁ cycle detection,
  Goldstone gap identification, Euler χ diagnostic
- **Chaos/Lyapunov** → `scripts/measure-injection-stability.mjs` (new) — per-stack λ,
  dissipation check Σλ < 0, frozen/chaotic stack detection
- **Game theory/Nash** → `scripts/compute-nash-equilibrium.mjs` (new) — fictitious play,
  KL Nash distance, dominant strategy detection, over/under-injected seeds
- **Immune/Jerne idiotypic** → idiotypic suppression check in `review-seeds.mjs`,
  memory seed flag in outcome-tracker report, dominant-strategy Nash check

## Phase 1–3 (all loops now implemented — see npm run loops:all)`docs/mathematical-framework.md`

---

## Phase 1 — Low Lift, High Return
*Each item here connects to an existing mechanism; no new infrastructure required.*

### 1.1  Shannon–Boltzmann: KL-Weighted Confidence Updates

**Loop:** Shannon entropy H = −Σ pᵢ log pᵢ → Boltzmann H-theorem (same formula)
→ thermodynamic entropy → latent heat → drain threshold → Laplace smoothing as
Bayesian inference → maximum entropy principle → back to Shannon.

**Closure:** Laplace smoothing is already the maximum-entropy posterior. But every
session currently counts equally. A 3-turn session that confirms a well-known seed
provides near-zero bits of information; a 45-turn deep session that breaks a
confident seed provides many bits. The update should be weighted by KL divergence
from the prior.

**Features to build:**
- `outcome-tracker.mjs`: replace flat session weight with
  `weight = log(1 + session_turns / REF_TURNS)` (information content proxy);
  already have `session_turns` — just change the denominator formula
- `build-stats.mjs`: add corpus entropy H = −Σ p log p across confidence
  distribution; low H = committed knowledge, high H = widespread uncertainty;
  display as "corpus entropy" alongside Kolmogorov slope
- `outcome-tracker --report`: add "information-dense sessions" flag — sessions
  that caused large KL divergence from prior (i.e., dramatically changed a
  high-confidence seed's score) should be flagged for manual review

**Effort:** Small · **Dependencies:** Session energy weighting (already built)

---

### 1.2  Carnot / Landauer: Compression-Based Redundancy

**Loop:** Carnot cycle (maximum efficiency requires reversible processes)
→ Landauer's principle (erasing one bit dissipates k_BT ln 2 joules)
→ information and thermodynamics are unified → Kolmogorov complexity
→ compressible content = redundant seed → drain redundant seeds
→ the most efficient corpus has every seed maximally irreducible → back to Carnot.

**Closure:** The Carnot-optimal corpus is one where no seed can be derived from
others. Kolmogorov complexity measures irreducibility exactly; compression ratio
approximates it computably. Two seeds can be semantically redundant with low
Jaccard overlap if one's CORRECT section is a logical consequence of the other's.

**Features to build:**
- `review-seeds.mjs`: check 9 — compute pairwise compression ratios
  (`len(compress(A+B)) / (len(compress(A)) + len(compress(B)))`);
  ratio < 0.7 indicates strong redundancy; flag as "Landauer redundant"
- `build-stats.mjs`: add "Carnot corpus efficiency" = total content bytes /
  compressed-corpus bytes; display trend; a falling ratio means growing redundancy
- `review-seeds.mjs --semantic`: pass compression-redundant pairs to the LLM
  with explicit "can B be derived from A?" question rather than generic quality review

**Effort:** Small · **Dependencies:** Node `zlib` (built-in)

---

### 1.3  Resonance / Eigenvalues: Fiedler Value Monitor

**Loop:** Natural resonant frequencies of physical systems → eigenvalues of
stiffness matrix → spectral theory → graph Laplacian eigenvalues → spectral
clustering → Fiedler vector (second eigenvalue) → natural cluster boundaries
→ characteristic polynomial of Laplacian → roots → Aberth-Ehrlich → eigenvalues.

**Closure:** The Aberth-Ehrlich injection diversity tool and the spectral cluster
detector are solving the same mathematical problem (polynomial root finding)
from opposite ends. The Fiedler value is the cheapest connectivity diagnostic
before triggering the full spectral computation.

**Features to build:**
- `build-stats.mjs`: compute the graph Laplacian Fiedler value (second eigenvalue)
  from `api/relationship-graph.json`; display as "corpus connectivity λ₂"
- `build-stats.mjs`: change spectral cluster trigger from density ≥ 30% to
  `|Δλ₂| > 0.05` between builds — responds to structural change, not sheer size
- `compute-clusters.mjs`: add Fiedler vector visualisation — seeds near the zero
  crossing of the Fiedler vector are at natural cluster boundaries; flag them as
  candidates for either splitting or promotion to universal

**Effort:** Small · **Dependencies:** `api/relationship-graph.json` (already generated
by `detect-relationships.mjs`); eigenvalue computation via power iteration (no
external library needed for the top-2 eigenvectors)

---

## Phase 2 — Medium Lift
*New data structures or passes needed, but no architectural changes.*

### 2.1  Population Genetics: Seed Genealogy and Fixation Threshold

**Loop:** Darwinian selection → Wright-Fisher model (genetic drift in finite
populations) → Kimura's fixation probability p_fix ≈ 2s (s = selection coefficient)
→ coalescent theory (tracing lineages to common ancestor) → seed genealogy
→ harvest_docs source URLs as ancestral documentation → back to selection (drain).

**Closure:** Kimura's threshold for likely fixation: p_fix > 0.5 when s > 1/(2N),
where N = total sessions and s = per-session confidence gain. For seeds, this gives
a principled promotion criterion: promote a personal seed when its fixation
probability exceeds 0.5.

**Features to build:**
- `harvest-docs.mjs`: record source URL in each seed's `_source_url` field
  (already partially done); extend to build a `docs/seed-genealogy.json` that
  groups seeds by source URL — seeds sharing a URL are paralogous and should have
  `see_also` edges added automatically by `detect-relationships.mjs`
- `vault_promote` (MCP tool): display fixation probability `p_fix = 2 × (conf_gain_per_session)` 
  alongside confidence; add a "ready to fix" flag when p_fix > 0.5 
- `review-seeds.mjs`: check 10 — neutral drift warning: when session count < 10,
  flag that selection pressure is too weak to be meaningful (drift-dominated regime);
  do not drain seeds with fewer than 10 sessions regardless of confidence floor

**Effort:** Medium · **Dependencies:** `harvest-docs.mjs` source URL tracking,
`outcome-tracker.mjs` session count per seed

---

### 2.2  Euler Characteristic / Persistent Homology: Topological Void Detection

**Loop:** Euler characteristic χ = V − E + F → Betti numbers (b₀ = components,
b₁ = cycles, b₂ = voids) → persistent homology (filtration of relationship graph
by edge confidence) → b₁ voids = seeds that should exist but don't → back to
Euler (χ = Σ (−1)ⁿ bₙ).

**Closure:** The Euler characteristic of the seed relationship graph is
χ = seeds − relationships + cycles. A b₁ cycle in the graph is a cluster of seeds
that mutually imply each other with no central parent seed — the topological
formulation of the upward cascade. This gives a formal definition of a "missing seed."

**Features to build:**
- `build-stats.mjs`: compute χ = V − E + F for the relationship graph at each build;
  display with trend; a χ that increases between builds indicates new topological
  holes (cycles without parents)
- `scripts/detect-homology.mjs` (new): implement filtration of the relationship
  graph by edge confidence from 1.0 → 0.0; track when connected components merge
  (seeds becoming related at lower confidence) and when b₁ cycles appear (seeds
  forming a loop without a parent); output birth/death pairs as
  `.lodestone/persistent-homology.json`
- `compute-clusters.mjs`: use b₁ cycles as an additional source of cascade parent
  candidates alongside co-occurrence clusters; seeds in a b₁ cycle with no parent
  should appear in `cascade-parents-draft.json`

**Effort:** Medium · **Dependencies:** Relationship graph (already built);
filtration is a simple loop over edge confidence thresholds

---

### 2.3  Immune System / Jerne Idiotypic Network

**Loop:** Clonal selection (B cells with high affinity expand) → somatic
hypermutation (random mutations improve antibody binding) → memory B cells
→ Jerne idiotypic network (antibodies produce anti-antibodies; the system models
itself) → seed-authoring.json IS the idiotypic network → seed-authoring seeds
improve corpus quality → better seeds = higher corpus fitness → back to selection.

**Closure:** seed-authoring.json is formally the idiotypic network of the Lodestone
corpus. The seed quality scoring in `capture_fix` (already built) is the idiotypic
regulatory mechanism — when a new seed enters, the anti-antibody seeds evaluate it.

**Features to build:**
- `review-seeds.mjs`: idiotypic diversity regulation — when a stack has more than
  5 seeds with pairwise Jaccard > 0.6 (too much of one "antibody type"), flag
  the excess as subject to idiotypic suppression; suggest merging the cluster
  rather than maintaining near-duplicates
- `add-citations-llm.mjs` → extend to `somatic-hypermutation.mjs` (new): for
  seeds with zero BM25 index hits on their own symptom text, generate 3-5 small
  random perturbations to the symptom text and test each for retrieval improvement;
  keep the highest-scoring variant; this IS somatic hypermutation
- `outcome-tracker --report`: add "memory seed" flag for seeds ≥ 12 months old
  with confidence > 0.75; memory seeds are exempt from routine drain review and
  require explicit confirmation to archive

**Effort:** Medium · **Dependencies:** `add-citations-llm.mjs` pattern,
seed creation timestamp (already in `_harvested_at`)

---

## Phase 3 — High Lift / Research
*Requires new architectural components or significant investigation.*

### 3.1  Chaos / Lyapunov: Injection Stability Metric

**Loop:** Lorenz attractor → Lyapunov exponents (rate of divergence of nearby
trajectories) → positive λ_max = chaos → Pesin's theorem (KS entropy = sum of
positive Lyapunov exponents) → information production rate → rate at which
nearby queries diverge in injection sets → Julia set proximity → back to chaos.

**Closure:** The sensitivity tracker (std-dev of recent outcomes) approximates the
local Lyapunov exponent empirically. Pesin's theorem formally connects the two:
the KS entropy of the confidence update process equals the sum of positive
Lyapunov exponents, and is estimable from the sensitivity field already tracked.

**Features to build:**
- `scripts/measure-injection-stability.mjs` (new): given a sample set of queries,
  perturb each query (add/remove one token) and compute the Jaccard distance between
  the injection sets; the average log-divergence rate is the empirical injection
  Lyapunov exponent; display per-stack
- `build-stats.mjs`: add "injection stability λ" per stack; healthy: near 0 within
  domains, positive at domain boundaries; flag stacks with λ < −0.5 (over-specified,
  every query hits the same seed) or λ > 0.8 (chaotic, small wording changes produce
  unrelated seeds)
- `lookup_symptom`: when a query's injection set changes substantially with a
  one-token perturbation (detected at query time by sampling nearby queries),
  widen the injection set to include both results — reducing the Butterfly Effect
  on individual session outcomes

**Effort:** Large · **Dependencies:** Large enough seed corpus with enough
outcome data to make Lyapunov estimates meaningful (need ≥ 100 sessions)

---

### 3.2  Game Theory / Nash Equilibrium: Corpus Stability Diagnostic

**Loop:** Nash equilibrium (no player can improve unilaterally) → Brouwer fixed
point theorem (existence proof) → fixed point iteration → complex dynamics
→ Julia/Mandelbrot → injection diversity → corpus as game between seeds
competing for context slots → Nash-stable corpus → back to game theory.

**Closure:** The Aberth-Ehrlich injection diversity (already implemented) is an
approximation to the Nash equilibrium of the "seeds competing for injection slots"
game. The formal Nash equilibrium gives a principled target distribution that the
system should converge toward.

**Features to build:**
- `scripts/compute-nash-equilibrium.mjs` (new): model the corpus as a symmetric
  game; compute the Nash equilibrium injection frequency distribution using
  fictitious play (iteratively best-respond to the empirical distribution); compare
  to the actual injection frequency distribution from session history
- `build-stats.mjs`: add "Nash distance" metric = KL divergence between actual
  injection distribution and Nash equilibrium; a rising Nash distance indicates
  the corpus is becoming less strategically stable (one or two seeds dominating)
- `review-seeds.mjs`: dominant strategy seeds — seeds that inject regardless of
  what other seeds are present; flag for splitting (like splitting a dominant
  strategy into two more specialised strategies that together cover the same territory
  but don't crowd out everything else)

**Effort:** Large · **Dependencies:** Significant session history (Nash equilibrium
only meaningful with many sessions); fictitious play convergence requires
careful numerical implementation

---

## Phase 4 — Existing Planned Features (from feature-expansion-plan.md)

*These were planned before the mathematical framework was fully developed.
Each is now groundable in the mathematics above.*

### 4.1  Spectral Cluster Potential
**Status:** Plan written at `docs/spectral-cluster-potential-plan.md`
**Trigger:** Fiedler value change > 0.05 OR graph density ≥ 30% (whichever first)
**Mathematical grounding:** Resonance/Eigenvalues loop (Phase 1.3)
**Effort:** Medium · depends on Phase 1.3 being implemented first

### 4.2  Stack Auto-Detection from File Context
**Status:** `git-watch.mjs` partially built
**Grounding:** Population genetics — stack auto-detection is analogous to
species identification; the working directory's files are the phenotype
**Effort:** Small · extends git-watch.mjs

### 4.3  Cross-Session Memory via Stone Continuity
**Status:** `session-handoff.md` now written after each `record_outcome`
**Remaining:** Inject `session-handoff.md` at next session start via MCP server
startup hook; auto-summarise which seeds fired across the last N sessions
**Effort:** Small

### 4.4  Henge Reputation Propagation
**Status:** Not yet started
**Grounding:** Population genetics — Henge reputation is analogous to a
"lineage fitness score"; seeds from high-fitness lineages start with elevated priors
**Effort:** Medium · requires Henge session data

### 4.5  Federated Weights
**Status:** Deferred (needs community first)
**Grounding:** Nash equilibrium — the federated weights are the shared Nash
equilibrium of the multi-agent confidence update game
**Prerequisite:** Meaningful Henge ecosystem

### 4.6  Prediction Markets
**Status:** Deferred (needs identity layer)
**Grounding:** Game theory — prediction markets are explicitly a mechanism design
problem; the Nash equilibrium of a prediction market IS the consensus probability
**Prerequisite:** Identity layer; build mechanism before incentives

### 4.7  Active Inference Injection
**Status:** Deferred (needs UX research)
**Grounding:** Lyapunov / chaos — inject preventively when the query's
embedding is near a high-λ region of the corpus (chaos = likely to need guidance)
**Prerequisite:** Injection stability metric from Phase 3.1

### 4.8  MCP Server as npm Package
**Status:** Not started
**Effort:** Small — mostly versioning, changelog, README polish
**Prerequisite:** Stable API (most things now stable)

---

## Phase 5 — Open Questions from Mathematical Framework
*These require research before implementation is possible. Good for new-session exploration.*

### 5.1  Misiurewicz Point Detection
Seeds that start uncertain and converge to stable high-confidence after a fixed
number of uses are Misiurewicz points (strictly preperiodic orbits that eventually
settle). No current tool identifies them. The signature: sensitivity falls to zero
after exactly N sessions for some small N. Detecting this requires tracking the
confidence trajectory shape, not just the current value.

### 5.2  Reidemeister Canonical Form
If two corpus states are Reidemeister-equivalent (produce identical injection
behaviour despite different individual seeds), there exists a canonical form.
No algorithm exists to compute it for a real corpus. This is a pure research
problem: define what "injection behaviour equivalence" means formally, then
find the reduction algorithm.

### 5.3  Julia Set of the Confidence Feedback Loop
The confidence update pathway is a closed loop. Its Julia set is the set of
seed states that are sensitive to perturbation. The sensitivity tracker
approximates this empirically; the exact Julia set of the confidence map
has not been computed analytically for any real corpus.

### 5.4  Braid Complexity of Session Trajectories
The sequence in which seeds fire in a session forms a braid. High braid complexity
= developer in novel territory. Low braid complexity = routine session, automation
candidate. Requires formalising what "adjacent seeds" means in the injection space,
then building a braid classifier over session archives.

### 5.5  Hyperbolic Geometry Seed Embeddings
Thurston's theorem: the complement of almost any knot is a hyperbolic 3-manifold.
BM25's logarithmic scoring is consistent with hyperbolic metric geometry. A learned
hyperbolic embedding of seeds would give geometrically principled similarity scores.
Requires training infrastructure (likely a small GNN or Poincaré embedding).

---

## Session Handoff Notes
*What to tell a new context window*

1. Run `node mcp-server/index.mjs --explain` for a live Stone summary
2. Share `docs/mathematical-framework.md` — especially the Open Questions section
3. Current version is v12 (`lodestone-complete-v12.zip`)
4. The two Westinghouse loops are closed and documented
5. Eight new loops were planned (above) — none yet implemented
6. The most valuable immediate targets: Phase 1 (Shannon-Boltzmann,
   Carnot/Landauer, Fiedler value) — all low-lift and high-value
7. The most mathematically interesting: Phase 5 open questions —
   especially the Reidemeister canonical form and Misiurewicz detection

**Good starting prompt for a new chat:**
> "I'm working on Lodestone (an open-source personal seed library system for AI
> coding sessions). Here is the --explain output and docs/mathematical-framework.md.
> I'd like to start implementing Phase 1 of the roadmap: Shannon-Boltzmann
> KL-weighted confidence updates."

---

*This roadmap was generated in chat v12. The mathematical framework that motivates
each phase is documented in `docs/mathematical-framework.md`. The two already-closed
loops (Westinghouse AC and Westinghouse gas pipes) demonstrate that the mappings
are structurally precise. Each new loop above meets the same standard.*
