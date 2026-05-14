import express from 'express'
import multer from 'multer'
import { PDFParse } from 'pdf-parse'
import { pool } from '../db.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

// Toyota customer part no pattern: 5 digits - 2~4 alphanum - 2~5 alphanum (- 1~3 alphanum optional)
// e.g. 78500-3DA-J110-M1 / 78500-3DAA-Q311-M1 / 78500-DA000-0V0B
const CUST_PN_RE = /\b(\d{5}-[A-Z0-9]{2,4}-[A-Z0-9]{2,5}(?:-[A-Z0-9]{1,3})?)\b/g

function extractCustomerPartNos(text) {
  // Normalise spaces inside part numbers (pdf sometimes inserts space: "78500-3DA -J110-M1")
  const normalised = text.replace(/(\d{5}-[A-Z0-9]{2,4})\s+(-[A-Z0-9])/g, '$1$2')
  return [...new Set([...normalised.matchAll(CUST_PN_RE)].map(m => m[1]))]
}

// POST /api/import/pdf
// Parse a Design Specification PDF → find Customer Part No. → return design_spec_id
router.post('/pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  try {
    const parser = new PDFParse({ data: new Uint8Array(req.file.buffer) })
    const { text } = await parser.getText()

    let custPartNo = req.body.customer_part_no
    let designSpecId = null

    if (!custPartNo) {
      // Strategy 1: look for value right after "Customer Part No." label
      const labelMatch = text.match(
        /Customer\s+Part\s+No\.?\s*:?\s*[\r\n\s]*(\d{5}-[A-Z0-9]{2,4}\s*-[A-Z0-9]{2,5}(?:-[A-Z0-9]{1,3})?)/i
      )
      if (labelMatch) {
        // Remove any spaces that pdf inserted inside the part number
        custPartNo = labelMatch[1].replace(/\s+/g, '')
      }

      if (!custPartNo) {
        // Strategy 2: collect all candidate part nos and try each against DB
        const candidates = extractCustomerPartNos(text)
        if (!candidates.length) {
          return res.status(422).json({
            code: 'PART_NOT_FOUND',
            error: 'ไม่พบ Customer Part No. ในไฟล์ PDF นี้',
          })
        }
        for (const candidate of candidates) {
          const { rows } = await pool.query(
            'SELECT design_spec_id FROM tg.design_spec WHERE customer_part_no = $1 LIMIT 1',
            [candidate]
          )
          if (rows.length) { custPartNo = candidate; designSpecId = rows[0].design_spec_id; break }
        }
        if (!custPartNo) {
          return res.status(404).json({
            error: `ไม่พบ Customer Part No. ที่ตรงกับฐานข้อมูล (พบในไฟล์: ${extractCustomerPartNos(text).slice(0, 5).join(', ')})`,
          })
        }
      }
    }

    // Final DB lookup (skip if already found in strategy 2)
    if (!designSpecId) {
      const { rows } = await pool.query(
        'SELECT design_spec_id FROM tg.design_spec WHERE customer_part_no = $1 LIMIT 1',
        [custPartNo]
      )
      if (!rows.length) {
        return res.status(404).json({
          error: `ไม่พบข้อมูลสำหรับ Customer Part No. ${custPartNo} ในฐานข้อมูล`,
        })
      }
      designSpecId = rows[0].design_spec_id
    }

    // Record today as the import date
    await pool.query(
      'UPDATE tg.design_spec SET effective_date = CURRENT_DATE WHERE design_spec_id = $1',
      [designSpecId]
    )

    res.json({ design_spec_id: designSpecId, customer_part_no: custPartNo })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
