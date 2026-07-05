/**
 * lib/discover-jars.mjs — shared Public Jar discovery (Chunk E extraction)
 *
 * Extracted verbatim from scripts/graze.mjs (Chunk C) so the slim MCP
 * server's `list_jars` tool and the offline grazer share ONE implementation
 * of decision 1's design: Public Jars are GitHub repos, discovery is topic
 * search, fetching is the GitHub API. graze.mjs now imports from here —
 * do not fork this logic back into either call site.
 *
 * Rate-limit note (grill-session Chunk C): unauthenticated GitHub API is
 * 60 req/hr. Set GITHUB_TOKEN to raise it; everything here degrades
 * gracefully without one.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import { validateManifest, MANIFEST_FILENAME } from './manifest.mjs';
import { isSchemaVersionCompatible } from './seed-schema.mjs';

export const DEFAULT_TOPIC = 'brain-jar'; // cold-start: nothing tagged yet — see graze.mjs header

export function githubToken() {
  return process.env.GITHUB_TOKEN || null;
}

export async function githubFetch(url) {
  const token = githubToken();
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'brain-jar-graze',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining !== null && Number(remaining) < 5) {
    console.error(`⚠ GitHub API rate limit nearly exhausted (${remaining} remaining). Set GITHUB_TOKEN to raise the limit.`);
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}

/** Step 1: discovery via GitHub topic search. */
export async function discoverPublicJars(topic, maxJars) {
  const url = `https://api.github.com/search/repositories?q=topic:${encodeURIComponent(topic)}&per_page=${Math.min(maxJars, 100)}`;
  const data = await githubFetch(url);
  return (data.items || []).map((r) => ({ owner: r.owner.login, repo: r.name, defaultBranch: r.default_branch || 'main' }));
}

/** Step 2: fetch + validate a Jar's manifest. Returns { jar, skip } (skip non-null) if incompatible/missing/malformed. */
export async function fetchAndValidateManifest(jar) {
  const url = `https://raw.githubusercontent.com/${jar.owner}/${jar.repo}/${jar.defaultBranch}/${MANIFEST_FILENAME}`;
  let manifest;
  try {
    const res = await fetch(url);
    if (!res.ok) return { jar, skip: `no ${MANIFEST_FILENAME} found (${res.status})` };
    manifest = await res.json();
  } catch (e) {
    return { jar, skip: `fetch failed: ${e.message}` };
  }

  const { ok, errors } = validateManifest(manifest);
  if (!ok) return { jar, skip: `malformed manifest: ${errors.join('; ')}` };

  if (!isSchemaVersionCompatible(manifest.schema_version)) {
    return { jar, skip: `incompatible schema_version ${manifest.schema_version} (this grazer supports N/N-1)` };
  }

  return { jar, manifest, skip: null };
}

/** Step 3: fetch seeds/<stack>.json for each stack the manifest declares. */
export async function fetchStackSeeds(jar, stack) {
  const url = `https://raw.githubusercontent.com/${jar.owner}/${jar.repo}/${jar.defaultBranch}/seeds/${stack}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
