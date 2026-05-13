const FIELDS = [
  ['Model', 'model'],
  ['Customer Part No.', 'customer_part_no'],
  ['Production Level', 'production_level'],
  ['Control Rank', 'control_rank'],
  ['REG/CERTIF', 'reg_certif'],
  ['Date', 'date'],
  ['Customer', 'customer'],
  ['TG Part No.', 'tg_part_no'],
  ['Customer Standards', 'customer_standards'],
  ['TG Standards', 'tg_standards'],
  ['Internal ECI No.', 'internal_eci_no'],
  ['Type', 'type'],
]

function BomHeader({ bom }) {
  return (
    <div className="bom-header-card">
      <div className="bom-header-card__title">Design Specification Instruction</div>
      <div className="bom-header-card__grid">
        {FIELDS.map(([label, key]) => (
          <div key={key} className="bom-header-card__field">
            <span className="bom-header-card__label">{label}</span>
            <span className="bom-header-card__value">{bom[key] ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default BomHeader
