import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'bom-dev-secret-change-me'
const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h'

export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  )
}

// Require a valid token; attaches req.user
export function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || ''
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null
  if (!token) return res.status(401).json({ error: 'unauthorized' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'invalid_token' })
  }
}

// Require an admin role (use after requireAuth)
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  next()
}
