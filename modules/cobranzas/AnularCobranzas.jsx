// modules — AnularCobranzas.jsx
// Extraído del V59. Props → useApp().

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function AnularCobranzas() {
  const { session, unidades, copropietarios, expensas, consorcioActivo} = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [cobranzas, setCobranzas] = useState([])
  const [filtroExp, setFiltroExp] = useState('')
  const [filtroUF, setFiltroUF]   = useState('')
  const [msg, setMsg]             = useState(null)
  const [form, setForm]           = useState(null)

  async function cargar() {
    const q = supabase.from('con_cobranzas').select('*')
      .eq('consorcio_id', consorcioId)
      .order('fecha', { ascending:false }).limit(200)
    if (filtroExp) q.eq('expensa_id', filtroExp)
    if (filtroUF)  q.eq('unidad_id', filtroUF)
    const { data } = await q
    setCobranzas(data || [])
  }

  async function anular(c) {
    if (!form?.motivo?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el motivo de anulación' })
    const { error } = await supabase.from('con_cobranzas')
      .update({
        estado: 'anulada',
        anulado_motivo: form.motivo,
        anulado_fecha: new Date().toISOString().split('T')[0],
      })
      .eq('id', c.id)

    if (error) {
      setMsg({ tipo:'error', texto: error.message })
    } else {
      // Revertir el pago en el detalle de expensa
      if (c.expensa_id && c.unidad_id) {
        const { data: det } = await supabase.from('con_expensas_detalle')
          .select('pagos_periodo').eq('expensa_id', c.expensa_id).eq('unidad_id', c.unidad_id).single()
        if (det) {
          const nuevoPago = Math.max(0, (parseFloat(det.pagos_periodo)||0) - (parseFloat(c.monto)||0))
          await supabase.from('con_expensas_detalle')
            .update({ pagos_periodo: nuevoPago,
              estado: nuevoPago > 0 ? 'pendiente' : 'pendiente' })
            .eq('expensa_id', c.expensa_id).eq('unidad_id', c.unidad_id)
        }
      }
      setMsg({ tipo:'ok', texto:'✓ Cobranza anulada y saldo revertido' })
      setForm(null)
      cargar()
    }
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId, filtroExp, filtroUF])

  const pLabel = p => {
    if (!p) return '—'
  const pLabel = p => {
    const exp = expensas.find(e=>e.id===p)
    if (!exp) return p
    const [y,m] = (exp.periodo||'').split('-')
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return m ? `${meses[parseInt(m)-1]} ${y}` : exp.periodo
  }

  const vigentes = cobranzas.filter(c=>c.estado==='vigente')
  const anuladas = cobranzas.filter(c=>c.estado==='anulada')

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>↩️ Anular cobranzas</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Anule cobranzas registradas por error. El saldo se revierte automáticamente.
      </div>
      <Msg data={msg} />

      {/* Alerta */}
      <Card style={{ marginBottom:16, background:'#fff8f0', border:'1px solid #fed7aa' }}>
        <div style={{ fontSize:12, color:'#92400e' }}>
          ⚠️ La anulación revierte el pago en la cuenta corriente de la unidad.
          Use esta función solo para corregir registros cargados por error.
          Requiere motivo obligatorio para auditoría.
        </div>
      </Card>

      {/* Filtros */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Sel label="Filtrar por período" value={filtroExp} onChange={setFiltroExp}
            opts={[{v:'',l:'Todos los períodos'},
              ...expensas.map(e => {
                const [y,m2] = (e.periodo||'').split('-')
                const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                return { v:e.id, l:m2?`${meses[parseInt(m2)-1]} ${y}`:e.periodo }
              })
            ]} />
          <Sel label="Filtrar por unidad" value={filtroUF} onChange={setFiltroUF}
            opts={[{v:'',l:'Todas las unidades'},
              ...unidades.map(u => ({ v:u.id, l:`UF ${u.numero}` }))
            ]} />
        </div>
      </Card>

      {/* Modal anulación */}
      {form && (
        <Card style={{ marginBottom:16, border:'1.5px solid #fca5a5', background:'#fff8f8' }}>
          <div style={{ fontWeight:700, color:RJ, fontSize:13, marginBottom:10 }}>
            Anular cobranza — UF {unidades.find(u=>u.id===form.c.unidad_id)?.numero} — {fmt(form.c.monto)}
          </div>
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Motivo de anulación *</div>
            <input value={form.motivo||''} placeholder="Ej: Error en el monto, pago duplicado..."
              onChange={e=>setForm(f=>({...f,motivo:e.target.value}))}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #fca5a5',
                borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={()=>anular(form.c)} style={{ background:RJ, color:'#fff' }}>↩️ Confirmar anulación</Btn>
            <BtnSec onClick={()=>{ setForm(null); setMsg(null) }}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {/* Tabla vigentes */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ fontWeight:600, fontSize:13, marginBottom:10 }}>
          Cobranzas vigentes ({vigentes.length})
        </div>
        {vigentes.length === 0 ? (
          <div style={{ color:GR, fontSize:13, padding:'8px 0' }}>Sin cobranzas vigentes en el filtro seleccionado</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Fecha','UF','Período','Monto','Medio','Recibo',''].map((h,i) => (
                    <th key={i} style={{ padding:'7px 10px', textAlign:i===3?'right':'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vigentes.map(c => {
                  const uf = unidades.find(u=>u.id===c.unidad_id)
                  return (
                    <tr key={c.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>{fmtD(c.fecha)}</td>
                      <td style={{ padding:'7px 10px', fontWeight:600 }}>UF {uf?.numero||'?'}</td>
                      <td style={{ padding:'7px 10px', color:GR }}>{periodoLabel(c.expensa_id)}</td>
                      <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700, color:VD }}>{fmt(c.monto)}</td>
                      <td style={{ padding:'7px 10px', color:GR, textTransform:'capitalize' }}>
                        {c.medio_pago?.replace('_',' ')||'—'}
                      </td>
                      <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>{c.recibo_numero||'—'}</td>
                      <td style={{ padding:'7px 10px' }}>
                        <Btn small onClick={()=>setForm({c, motivo:''})}
                          style={{ background:'#fee2e2', color:RJ }}>↩️ Anular</Btn>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Anuladas */}
      {anuladas.length > 0 && (
        <Card>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:10, color:GR }}>
            Anuladas ({anuladas.length})
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ background:'#f9fafb' }}>
                  {['Fecha','UF','Monto','Motivo','Fecha anulación'].map((h,i) => (
                    <th key={i} style={{ padding:'6px 10px', textAlign:'left',
                      fontWeight:600, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {anuladas.map(c => {
                  const uf = unidades.find(u=>u.id===c.unidad_id)
                  return (
                    <tr key={c.id} style={{ borderBottom:'1px solid #f3f4f6', opacity:0.6 }}>
                      <td style={{ padding:'6px 10px' }}>{fmtD(c.fecha)}</td>
                      <td style={{ padding:'6px 10px' }}>UF {uf?.numero||'?'}</td>
                      <td style={{ padding:'6px 10px', color:GR }}>{fmt(c.monto)}</td>
                      <td style={{ padding:'6px 10px', color:GR }}>{c.anulado_motivo||'—'}</td>
                      <td style={{ padding:'6px 10px', color:GR }}>{fmtD(c.anulado_fecha)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
