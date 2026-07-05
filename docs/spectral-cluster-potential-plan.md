# Spectral Cluster Potential — Implementation Plan

*Conformal embedding of the Lodestone seed graph for geometric novelty scoring.*
*Status: DEFERRED — requires relationship graph density ≥ 30%. Current: ~5% (rising to ~20% with static improvements).*
*Revisit: after one quarter of CI-generated relationships + one LLM proposal cycle.*

---

## What This Is

The graph Laplacian is the discrete analogue of the continuous Laplace operator — the same operator whose Green's function for the Mandelbrot set is `G(c) = log|φ(c)|`. For a graph with adjacency matrix A and degree matrix D, the normalised Laplacian is `L = D⁻½(D-A)D⁻½`.

The eigenvectors of L give the natural low-dimensional embedding of the graph — what spectral clustering computes. In this embedding, geometrically close seeds are semantically related, and the distance from a seed to its cluster centre in spectral space is the discrete analogue of G(c): the "conformal potential" measuring how far a seed is from the nearest established knowledge cluster.

**Seeds near a cluster centre** (low potential) — well-established antipatterns, proven by many relationships and confirmed outcomes. High confidence, safe to inject.

**Seeds on a cluster boundary** (moderate potential) — partially-confirmed patterns, related to established seeds but not yet deeply embedded in the graph. The "Mandelbrot boundary" of the seed space — the interesting, uncertain region.

**Seeds far from all clusters** (high potential) — novel, unconfirmed, potentially wrong. Either new captures not yet connected, or outliers. High scrutiny before injection.

---

## Why Density Matters

Spectral clustering requires the graph to be connected enough that the Laplacian has meaningful structure. Specifically:

- **At 5% edge density**: most seeds are isolated. The Laplacian has ~1,522 trivial components (one per orphan). Eigenvectors encode almost no semantic information — they're just indicator functions for isolated seeds.
- **At 15–20% density**: clusters start forming. The Laplacian begins to have meaningful eigenvector structure. Spectral embedding becomes useful.
- **At 30%+ density**: stable clusters with clear boundaries. The spectral embedding is reliable and the cluster potential is geometrically meaningful.

The static relationship improvements (all 87 stacks in COMPARE_STACKS, within-stack tag see_also, tag-cluster co_inject, escalates_to) should push density from 5% to ~18–22%. One LLM proposal cycle should add another 5–8%. Revisit when `relationship-graph.json` shows `density_pct ≥ 30`.

---

## Algorithm

### Step 1: Build the Weighted Adjacency Matrix

Load `api/relationship-graph.json`. For each directed edge `(u, v, log_weight)`:
- Use `log_weight` (not linear confidence) for edge weights — this is already computed by `detect-relationships.mjs`
- Symmetrise: `W[u,v] = W[v,u] = max(W[u,v], W[v,u])` for undirected spectral analysis
- Different relationship types get different base weight scalings:
  - `requires`: 1.0× (strong structural link)
  - `co_inject`: 0.9× (evidence-based co-occurrence)
  - `implies`: 0.75×
  - `see_also`: 0.6×
  - `escalates_to`: 0.5× (directional — weaken when symmetrising)
  - `temporal_sequence`: 0.4× (ordering hint, not semantic similarity)

### Step 2: Compute the Normalised Laplacian

```
D = diagonal matrix of row sums of W
L_norm = D⁻½ (D - W) D⁻½
```

For large sparse graphs (1,633 seeds), use the ARPACK-style sparse eigenvalue solver. Only the first k=20 eigenvectors are needed.

### Step 3: Spectral Embedding

Each seed s gets coordinates `x(s) = [v₂(s), v₃(s), …, v_{k+1}(s)]` where `vᵢ` is the i-th eigenvector (skip v₁ = constant vector). This gives a k-dimensional embedding where geometric distance reflects graph structure.

### Step 4: Cluster via k-means in Spectral Space

Run k-means on the spectral coordinates with k = estimated number of natural clusters. Good initial estimate: k ≈ sqrt(n_connected_seeds / 2) — start around k=15 for the current library.

Each cluster gets a centroid `μₖ` in spectral space.

### Step 5: Compute Conformal Potential per Seed

For each seed s in cluster k:
```
G(s) = log(1 + dist_spectral(s, μₖ))
```

