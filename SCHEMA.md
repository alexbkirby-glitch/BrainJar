# SCHEMA.md — Canonical Seed Schema Spec + Export Transform Contract

Governs the **seed**: Brain Jar's atomic unit, a structured
WRONG→CORRECT→Symptom antipattern record. If you're a third party writing
an `export-to-<brain>.mjs` transform, a grazer, a linter, or anything else
that consumes seed JSON, this file is the contract. The enforcing code is
`lib/seed-schema.mjs` (structural) and `lib/privacy-lint.mjs` (privacy) —
where this prose and that code disagree, **the code wins**; file an issue.

Two companion contracts: `MANIFEST.md` (the Public Jar manifest a grazer
reads first) and, for GBrain specifically, the reference transform
`scripts/export-to-gbrain.mjs` (grill-session Chunk G) — a worked example
of everything below.

## What a seed is (and isn't)

A seed captures **one** falsifiable code-risk fact in three moves:

- **wrong** — the specific incorrect approach, concrete enough to grep for
- **correct** — the fix, detailed enough to apply without further research
- **symptom** — what a developer actually *observes* when the wrong version
  bites: the error text, the runtime behavior, the perf cliff

A seed is not a tutorial, not a style opinion, not documentation. The test:
could a stressed developer, mid-bug, match their situation to `symptom`
and act on `correct` in under a minute? If the record needs narrative,
it's a wiki page, not a seed. If it can't be wrong, it's not a seed.

Seeds live in `seeds/<stack>.json` — a flat JSON array, one file per
stack. `seeds/personal/` is never public and never counted (see
MANIFEST.md).

## Schema versioning

`schema_version` (currently **1**, declared in `lib/seed-schema.mjs`)
tracks breaking changes to the SHAPE defined here — field names, types,
required-ness. It is **not** a corpus/content version (the flagship's
"v48/v49" numbering is a different axis).

- **N-1 compatibility only** (grill-session decision 4). A consumer built
  against version N must accept N and N-1, and may reject anything older.
  One version's grace period, no permanent migration-shim tax.
- **Additive changes don't bump** (decision 15). A new optional, nullable
  field is not a breaking change. Consumers MUST ignore unknown fields
  rather than erroring on them — this is what keeps the additive rule
  cheap for everyone.
- **No brain-driven schema changes** (decision 5). The schema is
  brain-agnostic; shaping for any specific brain happens in export
  transforms, never here. No single brain gets to be a privileged citizen.

## Mandatory fields

Enforced by `structuralLint()`. A seed missing any of these fails lint and
must not be published.

| Field | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | string | lowercase snake_case (`a-z`, `0-9`, `_`); unique within its Jar | Stable identity. Cross-references (`see_also`, `relationships`) use it. |
| `stack` | string | matches the containing filename (`react` ↔ `seeds/react.json`) | Technology/domain shelf this seed sits on. |
| `blast_radius` | enum | `low` \| `medium` \| `high` \| `critical` | Damage if the antipattern ships. Drives injection weighting (Kelly criterion) in consumers that do weighting. |
| `source` | string | conventionally `community` \| `personal` \| a provenance label | Where the seed came from. Grazing appends provenance separately (`grazed_from`). |
| `wrong` | string | ≥ 20 chars (shorter fails lint as placeholder) | The incorrect approach. |
| `correct` | string | ≥ 20 chars | The fix. |
| `symptom` | string | ≥ 20 chars | The observable failure. |
| `tags` | array of strings | empty array lints as a warning, not an error | 3–6 retrieval terms a developer would actually type. Curated signal — scorers weight tags above free text. |

## Optional core fields

Nullable, additive; absence never blocks capture or publish. Type-checked
when present.

