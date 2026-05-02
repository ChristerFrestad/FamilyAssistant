// Receipt service (Iteration 2)
//
// Responsibilities:
//   1. Save uploaded receipt to disk with sha256 for idempotency
//   2. Run OCR (Tesseract) against the file to get raw text
//   3. Pass the text through the LLM (qwen2.5:3b) and structure into lines
//   4. Write 'pending' receipt + items to DB
//   5. On confirmation: update inventory + price references
//
// Design choices:
//   - OCR backend is pluggable (ocrAdapter). Default uses 'tesseract' via
//     child_process. If Tesseract is not installed, fall back to a
//     "null OCR" that only saves the file and marks status='failed'.
//   - LLM call is best-effort. If the model fails or JSON does not parse,
//     we save at least one receipt_item per OCR line with low confidence
//     so the user can fix it in review.
//   - sha256 is UNIQUE in receipts → same file uploaded twice returns the
//     existing row instead of duplicating.
//   - The file is saved at data/receipts/YYYY-MM/<sha256>.<ext>. The
//     directory is created on demand.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const { logger } = require('../logger');
const { llmChat, OLLAMA_MODEL } = require('../llm');
const { lookupPrice } = require('./price-reference.service');
const { addToPantry } = require('./pantry.service');

const execFileAsync = promisify(execFile);

// ============================================================
// File storage
// ============================================================

const RECEIPTS_ROOT =
  process.env.RECEIPTS_DIR || path.join(__dirname, '..', '..', 'data', 'receipts');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function extForMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function saveFile(buffer, mimeType) {
  const hash = sha256(buffer);
  const yyyymm = new Date().toISOString().slice(0, 7);
  const subdir = path.join(RECEIPTS_ROOT, yyyymm);
  ensureDir(subdir);
  const filePath = path.join(subdir, `${hash}.${extForMime(mimeType)}`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, buffer);
  }
  return { filePath, sha256: hash, sizeBytes: buffer.length };
}

// ============================================================
// OCR adapter
// ============================================================

/**
 * Default adapter: uses the Tesseract CLI (`tesseract <file> - -l nor`).
 * Returns { text, engine } or throws.
 */
