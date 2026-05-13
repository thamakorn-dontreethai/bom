import express from 'express'
import multer from 'multer'
import { PDFParse } from 'pdf-parse'
import { pool } from '../db.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

// POST /api/import/pdf
// Parse a Design Specification PDF → find ECI No. → return design_spec_id
router.post('/pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  try {
    const parser = new PDFParse({ data: new Uint8Array(req.file.buffer) })
    const { text } = await parser.getText()

    // ECI No. looks like "26A376" — 2 digits + 1 letter + 3 digits
    const eciMatch = text.match(/\b(\d{2}[A-Z]\d{3})\b/)
    if (!eciMatch) {
      return res.status(422).json({ error: 'ไม่พบ ECI Number ในไฟล์ PDF นี้' })
    }
    const eciNo = eciMatch[1]

    // Find design_spec in DB
    const { rows } = await pool.query(
      'SELECT design_spec_id FROM tg.design_spec WHERE internal_eci_no = $1 LIMIT 1',
      [eciNo]
    )
    if (!rows.length) {
      return res.status(404).json({ error: `ไม่พบข้อมูลสำหรับ ECI No. ${eciNo} ในฐานข้อมูล` })
    }

    res.json({ design_spec_id: rows[0].design_spec_id, eci_no: eciNo })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
