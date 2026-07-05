# Brain Jar — Grill Session Output

Session date: 2026-06-27. Revised: 2026-07-03 (contribution-economics pass —
added capture path, privacy lint, attribution mechanics, registry page,
anchor-tenant framing; Chunks 0 and I added).
Revised: 2026-07-04 (Chunk E executed — slim nine-tool server; see Section 0
and the Chunk E status entry).
Revised: 2026-07-04 (Chunks F+G executed — SCHEMA.md + export-to-gbrain.mjs;
see their status entries).
Revised: 2026-07-04 (Chunks H+I executed — legacy trim to four documented
tiers + Public Jar registry; see their status entries. All chunks done.)
Revised: 2026-07-05 (post-plan: npm packaging + browser demo + pre-upload
housekeeping — see the post-plan improvements entry).

Origin: Lodestone (antipattern seed library) pivoting
after discovering GBrain (Garry Tan's second-brain memory system) does several
of Lodestone's half-built jobs better. This doc captures the redesigned scope,
the vocabulary agreed during the session, and how to break the remaining work
into independent chunks.

---

## 0. Real Repo Capability Inventory (2026-07-04)

Everything in this section came from the first full-repo upload
(`lodestone-complete-v48-chat-ready.zip`). Every prior chunk (0, A, B) was
built against a wiki-export fragment and one self-referential seed page —
not real source. Read this before touching Chunk C or later; three
standing decisions turned out to be wrong on the facts once real code was
visible.

### Corrections to standing decisions

- **Decision 16 (vault is dead)** — wrong on the facts, right on the
  eventual call. `mcp-server/vault.mjs` is 1,018 lines, live, imported
  into `index.mjs`, with a real tool (`vault_promote`), GUI/HTTP routes,
  and GitHub-backed private cross-Stone sync. Not superseded by Henge/Jar
  — an orthogonal feature (private sync) that predates the second-brain
  pivot entirely. Per direct confirmation: cut it for the same reason as
  weeds (second brains are functionally better vaults), not because it
  was already dead. Still → Chunk H, corrected reasoning.
- **StoneHub is not "basically already-built Henge."** Confirmed live in
  `loadSeedBanks()`/`fetchSeedMeta()`/the `auto_seed` tool — GitHub-topic
  discovery (topic: `lodestone`) + fetching `lodestone-meta.json` per repo.
  Per direct confirmation: cut alongside vault. StoneHub was built when
  "Stone" meant "personal brain that also shares"; that model doesn't fit
  library-not-brain. The new Henge/Public-Jar/manifest/graze design stays
  a deliberate fresh reimplementation, not an adaptation of StoneHub.
- **`build-stats.mjs`** computes "reputation scores, earned achievements,
  verification signals... read by StoneHub" — a real, working
  reputation/trust system for the old model. Confirms decision 9 (no
  reputation system, provenance-surfacing instead) was a deliberate
  architectural departure, not an oversight. → Also Chunk H, serves
  StoneHub which is being cut.
- **Decision 18 (manifest.json is a seeds index) — wrong on the facts.**
  `generated/manifest.json` is an auto-generated catalog of
  workflows/tools/skills (build output), not seed data. Corrected rename
  target: `generated/build-catalog.json`, not `seeds-index.json`. The
  filesystem collision concern doesn't actually exist (different path,
  different filename from Chunk B's `brain-jar-manifest.json` already) —
  only the prose/vocabulary collision remains, and it's still worth fixing.
- **Chunk 0 built the wrong tool.** `capture_weed` (+ `capture_fix`,
  `correct_weed`, `forget_weed`, `quick_capture`) already exists, is more
  mature than what got built (quality scoring, `.lodestone/personal-
  patterns.json` upsert-by-id, an "upload to community via GitHub issue"
  flow), and uses a different storage path entirely than Chunk 0 assumed
  (`.lodestone/personal-patterns.json`, not `seeds/personal/captured.json`).
  The real gap: retrofit `privacy-lint.mjs` into the EXISTING `capture_weed`
  handler, don't duplicate it with a new tool.
- **Real seed field is `blast_radius`, not `blast`.** 100% of 2,156 real
  seeds use `blast_radius`; zero use `blast`. Hard bug in
  `lib/seed-schema.mjs`, `lib/capture-seed.mjs`, `scripts/capture.mjs`,
  `MANIFEST.md` — needs a global fix pass.
- **`domain` (100%) and `facet` (96%) are near-universal**, not rare
  bridge-seed extras as decision 15's framing implied. Still fine as
  optional/nullable at the schema-validation level, but "set only when
  cheap for bridge/universal seeds" undersold how standard these are.
- **Decision 15's capture/enrichment split is confirmed architecturally
  correct.** `scripts/migrate-seed-schema.mjs` is the real enrichment
  pass — derives `summary`/`example_triggers`/`antipattern_category`/
  `applies_when` from lean wrong/correct/symptom, mechanically or via
  `--llm`. Capture stays lean; a later corpus-wide migration adds the RAG
  fields — exactly what decision 15 argued for, under a different script
  name than guessed.

### Genuine gaps confirmed (still real, still needed)

- **`manage-personal.mjs` doesn't exist.** `capture_weed`'s own output
  references `node scripts/manage-personal.mjs promote {id}` — a broken
  promise already shipped in the live tool. This is the actual
  "personal seed → shareable" pipeline Chunk 0/B care about, and it's a
  concrete, well-scoped, currently-missing script.
- **`review-seeds.mjs` solves a different problem than Chunk D.** It
  prunes/archives the reviewing Jar's OWN stale/low-quality seeds
  (structural rules + optional Claude semantic review), not triage of
  incoming graze candidates from other Jars. Chunk D's review queue is
  still a real, unbuilt gap. Naming collision worth tracking: "review"
  now means two different things in this codebase.
- **No manifest/schema_version/N-1-compat mechanism exists anywhere.**
  Chunk B's deliverable doesn't overlap with anything found — still
  fully net-new.
- **No script implements the new decentralized-tag-is-consent model.**
  `auto_seed`/StoneHub's discovery is real but tied to the old
  reputation-scored model. Chunk C is confirmed as a fresh build.

### Full capability map: scripts/ + mcp-server/

**Capture / personal** — `capture_weed`, `capture_fix`, `correct_weed`,
`forget_weed`, `quick_capture`, `list_weeds`, `recall_weeds` (index.mjs +
weeds.mjs); `scripts/decay-weeds.mjs` (confidence decay);
`scripts/manage-personal.mjs` (referenced, missing — gap).

**Retrieval / injection (hybrid search stack)** — `mcp-server/embeddings.mjs`,
`splade.mjs`, `rrf.mjs`, `colbert.mjs`, `reranker.mjs`, `multi-query.mjs`,
`query-expansion.mjs`, `negative-cache.mjs`, `raptor.mjs`,
`graph-communities.mjs`: a genuinely deep hybrid pipeline (BM25 + dense +
SPLADE + RRF + ColBERT rerank + RAPTOR hierarchical clustering + GraphRAG
community detection + negative-document caching + multi-query expansion)
— far more than memory's one-line "SPLADE + BM25 + dense, RRF" summary
suggested. Corresponding builders: `build-embeddings.mjs`,
`build-splade-index.mjs`, `build-raptor-index.mjs`,
`build-graph-communities.mjs`, `build-negative-cache.mjs`,
`build-synonym-map.mjs`, `build-index.mjs`. Open question, not resolved
here: does this entire pipeline get cut too (brains do retrieval/synthesis
better, per the original pivot premise) or does it stay because it serves
live sessions independent of the sharing-library pivot?

**Confidence / outcome math** — `outcome-tracker.mjs`,
`compute-clusters.mjs`, `detect-borromean.mjs`, `detect-homology.mjs`,
`compute-nash-equilibrium.mjs`, `measure-injection-stability.mjs`,
`git-watch.mjs` — the mathematical framework (Gibbs phase rule two-phase
seeds, Borromean triads, persistent homology loop-closure, Nash
equilibrium injection weighting, Lyapunov stability) is real and
implemented, not wiki flavor text. MCP tools: `configure_relaxation`,
`mint_cascade_parent`, `split_two_phase_seed`, `record_outcome`,
`record_attribution`, `explain_relationships`, `show_connections`.

**Sharing / discovery / reputation — OLD model, Chunk H territory** —
`auto-seed.mjs`, `mcp-server/vault.mjs`, `build-stats.mjs`, `stonehub/`
(web app), `stones/index.json`, `.lodestone/seed-banks.json`,
`.lodestone/seed-confidence.json`. MCP tools: `auto_seed`,
`vault_promote`, `manage_seed_banks`. All being cut/archived per direct
confirmation — superseded by the new Henge/Public-Jar/manifest/graze
design and by second brains for the personal-sync half.

**Corpus maintenance / quality** — `review-seeds.mjs` (own-corpus
pruning), `flag-stale-seeds.mjs` + `check-framework-versions.mjs`
(framework version monitoring, matches memory), `migrate-seed-schema.mjs`
(the real enrichment pass), `verify-complete.mjs` (pre-session check),
`detect-relationships.mjs` + `detect-relationships-llm.mjs`
(supersedes/implies/see_also). MCP tools: `stale_seeds`,
`list_seed_drafts`, `save_seed_draft`, `approve_draft` — a draft-review
workflow architecturally similar to what Chunk D needs, worth studying as
a pattern even though it reviews auto-generated drafts, not graze
candidates.

**Generation / output** — `generate-outputs.mjs` (the real corpus →
generated/skills, generated/tools, generated/workflows compiler, keyed on
a seed's `type` field), `build-claude-projects.mjs` + `build-nano.mjs`
(context-budget-tiered outputs), `generate-seed-drafts.mjs` (mines
session gaps for new seed candidates — a different "drafting" concept
than Chunk 0's capture), `harvest-docs.mjs` (matches memory's
"harvest_docs works for any domain"), `add-citations-llm.mjs`
(doc_reference quality), `index-datasource.mjs` + `datasources.mjs`
(connector registry for local data sources).

**Session / profile tools** — `context.mjs`, `lodestone-preflight.mjs`,
`init.mjs` (session setup, active-stack detection). MCP tools:
`session_update`, `set_profile`, `list_profiles`, `seed_overview`,
`seed_scout`, `show_dashboard`, `show_health`, `show_panel`, `show_seeds`,
`open_view`, `plan_workflow`, `generate_skill`, `configure`,
`lookup_symptom`, `get_seed`, `list_stacks`, `rag_connect`. `profiles.json`
confirmed real and load-bearing (`set_profile`/`list_profiles`) —
active_facets/active_domains presets scoping LOCAL session injection.
Directly relevant to Chunk C: a Jar's active profile is exactly the
"declared metadata" decision 7 says grazing should score against.

### Rework required before Chunk C

1. Fix `blast` → `blast_radius` across `lib/seed-schema.mjs`,
   `lib/capture-seed.mjs`, `scripts/capture.mjs`, `MANIFEST.md`.
2. Reconsider Chunk 0: retrofit privacy-lint into the real `capture_weed`/
   `capture_fix` handlers instead of a parallel `capture_seed` tool; build
   the missing `manage-personal.mjs promote` command for real.
3. Chunk C (graze): fresh build confirmed, informed by `profiles.json`'s
   active_facets/active_domains as the local scoring target — explicitly
   NOT reusing `auto_seed.mjs`/StoneHub's reputation-based model.
4. Chunk H's scope grows: vault.mjs, StoneHub (web app + backend),
   build-stats.mjs, seed-banks.json, seed-confidence.json, stones/index.json
   — archived together as "the old brain-shaped Stone model," not vault alone.
5. `generated/manifest.json` rename target corrected to `build-catalog.json`.

### Retrofit + Chunk C status: built and tested against the REAL repo (2026-07-04)

**Fix 1 — `blast` → `blast_radius`.** Global fix across `lib/seed-schema.mjs`,
`lib/capture-seed.mjs`, `scripts/capture.mjs`. Re-verified with the original
Chunk 0 clean-capture test case using the corrected field name.

**Fix 2 — `capture_weed` is not the retrofit target.** Its own tool
description confirms it: "personal and private — always gitignored, never
committed, never shared with other users." No upload path exists there by
design, correctly. The real target is `captureFix()` (the `capture_fix`
tool, `mcp-server/index.mjs` line ~1133) — it already builds a
`communityChunkJson` for upload. Patched it directly: added
`mcp-server/privacy-lint.mjs` (same rule set as `lib/privacy-lint.mjs`,
adapted for the real chunk shape — `title`/`content`/`wrong`/`correct`/
`doc_reference`, no separate `symptom` key at capture time since it's
folded into `content` until `migrate-seed-schema.mjs` extracts it later),
imported it alongside the file's existing extracted-module imports
(`vault.mjs`/`weeds.mjs` pattern), and gated `actions.upload` on it —
blocking findings replace the upload action with a warning instead of
`chunk_json`, `model_instruction` tells the calling model not to offer
upload, `implement`/`neither` stay available regardless. `captureFix()`
still always saves locally no matter what — only the community-upload
path is gated. Verified: `node --check` passes on the patched 4,000+ line
file; the lint logic itself unit-tested against realistic leaky/clean
chunks in isolation (full end-to-end `captureFix()` invocation wasn't
run — it needs the live server's full config/GUI context, out of scope
for a static patch).

**Fix 3 — built the actually-missing `manage-personal.mjs`.** `list` and
`promote <id>` subcommands, fulfilling the promise `capture_fix`'s own
output has been making. `promote` reuses the exact strip/rebuild
transform `captureFix()` does inline (drop `captured_at`/`project`/
`source`/`verification_status`, rebuild `source:'community'`), runs the
same privacy gate, and — bonus fix — actually builds the GitHub issue URL
that the existing "note" field has always referenced but never
constructed (manual pre-filled URL always; real API-based one-click issue
creation if `GITHUB_TOKEN` is set). Target repo configurable via
`.lodestone/config.json`'s new `community_repo` field, defaulting to a
placeholder (`alexbkirby-glitch/lodestone`) that needs updating once the
rename/repo move is final. Verified against a real fixture: `list` prints
correctly; `promote` on a clean seed produces a correct community chunk
(with `project` — a real path-leak field — always stripped) and a valid
GitHub issue URL; `promote` on a leaky seed blocks by default (exit 1)
and only proceeds under explicit `--force`; `promote` on a nonexistent id
errors cleanly.

**Privacy-lint calibration — found and fixed against the REAL corpus, not
a synthetic one.** Ran `generate-manifest.mjs` for real against all 2,156
seeds. First pass: 11 seeds failed privacy lint. Checked every one —
**100% false positives**: `host.docker.internal` (Docker Desktop's own
documented magic hostname), `.env.local` (Next.js/dotenv's own file
naming convention, not a hostname at all), and placeholder emails using
RFC 2606 reserved domains (`example.com`, `test.com`) or trivially
minimal examples (`a@b.com`). Fixed with an allowlist in both
`lib/privacy-lint.mjs` and `mcp-server/privacy-lint.mjs` (kept identical
— same policy, two enforcement points): exempt domains
`example.{com,org,net,edu}`/`test.com`/`yourdomain.com`; exempt hostnames
where the label before `.internal`/`.local`/etc. is a known non-company
token (`env`, `path`, `docker`, `test`, `tmp`, `config`, `settings`,
`local`) or ends in `.svc.cluster.local` (Kubernetes' own generic internal
DNS); exempt emails where both the local-part and domain-label are ≤2
characters (the `a@b.com` pattern). First attempt at the fix still missed
2 of the 11 — `host.docker.internal`'s exact-string exemption silently
never fired because the regex itself only ever captures the last two
labels (`docker.internal`), not the full three-label string being
exempted; fixed by adding `docker` to the preceding-label heuristic
instead of an exact-string match. Second pass: zero false positives,
manifest generated cleanly. **Trade-off worth naming explicitly:** the
≤2-character email heuristic could in principle under-flag a real leak
from a company with a 2-letter domain — accepted deliberately, since
genuine leaks in antipattern-seed prose are far more likely to look like
`jane.doe@realcompany.com` than `jd@ge.com`, and the false-positive cost
(crying wolf on 11 real, legitimate, already-public seeds) was actively
corrosive to trust in the gate.

**Fix — `doc_reference` removed from `MANDATORY_FIELDS`.** It was
requiring the key's mere *presence* while a separate check in the same
function already treated it as nullable — an internal inconsistency,
proven wrong by 391 real seeds that omit the key entirely rather than
nulling it. Now optional, still type-checked (warning, not error) when
present.

**New finding, not fixed, flagged for later:** 347 real seeds are missing
a `source` field entirely (mostly early-corpus batches — e.g. all 8
`ab-testing.json` seeds). Left as a structural-lint warning, not
silently defaulted or hard-failed. Good candidate for a small addition to
`migrate-seed-schema.mjs` (backfill `source: 'community'` corpus-wide),
matching that script's existing job — not built here, flagging only.

**Chunk C (`scripts/graze.mjs`) — fresh build, confirmed per direct
instruction, NOT an adaptation of `auto_seed.mjs`/StoneHub.** Discovery
via GitHub topic search (placeholder topic `brain-jar` — cold-start
problem named explicitly in the script's own header: no repos are tagged
with it yet, since StoneHub's old topic `lodestone` is being retired
alongside the reputation model it served). Manifest fetch + validation
reuses Chunk B's `validateManifest()`/`isSchemaVersionCompatible()`
directly — zero duplicated logic. Shallow scoring (decision 7) implements
what "declared metadata (stacks, facets, profile)" concretely means now
that the real repo is visible: a hard profile filter using
`profiles.json`'s actual `active_facets`/`active_domains` semantics
(empty = no restriction, matching that file's own documented behavior
exactly), plus a soft relevance score blending tag-Jaccard and
token-overlap against the local Jar's own seed corpus text — reusing the
exact tokenizer/stopword list from `mcp-server/index.mjs`'s existing
Jaccard duplicate-detection code, for scoring consistency across the
codebase rather than inventing a second tokenization scheme. Cheap
id-level dedup against the local corpus's known ids; full duplicate
scoring stays Chunk D's job, deliberately not duplicated here. Never
auto-merges — always writes to `.lodestone/graze-staged.json` for human/
Chunk D review. `--local-fixture` mode built specifically to test the
scoring/staging pipeline without a live tagged repo to graze from (the
cold-start problem above). Verified end-to-end against a constructed
fixture: a mock remote Vue Jar with one on-profile seed and one
off-profile seed (domain: mathematics/facet: research) — the off-profile
seed was correctly rejected by the hard filter before scoring ever ran;
the on-profile seed scored 0.80 against the real local corpus's actual
tag vocabulary and was correctly flagged with `STRUCTURAL_ISSUES` (it was
missing an explicit `symptom` field, by design in the test fixture) —
proving the structural-lint surfacing Chunk D will need is already
flowing through correctly. GitHub API path (rate-limit header check,
`GITHUB_TOKEN` support) is implemented but not live-tested against a real
tagged repo, since none exist yet.

Also fixed mid-build: the original `graze.mjs` attached `grazed_from`
provenance only to the staging wrapper (`source_jar`), not to the seed
object itself — caught re-reading the original Chunk C spec, which
requires the SEED to carry `grazed_from` so the citation chain survives
if it's re-shared after adoption. Fixed to accumulate a chain (extend, not
overwrite, any prior `grazed_from` history the seed already carried),
verified with a re-run of the same fixture.

**Chunk D (`scripts/review-graze.mjs`) — built and tested against real
duplicate data, not just fixtures.** Reads Chunk C's staged-candidates
file, produces both a console summary and a markdown review queue
(resolving the original spec's open "CLI vs markdown vs web, not yet
decided" question in favor of both — markdown for the durable, git-
friendly artifact matching WIKI.md/MANIFEST.md convention, console for a
quick glance). Duplicate detection deliberately reuses `captureFix()`'s
exact Jaccard token-overlap formula and `0.45` threshold rather than a
second similarity metric — same tokenizer as `graze.mjs` and
`mcp-server/index.mjs`, third call site now, still not forked. Verified
against three constructed candidates: one built by lightly rewording a
REAL seed already in the corpus (`react_stale_closure`) — correctly
flagged at 67% overlap against the actual local corpus, not a synthetic
one; one with a genuine missing `symptom` field — correctly flagged
structural; one clean, novel Go seed — correctly passed with no false
duplicate match against the real Go stack. Multi-hop `grazed_from` chains
render correctly in both output formats. Deliberately does NOT implement
an actual "graft" (merge-into-`seeds/<stack>.json`) action — that's a
human decision and an unbuilt capability; the old `vault.mjs`'s
`graftExternal()` is not reused, since it belongs to the subsystem being
archived in Chunk H and carries its own path-traversal history.

### Overall project status as of 2026-07-04

**Built and tested against the real repo:** Chunk 0 (`capture_weed`
correctly identified as out-of-scope and left alone; `captureFix()`
patched with a privacy gate on its community-upload path; the previously-
missing `manage-personal.mjs` built for real), Chunk B (`generate-
manifest.mjs`, run successfully against the actual 2,156-seed/118-stack
corpus, real `brain-jar-manifest.json` produced), Chunk C (`graze.mjs`,
fresh build, tested via `--local-fixture` since no Public Jars exist yet
to graze from live), Chunk D (`review-graze.mjs`, tested against a
real-corpus duplicate).

**Built but only tested against the wiki-export fragment, NOT yet run
against the real repo:** Chunk A (`rename-pass.mjs`) — the real repo has
~519 "Stone," ~170 "Henge," ~592 "vault," ~79 "Distill" occurrences in
live code (function names, directory constants, HTTP routes, env var
names like `DISTILL_REVIEW_ENDPOINT`), none of which this pass has
touched. Running it against live code is a materially different risk
profile than markdown and deliberately hasn't been attempted without a
dedicated pass.

### Chunk E status: built and tested against the real repo (2026-07-04)

**Approach: fresh slim server, not surgery on the monolith.** The old
44-tool `mcp-server/index.mjs` (4,063 lines) was renamed untouched to
`mcp-server/index.legacy.mjs` (same-dir relative imports keep working) and
is now Chunk H's problem in its entirety. The replacement is two files:
`mcp-server/tools.mjs` (all handler implementations, individually exported
and unit-testable) and a thin `mcp-server/index.mjs` (MCP registration +
stdio only). The entrypoint path is unchanged, so existing `mcpServers`
config blocks keep working.

**Spec amendment — the original five-tool list had no demand side.**
`capture_seed`/`publish`/`list_jars`/`graze`/`validate_schema` were all
supply-side plumbing; with zero read tools, a connected brain could not
pull a single seed, contradicting decision 5 and the vocabulary table's
own Brain entry ("consume Brain Jar's seeds via MCP (live)"). Confirmed
with the project owner: the trimmed surface is NINE tools, adding
`get_seed`, `list_stacks`, and `lookup_symptom` as a deliberately
lightweight read surface. `lookup_symptom` is BM25-lite (token idf + tag
overlap, same shared tokenizer — fourth call site, still not forked); the
embedding/SPLADE/RAPTOR/ColBERT stack is NOT loaded by the new server,
which leaves the "does the hybrid pipeline get cut" question fully open
for Chunk H without prejudging it — the pipeline's files are simply
unreferenced by the live server now.

**capture_fix survives alongside capture_seed**, per Section 0's
two-capture-paths ruling — ported verbatim from the legacy server with its
Chunk-0-retrofit privacy gate, duplicate detection (0.45 Jaccard), and
quality scoring intact. Only the embeddings-cache bust was dropped
(replaced by the BM25-lite index bust). `capture_seed` is the Chunk 0
wiring finally landed — the thin MCP wrapper `lib/capture-seed.mjs`'s own
header sketched, staging to `seeds/personal/captured.json`.

**Discovery extracted to `lib/discover-jars.mjs`.** `list_jars` and
`graze.mjs` now share one implementation of the GitHub topic-search /
manifest-validation trio (was: private functions inside graze.mjs, which
auto-runs `main()` on import and therefore couldn't be imported).
graze.mjs was refactored to import from the new lib and re-verified
end-to-end via `--local-fixture` after the refactor.

**`publish` and `graze` are spawn wrappers over the offline scripts**
(`generate-manifest.mjs`, `graze.mjs` + `review-graze.mjs` chained), not
reimplementations — decision 2 (grazing is offline batch) survives; the
tools trigger the batch on explicit request, nothing runs during
injection. `graze` runs the Chunk D review queue automatically after
staging and returns the report path. REMOTE mode (`LODESTONE_REMOTE_URL`)
was deliberately dropped from the read tools: a library serves its own
shelf; cross-Jar reads are graze's job.

**Verified:** 17/17 handler smoke tests against the real 2,156-seed
corpus (list_stacks finds 118+, lookup_symptom surfaces
`react_stale_closure` for a stale-closure query, validate_schema passes a
real seed / fails garbage / privacy-flags a planted leak, capture_seed
stages clean + rejects placeholder, capture_fix clean/duplicate/leaky
paths all behave, manifest mode validates the real root manifest);
`publish --check` runs clean against all 2,156 seeds; `graze` fixture
end-to-end through the REFACTORED graze.mjs stages 2 candidates and
renders the review queue; `list_jars` live against the real GitHub API
returns the expected cold-start empty set with the tagging-is-consent
note. Test side effects (personal-patterns.json, captured.json, staged
candidates) backed up and restored/cleaned.

**Housekeeping:** root package.json's `scout` script (seed_scout —
StoneHub, Chunk H) removed; `promote` repointed at the real
`scripts/manage-personal.mjs promote`. mcp-server/package.json renamed
`brain-jar-mcp` v2.0.0; mcp-server/README.md rewritten for the nine-tool
surface with an explicit pointer to index.legacy.mjs.

**Flagged, not fixed:** (a) npm-publishing `mcp-server/` alone would break
— tools.mjs imports `../lib/`; noted in the README, packaging is a later
decision. (b) GETTING-STARTED.md and README.md at repo root still
reference removed tools (capture_weed, show_dashboard, etc.) — that's
Chunk A live-rename/doc-pass territory, not silently patched here.
(c) The legacy server's `--explain` mode was not ported — decide
separately whether the slim server wants one.

**Built 2026-07-04 (same session as Chunk E):** Chunk F (root SCHEMA.md —
spec + 13-clause export contract) and Chunk G (export-to-gbrain.mjs,
contract-tested against GBrain v0.42.56.0's real parser — see both
chunks' status entries in Section 3).

### Chunk H status: executed (2026-07-04)

**The delete-vs-freeze fork was resolved by doing both:** legacy code was
deleted from the working tree AND packaged as a self-contained
`lodestone-legacy` bundle (860K zip with its own README) ready to push as
an archived GitHub repo. Git history + a `pre-brain-jar-trim` tag cover
recovery regardless. Classification was drawn by dependency audit, not
vibes: the surviving core touches exactly six lib files, three mcp-server
files, and the maintained script set.

**Four tiers, contract-documented in root `MAINTENANCE.md`:**
1. *Maintained core* — lib/, nine-tool server, graze/publish/capture/
   export/enrichment scripts, seeds, contracts.
2. *Unmaintained, kept in-repo* (owner's call, resolving Chunk E's open
   question): the full hybrid retrieval pipeline — embeddings/SPLADE/
   RAPTOR/ColBERT/GraphRAG modules, their build scripts, the prebuilt
   api/ indexes — because the research tier depends on it and revival is
   cheaper with code in place. The live server loads none of it.
3. *Research* (`research/`, owner's call) — the ROADMAP math tracks moved
   from scripts/ (nash, borromean, homology, clusters, rag-metrics,
   injection-stability, fine-tune-embeddings); relative imports preserved
   by keeping the dir at root depth. npm loops:* entries repointed.
4. *Frozen legacy* (bundle, not repo) — 44-tool monolith + vault + weeds
   + api-schema.js copy, StoneHub, stones/, gui/, extension/, artifacts/,
   wiki-era generated/, old CLI workflow (init/context/preflight/
   git-watch), outcome telemetry, and the LLM corpus-GROWTH pipeline.

**The growth/enrichment line** (drawn during execution): LLM automation
that CREATES seeds (auto-seed, generate-seed-drafts, harvest-docs,
review-seeds, index-datasource) went to the bundle; tooling that ENRICHES
existing seeds (add-citations-llm, detect-relationships[-llm],
migrate-seed-schema, check-framework-versions, flag-stale-seeds) stayed
maintained.

**Rescue (owner's call): `build-claude-projects.mjs` was not wiki cruft
but an export transform in disguise** — its output is uploaded into
Claude Projects. Renamed `export-to-claude-projects.mjs`, given the
SCHEMA.md MUST-4 privacy gate it lacked (its output leaves the machine),
npm-scripted as `export:claude-projects`, verified working (2,156 seeds,
~302K tokens, zero privacy exclusions).

**Collateral handled:** auto-seed.yml workflow (drove a deleted script,
would have failed on next cron) moved to the bundle; validate.yml
repointed at research/compute-rag-metrics.mjs; ~23 dead package.json
script entries removed and core-surface entries added (graze, publish,
export:gbrain, registry); dead STONEHUB nav link swapped for REGISTRY.
**Found and fixed a pre-existing bug the parse sweep surfaced:**
detect-relationships.mjs had a wholesale-duplicated "3b temporal
sequence" block (verified present in the original upload) — a Tier 1
script that didn't parse. Duplicate excised.

**Flagged, not fixed:** index.html is still the full Lodestone-era GUI
with pages referencing cut systems (extension download, StoneHub share
flow, outcomes) — that's the Chunk A rename/site pass, not H's knife.

### Chunk I status: built and live-tested (2026-07-04)

`scripts/build-registry.mjs` (third call site of lib/discover-jars.mjs —
one discovery implementation everywhere) + `.github/workflows/registry.yml`
(Monday cron + manual dispatch, commits only on change; the push triggers
the existing Build & Deploy workflow, so Pages updates for free — $0 by
construction as spec'd). Outputs `registry.json` (machine-readable, other
tools can build on it) and `registry.html` styled with the site's exact
CSS tokens.

Cold-start honest: zero jars renders a "be the first" walkthrough
(SCHEMA.md → npm run publish → tag the topic), not a fake directory.
Discovery failure degrades to the last committed registry rather than
committing an empty lie. "Wants a maintainer" callouts are driven by
owner-curated `maintainers-wanted.json` — curated slots, no invented
signals — rendered as badged cells in the 118-stack flagship grid.

**Verified live:** real GitHub API run (0 jars, expected), HTML
tag-balance validated, callout render path tested with a planted entry,
--offline mode works, registry.json reports 118 stacks / 2,156 seeds.

**All grill-session chunks (0, A–I) are now executed or superseded.** The
live plan continues in ROADMAP.md.

### Post-plan improvements + pre-upload housekeeping (2026-07-05)

**npm packaging (`npx brain-jar-mcp` now real).** Published-package design:
the repo root IS the package (`brain-jar` v2.0.0, bin `brain-jar-mcp`)
with a lean `files` whitelist — lib/, the three server files, the three
scripts the publish/graze tools spawn, and the contract docs. 44 KB
tarball; the corpus deliberately excluded (npx serves YOUR jar; clone for
the flagship). No bundler, no import rewrites — the whitelist keeps
`../lib` paths intact. mcp-server/package.json deleted (single-package
model; deps live at root, @xenova/transformers demoted to devDependencies
so consumers never pull it). The enabling refactor: `lib/jar-root.mjs`
splits the historically conflated PACKAGE root (where code lives) from
JAR root (whose seeds you serve) — resolution: BRAIN_JAR_ROOT env →
--jar= arg → package-parent-if-it-has-seeds (checkout mode, preserves all
prior behavior) → cwd. The server spawns scripts from PKG_ROOT with
BRAIN_JAR_ROOT handed down. **Verified in all three modes:** checkout
(17/17 regression), simulated npx in a virgin jar (ROOT=cwd, empty
list_stacks doesn't crash, first capture bootstraps seeds/personal/,
spawned generate-manifest scans the JAR not the package), and env
override serving the flagship from the installed package. Fresh
package-lock.json generated (the old one was absent from the zip and the
dep changes would have broken `npm ci` in deploy).

**Browser demo (`demo.html` + `scripts/build-demo-index.mjs`).** Paste an
error, search the corpus — the conversion funnel the site lacked.
Privacy-gated slim index (2,087 seeds, ~516 KB gzipped, lazy-loaded on
first focus), scoring math ported VERBATIM from lookup_symptom and
**parity-tested**: browser and server return identical top hits on shared
queries (harness lifts the demo's inline JS via regex and runs it in
node against the same index). Zero frameworks, nothing pasted leaves the
page. Linked from the nav (TRY IT), the registry, and the README.

**Housekeeping (the deploy pipeline was quietly broken in three ways):**
(1) build-index.mjs execSync-chained generate-outputs (bundled — crash),
build-starter (didn't exist — silent warn), and build-nano (double-ran on
every deploy on top of deploy.yml's own step). Chains removed; deploy.yml
is now the ONE place build order lives, with demo-index and
registry-offline steps added and the generate-outputs step dropped.
(2) generate-outputs.mjs itself imported the bundled context.mjs — moved
to the legacy bundle where its output dir already lives; build-nano stays
Tier 2 and its generated/claude-projects output is the only live content
of generated/ (MAINTENANCE.md updated). (3) sitemap.xml pointed at the
dead /Distill/ site path and llms.txt was still Distill-branded with
references to the deleted generated/skills/ — fixed in the GENERATORS,
not the artifacts, and regenerated (sitemap now includes registry.html +
demo.html).

**Docs de-fossilized:** README.md and GETTING-STARTED.md rewritten from
scratch (old versions: Lodestone brand, 1,741/89/26 counts, dead tools
like show_dashboard, dead preflight/outcome workflow, and a `cd
mcp-server && npm install` quickstart whose package.json no longer
exists). New README: identity, npx quickstart, the capture→publish→graze
loop, contract pointers. New GETTING-STARTED: three on-ramps (browser
demo → npx your own jar → clone the flagship). mcp-server/README setup
and packaging sections rewritten for the npm era. .gitignore gains
tarballs + export/.


**Known real corpus-quality gaps, flagged not fixed:** 347 seeds missing
`source`, `generated/manifest.json` still needs its rename to
`build-catalog.json`, `Distill`-era env var names (`DISTILL_REVIEW_ENDPOINT`,
`DISTILL_REVIEW_MODEL`) still live in `review-seeds.mjs`.

**Note on two capture paths that now coexist, deliberately:**
`lib/capture-seed.mjs`/`scripts/capture.mjs` (original Chunk 0) staff a
seed in the full canonical Brain Jar schema directly — explicit `symptom`,
optional `domain`/`facet` — useful for authoring a seed meant for
immediate publication, bypassing the enrich-later pipeline entirely. The
real `captureFix()` (now privacy-gated) is the live, in-session reflex for
personal bug fixes, which get enriched into the full schema later by
`migrate-seed-schema.mjs`. Different jobs, not a duplicate — but worth
flagging so a future session doesn't mistake one for a dead leftover of
the other.

## 1. The Plan

### Core premise
A second brain (GBrain, and whatever comes after it) does retrieval, synthesis,
and memory better than Lodestone ever did or needs to. Brain Jar's job is no
longer "be a brain" — it's **library, not brain**: a decentralized, shareable
collection of curated antipattern knowledge (seeds) that any brain can pull
from. Brains do the thinking; Brain Jar holds the curated stock.

### What's cut, and why
| Cut | Reasoning |
|---|---|
| Weeds (personal memory layer) | GBrain's dream-cycle + entity memory does this better; no reason to maintain a worse version |
| Wiki / concept-page synthesis | GBrain's synthesis layer + self-wiring graph is the more mature version of "explain the cross-cutting pattern" |
| Harness generation | GStack's "fat skills" markdown-workflow model is the more mature version of "teach the agent what to watch for" |
| Full 3-list retrieval pipeline (BM25+dense+SPLADE+RRF) as a query-serving layer | Once a seed is imported into someone's brain, *their* hybrid search serves it. Brain Jar only needs much lighter scoring for grazing, not a full serving-time engine |
| Most of the 26 MCP tools | Shrinks to ~4 once recall/synthesis/memory move to the brain layer |

These are either deleted outright or frozen into a separate "legacy Lodestone"
repo — not maintained going forward, the team's call which.

### What's kept, and why no better version exists
- **The seed schema** (WRONG→CORRECT→Symptom + `blast_radius`/`confidence`,
  antipattern-specific semantics). No second-brain product is shaped for
  code-risk facts the way this is — GBrain's freshness/contradiction model is
  shaped for facts-about-people, not facts-about-bugs.
- **The decentralized sharing apparatus** (manifest, grazing, opt-in via
  tagging, schema-versioning) — this is now Brain Jar's actual differentiator:
  a library *format and distribution protocol*, not a brain.

### Key decisions, in order reached
1. **No central server.** Public Jars are GitHub repos (as Henges always
   were); discovery is GitHub topic search; fetching is the GitHub API;
   "the server" is local graze logic running on each person's own machine.
   Avoids recreating the monoculture/single-point-of-failure risk already
   flagged for SeedBank.
2. **Grazing is offline batch, not live.** Matches the existing
   `--check-stale`-style philosophy (flag, don't auto-act; human decides).
   Avoids live-session latency/rate-limit dependency on GitHub's API.
3. **Manifest required at each Public Jar's repo root**, declaring
   `schema_version`. Cheap to generate from existing stats tooling.
4. **Schema versioning: N-1 compatibility only**, not forever-backward-compat.
   A grazer must read current and immediately-prior version; older Jars get
   one version's grace period. Keeps future schema changes (e.g. for new
   export targets) cheap rather than a permanent migration-shim tax.
5. **No GBrain-driven schema changes.** MCP already makes the schema invisible
   to any calling brain — a caller only ever sees a tool response, never the
   internal JSON shape. Brain-specific shaping happens at an **export
   boundary** (`export-to-gbrain.mjs` etc.), layered on top of a canonical,
   brain-agnostic schema. Keeps any one brain from becoming a privileged
   citizen the way SeedBank risks becoming for Lodestone's own corpus.
6. **Export transforms: open contract, not centrally maintained.** Brain Jar
   documents the canonical schema clearly (WIKI.md/HARNESS.md-style rigor);
   third parties write and maintain their own brain-specific transforms.
   Project optionally ships one reference transform (GBrain, since that's
   what started this). Matches the decentralization principle applied
   everywhere else in the project — not a place to quietly recentralize.
7. **Local scoring is shallow, not deep.** Grazing scores candidates against
   a Jar's own declared metadata (stacks, facets, profile) — never reads
   actual brain content. No privacy concern to mitigate because there's no
   brain-content channel at all. Deep scoring (querying the local brain
   directly, strictly local/opt-in) is a possible future precision upgrade,
   not part of v1.
8. **Public/Private Jar, with grazeable folded into tagging itself.** Tagging
   a repo public *is* the single consent act for both discovery and grazing —
   not two separately-set flags. (Originally designed as a separate
   `grazeable` field defaulting false; collapsed once "Henge" and "Jar" were
   unified into one noun with a public/private state.)
9. **No reputation/trust system for Jars.** Rejected as a rabbit hole (who
   scores trust, how do you stop gaming it, you're back to needing a central
   authority). Instead: **surface provenance** at review time — source Jar
   identity, corpus size, last-updated — plus reuse of existing scoring
   algorithms run *inward* against the user's own corpus to flag likely
   duplicates/contradictions, and a structural lint pass (are WRONG/CORRECT/
   Symptom populated, is `blast_radius` sane, etc.) before a candidate is even
   staged. All three are existing math, pointed in a new direction — no new
   capability required.

### Decisions added in the 2026-07-03 revision (contribution economics)

10. **Capture is Chunk 0, not an afterthought.** The original chunk list was
    all distribution plumbing (an interlibrary-loan system with no
    acquisitions department). Seeds get authored in the thirty seconds after
    a bug bites, or not at all — nobody hand-writes WRONG→CORRECT→Symptom
    JSON from memory later. A `capture_seed` MCP tool (drafts the record from
    session context, lints it, stages it into the local Jar) is the
    contribution engine and joins the surviving tool surface. This salvages
    the capture *reflex* from the cut weeds subsystem while still delegating
    personal memory to the brain layer.
11. **Design for selfish publishing, not altruism.** The dotfiles model:
    a Jar must be maximally valuable to its owner alone (capture + lint +
    graze), publishing must be a one-tag act, and privacy risk must be
    near-zero. Contribution falls out as a side effect of self-interest.
12. **Privacy lint gates `publish`.** The old seeds/weeds anonymizability
    boundary was the privacy filter; deleting weeds deleted the filter. It
    survives as a lint rule run before any publish: flag paths, hostnames,
    personal names, internal URLs. Without this, the rational move is never
    tagging public — killing the network by design.
13. **Attribution is the only currency at $0 — spend it hard.** Three
    static, serverless mechanisms: (a) a registry page on GH Pages, rebuilt
    by Actions from topic search, listing every known Public Jar with corpus
    size, stacks, last-updated (the awesome-list effect: being listed is the
    reward — and it fixes the weak discovery story of raw topic search);
    (b) `grazed_from` provenance retained in adopted seeds, so upstream
    authors ride along when downstream Jars publish — a citation graph for
    free; (c) explicit "stack wants a maintainer" ownership slots
    (DefinitelyTyped-style) across the 118 stacks.
14. **v1 must be viable at N=1 Jars.** The 2,156-seed flagship corpus is the
    anchor tenant; the first wave of users comes to graze, not to share
    (90-9-1 rule). Lower the contribution floor below "publish a whole Jar"
    by accepting single-seed PRs to the flagship Jar — not recentralization,
    just one big Jar among peers that happens to take pull requests. Success
    metric: useful at N=1, better at N=10 — not network effects.
15. **Seed schema shape: lean core, optional nullable enrichment — not a
    wikipedia-style rewrite.** Considered and rejected making seeds more
    wiki-article-like (prose, cross-refs) for "project-agnostic" bridge/
    universal seeds. Rejected because that repeats the exact mistake the
    wikilink postmortem already diagnosed — link/context-dependent
    structures don't survive retrieval; atomic self-contained chunks do.
    The real gap for bridge seeds isn't shape (WRONG→CORRECT→SYMPTOM
    generalizes fine as misconception→fix→observable-failure across
    non-code domains), it's routing metadata. Resolution: mandatory fields
    stay exactly what's already in `seeds/*.json`
    (id/stack/blast/source/wrong/correct/symptom/tags/doc_reference);
    `domain`/`facet`/`confidence` become optional/nullable/additive, set
    only when cheap at capture time. RAG-synthesis fields (summary,
    example_triggers, antipattern_category, applies_when,
    structural_pattern) stay out of the seed entirely — those are wiki-
    build-time derivations (WIKI.md), not capture-time authoring, per the
    same raw/wiki/schema layer split WIKI.md already enforces.

### Chunk 0 status: built and smoke-tested (2026-07-03)
`lib/seed-schema.mjs` (schema + structural lint), `lib/privacy-lint.mjs`
(heuristic PII/secret detection, advisory at capture, hard gate at publish
via `assertPublishable`), `lib/capture-seed.mjs` (the engine — append-only
staging, id derivation, dual-lint), `scripts/capture.mjs` (CLI wrapper for
testing before MCP wiring). Verified against four cases: clean valid seed,
a seed leaking an internal hostname + email + private IP (staged locally,
correctly blocked at publish), a placeholder/garbage seed (rejected before
ever hitting disk), and a true duplicate id (throws, does not overwrite).
Not yet wired into the actual 26-tool MCP server — that server's source
wasn't part of this repo snapshot, so `captureSeed()` is framework-agnostic
by design; wiring is a thin wrapper, sketched in the file's header comment.

### Decisions added while executing Chunk A (2026-07-03)

16. **`vault` subsystem is dead — Chunk H archive candidate, not a rename
    target.** `vault_pull`, `vault_promote`, `.lodestone/vault/` predate
    Henge/Jar entirely and are superseded by them. Confirmed dead, not
    live. Flagged for Chunk H (fork to legacy repo or delete outright),
    explicitly excluded from Chunk A's rename pass.
17. **The self-referential `lodestone` stack id is exempt from the rename,
    permanently.** `wiki/stacks/lodestone.md` / `seeds/lodestone.json`
    catalog bugs in Brain Jar's own historical codebase (including the now-
    dead vault subsystem). Renaming this stack id to `brain-jar` would
    collide the project's own name with a stack about the project's old
    bugs. Kept as `lodestone` — a legacy label, not the live product name.
    The whole `lodestone.md` page is effectively a Chunk H artifact (it
    documents dead vault/Henge-era code), not a Chunk A rename target —
    excluded from the rename pass entirely rather than partially edited.
18. **`manifest` term collision resolved: old sense renames, new sense
    keeps the name.** The pre-existing project-wide `manifest.json` (seed
    index — `'no stacks found' when querying manifest.json for seed data`)
    is being renamed to `seeds-index.json`. Chunk B's new per-Public-Jar-
    repo-root file keeps the name `manifest` — it's the newer, more
    central concept to the redesign and the one third parties will read
    the spec doc for. This rename is NOT executed by the Chunk A script —
    disambiguating old vs. new sense by regex against the full real repo
    (which this session doesn't have access to) is unsafe; the script only
    *reports* every `manifest`/`manifest.json` hit it finds, for manual
    confirmation before touching.

### Chunk A status: executed and verified (2026-07-03)
`scripts/rename-pass.mjs` built as targeted phrase/word substitution +
report-only scanning, deliberately NOT a blind `s/Lodestone/Brain Jar/g` —
that would have silently corrupted the `lodestone` stack id (decision 17).
Design: (1) hand-audited PHRASE_RULES and WORD_RULES applied in `--write`
mode; (2) EXCLUDE_PATTERNS skip `wiki/stacks/lodestone.md` and
`seeds/lodestone.json` entirely; (3) a residual scanner re-checks
post-transformation text (a first draft of this incorrectly re-read stale
on-disk content in dry-run mode, producing false "missed" alarms — fixed
before running for real) for any remaining `lodestone` outside excluded
files; (4) three report-only scanners (`grazeable`, `manifest`, `vault`)
that never auto-replace, only surface findings with file/line/context.

Run against the actual wiki export: 117 stack pages' title lines and
"auto-generated from the Lodestone seed library" lines renamed to Brain
Jar, `seed-authoring.md`'s two Stone→Jar instances landed, `WIKI.md` /
`wiki/index.md` / `wiki/log.md` / `scripts/build-wiki.mjs` prose updated.
Residual scan came back with exactly 3 hits, all correctly left alone: the
repo URL in `build-wiki.mjs`'s license line (needs a manual GitHub repo
rename, not a script's job) and two `lodestone` stack-id references
(`boundary_sensitivity.md`'s domain list, `index.md`'s wikilink) — both
protected by decision 17. Zero false positives, zero missed renames.

Not executed: renaming the GitHub repo itself / its URL (deployment-level
operation, do by hand once PyPI/domain checks clear per the still-open
item from the original session); the `manifest.json`→`seeds-index.json`
rename (report-only per decision 18, needs the full real repo to execute
safely); the `grazeable` field fold (logic change, not a text rename —
Chunk A's script flags it, doesn't touch it).

### Decisions added while executing Chunk B (2026-07-04)

19. **The manifest carries more than `schema_version` — it's the single
    provenance source for Chunks D and I too.** The original Chunk B scope
    only specified `schema_version`. Extended to also include `jar_name`,
    `seed_count`, `stacks`, `last_updated`, and optional `domains`/`facets`
    — because Chunk D (review-queue provenance surfacing) and Chunk I
    (registry page) both need exactly this data and would otherwise each
    invent a second file to hold it. One manifest, three consumers
    (grazer, review queue, registry).
20. **`schema_version` is a plain incrementing integer, pinned in
    `lib/seed-schema.mjs` as `SCHEMA_VERSION = 1`**, not a semver string.
    N-1 compatibility (decision 4) reduces to `declared === current ||
    declared === current - 1` — see `isSchemaVersionCompatible()`. Kept
    deliberately dumber than semver: there's no minor/patch axis to a seed
    shape, only "breaking or not," so one integer is the whole model.
    Explicitly distinct from a Jar's own content/corpus versioning (e.g.
    the flagship's informal "v48" label) — different axis, not tracked by
    this field.
21. **Manifest filename: `brain-jar-manifest.json`, visible, not a
    dotfile.** Avoids colliding with PWA/browser-extension `manifest.json`
    conventions; visibility doubles as a human-readable "this is a Jar"
    signal on the repo page, consistent with decision 13's
    attribution-over-authority stance.
22. **Two lint gates at manifest-generation time, different severities.**
    Structural lint runs per seed and only warns — full seed-quality
    gating already belongs to the pre-existing `lint-seeds.mjs`, and
    re-litigating it here would be scope creep. Privacy lint (high
    severity only) hard-blocks by default, `--force`-overridable. This
    closes a real gap Chunk 0 didn't cover: nothing stopped a seed
    hand-edited directly into `seeds/<stack>.json` from skipping
    `capture_seed`'s advisory check entirely — the manifest generator is
    the last checkpoint before those stats go public.
23. **`seeds/personal/` is unconditionally excluded from manifest stats.**
    Not configurable, not a flag — matches Chunk 0's capture-staging
    directory exactly, so a seed captured locally never contributes to a
    published `seed_count` regardless of its own lint status.

### Chunk B status: built and smoke-tested (2026-07-04)
`lib/seed-schema.mjs` extended with `SCHEMA_VERSION` + `isSchemaVersionCompatible()`.
`lib/manifest.mjs` (corpus scanner + manifest builder + `validateManifest()`
for future grazer use), `scripts/generate-manifest.mjs` (CLI, mirrors
`build-wiki.mjs`'s ROOT/arg-parsing conventions, appends to `wiki/log.md`
if present), `MANIFEST.md` (WIKI.md-rigor spec doc for third-party
grazer/registry authors).

Verified against a synthetic fixture (real `seeds/*.json` corpus wasn't in
this session's repo snapshot): confirmed `seeds/personal/` is excluded
from every stat even when it contains a privacy-violating seed; confirmed
a seed hand-edited straight into `seeds/web-security.json` — bypassing
`capture_seed` entirely — still gets caught by the privacy gate and blocks
the write with a non-zero exit (CI-friendly); confirmed a clean corpus
writes a well-formed manifest with `domains` correctly omitted when empty
rather than present-and-null; confirmed `--check` mode validates without
writing; confirmed `--force` writes anyway with a loud warning; confirmed
`isSchemaVersionCompatible` accepts current and N-1, rejects both older
and newer versions; confirmed `validateManifest()` catches missing fields
and wrong types on malformed input.

Not built yet: anything that reads a *fetched* (remote) manifest — that's
Chunk C's job (`graze.mjs` calling `validateManifest()` +
`isSchemaVersionCompatible()` on each candidate Public Jar before trusting
it).

### Constraints
- No timeline.
- No stack non-negotiables.
- $0 budget — already true by construction (GitHub Pages hosting, no central
  server, no LLM calls anywhere in the graze/lint/scoring path).

### Open questions / explicitly out of scope for v1
- Exact `capture_seed` UX: MCP tool only, or also a brain-side skill/prompt
  that pre-drafts the seed from session context? (Chunk 0 owner decides.)
- Privacy lint rule set: regex heuristics vs. a curated pattern list — start
  heuristic, tighten from false negatives.
- Deep (brain-content-aware) local scoring — possible future upgrade, not v1.
- Any reputation/trust scoring for Jars — deliberately rejected, not deferred.
- Export transforms for any brain beyond one optional GBrain reference
  implementation — left to the open contract / third parties.
- Final project name confirmed as **Brain Jar**; npm search came back clean
  for "brainjar" — a PyPI + domain/WHOIS check was flagged as still worth
  doing before fully committing, not yet confirmed done as of this session.

---

## 2. Shared Vocabulary

| Term | Definition |
|---|---|
| **Brain Jar** | The project (was Lodestone). A library that feeds second brains — not a brain itself. |
| **Jar** | A personal seed collection (was Stone). Same noun doubles as project name and personal-instance unit, same pattern "Stone" used. |
| **Public Jar** | A Jar tagged for discovery (was Henge). Tagging *is* the consent act for both being found via search and being grazed from — not two separate steps. |
| **Private Jar** | The default: untagged, invisible, no manifest required. |
| **Seed** | A structured antipattern record: WRONG → CORRECT → Symptom, plus risk metadata (`blast_radius`, `confidence`, etc.). Unchanged by this redesign. |
| **Grazing** | The offline batch process by which one Jar pulls and scores candidate seeds from Public Jars. Shallow scoring only (BM25 + tag overlap), never auto-merges, always stages for human review. |
| **Manifest** | A required file (`lodestone-manifest.json` or renamed equivalent) at a Public Jar's repo root, declaring at minimum `schema_version`. |
| **Schema version / N-1 compatibility** | Breaking schema changes are allowed; a grazer must be able to read the current and immediately-prior version only, not the full history. |
| **Export transform** | Brain-specific code (e.g. `export-to-gbrain.mjs`) that converts canonical seeds into another brain's native ingestion format. Lives at the boundary, not in the canonical schema. Maintained under an open contract — third parties write their own; Brain Jar may ship one reference example. |
| **Shallow scoring** | Scoring candidates against a Jar's own declared metadata only (stacks, facets, profile) — never reading actual brain content. The only scoring depth planned for v1. |
| **Provenance surfacing** | Showing a review-queue candidate's source Jar identity, corpus size, and last-updated date alongside it, in place of any trust/reputation score. |
| **Brain** | An external memory/reasoning system (GBrain, GStack, Hindsight, etc.) that may consume Brain Jar's seeds via MCP (live) or an export transform (native import). Brain Jar does not compete with this layer. |
| **Capture** | The act of drafting a new seed at the moment of pain — via the `capture_seed` MCP tool, from live session context. The contribution engine; everything else is distribution. |
| **Privacy lint** | A pre-publish lint pass flagging non-anonymizable content (paths, hostnames, personal names, internal URLs). Successor to the old seeds/weeds anonymizability boundary. |
| **Registry page** | A static GH Pages page, rebuilt by Actions from GitHub topic search, listing all known Public Jars with corpus size, stacks, and last-updated. The discovery layer and the attribution reward, in one artifact. |
| **`grazed_from`** | Provenance metadata retained in an adopted seed, naming its source Jar. Accumulates into a free citation graph as Jars re-publish. |
| **Anchor tenant** | The 2,156-seed flagship Jar. v1's reason to show up; accepts single-seed PRs to keep the contribution floor low. |
| **Manifest** (disambiguated) | Refers ONLY to the new Chunk B per-Public-Jar-repo-root file (`brain-jar-manifest.json`) as of decision 18. Full field set per Chunk B (decision 19): `schema_version`, `jar_name`, `seed_count`, `stacks`, `last_updated`, optional `domains`/`facets`. The old project-wide seed index that used to share this name is being renamed `seeds-index.json` to free it up. |
| **`seeds-index.json`** | The renamed old project-wide seed index (formerly `manifest.json`) — answers "what stacks/seeds exist," distinct from the new per-Jar manifest. |
| **`lodestone` (stack id)** | Permanently exempt from the Brain Jar rename. Refers to the self-referential meta-stack cataloging bugs in the project's own historical codebase. Not the live product name. |
| **vault subsystem** | `mcp-server/vault.mjs` (1,018 lines) — live, imported, real tool (`vault_promote`) and GitHub-backed private cross-Stone sync. NOT dead as originally assumed. Cut per direct confirmation because brains are functionally better vaults, same reasoning as weeds — not because it was already superseded. Chunk H archive candidate. |
| **StoneHub** | The real, live GitHub-topic-search discovery mechanism (`auto_seed`, `loadSeedBanks()`, topic `lodestone`) — decision 1's design already existed under this name. Cut alongside vault per direct confirmation: built when "Stone" meant "personal brain," doesn't fit library-not-brain. The new Henge/Public-Jar/manifest/graze design is a deliberate fresh reimplementation, not an adaptation. Chunk H archive candidate. |
| **`build-stats.mjs`** | Computes reputation/trust scores "read by StoneHub" — confirms decision 9 (no reputation system) was a deliberate departure from a real prior system, not an oversight. Chunk H archive candidate, serves StoneHub. |

Terms retired this session: **Stone** → Jar. **Henge** → Public Jar. **Weed**
→ cut entirely (superseded by brain-native memory). **Lodestone** → Brain Jar
(name retained as historical/legacy reference only).

---

## 3. Suggested Breakdown

Each chunk below is sized to be handed to a future model independently, with
its own inputs/outputs and explicit dependencies.

### Chunk 0 — Capture path + privacy lint
- **Job:** Build `capture_seed`: an MCP tool that drafts a
  WRONG→CORRECT→Symptom record from live session context, runs structural
  lint + the new privacy lint (paths, hostnames, names, internal URLs), and
  stages it into the local Jar. Privacy lint also wired as a hard gate on
  `publish`.
- **Inputs:** Existing seed schema; existing structural-lint logic; the old
  `capture_weed` tool as a starting skeleton (repointed at seeds).
- **Outputs:** `capture_seed` tool + privacy lint module (shared by capture
  and publish paths).
- **Dependencies:** None — and highest leverage, so first. Without it, the
  network has no acquisitions department.

### Chunk A — Rename pass
- **Job:** Mechanical rename across existing Lodestone codebase/docs: Stone→Jar,
  Henge→Public Jar, Lodestone→Brain Jar, fold standalone `grazeable` field
  references into "tagging = consent."
- **Inputs:** Existing Lodestone repo/codebase.
- **Outputs:** Same codebase, renamed, no behavior change yet.
- **Dependencies:** None — can start immediately, independent of every other chunk.

### Chunk B — Manifest spec + generator
- **Job:** Define `schema_version` field format and N-1 compatibility rule;
  write/extend a stats-style script to auto-generate the manifest file at
  Jar repo root whenever a Public Jar is built/published.
- **Inputs:** Existing `build-stats.mjs`-style tooling (per project memory).
- **Outputs:** Manifest schema spec doc + generator script.
- **Dependencies:** Benefits from Chunk A's renaming being done first, but not blocking.

### Chunk C — Graze script
- **Job:** Offline batch script: list Public Jars via GitHub topic search,
  read+validate each manifest (skip incompatible `schema_version`), fetch
  seed payloads, score against the local Jar's declared metadata (shallow:
  BM25 + tag overlap only), stage candidates — never auto-merge.
- **Inputs:** Chunk B's manifest spec (must exist first). GitHub API access.
- **Outputs:** `graze.mjs`-equivalent script + staged-candidates output format.
- **Dependencies:** Chunk B.
- **Note:** Unauthenticated GitHub API is 60 req/hr — grazing more than a
  handful of Jars needs a PAT. Spec must document this so it doesn't surprise
  anyone; graze script should read a token from env and degrade gracefully
  without one. Adopted seeds must retain `grazed_from` provenance (feeds
  Chunk D display and the citation graph).
- **Status (2026-07-04): built and tested, see full writeup in Section 0.**
  Corrected from the original scope in one respect: NOT an adaptation of
  `auto_seed.mjs`/StoneHub as briefly considered mid-session — confirmed
  fresh build, since StoneHub is being archived (Chunk H) for the same
  reason as vault. `grazed_from` provenance is attached directly to staged
  seed objects (accumulating any prior chain, not overwriting), not just
  to the staging wrapper — fixed after initially missing that distinction.

### Chunk D — Review queue / surfacing
- **Job:** For each staged candidate from Chunk C, compute and display: source
  Jar provenance (identity, corpus size, last-updated), structural lint result
  (are WRONG/CORRECT/Symptom populated, valid stack/facet, sane `blast_radius`),
  conflict/duplicate flag (same scoring math from Chunk C run inward
  against the user's own corpus), and `grazed_from` lineage — the full
  upstream chain if a candidate has itself been grazed before.
- **Inputs:** Chunk C's staged-candidate output.
- **Outputs:** Review queue display/report (could be CLI output, markdown
  file, or simple web view — not yet decided, open question for whoever
  picks this up).
- **Dependencies:** Chunk C.
- **Status (2026-07-04): built and tested against real data, see full
  writeup in Section 0.** Open question resolved: both CLI summary and a
  markdown report (`.lodestone/graze-review-queue.md`), matching the
  project's own WIKI.md/MANIFEST.md convention. Duplicate detection reuses
  `captureFix()`'s exact Jaccard formula and 0.45 threshold rather than
  inventing a second similarity metric.

### Chunk E — MCP tool surface trim
- **Job:** Reduce existing 26 MCP tools down to the five that survive the new
  scope: `capture_seed` (Chunk 0), `publish`, `list_jars`, `graze`,
  `validate_schema`. Remove or
  deprecate the rest (weeds tools, wiki/harness tools, full-retrieval recall
  tools) — or move them into the frozen legacy-Lodestone repo if keeping that
  history matters.
- **Inputs:** Existing MCP server source.
- **Outputs:** Trimmed MCP server.
- **Dependencies:** Loosely depends on Chunks A–D existing in some form (the
  four surviving tools wrap their logic), but the *removal* of dead tools can
  happen independently/early.
- **Status (2026-07-04): built and tested, see full writeup in Section 0.**
  Two corrections to the original scope: (1) the surviving surface is NINE
  tools, not five — the original list had no demand side, contradicting
  decision 5's live-MCP consumption story; `get_seed`, `list_stacks`, and a
  BM25-lite `lookup_symptom` were added per direct confirmation. (2)
  `capture_fix` also survives, per Section 0's two-capture-paths ruling.
  Executed as a fresh slim server (`tools.mjs` + thin `index.mjs`) with the
  old monolith preserved untouched as `index.legacy.mjs` for Chunk H.

### Chunk F — Canonical schema spec doc + open contract
- **Job:** Write a clear, WIKI.md/HARNESS.md-rigor spec document for the
  canonical seed schema, explicitly aimed at third-party authors who want to
  write their own `export-to-<brain>.mjs` transform. Publish as part of the
  open-source repo.
- **Inputs:** Existing seed schema (unchanged by this redesign).
- **Outputs:** Schema spec doc.
- **Dependencies:** None — can happen in parallel with everything else.
- **Status (2026-07-04): built — root `SCHEMA.md`,** matching MANIFEST.md's
  house style (contract voice, field tables, decision references). Covers:
  mandatory core (verbatim from `structuralLint`), optional core, the
  enrichment tier documented from a full-corpus field census (all 2,156
  seeds scanned; `summary`/`example_triggers`/`antipattern_category`/
  `applies_when` are at 100% flagship coverage and spec'd as SHOULD-map,
  not enforced), volatility fields, relationship fields, normative lint
  summaries verified line-by-line against `lib/seed-schema.mjs` and
  `lib/privacy-lint.mjs`, versioning (N-1 + additive rules), and a
  13-clause MUST/SHOULD/MAY export-transform contract. Data-honesty
  section documents the corpus quirks (41 content-only seeds, 278 missing
  `source` — note: drifted from the schema code comment's 391, both
  numbers recorded — and lodestone.json's 7 non-seed tooling records)
  rather than normalizing them silently. MANIFEST.md now cross-links it.

### Chunk G — Reference export transform (GBrain)
- **Job:** One optional reference implementation: `export-to-gbrain.mjs`,
  converting canonical seeds into GBrain's native markdown-page/pack format.
  Explicitly not a commitment to maintain transforms for other brains.
- **Inputs:** Chunk F's schema spec. GBrain's pack/page format (external,
  subject to GBrain's own churn — budget for that).
- **Outputs:** One working transform script + example output.
- **Dependencies:** Chunk F.
- **Status (2026-07-04): built and contract-tested against GBrain's REAL
  parser.** The uncertainty budget paid off differently than expected: the
  wildcard wasn't churn guesswork, it was that GBrain's source is public —
  cloned garrytan/gbrain at v0.42.56.0 (2026-07-02 HEAD) and read
  `src/core/markdown.ts` + `src/core/import-file.ts` +
  `docs/GBRAIN_RECOMMENDED_SCHEMA.md` (schema-version 0.5.0) directly
  instead of trusting blog posts. Verified contract facts baked into the
  transform header: `<!-- timeline -->` is the preferred compiled-truth/
  timeline sentinel (two alternates recognized); frontmatter passes all
  keys through except type/title/tags/slug (honored structurally); THREE
  RESERVED gate keys (`quarantine`, `content_flag`, `embed_skip`, v0.42
  trust boundary #1699) that a transform must never emit — local import is
  TRUSTED input, so emitting them would actually take effect; kebab
  canonical slugs where the filename IS the identity; `[[wikilinks]]`
  become typed graph edges via the regex inference cascade.
  `scripts/export-to-gbrain.mjs` emits `type: concept` pages (GBrain's own
  disambiguation rule — teachable framework → concept — fits antipatterns;
  no custom type for inference to fight) into a `code-antipatterns/`
  directory WITH the README resolver GBrain's MECE rule requires, seed id
  reversibly slug-mapped (snake→kebab), enrichment tier + provenance
  timeline + see_also/relationships-as-wikilinks all mapped, privacy-
  blocking seeds excluded by default, deprecated seeds skipped, quirk
  normalization per SCHEMA.md (absent source→community, content-string
  fallback parse) recovering 69 → down from what would have been ~300+
  skipped seeds.
  **Verified:** all 2,088 exported pages pass GBrain's own
  `parseMarkdown(validate: true)` with ZERO validation errors, correct
  type/title/tags extraction, all custom frontmatter preserved, non-empty
  compiled truth and timeline on every page (test harness: gbrain's
  markdown.ts run via tsx with a verbatim slugifyPath stub). A planted
  hostile seed carrying all three timeline-sentinel spellings failed to
  inject into the evidence layer — sanitizer neutralizes sentinels,
  attacker text stays as inert prose in compiled truth, timeline contains
  only our provenance line. Export is byte-idempotent (same corpus →
  identical output, full-diff verified).
  **Trap for future sessions:** gbrain pins js-yaml ^3; v4 removed
  `safeLoad`. Testing gbrain code against js-yaml@4 makes its
  NESTED_QUOTES validator flag EVERYTHING (the disambiguation parse
  itself throws). Cost this session 20 minutes; recorded so it costs the
  next one zero.

### Chunk H — Legacy archive decision
- **Job:** Decide and execute: delete cut subsystems (weeds, wiki synthesis,
  harness generation, full retrieval pipeline) outright, or fork them into a
  frozen "legacy Lodestone" repo for posterity. Either way, stop maintaining
  them going forward.
- **Inputs:** Existing Lodestone codebase.
- **Outputs:** Either a deletion commit or a frozen fork, plus a note in the
  new repo's README pointing to wherever the old code lives (if kept).
- **Dependencies:** None — purely a housekeeping decision, can happen anytime.

### Chunk I — Static registry page
- **Job:** GH Pages page + Actions workflow: on schedule, run GitHub topic
  search for Public Jars, read each manifest, render a static registry
  listing every known Jar with corpus size, stacks covered, and last-updated.
  Include the "stack wants a maintainer" callout slots for the flagship
  corpus's 118 stacks. Doubles as the discovery layer and the attribution
  reward — being listed is the payoff for tagging public.
- **Inputs:** Chunk B's manifest spec (page reads manifests). Existing GH
  Pages site + Actions setup.
- **Outputs:** Registry page + scheduled rebuild workflow. $0 by
  construction: static output, Actions free tier, no server.
- **Dependencies:** Chunk B. Independent of C/D/E — can ship before grazing
  even works, and arguably should (discovery before distribution).
