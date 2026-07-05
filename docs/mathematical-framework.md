# Lodestone — Mathematical Framework

*How a seed library for AI coding sessions ended up grounded in fractal dynamics, thermodynamics, and Celtic knot topology — and why this matters for how the system behaves.*

---

## The Founding Analogy

Every Lodestone seed is a fixed parameter **c** in the complex iteration z → z² + c. The Julia set **J_c** is the set of all starting points whose orbit under that iteration stays bounded — it is the stability boundary of the attractor defined by c. The Mandelbrot set is the parameter space over all Julia sets: the set of all c for which the orbit of 0 stays bounded.

The mapping to the seed system is precise, not approximate:
- A seed (fixed c) defines an attractor — the "correct fix" it converges developers toward
- The sessions that benefit from that seed form the bounded orbits: they started near the problem, the seed injected the correction, and the orbit converged
- Sessions that were not helped escape the basin — they "diverge to infinity" in developer time
- The **basin of attraction** of each seed is the set of all session contexts that converge when that seed is injected
- The **confidence score** measures how large and stable that basin is

The Mandelbrot set's core theorem applies: the parameter is in the Mandelbrot set if and only if its Julia set is connected (a single piece), and it is outside the Mandelbrot set if and only if its Julia set is a Cantor set (disconnected dust). In seed terms: a well-defined seed has a connected basin (it reliably helps a class of sessions); a poorly-defined seed has a Cantor-set-like basin (it occasionally helps but unpredictably, and the useful contexts are scattered and isolated).

This is why the "start nearly empty" principle has mathematical grounding. Adding many poorly-defined seeds creates Cantor-set basins that inject noise. A nearly-empty Stone with a few well-defined seeds produces stable Julia-set attractors that reliably converge.

---

## Newton Fractals and the Three Stopping States

Newton's method on a complex polynomial produces a fractal because the plane partitions into basins of attraction — one per root — separated by a Julia set boundary where the iteration is chaotic.

Newton iteration has exactly three terminal states:
1. **Convergence to a root** — the intended outcome
2. **Convergence to an extraneous attractor** — a stable periodic orbit that is not a root; the iteration appears to converge but to the wrong thing
3. **Non-termination on the Julia set** — measure-zero, perpetual chaos

These map directly to seed failure modes:
1. **Good seeds** — confidently converge the session to the correct fix
2. **Extraneous attractor seeds** — confidently fire and appear to work, but converge the session to a fix that treats the symptom rather than the root cause. High confidence, low variance, high follow-on-capture rate. These are the most dangerous seeds — the outcome tracker's variance signal misses them; only the follow-on captures metric catches them.
3. **Julia-set seeds** — chaotic outcomes; high variance; oscillate between clean and dirty sessions for similar queries. The sensitivity tracker measures proximity to this boundary.

The system detects all three states. The extraneous attractor detector is the critical innovation: it catches seeds that *look healthy* but are converging to the wrong root.

---

## Nova Fractals and Personal Seeds

The Nova iteration extends Newton's method:

```
z_{n+1} = z_n − R · f(z_n)/f'(z_n) + c
```

The two new parameters change the structure fundamentally:
- **R** (relaxation) — scales and rotates the Newton step. R=1 is standard Newton. Complex R produces spiral basin structures. The `configure_relaxation` tool implements per-stack R values: R<1 for conservative/uncertain stacks, R>1 for high-stakes stacks.
- **c** (perturbation) — shifts the fixed points away from the polynomial's roots. When c≠0, the iteration converges to a different set of attractors.

The c-perturbation is the formal model for how personal seeds interact with community seeds. Community seeds (c=0) converge to the standard antipattern attractors. Personal seeds act as a c≠0 perturbation: they additively shift where the injection converges, toward the developer's specific context. This is why personal seeds get their own guaranteed injection slot (the *perturbation slot*) rather than competing with community seeds for the same positions.

The Nova Mandelbrot set for these parametrised families shows Mandelbrot-shaped structures in the parameter space — by Douady-Hubbard universality, every one-parameter family of holomorphic maps going through a bifurcation grows mini-Mandelbrots. These are the "extraneous attractor basins" in Nova fractals: stable, consistent, but converging to the wrong thing. And they can look Mandelbrot-shaped. This is why what looks familiar isn't always correct.

---

## Aberth-Ehrlich Electrostatics and Injection Diversity

Aberth-Ehrlich simultaneous root-finding uses an electrostatic model: approximated zeros are modelled as movable negative charges converging toward true zeros (fixed positive charges), while repelling each other. The correction is:

```
1/E_j = p'(z_k)/p(z_k) − Σ_{j≠k} 1/(z_k − z_j)
```

