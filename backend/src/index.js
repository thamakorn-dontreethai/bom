import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool, initDb } from './db.js'
import bomRouter from './routes/bom.js'
import importRouter from './routes/import.js'
import approvalRouter from './routes/approval.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '20mb' }))

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.use('/api/bom', bomRouter)
app.use('/api/import', importRouter)
app.use('/api/approval', approvalRouter)
app.use('/approve', approvalRouter)

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// Serve built frontend
const distPath = path.join(__dirname, '../../dist')
app.use(express.static(distPath))
app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')))

initDb()
  .then(() => {
    const server = app.listen(PORT, () => console.log(`BOM API running on http://localhost:${PORT}`))
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} already in use — using existing server`)
      } else {
        console.error('Server error:', err.message)
        process.exit(1)
      }
    })
  })
  .catch((e) => {
    console.error('DB init failed:', e.message)
    process.exit(1)
  })
