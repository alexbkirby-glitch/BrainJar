/**
 * api-schema.js
 * 
 * Defines the structure of the Lodestone JSON API.
 * All endpoints are static JSON files served from GitHub Pages.
 * No server required. No auth required. Fetch and use.
 * 
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 * 
 * ── ENDPOINTS ──────────────────────────────────────────────────────────────
 * 
 * GET /api/manifest.json
 *   Index of all published projects. Use to discover available context.
 * 
 * GET /api/projects/{slug}.json
 *   Full scored knowledge base for a specific project.
 *   This is what you point a model at.
 * 
 * GET /api/seeds/{stack}.json
 *   Community seed chunks for a language/framework.
 *   Used as baseline when no project-specific context exists.
 * 
 * ── MODEL USAGE ────────────────────────────────────────────────────────────
 * 
 * Minimal — drop session_start into your system prompt:
 *   const { session_start } = await fetch('/api/projects/my-project.json').then(r=>r.json())
 *   // paste session_start into CLAUDE.md or system prompt
 * 
 * Full — use ranked chunks for custom scoring:
 *   const { chunks, stack } = await fetch('/api/projects/my-project.json').then(r=>r.json())
 *   const relevant = chunks.filter(c => c.score >= 0.35).slice(0, 5)
 * 
 * Claude.ai — paste the fetch_instructions into a Project's custom instructions:
 *   const { fetch_instructions } = await fetch('/api/projects/my-project.json').then(r=>r.json())
 *   // fetch_instructions is a plain English instruction block for the model
 */

// ── Project JSON schema ─────────────────────────────────────────────────────

/**
 * @typedef {Object} ProjectAPI
 * 
 * @property {string}   schema_version   - "1.0"
 * @property {string}   slug             - URL-safe project identifier
 * @property {string}   name             - Human-readable project name
 * @property {string}   generated_at     - ISO 8601 timestamp
 * @property {StackProfile} stack        - Detected technology stack
 * @property {string}   session_start    - Ready-to-paste context block for system prompts
 * @property {string}   fetch_instructions - Plain English instructions for models
 * @property {Chunk[]}  chunks           - All knowledge chunks, pre-scored
 * @property {string}   skill_md         - Full SKILL.md content
 * @property {Usage}    usage            - How to consume this API
 */

/**
 * @typedef {Object} StackProfile
 * @property {string}   language
 * @property {string}   framework
 * @property {string}   domain
 * @property {string}   target
 * @property {string[]} notablePatterns
 * @property {boolean}  hasBugHistory
 * @property {string}   confidence
 */

