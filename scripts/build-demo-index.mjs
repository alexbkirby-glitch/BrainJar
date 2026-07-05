#!/usr/bin/env node
/**
 * scripts/build-demo-index.mjs — slim seed index for the browser demo
 *
 * Emits api/demo-index.json: the minimum fields demo.html needs to run
 * BM25-lite symptom lookup client-side (same scoring math as the MCP
 * server's lookup_symptom — the demo IS the tool, minus the install).
 *
 * Privacy-gated per SCHEMA.md MUST-4 (output ships on GitHub Pages), and
 * fields are trimmed hard: this is a demo index, not a corpus mirror —
 * the full seeds stay in seeds/*.json.
 *
 * Wired into .github/workflows/deploy.yml; also committed so the repo
 * works without Actions.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuralLint } from '../lib/seed-schema.mjs';
import { privacyLint } from '../lib/privacy-lint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS_DIR = path.join(ROOT, 'seeds');
const OUT = path.join(ROOT, 'api', 'demo-index.json');
const TRIM = 280;

const trim = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > TRIM ? t.slice(0, TRIM - 1) + '…' : t;
};

const CONTENT_SHAPE = /WRONG:\s*(.+?)\s*CORRECT:\s*(.+?)\s*Symptom:\s*(.+)$/s;

const entries = [];
let skipped = 0;
for (const fname of fs.readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.json'))) {
  let seeds;
  try { seeds = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, fname), 'utf8')); } catch { continue; }
  if (!Array.isArray(seeds)) continue;
  const stack = fname.replace(/\.json$/, '');
  for (const raw of seeds) {
    const seed = { ...raw };
    if (seed.source === undefined) seed.source = 'community';
    if ((!seed.wrong || !seed.correct || !seed.symptom) && typeof seed.content === 'string') {
      const m = seed.content.match(CONTENT_SHAPE);
      if (m) { seed.wrong ??= m[1]; seed.correct ??= m[2]; seed.symptom ??= m[3]; }
    }
    if (!structuralLint(seed).ok) { skipped++; continue; }
    if (privacyLint(seed).blocking) { skipped++; continue; }
    if (seed.deprecated === true) { skipped++; continue; }
    entries.push({
      id: seed.id,
      k: stack,                    // short keys: this file ships to browsers
      t: trim(seed.title ?? seed.id.replace(/_/g, ' ')),
      w: trim(seed.wrong),
      c: trim(seed.correct),
      s: trim(seed.symptom),
      g: (seed.tags ?? []).slice(0, 8),
      b: seed.blast_radius,
    });
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), count: entries.length, seeds: entries }));
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`✓ api/demo-index.json — ${entries.length} seeds (${skipped} skipped), ${kb} KB raw`);
