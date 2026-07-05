# Lodestone Dynamic Testing Guide — v40

This guide covers hands-on testing of every capability in the v40 system.
Run tests in order; each section builds on the previous.

---

## Prerequisites

```bash
npm install
npm run build:index          # builds symptom-index.json and relationship-graph.json
npm run build:synonyms       # builds term-synonyms.json
npm run build:raptor         # builds api/raptor-index.json (324 clusters)
npm run build:communities    # builds api/graph-communities.json (74 communities)
```

Optional (improves retrieval quality, requires model download ~22MB):
```bash
npm run build:embeddings     # builds api/seed-embeddings.json for dense retrieval
```

Configure Claude Desktop or your MCP client to point at `mcp-server/index.mjs`.

---

## 1. Core Retrieval

### 1.1 Basic BM25 lookup
```
lookup_symptom("my value is always old inside the callback")
```
Expected: `react_stale_closure` or similar in matches. `retrieval: "bm25"` if embeddings not built, `"hybrid"` if they are.

### 1.2 Stack filter
```
lookup_symptom("goroutine never exits", stack_hint="go")
```
Expected: only Go-stack seeds returned. `stack` field = `"go"` on all matches.

### 1.3 Context pressure scaling
```
lookup_symptom("data leakage in sklearn pipeline", context_pct=80)
```
At 80% context used, `session_fit` should be higher for low-volatility (deep) seeds.
Compare `volatility` values against `session_fit` to verify the distillation alignment.

### 1.4 Certainty signal
Confirm `certainty` = harmonic mean of `relevance_score` × `confidence`:
- A new seed (`phase_state: "new"`) with high retrieval score should have lower `certainty` than a veteran seed at the same `relevance_score`.
- Formula: `2 × R × C / (R + C)` — verify manually on two seeds.

---

## 2. Query Expansion (Phases 4a / 4b / 4c)

### 2.1 Synonym expansion
```
lookup_symptom("goroutine leaks")
```
Verify `queryTokens` in logs includes synonyms (e.g. "goroutine" → "goroutine,coroutine" or related terms from `api/term-synonyms.json`).

### 2.2 Graph expansion
```
lookup_symptom("select not receiving in go channel")
```
Seeds linked via `implies` or `see_also` to the top match should appear in results even when not directly matching query tokens.

### 2.3 HyDE (requires ANTHROPIC_API_KEY + config)
Set `retrieval.query_expansion.hyde_enabled: true` in `.lodestone/config.json`.
```
lookup_symptom("my component rerenders on every parent update")
```
Enable debug logging to confirm a hypothetical document was embedded. `retrieval: "hybrid"` required.

---

## 3. Multi-Query Ensemble (Gap 2)

### 3.1 Mechanical alternatives
```
lookup_symptom("thing keeps firing twice in strict mode")
```
Check `_debug.multi_query_source` on any seed — value `"tag_expansion"` or `"symptom_boost"` indicates it arrived via an alternative query.

### 3.2 Confirm ensemble adds unique seeds
Run the same query with and without breakpoints. The ensemble should surface seeds with lower individual BM25 scores that were pulled in by tag vocabulary from the top results.

---

## 4. Negative Cache (Gap C / Loop #9)

### 4.1 Build the cache
After at least one session with contradicted seeds:
```bash
npm run build:negative-cache
```
Verify `api/negative-cache.json` contains entries with `contradicted_ids` and `query_embedding`.

### 4.2 Verify local suppression
Run `lookup_symptom` with the same query used in a session where a seed was contradicted.
The seed should appear with `_debug.negative_penalty: 1` and a halved `rrf_score`.
A different query (low embedding similarity) should NOT trigger the penalty.

### 4.3 Cross-topic isolation
Contradict a React seed on a React query. Then run the same query against a Go problem.
The Go query (orthogonal embedding) should not suppress the React seed.

---

## 5. ColBERT Reranking (Gap B)

Enable in `.lodestone/config.json`:
```json
{ "retrieval": { "colbert": { "enabled": true } } }
```

### 5.1 Partial match improvement
```
lookup_symptom("fires twice in development StrictMode effects")
```
Seeds matching "double invocation" or "double mount" should rank higher with ColBERT than without (compare `_debug.colbert_score` vs `rrf_score` ordering).

### 5.2 Latency budget
With ColBERT enabled: total retrieval should stay under ~250ms.
`_debug` should include `colbert_score` on the top-K seeds.

### 5.3 Graceful disable
Remove the config key — ColBERT block is skipped silently, pipeline proceeds from RRF directly to cross-encoder.

