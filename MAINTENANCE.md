# MAINTENANCE.md — What's alive, what's frozen, what's research

The Chunk H classification (grill-session, 2026-07-04). Four tiers. If
you're about to file an issue or build on top of something here, check its
tier first.

## Tier 1 — Maintained (Brain Jar core)

The library: schema, lint, capture, publish, discovery, grazing, export
transforms, and the nine-tool MCP server.

- `lib/` — seed-schema, privacy-lint, manifest, capture-seed, discover-jars
- `mcp-server/` — index.mjs, tools.mjs, privacy-lint.mjs (nine tools; see
  mcp-server/README.md)
- `scripts/` maintained set: `graze.mjs`, `review-graze.mjs`,
  `generate-manifest.mjs`, `manage-personal.mjs`, `capture.mjs`,
  `migrate-seed-schema.mjs`, `export-to-gbrain.mjs`,
  `export-to-claude-projects.mjs` (rescued from build-claude-projects —
  it's an export transform: its output gets uploaded into Claude
  Projects; now privacy-gated per SCHEMA.md MUST-4),
  `check-framework-versions.mjs`, `flag-stale-seeds.mjs`,
  `add-citations-llm.mjs`, `detect-relationships.mjs`,
  `detect-relationships-llm.mjs`, `rename-pass.mjs`
- `seeds/`, `profiles.json`, `brain-jar-manifest.json`
- Contracts: `SCHEMA.md`, `MANIFEST.md`, this file

The enrichment/growth line: tooling that **enriches existing seeds**
(citations, relationships, schema migration, staleness) is maintained;
tooling that **grew the corpus via LLM automation** (auto-seed,
generate-seed-drafts, harvest-docs) was cut to the legacy bundle.

## Tier 2 — Unmaintained, kept in-repo (hybrid retrieval pipeline)

Kept deliberately (Chunk H decision): the research tier depends on this
infrastructure, and reviving deep retrieval later is cheaper with the code
in place. **Nobody is maintaining it.** No issues, no fixes, no promises
it still runs against current deps. The live MCP server does not load any
of it — `lookup_symptom` is BM25-lite by design.

- `mcp-server/`: `embeddings.mjs`, `splade.mjs`, `raptor.mjs`,
  `colbert.mjs`, `negative-cache.mjs`, `query-expansion.mjs`
- `scripts/`: `build-index.mjs`, `build-embeddings.mjs`,
  `build-splade-index.mjs`, `build-raptor-index.mjs`,
  `build-negative-cache.mjs`, `build-synonym-map.mjs`,
  `build-graph-communities.mjs`, `verify-complete.mjs`
- `api/` prebuilt indexes: `symptom-index.json`, `term-synonyms.json`,
  `facet-map.json`, `relationship-graph.json`, `pattern-index.json`
- Site delivery helpers pending the site rework: `build-nano.mjs`
  (regenerates `generated/claude-projects/` — the only live content of
  `generated/`; the wiki-era skills/tools/workflows output is in the
  legacy bundle, as is `generate-outputs.mjs`, which depended on the cut
  `context.mjs`), `build-stats.mjs`, `index.html`, `api-schema.js`

## Tier 3 — Research (`research/`)

Deferred mathematical tracks (ROADMAP.md keeps the hypotheses; this
directory keeps the code). Runs against Tier 2 infrastructure — expect
bitrot in proportion to Tier 2's. `npm run loops:*`, `borromean`,
`cascade`, `metrics` point here.

## Tier 4 — Frozen legacy (NOT in this repo)

Cut subsystems live in the `lodestone-legacy` bundle (archived repo /
`lodestone-legacy-bundle.zip`): the 44-tool MCP monolith, vault/seed
banks, weeds, StoneHub, gui, extension, artifact tools, wiki-era
`generated/` output, old CLI workflow, outcome telemetry, and the LLM
corpus-growth pipeline. Frozen means frozen — rescue into Tier 1 or leave
it be. Git history (tag `pre-brain-jar-trim`) has everything regardless.
