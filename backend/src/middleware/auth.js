import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET || 'bom-secret-change-in-prod'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    req.user = jwt.verify(header.slice(7), SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

export function requireEngineering(req, res, next) {
  if (req.user?.role !== 'engineering') return res.status(403).json({ error: 'Engineering only' })
  next()
}
