import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PDFParse } from 'pdf-parse'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { pool } from '../db.js'
import { logActivity } from '../activity.js'

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PDF_DIR = path.join(__dirname, '../../uploads/pdfs')
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true })

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

// ── Text-based DSI PDF parser ─────────────────────────────────────────────────

function cleanPn(s) {
  return s ? s.replace(/\s+/g, '').trim() || null : null
}

function parseHeader(text) {
  const lines = text.split('\n')
  let model = 'UNKNOWN', customerPartNo = null, tgPartNo = null, productionLevel = null
  let initialStage = null, regCertif = null, date = null
  let customerCode = 'UNKNOWN', customerStandards = null, tgStandards = null, internalEciNo = null

  for (const raw of lines) {
    const tabs = raw.split('\t').map(s => s.trim())
    // Model row: 3-5 char model code e.g. "3GJ\t..." or "581D\t..." (digit + 2-4 alphanumerics)
    if ((!model || model === 'UNKNOWN') && /^[0-9][A-Z0-9]{2,4}\s*\t/.test(raw) && tabs.length >= 3) {
      model = tabs[0].trim()
      customerPartNo = cleanPn(tabs[1])
      productionLevel = tabs[2] || null
      initialStage = tabs[3] || null
      regCertif = tabs[4] || null
      date = tabs[5] || null
    }
    // Customer row: "6991\t78500-DA000-6***\tIN DRAWING\tNO\t26A376"
    if ((!customerCode || customerCode === 'UNKNOWN') && /^\d{4}\s*\t/.test(raw) && tabs.length >= 4) {
      customerCode = tabs[0].trim()
      tgPartNo = cleanPn(tabs[1])
      customerStandards = tabs[2] || null
      tgStandards = tabs[3] || null
      internalEciNo = tabs[4] || null
    }
  }
  return {
    model, customer_part_no: customerPartNo, tg_part_no: tgPartNo,
    production_level: productionLevel, initial_stage: initialStage,
    reg_certif: regCertif, date, customer_code: customerCode,
    customer_standards: customerStandards, tg_standards: tgStandards,
    internal_eci_no: internalEciNo,
  }
}

// BOM row start: optional ">>> ", key (digits/commas/dashes), space, level 1-6,
// optional customer pn after a tab OR space (e.g. "1 1\t78500-..." or "1 1 78950-30A -T810-M1")
const ROW_START = /^(>>>\s+)?([0-9][0-9,\-]*)\s+([1-6])(?:\s+(.+))?$/

// Material sub-row: starts with a material number like "4-68403-00000" or "9-78301-C1001".
// These describe the material of the part above them — not part of the part name.
const MATERIAL_ROW = /^\s*\d-\d{4,}-[A-Z0-9]{3,}/

function isSkip(raw) {
  const t = raw.trim()
  return !t
    || /^DESIGN SPECIFICATION/.test(t) || /^INSTRUCTION$/.test(t)
    || t === '（By Part Number）' || /^<<CONFIDENTIAL>>/.test(t)
    || /TOYODA GOSEI/.test(t) || /^R\/C:%=/.test(t) || /^Left margin/.test(t)
    || /^--\s*\d+\s+of/.test(t)
    || /^(Confirmed|Approved|Checked|Prepared|Registed)\s/.test(t)
    || /^\d+-\d+$/.test(t)                   // page numbers like "5-1"
    || /^Key\s+Level/.test(t)
    || /^Model\s*\t/.test(t) || /^[0-9][A-Z0-9]{2,4}\s*\t/.test(raw)   // repeated model header
    || /^Customer\s*\t/.test(t) || /^\d{4}\s*\t/.test(raw)            // repeated customer header
    || /^(Code|Quantity|Note|SOC|R\/C)$/.test(t)
    || /^(PP-Mold|Mass\s*$|SA\s*$|Use\s*\t|Portion\s*\t)/.test(t)
    || /^Part Name\s*\t/.test(t) || /^Material Standards/.test(t)
    || /^Customer Part No\./.test(t) || /^TG Part No\./.test(t)
    || /https?:\/\//.test(t) || /gt-214\/servlet/.test(t)            // footer reference URL
    || /^\d{4}\/\d{2}\/\d{2}\s*$/.test(t)                            // footer date like 2023/02/20
    || t === '>>>'                                                   // "new TG Part No." marker
}