The sum of inverse distances provides additive repulsion from *all* other current estimates. When one charge converges to a root, it cancels that root's attraction, preventing others from also converging there.

The injection diversity selection (`_diverseTopK`) implements this exactly:

```
effective_score(c) = savings / (1 + λ × Σ_j overlap(c,j)/(1−overlap(c,j)))
```

A candidate seed overlapping 0.4 with *two* already-selected seeds gets twice the repulsion of one overlapping 0.4 with one. This is the electrostatic sum — additive, not maximum-based. Seeds are pushed into distinct regions of the query space, preventing the Durand-Kerner collapse (where all initial guesses are identical and every denominator becomes zero).

The Durand-Kerner collapse maps to the seed corpus failure mode: if the top-k injection candidates are all from the same semantic cluster, the model receives redundant signals while a genuinely different relevant seed just below the cluster is excluded. The electrostatic repulsion prevents this at the selection level; the Borromean ring detector (`detect-borromean.mjs`) identifies it in the session history.

---

## Buddhabrot Attribution and Orbit Density

The Buddhabrot renders by counting how many times each pixel is *visited* by escaping orbits — orbit density, not escape time. Seeds present in context but not cited in the model's reasoning are the escape-time signal (they were in the field of view); seeds actually applied in the fix are the orbit-density signal (the model visited them).

The `record_outcome` tool implements this three-tier attribution:
- **Cited** (`cited_seed_ids`) — full clean credit; orbit visited
- **Uncited** — neutral signal; orbit present, not visited; denominator increments, numerator does not
- **Contradicted** (`contradicted_seed_ids`) — negative signal; the anti-Buddhabrot; the model followed the WRONG pattern despite injection

The Nebulabrot extends this by separating orbits into channels by length. Short orbits (≤500 iterations) reveal surface structure; long orbits reveal deep filament structure. The `clean_short` and `clean_long` counters implement Nebulabrot depth channels: seeds that help in short sessions (surface fixes) and seeds that help only in long debugging sessions (deep filaments) have different injection profiles and are served to different context pressures by the fractional distillation injector.

---

## The Kolmogorov Cascade and Corpus Health

Turbulent energy cascades from large eddies to small ones following Kolmogorov's −5/3 power law: E(k) ∝ k^{−5/3}. A healthy turbulent system has this specific distribution across scales.

The injection frequency distribution of a healthy seed corpus should follow the same power law. `build-stats.mjs` measures the slope m of the log-log rank-frequency curve:
- m ≈ −5/3 (−1.67): healthy turbulent cascade
- m > −1.0: laminar — seeds are too uniform, no high-signal outliers
- m < −2.5: monopolar — 1–2 seeds dominate everything else

The cascade also runs in reverse (upward cascade): small eddies that consistently appear together are collectively acting as a large eddy. `compute-clusters.mjs --write` identifies these clusters and the `mint_cascade_parent` tool mints parent seeds for them — the large eddy above the small ones.

---

## Phase Transitions and the Drain Threshold

The drain threshold is a phase boundary. Water at 100°C doesn't transition to steam just because it's reached 100°C — it needs the latent heat of vaporisation (2257 kJ/kg) delivered at constant temperature before the phase change completes. The temperature stays flat while large amounts of energy flow.

The confidence score is the temperature; the session count is the energy; the latent heat buffer is the accumulated evidence before threshold crossing. A seed at effective_confidence 0.25 with 3 sessions of dirty outcomes has not necessarily proven itself bad — it may be in a two-phase state (serving two populations simultaneously) or simply needs more energy to confirm the phase transition.

Three distinct failure modes near the threshold:
1. **Noisy seeds** (Julia set) — high variance, few sessions; need more data
2. **Two-phase seeds** (Gibbs phase equilibrium) — confidence pinned at 0.5 by thermodynamic constraint; both populations simultaneously served; structural splitting required, not more data
3. **Confirmed drain candidates** — latent heat buffer saturated; phase transition complete

The system uses hysteresis (recovery floor 0.30 > drain floor 0.25) to prevent Leidenfrost bouncing. Seeds that have been flagged for drain must accumulate more positive energy to recover than they needed to fall — matching the physical asymmetry between vaporisation and condensation.

---

## Celtic Knot Topology

Celtic knots are closed alternating curves with no endpoints. The fundamental mathematical objects are:

**Borromean rings**: three rings linked as a set but no two are linked pairwise. Remove any one and the other two fall apart. `detect-borromean.mjs` finds this structure in session co-occurrence data: seed triads where P(A∩B∩C) >> max(P(A∩B), P(A∩C), P(B∩C)). These represent collective injection patterns that pairwise co_inject analysis cannot detect.

