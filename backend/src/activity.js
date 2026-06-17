import { pool } from './db.js'

// Record an audit-log entry. Fire-and-forget — never blocks/breaks the caller.
export function logActivity(user, action, target = null, detail = null) {
  const name = user?.full_name || user?.username || 'unknown'
  pool.query(
    `INSERT INTO tg.activity_log (user_name, action, target, detail) VALUES ($1,$2,$3,$4)`,
    [name, action, target, detail]
  ).catch(() => {})
}