/**
 * @typedef {Object} Chunk
 * @property {string}   id
 * @property {string}   title
 * @property {string}   content      - Full WRONG/CORRECT/Symptom prose (always present)
 * @property {string}   [wrong]      - Structured: the antipattern in one sentence (optional)
 * @property {string}   [correct]    - Structured: the fix in one sentence (optional)
 * @property {string[]} tags
 * @property {string}   source       - "project" | "seed" | "contributed"
 * @property {number}   base_score   - Pre-computed relevance (0-1) against common intents
 * @property {string}   section      - Which SKILL.md section this came from
 * @property {string}   [framework_version] - Semver range this chunk applies to (e.g. ">=4.0", "^18.0")
 * @property {string}   [valid_through]     - ISO date or version after which this chunk may be stale
 * @property {boolean}  [deprecated]        - True if superseded; still present for history, not injected
 *
 * ── Domain expansion fields (see DOMAIN_EXPANSION.md) ─────────────────────────
 * These fields support Lodestone's expansion beyond code. All optional and
 * backwards-compatible: chunks without them are treated as legacy tier-0 code
 * with unverified status. Strict gates only fire when domain_tier is declared.
 *
 * @property {string}   [domain]              - Top-level domain category (e.g. "code", "cooking",
 *                                              "nutrition", "personal-finance"). Used by the merge
 *                                              gate to look up the per-domain source allowlist in
 *                                              domain-sources.json.
 * @property {0|1|2}    [domain_tier]         - Risk tier governing the merge gate.
 *                                              0 = low stakes  (auto-merge on lint clean + doc_reference)
 *                                              1 = moderate    (requires allowlisted doc_reference + community review)
 *                                              2 = high stakes (never auto-merges; requires steward sign-off;
 *                                                               excluded from injection below steward-verified)
 * @property {"unverified"|"community-reviewed"|"steward-verified"|"disputed"} [verification_status]
 *                                            - Current trust level of the chunk. Surfaced in session_start
 *                                              so downstream models can weight the chunk appropriately.
 *                                              Tier 2 chunks below "steward-verified" are excluded from
 *                                              injection entirely. "disputed" is also excluded from injection
 *                                              and stays excluded until a maintainer resolves the dispute
 *                                              and sets a definitive status (see STEWARD_COLLABORATION.md).
 * @property {string}   [doc_reference]       - URL citing an authoritative source for the CORRECT pattern.
 *                                              Required for tier 1 AUTO_APPROVE. Validated against the per-
 *                                              domain allowlist in domain-sources.json for tiers 1 and 2.
 * @property {string}   [reviewed_by]         - Steward id (from stewards.json) who verified this chunk.
 *                                              Required for tier 2 chunks at "steward-verified" status.
 *
 * ── Chunk relationships (see build-index.mjs → relationship_graph) ───────────
 * @property {Object}   [relationships]
 * @property {string[]} [relationships.supersedes]  - IDs this chunk replaces (older API, deprecated pattern)
 * @property {string[]} [relationships.implies]     - IDs the model should also know when injecting this chunk
 * @property {string[]} [relationships.conflicts]   - IDs that contradict this chunk in different contexts;
 *                                                    both are injected, each surfaced with context note
 * @property {string[]} [relationships.see_also]    - Loosely related IDs, injected if spare context permits
 *
 * ── Injection scoring field (see evaluateInjection()) ─────────────────────────
 * @property {"low"|"medium"|"high"|"critical"} [blast_radius]
 *   - How severe the bug is when triggered. Used by evaluateInjection() to weight
 *     expected savings against injection cost. Author-specified — chunk authors
 *     know the blast radius better than any heuristic.
 *     low      — style/cosmetic, cheap to fix (~0.5x weight)
 *     medium   — logic error, wrong API (one correction cycle, 1x) [default when omitted]
 *     high     — architectural mistake, major rewrite needed (~2.5x)
 *     critical — data loss, security hole, silent corruption (7x)
 */

/**
 * @typedef {Object} Usage
 * @property {string}   project_url  - This file's URL
 * @property {string}   skill_url    - Direct link to download SKILL.md
 * @property {string}   manifest_url - Link to full project manifest
 * @property {string}   fetch_hint   - One-line fetch example
 */

/**
 * @typedef {Object} SymptomIndexEntry
 * @property {string} stack   - The seed stack this chunk belongs to
 * @property {string} id      - Chunk ID
 * @property {string} title   - Chunk title
 * @property {string} symptom - Extracted symptom text
 */

/**
 * @typedef {Object} SymptomIndex
 * @@description Reverse index built by scripts/build-index.mjs.
 *   Maps error message tokens to chunk entries for O(1) lookup without embeddings.
 *   Served at /api/symptom-index.json.
 *
 * Usage:
 *   1. Tokenize the developer's error message (lowercase, split on non-alpha, drop stopwords, min 3 chars)
 *   2. Look up each token in index{}
 *   3. Collect all matching SymptomIndexEntry objects
 *   4. Deduplicate by id, surface top matches
 *
 * @property {string}   schema_version
 * @property {string}   built_at
 * @property {Object}   stats          - { stacks, total_chunks, indexed_chunks, tokens }
 * @property {Object}   usage          - How-to description for LLM clients
 * @property {Object.<string, SymptomIndexEntry[]>} index - token → entries
 * @property {SymptomIndexEntry[]} chunks - Flat list for full-text fallback search
 */

