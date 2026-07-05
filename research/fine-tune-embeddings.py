#!/usr/bin/env python3
"""
scripts/fine-tune-embeddings.py — Gap A: Domain-Specific Embedding Fine-Tuning

Fine-tunes all-MiniLM-L6-v2 on the Lodestone seed corpus using contrastive
learning, producing a domain model that understands developer antipattern
vocabulary better than the general-purpose base model.

Training data (no sessions required):
  Positive pairs built from each seed's own structure:
    (symptom_text, wrong_approach)   — symptom matches the mistake causing it
    (symptom_text, seed_title)       — title names the antipattern
    (tags_joined, symptom_text)      — tags and symptom describe the same pattern

  If .lodestone/sessions/ has archived sessions with cited_seed_ids:
    (session_query, cited_seed_symptom)  — real developer queries ↔ matching seeds
    (session_query, cited_wrong)         — real queries ↔ wrong approach text

Loss function: MultipleNegativesRankingLoss (MNL)
  Each batch has B positive pairs. The other B-1 pairs act as in-batch negatives.
  Trains the model to rank the true positive above all negatives.
  Standard for bi-encoder fine-tuning (Karpukhin et al., DPR 2020).

Output:
  models/lodestone-embeddings/         HuggingFace format (for inspection)
  models/lodestone-embeddings-onnx/    ONNX format (loaded by embeddings.mjs)

Prerequisites:
  pip install sentence-transformers optimum[exporters] onnx onnxruntime --break-system-packages

Estimated training time:
  ~5 min  on M-series Mac with 5,000 pairs, 3 epochs
  ~15 min on CPU-only with same setup

MIT License — https://github.com/alexbkirby-glitch/lodestone
"""

import os
import re
import sys
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).parent.parent

# ── Dependency check ──────────────────────────────────────────────────────────

def require(pkg, install_hint):
    try:
        __import__(pkg)
    except ImportError:
        print(f"ERROR: '{pkg}' not installed. Run:\n  {install_hint}")
        sys.exit(1)

require('sentence_transformers', 'pip install sentence-transformers --break-system-packages')
require('torch', 'pip install torch --break-system-packages')

from sentence_transformers import SentenceTransformer, InputExample, losses, evaluation
from torch.utils.data import DataLoader

# ── Config ────────────────────────────────────────────────────────────────────

BASE_MODEL  = 'sentence-transformers/all-MiniLM-L6-v2'
OUTPUT_HF   = ROOT / 'models' / 'lodestone-embeddings'
OUTPUT_ONNX = ROOT / 'models' / 'lodestone-embeddings-onnx'
SEEDS_DIR   = ROOT / 'seeds'
SESSIONS_DIR = ROOT / '.lodestone' / 'sessions'

BATCH_SIZE  = 32
EPOCHS      = 3
WARMUP_RATIO = 0.1
MAX_SEQ_LEN  = 256

print(f"\n{'='*60}")
print(' Lodestone Embedding Fine-Tuning')
print(f"{'='*60}")
print(f" Base model:  {BASE_MODEL}")
print(f" Seeds dir:   {SEEDS_DIR}")
print(f" Output:      {OUTPUT_ONNX}\n")

# ── Text extraction ───────────────────────────────────────────────────────────

def extract_parts(content: str) -> dict:
    wrong_m   = re.search(r'WRONG:\s*([\s\S]*?)(?=CORRECT:|Symptom:|$)', content, re.I)
    symptom_m = re.search(r'Symptom:\s*([\s\S]*?)(?=WRONG:|CORRECT:|$)',  content, re.I)
    wrong   = wrong_m.group(1).strip()[:512]   if wrong_m   else ''
    symptom = symptom_m.group(1).strip()[:512] if symptom_m else ''
    return {'wrong': wrong, 'symptom': symptom}

def truncate(text: str, chars: int = 512) -> str:
    return text[:chars].strip() if text else ''

# ── Build training pairs from seeds ──────────────────────────────────────────

print('[1/4] Building training pairs from seed corpus...')

seed_lookup = {}   # id → {symptom, wrong, title, tags}
pairs = []

seed_files = list(SEEDS_DIR.glob('*.json'))
if not seed_files:
    print(f"ERROR: No seed JSON files found in {SEEDS_DIR}")
    sys.exit(1)

for fpath in seed_files:
    try:
        seeds = json.loads(fpath.read_text())
    except Exception as e:
        print(f"  Warning: could not parse {fpath.name}: {e}")
        continue

    for seed in seeds:
        sid     = seed.get('id', '')
        content = seed.get('content', '')
        title   = truncate(seed.get('title', ''), 200)
        tags    = ' '.join(seed.get('tags', []))
        parts   = extract_parts(content)

        if not parts['symptom']:
            continue

        # Store for session-data lookup
        seed_lookup[sid] = {
            'symptom': parts['symptom'],
            'wrong':   parts['wrong'],
            'title':   title,
            'tags':    tags,
        }

        # Pair 1: (symptom, wrong approach) — core retrieval signal
        if parts['wrong']:
            pairs.append(InputExample(texts=[parts['symptom'], parts['wrong']]))

        # Pair 2: (symptom, title) — natural language ↔ antipattern name
        if title:
            pairs.append(InputExample(texts=[parts['symptom'], title]))

        # Pair 3: (tags, symptom) — tags describe the same situation
        if tags:
            pairs.append(InputExample(texts=[tags, parts['symptom']]))

