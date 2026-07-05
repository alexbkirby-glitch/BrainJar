/**
 * mcp-server/connectors/markdown-dir.mjs — Phase 7: Markdown / Text Directory Connector
 *
 * Indexes a directory of .md/.txt files by splitting on headings and paragraph
 * boundaries, embedding each chunk with the Phase 1 model, and writing to
 * api/datasource-index/{source_id}.json.
 *
 * At query time, embeds the query and returns top-k chunks by cosine similarity.
 *
 * MIT License — https://github.com/alexbkirby-glitch/lodestone
 */

import fs   from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// ── File discovery ────────────────────────────────────────────────────────
// Lightweight recursive glob without external dependency.

function walkDir(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, exts, out);
    } else if (exts.some(e => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// ── Text chunking ──────────────────────────────────────────────────────────
// Splits on heading boundaries first, then on paragraph breaks.
// Respects maxChars to keep chunks within the embedding model's token budget.

export function chunkText(text, { maxChars = 1400, overlap = 200 } = {}) {
  const chunks = [];
  // Split on H1-H3 headings (ATX style)
  const sections = text.split(/^#{1,3}\s+/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // First line = heading (unless it's the preamble before any heading)
    const lines = trimmed.split('\n');
    const heading = lines[0].length < 120 ? lines[0].trim() : '';
    const body = heading ? lines.slice(1).join('\n').trim() : trimmed;

    // Split into paragraphs
    const paragraphs = body.split(/\n\n+/).filter(p => p.trim().length > 20);
    let buf = heading ? `${heading}\n` : '';

    for (const para of paragraphs) {
      if ((buf + para).length > maxChars && buf.trim()) {
        chunks.push({ heading, text: buf.trim() });
        // Overlap: carry forward last `overlap` chars
        buf = buf.slice(-overlap) + '\n' + para;
      } else {
        buf += (buf ? '\n\n' : '') + para;
      }
    }
    if (buf.trim()) chunks.push({ heading, text: buf.trim() });
  }
  return chunks;
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// Gap 1: Contextual chunking — prepend the document heading chain to the
// embedding text so the vector captures where the chunk sits in the document.
// The stored `text` remains the raw chunk (clean for injection); only the
// `embedding_text` receives the contextual prefix (better retrieval).
// This approximates "late chunking" without requiring token-level hidden states.
function contextualEmbeddingText(chunkText, heading, filePath, dirPath) {
  const relPath = path.relative(dirPath, filePath);
  const docName = path.basename(filePath, path.extname(filePath))
    .replace(/[-_]/g, ' ');
  const prefix = [docName, heading].filter(Boolean).join(' › ');
  return prefix ? `${prefix}\n\n${chunkText}` : chunkText;
}

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ── Indexing ───────────────────────────────────────────────────────────────

/**
 * index(sourceConfig, embedFn, existingIndex)
 *
 * Walks the configured directory, chunks each file, embeds unchanged chunks
 * using embedFn, and returns the updated chunk index.
 * Incremental: chunks whose content hash matches the existing index are reused.
 */
export async function index(sourceConfig, embedFn, existingIndex = []) {
  const {
    id,
    path: dirPath,
    index_patterns,
    chunk_size:    maxChars  = 1400,
    chunk_overlap: overlap   = 200,
  } = sourceConfig;

  const exts = (index_patterns ?? ['**/*.md', '**/*.txt'])
    .map(p => path.extname(p))
    .filter(Boolean);
  const extsDedup = [...new Set(exts.length ? exts : ['.md', '.txt'])];

  const files = walkDir(dirPath, extsDedup);
  if (!files.length) return [];

  // Build a hash → existing-entry map for incremental updates
  const byHash = Object.fromEntries(existingIndex.map(e => [e.hash, e]));

  const toEmbed  = [];
  const reused   = [];
  const allMeta  = [];

  for (const filePath of files) {
    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { continue; }

    const fileChunks = chunkText(text, { maxChars, overlap });
    for (let i = 0; i < fileChunks.length; i++) {
      const { heading, text: chunkText_ } = fileChunks[i];
      const chunkHash = hash(chunkText_);
      const embText   = contextualEmbeddingText(chunkText_, heading, filePath, dirPath);
      const chunkId   = `${id}::${path.relative(dirPath, filePath)}::${i}`;

      const meta = {
        chunk_id:       chunkId,
        source_id:      id,
        text:           chunkText_,      // clean chunk text — used for injection
        embedding_text: embText,         // contextual prefix — used for embedding
        hash:           chunkHash,
        metadata: {
          path:    filePath,
          heading: heading || path.basename(filePath, path.extname(filePath)),
          index:   i,
        },
      };

      if (byHash[chunkHash]) {
        reused.push({ ...meta, vector: byHash[chunkHash].vector });
      } else {
        toEmbed.push(meta);
      }
      allMeta.push(meta);
    }
  }

  process.stderr.write(
    `[markdown-dir:${id}] ${files.length} files → ${allMeta.length} chunks ` +
    `(${reused.length} reused, ${toEmbed.length} to embed)\n`
  );

  if (!embedFn || !toEmbed.length) {
    return [...reused, ...toEmbed.map(m => ({ ...m, vector: null }))];
  }

  const BATCH = 16;
  const fresh = [];
  for (let i = 0; i < toEmbed.length; i += BATCH) {
    const batch = toEmbed.slice(i, i + BATCH);
    process.stderr.write(`[markdown-dir:${id}] embedding ${i + 1}–${Math.min(i + BATCH, toEmbed.length)} / ${toEmbed.length}\r`);
    // Use embedding_text (contextual prefix) for the vector — better retrieval
    const vecs = await embedFn(batch.map(b => b.embedding_text ?? b.text));
    for (let j = 0; j < batch.length; j++) {
      fresh.push({ ...batch[j], vector: vecs ? vecs[j] : null });
    }
  }
  if (toEmbed.length) process.stderr.write('\n');

  // Return in original file order
  const byChunkId = Object.fromEntries([...reused, ...fresh].map(e => [e.chunk_id, e]));
  return allMeta.map(m => byChunkId[m.chunk_id] ?? { ...m, vector: null });
}

// ── Query ──────────────────────────────────────────────────────────────────

/**
 * query(sourceConfig, queryText, topK, chunkIndex, embedFn)
 *
 * Returns the topK most similar chunks to queryText by cosine similarity.
 * Returns [] when no vectors exist (not yet indexed) — graceful degradation.
 */
export async function query(sourceConfig, queryText, topK, chunkIndex, embedFn) {
  if (!chunkIndex?.length || !embedFn) return [];
  const vecs = await embedFn([queryText]);
  if (!vecs?.[0]) return [];
  const qVec = vecs[0];

  return chunkIndex
    .filter(c => c.vector?.length)
    .map(c => ({ ...c, score: dotProduct(qVec, c.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
