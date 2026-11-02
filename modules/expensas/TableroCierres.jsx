// modules/expensas/TableroCierres.jsx
// ─────────────────────────────────────────────────────────────────────────
// Tablero de cierres mensuales — SOLO consorcios NATIVOS.
// Por consorcio y período muestra los 3 pasos del cierre:
//   1) Cierre de la liquidación (con_expensas.estado + pdf_datos_at)
//   2) Publicación Interfast, solo si con_config_cobranza.interfast_activo
//      (se marca "desactualizada" si la publicación es anterior al cierre)
//   3) Envío de la liquidación (con_email_log por UF)
//
// Fuente: RPC con_tablero_cierres(p_desde, p_hasta) — solo lectura,
// filtrada por get_admin_id_efectivo(auth.uid()). No escribe ningún dato.
//
// Notas:
// - Un consorcio aparece desde su primera expensa fuente='gasp'.
// - Liquidación de apertura (Σ monto = 0) → "Apertura", no cuenta como pendiente.
// - "Corresponde Interfast" usa la configuración ACTUAL (no histórica).
// - Excluye consorcios archivados e históricos.
// ─────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { periodoLabel, periodoLabelCorto, periodoActual } from '../../lib/formatters'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { Card, Btn, Badge, Msg } from '../../components/ui'

const N = v => Number(v || 0)