---

## 6. FLARE Iterative Retrieval (Gap 3)

### 6.1 Trigger FLARE
Use a very unusual or misspelled symptom description that produces < 2 candidates above the 0.30 RRF threshold:
```
lookup_symptom("xyzzy quantum frob does wrong thing")
```
Check that `_debug.flare_supplement: true` appears on any supplemental seeds in the result.

### 6.2 Adequate retrieval (FLARE should NOT fire)
```
lookup_symptom("react useEffect dependency array missing")
```
With embeddings built, the top seeds should score > 0.30. FLARE should not fire — no `flare_supplement` in `_debug`.

---

## 7. RAPTOR Hierarchical Retrieval (Gap 4)

### 7.1 Cluster context appears in response
```
lookup_symptom("cap rate vs leveraged return confusion")
```
Response should include `_raptor_context` with 1–2 cluster summaries containing `real-estate` themed content.

### 7.2 Cluster boost visible in _debug
Seeds from the matching cluster should show `_debug.raptor_boost > 0`. The boost is `0.15 × cluster_similarity`, capped at 1.0.

### 7.3 Upgrade to embedding-based clustering
```bash
npm run build:raptor:embed   # requires api/seed-embeddings.json
```
Re-run the test above. Clusters should be tighter (fewer, semantically coherent groups).

---

## 8. LLM-as-Judge (Gap 5)

Requires `ANTHROPIC_API_KEY` in env. Enable in config:
```json
{ "retrieval": { "llm_judge": { "enabled": true } } }
```

### 8.1 Judge scores appear in _debug
```
lookup_symptom("data leakage from fitting scaler on full dataset")
```
Top-10 seeds should show `_debug.llm_judge_score` in [0,1]. The seed that best matches the query should score highest.

### 8.2 Judge reorders cross-encoder
Compare rank order with judge disabled vs enabled on an ambiguous query. The judge should sometimes promote a seed that the cross-encoder underranked.

### 8.3 Graceful disable
Remove `ANTHROPIC_API_KEY` from env. System reverts to cross-encoder ordering. No error thrown.

---

## 9. GraphRAG Communities (Gap 6)

### 9.1 seed_overview — corpus-wide query
```
seed_overview(topic="machine learning evaluation pitfalls")
```
Expected: 2–3 community summaries with representative seeds from the `machine-learning` stack (data leakage, overfitting, improper cross-validation).

### 9.2 Community context in lookup_symptom
```
lookup_symptom("temperature parameter not affecting model outputs")
```
Response should include `_community_context` with a summary of the language-models community.

### 9.3 LLM-enhanced summaries (optional)
```bash
npm run build:communities:llm   # requires ANTHROPIC_API_KEY
```
Community summaries become natural-language descriptions rather than mechanical lists.

---

## 10. Phase 7 — External Datasources

### 10.1 Markdown directory
```
datasource_register(id="my-docs", name="My Docs", type="markdown-dir", path="/path/to/docs")
datasource_index(source_id="my-docs")
```
Verify `api/datasource-index/my-docs.json` exists and contains chunks with `embedding_text` (contextual prefix).

```
lookup_symptom("any query matching your docs content")
```
Response should include `external_results` with chunks from `my-docs`, each with `certainty`, `session_fit`, and `novelty` scores.

### 10.2 Contextual chunking (Gap 1)
Open `api/datasource-index/my-docs.json`. Each chunk should have:
- `text`: clean chunk content
- `embedding_text`: `DocumentTitle › Heading\n\nchunk content` (contextual prefix)

The `text` is what gets injected; `embedding_text` is what was embedded for retrieval.

### 10.3 RAG endpoint connection
```
rag_connect(url="https://your-rag.example.com/query", name="External KB")
```
Run a `lookup_symptom` — results from the external RAG appear in `external_results` with source_confidence tracking.

### 10.4 Source confidence accumulates
After several sessions, run `record_outcome` consistently. Check `.lodestone/source-confidence.json` — the source entry should update. Run `datasource_list` to see the confidence percentage.

### 10.5 URL safety (security test)
```
rag_connect(url="http://127.0.0.1:8080/rag", name="Local")
```
Expected: error "RAG endpoint URL points to a private/loopback address". System refuses to register.

```
datasource_register(id="../../../etc", name="Escape", type="markdown-dir", path="/tmp")
```
Expected: error "Datasource ID contains unsafe characters".