where `dist_spectral` is Euclidean distance in the k-dimensional spectral embedding. Seeds at the cluster centre have G ≈ 0. Seeds on the boundary have G > 0. Orphans (no edges) are excluded from clustering and assigned `G = G_max` (maximum potential, most uncertain).

### Step 6: Write to seed files and index

Add `spectral_potential` and `cluster_id` to each seed JSON:
```json
{
  "id": "react_stale_closure",
  "spectral_potential": 0.34,
  "cluster_id": 7,
  ...
}
```

Write a cluster summary to `api/spectral-clusters.json`:
```json
{
  "schema_version": "1",
  "built_at": "...",
  "k": 15,
  "density_at_build": 0.31,
  "clusters": [
    { "id": 7, "size": 42, "centroid": [...], "label": "async/concurrency",
      "top_seeds": ["react_stale_closure", "python_asyncio_blocking"], "tags": ["async","closure","event-loop"] }
  ]
}
```

---

## Integration Points

### Injection scoring
In `evaluateInjectionSmooth`, add a potential modifier:
```js
const potentialMod = seed.spectral_potential != null
  ? 1 / (1 + seed.spectral_potential)   // low potential → closer to 1.0 (established)
  : 1.0;                                 // no data → neutral
const expectedSavings = logSim × taskComplexity × blast × BASE_SAVINGS_TOKENS × confMod × potentialMod;
```

Seeds deep in a cluster inject with higher expected savings than boundary seeds of the same blast radius — because cluster membership is evidence that the pattern is well-established.

### Auto-seed bias detection
Seeds with high spectral potential are "boundary seeds" — the most likely targets for the anti-bias checks in `auto-seed-bias-plan.md`. The quarterly LLM proposal job should prioritise these as relationship targets.

### Novelty scoring for incoming captures
When `capture_fix` creates a new seed, compute its spectral potential immediately (using approximate nearest-neighbour search rather than full recompute). High potential → flag as "novel, needs confirmation before high injection weight."

### Henge discovery
In StoneHub's Henges tab, seeds from external Henges with high `spectral_potential` relative to the SeedBank's clusters are genuinely novel (the Henge covers ground the SeedBank doesn't). These are higher-priority grafts. Seeds with low potential are near-duplicates — useful confirmation, but lower priority.

---

## Implementation Requirements

| Component | Language | Dependency |
|---|---|---|
| Laplacian computation | Node.js (mjs) | `ml-matrix` or native typed arrays for small k |
| k-means clustering | Node.js | `ml-kmeans` or hand-rolled (k=15 is small) |
| Sparse eigenvalue solver | Node.js | `numeric.js` or WASM `eigen` bindings |
| Script | `scripts/compute-spectral.mjs` | none (pure Node) |
| CI integration | GitHub Actions | runs after `detect-relationships.mjs --write` |
| Output | `api/spectral-clusters.json` | Added to `build-index.mjs` output sequence |

For Node.js without a native linear algebra library, the power iteration method converges fast enough for k=20 eigenvectors on a 1,633×1,633 sparse matrix — expected runtime under 5 seconds.

---

## Trigger Conditions

Run `compute-spectral.mjs` when:
1. `relationship-graph.json` shows `density_pct ≥ 30` AND
2. At least 500 seeds have at least one edge AND
3. `detect-relationships.mjs --write` has just run (so the graph reflects current state)

Add this as a conditional step in `deploy.yml`:
```yaml
- name: Compute spectral clusters (if graph is dense enough)
  run: |
    DENSITY=$(node -e "const d=require('./api/relationship-graph.json'); console.log(d.stats.density_pct)")
    if [ "$DENSITY" -ge 30 ]; then
      echo "Graph density ${DENSITY}% — running spectral clustering"
      node scripts/compute-spectral.mjs
    else
      echo "Graph density ${DENSITY}% — spectral clustering deferred (needs 30%)"
    fi
```

---

## Current Status

- Relationship graph density: **~5%** (1,606 seeds, 84 with edges)
- Expected after static improvements: **~18–22%**
- Expected after first LLM cycle: **~25–28%**
- Target for spectral clustering: **30%**

Estimated timeline: 2–3 months of normal CI operation after the `detect-relationships.mjs` improvements ship. Check `api/relationship-graph.json → stats.density_pct` after each weekly build.