function parseBomItems(text) {
  const lines = text.split('\n')
  const items = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (isSkip(line) || /^\s*#/.test(line)) { i++; continue }

    const m = line.match(ROW_START)
    if (!m) { i++; continue }

    const key = m[2]
    const level = parseInt(m[3])
    let customerPartNo = m[4] ? cleanPn(m[4]) : null
    i++

    // Part-number line(s). HE puts the customer PN on the key/level row (m[4]); Bag puts
    // an R/C "%" marker either on its own line (Level-1) or joined "% \tPN" (Level-3/4),
    // then customer PN and TG PN on separate lines.
    let tgPartNo = null, soc = null, rc = false, usePortion = false
    // Skip a lone "%" R/C marker line (Bag Level-1 rows have "%" on its own line)
    while (i < lines.length && lines[i].trim() === '%') { rc = true; i++ }
    while (i < lines.length && (isSkip(lines[i]) || /^\s*#/.test(lines[i]))) i++
    // Extract the part number from a line, dropping leading R/C "%" and SOC "*" markers
    // (handles "% \tGU249-00540-B", "GK110-00770 \t*", and plain "GU229-02440").
    const pnFromLine = (ln) => {
      if (ln == null) return { pn: null, rc: false, soc: false }
      const toks = ln.split(/\t/).flatMap(s => s.trim().split(/\s+/)).filter(Boolean)
      let rcM = false, socM = false, pn = null
      for (const tk of toks) {
        if (tk === '%') { rcM = true; continue }
        if (tk === '*') { socM = true; continue }
        if (!pn) pn = tk
      }
      return { pn, rc: rcM, soc: socM }
    }
    // A part-number has a dash and either a letter or 2+ dash segments
    // (e.g. 739H0-0K020-C, GU229-01800-F, 93893-04012-17) — not a quantity or level-code.
    const isPnLine = (ln) => {
      const { pn } = pnFromLine(ln)
      if (!pn) return false
      if (/^\d+-\d+$/.test(pn)) return false          // level code like 1-2
      if (/^\d+(\.\d+)?$/.test(pn)) return false       // pure number (quantity/mass)
      const dashes = (pn.match(/-/g) || []).length
      return dashes >= 1 && (/[A-Za-z]/.test(pn) || dashes >= 2)
    }
    if (i < lines.length && isPnLine(lines[i])) {
      const f = pnFromLine(lines[i])
      if (f.rc) rc = true
      if (f.soc) soc = '*'
      const firstPn = cleanPn(f.pn); i++
      // Peek for a second consecutive PN line — Level-1 rows list customer PN then TG PN
      let j = i
      while (j < lines.length && (isSkip(lines[j]) || /^\s*#/.test(lines[j]) || !lines[j].trim())) j++
      if (!customerPartNo && j < lines.length && isPnLine(lines[j])) {
        customerPartNo = firstPn
        const s = pnFromLine(lines[j])
        if (s.rc) rc = true
        if (s.soc) soc = '*'
        tgPartNo = cleanPn(s.pn)
        i = j + 1
      } else {
        tgPartNo = firstPn
      }
    }

    // Quantity
    while (i < lines.length && (isSkip(lines[i]) || /^\s*#/.test(lines[i]))) i++
    let quantity = 1
    if (i < lines.length && /^\d+$/.test(lines[i].trim())) {
      quantity = parseInt(lines[i].trim()); i++
    }

    // Level Code + Mass
    while (i < lines.length && (isSkip(lines[i]) || /^\s*#/.test(lines[i]))) i++
    let levelCode = null, massG = null
    if (i < lines.length) {
      const lm = lines[i].match(/^(\d+-\d+)\s*\t\s*([\d.]+)/)
      if (lm) { levelCode = lm[1]; massG = parseFloat(lm[2]); i++ }
    }

    // Part Name + Product Standards + Material Standards
    const nameParts = []
    let productStd = null, materialStd = null
    let noteFromTab = null  // note text captured from after-tab on name line

    while (i < lines.length && nameParts.length < 4) {
      const nl = lines[i]
      if (MATERIAL_ROW.test(nl)) break  // material sub-row → part name is complete
      if (/^\s*#/.test(nl)) {
        usePortion = true
        // Leave the # sub-row for the note capture (it holds the material trade name,
        // e.g. "# SGCD1-ZMO F08") once we already have a part name.
        if (nameParts.length > 0) break
        i++
        continue
      }
      if (isSkip(nl)) { i++; continue }
      if (ROW_START.test(nl)) break
      const t = nl.trim()
      if (!t) { i++; continue }

      if (nl.includes('\t')) {
        const ti = nl.indexOf('\t')
        const bTab = nl.slice(0, ti).trim(), aTab = nl.slice(ti + 1).trim()
        if (bTab) nameParts.push(bTab)
        const sm = aTab.match(/^(IN DRAWING|NO\b|YES\b|N\/A)/i)
        if (sm) productStd = sm[1]
        else if (aTab) noteFromTab = aTab  // e.g. "MATERIAL:Fe 6H SIDE TGT"
        i++; break
      }
      if (/^(IN DRAWING|NO|YES|N\/A)$/i.test(t) && nameParts.length > 0) { productStd = t; i++; break }
      const sp = t.match(/^(IN DRAWING|NO|YES|N\/A)(?:\s|$)/i)
      if (sp && nameParts.length > 0) { productStd = sp[1]; i++; break }
      // Part name continuation that ends with a standards keyword
      const ep = t.match(/^(.+?)\s+(IN DRAWING|NO|YES|N\/A)\s*$/)
      if (ep && nameParts.length > 0) { nameParts.push(ep[1]); productStd = ep[2]; i++; break }
      nameParts.push(t); i++
    }
    // Strip leftover Japanese "in drawing" markers (図中) etc. from the part name
    const partName = nameParts.join('').replace(/\s+/g, ' ').trim()
      .replace(/[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]/g, '')
      .replace(/\s{2,}/g, ' ').trim() || null

    // Material Standards — do NOT skip "#" rows here; they hold the material trade name
    // (e.g. "# SGCD1-ZMO F08") which the note capture below needs.
    while (i < lines.length && isSkip(lines[i])) i++
    if (i < lines.length && !ROW_START.test(lines[i]) && !/^\s*#/.test(lines[i])) {
      const mm = lines[i].trim().match(/^(IN DRAWING|NO|YES|N\/A)/i)
      if (mm) { materialStd = mm[1]; i++ }
    }

    // Capture note text (Material No. + Material/Trade Name + Note column) + skip material sub-rows
    const noteLines = noteFromTab ? [noteFromTab] : []
    let matInfo = null      // "Material No. + Trade Name" from the first material sub-row
    let firstMatNo = null   // first material number e.g. 4-68330-00000
    while (i < lines.length) {
      if (ROW_START.test(lines[i])) break
      if (MATERIAL_ROW.test(lines[i])) {
        // "4-68403-00000 \tE5400S20X6 / E5400S20X6VN \tPolyester" → keep ONLY the material number
        if (!matInfo) {
          const parts = lines[i].split('\t').map(s => s.trim()).filter(Boolean)
          firstMatNo = parts[0] || null
          matInfo = parts[0] || null   // drop trade name (E5400S20X6 / Nylon 66 sewing thread)
        }
        i++; continue
      }
      if (/^\s*#/.test(lines[i])) {
        usePortion = true
        // "# ART73 MD2-N 7GB \t日本管理ラベル" — capture descriptive text after the #
        const afterHash = lines[i].replace(/^\s*#\s*/, '').split('\t')[0].trim()
        if (afterHash && !/^\d+(\.\d+)?$/.test(afterHash) && noteLines.length < 2) noteLines.push(afterHash)
        i++; continue
      }
      if (isSkip(lines[i])) { i++; continue }
      const nt = lines[i].replace(/\t/g, ' ').trim()
      // Note column: descriptive text (not a pure number, not a standards keyword)
      if (nt && !/^\d+(\.\d+)?$/.test(nt) && !/^(IN DRAWING|NO|YES|N\/A)$/i.test(nt) && noteLines.length < 2) {
        noteLines.push(nt)
      }
      i++
    }
    // Material Spec = "Material No. + Trade Name" combined with the Note column text
    let note = [matInfo, ...noteLines].filter(Boolean).join('  ').trim() || null
    if (note) note = note.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim() || null

    if (tgPartNo || partName) {
      items.push({
        key, level,
        tg_part_no: tgPartNo, customer_part_no: customerPartNo,
        part_name: partName, level_code: levelCode,
        quantity, mass_g: massG,
        soc, rc, use_portion: usePortion,
        product_standards: productStd, material_standards: materialStd,
        note, material_no: firstMatNo, material_trade_name: null,
        color_no: null, color_tone: null, material_type: null, sa: null,
      })
    }
  }
  return items
}

const GEMINI_PROMPT = `
You are extracting BOM (Bill of Materials) data from a Toyota Gosei "Design Specification Instruction" PDF.

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "header": {
    "model": "model code, 3-5 chars, e.g. 3GJ or 581D (the value under the 'Model' column header)",
    "customer_part_no": "Customer Part No. column value e.g. 78500-3DA-J110-M1 or 739H0-0K020-C",
    "tg_part_no": "TG Part No. column value e.g. 78500-DA000-6*** or 739H0-0K020-C***",
    "production_level": "e.g. 3:SPECIAL ORDER or 4:MASS PRODUCTION",
    "initial_stage": "e.g. C",
    "reg_certif": "e.g. None or Yes",
    "date": "e.g. 2026/02/02",
    "customer_code": "3-4 digit code e.g. 6991 or 0100",
    "customer_standards": "e.g. IN DRAWING",
    "tg_standards": "e.g. NO or IN DRAWING",
    "internal_eci_no": "e.g. 26A376 or 26C602"
  },
  "items": [
    {
      "key": "variant key e.g. 1 or 1-6 or 1,3",
      "level": 1,
      "customer_part_no": "customer PN or null",
      "tg_part_no": "TG PN e.g. GS110-88730-C",
      "part_name": "part name text",
      "level_code": "e.g. 1-2 or null",
      "quantity": 1,
      "mass_g": 1208,
      "soc": null,
      "rc": false,
      "use_portion": false,
      "product_standards": "IN DRAWING or NO or null",
      "material_standards": "IN DRAWING or NO or null",
      "note": null,
      "material_no": null,
      "material_trade_name": null,
      "color_no": null,
      "color_tone": null,
      "material_type": null,
      "sa": null
    }
  ]
}

Rules:
- Extract ALL BOM rows (all pages), not just page 1
- ">>>" prefix on a row means it is a revised/updated part
- Key "1-6" means this part applies to all 6 variants; "1" means only variant 1
- level is an integer 1-6
- quantity and mass_g are numbers (null if unknown)
- rc is true if the row has R/C or % marker
- use_portion is true if there is a "#" sub-row indicating purchased material
- Include sub-items (levels 2-6) under their parent
- Part names may span multiple lines — join them (e.g. "AIR BAG SUB ASSY,SEA" + "T,RH" → "AIR BAG SUB ASSY,SEAT,RH")
- IMPORTANT: part_name must be ONLY the part name text. Do NOT append material numbers (like 4-68330-00000), material trade names, or mass values to part_name. Those belong in material_no / material_trade_name fields.
- The header header block has its OWN "Customer Part No." / "TG Part No." columns at the top — extract those for the header, NOT a part row's value.
- Material rows starting with codes like "4-68330-00000" or "4-61492-00000" are material details of the part above them → put the code in material_no, the description in material_trade_name. Never merge them into the part row's part_name or tg_part_no.
- If a field is not present, use null
`.trim()

async function extractBomWithGemini(pdfBuffer) {
  const model = genai.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' })
  const pdfBase64 = Buffer.from(pdfBuffer).toString('base64')
  const result = await model.generateContent([
    { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
    GEMINI_PROMPT,
  ])
  const raw = result.response.text().trim()
  const json = raw.startsWith('```') ? raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '') : raw
  const parsed = JSON.parse(json)
  return { header: parsed.header, items: parsed.items ?? [] }
}

// ── OCR fallback (scanned PDFs) ──────────────────────────────────────────────

async function ocrPdfToText(pdfBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const { createWorker } = await import('tesseract.js')
  const tmpDir = path.join(__dirname, '../../uploads')

  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), verbosity: 0 }).promise
  const worker = await createWorker('eng', 1, { logger: () => {} })
  const texts = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const ops = await page.getOperatorList()

    // Find largest image XObject on the page (the scanned page image)
    let bestImg = null
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      if (fn !== pdfjs.OPS.paintImageXObject && fn !== pdfjs.OPS.paintInlineImageXObject) continue
      const name = ops.argsArray[i][0]
      const imgData = await new Promise(resolve => {
        const isCommon = page.commonObjs.has(name)
        ;(isCommon ? page.commonObjs : page.objs).get(name, resolve)
      })
      if (imgData && imgData.data && imgData.width * imgData.height > (bestImg?.width ?? 0) * (bestImg?.height ?? 0)) {
        bestImg = imgData
      }
    }

    if (bestImg) {
      const { width, height, data, kind } = bestImg
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      const imgDataObj = ctx.createImageData(width, height)
      const dest = imgDataObj.data

      if (kind === 2) { // RGB_24BPP
        for (let px = 0; px < width * height; px++) {
          dest[px * 4]     = data[px * 3]
          dest[px * 4 + 1] = data[px * 3 + 1]
          dest[px * 4 + 2] = data[px * 3 + 2]
          dest[px * 4 + 3] = 255
        }
      } else if (kind === 1) { // GRAYSCALE_1BPP (bit-packed)
        let px = 0
        for (let b = 0; b < data.length && px < width * height; b++) {
          for (let bit = 7; bit >= 0 && px < width * height; bit--, px++) {
            const v = ((data[b] >> bit) & 1) ? 255 : 0
            dest[px * 4] = dest[px * 4 + 1] = dest[px * 4 + 2] = v
            dest[px * 4 + 3] = 255
          }
        }
      } else { // RGBA or other — copy directly
        for (let px = 0; px < width * height; px++) {
          dest[px * 4]     = data[px * 4]     ?? 0
          dest[px * 4 + 1] = data[px * 4 + 1] ?? 0
          dest[px * 4 + 2] = data[px * 4 + 2] ?? 0
          dest[px * 4 + 3] = data[px * 4 + 3] ?? 255
        }
      }

      ctx.putImageData(imgDataObj, 0, 0)
      const tmpFile = path.join(tmpDir, `_ocr_page_${p}.png`)
      fs.writeFileSync(tmpFile, canvas.toBuffer('image/png'))
      const { data: { text } } = await worker.recognize(tmpFile)
      fs.unlinkSync(tmpFile)
      texts.push(text)
    }

    page.cleanup()
  }

  await worker.terminate()
  await doc.destroy()
  return texts.join('\n\n-- page --\n\n')
}

async function extractBomFromPdf(pdfBuffer) {
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) })
  const result = await parser.getText()
  const text = result.text
  const header = parseHeader(text)
  const items = parseBomItems(text)

  if (header.internal_eci_no || items.length) {
    return { header, items }
  }

  // ── Fallback 1: OCR (for scanned PDFs) ──────────────────────────────────
  const dumpPath = path.join(__dirname, '../../uploads/debug-text.txt')
  fs.writeFileSync(dumpPath, text, 'utf8')
  console.log('Text extraction empty — trying OCR...')
  try {
    const ocrText = await ocrPdfToText(pdfBuffer)
    const ocrDump = dumpPath.replace('.txt', '-ocr.txt')
    fs.writeFileSync(ocrDump, ocrText, 'utf8')
    console.log('OCR complete — saved to', ocrDump)
    const oh = parseHeader(ocrText)
    const oi = parseBomItems(ocrText)
    if (oh.internal_eci_no || oi.length) return { header: oh, items: oi }
    console.log('OCR parser also found nothing — falling back to Gemini...')
  } catch (e) {
    console.error('OCR error:', e.message)
  }

  // ── Fallback 2: Gemini (for non-BAG PDFs the text+OCR parsers couldn't read) ──
  try {
    const g = await extractBomWithGemini(pdfBuffer)
    if (g.header && g.items?.length) return g
  } catch (e) {
    console.error('Gemini error:', e.message)
  }

  throw new Error('No BOM data found in the PDF — OCR could not read it')
}

async function extractTextFromPdf(pdfBuffer) {
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) })
  const result = await parser.getText()
  return result.text
}

