// modules/liquidaciones/ControlLiquidaciones.jsx
// ─────────────────────────────────────────────────────────────────────────
// Tarjeta "Control de liquidaciones": semáforo del estado de las liquidaciones
// importadas (prorrateo por UF). Detecta cobertura (UFs faltantes), filas
// ajenas, duplicados y errores aritméticos por UF.
//
// Fuente de datos: RPC con_control_liquidaciones() — agregación server-side
// filtrada por auth.uid() (no baja miles de filas al navegador).
//
// LIMITACIÓN: el semáforo NO controla totales por columna contra el PDF
// (eso exige el PDF; ver Regla 3). Es el primer filtro, no el cierre fino.
// El gap de pagos es informativo (caja vs prorrateo), no marca REVISAR.
// ─────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { fmt, periodoLabel } from '../../lib/formatters'
import { VD, RJ, AM, GR, AZ } from '../../lib/config'
import { Card, Btn, Badge, Msg } from '../../components/ui'

const N = v => Number(v || 0)

function flagsDe(r) {
  const f = []
  const faltan = N(r.faltan)
  if (faltan > 0) f.push(`faltan ${faltan} UF`)
  if (faltan < 0) f.push(`sobran ${Math.abs(faltan)} UF`)
  if (N(r.ajenas) > 0) f.push(`${N(r.ajenas)} ajenas`)
  if (N(r.duplicados) > 0) f.push(`${N(r.duplicados)} dup.`)
  if (N(r.err_arit) > 0) f.push(`${N(r.err_arit)} err. arit.`)
  return f
}

export default function ControlLiquidaciones() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [soloRevisar, setSoloRevisar] = useState(false)
  const [q, setQ] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setMsg(null)
    const { data, error } = await supabase.rpc('con_control_liquidaciones')
    if (error) {
      setMsg({ tipo: 'error', texto: 'No se pudo cargar el control: ' + error.message })
      setRows([])
    } else {
      setRows(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const total = rows.length
  const nRevisar = rows.filter(r => r.semaforo === 'REVISAR').length
  const nOk = total - nRevisar

  const visibles = rows.filter(r => {
    if (soloRevisar && r.semaforo !== 'REVISAR') return false
    if (q) {
      const hay = `${r.consorcio || ''} ${r.consorcio_id || ''} ${r.periodo || ''}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  const th = { textAlign: 'left', fontSize: 11, color: GR, fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
  const td = { fontSize: 12.5, padding: '7px 8px', borderBottom: '0.5px solid #f0f0f0', verticalAlign: 'middle' }
  const chip = (bg, c, txt) => (
    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: bg, color: c }}>{txt}</span>
  )

  return (
    <Card>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: AZ, flex: 1 }}>🧾 Control de liquidaciones</div>
        <Btn small color={GR} onClick={cargar} disabled={loading}>{loading ? '⏳' : '↻'} Actualizar</Btn>
      </div>

      {/* Resumen */}
      {!loading && !msg && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {chip('#eef2ff', AZ, `${total} liquidaciones`)}
          {chip('#dcfce7', VD, `🟢 ${nOk} OK`)}
          {chip(nRevisar ? '#fee2e2' : '#f3f4f6', nRevisar ? RJ : GR, `🔴 ${nRevisar} a revisar`)}
        </div>
      )}

      {/* Filtros */}
      {!loading && !msg && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Filtrar por consorcio o período…"
            style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5, boxSizing: 'border-box' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#374151', cursor: 'pointer' }}>
            <input type="checkbox" checked={soloRevisar} onChange={e => setSoloRevisar(e.target.checked)} />
            Solo a revisar
          </label>
        </div>
      )}

      <Msg data={msg} />

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: GR, fontSize: 13 }}>Cargando control…</div>
      ) : msg ? null : visibles.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: GR, fontSize: 13 }}>
          {soloRevisar ? '✓ No hay liquidaciones a revisar.' : 'Sin liquidaciones que coincidan con el filtro.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Consorcio</th>
                <th style={th}>Período</th>
                <th style={{ ...th, textAlign: 'center' }}>UFs</th>
                <th style={th}>Observaciones</th>
                <th style={{ ...th, textAlign: 'right' }}>Gap pagos*</th>
                <th style={{ ...th, textAlign: 'center' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(r => {
                const rev = r.semaforo === 'REVISAR'
                const flags = flagsDe(r)
                const gap = N(r.gap_pagos)
                return (
                  <tr key={r.expensa_id} style={{ background: rev ? '#fef2f2' : 'transparent' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{r.consorcio}</div>
                      <div style={{ fontSize: 10.5, color: GR }}>{r.consorcio_id}</div>
                    </td>
                    <td style={td}>{periodoLabel(r.periodo)}</td>
                    <td style={{ ...td, textAlign: 'center', color: N(r.faltan) !== 0 ? RJ : '#374151', fontWeight: N(r.faltan) !== 0 ? 700 : 400 }}>
                      {N(r.ufs_ok)}/{N(r.ufs_esp)}
                    </td>
                    <td style={td}>
                      {flags.length === 0
                        ? <span style={{ color: VD }}>—</span>
                        : <span style={{ color: RJ, fontWeight: 600 }}>{flags.join(' · ')}</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: Math.abs(gap) > 0.5 ? AM : GR }}>
                      {Math.abs(gap) > 0.5 ? fmt(gap) : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <Badge text={r.semaforo} color={rev ? RJ : VD} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Nota al pie */}
      {!loading && !msg && (
        <div style={{ marginTop: 10, fontSize: 10.5, color: GR, lineHeight: 1.5 }}>
          * <b>Gap pagos</b> = pagos del prorrateo − total cobrado (estado financiero). Es <b>informativo</b>: el estado financiero se imputa por caja (fecha + acreditado) y puede diferir legítimamente.
          El semáforo controla cobertura, filas ajenas, duplicados y aritmética por UF; <b>no</b> reemplaza el control de totales por columna contra el PDF.
        </div>
      )}
    </Card>
  )
}
