import express from 'express'
import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { pool } from '../db.js'

const router = express.Router()

// SSE clients: bomId (number) -> Set<res>
const sseClients = new Map()

/* ── GET /api/approval/events/:bomId  — SSE stream for real-time approval notification ── */
router.get('/events/:bomId', (req, res) => {
  const bomId = parseInt(req.params.bomId)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  if (!sseClients.has(bomId)) sseClients.set(bomId, new Set())
  sseClients.get(bomId).add(res)

  req.on('close', () => {
    sseClients.get(bomId)?.delete(res)
  })
})

function mailer() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

/* ── POST /api/approval/send  { bomId, recipientEmail, pageImages? } ── */
router.post('/send', async (req, res) => {
  const { bomId, recipientEmail, pdfBase64 } = req.body
  if (!bomId || !recipientEmail) return res.status(400).json({ error: 'missing fields' })

  // Fetch BOM info for the email
  const { rows: bomRows } = await pool.query(
    `SELECT ds.internal_eci_no, ds.tg_part_no, m.model_code AS model, m.model_name
     FROM tg.design_spec ds
     JOIN tg.model m ON m.model_id = ds.model_id
     WHERE ds.design_spec_id = $1`, [bomId]
  )
  if (!bomRows.length) return res.status(404).json({ error: 'BOM not found' })
  const bom = bomRows[0]

  const token = crypto.randomBytes(32).toString('hex')
  // Use APP_URL from env if set; otherwise auto-detect from the incoming request
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`
  const link = `${appUrl}/approve/${token}`

  await pool.query(
    `INSERT INTO tg.approval_tokens (token, bom_id, sent_to) VALUES ($1, $2, $3)`,
    [token, bomId, recipientEmail]  // bom_id column stores design_spec_id
  )

  const attachments = pdfBase64 ? [{
    filename: `BOM-${bom.tg_part_no ?? bomId}.pdf`,
    content: pdfBase64,
    encoding: 'base64',
  }] : []

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#1a3a6b">ขออนุมัติ BOM Document</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px;color:#666;width:130px">TGT Part No.</td><td style="padding:6px;font-weight:bold">${bom.tg_part_no ?? '-'}</td></tr>
        <tr><td style="padding:6px;color:#666">Model</td><td style="padding:6px">${bom.model ?? '-'}</td></tr>
        <tr><td style="padding:6px;color:#666">Model Name</td><td style="padding:6px">${bom.model_name ?? '-'}</td></tr>
        <tr><td style="padding:6px;color:#666">ECI No.</td><td style="padding:6px">${bom.internal_eci_no ?? '-'}</td></tr>
      </table>
      ${pdfBase64 ? `<p style="margin-top:16px;color:#555">📎 เอกสาร BOM แนบมาในรูปแบบ PDF</p>` : ''}
      <p style="margin-top:24px">กรุณาคลิกปุ่มด้านล่างเพื่อกรอก <b>ชื่อผู้อนุมัติ</b> และยืนยันการอนุมัติเอกสาร BOM นี้</p>
      <a href="${link}" style="display:inline-block;margin-top:12px;padding:12px 28px;background:#1a6b3c;color:#fff;text-decoration:none;border-radius:6px;font-size:15px">
        ✅ อนุมัติเอกสาร BOM
      </a>
      <p style="margin-top:20px;font-size:12px;color:#999">ลิงก์นี้ใช้ได้ครั้งเดียว · ระบบ BOM Management</p>
    </div>
  `

  try {
    await mailer().sendMail({
      from:        `"BOM System" <${process.env.SMTP_USER}>`,
      to:          recipientEmail,
      subject:     `[BOM อนุมัติ] ${bom.tg_part_no ?? ''} — ${bom.model ?? ''}`,
      html,
      attachments,
    })
    res.json({ ok: true })
  } catch (e) {
    console.error('Email error:', e.message)
    res.status(500).json({ error: 'send_failed', detail: e.message })
  }
})