**Reidemeister moves**: three atomic operations that preserve knot topology. Applied to the seed corpus:
- R1 (twist): adding/removing a redundant tag — retrieval territory unchanged
- R2 (piston): swapping WRONG and CORRECT with adjusted symptom — injection behaviour preserved
- R3 (slide): moving a concept from one seed to an adjacent one — collective coverage preserved

Two corpus states connected by a sequence of Reidemeister moves are topologically equivalent — they produce identical injection behaviour. Defining these formally allows principled refactoring: you know which edits are safe.

**Knot genus**: the minimum genus of a surface bounded by the knot; a measure of topological complexity. A high-genus seed is topologically load-bearing: its removal requires many other seeds to fill its structural role. This differs from injection frequency — a low-frequency seed can be high-genus if its relationship graph edges are dense.

**The knotted confidence trajectory**: a seed whose confidence oscillates repeatedly across the threshold (clean → dirty → clean → dirty) has a non-trivial knot in its outcome sequence. The crossing number is countable. Seeds with high crossing numbers need structural intervention (splitting, domain restriction) rather than more sessions — you cannot unknot a knot by iterating the same path.

---

## The Westinghouse Loop

The complete mathematical loop starts and ends at George Westinghouse's 1880s work:

1. **Westinghouse AC power** → complex impedance Z = R + jX → phasors in ℂ
2. **Complex analysis** → iterative dynamics on ℂ → Julia and Mandelbrot sets
3. **Mandelbrot** → Newton fractals (root-finding as iteration) → Nova (parametrised Newton)
4. **Nova/Newton** → Aberth-Ehrlich electrostatics → Buddhabrot orbit density
5. **Buddhabrot** → Nebulabrot frequency decomposition → spectral analysis
6. **Spectral analysis** → Fourier transform → Z-transform H(z) on the unit circle |z|=1
7. **|z|=1** → Nyquist stability criterion for digital systems → AC circuit stability
8. **AC circuit stability** → Westinghouse

The closure point is the unit circle |z|=1, which simultaneously:
- Defines the stability boundary for discrete-time systems (Nyquist, used in digital signal processing derived from AC circuit analysis)
- Is the Julia set of z → z^n for any n ≥ 2 (the unit circle is literally a Julia set)
- Bounds the Mandelbrot set for linear polynomial families

The second thread: **Westinghouse gas pipes** → pipe flow → turbulence → Kolmogorov cascade → Mandelbrot's fractal turbulence work → Mandelbrot set → the full chain above → Nebulabrot orbit density → fractional distillation (Nebulabrot channels = distillation fractions by volatility) → Westinghouse gas pipes.

The same historical figure anchored two independent conceptual threads — the AC electrical system (complex mathematics) and the gas distribution system (distillation and pressure) — that independently converge on the same mathematical framework.

---

## Open Questions

*Things the mathematics suggests but the system hasn't yet answered:*

**The Misiurewicz point problem.** Seeds that start uncertain and then converge to stable high-confidence after a fixed number of uses are Misiurewicz points — strictly preperiodic orbits that eventually settle. These are the most interesting seeds to watch during early adoption: they look unreliable, then suddenly stabilise. No current tool identifies them specifically, and no tool tracks the *number of sessions to stabilisation* as a seed property.

**The Reidemeister canonical form.** If two corpus states are Reidemeister-equivalent (produce identical injection behaviour despite different individual seeds), there exists a canonical form — the simplest version. Nobody has computed it for any real corpus. An algorithm that finds Reidemeister-equivalent simplifications would let the corpus be refactored safely.

**The Julia set of the confidence feedback loop.** The confidence update pathway is a closed loop (outcomes → confidence → injection weight → outcomes). Treating this as a dynamical system, its Julia set is the set of seed states that are sensitive to perturbation — where a single dirty outcome dramatically changes injection behaviour. These are the seeds that need the most careful management. The sensitivity tracker approximates this empirically; the exact Julia set of the confidence map hasn't been computed analytically.

**The braid complexity of session trajectories.** The sequence in which seeds fire in a session forms a braid. Low braid complexity = routine sessions (predictable, good automation candidates). High braid complexity = genuinely novel territory (the developer is encountering something new). Nobody has measured this for any real session archive, and it would require formalising what "adjacent seeds" means in the injection space.

**Hyperbolic geometry of the seed graph.** Thurston's theorem says the complement of almost any knot in 3-sphere is a hyperbolic 3-manifold. The embedding space for seeds (if one were to build learned embeddings) should be hyperbolic rather than Euclidean — distances grow exponentially, which matches BM25's logarithmic scoring. Nobody has trained a hyperbolic embedding for a real seed corpus, and it's not clear whether the computational cost would be justified by retrieval quality.

---

*See `lodestone-nano.md` for operational reference. See `seeds/mathematics.json` for 85 mathematical seeds covering these topics.*