/**
 * @typedef {Object} MinProject
 * @description Minimal project endpoint served at /api/projects/{slug}-min.json.
 *   Contains only what an LLM needs in a system prompt: session_start + top 5 chunks.
 *   Under ~2KB for most projects.
 *
 * @property {string}   schema_version
 * @property {string}   slug
 * @property {string}   name
 * @property {string}   generated_at
 * @property {Object}   stack          - { language, framework, domain }
 * @property {string}   session_start  - Ready-to-paste context block
 * @property {string}   fetch_instructions
 * @property {Chunk[]}  top_chunks     - Top 5 chunks by base_score
 * @property {Object}   usage          - { full_url, txt_url, symptom_url }
 */

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Shared injection predicate — mirrors the gate in build-index.mjs.
 * Returns true if a chunk should be served to consumers.
 *
 * Rules:
 *   - Tier 2 below steward-verified: held until a credentialed steward signs off
 *   - Tier 1 in a domain with an empty allowlist: held until the domain is opened
 *   - All legacy chunks (no domain_tier): always injectable
 *
 * @param {Object} chunk
 * @param {Object|null} domainSources - Parsed domain-sources.json, or null to skip tier-1 gate
 */
function isInjectable(chunk, domainSources) {
  // Tier-2 unverified and all disputed chunks are excluded from injection
  if (chunk.domain_tier === 2 && chunk.verification_status !== 'steward-verified') return false;
  if (chunk.verification_status === 'disputed') return false; // awaiting dispute resolution
  if (chunk.domain_tier === 1 && chunk.domain && domainSources) {
    const allowlist = domainSources.domains?.[chunk.domain];
    if (allowlist !== undefined && allowlist !== null && allowlist.length === 0) return false;
  }
  return true;
}

/**
 * Build a ProjectAPI object from skill generator output.
 * 
 * @param {Object} params
 * @param {string} params.skillMd        - Generated SKILL.md content
 * @param {Object} params.profile        - Stack profile from detectStack()
 * @param {Array}  params.chunks         - Scored chunks [{id, title, content, tags, score}]
 * @param {string} params.baseUrl        - GitHub Pages base URL
 * @param {Object} [params.domainSources] - Parsed domain-sources.json for tier-1 domain gate (optional)
 * @returns {ProjectAPI}
 */
export function buildProjectAPI({ skillMd, profile, chunks, baseUrl, domainSources = null }) {
  const slug = (profile.projectName ?? 'project')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Filter out chunks that governance rules hold from injection.
  // See DOMAIN_EXPANSION.md → "Verification status" and "Tier 1 closed domains".
  // Held chunks remain in the seed file and are re-evaluated when their gate condition
  // clears (steward sign-off for tier 2; domain allowlist populated for tier 1).
  const injectableChunks = chunks.filter(c => isInjectable(c, domainSources));

  const topChunks = [...injectableChunks]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6);

  const sessionStart = buildSessionStart(profile, topChunks, skillMd);
  const fetchInstructions = buildFetchInstructions(slug, baseUrl, profile);

  return {
    schema_version: "1.0",
    slug,
    name: profile.projectName ?? 'Project',
    generated_at: new Date().toISOString(),
    stack: {
      language:        profile.language ?? null,
      framework:       profile.framework ?? null,
      domain:          profile.domain ?? null,
      target:          profile.target ?? null,
      notablePatterns: profile.notablePatterns ?? [],
      hasBugHistory:   profile.hasBugHistory ?? false,
      confidence:      profile.confidence ?? 'unknown',
    },
    session_start: sessionStart,
    fetch_instructions: fetchInstructions,
    chunks: injectableChunks.map(c => ({
      id:         c.id,
      title:      c.title,
      content:    c.content,
      tags:       c.tags ?? [],
      source:     c.source ?? 'project',
      base_score: Math.round((c.score ?? 0) * 1000) / 1000,
      section:    c.section ?? 'general',
      // Domain expansion fields — passed through when present
      ...(c.domain              !== undefined ? { domain:              c.domain              } : {}),
      ...(c.domain_tier         !== undefined ? { domain_tier:         c.domain_tier         } : {}),
      ...(c.verification_status !== undefined ? { verification_status: c.verification_status } : {}),
      ...(c.doc_reference       !== undefined ? { doc_reference:       c.doc_reference       } : {}),
      ...(c.reviewed_by         !== undefined ? { reviewed_by:         c.reviewed_by         } : {}),
      // Injection scoring field
      ...(c.blast_radius        !== undefined ? { blast_radius:        c.blast_radius        } : {}),
      // Chunk relationships
      ...(c.relationships       !== undefined ? { relationships:       c.relationships       } : {}),
    })),
    skill_md: skillMd,
    usage: {
      project_url:  `${baseUrl}/api/projects/${slug}.json`,
      skill_url:    `${baseUrl}/api/projects/${slug}-SKILL.md`,
      manifest_url: `${baseUrl}/api/manifest.json`,
      fetch_hint:   `fetch('${baseUrl}/api/projects/${slug}.json').then(r=>r.json())`,
    },
  };
}

