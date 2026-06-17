import express from 'express'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()

// In-memory presence: bomId -> Map<userName, lastSeenMs>. Resets on server restart (fine for live presence).
const presence = new Map()
const TTL_MS = 8000   // a user is "active" if seen within the last 8s (heartbeat is every 3s)

function activeUsers(bomId) {
  const m = presence.get(bomId)
  if (!m) return []
  const now = Date.now()
  const out = []
  for (const [name, ts] of m) {
    if (now - ts <= TTL_MS) out.push(name)
    else m.delete(name)
  }
  if (!m.size) presence.delete(bomId)
  return out
}

function userName(req) {
  return req.user?.full_name || req.user?.username || 'unknown'
}

/* ── POST /api/presence/:bomId  — heartbeat: "I'm viewing this BOM" ── */
router.post('/:bomId', requireAuth, (req, res) => {
  const bomId = parseInt(req.params.bomId)
  if (!presence.has(bomId)) presence.set(bomId, new Map())
  presence.get(bomId).set(userName(req), Date.now())
  res.json({ ok: true, viewers: activeUsers(bomId) })
})

/* ── DELETE /api/presence/:bomId  — leave (user closed/left the BOM) ── */
router.delete('/:bomId', requireAuth, (req, res) => {
  const bomId = parseInt(req.params.bomId)
  presence.get(bomId)?.delete(userName(req))
  res.json({ ok: true })
})

/* ── GET /api/presence  — { bomId: [names] } for all BOMs with active viewers ── */
router.get('/', requireAuth, (_req, res) => {
  const result = {}
  for (const bomId of [...presence.keys()]) {
    const users = activeUsers(bomId)
    if (users.length) result[bomId] = users
  }
  res.json(result)
})

export default router
