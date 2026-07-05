# research/ — deferred mathematical tracks

Code for the ROADMAP.md research hypotheses (Shannon-Boltzmann, Nash
injection equilibrium, Borromean seed triads, persistent homology,
Retrieval Resonance inverted-U, injection stability, RAG metrics).
Moved here in the Chunk H trim: **deferred, not cut** — the ideas live in
ROADMAP.md with explicit disconfirmation criteria; this directory keeps
the code runnable-ish.

Caveat: most of these lean on the Tier 2 unmaintained retrieval
infrastructure (embeddings, indexes — see MAINTENANCE.md). Expect bitrot
in proportion. Relative imports were preserved by keeping this directory
at repo root (same depth as scripts/).

npm entry points: `loops:homology`, `loops:stability`, `loops:nash`,
`loops:all`, `borromean`, `cascade`, `metrics`, `fine-tune`.