/**
 * Build the session_start string — ready to drop into CLAUDE.md or a system prompt.
 * This is the "leaked" context: everything a model needs, nothing it doesn't.
 */
function buildSessionStart(profile, topChunks, skillMd) {
  const BLAST_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

  // Sort by blast radius so critical and high patterns lead
  const sorted = [...topChunks].sort((a, b) =>
    (BLAST_RANK[a.blast_radius] ?? 2) - (BLAST_RANK[b.blast_radius] ?? 2)
  );

  const critical = sorted.filter(c => c.blast_radius === 'critical');
  const high     = sorted.filter(c => c.blast_radius === 'high');
  const medium   = sorted.filter(c => c.blast_radius === 'medium');

  function extractSection(content, marker) {
    if (!content) return '';
    const re = new RegExp(`${marker}:\\s*([\\s\\S]*?)(?=WRONG:|CORRECT:|Symptom:|$)`, 'i');
    return content.match(re)?.[1]?.trim()?.slice(0, 160) ?? '';
  }

  function statusNote(c) {
    if (!c.verification_status || c.verification_status === 'steward-verified') return '';
    return ` [${c.verification_status}]`;
  }

  const stack  = profile.framework ?? profile.language ?? 'unknown';
  const domain = profile.domain ?? 'code';
  const now    = new Date().toISOString().slice(0, 10);

  const lines = [
    `=== LODESTONE \u2014 ${stack.toUpperCase()} SESSION CONTEXT ===`,
    `Stack: ${stack} \xb7 Domain: ${domain} \xb7 ${now}`,
    `Seeds: ${topChunks.length} (${critical.length} critical, ${high.length} high, ${medium.length} medium)`,
    ``,
  ];

  if (critical.length) {
    lines.push(`\u2500\u2500 \u26a0 CRITICAL \u2014 data loss / security (never violate) \u2500\u2500`);
    for (const c of critical) {
      const wrong   = c.wrong   || extractSection(c.content, 'WRONG');
      const correct = c.correct || extractSection(c.content, 'CORRECT');
      const symptom = c.symptom || extractSection(c.content, 'Symptom');
      lines.push(`[${c.title}${statusNote(c)}]`);
      if (wrong)   lines.push(`  WRONG:   ${wrong}`);
      if (correct) lines.push(`  CORRECT: ${correct}`);
      if (symptom) lines.push(`  Symptom: ${symptom}`);
      lines.push(``);
    }
  }

  if (high.length) {
    lines.push(`\u2500\u2500 HIGH blast \u2014 architectural rewrites likely \u2500\u2500`);
    for (const c of high.slice(0, 4)) {
      const wrong   = c.wrong   || extractSection(c.content, 'WRONG');
      const correct = c.correct || extractSection(c.content, 'CORRECT');
      const symptom = c.symptom || extractSection(c.content, 'Symptom');
      lines.push(`[${c.title}${statusNote(c)}]`);
      if (wrong)   lines.push(`  WRONG:   ${wrong}`);
      if (correct) lines.push(`  CORRECT: ${correct}`);
      if (symptom) lines.push(`  Symptom: ${symptom}`);
      lines.push(``);
    }
  }

  if (medium.length) {
    lines.push(`\u2500\u2500 MEDIUM blast \u2014 one correction cycle \u2500\u2500`);
    for (const c of medium.slice(0, 4)) {
      const symptom = c.symptom || extractSection(c.content, 'Symptom');
      lines.push(`\xb7 ${c.title}${statusNote(c)}${symptom ? ` \u2014 ${symptom.slice(0, 100)}` : ''}`);
    }
    lines.push(``);
  }

  // Symptom quick-lookup index
  const lookup = sorted
    .filter(c => c.symptom || /Symptom:/i.test(c.content ?? ''))
    .slice(0, 12);

  if (lookup.length) {
    lines.push(`\u2500\u2500 Symptom quick-lookup \u2500\u2500`);
    for (const c of lookup) {
      const symptom = c.symptom || extractSection(c.content, 'Symptom');
      if (!symptom) continue;
      const kw = symptom
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !['when','then','that','this','from','with','into'].includes(w))
        .slice(0, 3)
        .join(' \xb7 ');
      if (kw) lines.push(`"${kw}" \u2192 ${c.id} [${c.blast_radius ?? 'medium'}]`);
    }
    lines.push(``);
  }

  lines.push(`Full skill: generated/skills/${stack}-SKILL.md`);
  lines.push(`=== END LODESTONE CONTEXT ===`);
  return lines.join('\n');
}