// ── Suffix-revision helpers ───────────────────────────────────────────────────

/**
 * Same part, different revision suffix.
 * The first two dash-segments (the "5 หน้า" + "5 หลัง" base, e.g. GU224-03060) identify
 * the part; anything after is the revision suffix — it may differ, be added, or removed.
 *   "GU224-03060"      vs "GU224-03060-A"   → true  (suffix added)
 *   "GS113-57020-A"    vs "GS113-57020-B"   → true  (suffix changed)
 *   "GU224-03060-A"    vs "GU224-03060"     → true  (suffix removed)
 *   "GS113-57020-A"    vs "GS114-57020-A"   → false (front 5 differ → different part)
 *   "GU224-03060-A"    vs "GU224-03061-A"   → false (back 5 differ → different part)
 */
function isSuffixRevision(oldPn, newPn) {
  if (!oldPn || !newPn || oldPn === newPn) return false
  const a = oldPn.split('-')
  const b = newPn.split('-')
  if (a.length < 2 || b.length < 2) return false
  return a[0] === b[0] && a[1] === b[1]   // same base (front 5 + back 5)
}

/**
 * Finds an existing design_spec that is a "suffix revision" of the new import:
 *   - customer_part_no ตรงกันทุกตัวอักษร
 *   - tg_part_no ต่างกันแค่ 1 segment (เช่น suffix A→B)
 * Returns design_spec_id or null.
 */
