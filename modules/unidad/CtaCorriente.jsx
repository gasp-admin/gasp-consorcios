// modules — CtaCorriente.jsx
// Extraído del V59. Refactorizado: props → useApp(). Cero cambios de comportamiento.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function CtaCorriente() {
  const { session, consorcioActivo, unidades, copropietarios, expensas, adminPerfil } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [ufSel, setUfSel]       = useState('')
  const [movs, setMovs]         = useState([])
  const [cargando, setCargando] = useState(false)
  const [saldo, setSaldo]       = useState(0)
  const [fDesde, setFDesde]     = useState('')
  const [fHasta, setFHasta]     = useState('')

  // ── v56: CC calculada en el servidor por get-cuenta-corriente ─────────
  // Elimina toda la lógica financiera del cliente. El servidor determina
  // automáticamente el modelo (normal/historico/mixto) según modelo_cc
  // del consorcio y devuelve las líneas ya ordenadas con saldo acumulado.
  const [modeloCC, setModeloCC] = useState('')

  async function cargarMovimientos(uid) {
    if (!uid) return
    setCargando(true)
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPA_URL}/functions/v1/get-cuenta-corriente`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess?.access_token}`,
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        },
        body: JSON.stringify({ unidad_id: uid })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error calculando cuenta corriente')
      setMovs(data.lineas || [])
      setSaldo(data.saldo_total || 0)
      setModeloCC(data.modelo || '')
    } catch (err) {
      console.error('[CtaCorriente] Error:', err)
      setMovs([])
      setSaldo(0)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { if (ufSel) cargarMovimientos(ufSel) }, [ufSel])

  const uf  = unidades.find(u => u.id === ufSel)
  const cp  = copropietarios.find(c => c.id === uf?.propietario_id)
  const fmt = n => '$' + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })
  const fmtD = d => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'

  // Movimientos filtrados por rango de fechas
  const movsFiltrados = movs.filter(m =>
    (!fDesde || (m.fecha||'') >= fDesde) && (!fHasta || (m.fecha||'') <= fHasta)
  )
  // Recalcular saldo acumulado sobre los filtrados
  let accF = 0
  const movsConSaldoFiltrado = movsFiltrados.map(m => {
    if (m.tipo === 'debito')  accF += m.monto
    if (m.tipo === 'credito') accF -= m.monto
    return { ...m, saldo_acum: accF }
  })
  const totalDebitosFil  = movsFiltrados.filter(m=>m.tipo==='debito').reduce((a,m)=>a+m.monto,0)
  const totalCreditosFil = movsFiltrados.filter(m=>m.tipo==='credito').reduce((a,m)=>a+m.monto,0)

  function handlePDFCtaCorriente() {
    exportarPDF({
      titulo: `Cuenta Corriente UF — ${uf?.numero||''} — ${cp?.apellido_nombre||''}`,
      subtitulo: (fDesde||fHasta) ? `Período: ${fDesde?fmtD(fDesde):'inicio'} al ${fHasta?fmtD(fHasta):'hoy'}` : 'Historial completo',
      consorcioNombre: '',
      logoB64: null /* null /* logo */ migrado a adminPerfil.sello_url */,
      columnas: [
        { key:'fecha',    label:'Fecha',   nowrap:true },
        { key:'concepto', label:'Concepto' },
        { key:'debito',   label:'Débito',  align:'right' },
        { key:'credito',  label:'Crédito', align:'right' },
        { key:'saldo',    label:'Saldo',   align:'right' },
      ],
      filas: movsConSaldoFiltrado.map(m => ({
        fecha:   fmtD(m.fecha),
        concepto: m.concepto + (m.nro ? ` — N° ${m.nro}` : ''),
        debito:  m.tipo==='debito'  ? fmt(m.monto) : '',
        credito: m.tipo==='credito' ? fmt(m.monto) : '',
        saldo:   fmt(Math.abs(m.saldo_acum)) + (m.saldo_acum < 0 ? ' CR' : ''),
      })),
      totales: {
        fecha:'', concepto:'Saldo final',
        debito: fmt(totalDebitosFil), credito: fmt(totalCreditosFil),
        saldo: accF > 0 ? `Debe ${fmt(accF)}` : `A favor ${fmt(Math.abs(accF))}`,
      }
    })
  }

  function handleExcelCtaCorriente() {
    exportarExcel({
      titulo: `CtaCte-UF-${uf?.numero||''}`,
      columnas: [
        { key:'fecha',    label:'Fecha' },
        { key:'concepto', label:'Concepto' },
        { key:'tipo',     label:'Tipo' },
        { key:'debito',   label:'Débito' },
        { key:'credito',  label:'Crédito' },
        { key:'saldo',    label:'Saldo Acum.' },
      ],
      filas: movsConSaldoFiltrado.map(m => ({
        fecha:   m.fecha,
        concepto: m.concepto + (m.nro ? ` — N° ${m.nro}` : ''),
        tipo:    m.tipo === 'debito' ? 'Débito' : 'Crédito',
        debito:  m.tipo==='debito'  ? m.monto : '',
        credito: m.tipo==='credito' ? m.monto : '',
        saldo:   m.saldo_acum,
      }))
    })
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>📋 Cuenta corriente por unidad</div>
        {modeloCC && (
          <span style={{
            fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:12,
            background: modeloCC==='historico' ? '#dbeafe' : modeloCC==='mixto' ? '#fef3c7' : '#dcfce7',
            color:       modeloCC==='historico' ? '#1d4ed8' : modeloCC==='mixto' ? '#92400e' : '#166534',
            textTransform:'uppercase', letterSpacing:'0.05em'
          }}>
            {modeloCC==='historico' ? '📂 Histórico' : modeloCC==='mixto' ? '⚡ Mixto' : '✓ Normal'}
          </span>
        )}
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Historial completo de débitos, créditos y saldo por unidad funcional
      </div>

      <Card style={{ marginBottom:16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, alignItems:'end' }}>
          <Sel label="Unidad funcional" value={ufSel} onChange={v=>{setUfSel(v);setFDesde('');setFHasta('')}}
            opts={[{ v:'', l:'— Seleccione UF —' },
              ...unidades.map(u => {
                const cp2 = copropietarios.find(c => c.id === u.propietario_id)
                return { v: u.id, l: `${u.numero} — ${cp2?.apellido_nombre||'Sin propietario'}` }
              })
            ]} />
          {uf && (
            <div style={{ padding:'10px 14px', background:'#f0f4ff', borderRadius:8, fontSize:13 }}>
              <strong>{cp?.apellido_nombre||'—'}</strong>
              <div style={{ fontSize:11, color:GR }}>
                {uf.tipo} {uf.piso ? `· Piso ${uf.piso}` : ''}
                {uf.porcentaje_fiscal ? ` · Coef: ${Number(uf.porcentaje_fiscal).toFixed(4)}%` : ''}
              </div>
            </div>
          )}
        </div>
      </Card>

      {ufSel && (
        <>
          {/* KPI saldo */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div style={{ background: accF > 0 ? '#fee2e2' : '#dcfce7', borderRadius:10,
              padding:'14px 18px', textAlign:'center' }}>
              <div style={{ fontSize:11, color: accF > 0 ? RJ : VD, fontWeight:600,
                textTransform:'uppercase', marginBottom:4 }}>
                Saldo{(fDesde||fHasta)?' (filtrado)':' actual'}
              </div>
              <div style={{ fontSize:22, fontWeight:800, color: accF > 0 ? RJ : VD }}>
                {accF > 0 ? fmt(accF) : '✓ Al día'}
              </div>
            </div>
            <div style={{ background:'#fff', borderRadius:10, padding:'14px 18px',
              textAlign:'center', boxShadow:'0 1px 6px #0001' }}>
              <div style={{ fontSize:11, color:GR, fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>
                Total débitos
              </div>
              <div style={{ fontSize:20, fontWeight:700, color:RJ }}>
                {fmt(totalDebitosFil)}
              </div>
            </div>
            <div style={{ background:'#fff', borderRadius:10, padding:'14px 18px',
              textAlign:'center', boxShadow:'0 1px 6px #0001' }}>
              <div style={{ fontSize:11, color:GR, fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>
                Total créditos
              </div>
              <div style={{ fontSize:20, fontWeight:700, color:VD }}>
                {fmt(totalCreditosFil)}
              </div>
            </div>
          </div>

          {/* Filtros por fecha + exportación */}
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ fontSize:12, color:GR, display:'flex', gap:6, alignItems:'center' }}>
              <span>Desde</span>
              <input type="date" value={fDesde} onChange={e=>setFDesde(e.target.value)}
                style={{ padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12 }} />
              <span>hasta</span>
              <input type="date" value={fHasta} onChange={e=>setFHasta(e.target.value)}
                style={{ padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12 }} />
              {(fDesde||fHasta) && (
                <Btn small onClick={()=>{setFDesde('');setFHasta('')}} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
              )}
            </div>
            <Btn small color={GR} onClick={handlePDFCtaCorriente}>🖨️ PDF</Btn>
            <Btn small color={VD} onClick={handleExcelCtaCorriente}>📊 Excel</Btn>
          </div>

          {/* Tabla */}
          <Card>
            {cargando ? (
              <div style={{ textAlign:'center', padding:24, color:GR }}>⏳ Cargando...</div>
            ) : movsConSaldoFiltrado.length === 0 ? (
              <div style={{ textAlign:'center', padding:24, color:GR }}>
                {movs.length === 0 ? 'Sin movimientos registrados' : 'Sin movimientos en el rango seleccionado'}
              </div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f3f4f6' }}>
                      {['Fecha','Concepto','Débito','Crédito','Saldo'].map((h,i) => (
                        <th key={i} style={{ padding:'7px 10px', textAlign: i>=2?'right':'left',
                          fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb',
                          whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movsConSaldoFiltrado.map((m, i) => (
                      <tr key={i} style={{ borderBottom:'1px solid #f3f4f6',
                        background: m.origen==='mora' ? '#fff8f0' : 'transparent' }}>
                        <td style={{ padding:'7px 10px', whiteSpace:'nowrap', color:GR, fontSize:11 }}>
                          {m.fecha ? new Date(m.fecha+'T00:00:00').toLocaleDateString('es-AR') : '—'}
                        </td>
                        <td style={{ padding:'7px 10px' }}>
                          <div style={{ fontWeight: m.origen==='expensa'?600:400 }}>{m.concepto}</div>
                          {m.nro && <div style={{ fontSize:10, color:GR }}>N° {m.nro}</div>}
                        </td>
                        <td style={{ padding:'7px 10px', textAlign:'right', color:RJ, fontWeight:600 }}>
                          {m.tipo==='debito' ? fmt(m.monto) : ''}
                        </td>
                        <td style={{ padding:'7px 10px', textAlign:'right', color:VD, fontWeight:600 }}>
                          {m.tipo==='credito' ? fmt(m.monto) : ''}
                        </td>
                        <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700,
                          color: m.saldo_acum > 0 ? RJ : VD }}>
                          {fmt(Math.abs(m.saldo_acum))}
                          {m.saldo_acum < 0 && <span style={{ fontSize:9, marginLeft:2 }}>CR</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'#f0f4ff', borderTop:'2px solid #1A3FA0' }}>
                      <td colSpan={2} style={{ padding:'8px 10px', fontWeight:700, color:AZ }}>
                        Saldo final{(fDesde||fHasta)?' (período filtrado)':''}
                      </td>
                      <td colSpan={3} style={{ padding:'8px 10px', textAlign:'right',
                        fontWeight:800, fontSize:15, color: accF > 0 ? RJ : VD }}>
                        {accF > 0 ? `Debe ${fmt(accF)}` : `A favor ${fmt(Math.abs(accF))}`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MOVIMIENTOS POR UNIDAD — Notas de débito y crédito
// ══════════════════════════════════════════════════════════════════════════════
