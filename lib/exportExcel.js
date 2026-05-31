// lib/exportExcel.js — Exportación a CSV/Excel para GASP Consorcios.
// Compatible con Excel argentino (separador ;, BOM UTF-8).
// Antes: exportarExcel() en el scope global de index.jsx.
// Ahora: módulo independiente.

export function exportarExcel({ titulo, columnas, filas }) {
  const BOM = '\uFEFF'
  const headers = columnas.map(c => `"${c.label}"`).join(';')
  const rows = filas.map(f =>
    columnas.map(c => {
      const val = f[c.key] ?? ''
      const str = String(val).replace(/"/g, '""')
      return `"${str}"`
    }).join(';')
  )
  const csv = BOM + [headers, ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `${titulo.replace(/\s/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