print(f"  {len(seed_lookup)} seeds → {len(pairs)} pairs from corpus")

# ── Augment with session data (when available) ────────────────────────────────

print('[2/4] Augmenting with session archive data...')

session_pairs = 0
if SESSIONS_DIR.exists():
    for session_file in SESSIONS_DIR.glob('*.json'):
        try:
            session = json.loads(session_file.read_text())
            query   = truncate(session.get('query', ''), 512)
            cited   = session.get('cited_seed_ids', [])
            outcome = session.get('outcome', '')

            if not query or not cited or outcome != 'clean':
                continue

            for seed_id in cited[:3]:  # cap per-session contribution
                sd = seed_lookup.get(seed_id)
                if not sd:
                    continue
                # Real developer query ↔ cited seed's symptom (gold positive pair)
                if sd['symptom']:
                    pairs.append(InputExample(texts=[query, sd['symptom']]))
                    session_pairs += 1
                # Real developer query ↔ cited seed's wrong approach
                if sd['wrong']:
                    pairs.append(InputExample(texts=[query, sd['wrong']]))
                    session_pairs += 1
        except Exception:
            continue

print(f"  {session_pairs} additional pairs from {len(list(SESSIONS_DIR.glob('*.json')))} sessions")
print(f"  Total training pairs: {len(pairs)}")

if len(pairs) < 100:
    print("\nWARNING: Very few training pairs. Fine-tuning may not improve the model.")
    print("  Run record_outcome on more sessions to build a richer training set.")

# ── Shuffle and split ─────────────────────────────────────────────────────────

random.shuffle(pairs)
n_eval = min(200, max(10, int(len(pairs) * 0.05)))
eval_pairs  = pairs[:n_eval]
train_pairs = pairs[n_eval:]

print(f"\n  Train: {len(train_pairs)}  Eval: {len(eval_pairs)}")

# ── Load base model and configure training ────────────────────────────────────

print('\n[3/4] Loading base model and training...')
print(f"  Model: {BASE_MODEL}")

model = SentenceTransformer(BASE_MODEL)
model.max_seq_length = MAX_SEQ_LEN

train_dataloader = DataLoader(train_pairs, shuffle=True, batch_size=BATCH_SIZE)
train_loss       = losses.MultipleNegativesRankingLoss(model)

# Evaluator: information retrieval metrics on held-out pairs
eval_anchors    = [e.texts[0] for e in eval_pairs]
eval_positives  = [e.texts[1] for e in eval_pairs]
evaluator = evaluation.EmbeddingSimilarityEvaluator(
    sentences1=eval_anchors,
    sentences2=eval_positives,
    scores=[1.0] * len(eval_pairs),  # all are positives
    name='lodestone-eval',
)

warmup_steps = math.ceil(len(train_dataloader) * EPOCHS * WARMUP_RATIO)

print(f"  Epochs: {EPOCHS}  Batch: {BATCH_SIZE}  Warmup: {warmup_steps} steps")
print(f"  Steps per epoch: {len(train_dataloader)}\n")

OUTPUT_HF.parent.mkdir(parents=True, exist_ok=True)

model.fit(
    train_objectives=[(train_dataloader, train_loss)],
    evaluator=evaluator,
    epochs=EPOCHS,
    warmup_steps=warmup_steps,
    evaluation_steps=max(50, len(train_dataloader) // 4),
    output_path=str(OUTPUT_HF),
    save_best_model=True,
    show_progress_bar=True,
)

print(f"\n  ✓ Fine-tuned model saved to {OUTPUT_HF}")

# ── Export to ONNX (for @xenova/transformers) ─────────────────────────────────

print('\n[4/4] Exporting to ONNX format...')

try:
    from optimum.exporters.onnx import main_export
    OUTPUT_ONNX.mkdir(parents=True, exist_ok=True)
    main_export(
        model_name_or_path=str(OUTPUT_HF),
        output=str(OUTPUT_ONNX),
        task='feature-extraction',
        opset=17,
        optimize='O2',   # quantize + optimize for inference
    )
    print(f"  ✓ ONNX model saved to {OUTPUT_ONNX}")
    onnx_ok = True
except ImportError:
    print("  optimum not available. Run: pip install optimum[exporters] onnx")
    print("  Then re-run: python scripts/fine-tune-embeddings.py --onnx-only")
    onnx_ok = False
except Exception as e:
    print(f"  ONNX export failed: {e}")
    onnx_ok = False

# ── Summary ───────────────────────────────────────────────────────────────────

print(f"\n{'='*60}")
print(' Fine-tuning complete')
print(f"{'='*60}")

if onnx_ok:
    print(f"""
The domain-tuned model is ready. Lodestone's embeddings.mjs will
automatically detect and use it on the next lookup_symptom call.

  Domain model: {OUTPUT_ONNX}

No code changes needed — the model path is checked at startup.

To verify the improvement, run:
  npm run metrics:baseline    (before)
  npm run build:embeddings    (rebuild seed vectors with domain model)
  npm run metrics:compare     (after, once you have new session data)
""")
else:
    print(f"""
HuggingFace model saved at: {OUTPUT_HF}

To complete the ONNX export manually:
  pip install optimum[exporters] onnx onnxruntime --break-system-packages
  optimum-cli export onnx \\
    --model {OUTPUT_HF} \\
    --task feature-extraction \\
    {OUTPUT_ONNX}

Then rebuild seed embeddings with the domain model:
  npm run build:embeddings
""")
