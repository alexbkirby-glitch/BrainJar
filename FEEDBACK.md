# Feedback — Lodestone Test Stone

Thanks for testing. Here's what's most useful to share back.

---

## What to report

**Bugs** — something doesn't work as described:
- Which tool you're using (Claude Desktop, Cursor, Windsurf, Continue)
- What you did, what you expected, what happened instead
- The output of `node mcp-server/index.mjs --explain` from your terminal

**Seed quality** — a seed fired when it shouldn't, or didn't fire when it should:
- Which seed ID (visible in the injection output or `lookup_symptom` results)
- What context it fired in
- Whether the CORRECT section was helpful or misleading

**Missing seeds** — you hit a pattern repeatedly that Lodestone didn't catch:
- What the error or antipattern was
- Which stack/language it's in
- Whether you'd want to capture it yourself with `capture_fix`

---

## What to share back (optional)

If you've run several sessions and recorded outcomes, you can export your personal
seeds and the vault bundle — these help identify what patterns are genuinely recurring
vs ones that are stone-specific.

```bash
vault_export   # creates .lodestone/vault-bundle-YYYY-MM-DD.json
```

Share the vault bundle file. It contains only your personal captures, not
your session outcome data.

**Do NOT share:**
- `.lodestone/seed-confidence.json` — this is your personal session history
- `.lodestone/personal-patterns.json` — included in the vault bundle already
- `.lodestone/config.json` if you set `github_token`

---

## How to report

Open a GitHub issue at:
**https://github.com/alexbkirby-glitch/lodestone/issues**

Or reach out directly — the repo README has contact info.

---

## Version you're testing

```bash
node mcp-server/index.mjs --explain 2>&1 | grep -E "Seeds|Version|Stone"
```

Include this output in any bug report.
