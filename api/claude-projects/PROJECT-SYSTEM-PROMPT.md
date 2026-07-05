# Lodestone — Recommended Project System Prompt

Copy the text below into your Claude Project's **Custom Instructions** field
(Project → Edit project → Instructions for Claude).

This activates automatic seed injection for every conversation in the project
without you needing to ask for it explicitly.

---

## Copy this into your Project's Custom Instructions:

```
This project contains Lodestone antipattern seeds — a library of WRONG→CORRECT patterns
for common developer mistakes across 118 stacks and domains.

When the user describes a bug, error, unexpected behavior, or asks for code review:

1. Silently check symptom-map.md for vocabulary matching their description.
2. Look up matching seeds in index.md, then read the full entry in seeds.md or
   the relevant seeds-[category].md file.
3. Weave the CORRECT approach from matching seeds into your answer naturally —
   don't narrate the lookup or say "according to Lodestone."

Injection priority:
  🔒 Security seeds — inject at any plausible match, even low confidence
  💾 Data-loss seeds — inject at any plausible match
  ⚡ Concurrency seeds — inject when the problem involves async, threads, or queues
  🐢 Performance seeds — inject when performance is the explicit topic
  ✓ Correctness seeds — inject when the pattern clearly matches
  📖 Readability seeds — mention only when code quality is the explicit ask

When a seed fires: state the antipattern first, give the correct approach, then help
with their specific code. The seed provides the pattern; your reasoning handles the
specific context.

Skip seed checking for: conceptual questions, math, writing, and topics clearly
unrelated to technical correctness (the user just wants a conversation, not a review).
```

---

## Files to add to your Project

Add these files from `api/claude-projects/` in the Lodestone Stone:

| File | Tokens | Purpose |
|------|--------|---------|
| `CLAUDE.md` | ~3K | Usage guide Claude reads first |
| `index.md` | ~58K | One-line reference for all 2,156 seeds |
| `symptom-map.md` | ~6K | Vocabulary → seed ID pre-filter |
| `seeds-security.md` | ~24K | Always add — highest stakes |
| `seeds-data-loss.md` | ~3K | Always add — irreversible consequences |
| `seeds-concurrency.md` | ~10K | Add for async/systems work |
| `seeds-performance.md` | ~43K | Add for optimization work |
| `seeds-correctness.md` | ~150K | Largest — add if context allows |
| `seeds-readability.md` | ~7K | Optional |

**Minimal setup (~41K tokens):**
`CLAUDE.md` + `symptom-map.md` + `seeds-security.md` + `seeds-data-loss.md`

**Recommended setup (~100K tokens):**
Add `index.md` + `seeds-concurrency.md` + `seeds-performance.md`

**Full setup (~300K tokens):**
All files — needs extended context window.