/**
 * Build fetch_instructions — plain English for a model to understand
 * how to consume this API without any code.
 */
function buildFetchInstructions(slug, baseUrl, profile) {
  return `To load project context for ${profile.projectName ?? 'this project'}, fetch:
${baseUrl}/api/projects/${slug}.json

The response contains:
- session_start: paste this into your system prompt or CLAUDE.md for instant project context
- chunks: scored knowledge base — filter by base_score >= 0.35 for high-relevance items
- skill_md: full SKILL.md — install as a Claude skill for persistent context
- stack: detected language (${profile.language ?? '?'}), framework (${profile.framework ?? '?'}), domain (${profile.domain ?? '?'})

All chunks are pre-scored against common development intents. Higher base_score = more universally relevant. For session-specific scoring, re-rank chunks against your current intent using cosine similarity.`.trim();
}

/**
 * Extract key sections from SKILL.md by heading.
 * Recognizes both code-domain headings ("Bug history", "Session rules", "Gotchas")
 * and equivalent non-code headings ("Common mistakes", "Best practices", "Warnings").
 */
function extractKeySections(skillMd) {
  const sections = {};
  const lines = skillMd.split('\n');
  let current = null;
  let buffer = [];

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      if (current) sections[current] = buffer.join('\n').trim();
      const title = h2[1].toLowerCase();
      current = (title.includes('bug') || title.includes('common mistake') || title.includes('avoid') || title.includes('pitfall') || title.includes('error'))
               ? 'bugs'
               : (title.includes('rule') || title.includes('session') || title.includes('best practice') || title.includes('guideline') || title.includes('principle'))
               ? 'rules'
               : (title.includes('pattern') || title.includes('technique') || title.includes('method'))
               ? 'patterns'
               : (title.includes('gotcha') || title.includes('warning') || title.includes('caution') || title.includes('note'))
               ? 'gotchas'
               : (title.includes('architecture') || title.includes('map') || title.includes('structure') || title.includes('overview'))
               ? 'architecture'
               : null;
      buffer = [];
    } else if (current) {
      buffer.push(line);
    }
  }
  if (current) sections[current] = buffer.join('\n').trim();
  return sections;
}

// ── Manifest builder ─────────────────────────────────────────────────────────

/**
 * Build or update the manifest.json index.
 * 
 * @param {Object[]} existing  - Current manifest entries
 * @param {ProjectAPI} project - Newly published project
 * @returns {Object} Updated manifest
 */
export function updateManifest(existing, project) {
  const entry = {
    slug:          project.slug,
    name:          project.name,
    stack:         `${project.stack.framework ?? project.stack.language ?? 'unknown'}`,
    domain:        project.stack.domain ?? null,
    updated_at:    project.generated_at,
    chunks:        project.chunks.length,
    has_bug_history: project.stack.hasBugHistory,
    url:           project.usage.project_url,
  };

  const updated = (existing ?? []).filter(e => e.slug !== project.slug);
  updated.unshift(entry);

  return {
    schema_version: "1.0",
    updated_at: new Date().toISOString(),
    projects: updated,
    total: updated.length,
  };
}

// ── Chunk scorer ──────────────────────────────────────────────────────────────
// Pre-scores chunks against a set of common intents so consumers
// don't need to run embeddings themselves.

