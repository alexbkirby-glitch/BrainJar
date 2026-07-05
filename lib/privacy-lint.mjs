/**
 * lib/privacy-lint.mjs — Privacy lint (successor to the seeds/weeds
 * anonymizability boundary)
 *
 * Weeds got cut (GBrain's memory layer does personal context better), but
 * the anonymizability filter weeds enforced did NOT get a replacement in
 * the original grill session — this module is that replacement.
 *
 * Runs at two points:
 *   1. capture_seed  — advisory. Flags issues, does not block staging into
 *      the LOCAL jar (a private jar can hold whatever it wants).
 *   2. publish        — a HARD GATE. Any finding at or above `blast: high`
 *      severity in this module blocks publish outright; the seed must be
 *      edited or explicitly overridden by the human before it can go public.
 *
 * This is heuristic, not exhaustive. It is deliberately biased toward false
 * positives over false negatives — an annoying flag on a clean seed costs
 * seconds; a leaked hostname in a Public Jar costs a lot more. Tighten by
 * removing patterns that prove noisy in practice, not by loosening review.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

// Each rule: { id, severity, pattern, message }
// severity: 'high' (blocks publish) | 'medium' (flagged, does not block)
// Placeholder/convention exemptions — added after running privacy-lint
// against the real 2,156-seed corpus and finding 11/11 flagged seeds were
// false positives: RFC 2606 reserved example domains and well-known dev
// tooling conventions, not leaked PII. A regex alone can't tell
// "host.docker.internal" (Docker's own documented hostname) from
// "db-prod.mycompanyxyz.internal" (an actual leak) without this.
const EXEMPT_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'example.edu',
  'test.com', 'yourdomain.com',
]);
const EXEMPT_HOSTNAME_EXACT = new Set([
  'host.docker.internal', 'env.local', '.env.local', 'localhost.localdomain',
]);
// Labels that commonly precede .local/.internal in non-hostname contexts
// (filenames, path/config properties) — env.local, path.local, etc.
const EXEMPT_HOSTNAME_PRECEDING_LABELS = new Set([
  'env', 'path', 'test', 'tmp', 'config', 'settings', 'local', 'docker',
]);
// 'docker' added after finding host.docker.internal fail its exact-match
// exemption: the regex only ever captures the LAST TWO labels
// (docker.internal), never the full host.docker.internal string, so an
// exact-string exemption for the full name silently never fired. The
// preceding-label heuristic catches it correctly regardless of what
// precedes "docker" (host.docker.internal, gateway.docker.internal, etc).

function isExemptEmail(match) {
  const [local, domain] = match.split('@');
  if (domain && EXEMPT_EMAIL_DOMAINS.has(domain.toLowerCase())) return true;
  // Trivial placeholder heuristic: a@b.com, x@y.com — single/double-char
  // local part AND single/double-char domain label, a pattern that shows
  // up constantly in docs/examples and is never a real address. Found
  // against the real corpus: 'a@b.com' in a Flask test-client example.
  const domainLabel = domain?.split('.')[0];
  if (local && domainLabel && local.length <= 2 && domainLabel.length <= 2) return true;
  return false;
}

function isExemptHostname(match) {
  const lower = match.toLowerCase();
  if (EXEMPT_HOSTNAME_EXACT.has(lower)) return true;
  if (lower.endsWith('.svc.cluster.local')) return true; // k8s internal DNS, generic not company-specific
  const beforeSuffix = lower.split('.').slice(-2, -1)[0]; // label immediately before .internal/.local/etc.
  return EXEMPT_HOSTNAME_PRECEDING_LABELS.has(beforeSuffix);
}

const RULES = [
  {
    id: 'absolute_unix_path',
    severity: 'medium',
    pattern: /\/(?:Users|home)\/[a-zA-Z0-9._-]+/g,
    message: 'looks like an absolute filesystem path with a username in it',
  },
  {
    id: 'windows_user_path',
    severity: 'medium',
    pattern: /C:\\Users\\[a-zA-Z0-9._-]+/g,
    message: 'looks like a Windows path with a username in it',
  },
  {
    id: 'internal_hostname',
    severity: 'high',
    pattern: /\b[a-zA-Z0-9-]+\.(?:internal|corp|local|lan)\b/gi,
    message: 'looks like an internal/corp hostname',
  },
  {
    id: 'private_ip',
    severity: 'high',
    pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    message: 'looks like a private/internal IP address',
  },
  {
    id: 'email_address',
    severity: 'high',
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    message: 'looks like an email address',
  },
  {
    id: 'company_specific_domain_guess',
    // Catches things like "servicesync" as seen in seeds/personal — a
    // product/company name embedded directly in the seed body. This one
    // is intentionally loose: it just flags CamelCase or clearly-branded
    // single tokens repeated 2+ times, for human judgment, not auto-block.
    severity: 'medium',
    pattern: /\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/g,
    message: 'contains a CamelCase token that may be a product/company name — confirm it is not company-identifying before publishing',
  },
  {
    id: 'aws_style_secret',
    severity: 'high',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    message: 'matches the shape of an AWS access key ID',
  },
  {
    id: 'generic_bearer_or_key',
    severity: 'high',
    pattern: /\b(?:api[_-]?key|secret|token|bearer)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}['"]?/gi,
    message: 'looks like an embedded API key, token, or secret',
  },
];

/**
 * Lint a single seed object. Checks wrong/correct/symptom/doc_reference —
 * the free-text fields where leakage actually happens. Does not touch id/
 * stack/tags, which are supposed to be short structured tokens anyway.
 *
 * Returns { ok, blocking, findings }.
 *   ok       — true if there are zero findings at all.
 *   blocking — true if any finding is severity 'high' (would block publish).
 *   findings — [{ field, ruleId, severity, message, matches }]
 */
