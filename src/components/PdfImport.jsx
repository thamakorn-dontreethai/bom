import { useState, useRef } from 'react'

function PdfImport({ onClose, onRefresh }) {
  const [step, setStep] = useState('idle')   // idle | parsing | result | error
  const [result, setResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')
  const fileRef = useRef(null)

  async function handleUpload() {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setStep('parsing')
    setErrMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/import/pdf', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setResult(data)
      setStep('result')
    } catch (e) {
      setErrMsg(e.message)
      setStep('error')
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__header">
          <span>Import PDF — Parse Part Numbers</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {(step === 'idle' || step === 'error') && (
            <>
              <p className="modal__hint">
                Select a BOM PDF file. The system will extract TG part numbers and match them against the database.
              </p>
              <div className="modal__file-row">
                <input ref={fileRef} type="file" accept=".pdf" className="modal__file-input" />
                <button className="btn-primary" onClick={handleUpload}>Parse PDF</button>
              </div>
              {step === 'error' && (
                <div className="modal__error">{errMsg}</div>
              )}
            </>
          )}

          {step === 'parsing' && (
            <div className="modal__loading">Parsing PDF…</div>
          )}

          {step === 'result' && result && (
            <>
              <div className="modal__stats">
                <span className="stat stat--ok">{result.found.length} parts matched</span>
                <span className="stat stat--warn">{result.missing.length} not found in DB</span>
              </div>

              {result.found.length > 0 && (
                <div className="modal__section">
                  <div className="modal__section-title">Matched Parts</div>
                  <table className="modal-table">
                    <thead>
                      <tr>
                        <th>TG Part No.</th>
                        <th>Customer Part No.</th>
                        <th>Part Name</th>
                        <th>Mass (g)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.found.map(p => (
                        <tr key={p.part_id}>
                          <td>{p.tg_part_no}</td>
                          <td>{p.customer_part_no ?? ''}</td>
                          <td>{p.part_name}</td>
                          <td>{p.mass_gram ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.missing.length > 0 && (
                <div className="modal__section">
                  <div className="modal__section-title">Not Found in Database</div>
                  <ul className="modal__missing-list">
                    {result.missing.map(p => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              )}

              <div className="modal__actions">
                <button className="btn-secondary" onClick={() => { setStep('idle'); setResult(null) }}>
                  Parse Another
                </button>
                <button className="btn-primary" onClick={onClose}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default PdfImport
