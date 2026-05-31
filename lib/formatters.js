// lib/formatters.js
// ═══════════════════════════════════════════════════════════════════
// Utilidades puras de formato. Sin efectos secundarios, sin imports
// de React ni Supabase. Testeables con Jest directamente.
// ═══════════════════════════════════════════════════════════════════

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
]

const MESES_CORTO = [
  'Ene','Feb','Mar','Abr','May','Jun',
  'Jul','Ago','Sep','Oct','Nov','Dic'
]

export const fmt = n =>
  n ? '$' + Number(n).toLocaleString('es-AR') : '$0'

export const fmtN = n =>
  (Number(n) || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export const fmtD = d =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR') : '—'

export const periodoLabel = p => {
  if (!p) return '—'
  const [y, m] = p.split('-')
  return `${MESES[parseInt(m) - 1]} ${y}`
}

export const periodoLabelCorto = p => {
  if (!p) return '—'
  const [y, m] = p.split('-')
  return `${MESES_CORTO[parseInt(m) - 1]} ${y}`
}

export const nextId = (items, prefix) => {
  const nums = (items || [])
    .map(x => x.id || '')
    .filter(id => id.startsWith(prefix))
    .map(id => parseInt(id.slice(prefix.length), 10))
    .filter(n => !isNaN(n))
  return prefix + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')
}

export const periodoActual = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export const colGasto = cat => {
  const MAP = {
    'Personal': '#1A3FA0',
    'Mantenimiento': '#C07D10',
    'Servicios': '#1B6B35',
    'Seguros': '#6d28d9',
    'Impuestos': '#B91C1C',
    'Administración': '#0891b2',
  }
  return MAP[cat] || '#6B7280'
}
