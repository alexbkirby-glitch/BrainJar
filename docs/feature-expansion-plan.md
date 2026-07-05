# Lodestone — Feature Expansion Plan

*Possible next steps, ordered roughly by impact vs effort.*

---

## Near-term (infrastructure already in place)

**Spectral cluster potential**
The plan is written at `docs/spectral-cluster-potential-plan.md`. Trigger condition: `api/relationship-graph.json` shows `density_pct ≥ 30`. Check after each weekly CI build — estimated 2–3 months of normal operation from launch.

**Seed Scorer using personal seeds first**
The pressure gauge (`/#pressure`) currently scores against the bundled community seed array. When a local Stone is running, it should try `localhost:3001/api/seeds` first and fall back to the community array. One fetch at page load, same scoring pipeline.

**`capture_fix` duplicate detection at write time**
Currently `review-seeds.mjs` catches duplicates in batch. A lightweight token-overlap check inside `capture_fix` itself (before writing) would prevent duplicates at the source and prompt the developer to refine the existing seed instead.

**Outcome signal dashboard**
`record_outcome` writes to `.lodestone/seed-confidence.json` but there's no way to browse it. A small analytics view (which seeds have the most clean/dirty outcomes, which haven't been used in 6 months) would help curators decide what to prune or strengthen.

---

## Medium-term (new capabilities)

**Retroactive seeding from git blame**
Point `capture_fix` at a git commit diff and have it propose seeds automatically for each bug fixed. Would require parsing commit messages and diff hunks, running them through the symptom extractor, and staging proposals for human review.

**Cross-session memory via Stone continuity**
The MCP server starts fresh each session. A `session-handoff.md` generated at session end (summarising which seeds fired, which were rejected, what was captured) could be injected at the next session start, giving the Stone genuine continuity between conversations.

**Henge reputation propagation**
Seeds grafted from high-reputation Henges inherit a provenance signal. If Henge A has reputation B (60/100) and you graft 5 seeds from it, those seeds start with a slightly elevated confidence prior rather than the flat 0.35 default. Encourages quality Henges.

**Stack auto-detection from file context**
The extension scans conversation text for stack signals. A companion script (`git-watch.mjs` exists but isn't fully integrated) could watch the working directory, detect the stack from `package.json`, `Cargo.toml`, `go.mod`, etc., and pre-load the relevant seeds before the first message is sent.

**Bulk-graft from a Henge PR**
When reviewing the auto-seed draft PR, a single command (`node scripts/approve-staged.mjs`) could accept all staged seeds above a confidence threshold and write them into the correct stack files, removing the manual copy-paste step.

---

## Longer-term (significant new scope)

**Prediction markets for seed confidence**
Community members stake reputation on whether a seed's advice is correct. Seeds with high consensus rise; contested seeds are flagged for review. Requires accounts or GitHub identity — notable departure from the current account-free model.

**Federated weights**
Personal Stones share anonymised outcome signal (which seeds fired clean vs dirty) back to a central aggregator. The aggregator publishes updated confidence scores that any Stone can pull. No seed content shared — only the signal. Privacy-preserving by design.

**Active inference injection**
Rather than injecting seeds reactively on error, watch the developer's intent (what they're typing) and inject preventively. Requires the extension to read the composer content before submission — possible within the current manifest permissions but needs careful UX design to avoid feeling intrusive.

**Non-code domain expansion**
`domain-sources.json` lists writing, personal finance, cooking, and legal as staged domains. The governance model is documented in the auto-seed bias plan. Activating the first non-code domain (writing is the lowest-risk candidate) would test the domain expansion gate in `api-schema.js` against real traffic.

**MCP server as a published npm package**
`lodestone-mcp` on npm would let users install via `npx` rather than cloning the repo. The server is already self-contained in `mcp-server/index.mjs`. Main work: versioning, changelog, and keeping the published package in sync with the repo.

---

## Deferred (waiting on prerequisites)

**Spectral cluster potential** — needs graph density ≥ 30% *(plan written)*
**Federated weights** — needs meaningful community of Stone owners first
**Prediction markets** — needs identity layer; build mechanism before incentives
**Active inference** — needs extension UX research; high risk of annoyance if wrong