| Field | Type | Meaning |
|---|---|---|
| `domain` | string | Broad knowledge domain (`web`, `systems`, `mathematics`, …). Aggregated into the manifest's `domains`. |
| `facet` | string | Activity facet (`coding`, `debugging`, `architecture`, …). Aggregated into `facets`. |
| `confidence` | number 0–1 | Curator confidence. Out-of-range fails lint. |
| `doc_reference` | string URL or explicit `null` | Official docs supporting the fix. Nullable **by design**: `blankSeed()` nulls it, and hundreds of flagship seeds (314 at time of writing; the schema code's comment says 391 from an earlier corpus state) legitimately omit the key entirely. Consumers must tolerate absent, `null`, and string. |

## Enrichment fields (conventional, not enforced)

The flagship corpus carries a second tier of fields at 100% coverage that
`structuralLint()` does **not** require. They exist for RAG optimization
(self-contained chunks, query-shaped triggers) and transforms SHOULD map
them when present — they're usually the highest-value content for a brain.

| Field | Type | Flagship coverage | Meaning |
|---|---|---|---|
| `title` | string | 100% | Human-readable one-liner, ≤ ~8 words. |
| `content` | string | 100% | Legacy flattened `WRONG: … CORRECT: … Symptom: …` string. Redundant with the explicit fields — prefer those; treat `content` as a fallback for pre-explicit-field seeds. |
| `summary` | string | 100% | One-sentence restatement (title + symptom), written for embedding. |
| `example_triggers` | array of strings | 100% | Natural "stressed developer" phrasings that should retrieve this seed. |
| `antipattern_category` | string | 100% | Cross-cutting category (`performance`, `correctness`, `security`, …). |
| `applies_when` | object | 100% | `{ stack, facet, domain }` — the injection-filter predicate, denormalized for chunk self-containment. |
| `structural_pattern` | string | ~8% | Cross-corpus structural motif id (see `pattern-index.json`). |

## Volatility fields (framework-tied seeds only)

Most seeds don't go stale; framework-tied ones do (grill-session
principle: only volatile stacks warrant version monitoring).

| Field | Type | Meaning |
|---|---|---|
| `framework_version` | string or `null` | Version the seed was validated against. |
| `valid_through` | string `YYYY-MM-DD` | Review-by date. Past it, treat as suspect, not deleted. |
| `deprecated` | boolean | The antipattern no longer applies (framework fixed it). Deprecated seeds stay in the corpus as history; consumers SHOULD NOT inject them. |

## Relationship fields

| Field | Type | Meaning |
|---|---|---|
| `see_also` | array of seed-id strings | Undirected "related" links. Ids may point to seeds in *other stacks* within the same Jar. |
| `relationships` | object | Typed, weighted edges, e.g. `{ "temporal_sequence": [{ "id", "confidence", "source", "position" }] }`. Edge lists may be legacy bare-string ids or weighted objects — normalize both. |
| `grazed_from` | array | Provenance chain appended by grazing (`[{jar, seed_id, date}]`, newest last). Never author this by hand. |

## Bookkeeping fields

`verification_status` (`unverified` \| `community-reviewed` \| …),
`reviewed_at` / `captured_at` (ISO timestamps), `domain_tier` (integer,
flagship curation tier), `project` (capture-time cwd — **personal seeds
only**; the privacy lint treats machine paths in public seeds as findings).

## Structural lint (normative summary)

`structuralLint(seed)` returns `{ ok, errors, warnings }`:

- **Errors** (block publish): missing mandatory field; `id` not
  snake_case; `wrong`/`correct`/`symptom` under 20 chars; invalid
  `blast_radius`; `confidence` outside 0–1.
- **Warnings** (advisory): empty `tags` (seed will be nearly unfindable);
  `doc_reference` omitted rather than explicit `null` (tolerated — see
  above).

## Privacy lint (normative summary)

`privacyLint(seed)` scans the free-text fields where leakage actually
happens — `wrong`, `correct`, `symptom`, `doc_reference` (not `id`/
`stack`/`tags`, which are short structured tokens). Rule inventory:
internal hostnames, private IPs, email addresses, AWS-shaped keys, and
embedded bearer/API secrets (all `high` severity → blocking); user-named
filesystem paths and CamelCase product/company-name guesses (`medium` →
flagged, not blocking). Documented-convention exemptions (RFC 2606
example domains, `host.docker.internal`, k8s cluster-local DNS, trivial
`a@b.com` placeholders) were tuned against the real corpus — 11/11
original flags were false positives. Deliberately biased toward false
positives. Returns `{ ok, blocking, findings }`; any high-severity
finding sets `blocking`.

