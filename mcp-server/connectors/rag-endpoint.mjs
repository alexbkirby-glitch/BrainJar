/**
 * mcp-server/connectors/rag-endpoint.mjs — Phase 7: External RAG Adapter
 *
 * Queries any external RAG system via HTTP and normalizes the response into
 * Lodestone's chunk format so the epistemic homeostasis bridge can apply
 * certainty, session_fit, and novelty signals to the results.
 *
 * Supports common response shapes automatically:
 *   { results: [{text, score}] }        — most RAG APIs
 *   { documents: [{content, relevance}] } — LlamaIndex, some LangChain
 *   { hits: [{_source:{text}, _score}] } — Elasticsearch / OpenSearch
 *   [{text, score}]                      — simple array
 *
 * Custom shapes: configure response_path, text_field, score_field in the
 * datasource registry entry.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

// ── Nested value access ───────────────────────────────────────────────────
// Supports: "results", "hits[0]", "data.results"

function dig(obj, path) {
  if (!path || obj == null) return obj;
  for (const part of path.split('.')) {
    if (obj == null) return undefined;
    const arrMatch = part.match(/^(\w+)\[(\d+)\]$/);
    obj = arrMatch ? obj[arrMatch[1]]?.[+arrMatch[2]] : obj[part];
  }
  return obj;
}

// ── Score normalization ───────────────────────────────────────────────────
// Most APIs return scores in different ranges. Normalize to [0, 1].

function normalizeScore(v) {
  if (v == null)    return 0.5;       // unknown → neutral
  if (v >= 0 && v <= 1) return v;     // already [0,1]
  if (v > 1)  return 1 / (1 + Math.exp(-(v - 1))); // sigmoid shift for large values
  if (v < 0)  return Math.max(0, v + 1); // negative → floor at 0
  return 0;
}

// ── URL safety ─────────────────────────────────────────────────────────────
// Block file:// and other non-HTTP schemes, and RFC-1918 / loopback addresses
// that could be used for SSRF against local services.

const BLOCKED_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|::1|0\.0\.0\.0)$/i;

function assertSafeUrl(urlStr) {
  let parsed;
  try { parsed = new URL(urlStr); }
  catch { throw new Error(`Invalid URL: "${urlStr}"`); }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`RAG endpoint URL must use http:// or https://. Got: ${parsed.protocol}`);
  }
  if (BLOCKED_HOSTS.test(parsed.hostname)) {
    throw new Error(
      `RAG endpoint URL points to a private/loopback address (${parsed.hostname}). ` +
      `Only public endpoints are supported.`
    );
  }
}
// Returns {items, textField, scoreField} or null if unrecognised.

function autoDetect(data) {
  // Try each common shape
  const candidates = [
    { items: data?.results,   textField: 'text',    scoreField: 'score'     },
    { items: data?.results,   textField: 'content', scoreField: 'relevance' },
    { items: data?.documents, textField: 'content', scoreField: 'relevance' },
    { items: data?.documents, textField: 'text',    scoreField: 'score'     },
    { items: data?.hits,      textField: '_source.text', scoreField: '_score' },
    { items: data?.chunks,    textField: 'text',    scoreField: 'score'     },
    { items: Array.isArray(data) ? data : null, textField: 'text', scoreField: 'score' },
  ];
  return candidates.find(c => Array.isArray(c.items) && c.items.length > 0) ?? null;
}

// ── Query ─────────────────────────────────────────────────────────────────

/**
 * query(sourceConfig, queryText, topK)
 *
 * Sends queryText to the configured RAG endpoint and returns normalized chunks.
 * Never throws — returns [] on network or parse error.
 */
export async function query(sourceConfig, queryText, topK = 5) {
  const {
    id,
    url,
    auth_env,
    query_format,
    response_path,
    text_field,
    score_field,
    metadata_fields = [],
    query_param = 'query',
    topk_param  = 'top_k',
  } = sourceConfig;

  // Validate URL before making any network request
  try { assertSafeUrl(url); }
  catch (err) {
    console.error(`[rag-endpoint:${id}] ${err.message}`);
    return [];
  }

  // ── Build request ─────────────────────────────────────────────────────
  const headers = { 'Content-Type': 'application/json' };
  const token = auth_env ? process.env[auth_env] : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let body;
  if (query_format) {
    // Custom template: replace {{query}} and {{top_k}}
    body = query_format
      .replace(/\{\{query\}\}/g,  JSON.stringify(queryText))
      .replace(/\{\{top_k\}\}/g, String(topK));
  } else {
    body = JSON.stringify({ [query_param]: queryText, [topk_param]: topK, k: topK, n: topK });
  }

  let data;
  try {
    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) {
      console.error(`[rag-endpoint:${id}] HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      return [];
    }
    data = await res.json();
  } catch (err) {
    console.error(`[rag-endpoint:${id}] Network error: ${err.message}`);
    return [];
  }

  // ── Extract result items ──────────────────────────────────────────────
  let items = response_path ? dig(data, response_path) : null;
  let tField = text_field, sField = score_field;

  if (!Array.isArray(items)) {
    const detected = autoDetect(data);
    if (!detected) {
      console.error(`[rag-endpoint:${id}] Unrecognised response shape. Configure response_path/text_field/score_field.`);
      return [];
    }
    items  = detected.items;
    tField = text_field  ?? detected.textField;
    sField = score_field ?? detected.scoreField;
  }

  // ── Normalize to Lodestone chunk format ───────────────────────────────
  return items.slice(0, topK).map((item, i) => ({
    chunk_id:  `${id}::${i}`,
    source_id: id,
    text:      dig(item, tField)  ?? JSON.stringify(item).slice(0, 500),
    score:     normalizeScore(dig(item, sField)),
    metadata:  Object.fromEntries(
      metadata_fields.map(f => [f.split('.').pop(), dig(item, f)])
    ),
  }));
}

// No indexing needed for RAG endpoints — they retrieve live.
export async function index() {
  throw new Error('rag_endpoint sources are queried live — no local indexing needed.');
}
