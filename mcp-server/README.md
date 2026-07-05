# brain-jar-mcp

MCP server for [Brain Jar](https://alexbkirby-glitch.github.io/lodestone) — a decentralized antipattern seed library that feeds second brains. **Library, not brain**: capture, validate, publish, discover, graze, plus a lightweight read surface so any MCP-compatible brain can pull seeds live.

> The previous 44-tool Lodestone-era server was archived to the `lodestone-legacy` bundle in the Chunk H trim (see MAINTENANCE.md, Tier 4). It is not maintained.

## Tools (9)

### Supply side
| Tool | What it does |
|---|---|
| `capture_seed` | Author a full-schema WRONG→CORRECT→Symptom seed from live session context. Structural lint is a hard gate; privacy lint advisory here, hard gate at publish. Stages to `seeds/personal/captured.json`. |
| `capture_fix` | The in-session bug-fix reflex → `.lodestone/personal-patterns.json`, enriched later by `migrate-seed-schema.mjs`. Duplicate detection + quality scoring; community-upload path is privacy-gated. |
| `validate_schema` | Lint seed object(s) against the canonical schema (structural + privacy), or validate this Jar's `brain-jar-manifest.json`. |
| `publish` | Generate/refresh the manifest. Privacy lint hard-blocks by default. Returns the tag-this-repo instructions — tagging **is** the consent act. |
| `list_jars` | Discover Public Jars via GitHub topic search; read each manifest (name, seed count, stacks, schema compatibility). |
| `graze` | Trigger the offline batch grazer + human review queue. Shallow scoring only, never auto-merges. |

### Demand side (what a consuming brain calls)
| Tool | What it does |
|---|---|
| `get_seed` | All seeds for a stack — text (directly injectable) or json. |
| `list_stacks` | Enumerate local stacks, including `_personal`. |
| `lookup_symptom` | BM25-lite symptom search (token idf + tag overlap). Deliberately shallow — no embedding/SPLADE/RAPTOR stack is loaded; a brain's own retrieval is the deep path for imported seeds. |

`capture_seed` and `capture_fix` are different jobs, not duplicates: `capture_seed` authors a publish-ready canonical seed directly; `capture_fix` is the thirty-second reflex whose output gets enriched later.

## Setup

Published to npm as `brain-jar` (bin: `brain-jar-mcp`). The server serves
a **Jar** — a directory with `seeds/` — resolved in this order:
`BRAIN_JAR_ROOT` env → `--jar=/path` argument → the package's own parent
if it contains `seeds/` (repo-checkout mode) → current directory
(created lazily on first capture).

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

Config file locations:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/claude/claude_desktop_config.json`

Restart Claude Desktop after editing. Same block works for Cursor /
Windsurf / Continue. From a repo checkout, `node mcp-server/index.mjs`
works too (install deps once at the repo ROOT: `npm install`).

## Environment

- `GITHUB_TOKEN` — raises the unauthenticated 60 req/hr GitHub API limit for `list_jars`/`graze`. Everything degrades gracefully without one.

## Packaging

One package, published from the repo root as `brain-jar` with a lean
`files` whitelist (lib/ + this server + the three scripts the publish and
graze tools spawn). ~44 KB installed. The flagship corpus is NOT in the
package — `npx brain-jar-mcp` serves *your* Jar; clone the repo if you
want the flagship seeds.
