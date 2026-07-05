# MANIFEST.md — Public Jar Manifest Spec

Governs `brain-jar-manifest.json`, the file every Public Jar declares at its
repo root (grill-session decision 3). The seeds the manifest counts are
governed by the companion contract `SCHEMA.md`. If you're a third party writing a
grazer, a graze-target validator, or a registry indexer against Brain Jar
Public Jars, this file is the contract. If you're publishing a Jar, run
`node scripts/generate-manifest.mjs` — don't hand-write this file.

## File location and name

`brain-jar-manifest.json`, at the repo root of any Public Jar. Not a
dotfile — deliberately visible, so it doubles as a human-readable "this is
a Jar" signal when someone lands on the repo (see decision 13: attribution
is the only currency at $0, spend it visibly). Project-prefixed rather
than a bare `manifest.json` to avoid collision with PWA web app manifests,
browser extension manifests, and other tooling that also wants that
filename at a repo root.

Tagging a repo public on GitHub *is* the consent act (decision 8) — the
presence of this file is what makes that repo grazeable, not a separate
opt-in flag.

## Required fields

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | integer | The canonical seed schema's shape version (see below). NOT a corpus/content version. |
| `jar_name` | string | Human-readable label for this Jar. Defaults to the repo directory name if not overridden. |
| `seed_count` | integer, ≥0 | Total seeds counted across all public seed files (`seeds/personal/` always excluded — see below). |
| `stacks` | array of strings | Every distinct `stack` value present in the counted seeds, sorted. |
| `last_updated` | string, `YYYY-MM-DD` | Date the manifest was last generated. |

## Optional fields

| Field | Type | Meaning |
|---|---|---|
| `domains` | array of strings | Aggregate of every seed's optional `domain` field, deduped and sorted. Omitted entirely if no seed declares one — never present as an empty array. |
| `facets` | array of strings | Same treatment, for the optional `facet` field. |

Both follow the additive-fields convention from decision 15: a field is
either present and meaningful, or absent. Never present-but-null in the
manifest itself.

## `schema_version` and N-1 compatibility

`schema_version` tracks breaking changes to the **seed shape** defined in
`lib/seed-schema.mjs` — field names, types, required-ness. It is a plain
integer, incremented by exactly 1 whenever such a change would break a
grazer or export-transform written against the previous shape. Additive
changes (a new optional nullable field) do **not** bump it.

Per decision 4: a grazer built against schema version `N` must accept
manifests declaring `N` or `N - 1`, and should refuse anything older —
one version's grace period, not a permanent migration-shim tax.

```js
import { isSchemaVersionCompatible } from './lib/seed-schema.mjs';

isSchemaVersionCompatible(manifest.schema_version); // true/false, against current
```

Do not confuse `schema_version` with a Jar's own content/corpus versioning
(e.g. the flagship corpus's informal "v48" label in `build-wiki.mjs`). That
axis is about *what changed in the seeds*; `schema_version` is about
*what shape a seed is allowed to have*. A Jar can bump its content ten
times a day without ever touching `schema_version`.

## What counts toward `seed_count` / `stacks` / `domains` / `facets`

Every `.json` file under `seeds/`, recursively, **except** anything under
`seeds/personal/` — that directory is the non-anonymizable capture staging
area (see Chunk 0 / `lib/capture-seed.mjs`) and must never contribute to a
manifest's public-facing stats, independent of whether its contents would
otherwise pass lint.

## The two lint gates `generate-manifest.mjs` runs before writing

1. **Structural lint** (`structuralLint` per seed) — reported, does **not**
   block. A seed missing a mandatory field or with a placeholder-length
   `wrong`/`correct`/`symptom` still gets counted, with a warning printed.
   Full corpus-quality gating is `lint-seeds.mjs`'s job (pre-existing
   tooling, not part of this chunk); the manifest generator's job is
   publishing accurate stats, not re-litigating seed quality.
2. **Privacy lint** (`privacyLint` per seed, high-severity findings only)
   — **hard-blocks** by default. This is the last checkpoint before a
   Jar's stats go public, and it catches seeds that bypassed
   `capture_seed`'s advisory check entirely (e.g. hand-edited straight
   into `seeds/<stack>.json`). Override with `--force` if you understand
   the consequences — a Public Jar generated this way will leak whatever
   the lint flagged the moment anyone grazes it.

## Example

```json
{
  "schema_version": 1,
  "jar_name": "alex-brain-jar",
  "seed_count": 2156,
  "stacks": ["react", "python", "web-security", "mathematics", "..."],
  "last_updated": "2026-07-04",
  "domains": ["frontend", "backend", "math"],
  "facets": ["performance", "security", "correctness"]
}
```

## Generating and validating

```bash
node scripts/generate-manifest.mjs                    # scan seeds/, write brain-jar-manifest.json
node scripts/generate-manifest.mjs --check             # validate only, exit 1 on any lint/structure problem, never writes
node scripts/generate-manifest.mjs --jar-name=my-jar   # override jar_name (default: repo dir name)
node scripts/generate-manifest.mjs --force             # write despite privacy violations (loud warning — think twice)
```

Grazers and registry indexers (Chunks C and I) should call
`validateManifest()` from `lib/manifest.mjs` on any fetched manifest before
trusting it — a malformed or missing-field manifest should be treated the
same as an incompatible `schema_version`: skip that Jar, don't crash.

---
Source of truth for `schema_version`: `lib/seed-schema.mjs`.
Source of truth for the two lint gates: `lib/seed-schema.mjs` (structural),
`lib/privacy-lint.mjs` (privacy).
