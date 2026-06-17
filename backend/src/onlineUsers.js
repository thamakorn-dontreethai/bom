// Real-time "who is online" tracker, independent of which BOM they view.
// Keyed by display name (full_name || username) so it lines up with tg.users.
// In-memory; resets on server restart (fine for live presence).
const seen = new Map()   // name -> lastSeenMs
// 60s grace: tolerates browser background-tab throttling (hidden tabs ping ~once/min)
// and brief gaps like a backend restart, without flickering to offline.
const TTL_MS = 60000

export function touchOnline(name) {
  if (name) seen.set(name, Date.now())
}

export function dropOnline(name) {
  if (name) seen.delete(name)
}

// Set of names currently online (also prunes expired entries).
export function onlineNames() {
  const now = Date.now()
  const out = new Set()
  for (const [name, ts] of seen) {
    if (now - ts <= TTL_MS) out.add(name)
    else seen.delete(name)
  }
  return out
}