/* ── GET /approve/:token  — Approval page (served as HTML) ── */
router.get('/:token', async (req, res) => {
  const { token } = req.params
  const { rows } = await pool.query(
    `SELECT at.*, ds.tg_part_no, ds.customer_part_no, ds.internal_eci_no,
            m.model_code AS model, m.model_name, ds.approved_by AS ds_approved_by
     FROM tg.approval_tokens at
     JOIN tg.design_spec ds ON ds.design_spec_id = at.bom_id
     JOIN tg.model m ON m.model_id = ds.model_id
     WHERE at.token = $1 LIMIT 1`, [token]
  )
  if (!rows.length) return res.status(404).send(errorPage('ไม่พบลิงก์นี้หรือหมดอายุแล้ว'))

  const t = rows[0]
  if (t.status === 'approved') return res.send(donePage(t.approved_by, t.approved_at))

  const { rows: items } = await pool.query(
    `SELECT p.tg_part_no, p.part_name, b.bom_level AS level, b.quantity,
            p.notes, p.product_standard, p.material_standard, p.mass_gram
     FROM tg.bom b
     JOIN tg.part p ON p.part_id = b.child_part_id
     WHERE b.design_spec_id = $1 AND b.status != 'revised_out'
     ORDER BY b.sort_order`, [t.bom_id]
  )

  res.send(approvalPage(token, t, items))
})

/* ── POST /approve/:token  — Submit approval ── */
router.post('/:token', express.urlencoded({ extended: false }), async (req, res) => {
  const { token } = req.params
  const approvedBy = (req.body.approved_by ?? '').trim()
  if (!approvedBy) return res.status(400).send(errorPage('กรุณากรอกชื่อผู้อนุมัติ'))

  const { rows } = await pool.query(
    `SELECT * FROM tg.approval_tokens WHERE token = $1 LIMIT 1`, [token]
  )
  if (!rows.length) return res.status(404).send(errorPage('ไม่พบลิงก์นี้'))
  const t = rows[0]
  if (t.status === 'approved') return res.send(donePage(t.approved_by, t.approved_at))

  // Update token
  await pool.query(
    `UPDATE tg.approval_tokens SET approved_by=$1, approved_at=NOW(), status='approved' WHERE token=$2`,
    [approvedBy, token]
  )

  // Update design_spec.approved_by directly (works even without bom_revision rows)
  await pool.query(
    `UPDATE tg.design_spec SET approved_by = $1 WHERE design_spec_id = $2`,
    [approvedBy, t.bom_id]
  )

  // Also update latest bom_revision if any rows exist
  await pool.query(
    `UPDATE tg.bom_revision SET approved_by = $1
     WHERE design_spec_id = $2
     AND revision_id = (
       SELECT revision_id FROM tg.bom_revision
       WHERE design_spec_id = $2
       ORDER BY sort_order DESC LIMIT 1
     )`, [approvedBy, t.bom_id]
  )

  // Notify any open SSE connections for this BOM
  const clients = sseClients.get(t.bom_id)
  if (clients?.size) {
    const payload = JSON.stringify({ approved_by: approvedBy })
    clients.forEach(r => r.write(`event: approved\ndata: ${payload}\n\n`))
  }

  res.send(donePage(approvedBy, new Date()))
})

/* ── HTML templates ── */
function layout(body) {
  return `<!DOCTYPE html><html lang="th"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>BOM Approval</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0 }
      body { font-family: Arial, sans-serif; background: #f4f6f9; min-height: 100vh; display: flex; justify-content: center; padding: 24px }
      .card { background: #fff; border-radius: 10px; box-shadow: 0 2px 16px rgba(0,0,0,.12); padding: 36px; max-width: 960px; width: 100%; align-self: flex-start }
      h2 { color: #1a3a6b; margin-bottom: 20px; font-size: 20px }
      .info-row { display: flex; padding: 7px 0; border-bottom: 1px solid #f0f0f0 }
      .info-label { color: #888; width: 150px; font-size: 13px }
      .info-val { font-weight: 600; font-size: 13px }
      .bom-tbl { border-collapse: collapse; width: 100%; font-size: 12px; margin-bottom: 18px }
      .bom-tbl th { background: #1a3a6b; color: #fff; padding: 6px 8px; text-align: left; border: 1px solid #c8d0e0; white-space: nowrap }
      .bom-tbl td { padding: 4px 8px; border: 1px solid #dde; vertical-align: middle }
      .bom-tbl tr:nth-child(even) { background: #f8f9ff }
      .bom-tbl tr:hover { background: #eef2ff }
      .lv1 { font-weight: 700; background: #e8edf5 !important }
      .lv2 { padding-left: 16px !important }
      .lv3 { padding-left: 32px !important }
      .lv4 { padding-left: 48px !important }
      .lv5 { padding-left: 64px !important }
      input[type=text] { width: 100%; padding: 10px 14px; border: 1px solid #ccc; border-radius: 6px; font-size: 15px; margin-top: 6px }
      input[type=text]:focus { outline: none; border-color: #1a6b3c }
      button { width: 100%; padding: 12px; background: #1a6b3c; color: #fff; border: none; border-radius: 6px; font-size: 15px; cursor: pointer; margin-top: 16px }
      button:hover { background: #145230 }
      .note { font-size: 12px; color: #aaa; margin-top: 12px; text-align: center }
      .success { color: #1a6b3c; font-size: 36px; text-align: center; margin-bottom: 16px }
      .err { color: #c00; text-align: center; margin-top: 16px }
      .approve-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin-top: 24px }
    </style>
  </head><body><div class="card">${body}</div></body></html>`
}