export function privacyLint(seed) {
  const findings = [];
  const fieldsToScan = ['wrong', 'correct', 'symptom', 'doc_reference'];

  for (const field of fieldsToScan) {
    const text = seed?.[field];
    if (typeof text !== 'string' || text.length === 0) continue;

    for (const rule of RULES) {
      const rawMatches = [...text.matchAll(rule.pattern)].map((m) => m[0]);
      const matches = rawMatches.filter((m) => {
        if (rule.id === 'email_address') return !isExemptEmail(m);
        if (rule.id === 'internal_hostname') return !isExemptHostname(m);
        return true;
      });
      if (matches.length > 0) {
        findings.push({
          field,
          ruleId: rule.id,
          severity: rule.severity,
          message: rule.message,
          // Cap stored matches so a lint report can't itself become a leak
          // vector if it's ever copy-pasted somewhere less careful.
          matches: matches.slice(0, 3),
        });
      }
    }
  }

  const blocking = findings.some((f) => f.severity === 'high');
  return { ok: findings.length === 0, blocking, findings };
}

/**
 * Convenience gate for the publish path. Throws with a readable message
 * if any high-severity finding exists, unless explicitly overridden.
 *
 * @param {object} seed
 * @param {object} [opts]
 * @param {boolean} [opts.override] — human explicitly acknowledged the
 *   finding and wants to publish anyway (e.g. a CamelCase false positive).
 *   Only medium-severity findings should realistically ever be overridden;
 *   high-severity overrides should still be rare and logged upstream.
 */
export function assertPublishable(seed, opts = {}) {
  const result = privacyLint(seed);
  if (result.blocking && !opts.override) {
    const summary = result.findings
      .filter((f) => f.severity === 'high')
      .map((f) => `  [${f.field}] ${f.ruleId}: ${f.message}`)
      .join('\n');
    throw new Error(
      `Seed "${seed.id}" failed privacy lint and cannot be published:\n${summary}\n` +
      `Edit the offending field(s), or re-run with an explicit override if this is a false positive.`
    );
  }
  return result;
}
