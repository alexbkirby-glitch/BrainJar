#!/usr/bin/env node
/**
 * scripts/build-registry.mjs — Chunk I: the Public Jar registry
 *
 * Discovers Public Jars via GitHub topic search (same lib/discover-jars.mjs
 * the grazer and list_jars use — one discovery implementation, three call
 * sites), reads each Jar's manifest, and renders a static registry:
 *
 *   registry.json — machine-readable (other tools can build on it)
 *   registry.html — human-readable Pages page, styled to match the site
 *
 * The registry IS the attribution reward (grill-session decision: being
 * listed is the payoff for tagging public) and the discovery layer. It also
 * renders the flagship corpus's stack inventory with "wants a maintainer"
 * callout slots, driven by the owner-curated maintainers-wanted.json —
 * curated file, not invented signals.
 *
 * $0 by construction: static output, GitHub Actions free tier
 * (.github/workflows/registry.yml, weekly cron + manual), no server.
 * Cold-start honest: zero jars renders a "be the first" section, not a
 * fake directory.
 *
 * Usage:
 *   node scripts/build-registry.mjs                # live GitHub search
 *   node scripts/build-registry.mjs --topic=X      # alternate topic
 *   node scripts/build-registry.mjs --offline      # skip GitHub (local-only rebuild)
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPublicJars, fetchAndValidateManifest, DEFAULT_TOPIC } from '../lib/discover-jars.mjs';
import { MANIFEST_FILENAME } from '../lib/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS_DIR = path.join(ROOT, 'seeds');
const WANTED_FILE = path.join(ROOT, 'maintainers-wanted.json');
const OUT_JSON = path.join(ROOT, 'registry.json');
const OUT_HTML = path.join(ROOT, 'registry.html');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function localStackInventory() {
  return fs.readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const stack = f.replace(/\.json$/, '');
      try {
        const seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, f), 'utf8'));
        return { stack, seeds: Array.isArray(seeds) ? seeds.length : 0 };
      } catch { return { stack, seeds: 0 }; }
    })
    .sort((a, b) => a.stack.localeCompare(b.stack));
}

function maintainersWanted() {
  try {
    const data = JSON.parse(fs.readFileSync(WANTED_FILE, 'utf8'));
    return new Map((data.stacks ?? []).map((w) => [w.stack, w.note ?? '']));
  } catch { return new Map(); }
}

async function discover(topic) {
  if (flag('offline')) return { jars: [], offline: true };
  try {
    const found = await discoverPublicJars(topic, 100);
    const jars = [];
    for (const jar of found) {
      const { manifest, skip } = await fetchAndValidateManifest(jar);
      if (skip) { console.error(`  skip ${jar.owner}/${jar.repo}: ${skip}`); continue; }
      jars.push({
        owner: jar.owner,
        repo: jar.repo,
        url: `https://github.com/${jar.owner}/${jar.repo}`,
        jar_name: manifest.jar_name,
        seed_count: manifest.seed_count,
        stacks: manifest.stacks ?? [],
        domains: manifest.domains ?? [],
        last_updated: manifest.last_updated ?? null,
        schema_version: manifest.schema_version,
      });
    }
    return { jars, offline: false };
  } catch (e) {
    console.error(`Discovery failed (${e.message}) — rendering with zero jars; last committed registry.json remains authoritative until next successful run.`);
    return { jars: [], offline: false, error: e.message };
  }
}

function renderHtml({ topic, jars, stacks, wanted, generated }) {
  const wantedCount = [...wanted.keys()].filter((s) => stacks.some((x) => x.stack === s)).length;
  const jarRows = jars.map((j) => `
      <tr>
        <td><a href="${esc(j.url)}">${esc(j.jar_name)}</a><span class="dim"> ${esc(j.owner)}/${esc(j.repo)}</span></td>
        <td class="num">${j.seed_count}</td>
        <td>${j.stacks.slice(0, 8).map((s) => `<span class="tag">${esc(s)}</span>`).join(' ')}${j.stacks.length > 8 ? `<span class="dim"> +${j.stacks.length - 8}</span>` : ''}</td>
        <td class="dim">${esc(j.last_updated ?? '—')}</td>
        <td class="num dim">v${esc(j.schema_version)}</td>
      </tr>`).join('');

  const stackCells = stacks.map(({ stack, seeds }) => {
    const w = wanted.has(stack);
    return `<div class="stack${w ? ' wanted' : ''}" ${w ? `title="${esc(wanted.get(stack) || 'This stack wants a maintainer')}"` : ''}>
      <span class="stack-name">${esc(stack)}</span><span class="stack-count">${seeds}</span>${w ? '<span class="badge">wants a maintainer</span>' : ''}
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brain Jar — Public Jar Registry</title>
<meta name="description" content="Registry of Public Brain Jars: decentralized antipattern seed libraries discoverable via the ${esc(topic)} GitHub topic.">
<style>
  :root {
    --bg: #f5f4f0; --bg2: #ffffff; --bg3: #eceae5;
    --border: #dddbd5; --border2: #c8c5be;
    --text: #1a1917; --muted: #5c5a54; --dim: #64615e;
    --accent: #97651f; --accent2: #7a4a10; --green: #2a6e46; --red: #8a2828;
    --mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--mono); font-size: 14px; line-height: 1.55; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 20px; letter-spacing: 0.04em; }
  h1 .dim, .dim { color: var(--dim); font-weight: normal; }
  h2 { font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); margin-top: 44px; }
  a { color: var(--accent2); }
  table { width: 100%; border-collapse: collapse; background: var(--bg2); border: 1px solid var(--border); }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); background: var(--bg3); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .tag { display: inline-block; background: var(--bg3); border: 1px solid var(--border); border-radius: 3px; padding: 0 5px; font-size: 12px; margin: 1px 0; }
  .cold { background: var(--bg2); border: 1px dashed var(--border2); padding: 18px 20px; }
  .cold code { background: var(--bg3); padding: 1px 5px; border-radius: 3px; }
  .stacks { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; }
  .stack { display: flex; align-items: baseline; gap: 8px; background: var(--bg2); border: 1px solid var(--border); padding: 5px 9px; }
  .stack-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stack-count { margin-left: auto; color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
  .stack.wanted { border-color: var(--accent); }
  .badge { display: block; width: 100%; color: var(--accent2); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
  .stack.wanted { flex-wrap: wrap; }
  footer { margin-top: 56px; color: var(--dim); font-size: 12px; border-top: 1px solid var(--border); padding-top: 14px; }
</style>
</head>
<body>
<main>
  <h1>Brain Jar <span class="dim">— Public Jar Registry</span></h1>
  <p>Public Jars are GitHub repos of <a href="SCHEMA.md">canonical antipattern seeds</a> tagged with the
  <code>${esc(topic)}</code> topic. Tagging is the consent act: it makes a Jar discoverable here and
  grazeable by anyone. Being listed is the attribution reward.
  <a href="demo.html">Try the corpus in your browser</a> — paste an error, no install.</p>

  <h2>Public Jars (${jars.length})</h2>
${jars.length === 0 ? `
  <div class="cold">
    <strong>No Public Jars tagged yet — be the first.</strong><br><br>
    1. Keep your seeds in <code>seeds/&lt;stack&gt;.json</code> per <a href="SCHEMA.md">SCHEMA.md</a><br>
    2. Run <code>npm run publish</code> to generate a privacy-gated <code>${esc(MANIFEST_FILENAME)}</code><br>
    3. Add the <code>${esc(topic)}</code> topic to your GitHub repo<br><br>
    The next scheduled registry build will list you here.
  </div>` : `
  <table>
    <thead><tr><th>Jar</th><th class="num">Seeds</th><th>Stacks</th><th>Updated</th><th class="num">Schema</th></tr></thead>
    <tbody>${jarRows}
    </tbody>
  </table>`}

  <h2>Flagship corpus — ${stacks.length} stacks${wantedCount ? ` <span class="dim">(${wantedCount} want a maintainer)</span>` : ''}</h2>
  <p class="dim">Seed counts from the flagship Jar this registry is built from. Stacks marked
  <span class="badge" style="display:inline">wants a maintainer</span> are open callout slots —
  claim one by opening an issue.</p>
  <div class="stacks">
${stackCells}
  </div>

  <footer>
    Generated ${esc(generated)} by <code>scripts/build-registry.mjs</code> ·
    <a href="registry.json">registry.json</a> ·
    <a href="https://github.com/alexbkirby-glitch/lodestone">source</a> ·
    rebuilt weekly by GitHub Actions
  </footer>
</main>
</body>
</html>
`;
}

async function main() {
  const topic = value('topic') ?? DEFAULT_TOPIC;
  const { jars, offline, error } = await discover(topic);
  const stacks = localStackInventory();
  const wanted = maintainersWanted();
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  const registry = {
    topic,
    generated_at: new Date().toISOString(),
    jar_count: jars.length,
    jars,
    flagship: {
      stack_count: stacks.length,
      seed_count: stacks.reduce((s, x) => s + x.seeds, 0),
      stacks,
      maintainers_wanted: [...wanted.entries()].map(([stack, note]) => ({ stack, note })),
    },
    ...(offline ? { offline: true } : {}),
    ...(error ? { discovery_error: error } : {}),
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(registry, null, 2));
  fs.writeFileSync(OUT_HTML, renderHtml({ topic, jars, stacks, wanted, generated }));
  console.log(`✓ registry.json (${jars.length} jar(s)) + registry.html (${stacks.length} flagship stacks, ${wanted.size} maintainer callout(s))`);
}

main();