function approvalPage(token, t, items = []) {
  const itemRows = items.map(it => {
    const lv = it.level ?? 1
    const spec = [
      it.notes,
      it.product_standard && it.product_standard !== 'NO' ? it.product_standard : null,
      it.material_standard && it.material_standard !== 'NO' ? it.material_standard : null,
    ].filter(Boolean).join('  ')
    return `
    <tr class="${lv === 1 ? 'lv1' : ''}">
      <td style="text-align:center;color:#666;width:30px">${lv}</td>
      <td class="lv${lv}" style="font-family:monospace">${it.tg_part_no ?? ''}</td>
      <td>${it.part_name ?? ''}</td>
      <td style="color:#555;font-size:11px">${spec}</td>
      <td style="text-align:center;width:50px">${it.quantity != null ? Math.round(it.quantity) : ''}</td>
      <td style="text-align:center;width:60px">${it.mass_gram != null ? Number(it.mass_gram).toLocaleString() : ''}</td>
    </tr>`
  }).join('')

  return layout(`
    <h2 style="margin-bottom:16px">✉️ ขออนุมัติ BOM Document</h2>

    <div style="background:#f8f9ff;border:1px solid #dde;border-radius:8px;padding:14px;margin-bottom:24px;display:grid;grid-template-columns:1fr 1fr;gap:0">
      <div class="info-row"><span class="info-label">TGT Part No.</span><span class="info-val">${t.tg_part_no ?? '-'}</span></div>
      <div class="info-row"><span class="info-label">Customer Part No.</span><span class="info-val">${t.customer_part_no ?? '-'}</span></div>
      <div class="info-row"><span class="info-label">Model</span><span class="info-val">${t.model ?? '-'} · ${t.model_name ?? ''}</span></div>
      <div class="info-row" style="border:none"><span class="info-label">ECI No.</span><span class="info-val">${t.internal_eci_no ?? '-'}</span></div>
    </div>

    ${items.length > 0 ? `
    <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#1a3a6b">รายการ BOM (${items.length} รายการ)</div>
    <div style="overflow-x:auto;margin-bottom:8px">
      <table class="bom-tbl">
        <thead>
          <tr>
            <th style="width:30px">Lv</th>
            <th style="width:160px">TG Part No.</th>
            <th>Part Name</th>
            <th>Material Spec</th>
            <th style="width:50px">Q'ty</th>
            <th style="width:60px">Weight (g)</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>` : ''}

    <div class="approve-box">
      <form method="POST" action="/approve/${token}">
        <label style="font-size:14px;font-weight:700;display:block;margin-bottom:8px;color:#1a3a6b">ชื่อผู้อนุมัติ (Approved by)</label>
        <input type="text" name="approved_by" placeholder="กรอกชื่อ-นามสกุล" required autofocus />
        <button type="submit">✅ ยืนยันการอนุมัติ</button>
      </form>
      <p class="note">ลิงก์นี้ใช้ได้ครั้งเดียว</p>
    </div>
  `)
}

function donePage(name, at) {
  const d = new Date(at).toLocaleString('th-TH')
  return layout(`
    <div class="success">✅</div>
    <h2 style="text-align:center">อนุมัติเรียบร้อยแล้ว</h2>
    <div class="info-row" style="margin-top:16px"><span class="info-label">อนุมัติโดย</span><span class="info-val">${name}</span></div>
    <div class="info-row"><span class="info-label">วันที่</span><span class="info-val">${d}</span></div>
    <p class="note" style="margin-top:20px">ระบบได้บันทึกชื่อผู้อนุมัติลงใน BOM แล้ว</p>
  `)
}

function errorPage(msg) {
  return layout(`<h2 style="color:#c00;text-align:center">⚠️ ${msg}</h2>`)
}

export default router