const INTENTS_BY_DOMAIN = {
  code: [
    'fixing a bug',
    'adding a new feature',
    'creating a new file',
    'editing existing code',
    'fixing ui layout',
    'fixing html export',
    'adding audio',
    'fixing scroll behavior',
    'writing tests',
    'refactoring',
  ],
  cooking: [
    'cooking a recipe',
    'baking bread',
    'food safety',
    'knife technique',
    'seasoning food',
  ],
  writing: [
    'writing clearly',
    'editing prose',
    'structuring argument',
    'avoiding common mistakes',
    'improving style',
  ],
  nutrition: [
    'understanding nutrition labels',
    'balanced diet',
    'dietary guidelines',
    'food groups',
  ],
  'personal-finance': [
    'budgeting money',
    'saving for retirement',
    'understanding taxes',
    'managing debt',
    'investing basics',
  ],
  fitness: [
    'building strength',
    'cardio training',
    'injury prevention',
    'recovery routine',
    'progressive overload',
  ],
  // Default intent pool — used when no domain-specific pool is registered
  _default: [
    'learning the basics',
    'avoiding common mistakes',
    'best practice',
    'correct approach',
    'fixing a problem',
  ],
};

/**
 * Score a chunk against common intents using lexical overlap.
 * Picks the intent pool that matches the chunk's declared domain (or stack for
 * legacy code chunks), falling back to the generic pool.
 * In production this would use embeddings — lexical is used here
 * to keep the publisher zero-dependency.
 */
export function scoreChunkBase(chunk) {
  const domain = chunk.domain ?? (chunk.stack ? 'code' : null);
  const intents = INTENTS_BY_DOMAIN[domain] ?? INTENTS_BY_DOMAIN._default;
  const text = (chunk.title + ' ' + chunk.content + ' ' + (chunk.tags ?? []).join(' ')).toLowerCase();
  let maxScore = 0;
  for (const intent of intents) {
    const tokens = intent.split(' ');
    let score = 0;
    for (const t of tokens) {
      if (text.includes(t)) score += 1 / tokens.length;
    }
    maxScore = Math.max(maxScore, score);
  }
  return Math.round(maxScore * 1000) / 1000;
}

// ── Injection value scorer ─────────────────────────────────────────────────────
// Determines whether injecting a chunk is worth the token cost, using a
// Kelly-inspired threshold that rises as context pressure builds.
//
// The St. Petersburg resolution: expected savings are capped at 30% of remaining
// context (bounded utility — you cannot benefit from savings larger than your
// remaining budget), and the threshold is quadratic in context pressure (the
// marginal value of each token rises as the window fills).
//
// No telemetry required. taskComplexity is a caller-supplied prior;
// blast_radius is author-supplied per chunk.

/** @type {{low:number, medium:number, high:number, critical:number}} */
export const BLAST_MULTIPLIERS = { low: 0.5, medium: 1.0, high: 2.5, critical: 7.0 };

/** Tokens saved by a single prevented bug-fix cycle (median from empirical analysis). */
export const BASE_SAVINGS_TOKENS = 1800;

/** Flat cost in tokens for one MCP tool call or session_start injection. */
export const INJECTION_COST_TOKENS = 140;

/**
 * Evaluate whether injecting a chunk is worth the token cost given the
 * current session context.
 *
 * @param {Object} chunk
 * @param {"low"|"medium"|"high"|"critical"} [chunk.blast_radius]
 *
 * @param {Object} options
 * @param {number} options.similarity        - Cosine or Jaccard similarity to current prompt (0–1)
 * @param {number} [options.tokensUsed=0]   - Tokens consumed so far in this session
 * @param {number} [options.contextWindow=200000] - Total context window (tokens)
 * @param {number} [options.taskComplexity=0.35]  - P(makes error without this chunk).
 *   Default 0.35 is a reasonable prior for moderate coding tasks.
 *   Future: replaced per-domain by the telemetry feedback loop (see TELEMETRY_PLAN.md).
 *
 * @returns {{ inject: boolean, expectedSavings: number, threshold: number, roi: number }}
 */
export function evaluateInjection(chunk, {
  similarity,
  tokensUsed        = 0,
  contextWindow     = 200_000,
  taskComplexity    = 0.35,
  relaxationFactor  = 1.0,
} = {}) {
  const blast = BLAST_MULTIPLIERS[chunk.blast_radius ?? 'medium'];
  const raw   = similarity * taskComplexity * blast * BASE_SAVINGS_TOKENS;
  const tokensRemaining = Math.max(0, contextWindow - tokensUsed);
  const expectedSavings = Math.min(raw, tokensRemaining * 0.3);

  const contextPressure = Math.pow(tokensUsed / Math.max(contextWindow, 1), 2);
  const threshold = INJECTION_COST_TOKENS * (1 + contextPressure * 2);

  // Apply Nova relaxation via sigmoid (matches evaluateInjectionSmooth semantics)
  const R = Math.max(0.1, Math.min(3.0, relaxationFactor));
  const SIGMOID_K   = 0.03 * R;
  const injectWeight = 1 / (1 + Math.exp(-SIGMOID_K * (expectedSavings - threshold)));

  const roi = threshold > 0
    ? Math.round((expectedSavings - threshold) / threshold * 100)
    : 0;

  return {
    inject:          injectWeight > 0.5,
    inject_weight:   Math.round(injectWeight * 1000) / 1000,
    expectedSavings: Math.round(expectedSavings),
    threshold:       Math.round(threshold),
    roi,
  };
}