async function findExistingBomByPartNo(client, customerPartNo, newTgPartNo) {
  if (!customerPartNo || !newTgPartNo) return null
  const { rows } = await client.query(
    `SELECT design_spec_id, tg_part_no FROM tg.design_spec
     WHERE customer_part_no = $1
     ORDER BY design_spec_id DESC`,
    [customerPartNo]
  )
  for (const row of rows) {
    if (isSuffixRevision(row.tg_part_no, newTgPartNo)) return row.design_spec_id
  }
  return null
}

/**
 * อัปเดต BOM items ของ design_spec ที่มีอยู่แล้ว โดยใช้ revision logic:
 *
 *  - tg_part_no ตรงกันทุกตัว → คง row เดิมไว้ (ไม่แตะ)
 *  - tg_part_no ต่างกัน 1 segment (suffix revision, เช่น A→B)
 *      → mark row เก่า status='revised_out' (แสดงขีดฆ่าบนหน้าจอ)
 *      → INSERT row ใหม่ status='active' ต่อท้าย row เก่าทันที
 *  - part ใหม่ที่ไม่มีในฐานข้อมูลเลย → INSERT status='active'
 *  - part เก่าที่ไม่ปรากฏใน file ใหม่ → mark status='obsolete'
 *
 * ⚠ ต้อง migrate DB ก่อน:
 *   ALTER TABLE tg.bom ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
 *   UPDATE tg.bom SET status='active' WHERE status IS NULL;
 */