### 10.6 vault_export path confinement (security test)
```
vault_export(output_path="/etc/cron.d/malicious")
```
Expected: error "output_path must be inside the .lodestone/ directory".

---

## 11. Attribution and Outcome Tracking

### 11.1 record_attribution
After a session where seeds were injected and applied:
```
record_attribution(response_text="I used useRef to capture the current callback value, avoiding the stale closure.")
```
Expected: `suggested_cited_ids` includes the stale closure seed. `attribution_score > 0.15` threshold triggers the suggestion.

### 11.2 Full feedback loop
```
record_outcome(outcome="clean", cited_seed_ids=["react_stale_closure"])
```
Check `.lodestone/seed-confidence.json` — `react_stale_closure` should show incremented `injections` and `clean_after`.

```
record_outcome(outcome="regression", contradicted_seed_ids=["some_seed_id"])
```
Run `npm run build:negative-cache`. Verify the contradicted query+seed pair appears in `api/negative-cache.json`.

### 11.3 Evidence weight accumulates
After 5+ clean injections for a seed, `evidence_weight` should increase toward 1.0.
A seed with `evidence_weight > 0.5` has meaningful evidence backing its confidence estimate.

---

## 12. Phase-State Transitions

### 12.1 New seed (phase_state: "new")
A seed with < 5 total injections shows `phase_state: "new"` regardless of confidence value.
Trust the `certainty` score less for new seeds — it's mostly Laplace prior.

### 12.2 Latent seed (phase_state: "latent")
Force a seed's `effective_confidence` into [0.25, 0.30) by recording several regressions.
It should show `phase_state: "latent"` — in the hysteresis band, trajectory ambiguous.

### 12.3 Drain detection
After enough regressions, `is_drain_candidate: true` appears.
`phase_state: "drain"` — seed flagged for review.

---

## 13. Domain Fine-Tuning (Gap A)

### 13.1 Build the training dataset
```bash
python3 scripts/fine-tune-embeddings.py 2>&1 | head -20
```
Expected: reports N training pairs from seed corpus + any session archive pairs.

### 13.2 Verify domain model auto-detection
After running fine-tuning and ONNX export:
```bash
node -e "import('./mcp-server/embeddings.mjs').then(m => m.embed(['test'])).then(() => process.exit())"
```
Server logs should show: `[embeddings] Using domain-tuned model: .../models/lodestone-embeddings-onnx`

### 13.3 Retrieval quality comparison
```bash
npm run metrics:baseline   # capture before domain model
npm run build:embeddings   # rebuild with domain model
npm run metrics            # capture after
npm run metrics:compare    # diff
```
Expected: Hit Rate and MRR improve for technical antipattern queries.

---

## 14. Security Verification Checklist

| Check | Command | Expected |
|-------|---------|----------|
| Unsafe datasource ID blocked | `datasource_register(id="../escape")` | Error: unsafe characters |
| Path traversal in ID blocked | `datasource_register(id="a/b/c")` | Error: unsafe characters |
| vault_export path confined | `vault_export(output_path="/etc/malicious")` | Error: must be in .lodestone/ |
| RAG endpoint private IP blocked | `rag_connect(url="http://192.168.1.1/rag")` | Error: private address |
| RAG endpoint file:// blocked | `rag_connect(url="file:///etc/passwd")` | Error: scheme not http/https |
| RAG endpoint loopback blocked | `rag_connect(url="http://127.0.0.1/rag")` | Error: private/loopback |
| Vault file.name traversal blocked | (handled internally, SAFE_VAULT_FILE regex) | Unsafe filenames skipped |
| Stack name sanitized on save | `capture_fix` with `stack: "../escape"` | Falls back to "universal" |

---

## 15. Quick Health Check

Run the full suite in < 5 minutes:

```bash
# 1. Corpus integrity
node scripts/verify-complete.mjs

# 2. Synonym map
npm run build:synonyms && wc -l api/term-synonyms.json

# 3. RAPTOR + communities
npm run build:raptor && npm run build:communities
node -e "const r=require('./api/raptor-index.json'); console.log('RAPTOR clusters:', r.length)"
node -e "const c=require('./api/graph-communities.json'); console.log('Communities:', c.length)"

# 4. MCP server starts cleanly
timeout 3 node mcp-server/index.mjs 2>&1 | head -5

# 5. Security: all three fixes
node --input-type=module --check < mcp-server/datasources.mjs
node --input-type=module --check < mcp-server/connectors/rag-endpoint.mjs
node --input-type=module --check < mcp-server/vault.mjs
```

All commands should complete without errors.
