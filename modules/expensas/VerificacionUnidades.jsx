import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext'

const C = {
  bg: '#F7F8FA', surface: '#FFFFFF', border: '#E4E7ED',
  primary: '#1F4E79', accent: '#2E86C1', success: '#1A7A5E',
  warning: '#D4860B', danger: '#C0392B', text: '#1A2332', muted: '#6B7A8D', light: '#F0F4F8',
}
const font = "'IBM Plex Mono', 'Courier New', monospace"
const sans = "'IBM Plex Sans', system-ui, sans-serif"
const SB = 'https://payzqbkydmvovjxlznuq.supabase.co'
const AK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBheXpxYmt5ZG12b3ZqeGx6bnVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0OTg0ODAsImV4cCI6MjA5MTA3NDQ4MH0.ut-cHjkd1oztZa-W3uYRbHDScEB4RLg55WtfIcBidm8'

export default function VerificacionUnidades() {
  const { session } = useApp()
  const tok = session?.access_token
  const hdrs = { apikey: AK, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }

  const [consorcios, setConsorcios] = useState([])
  const [selected, setSelected]     = useState(null)
  const [unidades, setUnidades]     = useState([])
  const [editMap, setEditMap]       = useState({})
  const [loading, setLoading]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState(null)
  const [filterProb, setFilterProb] = useState(false)

  useEffect(() => {
    fetch(`${SB}/rest/v1/con_consorcios?select=id,nombre,formato_liquidacion&order=nombre`, { headers: hdrs })
      .then(r => r.json()).then(d => setConsorcios(Array.isArray(d) ? d : []))
  }, [])

  const cargarUnidades = useCallback(async (conId) => {
    setLoading(true); setMsg(null); setEditMap({})
    try {
      const r = await fetch(
        `${SB}/rest/v1/con_unidades?consorcio_id=eq.${conId}&select=id,numero,tipo,nro_uf_pdf,propietario_id&order=id`,
        { headers: hdrs }
      )
      const ufs = await r.json()
      const propIds = [...new Set((ufs || []).map(u => u.propietario_id).filter(Boolean))]
      let propMap = {}
      if (propIds.length) {
        const rp = await fetch(`${SB}/rest/v1/con_copropietarios?id=in.(${propIds.join(',')})&select=id,apellido_nombre`, { headers: hdrs })
        const props = await rp.json();
        (props || []).forEach(p => { propMap[p.id] = p.apellido_nombre })
      }
      const enriched = (ufs || []).map(u => ({ ...u, propietario: propMap[u.propietario_id] || '—' }))
      enriched.sort((a, b) => {
        const na = parseInt(a.nro_uf_pdf || '9999', 10), nb = parseInt(b.nro_uf_pdf || '9999', 10)
        return na !== nb ? na - nb : a.id.localeCompare(b.id)
      })
      setUnidades(enriched)
    } finally { setLoading(false) }
  }, [tok])

  const seleccionar = (con) => { setSelected(con); setFilterProb(false); cargarUnidades(con.id) }

  const guardar = async () => {
    const cambios = Object.entries(editMap).filter(([, v]) => v !== undefined)
    if (!cambios.length) { setMsg({ tipo: 'warn', texto: 'Sin cambios para guardar.' }); return }
    setSaving(true); setMsg(null)
    let ok = 0, err = 0
    for (const [uid, val] of cambios) {
      const r = await fetch(`${SB}/rest/v1/con_unidades?id=eq.${uid}`, {
        method: 'PATCH', headers: { ...hdrs, Prefer: 'return=minimal' },
        body: JSON.stringify({ nro_uf_pdf: val === '' ? null : val.trim() })
      })
      if (r.ok) ok++; else err++
    }
    setSaving(false)
    setMsg({ tipo: err ? 'warn' : 'ok', texto: `Guardado: ${ok} OK${err ? `, ${err} errores` : ''}.` })
    if (ok) { setEditMap({}); cargarUnidades(selected.id) }
  }

  const autoAsignar = () => {
    const sinPdf = unidades.filter(u => !u.nro_uf_pdf && editMap[u.id] === undefined)
    let next = Math.max(0, ...unidades.map(u => parseInt(u.nro_uf_pdf || '0', 10))) + 1
    const nuevos = {}
    sinPdf.forEach(u => { nuevos[u.id] = String(next).padStart(2, '0'); next++ })
    setEditMap(prev => ({ ...prev, ...nuevos }))
    setMsg({ tipo: 'info', texto: `${sinPdf.length} UFs asignadas correlativamente.` })
  }

  const stats = {
    total: unidades.length,
    sinPdf: unidades.filter(u => !u.nro_uf_pdf && editMap[u.id] === undefined).length,
    pendientes: Object.keys(editMap).length,
    duplicados: (() => {
      const vals = unidades.map(u => editMap[u.id] !== undefined ? editMap[u.id] : u.nro_uf_pdf).filter(Boolean)
      return vals.length - new Set(vals).size
    })(),
  }

  const ufsVisible = filterProb ? unidades.filter(u => !u.nro_uf_pdf && editMap[u.id] === undefined) : unidades

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 80px)', background: C.bg, fontFamily: sans, fontSize: 13, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}` }}>

      {/* Panel izquierdo */}
      <div style={{ width: 240, borderRight: `1px solid ${C.border}`, background: C.surface, overflow: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '14px 12px 10px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: C.muted, textTransform: 'uppercase' }}>Consorcios ({consorcios.length})</div>
        </div>
        {consorcios.map(c => {
          const isSel = selected?.id === c.id
          return (
            <button key={c.id} onClick={() => seleccionar(c)} style={{
              width: '100%', textAlign: 'left', padding: '9px 12px', background: isSel ? C.light : 'transparent',
              border: 'none', borderLeft: `3px solid ${isSel ? C.primary : 'transparent'}`, cursor: 'pointer',
            }}>
              <div style={{ fontWeight: isSel ? 700 : 500, color: isSel ? C.primary : C.text, fontSize: 12, lineHeight: 1.3 }}>{c.nombre}</div>
              <div style={{ fontSize: 10, color: C.muted, fontFamily: font }}>{c.id} · {c.formato_liquidacion}</div>
            </button>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: C.muted }}>
            <div style={{ fontSize: 40 }}>🔍</div>
            <div style={{ fontWeight: 600 }}>Seleccione un consorcio</div>
            <div style={{ fontSize: 12 }}>Verifique y asigne los números de UF del PDF de Mis Expensas</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{selected.nombre}</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: font }}>{selected.id} · {selected.formato_liquidacion}</div>
              </div>
              {[
                { label: 'Total', val: stats.total, color: C.text },
                { label: 'Sin PDF', val: stats.sinPdf, color: stats.sinPdf > 0 ? C.danger : C.success },
                { label: 'Duplicados', val: stats.duplicados, color: stats.duplicados > 0 ? C.danger : C.success },
                { label: 'Pendientes', val: stats.pendientes, color: stats.pendientes > 0 ? C.warning : C.muted },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center', padding: '3px 10px', background: C.light, borderRadius: 6 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: font }}>{s.val}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{s.label}</div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
                {stats.sinPdf > 0 && (
                  <button onClick={autoAsignar} style={{ padding: '6px 12px', background: '#EBF5FB', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                    ⚡ Auto ({stats.sinPdf})
                  </button>
                )}
                <button onClick={() => setFilterProb(f => !f)} style={{
                  padding: '6px 12px', background: filterProb ? C.danger : C.light,
                  color: filterProb ? '#fff' : C.muted, border: `1px solid ${filterProb ? C.danger : C.border}`,
                  borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12
                }}>{filterProb ? '✕ Todos' : `⚠️ Problemas`}</button>
                <button onClick={guardar} disabled={saving || !stats.pendientes} style={{
                  padding: '6px 14px', background: stats.pendientes ? C.primary : C.light,
                  color: stats.pendientes ? '#fff' : C.muted, border: 'none',
                  borderRadius: 6, cursor: stats.pendientes ? 'pointer' : 'default', fontWeight: 700, fontSize: 12
                }}>{saving ? 'Guardando...' : `💾 Guardar${stats.pendientes ? ` (${stats.pendientes})` : ''}`}</button>
              </div>
            </div>

            {msg && (
              <div style={{
                margin: '8px 16px 0', padding: '7px 12px', borderRadius: 6, fontSize: 12,
                background: msg.tipo === 'ok' ? '#D5F5E3' : msg.tipo === 'info' ? '#EBF5FB' : '#FEF9E7',
                color: msg.tipo === 'ok' ? C.success : msg.tipo === 'info' ? C.accent : C.warning,
              }}>{msg.texto}</div>
            )}

            {loading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>Cargando...</div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto', padding: '10px 16px 16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: C.light, position: 'sticky', top: 0 }}>
                      {[['nro_uf_pdf', '90px'], ['ID Sistema', '190px'], ['Número', '90px'], ['Tipo', '90px'], ['Propietario', 'auto'], ['Estado', '90px']].map(([h, w]) => (
                        <th key={h} style={{ padding: '7px 9px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: C.muted, textTransform: 'uppercase', borderBottom: `2px solid ${C.border}`, width: w }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ufsVisible.map((u, i) => {
                      const editVal = editMap[u.id]
                      const current = editVal !== undefined ? editVal : (u.nro_uf_pdf || '')
                      const hasEdit = editVal !== undefined
                      const isEmpty = !current
                      const isDup = current && ufsVisible.filter(x => {
                        const v = editMap[x.id] !== undefined ? editMap[x.id] : (x.nro_uf_pdf || '')
                        return v === current && x.id !== u.id
                      }).length > 0
                      const rowBg = isDup ? '#FEF0F0' : hasEdit ? '#FFFBEB' : isEmpty ? '#FEF9F9' : (i % 2 ? C.light : C.surface)
                      return (
                        <tr key={u.id} style={{ background: rowBg }}>
                          <td style={{ padding: '4px 9px' }}>
                            <input value={current} onChange={e => setEditMap(prev => ({ ...prev, [u.id]: e.target.value }))}
                              placeholder="ej: 09" style={{
                                width: 55, padding: '3px 6px', fontFamily: font, fontSize: 13, fontWeight: 700,
                                border: `1px solid ${isDup ? C.danger : hasEdit ? C.warning : isEmpty ? '#F5B7B1' : C.border}`,
                                borderRadius: 4, background: 'transparent', outline: 'none',
                                color: isDup ? C.danger : hasEdit ? C.warning : isEmpty ? C.danger : C.success,
                              }} />
                          </td>
                          <td style={{ padding: '4px 9px', fontFamily: font, fontSize: 10, color: C.muted }}>{u.id}</td>
                          <td style={{ padding: '4px 9px', fontWeight: 600 }}>{u.numero}</td>
                          <td style={{ padding: '4px 9px' }}>
                            <span style={{
                              padding: '2px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                              background: u.tipo === 'departamento' ? '#EBF5FB' : u.tipo === 'local' ? '#FEF9E7' : u.tipo === 'cochera' ? '#F0FFF4' : '#F5EEF8',
                              color: u.tipo === 'departamento' ? C.accent : u.tipo === 'local' ? C.warning : u.tipo === 'cochera' ? C.success : '#7D3C98'
                            }}>{u.tipo || '—'}</span>
                          </td>
                          <td style={{ padding: '4px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{u.propietario}</td>
                          <td style={{ padding: '4px 9px', fontSize: 11, fontWeight: 700 }}>
                            {isDup ? <span style={{ color: C.danger }}>⚠ DUP</span>
                              : hasEdit ? <span style={{ color: C.warning }}>✏ EDIT</span>
                              : isEmpty ? <span style={{ color: C.danger }}>✗ SIN PDF</span>
                              : <span style={{ color: C.success }}>✓ OK</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {ufsVisible.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 30, color: C.muted }}>
                    {filterProb ? '✅ Todas las UFs tienen nro_uf_pdf asignado.' : 'Sin unidades.'}
                  </div>
                )}
              </div>
            )}

            <div style={{ padding: '8px 16px', borderTop: `1px solid ${C.border}`, background: C.surface, display: 'flex', gap: 16, fontSize: 11, color: C.muted, flexWrap: 'wrap' }}>
              {[['✓ OK', C.success], ['✗ SIN PDF', C.danger], ['✏ EDIT', C.warning], ['⚠ DUP', C.danger]].map(([l, c]) => (
                <span key={l}><b style={{ color: c }}>{l}</b> — {l === '✓ OK' ? 'listo para importar' : l === '✗ SIN PDF' ? 'bloquea importación' : l === '✏ EDIT' ? 'pendiente guardar' : 'valor repetido'}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
