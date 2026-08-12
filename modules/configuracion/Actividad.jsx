import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, GR, BG } from '../../lib/config'

const TABLA_LABEL = {
  con_cobranzas:       'Cobranza',
  con_pagos_proveedor: 'Pago a proveedor',
  con_gastos:          'Gasto',
  con_expensas:        'Liquidación',
  con_proveedores:     'Proveedor',
  con_reclamos:        'Reclamo',
}
const OP_LABEL = { INSERT: 'creó', UPDATE: 'modificó', DELETE: 'eliminó' }
const OP_COLOR = { INSERT: '#16a34a', UPDATE: '#2563eb', DELETE: '#dc2626' }

const th = { padding: '9px 12px', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' }
const td = { padding: '8px 12px', verticalAlign: 'top' }
const selStyle = { padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, background: '#fff' }

export default function Actividad() {
  const { consorcios } = useApp()
  const [logs, setLogs]         = useState([])
  const [cargando, setCargando] = useState(true)
  const [fUsuario, setFUsuario] = useState('')
  const [fTabla, setFTabla]     = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true)
    const { data } = await supabase.from('con_audit_log')
      .select('*').order('created_at', { ascending: false }).limit(300)
    setLogs(data || [])
    setCargando(false)
  }

  const usuarios = useMemo(() => [...new Set(logs.map(l => l.usuario_email).filter(Boolean))], [logs])
  const consMap  = useMemo(() => Object.fromEntries((consorcios || []).map(c => [c.id, c.nombre])), [consorcios])

  const filtrados = logs.filter(l =>
    (!fUsuario || l.usuario_email === fUsuario) &&
    (!fTabla   || l.tabla === fTabla)
  )

  const fmtFecha = d => new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  function detalle(l) {
    const d = l.datos_despues || l.datos_antes || {}
    const partes = []
    if (l.registro_id) partes.push(l.registro_id)
    const monto = d.monto ?? d.total_expensa ?? d.importe ?? d.monto_total
    if (monto != null && monto !== '') partes.push('$' + Number(monto).toLocaleString('es-AR', { minimumFractionDigits: 2 }))
    if (d.periodo)  partes.push(d.periodo)
    if (d.concepto) partes.push(String(d.concepto).slice(0, 40))
    return partes.join('  ·  ')
  }

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ margin: 0, color: AZ, fontSize: 20 }}>📋 Actividad del equipo</h2>
      <p style={{ color: GR, fontSize: 13, marginTop: 4 }}>
        Registro de las acciones realizadas por vos y tu equipo — cobranzas, pagos a proveedores,
        liquidaciones, gastos, proveedores y reclamos. Queda identificado quién hizo cada cosa y cuándo.
      </p>

      <div style={{ display: 'flex', gap: 12, margin: '16px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={fUsuario} onChange={e => setFUsuario(e.target.value)} style={selStyle}>
          <option value="">Todos los usuarios</option>
          {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={fTabla} onChange={e => setFTabla(e.target.value)} style={selStyle}>
          <option value="">Todas las acciones</option>
          {Object.entries(TABLA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={cargar} style={{ padding: '8px 18px', background: AZ, color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Actualizar
        </button>
        <span style={{ fontSize: 12, color: GR }}>{filtrados.length} registros</span>
      </div>

      {cargando ? (
        <div style={{ color: GR, padding: 20 }}>Cargando actividad…</div>
      ) : filtrados.length === 0 ? (
        <div style={{ color: GR, padding: 30, textAlign: 'center', border: '1px dashed #e5e7eb', borderRadius: 8 }}>
          Sin actividad registrada todavía. Las acciones (cobranzas, pagos, liquidaciones…) van a aparecer acá a medida que se realicen.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: BG }}>
                <th style={th}>Fecha</th>
                <th style={th}>Usuario</th>
                <th style={th}>Acción</th>
                <th style={th}>Consorcio</th>
                <th style={th}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(l => (
                <tr key={l.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: GR, fontSize: 12 }}>{fmtFecha(l.created_at)}</td>
                  <td style={{ ...td, fontWeight: 500 }}>{l.usuario_email || '—'}</td>
                  <td style={td}>
                    <span style={{ color: OP_COLOR[l.operacion] || GR, fontWeight: 700 }}>{OP_LABEL[l.operacion] || l.operacion}</span>
                    {' '}{TABLA_LABEL[l.tabla] || l.tabla}
                  </td>
                  <td style={td}>{consMap[l.consorcio_id] || '—'}</td>
                  <td style={{ ...td, fontSize: 12, color: GR }}>{detalle(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