const addMes = (p, n) => {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const fmtFH = ts => {
  if (!ts) return null
  const d = new Date(ts)
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
}

// Semáforo → presentación
const SEM = {
  COMPLETA:     { ico: '🟢', txt: 'Completa',     c: VD, bg: '#dcfce7' },
  CON_FALLAS:   { ico: '🟡', txt: 'Con fallas',   c: AM, bg: '#fef3c7' },
  INCOMPLETA:   { ico: '🟠', txt: 'Incompleta',   c: AM, bg: '#ffedd5' },
  ABIERTA:      { ico: '🔴', txt: 'Abierta',      c: RJ, bg: '#fee2e2' },
  SIN_LIQUIDAR: { ico: '🔴', txt: 'Sin liquidar', c: RJ, bg: '#fee2e2' },
  APERTURA:     { ico: '⚪', txt: 'Apertura',     c: GR, bg: '#f3f4f6' },
}
const esPendiente = s => !['COMPLETA', 'APERTURA'].includes(s)

export default function TableroCierres() {
  const { session, consorcios, setConsorcioActivo, cargarConsorcio, setPagina } = useApp()

  const mesAnterior = addMes(periodoActual(), -1)
  const [hasta, setHasta] = useState(mesAnterior)
  const [meses, setMeses] = useState(6)
  const [sel, setSel] = useState(mesAnterior)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [soloPend, setSoloPend] = useState(false)

  const desde = addMes(hasta, -(meses - 1))

  const cargar = useCallback(async () => {
    setLoading(true); setMsg(null)
    const { data, error } = await supabase.rpc('con_tablero_cierres', { p_desde: desde, p_hasta: hasta })
    if (error) {
      setMsg({ tipo: 'error', texto: 'No se pudo cargar el tablero: ' + error.message })
      setRows([])
    } else {
      setRows(data || [])
    }
    setLoading(false)
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { if (sel > hasta || sel < desde) setSel(hasta) }, [desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps

  // Columnas de meses (más reciente primero) y consorcios
  const periodos = useMemo(() => Array.from({ length: meses }, (_, i) => addMes(hasta, -i)), [hasta, meses])
  const consList = useMemo(() => {
    const m = new Map()
    rows.forEach(r => { if (!m.has(r.consorcio_id)) m.set(r.consorcio_id, r.consorcio) })
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [rows])
  const celda = useMemo(() => {
    const m = {}
    rows.forEach(r => { m[`${r.consorcio_id}|${r.periodo}`] = r })
    return m
  }, [rows])

  const delMes = rows.filter(r => r.periodo === sel).sort((a, b) => a.consorcio.localeCompare(b.consorcio))
  const visibles = soloPend ? delMes.filter(r => esPendiente(r.semaforo)) : delMes
  const nPendMes = delMes.filter(r => esPendiente(r.semaforo)).length
  const nOkMes = delMes.filter(r => r.semaforo === 'COMPLETA').length
  const pendRango = rows.filter(r => esPendiente(r.semaforo))
  const pendAnteriores = pendRango.filter(r => r.periodo < sel)

  async function ir(r, destino) {
    const c = (consorcios || []).find(x => x.id === r.consorcio_id)
    if (!c) return setMsg({ tipo: 'error', texto: `No encontré ${r.consorcio_id} en la lista de consorcios.` })
    setConsorcioActivo(c)
    await cargarConsorcio(c.id, session?.user?.id)
    setPagina(destino)
  }

  function accion(r) {
    if (r.semaforo === 'SIN_LIQUIDAR' || r.semaforo === 'ABIERTA') return { lbl: 'Liquidar', dest: 'liquidacion' }
    if (r.ifx_corresponde && !r.ifx_vigente && r.semaforo !== 'APERTURA') return { lbl: 'Interfast', dest: 'interfast' }
    if (r.semaforo === 'INCOMPLETA' || r.semaforo === 'CON_FALLAS') return { lbl: 'Enviar', dest: 'emails' }
    return null
  }

  const th = { textAlign: 'left', fontSize: 11, color: GR, fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
  const td = { fontSize: 12.5, padding: '7px 8px', borderBottom: '0.5px solid #f0f0f0', verticalAlign: 'middle' }
  const chip = (bg, c, txt) => (
    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: bg, color: c }}>{txt}</span>
  )
  const sub = t => <div style={{ fontSize: 10.5, color: GR, marginTop: 2 }}>{t}</div>

  function celdaCierre(r) {
    if (r.semaforo === 'SIN_LIQUIDAR') return <span style={{ color: RJ, fontWeight: 600 }}>✗ Sin liquidación</span>
    if (r.semaforo === 'ABIERTA') return <span style={{ color: RJ, fontWeight: 600 }}>✗ Abierta</span>
    if (r.semaforo === 'APERTURA') return <span style={{ color: GR }}>Apertura</span>
    return <><span style={{ color: VD, fontWeight: 600 }}>✓ Cerrada</span>{r.fecha_cierre && sub(fmtFH(r.fecha_cierre))}</>
  }
  function celdaIfx(r) {
    if (!r.ifx_corresponde) return <span style={{ color: GR }}>No corresponde</span>
    if (r.semaforo === 'SIN_LIQUIDAR' || r.semaforo === 'ABIERTA') return <span style={{ color: GR }}>—</span>
    if (r.semaforo === 'APERTURA') return <span style={{ color: GR }}>—</span>
    if (!r.ifx_publicado_at) return <span style={{ color: RJ, fontWeight: 600 }}>✗ No publicada</span>
    if (!r.ifx_vigente) return <><span style={{ color: AM, fontWeight: 600 }}>⚠ Desactualizada</span>{sub('publicada ' + fmtFH(r.ifx_publicado_at) + ', antes del cierre')}</>
    return <><span style={{ color: VD, fontWeight: 600 }}>✓ Publicada</span>{sub(fmtFH(r.ifx_publicado_at) + (r.ifx_registros ? ` · ${r.ifx_registros} reg.` : ''))}</>
  }
  function celdaEnvio(r) {
    if (r.semaforo === 'SIN_LIQUIDAR' || r.semaforo === 'ABIERTA' || r.semaforo === 'APERTURA') return <span style={{ color: GR }}>—</span>
    const ok = N(r.ufs_enviadas), liq = N(r.ufs_liquidadas), fall = N(r.ufs_fallidas), reb = N(r.ufs_rebotadas)
    if (ok === 0) return <span style={{ color: RJ, fontWeight: 600 }}>✗ No enviada</span>
    const extra = [fall ? `${fall} con error` : null, reb ? `${reb} rebotada(s)` : null].filter(Boolean).join(' · ')
    return (
      <>
        <span style={{ color: fall ? AM : VD, fontWeight: 600 }}>{fall ? '⚠' : '✓'} {ok}/{liq} UF</span>
        {sub([fmtFH(r.envio_ultimo), extra].filter(Boolean).join(' · '))}
      </>
    )
  }

  return (
    <Card>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: AZ, flex: 1 }}>🗓️ Tablero de cierres — consorcios nativos</div>
        <label style={{ fontSize: 12, color: GR }}>Hasta&nbsp;
          <input type="month" value={hasta} max={periodoActual()} onChange={e => e.target.value && setHasta(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5 }} />
        </label>
        <label style={{ fontSize: 12, color: GR }}>Meses&nbsp;
          <select value={meses} onChange={e => setMeses(Number(e.target.value))}
            style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5 }}>
            {[3, 6, 12].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Btn small color={GR} onClick={cargar} disabled={loading}>{loading ? '⏳' : '↻'} Actualizar</Btn>
      </div>

      <Msg data={msg} />

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: GR, fontSize: 13 }}>Cargando tablero…</div>
      ) : msg ? null : (
        <>
          {/* Alerta de pendientes de meses anteriores al seleccionado */}
          {pendAnteriores.length > 0 && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#9a3412', marginBottom: 12 }}>
              ⚠ Hay {pendAnteriores.length} cierre(s) pendiente(s) de meses anteriores:{' '}
              {pendAnteriores.map(r => `${r.consorcio} (${periodoLabelCorto(r.periodo)})`).join(' · ')}
            </div>
          )}

          {/* Matriz consorcio × mes */}
          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Consorcio</th>
                  {periodos.map(p => (
                    <th key={p} onClick={() => setSel(p)}
                      style={{ ...th, textAlign: 'center', cursor: 'pointer', color: p === sel ? AZ : GR, borderBottom: p === sel ? `2px solid ${AZ}` : th.borderBottom }}>
                      {periodoLabelCorto(p)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {consList.map(c => (
                  <tr key={c.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.nombre}</td>
                    {periodos.map(p => {
                      const r = celda[`${c.id}|${p}`]
                      const s = r ? SEM[r.semaforo] : null
                      return (
                        <td key={p} onClick={() => setSel(p)} title={r ? `${s.txt}${r.pendiente ? ' — ' + r.pendiente : ''}` : 'Antes del inicio nativo'}
                          style={{ ...td, textAlign: 'center', cursor: 'pointer', background: p === sel ? '#f8fafc' : 'transparent' }}>
                          {s ? s.ico : <span style={{ color: '#d1d5db' }}>·</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10.5, color: GR, marginTop: 6 }}>
              🟢 completa · 🟡 enviada con errores · 🟠 falta Interfast o envío · 🔴 sin cerrar · ⚪ apertura · <span style={{ color: '#d1d5db' }}>·</span> antes del inicio nativo. Clic en un mes para ver el detalle.
            </div>
          </div>

          {/* Detalle del mes seleccionado */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginRight: 6 }}>{periodoLabel(sel)}</div>
            {chip('#eef2ff', AZ, `${delMes.length} consorcios`)}
            {chip('#dcfce7', VD, `🟢 ${nOkMes} completos`)}
            {chip(nPendMes ? '#fee2e2' : '#f3f4f6', nPendMes ? RJ : GR, `${nPendMes} pendientes`)}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#374151', cursor: 'pointer', marginLeft: 'auto' }}>
              <input type="checkbox" checked={soloPend} onChange={e => setSoloPend(e.target.checked)} />
              Solo pendientes
            </label>
          </div>

          {visibles.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: GR, fontSize: 13 }}>
              {soloPend ? `✓ Sin pendientes en ${periodoLabel(sel)}.` : 'Sin consorcios nativos para este período.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Consorcio</th>
                    <th style={th}>1 · Cierre</th>
                    <th style={th}>2 · Interfast</th>
                    <th style={th}>3 · Envío</th>
                    <th style={th}>Pendiente</th>
                    <th style={{ ...th, textAlign: 'center' }}>Estado</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(r => {
                    const s = SEM[r.semaforo] || SEM.INCOMPLETA
                    const a = accion(r)
                    return (
                      <tr key={r.consorcio_id} style={{ background: esPendiente(r.semaforo) ? '#fffbfb' : 'transparent' }}>
                        <td style={td}>
                          <div style={{ fontWeight: 600, color: '#111827' }}>{r.consorcio}</div>
                          <div style={{ fontSize: 10.5, color: GR }}>{r.consorcio_id}</div>
                        </td>
                        <td style={td}>{celdaCierre(r)}</td>
                        <td style={td}>{celdaIfx(r)}</td>
                        <td style={td}>{celdaEnvio(r)}</td>
                        <td style={{ ...td, color: r.pendiente ? RJ : VD, fontWeight: r.pendiente ? 600 : 400 }}>{r.pendiente || '—'}</td>
                        <td style={{ ...td, textAlign: 'center' }}><Badge text={s.txt} color={s.c} bg={s.bg} /></td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {a && <Btn small color={AZ} onClick={() => ir(r, a.dest)}>{a.lbl} →</Btn>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 10.5, color: GR, lineHeight: 1.5 }}>
            Alcance: consorcios nativos activos y no archivados, desde su primera liquidación GASP. <b>Interfast</b> se exige solo si hoy está activo en la configuración de cobranza; figura <b>desactualizada</b> si la última publicación es anterior al cierre (re-cierre posterior).
            <b> Envío</b> = UF con al menos un mail de liquidación enviado / UF liquidadas; las UF sin email no generan registro y quedan fuera del numerador.
            Este tablero es de solo lectura: no modifica liquidaciones, publicaciones ni envíos.
          </div>
        </>
      )}
    </Card>
  )
}
