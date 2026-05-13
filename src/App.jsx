import { useState, useEffect } from 'react'
import BomHeader from './components/BomHeader'
import BomTree from './components/BomTree'
import './App.css'

function App() {
  const [bomList, setBomList] = useState([])
  const [activeBom, setActiveBom] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchBomList()
  }, [])

  async function fetchBomList() {
    try {
      const res = await fetch('/api/bom')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setBomList(data)
      if (data.length > 0) loadBom(data[0].id)
    } catch (e) {
      setError('Cannot connect to API — is the backend running on port 3001?')
    }
  }

  async function loadBom(id) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/bom/${id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setActiveBom(await res.json())
    } catch (e) {
      setError('Failed to load BOM: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="app-bar">
        <span className="app-bar__title">BOM Management System</span>
        <span className="app-bar__sub">TOYODA GOSEI CO., LTD.</span>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar__heading">Documents</div>
          <ul className="sidebar__list">
            {bomList.map(b => (
              <li
                key={b.id}
                className={`sidebar__item${activeBom?.id === b.id ? ' sidebar__item--active' : ''}`}
                onClick={() => loadBom(b.id)}
              >
                <span className="sidebar__model">{b.model}</span>
                <span className="sidebar__partno">{b.customer_part_no}</span>
                <span className="sidebar__name">{b.part_name}</span>
              </li>
            ))}
          </ul>
        </aside>

        <main className="main">
          {error && <div className="alert alert--error">{error}</div>}
          {loading && <div className="loading">Loading…</div>}
          {activeBom && !loading && (
            <>
              <BomHeader bom={activeBom} />
              <BomTree bom={activeBom} onRefresh={() => loadBom(activeBom.id)} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
