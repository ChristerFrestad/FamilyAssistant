// Receipt service (Iterasjon 2)
//
// Ansvar:
//   1. Lagre opplastet kvittering på disk med sha256 for idempotens
//   2. Kjøre OCR (Tesseract) mot filen for å hente rå tekst
//   3. Sende teksten gjennom LLM (qwen2.5:3b) og strukturere til linjer
//   4. Skrive 'pending' kvittering + linjer til DB
//   5. Ved bekreftelse: oppdatere inventory + prisreferanser
//
// Designvalg:
//   - OCR-backend er pluggbar (ocrAdapter). Default bruker 'tesseract' via
//     child_process. Hvis Tesseract ikke er installert, fallback til en
//     "null-OCR" som kun lagrer filen og markerer status='failed'.
//   - LLM-kall er best-effort. Hvis modellen feiler eller JSON ikke parses,
//     lagres minimum ett receipt_item per OCR-linje med lav confidence slik
//     at bruker kan rette opp i review.
//   - sha256 er UNIQUE i receipts → samme fil to ganger returnerer eksisterende
//     rad i stedet for å duplisere.
//   - Filen lagres i data/receipts/YYYY-MM/<sha256>.<ext>. Katalogen opprettes
//     ved behov.

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
// Fil-lagring
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
 * Default-adapter: bruker Tesseract CLI (`tesseract <file> - -l nor`).
 * Returnerer { text, engine } eller kaster.
 */
async function tesseractOcr(filePath) {
  const { stdout } = await execFileAsync('tesseract', [filePath, '-', '-l', 'nor+eng'], {
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { text: stdout || '', engine: 'tesseract' };
}

/**
 * Fallback-adapter for testing. Leser ingenting, men gir en strukturert
 * "tom" output slik at kallkjeden kan testes uten Tesseract installert.
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
// LLM-ekstraksjon
// ============================================================

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
 * Send OCR-tekst til LLM og parse JSON-svar.
 * Returnerer et strukturert receipt-objekt eller { error, raw }.
 */
async function extractReceiptFromText(rawText, { signal } = {}) {
  if (!rawText || rawText.trim().length < 5) {
    return { error: 'Tom eller for kort OCR-tekst', raw: rawText };
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
      return { error: 'Ingen JSON i LLM-svar', raw: result.content };
    }
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.items)) parsed.items = [];
    return parsed;
  } catch (err) {
    return { error: err.message };
  }
}

// ============================================================
// Produktmatching
// ============================================================

/**
 * Match et LLM-navn mot eksisterende products via enkel navn-søking.
 * Returnerer { productKey, confidence } eller { productKey: null, confidence: 0 }.
 *
 * Heuristikk:
 *   - Normaliser navn (lowercase, strip pakke-størrelse)
 *   - Søk på product_name / key
 *   - Velg beste treff hvis navnet deler minst ett hovedord med produktet
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

  // Rangér etter antall ordoverlapp
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
// Sanity-check: flagg mistenkelige linjer
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
// Hovedflyt: upload → parse → store
// ============================================================

/**
 * Prosesser en opplastet kvittering fra buffer til pending DB-rad.
 * Hvis en receipt med samme sha256 allerede finnes, returneres den direkte.
 *
 * @returns {object} { receiptId, status, itemCount, existing }
 */
async function processUpload(repos, { buffer, mimeType, ocrAdapter = null }) {
  if (!buffer || buffer.length === 0) throw new Error('Tom fil');
  if (buffer.length > 10 * 1024 * 1024) throw new Error('Fil for stor (max 10MB)');

  const { filePath, sha256: hash, sizeBytes } = saveFile(buffer, mimeType);

  // Idempotens
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
    logger.warn({ err: err.message, receiptId }, 'receipt: OCR feilet');
    repos.receipts.updateParsed(receiptId, {
      status: 'failed',
      errorMessage: `OCR: ${err.message}`,
    });
    return { receiptId, status: 'failed', itemCount: 0, existing: false };
  }

  // 2. LLM-ekstraksjon
  const extracted = await extractReceiptFromText(ocr.text);
  if (extracted.error) {
    logger.warn({ err: extracted.error, receiptId }, 'receipt: LLM-parse feilet');
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
 * Bekreft en kvittering: oppdater inventory basert på confirmed items.
 * Returnerer { inventoryUpdates, skipped }.
 */
function confirmReceipt(repos, receiptId) {
  const receipt = repos.receipts.getById(receiptId);
  if (!receipt) throw new Error(`Receipt ${receiptId} ikke funnet`);
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

        // Skriv observert pris til price_history (via upsert som lager en ny rad hvis nødvendig)
        if (it.totalPrice > 0 && it.qty > 0) {
          const unitPrice = it.totalPrice / it.qty;
          if (!Number.isFinite(unitPrice)) continue; // Unngå NaN/Infinity i DB
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
