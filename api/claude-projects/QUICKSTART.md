# Lodestone — Quick Start

Lodestone injects antipattern seeds into AI sessions so the model recognises
common mistakes before advising you. The seeds fire automatically — you just
code and ask questions normally.

---

## Option A — Claude Project (recommended, persists across all sessions)

**1. Add files to your Project** *(Project → Add content)*

Minimum useful set:
- `CLAUDE.md`
- `symptom-map.md`
- `seeds-security.md`
- `seeds-data-loss.md`

Add more category files as context budget allows (see `PROJECT-SYSTEM-PROMPT.md`).

**2. Paste the system prompt** *(Project → Edit project → Instructions for Claude)*

Copy the prompt from `PROJECT-SYSTEM-PROMPT.md`. Done — seeds fire automatically
in every conversation in this project.

---

## Option B — Single chat upload (one-off sessions)

Upload `lodestone-portable.md` to any Claude chat.

That's it. No configuration. Ask your question. The file contains its own
instructions for Claude and 422 of the highest-priority seeds.

---

## You don't need to do anything special per-question.

Just describe your problem normally:
> "Why is my useEffect firing twice?"
> "My Stripe webhook is charging customers twice."
> "This query is taking 30 seconds."

Lodestone activates on the vocabulary. You'll see the antipattern identified
and the correct approach integrated into the answer.

---

## If the MCP server is running

The full retrieval pipeline (BM25 + embeddings + reranking) handles everything
automatically. No files to upload. See `lodestone-nano.md` for setup.
