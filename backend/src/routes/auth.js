import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'
import { requireAuth, requireEngineering } from '../middleware/auth.js'

const router = Router()
const SECRET = process.env.JWT_SECRET || 'bom-secret-change-in-prod'

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' })
  try {
    const { rows } = await pool.query(
      'SELECT id, username, password_hash, role FROM tg.users WHERE username = $1',
      [username.trim().toLowerCase()]
    )
    const user = rows[0]
    if (!user) return res.status(401).json({ error: 'Invalid credentials' })
    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: '8h' })
    res.json({ token, username: user.username, role: user.role })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role })
})

// GET /api/auth/users  (engineering only — list users)
router.get('/users', requireAuth, requireEngineering, async (_req, res) => {
  const { rows } = await pool.query('SELECT id, username, role, created_at FROM tg.users ORDER BY id')
  res.json(rows)
})

// POST /api/auth/users  (engineering only — create user)
router.post('/users', requireAuth, requireEngineering, async (req, res) => {
  const { username, password, role } = req.body
  if (!username || !password || !['engineering', 'purchase'].includes(role))
    return res.status(400).json({ error: 'username, password, role (engineering|purchase) required' })
  try {
    const hash = await bcrypt.hash(password, 10)
    const { rows } = await pool.query(
      'INSERT INTO tg.users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username.trim().toLowerCase(), hash, role]
    )
    res.status(201).json(rows[0])
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username already exists' })
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/auth/users/:id  (engineering only)
router.delete('/users/:id', requireAuth, requireEngineering, async (req, res) => {
  await pool.query('DELETE FROM tg.users WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

export default router
