import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { pool, initDb } from './db.js'
import bomRouter from './routes/bom.js'
import importRouter from './routes/import.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

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

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`BOM API running on http://localhost:${PORT}`))
  })
  .catch((e) => {
    console.error('DB init failed:', e.message)
    process.exit(1)
  })