Enforcement points, in order:
1. `capture_seed` / `capture_fix` — advisory at capture (local is private
   by construction), hard-blocks only the community-upload action.
2. `publish` / `scripts/generate-manifest.mjs` — **hard gate**. Refuses to
   write a manifest over blocking findings (`--force` exists, loudly, for
   private-only builds).
3. Export transforms — MUST run it too. See contract below.

## The export transform contract

An export transform converts canonical seeds into one brain's native
ingestion format. Transforms live **at the boundary** — they read the
schema, they never change it, and they're maintained by whoever cares
about that brain (decision 6: open contract, not centrally maintained).
Brain Jar ships exactly one reference implementation
(`scripts/export-to-gbrain.mjs`); everything else is yours.

Naming convention: `export-to-<brain>.mjs`, runnable as
`node scripts/export-to-<brain>.mjs [--stack=X] [--out=DIR]`.

A conforming transform:

**MUST**
1. Read seeds from `seeds/*.json` (excluding `seeds/personal/`) or accept
   an explicit input path — never scrape a brain, a wiki, or anything
   that isn't seed JSON.
2. Check `schema_version` compatibility (N-1 rule) when consuming a
   foreign Jar via its manifest, and say so when it rejects.
3. Ignore unknown fields without erroring (the additive rule's other half).
4. Run `privacyLint` per seed and **exclude blocking seeds by default**
   from any output that could leave the machine. An explicit
   force/override flag is acceptable; silent inclusion is not.
5. Sanitize seed text against the target format's control sequences
   (frontmatter delimiters, sentinel comments, reserved metadata keys).
   Seeds can arrive via grazing from strangers — treat every string as
   hostile input to the target format.
6. Preserve `id` (verbatim or via a documented, reversible slug mapping)
   so a re-export updates pages instead of duplicating them, and so
   provenance survives round trips.

**SHOULD**
7. Map the enrichment tier (`summary`, `example_triggers`,
   `applies_when`, `antipattern_category`) — it's the best material for a
   brain's retrieval.
8. Carry provenance into the target (jar name, seed id, `source`,
   `verification_status`, export date) in whatever the brain's native
   provenance slot is.
9. Translate `see_also`/`relationships` into the brain's native link
   format so graph layers can wire them.
10. Skip `deprecated: true` seeds by default.
11. Be idempotent: same corpus in, byte-identical output out.

**MAY**
12. Drop fields with no sensible mapping (`domain_tier`, internal
    bookkeeping). Dropping is honest; inventing values is not.
13. Restructure freely — one page per seed, one pack per stack, a single
    database file: the brain's shape is the transform's business.

## Known flagship-corpus quirks (data honesty)

Documented rather than silently normalized, per house rules:

- 41 of 2,156 seeds lack explicit `wrong`/`correct` (pre-explicit-field
  captures; `content` carries the text). Parse `content` as fallback.
- 278 seeds lack `source`. Treat absent as `community` for the flagship.
- `seeds/lodestone.json` contains 7 records (`workflow_*`, `tool_*`,
  `skilltemplate_*`) that are tooling documentation wearing a seed file's
  clothes — they carry `type`/`description`/`steps` fields and don't
  conform. They're legacy-Lodestone material (Chunk H's problem);
  transforms SHOULD skip records that fail `structuralLint`.

## Worked example

A minimal conforming seed:

```json
{
  "id": "react_stale_closure",
  "stack": "react",
  "blast_radius": "medium",
  "source": "community",
  "wrong": "Reading state inside a useEffect callback whose dependency array omits that state",
  "correct": "Add the state to the dependency array, or use the functional setState form to read current state",
  "symptom": "Effect logs or acts on an old state value; UI updates lag one render behind",
  "tags": ["useEffect", "stale closure", "dependency array"],
  "doc_reference": "https://react.dev/reference/react/useEffect"
}
```

Everything else in this spec is optional enrichment on top of that shape.
