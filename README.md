# Brain Jar

A decentralized antipattern seed library that feeds second brains.

A **seed** is a WRONG→CORRECT→Symptom record: one falsifiable code-risk
fact, structured so an AI coding session (or a stressed human) can match
the symptom and apply the fix in under a minute. A **Jar** is a repo of
seeds. Tag your Jar with the `brain-jar` GitHub topic and it becomes a
**Public Jar** — discoverable in the [registry](https://alexbkirby-glitch.github.io/lodestone/registry.html),
grazeable by anyone.

**Library, not brain:** Brain Jar curates and shares seeds. Retrieval,
memory, and injection strategy belong to whatever brain you already use —
consume seeds live over MCP or via an export transform
([GBrain](scripts/export-to-gbrain.mjs), [Claude Projects](scripts/export-to-claude-projects.mjs),
or [write your own](SCHEMA.md)).

**Try it without installing:** [paste an error into the browser demo](https://alexbkirby-glitch.github.io/lodestone/demo.html) —
same lookup the MCP server runs, client-side.

## Quick start

```bash
npx brain-jar-mcp            # serves the Jar in your current directory
npx brain-jar-mcp --jar=/path/to/your/jar
```

Or in your AI tool's MCP config (Claude Desktop / Cursor / Windsurf / Continue):

```json
{
  "mcpServers": {
    "brain-jar": {
      "command": "npx",
      "args": ["-y", "brain-jar-mcp", "--jar", "/absolute/path/to/your/jar"]
    }
  }
}
```

Nine tools: `capture_seed`, `capture_fix`, `validate_schema`, `publish`,
`list_jars`, `graze`, `get_seed`, `list_stacks`, `lookup_symptom`.
Details: [mcp-server/README.md](mcp-server/README.md).

A Jar needs nothing to start — `seeds/` is created on first capture. This
repo is the flagship Jar: 2,000+ seeds across 118 stacks; clone it if you
want the corpus rather than an empty shelf.

## The loop

1. **Capture** — fix a bug once, `capture_fix` saves the pattern (privacy-
   linted before anything can leave your machine).
2. **Publish** — `npm run publish` generates a privacy-gated
   `brain-jar-manifest.json`; add the `brain-jar` topic to your repo.
   Tagging IS the consent act — it lists you in the registry and opens
   your Jar to grazing.
3. **Graze** — `npm run graze` discovers other Public Jars, shallow-scores
   their seeds against your stacks, and stages candidates behind a human
   review queue. Nothing ever auto-merges.
4. **Feed your brain** — export transforms turn seeds into your brain's
   native format; or let the brain call the MCP read tools directly.

## Contracts

- [SCHEMA.md](SCHEMA.md) — the canonical seed schema + the open
  export-transform contract (MUST/SHOULD/MAY)
- [MANIFEST.md](MANIFEST.md) — the Public Jar manifest grazing reads first
- [MAINTENANCE.md](MAINTENANCE.md) — what's maintained, what's frozen,
  what's research. **Read this before filing an issue.**

## Repo layout

```
lib/           schema, privacy lint, manifest, discovery, capture (maintained)
mcp-server/    the nine-tool MCP server (maintained)
scripts/       graze, publish, exports, enrichment (maintained) +
               retrieval-index builders (unmaintained — see MAINTENANCE.md)
research/      deferred mathematical tracks (see ROADMAP.md)
seeds/         the flagship corpus, one JSON file per stack
```

MIT. History: this project was previously "Lodestone" (and before that
"Distill"); the cut subsystems live in the archived `lodestone-legacy`
bundle.
