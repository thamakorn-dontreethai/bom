require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { initDb, getPool } = require('./db')

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

app.get('/api/health', async (_req, res) => {
  try {
    const pool = await getPool()
    await pool.request().query('SELECT 1')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.use('/api/bom', require('./routes/bom'))

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`BOM API running on http://localhost:${PORT}`)
    })
  })
  .catch((e) => {
    console.error('DB init failed:', e.message)
    process.exit(1)
  })