async function tesseractOcr(filePath) {
  const { stdout } = await execFileAsync('tesseract', [filePath, '-', '-l', 'nor+eng'], {
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { text: stdout || '', engine: 'tesseract' };
}

/**
 * Fallback adapter for testing. Reads nothing but returns a structured
 * "empty" output so the call chain can be tested without Tesseract
 * installed.
 */
async function nullOcr() {
  return { text: '', engine: 'null' };
}

async function isOcrAvailable() {
  try {
    await execFileAsync('tesseract', ['--version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// LLM extraction
// ============================================================
//
// NOTE: RECEIPT_SYSTEM_PROMPT below is deliberately Norwegian — it
// instructs the LLM to respond in Norwegian for Norwegian receipts.
// This is functional content, not developer-facing text.

const RECEIPT_SYSTEM_PROMPT = `Du er en assistent som leser norske dagligvare-kvitteringer.
Gitt rå OCR-tekst, returner JSON med denne strukturen:
{
  "merchant": "Kiwi",
  "purchasedAt": "2026-04-05",
  "totalNok": 432.50,
  "items": [
    { "name": "Tine lettmelk 1L", "qty": 2, "unit": "l", "totalPrice": 42.80, "discount": 0 }
  ]
}
Regler:
- Normaliser varenavn til beskrivende norsk.
- qty = antall enheter (bruk 1 hvis uklart).
- unit = 'stk' | 'kg' | 'g' | 'l' | 'ml' (bruk 'stk' hvis uklart).
- Hopp over pant, bonus, totallinje, moms, avrunding.
- Svar KUN med JSON, ingen kommentar.`;

/**
 * Send OCR text to the LLM and parse the JSON response.
 * Returns a structured receipt object or { error, raw }.
 */
async function extractReceiptFromText(rawText, { signal } = {}) {
  if (!rawText || rawText.trim().length < 5) {
    return { error: 'Empty or too short OCR text', raw: rawText };
  }
  try {
    const result = await llmChat(
      [
        { role: 'system', content: RECEIPT_SYSTEM_PROMPT },
        { role: 'user', content: `Tekst fra kvittering:\n\n${rawText.slice(0, 4000)}` },
      ],
      { temperature: 0.1, maxTokens: 1024, signal }
    );

    const match = (result.content || '').match(/\{[\s\S]*\}/);
    if (!match) {
      return { error: 'No JSON in LLM response', raw: result.content };
    }
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.items)) parsed.items = [];
    return parsed;
  } catch (err) {
    return { error: err.message };
  }
}

// ============================================================
// Product matching
// ============================================================

/**
 * Match an LLM-supplied name against existing products via simple name
 * search. Returns { productKey, confidence } or
 * { productKey: null, confidence: 0 }.
 *
 * Heuristic:
 *   - Normalise name (lowercase, strip pack size)
 *   - Search by product_name / key
 *   - Pick the best hit if the name shares at least one main word with
 *     the product
 */
function matchProductByName(repos, name) {
  if (!name) return { productKey: null, confidence: 0 };
  const norm = name
    .toLowerCase()
    .replace(/\d+\s*(g|kg|l|ml|stk)\b/g, '')
    .trim();
  const words = norm.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return { productKey: null, confidence: 0 };

  const products = repos.products.search ? repos.products.search(norm, 5) : [];
  if (!products || products.length === 0) return { productKey: null, confidence: 0 };

  // Rank by number of word overlaps
  let best = null;
  let bestScore = 0;
  for (const p of products) {
    const pname = (p.productName || p.product_name || '').toLowerCase();
    let score = 0;
    for (const w of words) if (pname.includes(w)) score++;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  if (!best || bestScore === 0) return { productKey: null, confidence: 0 };
  return {
    productKey: best.key || best.productKey || null,
    confidence: Math.min(1, bestScore / words.length),
  };
}

// ============================================================
// Sanity check: flag suspicious lines
// ============================================================

function flagSuspiciousItem(repos, item) {
  const reasons = [];
  if (!item.productKey) reasons.push('unknown_product');
  if (item.productKey) {
    const ref = lookupPrice(repos, item.productKey);
    if (ref && Number.isFinite(item.totalPrice) && item.qty > 0) {
      const pricePerUnit = item.totalPrice / item.qty;
      if (ref.price > 0 && pricePerUnit > ref.price * 2) {
        reasons.push('price_mismatch');
      }
    }
  }
  return reasons.length > 0 ? reasons.join(',') : null;
}

// ============================================================
// Main flow: upload → parse → store
// ============================================================

/**
 * Process an uploaded receipt from buffer to pending DB row.
 * If a receipt with the same sha256 already exists, return it directly.
 *
 * @returns {object} { receiptId, status, itemCount, existing }
 */
async function processUpload(repos, { buffer, mimeType, ocrAdapter = null }) {
  if (!buffer || buffer.length === 0) throw new Error('Empty file');
  if (buffer.length > 10 * 1024 * 1024) throw new Error('File too large (max 10MB)');

  const { filePath, sha256: hash, sizeBytes } = saveFile(buffer, mimeType);

  // Idempotency
  const existing = repos.receipts.getBySha(hash);
  if (existing) {
    return {
      receiptId: existing.id,
      status: existing.status,
      itemCount: repos.receiptItems.getByReceipt(existing.id).length,
      existing: true,
    };
  }

  const receiptId = repos.receipts.insert({
    filePath,
    mimeType,
    fileSizeBytes: sizeBytes,
    sha256: hash,
    status: 'pending',
  });

  // 1. OCR
  let ocr;
  try {
    const adapter = ocrAdapter || ((await isOcrAvailable()) ? tesseractOcr : nullOcr);
    ocr = await adapter(filePath);
  } catch (err) {
    logger.warn({ err: err.message, receiptId }, 'receipt: OCR failed');
    repos.receipts.updateParsed(receiptId, {
      status: 'failed',
      errorMessage: `OCR: ${err.message}`,
    });
    return { receiptId, status: 'failed', itemCount: 0, existing: false };
  }

  // 2. LLM extraction
  const extracted = await extractReceiptFromText(ocr.text);
  if (extracted.error) {
    logger.warn({ err: extracted.error, receiptId }, 'receipt: LLM parse failed');
    repos.receipts.updateParsed(receiptId, {
      rawText: ocr.text,
      llmModel: OLLAMA_MODEL,
      status: 'failed',
      errorMessage: `LLM: ${extracted.error}`,
    });
    return { receiptId, status: 'failed', itemCount: 0, existing: false };
  }

  // 3. Map items + match products
  const items = (extracted.items || []).map((it) => {
    const match = matchProductByName(repos, it.name);
    const item = {
      lineText: it.name || '',
      productKey: match.productKey,
      productName: it.name || '',
      qty: Number.isFinite(it.qty) ? it.qty : 1,
      unit: it.unit || 'stk',
      unitPrice: Number.isFinite(it.unitPrice) ? it.unitPrice : null,
      totalPrice: Number.isFinite(it.totalPrice) ? it.totalPrice : 0,
      discount: Number.isFinite(it.discount) ? it.discount : 0,
      ean: it.ean || null,
      confidence: match.confidence || 0.5,
    };
    item.flaggedReason = flagSuspiciousItem(repos, item);
    return item;
  });

  repos.receipts.updateParsed(receiptId, {
    merchant: extracted.merchant,
    purchasedAt: extracted.purchasedAt,
    totalNok: extracted.totalNok,
    rawText: ocr.text,
    llmModel: OLLAMA_MODEL,
    status: 'pending',
  });
  repos.receiptItems.insertMany(receiptId, items);

  logger.info({ receiptId, itemCount: items.length }, 'receipt: parsed');
  return { receiptId, status: 'pending', itemCount: items.length, existing: false };
}

/**
 * Confirm a receipt: update inventory based on confirmed items.
 * Returns { inventoryUpdates, skipped }.
 */
function confirmReceipt(repos, receiptId) {
  const receipt = repos.receipts.getById(receiptId);
  if (!receipt) throw new Error(`Receipt ${receiptId} not found`);
  if (receipt.status === 'confirmed') {
    return { alreadyConfirmed: true, inventoryUpdates: 0, skipped: 0 };
  }

  const items = repos.receiptItems.getByReceipt(receiptId);
  let updates = 0;
  let skipped = 0;

  const tx = repos.transaction(() => {
    for (const it of items) {
      if (!it.productKey || !it.qty || it.qty <= 0) {
        skipped++;
        continue;
      }
      try {
        addToPantry(repos, {
          productKey: it.productKey,
          qty: it.qty,
          unit: it.unit,
          reason: 'receipt',
          notes: `receipt:${receiptId}`,
        });
        repos.receiptItems.updateItem(it.id, { confirmed: true });

        // Write observed price to price_history (via upsert that creates
        // a new row if needed)
        if (it.totalPrice > 0 && it.qty > 0) {
          const unitPrice = it.totalPrice / it.qty;
          if (!Number.isFinite(unitPrice)) continue; // avoid NaN/Infinity in DB
          if (unitPrice < 0) continue;
          repos.priceReferences.upsert({
            productKey: it.productKey,
            productName: it.productName,
            currentPrice: Math.round(unitPrice * 100) / 100,
            store: receipt.merchant || null,
            source: 'receipt',
            confidence: 0.9,
          });
        }

        // Adaptive family persona (iterasjon 3b fase A byproduct):
        // Hvis vi har en tidligere Kassal-resolution for denne product_key,
        // regnes bekreftet kvittering som en sterk confirm → times_confirmed++.
        // Dette gir oss en gratis capture-hook uten å måtte endre OCR-flyten.
        if (repos.productResolutions?.bestForProductKey) {
          const best = repos.productResolutions.bestForProductKey(it.productKey);
          if (best && best.id) {
            repos.productResolutions.incrementConfirmed(best.id);
          }
        }
        updates++;
      } catch (err) {
        logger.warn({ err: err.message, itemId: it.id }, 'receipt: item-confirm feilet');
        skipped++;
      }
    }
    repos.receipts.markStatus(receiptId, 'confirmed');
  });
  tx();

  logger.info({ receiptId, updates, skipped }, 'receipt: confirmed');
  return { alreadyConfirmed: false, inventoryUpdates: updates, skipped };
}

// ============================================================
// Export
// ============================================================

module.exports = {
  processUpload,
  confirmReceipt,
  saveFile,
  extractReceiptFromText,
  matchProductByName,
  isOcrAvailable,
  tesseractOcr,
  nullOcr,
  flagSuspiciousItem,
  RECEIPTS_ROOT,
  RECEIPT_SYSTEM_PROMPT,
};
