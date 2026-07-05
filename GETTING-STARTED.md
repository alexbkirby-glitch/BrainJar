# Getting Started

Three on-ramps, shallowest first.

## 1 — Try it in the browser (zero install)

[demo.html](https://alexbkirby-glitch.github.io/lodestone/demo.html):
paste an error message, get the top matching seeds. Same scoring math as
the MCP server's `lookup_symptom`; nothing you paste leaves the page.

## 2 — Serve your own Jar (one command)

```bash
mkdir my-jar && cd my-jar
npx brain-jar-mcp
```

Silence is success — MCP talks stdio; the only output is one stderr line
naming the Jar root. Wire it into your AI tool:

```json
{
  "mcpServers": {
    "brain-jar": {
      "command": "npx",
      "args": ["-y", "brain-jar-mcp", "--jar", "/absolute/path/to/my-jar"]
    }
  }
}
```

Restart the tool, then try: *"look up: useEffect shows a stale value"*
(→ `lookup_symptom`) or, after fixing any bug, *"capture that fix"*
(→ `capture_fix`). Your first capture creates `seeds/personal/` and
`.lodestone/` in the Jar. Both stay local; the privacy lint gates
anything that could leave your machine.

## 3 — Clone the flagship corpus

```bash
git clone https://github.com/alexbkirby-glitch/lodestone
cd lodestone && npm install
```

Point the same MCP config at it (`--jar` = the checkout, or just run from
inside it) and `lookup_symptom` searches 2,000+ seeds across 118 stacks.

Useful npm entry points:

```bash
npm run publish:check      # privacy + structural lint over all seeds
npm run publish            # write brain-jar-manifest.json
npm run graze              # discover Public Jars, stage candidates
npm run graze:review       # build the human review queue
npm run export:gbrain      # seeds → GBrain markdown pages
npm run export:claude-projects   # seeds → Claude Projects files
npm run registry           # rebuild registry.html/.json
```

## Going public

1. `npm run publish` — refuses to write a manifest over privacy
   violations, by design.
2. Push, then add the **`brain-jar`** topic to your GitHub repo.
3. The next scheduled registry build lists you. Being listed is the
   attribution reward; being tagged is the consent to be grazed.

## Where things are specified

Seed shape and lint rules: [SCHEMA.md](SCHEMA.md). Manifest:
[MANIFEST.md](MANIFEST.md). What's maintained vs frozen vs research:
[MAINTENANCE.md](MAINTENANCE.md). Tool-by-tool server docs:
[mcp-server/README.md](mcp-server/README.md).
