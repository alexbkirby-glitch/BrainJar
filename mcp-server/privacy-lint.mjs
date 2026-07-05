/**
 * mcp-server/privacy-lint.mjs — Community-upload privacy gate
 *
 * Scans a captureFix() chunk for PII/secrets before it's offered for
 * community upload. Advisory at capture time (personal-patterns.json
 * always saves locally regardless of findings) — this only gates the
 * `actions.upload` path in captureFix's response.
 *
 * Scans title/content/wrong/correct/doc_reference — the real chunk shape
 * saved by captureFix() has no separate `symptom` field (it's folded into
 * `content` as a WRONG/CORRECT/Symptom string), unlike the standalone
 * Brain Jar seed schema (lib/seed-schema.mjs) used for Public Jar seeds,
 * which does have a distinct `symptom` field. Same rule set, different
 * field list — kept as a separate module rather than forcing one shape
 * to fit both call sites.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

// Same exemptions as lib/privacy-lint.mjs — see that file's comment for
// the real-corpus false-positive findings that motivated this.
const EXEMPT_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'example.edu',
  'test.com', 'yourdomain.com',
]);
const EXEMPT_HOSTNAME_EXACT = new Set([
  'host.docker.internal', 'env.local', '.env.local', 'localhost.localdomain',
]);
const EXEMPT_HOSTNAME_PRECEDING_LABELS = new Set([
  'env', 'path', 'test', 'tmp', 'config', 'settings', 'local', 'docker',
]);

function isExemptEmail(match) {
  const [local, domain] = match.split('@');
  if (domain && EXEMPT_EMAIL_DOMAINS.has(domain.toLowerCase())) return true;
  const domainLabel = domain?.split('.')[0];
  if (local && domainLabel && local.length <= 2 && domainLabel.length <= 2) return true;
  return false;
}

function isExemptHostname(match) {
  const lower = match.toLowerCase();
  if (EXEMPT_HOSTNAME_EXACT.has(lower)) return true;
  if (lower.endsWith('.svc.cluster.local')) return true;
  const beforeSuffix = lower.split('.').slice(-2, -1)[0];
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

const SCAN_FIELDS = ['title', 'content', 'wrong', 'correct', 'doc_reference'];

/**
 * @param {object} chunk — a captureFix()-shaped chunk (or the stripped
 *   communityChunk about to become communityChunkJson).
 * @returns {{ ok: boolean, blocking: boolean, findings: Array }}
 */
export function privacyLint(chunk) {
  const findings = [];

  for (const field of SCAN_FIELDS) {
    const text = chunk?.[field];
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
          matches: matches.slice(0, 3),
        });
      }
    }
  }

  const blocking = findings.some((f) => f.severity === 'high');
  return { ok: findings.length === 0, blocking, findings };
}

/**
 * Render findings as the short, model-readable warning block inserted
 * into captureFix()'s actions.upload when blocking findings exist.
 */
export function formatPrivacyWarning(result) {
  const lines = result.findings
    .filter((f) => f.severity === 'high')
    .map((f) => `  [${f.field}] ${f.ruleId}: ${f.message} (found: ${f.matches.join(', ')})`);
  return (
    `⚠ This seed contains likely PII/secrets and should NOT be uploaded as-is:\n` +
    lines.join('\n') +
    `\n\nEdit the flagged field(s) to remove company-specific/internal details, ` +
    `then call capture_fix again (or edit directly in .lodestone/personal-patterns.json ` +
    `and re-run manage-personal.mjs promote).`
  );
}
