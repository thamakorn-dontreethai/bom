import express from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'
import { signToken, requireAuth, requireAdmin } from '../middleware/auth.js'
import { logActivity } from '../activity.js'
import { touchOnline, dropOnline, onlineNames } from '../onlineUsers.js'

const router = express.Router()

const ROLES = ['admin', 'engineering', 'purchase']
const displayName = u => u?.full_name || u?.username || 'unknown'

/* ── POST /api/auth/login  { username, password } ── */
router.post('/login', async (req, res) => {
  const username = (req.body.username ?? '').trim()
  const password = req.body.password ?? ''
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' })

  const { rows } = await pool.query('SELECT * FROM tg.users WHERE username = $1 LIMIT 1', [username])
  const user = rows[0]
  if (!user) return res.status(401).json({ error: 'invalid_credentials' })

  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' })

  const token = signToken(user)
  touchOnline(displayName(user))
  logActivity(user, 'login', user.username, user.role)
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
  })
})

/* ── POST /api/auth/ping  — heartbeat: "I'm still here" (keeps online status live) ── */
router.post('/ping', requireAuth, (req, res) => {
  touchOnline(displayName(req.user))
  res.json({ ok: true })
})

/* ── POST /api/auth/logout  — record sign-out ── */
router.post('/logout', requireAuth, (req, res) => {
  dropOnline(displayName(req.user))
  logActivity(req.user, 'logout', req.user.username)
  res.json({ ok: true })
})

/* ── GET /api/auth/me  — current user from token ── */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: {
    id: req.user.id, username: req.user.username, role: req.user.role, full_name: req.user.full_name,
  } })
})

/* ── POST /api/auth/change-password  { current_password, new_password }
   Self-service: the logged-in user changes their OWN password. ── */
router.post('/change-password', requireAuth, async (req, res) => {
  const current = req.body.current_password ?? ''
  const next    = req.body.new_password ?? ''
  if (!current || !next) return res.status(400).json({ error: 'missing_fields' })
  if (next.length < 4)   return res.status(400).json({ error: 'password_too_short' })

  const { rows } = await pool.query('SELECT password_hash FROM tg.users WHERE id = $1 LIMIT 1', [req.user.id])
  if (!rows.length) return res.status(404).json({ error: 'not_found' })

  const ok = await bcrypt.compare(current, rows[0].password_hash)
  // 400 (not 401) — a wrong CURRENT password is a validation error, not an
  // expired session; a 401 would trip the global auto-logout in src/auth.js.
  if (!ok) return res.status(400).json({ error: 'wrong_current_password' })

  const hash = await bcrypt.hash(next, 10)
  await pool.query('UPDATE tg.users SET password_hash = $1 WHERE id = $2', [hash, req.user.id])
  logActivity(req.user, 'change_password', req.user.username)
  res.json({ ok: true })
})

/* ── Activity timeline ──
   Admins see everything (login/logout, user CRUD, add, delete).
   Non-admins see ONLY add (import/revise) and delete events. */
router.get('/activity', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500)
  const isAdmin = req.user.role === 'admin'
  const where = isAdmin ? '' : `WHERE action IN ('import','revise','edit','delete')`
  const { rows } = await pool.query(
    `SELECT id, user_name, action, target, detail,
            to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'DD-Mon-YY HH24:MI:SS') AS at,
            extract(epoch FROM created_at) AS ts
     FROM tg.activity_log ${where} ORDER BY created_at DESC LIMIT $1`, [limit]
  )
  res.json(rows)
})

/* ── Admin: user management (all require admin) ── */

// GET /api/auth/users — list (online status from the live heartbeat tracker)
router.get('/users', requireAuth, requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.full_name, u.role,
            to_char(u.created_at,'DD-Mon-YY') AS created
     FROM tg.users u ORDER BY u.id`
  )
  const live = onlineNames()
  res.json(rows.map(u => ({ ...u, online: live.has(u.full_name || u.username) })))
})

// POST /api/auth/users — create  { username, password, full_name, role }
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const username = (req.body.username ?? '').trim()
  const password = req.body.password ?? ''
  const fullName = (req.body.full_name ?? '').trim() || null
  const role     = ROLES.includes(req.body.role) ? req.body.role : 'purchase'
  if (!username || !password) return res.status(400).json({ error: 'username & password required' })

  const { rows: exist } = await pool.query('SELECT 1 FROM tg.users WHERE username=$1', [username])
  if (exist.length) return res.status(409).json({ error: 'username_taken' })

  const hash = await bcrypt.hash(password, 10)
  const { rows } = await pool.query(
    `INSERT INTO tg.users (username, password_hash, full_name, role)
     VALUES ($1,$2,$3,$4) RETURNING id, username, full_name, role`,
    [username, hash, fullName, role]
  )
  logActivity(req.user, 'add_user', username, role)
  res.status(201).json(rows[0])
})

// PATCH /api/auth/users/:id — update name/role/password
router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  const fullName = req.body.full_name !== undefined ? (req.body.full_name?.trim() || null) : undefined
  const role     = req.body.role && ROLES.includes(req.body.role) ? req.body.role : undefined
  const password = req.body.password || undefined

  const sets = [], vals = []
  if (fullName !== undefined) { vals.push(fullName); sets.push(`full_name=$${vals.length}`) }
  if (role     !== undefined) { vals.push(role);     sets.push(`role=$${vals.length}`) }
  if (password !== undefined) { vals.push(await bcrypt.hash(password, 10)); sets.push(`password_hash=$${vals.length}`) }
  if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' })

  vals.push(id)
  const { rows } = await pool.query(
    `UPDATE tg.users SET ${sets.join(', ')} WHERE id=$${vals.length}
     RETURNING id, username, full_name, role`, vals
  )
  if (!rows.length) return res.status(404).json({ error: 'not_found' })
  res.json(rows[0])
})

// DELETE /api/auth/users/:id
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  if (id === req.user.id) return res.status(400).json({ error: 'cannot_delete_self' })
  const { rows: u } = await pool.query('SELECT username FROM tg.users WHERE id=$1', [id])
  await pool.query('DELETE FROM tg.users WHERE id=$1', [id])
  logActivity(req.user, 'remove_user', u[0]?.username ?? String(id))
  res.json({ deleted: true })
})

export default router
