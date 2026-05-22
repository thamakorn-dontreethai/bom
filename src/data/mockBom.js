export const MOCK_STATS = { total: 12, pending: 3, approved: 8, processing: 1 }

export const MOCK_BOM_LIST = [
  { id: 1, tgPartNo: '78500-DA000-6V00', model: '3GJ', eciNo: '26A376', date: '2026/02/02', pages: 5, parts: 28, status: 'parsing', daysAgo: 0 },
  { id: 2, tgPartNo: '78500-DA010-6Y00', model: '3GJ', eciNo: '26A312', date: '2026/01/15', pages: 4, parts: 24, status: 'approved', daysAgo: 3 },
  { id: 3, tgPartNo: 'GS110-88730-C',    model: '3FS', eciNo: '25B104', date: '2025/12/20', pages: 3, parts: 18, status: 'draft',    daysAgo: 45 },
]

export const MOCK_BOM_HEADER = {
  model: '3GJ',
  customerPartNo: '78500-3DA-J110-M1',
  tgPartNo: '78500-DA000-6***',
  eciNo: '26A376',
  date: '2026/02/02',
}

// Flat DFS-ordered items — Key 1 (NH-900L Charcoal)
export const KEY1_ITEMS = [
  { id:  1, level: 1, key: '1',   tgPartNo: '78500-DA000-6V00', customerPartNo: '78500-3DA-J110-M1', partName: 'WHEEL ASSY, STEERING (N)',   qty: 1, mass: 1727, std: 'IN DRAWING', note: '(N)HEATER AUDIO CRUISE LEATER:NH-900L' },
  { id:  2, level: 2, key: '1',   tgPartNo: 'GS110-88730-C',    customerPartNo: '78501-3DA-T700',    partName: 'GRIP COMP (HE)',              qty: 1, mass: 1208, std: 'NO',         note: 'GRIP(HE) + LEATHER(NH-900L) + SPRING THREAD:NH-906L TGT' },
  { id:  3, level: 3, key: '1',   tgPartNo: 'GS110-88710-C',    partName: 'GRIP (HE)',               qty: 1, mass: 1202, std: 'NO',         note: 'GRIP(LH) + LEATHER HA80 AFTER LEATHER WRAPPED THREAD:EURO(NH-906L)' },
  { id:  4, level: 4, key: '1-2', tgPartNo: 'GS111-21760-A',    partName: 'GRIP (HE)',               qty: 1, mass: 977,  std: 'IN DRAWING', note: 'PU FORM FOR GRIP(HE) HA78 BEFORE LEATHER WRAPPED TGT' },
  { id:  5, level: 5, key: '1-2', tgPartNo: 'GS120-10170-B',    partName: 'HUB CORE',                qty: 1, mass: 677,  std: 'IN DRAWING', note: '3FS Mg/AM60B MASS PRODUCTION(TGT)' },
  { id:  6, level: 5, key: '1-2', tgPartNo: 'GS129-03810',      partName: 'WEIGHT',                  qty: 1, mass: 90,   std: '-',          note: 'MATERIAL:Fe 6H SIDE TGT' },
  { id:  7, level: 4, key: '1',   tgPartNo: 'GS113-57020-B',    partName: 'LEATHER, STEERING WHEEL', qty: 1, mass: 116,  std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER LOOP(NH-900L) MIDORI THREAD(EURO):NH-906L TGT' },
  { id:  8, level: 5, key: '1',   tgPartNo: 'GS113-56980',      partName: 'LEATHER NO.1',            qty: 1, mass: 46,   std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER (NH-900L) MIDORI TGT' },
  { id:  9, level: 5, key: '1',   tgPartNo: 'GS113-56990',      partName: 'LEATHER NO.2',            qty: 1, mass: 21,   std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER (NH-900L) MIDORI TGT' },
  { id: 10, level: 5, key: '1',   tgPartNo: 'GS113-57000',      partName: 'LEATHER NO.3',            qty: 1, mass: 21,   std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER (NH-900L) MIDORI TGT' },
  { id: 11, level: 5, key: '1',   tgPartNo: 'GS113-57010',      partName: 'LEATHER NO.4',            qty: 1, mass: 27,   std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER (NH-900L) MIDORI TGT' },
  { id: 12, level: 4, key: '1-2', tgPartNo: 'GS119-33430-C',    partName: 'HEATER PAD ASSY',         qty: 1, mass: 86,   std: 'NO',         note: 'KURABE HEATER PAD 3FS/3FR' },
  { id: 13, level: 3, key: '1-2', tgPartNo: 'GS129-02340-A',    partName: 'SNAP SPRING',             qty: 3, mass: 2.1,  std: 'NO',         note: 'GS129-01530 IS AVAILABLE,TOO.' },
  { id: 14, level: 2, key: '1-2', tgPartNo: 'GS131-21900-A',    partName: 'BODY COVER(WITH PDL)',    qty: 1, mass: 86,   std: 'NO',         note: '3GJ BODY COVER TGT' },
  { id: 15, level: 2, key: '1-2', tgPartNo: '35880-MAB30',       customerPartNo: '35880-3MA-B310-M1', partName: 'SW ASSY,STRG',              qty: 1, mass: 263,  std: 'NO',         note: 'HM SUPPLY PARTS' },
  { id: 16, level: 3, key: '1-2', tgPartNo: 'GS119-34330',      partName: 'LWR GARNISH',             qty: 1, mass: 11.1, std: 'IN DRAWING', note: 'PAINT NH-892L TGT' },
  { id: 17, level: 3, key: '1-2', tgPartNo: 'GS119-34320',      partName: 'LWR GARNISH',             qty: 1, mass: 11,   std: 'IN DRAWING', note: 'LWR GNSH PC+ABS BEFOR PAINTING' },
  { id: 18, level: 2, key: '1-2', tgPartNo: 'GE400-01540-B',    customerPartNo: '78550-3MA-A113-M1', partName: 'ASSY, HSW ECU',             qty: 1, mass: 36,   std: 'NO',         note: '3FS ECU' },
  { id: 19, level: 2, key: '1-2', tgPartNo: '78560-DAH80',       customerPartNo: '78560-3DA-H810-M1', partName: 'SW ASSY,PADDLE SHIFT',      qty: 1, mass: 100,  std: 'NO',         note: 'PDL ASSY/HM SUPPLY PARTS' },
  { id: 20, level: 2, key: '1-2', tgPartNo: 'GS250-02000-A',    customerPartNo: '77902-3MA-A111-M1', partName: 'CORD HSW SUB',              qty: 1, mass: 9,    std: 'IN DRAWING', note: 'HE POWER HARNESS, FUJIKURA (TGT)' },
  { id: 21, level: 2, key: '1-2', tgPartNo: 'GK110-A0100',      customerPartNo: '93893-04012-17',    partName: 'SCREW-WASH, 4X12',          qty: 7, mass: 2,    std: 'NO',         note: 'SCREW-WASH, 4X12' },
  { id: 22, level: 2, key: '1-2', tgPartNo: 'GS139-16610',      partName: 'SEAL',                    qty: 1, mass: 0.1,  std: '-',          note: 'ADHESION SHEET' },
]

// Flat DFS-ordered items — Key 2 (NH-1168L Gray)
export const KEY2_ITEMS = [
  { id: 101, level: 1, key: '2',   tgPartNo: '78500-DA010-6Y00', customerPartNo: '78500-3DA-J310-M1', partName: 'WHEEL ASSY, STEERING (C)',   qty: 1, mass: 1727, std: 'IN DRAWING', note: '(C)HEATER AUDIO CRUISE LEATER:NH-1168L' },
  { id: 102, level: 2, key: '2',   tgPartNo: 'GS110-89370-C',    customerPartNo: '78501-3DA-T900',    partName: 'GRIP COMP (HE)',              qty: 1, mass: 1208, std: 'NO',         note: 'GRIP(HE) + LEATHER(NH-1168L) + SPRING THREAD:NH-802L TGT' },
  { id: 103, level: 3, key: '2',   tgPartNo: 'GS110-89360-C',    partName: 'GRIP (HE)',               qty: 1, mass: 1202, std: 'NO',         note: 'GRIP(HE) + LEATHER HA80 AFTER LEATHER WRAPPED THREAD:EURO(NH-802L) TGT' },
  { id: 104, level: 4, key: '1-2', tgPartNo: 'GS111-21760-A',    partName: 'GRIP (HE)',               qty: 1, mass: 977,  std: 'IN DRAWING', note: 'PU FORM FOR GRIP(HE) HA78 BEFORE LEATHER WRAPPED TGT' },
  { id: 105, level: 5, key: '1-2', tgPartNo: 'GS120-10170-B',    partName: 'HUB CORE',                qty: 1, mass: 677,  std: 'IN DRAWING', note: '3FS Mg/AM60B MASS PRODUCTION(TGT)' },
  { id: 106, level: 5, key: '1-2', tgPartNo: 'GS129-03810',      partName: 'WEIGHT',                  qty: 1, mass: 90,   std: '-',          note: 'MATERIAL:Fe 6H SIDE TGT' },
  { id: 107, level: 4, key: '2',   tgPartNo: 'GS113-57940-B',    partName: 'LEATHER, STEERING WHEEL', qty: 1, mass: 116,  std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER LOOP(NH-1168L) MIDORI THREAD(EURO):NH-802L TGT' },
  { id: 108, level: 5, key: '2',   tgPartNo: 'GS113-57900-A',    partName: 'LEATHER NO.1',            qty: 1, mass: 46,   std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER (NH-1168L) MIDORI TGT' },
  { id: 109, level: 5, key: '2',   tgPartNo: 'GS113-57910-A',    partName: 'LEATHER NO.2',            qty: 1, mass: 21,   std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER (NH-1168L) MIDORI TGT' },
  { id: 110, level: 5, key: '2',   tgPartNo: 'GS113-57920-A',    partName: 'LEATHER NO.3',            qty: 1, mass: 21,   std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER (NH-1168L) MIDORI TGT' },
  { id: 111, level: 5, key: '2',   tgPartNo: 'GS113-57930-A',    partName: 'LEATHER NO.4',            qty: 1, mass: 27,   std: 'IN DRAWING', note: '(HE)SYNTHETIC LEATHER (NH-1168L) MIDORI TGT' },
  { id: 112, level: 4, key: '1-2', tgPartNo: 'GS119-33430-C',    partName: 'HEATER PAD ASSY',         qty: 1, mass: 86,   std: 'NO',         note: 'KURABE HEATER PAD 3FS/3FR' },
  { id: 113, level: 3, key: '1-2', tgPartNo: 'GS129-02340-A',    partName: 'SNAP SPRING',             qty: 3, mass: 2.1,  std: 'NO',         note: 'GS129-01530 IS AVAILABLE,TOO.' },
  { id: 114, level: 2, key: '1-2', tgPartNo: 'GS131-21900-A',    partName: 'BODY COVER(WITH PDL)',    qty: 1, mass: 86,   std: 'NO',         note: '3GJ BODY COVER TGT' },
  { id: 115, level: 2, key: '1-2', tgPartNo: '35880-MAB30',       customerPartNo: '35880-3MA-B310-M1', partName: 'SW ASSY,STRG',              qty: 1, mass: 263,  std: 'NO',         note: 'HM SUPPLY PARTS' },
  { id: 116, level: 3, key: '1-2', tgPartNo: 'GS119-34330',      partName: 'LWR GARNISH',             qty: 1, mass: 11.1, std: 'IN DRAWING', note: 'PAINT NH-892L TGT' },
  { id: 117, level: 3, key: '1-2', tgPartNo: 'GS119-34320',      partName: 'LWR GARNISH',             qty: 1, mass: 11,   std: 'IN DRAWING', note: 'LWR GNSH PC+ABS BEFOR PAINTING' },
  { id: 118, level: 2, key: '1-2', tgPartNo: 'GE400-01540-B',    customerPartNo: '78550-3MA-A113-M1', partName: 'ASSY, HSW ECU',             qty: 1, mass: 36,   std: 'NO',         note: '3FS ECU' },
  { id: 119, level: 2, key: '1-2', tgPartNo: '78560-DAH80',       customerPartNo: '78560-3DA-H810-M1', partName: 'SW ASSY,PADDLE SHIFT',      qty: 1, mass: 100,  std: 'NO',         note: 'PDL ASSY/HM SUPPLY PARTS' },
  { id: 120, level: 2, key: '1-2', tgPartNo: 'GS250-02000-A',    customerPartNo: '77902-3MA-A111-M1', partName: 'CORD HSW SUB',              qty: 1, mass: 9,    std: 'IN DRAWING', note: 'HE POWER HARNESS, FUJIKURA (TGT)' },
  { id: 121, level: 2, key: '1-2', tgPartNo: 'GK110-A0100',      customerPartNo: '93893-04012-17',    partName: 'SCREW-WASH, 4X12',          qty: 7, mass: 2,    std: 'NO',         note: 'SCREW-WASH, 4X12' },
  { id: 122, level: 2, key: '1-2', tgPartNo: 'GS139-16610',      partName: 'SEAL',                    qty: 1, mass: 0.1,  std: '-',          note: 'ADHESION SHEET' },
]
