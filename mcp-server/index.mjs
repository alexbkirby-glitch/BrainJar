#!/usr/bin/env node
/**
 * Brain Jar MCP Server (Chunk E — trimmed surface)
 *
 * The slim replacement for the 44-tool Lodestone server, which lives on
 * untouched as ./index.legacy.mjs pending the Chunk H archive decision.
 * Library, not brain: capture, validate, publish, discover, graze — plus a
 * lightweight read surface so a consuming brain can pull seeds live over
 * MCP (decision 5) without Brain Jar hauling around a retrieval engine.
 *
 * Nine tools:
 *   capture_seed     — author a full-schema seed into seeds/personal/captured.json
 *   capture_fix      — in-session bug-fix reflex → .lodestone/personal-patterns.json
 *                      (privacy-gated community-upload path; Section 0 ruling:
 *                      different job than capture_seed, both survive)
 *   validate_schema  — structural + privacy lint seeds, or validate the manifest
 *   publish          — generate brain-jar-manifest.json (privacy hard gate)
 *   list_jars        — GitHub topic-search discovery of Public Jars
 *   graze            — trigger the offline batch grazer + review queue
 *   get_seed         — all seeds for a stack (text = injectable, json = structured)
 *   list_stacks      — enumerate local stacks incl. _personal
 *   lookup_symptom   — BM25-lite symptom search (no embedding stack loaded)
 *
 * Config block (same shape as before — path unchanged, so existing
 * mcpServers entries keep working):
 * {
 *   "brain-jar": {
 *     "command": "node",
 *     "args": ["/path/to/brain-jar/mcp-server/index.mjs"]
 *   }
 * }
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  captureSeedTool, captureFix, validateSchema, publish, listJars, graze,
  getSeed, listStacks, lookupSymptom, ROOT,
} from './tools.mjs';

const server = new McpServer({ name: 'brain-jar', version: '2.0.0' });

const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// ── Supply side ───────────────────────────────────────────────────────────────

server.tool(
  'capture_seed',
  'Author a new antipattern seed (full canonical schema) from live session context. ' +
  'Structural lint is a hard gate; privacy lint is advisory here and a hard gate at publish. ' +
  'Stages into seeds/personal/captured.json — never touches the network.',
  {
    id: z.string().optional().describe('lowercase snake_case id — derived from wrong if omitted'),
    stack: z.string().describe('Technology stack, e.g. "react", "python"'),
    wrong: z.string().describe('The incorrect approach/pattern'),
    correct: z.string().describe('The corrected approach'),
    symptom: z.string().describe('The observable failure/error a developer would see'),
    blast_radius: z.enum(['low', 'medium', 'high', 'critical']),
    source: z.string().optional().describe('Provenance, defaults to "personal"'),
    tags: z.array(z.string()).optional().describe('3-6 retrieval terms a stressed developer would type'),
    doc_reference: z.string().nullable().optional().describe('URL to official docs supporting the fix'),
    domain: z.string().optional(),
    facet: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  },
  async (args) => json(await captureSeedTool({ source: 'personal', ...args }))
);

server.tool(
  'capture_fix',
  'After fixing a bug, call this to save the pattern to your Jar. ' +
  'Presents options: upload to community (privacy-gated), apply fix to code, or keep locally.',
  {
    stack: z.string().describe('Technology stack, e.g. "react", "python"'),
    error_observed: z.string().describe('The exact error or symptom you saw'),
    wrong_approach: z.string().describe('What the code was doing incorrectly'),
    correct_approach: z.string().describe('The corrected code or approach'),
    blast_radius: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    file_path: z.string().optional().describe('Path to the file to fix (for the implement option)'),
    tags: z.array(z.string()).optional(),
    title: z.string().optional().describe('Seed title ≤8 words. Auto-generated if omitted.'),
    doc_reference: z.string().optional().describe('URL to official docs supporting the fix'),
    force: z.boolean().optional().describe('Skip duplicate detection and save anyway (default false)'),
  },
  async (args) => json(await captureFix(args))
);

server.tool(
  'validate_schema',
  'Lint seed object(s) against the canonical Brain Jar schema (structural + privacy), ' +
  'or validate this Jar\'s brain-jar-manifest.json (mode: "manifest").',
  {
    mode: z.enum(['seed', 'manifest']).optional().describe('default "seed"'),
    seed: z.record(z.any()).optional().describe('A single seed object to lint'),
    seeds: z.array(z.record(z.any())).optional().describe('Multiple seed objects to lint'),
  },
  async (args) => json(validateSchema(args))
);

server.tool(
  'publish',
  'Generate/refresh brain-jar-manifest.json for this Jar. Privacy lint hard-blocks by default. ' +
  'Returns the tagging instructions that turn this into a Public Jar (tagging IS consent).',
  {
    check: z.boolean().optional().describe('Validate only, never write (default false)'),
    jarName: z.string().optional().describe('Override jar_name (defaults to repo dir name)'),
    force: z.boolean().optional().describe('Write despite privacy violations — NOT recommended for public Jars'),
  },
  async (args) => json(await publish(args))
);

server.tool(
  'list_jars',
  'Discover Public Jars via GitHub topic search and read each one\'s manifest ' +
  '(jar name, seed count, stacks, last-updated, schema compatibility). Discovery only — grazing is the graze tool.',
  {
    topic: z.string().optional().describe('GitHub topic to search (default "brain-jar")'),
    maxJars: z.number().int().min(1).max(100).optional(),
  },
  async (args) => json(await listJars(args))
);

server.tool(
  'graze',
  'Run the offline batch grazer: discover Public Jars, fetch + shallow-score their seeds against ' +
  'this Jar\'s declared metadata, stage candidates, and build the human review queue. ' +
  'NEVER auto-merges. Set GITHUB_TOKEN to avoid the 60 req/hr unauthenticated limit.',
  {
    topic: z.string().optional(),
    maxJars: z.number().int().min(1).max(100).optional(),
    profile: z.string().optional().describe('Local profile to score against (profiles.json)'),
    localFixture: z.string().optional().describe('Directory of {owner}__{repo}/ fixtures — skip GitHub entirely (testing)'),
    dupThreshold: z.number().min(0).max(1).optional().describe('Duplicate-flag Jaccard threshold (default 0.45)'),
  },
  async (args) => json(await graze(args))
);

// ── Demand side (the read surface a consuming brain calls) ───────────────────

server.tool(
  'get_seed',
  'Get all seeds for a stack. Text format is directly injectable; json for structured access.',
  { stack: z.string(), format: z.enum(['text', 'json']).optional() },
  async ({ stack, format }) => {
    const result = getSeed(stack, format ?? 'text');
    return { content: [{ type: 'text', text: format === 'json' ? JSON.stringify(result, null, 2) : (result.content ?? JSON.stringify(result, null, 2)) }] };
  }
);

server.tool(
  'list_stacks',
  'List all available stacks in this Jar. Includes personal patterns as the _personal virtual stack.',
  { query: z.string().optional() },
  async ({ query }) => json(listStacks(query))
);

server.tool(
  'lookup_symptom',
  'Find seeds matching an error/symptom. BM25-lite (token idf + tag overlap) — deliberately shallow; ' +
  'a consuming brain\'s own retrieval is the deep path for imported seeds.',
  {
    error_text: z.string().describe('The error message or symptom, as seen'),
    stack: z.string().optional().describe('Restrict to one stack'),
    limit: z.number().int().min(1).max(20).optional().describe('Max results (default 5)'),
  },
  async ({ error_text, stack, limit }) => json(lookupSymptom(error_text, { stack: stack ?? null, limit: limit ?? 5 }))
);

// ── Transport ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[Brain Jar] MCP server ready — 9 tools (library, not brain). Jar root: ${ROOT}`);
