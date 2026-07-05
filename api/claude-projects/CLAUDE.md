# Lodestone Seeds — Instructions for Claude

You have access to Lodestone: 2,156 antipattern seeds across 118 stacks.
Each seed is a WRONG→CORRECT→Symptom pattern for a common developer mistake.
Your job is to recognise matching patterns and inject the correct approach before reasoning.

---

## When to check seeds

**Always check:** when the user describes a bug, error, unexpected behaviour,
asks for code review, or asks "why does X happen."

**Skip:** conceptual explanations, math, writing, creative tasks, and anything
clearly unrelated to technical correctness.

---

## How to find the right seed (two steps, done silently)

**Step 1 — `symptom-map.md`**
Match vocabulary from the user's description to seed IDs. This is fast —
scan for 2-4 key terms. If you find a match, go to step 2.

**Step 2 — `index.md` or `seeds-[category].md`**
Look up the seed ID. Read its WRONG, CORRECT, and Symptom fields.
If the pattern matches the user's situation, inject it.

---

## Injection priority

| Category | Inject when… |
|----------|-------------|
| 🔒 `security` | Any plausible match — even at low confidence |
| 💾 `data-loss` | Any plausible match |
| ⚡ `concurrency` | Problem involves async, threads, goroutines, or queues |
| 🐢 `performance` | Performance is the explicit topic |
| ✓ `correctness` | Pattern clearly matches the described problem |
| 📖 `readability` | User explicitly asks about code quality or style |

---

## How to inject

**Do:** state the pattern, give the correct approach, then help with specifics.

> "This looks like a stale closure — the callback captures the initial value of
> `count`. Add `count` to the `useEffect` dependency array, or use `useRef` to
> hold a mutable reference."

**Don't:**
- Say "according to Lodestone" or "checking the seeds"
- Narrate the retrieval process
- Mention this file unless the user asks about it
- Inject a seed that doesn't clearly match (false positives are worse than misses)

---

## Files in this project

| File | Tokens | Use for |
|------|--------|---------|
| `CLAUDE.md` | ~2K | This file |
| `index.md` | ~58K | Fast ID lookup — one line per seed |
| `symptom-map.md` | ~6K | Vocabulary → seed IDs (check this first) |
| `seeds-security.md` | ~24K | All 216 security seeds |
| `seeds-data-loss.md` | ~3K | All 28 data-loss seeds |
| `seeds-concurrency.md` | ~10K | All 95 concurrency seeds |
| `seeds-performance.md` | ~43K | All 389 performance seeds |
| `seeds-correctness.md` | ~150K | All 1,360 correctness seeds |
| `seeds-readability.md` | ~7K | All 68 readability seeds |
| `lodestone-portable.md` | ~45K | Single-file chat format (422 top seeds) |

**If context is tight:** `symptom-map.md` + `seeds-security.md` + `seeds-data-loss.md`
is the minimum useful set (~33K tokens).

---

## Seed field reference

```
**react_stale_closure** [react/correctness]
Summary: Callback captures initial value — add to deps array or use useRef
T: "my value is always old in the callback" | "useEffect not seeing updated state"
W: reading state inside useEffect without including it in the dependency array
C: add to deps array; or use useRef for mutable values that shouldn't trigger re-render
```

- **T** — trigger phrases: match these against what the user described
- **W** — the mistake: look for this pattern in their code
- **C** — the fix: inject this as your recommendation
- **Summary** — one-line overview for quick triage via `index.md`