// ── Smooth injection potential ─────────────────────────────────────────────────
// Conformal reformulation of evaluateInjection using log-space similarity
// and an exponential threshold curve.
//
// Motivation:
//   The linear similarity term in evaluateInjection treats the difference between
//   0.1 and 0.2 identically to the difference between 0.9 and 1.0. In practice,
//   near-perfect relevance is qualitatively different from moderate relevance.
//   The logarithm is the canonical way to "unroll" this — the same idea behind
//   the Böttcher coordinate that maps the exterior of the Mandelbrot set conformally
//   to the exterior of the unit disk, with the Green's function G(c) = log|φ(c)|
//   measuring distance-to-boundary in a geometrically natural way.
//
//   Here, log1p(similarity × e) plays the role of the Green's function:
//     - Low similarity → small potential (far from the "attractor" of this seed)
//     - High similarity → large potential (near the attractor)
//     - The log separates 0.9 from 0.99 far more than it separates 0.1 from 0.2
//
//   The threshold uses an exponential curve instead of quadratic:
//     T(c) = COST × exp(c × log(maxRatio))
//   This gives the boundary the same kind of smooth, harmonic shape as
//   the level curves of the Green's function.
//
// outcomeConfidence: seed-level signal from record_outcome calls.
//   sqrt transform gives gentle penalization — an unproven seed is slightly
//   disfavoured, not blocked.

export function evaluateInjectionSmooth(chunk, {
  similarity,
  tokensUsed        = 0,
  contextWindow     = 200_000,
  taskComplexity    = 0.35,
  outcomeConfidence = 0.5,
  relaxationFactor  = 1.0,   // Nova R: per-stack relaxation. R<1 = conservative, R>1 = aggressive.
} = {}) {
  const blast = BLAST_MULTIPLIERS[chunk.blast_radius ?? 'medium'];

  const logSim = Math.log1p(similarity * Math.E) / Math.log1p(Math.E);
  const confMod = Math.sqrt(Math.max(0.05, outcomeConfidence));
  const raw = logSim * taskComplexity * blast * BASE_SAVINGS_TOKENS * confMod;

  const tokensRemaining = Math.max(0, contextWindow - tokensUsed);
  const expectedSavings = Math.min(raw, tokensRemaining * 0.3);

  const contextPressure = tokensUsed / Math.max(contextWindow, 1);
  const threshold = INJECTION_COST_TOKENS * Math.exp(contextPressure * Math.log(3));

  // Nova relaxation applied to sigmoid steepness k.
  // Base k = 0.03 gives ±100-token soft band at R=1.
  // R > 1 sharpens the band (more decisive, closer to hard threshold).
  // R < 1 widens the band (more gradual, seeds near threshold get partial weight).
  // Clamp R to [0.1, 3.0] — extreme values degenerate to step function or flat 0.5.
  const R = Math.max(0.1, Math.min(3.0, relaxationFactor));
  const SIGMOID_K = 0.03 * R;
  const injectWeight = 1 / (1 + Math.exp(-SIGMOID_K * (expectedSavings - threshold)));

  const roi = threshold > 0
    ? Math.round((expectedSavings - threshold) / threshold * 100)
    : 0;

  return {
    inject:            injectWeight > 0.5,
    inject_weight:     Math.round(injectWeight * 1000) / 1000,
    expectedSavings:   Math.round(expectedSavings),
    threshold:         Math.round(threshold),
    roi,
    log_similarity:    Math.round(logSim * 1000) / 1000,
    conf_modifier:     Math.round(confMod * 1000) / 1000,
    relaxation_factor: R,
    smooth:            true,
  };
}