async function reconcileBomItems(client, dsId, newItems, partCache) {
  // ดึง active bom rows ทั้งหมดของ design_spec นี้
  const { rows: existing } = await client.query(
    `SELECT b.bom_id, b.child_part_id, b.sort_order, b.variant_id,
            b.parent_part_id, b.bom_level, b.level_code, b.quantity,
            p.tg_part_no
     FROM tg.bom b
     JOIN tg.part p ON p.part_id = b.child_part_id
     WHERE b.design_spec_id = $1 AND (b.status IS NULL OR b.status = 'active')
     ORDER BY b.sort_order`,
    [dsId]
  )

  // index existing rows ด้วย tg_part_no
  const existingByPn = new Map(
    existing.filter(r => r.tg_part_no).map(r => [r.tg_part_no, r])
  )
  const matchedBomIds = new Set()

  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i]
    const newPn = item.tg_part_no?.trim() ?? null

    // ── Case 1: tg_part_no ตรงกันทุกตัว → คง row เดิม ──────────
    if (newPn && existingByPn.has(newPn)) {
      matchedBomIds.add(existingByPn.get(newPn).bom_id)
      continue
    }

    // ── Case 2 & 3: หา suffix revision หรือ part ใหม่ ────────────
    let sortOrder = (existing[existing.length - 1]?.sort_order ?? 0) + i + 1
    let variantId = null
    let parentPartId = null
    let bomLevel = Math.max(1, Math.min(5, parseInt(item.level) || 1))
    let levelCode = item.level_code ?? null

    for (const [oldPn, oldRow] of existingByPn.entries()) {
      if (!isSuffixRevision(oldPn, newPn)) continue

      // พบ suffix revision → mark เก่าเป็น revised_out
      await client.query(
        `UPDATE tg.bom SET status = 'revised_out' WHERE bom_id = $1`,
        [oldRow.bom_id]
      )
      matchedBomIds.add(oldRow.bom_id)

      // วาง row ใหม่ต่อจาก row เก่าทันที
      sortOrder    = oldRow.sort_order + 0.5
      variantId    = oldRow.variant_id
      parentPartId = oldRow.parent_part_id
      bomLevel     = oldRow.bom_level
      levelCode    = oldRow.level_code
      existingByPn.delete(oldPn)
      break
    }

    // INSERT part ใหม่ (suffix revision หรือ brand-new)
    const partId = await upsertPart(client, partCache, item, i)
    await client.query(
      `INSERT INTO tg.bom
         (design_spec_id, variant_id, parent_part_id, child_part_id,
          bom_level, level_code, quantity, sort_order, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
      [dsId, variantId, parentPartId, partId,
       bomLevel, levelCode, Math.round(item.quantity ?? 1), Math.round(sortOrder)]
    )
  }

  // ── part เก่าที่ไม่ปรากฏใน file ใหม่ → obsolete ───────────────
  for (const [, oldRow] of existingByPn.entries()) {
    if (matchedBomIds.has(oldRow.bom_id)) continue
    await client.query(
      `UPDATE tg.bom SET status = 'obsolete' WHERE bom_id = $1`,
      [oldRow.bom_id]
    )
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

// Parse key string → list of integer keys
// "1" → [1], "2" → [2], "1-2" → [1,2], "1-6" → [1,2,3,4,5,6], "1,3" → [1,3], null → []
function parseKeyInts(keyStr) {
  if (!keyStr) return []
  const s = String(keyStr).trim()
  const range = s.match(/^(\d+)-(\d+)$/)
  if (range) {
    const start = parseInt(range[1]), end = parseInt(range[2])
    const out = []
    for (let k = start; k <= end; k++) out.push(k)
    return out
  }
  if (s.includes(',')) return s.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n))
  const n = parseInt(s)
  return isNaN(n) ? [] : [n]
}

async function upsertModel(client, code) {
  const { rows } = await client.query('SELECT model_id FROM tg.model WHERE model_code=$1', [code])
  if (rows.length) return rows[0].model_id
  const r = await client.query(
    'INSERT INTO tg.model (model_code, model_name) VALUES ($1,$1) RETURNING model_id', [code]
  )
  return r.rows[0].model_id
}

async function upsertCustomer(client, code) {
  const { rows } = await client.query('SELECT customer_id FROM tg.customer WHERE customer_code=$1', [code])
  if (rows.length) return rows[0].customer_id
  const r = await client.query(
    'INSERT INTO tg.customer (customer_code, customer_name) VALUES ($1,$1) RETURNING customer_id', [code]
  )
  return r.rows[0].customer_id
}

async function upsertPart(client, cache, item, idx) {
  const tgPn = item.tg_part_no?.trim() || null
  const cacheKey = tgPn ?? `_anon_${idx}`
  if (cache[cacheKey] != null) return cache[cacheKey]

  if (tgPn) {
    const { rows } = await client.query('SELECT part_id FROM tg.part WHERE tg_part_no=$1', [tgPn])
    if (rows.length) {
      // Refresh name/mass/note/standards so re-import corrects existing data
      await client.query(
        `UPDATE tg.part
         SET part_name         = COALESCE($1, part_name),
             mass_gram         = COALESCE($2, mass_gram),
             notes             = $3,
             product_standard  = $4,
             material_standard = $5
         WHERE part_id = $6`,
        [item.part_name ?? null, item.mass_g ?? null, item.note ?? null,
         item.product_standards ?? null, item.material_standards ?? null, rows[0].part_id]
      )
      cache[cacheKey] = rows[0].part_id
      return rows[0].part_id
    }
  }

  const insertTgPn = tgPn ?? `ANON-${Date.now()}-${idx}`
  const r = await client.query(
    `INSERT INTO tg.part
       (tg_part_no, customer_part_no, part_name, mass_gram,
        material_no, material_trade_name, jis_standard,
        product_standard, material_standard, notes,
        is_purchased_material, reg_certif_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING part_id`,
    [insertTgPn, item.customer_part_no?.trim() ?? null, item.part_name ?? 'Unknown',
     item.mass_g ?? null, item.material_no ?? null, item.material_trade_name ?? null,
     item.sa ?? null, item.product_standards ?? null, item.material_standards ?? null,
     item.note ?? null, !!item.use_portion, !!item.rc]
  )
  cache[cacheKey] = r.rows[0].part_id
  return r.rows[0].part_id
}

function savePdf(buffer, dsId) {
  const filename = `bom-${dsId}-${Date.now()}.pdf`
  fs.writeFileSync(path.join(PDF_DIR, filename), buffer)
  return `/uploads/pdfs/${filename}`
}

// ── POST /api/import/pdf ──────────────────────────────────────────────────────

router.post('/pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const bomGroup = req.body.bom_group ?? null

  try {
    const extracted = await extractBomFromPdf(req.file.buffer, bomGroup)
    const { header, items } = extracted

    if (!header || !items?.length) {
      return res.status(422).json({ error: 'Bill of material not found' })
    }

    // Fallback for NOT NULL columns — some PDFs (e.g. Bag) may not yield both PNs
    if (!header.customer_part_no?.trim()) header.customer_part_no = header.tg_part_no ?? null
    if (!header.tg_part_no?.trim())       header.tg_part_no       = header.customer_part_no ?? null
    if (!header.customer_part_no && !header.tg_part_no) {
      return res.status(422).json({ error: 'file does not contain a valid bill of material' })
    }

    // ── Block duplicates ─────────────────────────────────────────────
    // This "add" endpoint only creates brand-new BOMs. Reject the file if it
    // matches an existing BOM exactly (same ECI No. or same TG Part No.) OR is a
    // suffix revision (A→B) of one already in the system. Updating an existing
    // BOM is done through the revision flow in the document view, not here.
    {
      const dupConds = [], dupVals = []
      if (header.internal_eci_no) { dupVals.push(header.internal_eci_no); dupConds.push(`internal_eci_no = $${dupVals.length}`) }
      if (header.tg_part_no)      { dupVals.push(header.tg_part_no);      dupConds.push(`tg_part_no = $${dupVals.length}`) }
      let dup = null
      if (dupConds.length) {
        const { rows } = await pool.query(
          `SELECT design_spec_id, tg_part_no FROM tg.design_spec
           WHERE ${dupConds.join(' OR ')} LIMIT 1`, dupVals)
        if (rows.length) dup = rows[0]
      }
      if (!dup) {
        const revId = await findExistingBomByPartNo(pool, header.customer_part_no, header.tg_part_no)
        if (revId) {
          const { rows } = await pool.query('SELECT tg_part_no FROM tg.design_spec WHERE design_spec_id=$1', [revId])
          dup = { design_spec_id: revId, tg_part_no: rows[0]?.tg_part_no }
        }
      }
      if (dup) {
        return res.status(409).json({
          error: 'duplicate',
          message: `This BOM already exists (${dup.tg_part_no ?? header.tg_part_no}) — to edit it, open the existing BOM and use Save Update`,
          design_spec_id: dup.design_spec_id,
        })
      }
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const modelId    = await upsertModel(client, header.model ?? 'UNKNOWN')
      const customerId = await upsertCustomer(client, header.customer_code ?? 'UNKNOWN')
      const effDate    = new Date()

      let dsId
      let useRevisionLogic = false

      // ── Step 1: หา design_spec จาก internal_eci_no (exact match) ──
      const { rows: dsExist } = await client.query(
        'SELECT design_spec_id FROM tg.design_spec WHERE internal_eci_no=$1 LIMIT 1',
        [header.internal_eci_no]
      )

      if (dsExist.length) {
        // ECI No. ตรงกัน → full replace (พฤติกรรมเดิม)
        dsId = dsExist[0].design_spec_id
        await client.query(
          `UPDATE tg.design_spec SET
             model_id=$1, customer_id=$2, customer_part_no=$3, tg_part_no=$4,
             production_level=$5, initial_stage=$6, reg_certif=$7,
             effective_date=$8, customer_standard=$9, tg_standard=$10
           WHERE design_spec_id=$11`,
          [modelId, customerId, header.customer_part_no, header.tg_part_no,
           header.production_level, header.initial_stage, header.reg_certif,
           effDate, header.customer_standards, header.tg_standards, dsId]
        )
        await client.query('DELETE FROM tg.bom WHERE design_spec_id=$1', [dsId])
        await client.query('DELETE FROM tg.product_variant WHERE design_spec_id=$1', [dsId])
      } else {
        // ── Step 2: หาจาก customer_part_no + tg_part_no suffix revision ──
        const revisionDsId = await findExistingBomByPartNo(
          client, header.customer_part_no, header.tg_part_no
        )
        if (revisionDsId) {
          dsId = revisionDsId
          useRevisionLogic = true
          await client.query(
            `UPDATE tg.design_spec SET
               tg_part_no=$1, internal_eci_no=$2, effective_date=$3,
               production_level=$4, initial_stage=$5
             WHERE design_spec_id=$6`,
            [header.tg_part_no, header.internal_eci_no, effDate,
             header.production_level, header.initial_stage, dsId]
          )
        }
      }

      if (!dsId) {
        const r = await client.query(
          `INSERT INTO tg.design_spec
             (model_id, customer_id, customer_part_no, tg_part_no, internal_eci_no,
              production_level, initial_stage, reg_certif, effective_date,
              customer_standard, tg_standard, bom_group, created_by, updated_by, updated_at,
              prepared_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,NOW(),$13) RETURNING design_spec_id`,
          [modelId, customerId, header.customer_part_no, header.tg_part_no,
           header.internal_eci_no, header.production_level, header.initial_stage,
           header.reg_certif, effDate, header.customer_standards, header.tg_standards,
           bomGroup, req.user?.full_name || req.user?.username || null]
        )
        dsId = r.rows[0].design_spec_id
        await client.query('SAVEPOINT sp_evt')
        try {
          await client.query('UPDATE tg.design_spec SET evt_first_issue=true WHERE design_spec_id=$1', [dsId])
          await client.query('RELEASE SAVEPOINT sp_evt')
        } catch (_) { await client.query('ROLLBACK TO SAVEPOINT sp_evt') }
        await client.query('SAVEPOINT sp_rev')
        try {
          await client.query(
            `INSERT INTO tg.bom_revision
               (design_spec_id, sort_order, mark, revision_record, eci_no, revision_date, revisioner)
             VALUES ($1,0,'–','First issue',$2,$3,$4)`,
            [dsId, header.internal_eci_no, effDate, req.user?.full_name || req.user?.username || null]
          )
          await client.query('RELEASE SAVEPOINT sp_rev')
        } catch (_) { await client.query('ROLLBACK TO SAVEPOINT sp_rev') }
      }

      const partCache = {}

      // ── suffix revision → ใช้ reconcile logic แทน full insert ──
      if (useRevisionLogic) {
        await reconcileBomItems(client, dsId, items, partCache)

        // Add revision record for re-import (first issue = 1, so first update = 2)
        const { rows: lvRows } = await client.query(
          `SELECT COALESCE(MAX(CASE WHEN mark ~ '^[0-9]+$' THEN mark::smallint ELSE 0 END), 0) AS max_level
           FROM tg.bom_revision WHERE design_spec_id = $1`,
          [dsId]
        )
        const maxLevel = lvRows[0].max_level ?? 0
        const newMark = maxLevel === 0 ? 2 : maxLevel + 1
        await client.query(
          `INSERT INTO tg.bom_revision
             (design_spec_id, sort_order, mark, revision_record, eci_no, revision_date, revisioner)
           VALUES ($1,$2,$3,'Update ECI No.',$4,$5,$6)`,
          [dsId, newMark, String(newMark), header.internal_eci_no, effDate,
           req.user?.full_name || req.user?.username || null]
        )
        // record who did this re-import
        await client.query(
          `UPDATE tg.design_spec SET updated_by=$1, updated_at=NOW() WHERE design_spec_id=$2`,
          [req.user?.full_name || req.user?.username || null, dsId]
        )

        await client.query('COMMIT')
        const pdfUrl = savePdf(req.file.buffer, dsId)
        await pool.query('UPDATE tg.design_spec SET pdf_url=$1 WHERE design_spec_id=$2', [pdfUrl, dsId])
        logActivity(req.user, 'revise', header.tg_part_no, 'Update ECI ' + (header.internal_eci_no ?? ''))
        res.json({ design_spec_id: dsId, customer_part_no: header.customer_part_no })
        return
      }

      const variantCache = {}       // "k" → variant_id
      const keyLevelStack = {}      // "k" → { level → part_id }

      function getStack(k) {
        if (!keyLevelStack[k]) keyLevelStack[k] = {}
        return keyLevelStack[k]
      }
      function updateStack(k, level, partId) {
        const st = getStack(k)
        st[level] = partId
        for (const lv of Object.keys(st).map(Number)) { if (lv > level) delete st[lv] }
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const level = Math.max(1, Math.min(6, parseInt(item.level) || 1))
        const keyInts = parseKeyInts(item.key)   // e.g. [1], [2], [1,2], [1,2,3,4,5,6]

        const partId = await upsertPart(client, partCache, item, i)

        if (level === 1 && keyInts.length === 1) {
          // Level-1 single-key → create product_variant
          const vKey = keyInts[0]
          const ks = String(vKey)
          const tgPn = item.tg_part_no?.trim() || 'UNKNOWN'
          const vr = await client.query(
            `INSERT INTO tg.product_variant
               (design_spec_id, variant_key, customer_part_no, tg_part_no, part_name, mass_gram)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING variant_id`,
            [dsId, vKey, item.customer_part_no?.trim() ?? null, tgPn,
             item.part_name ?? null, item.mass_g ?? null]
          )
          const variantId = vr.rows[0].variant_id
          variantCache[ks] = variantId

          await client.query(
            `INSERT INTO tg.bom
               (design_spec_id, variant_id, parent_part_id, child_part_id,
                bom_level, level_code, quantity, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [dsId, variantId, null, partId, level, item.level_code ?? null, Math.round(item.quantity ?? 1), i]
          )
          updateStack(ks, level, partId)

        } else if (keyInts.length > 0) {
          // Level 2-5, or composite key (e.g. "1-2") → insert one bom row per key
          // This mirrors the seed data: shared parts appear as children of each variant
          for (const vKey of keyInts) {
            const ks = String(vKey)
            const variantId = variantCache[ks] ?? null
            const stack = getStack(ks)
            const parentPartId = level > 1 ? (stack[level - 1] ?? null) : null

            await client.query(
              `INSERT INTO tg.bom
                 (design_spec_id, variant_id, parent_part_id, child_part_id,
                  bom_level, level_code, quantity, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [dsId, variantId, parentPartId, partId,
               level, item.level_code ?? null, Math.round(item.quantity ?? 1), i]
            )
            updateStack(ks, level, partId)
          }

        } else {
          // Null key → single shared row, parent from first available stack
          let parentPartId = null
          if (level > 1) {
            for (const st of Object.values(keyLevelStack)) {
              if (st[level - 1]) { parentPartId = st[level - 1]; break }
            }
          }
          await client.query(
            `INSERT INTO tg.bom
               (design_spec_id, variant_id, parent_part_id, child_part_id,
                bom_level, level_code, quantity, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [dsId, null, parentPartId, partId, level, item.level_code ?? null, Math.round(item.quantity ?? 1), i]
          )
        }
      }

      await client.query('COMMIT')
      const pdfUrl = savePdf(req.file.buffer, dsId)
      await pool.query('UPDATE tg.design_spec SET pdf_url=$1 WHERE design_spec_id=$2', [pdfUrl, dsId])
      logActivity(req.user, 'import', header.tg_part_no, (bomGroup ? bomGroup + ' · ' : '') + 'ECI ' + (header.internal_eci_no ?? ''))
      res.json({ design_spec_id: dsId, customer_part_no: header.customer_part_no })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('Import error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/import/revision-preview/:id  — parse PDF and return diff (no DB write) ──
router.post('/revision-preview/:id', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const dsId = parseInt(req.params.id)
  try {
    const { rows: grpRows } = await pool.query(
      'SELECT bom_group FROM tg.design_spec WHERE design_spec_id=$1', [dsId]
    )
    const bomGroup = grpRows[0]?.bom_group ?? null
    const extracted = await extractBomFromPdf(req.file.buffer, bomGroup)
    const { header, items } = extracted
    if (!header || !items?.length) {
      return res.status(422).json({ error: 'No BOM data found in this PDF' })
    }

    const [{ rows: existing }, { rows: dsRows }] = await Promise.all([
      pool.query(
        `SELECT b.bom_id, b.bom_level AS level, p.tg_part_no, p.part_name
         FROM tg.bom b JOIN tg.part p ON p.part_id = b.child_part_id
         WHERE b.design_spec_id = $1 AND (b.status IS NULL OR b.status = 'active')
         ORDER BY b.sort_order`,
        [dsId]
      ),
      pool.query('SELECT tg_part_no FROM tg.design_spec WHERE design_spec_id = $1', [dsId]),
    ])

    const existingByPn = new Map(
      existing.filter(r => r.tg_part_no).map(r => [r.tg_part_no, r])
    )

    const item_changes = []
    const new_items = []
    const seen = new Set()
    // tgt_changes: per-key TGT changes detected from Level 1 rows in the PDF table
    const tgt_changes = {}

    for (const item of items) {
      const newPn = item.tg_part_no?.trim()
      if (!newPn || seen.has(newPn)) continue
      seen.add(newPn)
      if (existingByPn.has(newPn)) continue // unchanged

      let found = false
      for (const [oldPn, oldRow] of existingByPn.entries()) {
        if (!isSuffixRevision(oldPn, newPn)) continue
        if (oldRow.level === 1) {
          // Level 1 suffix revision = TGT Part No. change for this key
          const k = item.key_code ?? '0'
          tgt_changes[k] = { old: oldPn, new: newPn, bom_id: oldRow.bom_id }
        } else {
          item_changes.push({
            bom_id: oldRow.bom_id,
            old_pn: oldPn,
            new_pn: newPn,
            part_name: oldRow.part_name,
            level: oldRow.level,
          })
        }
        found = true
        break
      }
      if (!found && (item.level ?? 1) > 1) {
        new_items.push({ tg_part_no: newPn, part_name: item.part_name ?? '', level: item.level ?? 1 })
      }
    }

    // Block re-uploading the SAME file: if it produces no changes at all, it's a duplicate
    // of what's already applied. A genuinely new version would have at least one diff.
    const noChanges =
      Object.keys(tgt_changes).length === 0 &&
      item_changes.length === 0 &&
      new_items.length === 0
    if (noChanges) {
      return res.status(409).json({
        error: 'duplicate',
        message: 'This file has already been applied to this BOM — there are no changes. Please upload a newer version.',
      })
    }

    const pdfUrl = savePdf(req.file.buffer, dsId)

    res.json({
      tgt_changes,
      item_changes,
      new_items,
      header: { internal_eci_no: header.internal_eci_no, tg_part_no: header.tg_part_no },
      pdf_url: pdfUrl,
    })
  } catch (e) {
    console.error('Preview error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/import/pdf-text  (debug: show raw extracted text) ───────────────
router.post('/pdf-text', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  try {
    const text = await extractTextFromPdf(req.file.buffer)
    res.json({ text, length: text.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
