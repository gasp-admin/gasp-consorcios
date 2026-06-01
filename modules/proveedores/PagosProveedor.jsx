// modules — PagosProveedor.jsx
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

export default function PagosProveedor() {
  const { session, proveedores, consorcioActivo} = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [pagos, setPagos]         = useState([])
  const [compPendientes, setCompPendientes] = useState([])
  const [form, setForm]           = useState(null)
  const [filtro, setFiltro]       = useState('')
  const [msg, setMsg]             = useState(null)
  const [guardando, setGuardando] = useState(false)
  const hoy = new Date().toISOString().split('T')[0]

  async function cargar() {
    const [{ data: p }, { data: cp }] = await Promise.all([
      supabase.from('con_pagos_proveedor').select('*')
        .eq('consorcio_id', consorcioId).order('fecha', { ascending:false }).limit(200),
      supabase.from('con_comprobantes_proveedor').select('*')
        .eq('consorcio_id', consorcioId)
        .in('estado', ['pendiente','pagado_parcial'])
        .order('fecha_vencimiento', { ascending:true })
    ])
    setPagos(p||[])
    setCompPendientes(cp||[])
  }

  async function guardar() {
    if (!form?.proveedor_id) return setMsg({ tipo:'warn', texto:'Seleccioná un proveedor' })
    if (!form?.monto || parseFloat(form.monto)<=0) return setMsg({ tipo:'warn', texto:'Ingresá el monto' })
    if (!form?.fecha) return setMsg({ tipo:'warn', texto:'Ingresá la fecha' })
    setGuardando(true)
    const monto=parseFloat(form.monto)
    const retIIBB=parseFloat(form.retencion_iibb)||0
    const retGan=parseFloat(form.retencion_ganancias)||0
    const retIVA=parseFloat(form.retencion_iva)||0
    const neto=monto-retIIBB-retGan-retIVA
    if (form.id) {
      // Edición
      await supabase.from('con_pagos_proveedor').update({
        proveedor_id: form.proveedor_id, comprobante_id: form.comprobante_id||null,
        fecha: form.fecha, monto, retencion_iibb: retIIBB||null,
        retencion_ganancias: retGan||null, retencion_iva: retIVA||null,
        monto_neto_pagado: neto, nro_orden_pago: form.nro_orden_pago||null,
        medio_pago: form.medio_pago||'transferencia',
        referencia: form.referencia||null, notas: form.notas||null,
      }).eq('id', form.id)
      setMsg({ tipo:'ok', texto:'✓ Pago actualizado' })
    } else {
      const { error } = await supabase.from('con_pagos_proveedor').insert([{
        id: `PAG-${Date.now()}`,
        admin_id: uid, consorcio_id: consorcioId,
        proveedor_id: form.proveedor_id, comprobante_id: form.comprobante_id || null,
        fecha: form.fecha, monto,
        retencion_iibb: retIIBB||null, retencion_ganancias: retGan||null,
        retencion_iva: retIVA||null, monto_neto_pagado: neto,
        nro_orden_pago: form.nro_orden_pago||null,
        medio_pago: form.medio_pago || 'transferencia',
        numero_cheque: form.numero_cheque || null,
        banco: form.banco || null, referencia: form.referencia || null,
        notas: form.notas || null,
      }])
      if (error) { setMsg({ tipo:'error', texto: error.message }); setGuardando(false); return }
      setMsg({ tipo:'ok', texto:'✓ Pago registrado' })
    }
    setForm(null); cargar()
    setGuardando(false)
  }

  async function eliminarPago(p) {
    if (!confirm(`¿Eliminar este pago de ${fmt(p.monto)}?\nSi estaba asociado a un comprobante, el saldo no se actualiza automáticamente.`)) return
    await supabase.from('con_pagos_proveedor').delete().eq('id', p.id)
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])


  const MEDIOS = [
    {v:'transferencia',l:'Transferencia'},{v:'cheque_propio',l:'Cheque propio'},
    {v:'cheque_tercero',l:'Cheque de tercero'},{v:'efectivo',l:'Efectivo'},{v:'otro',l:'Otro'}
  ]

  const compsFiltro = compPendientes.filter(c =>
    !form?.proveedor_id || c.proveedor_id === form.proveedor_id
  )

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>💸 Pagos a proveedores</div>
        <Btn onClick={()=>setForm({ medio_pago:'transferencia', fecha:hoy })}>+ Registrar pago</Btn>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Registre pagos de facturas y comprobantes pendientes
      </div>
      <Msg data={msg} />

      {/* Pendientes de pago */}
      {compPendientes.length > 0 && !form && (
        <Card style={{ marginBottom:16, background:'#fff8f0', border:'1px solid #fed7aa' }}>
          <div style={{ fontWeight:600, color:AM, fontSize:13, marginBottom:10 }}>
            ⚠️ {compPendientes.length} comprobante{compPendientes.length>1?'s':''} pendiente{compPendientes.length>1?'s':''} de pago
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {compPendientes.slice(0,5).map(c => {
              const prov = proveedores.find(p=>p.id===c.proveedor_id)
              const vencido = c.fecha_vencimiento && c.fecha_vencimiento < hoy
              return (
                <div key={c.id} style={{ display:'flex', justifyContent:'space-between',
                  alignItems:'center', padding:'8px 10px', background:'#fff',
                  borderRadius:8, border: vencido?'1px solid #fca5a5':'1px solid #e5e7eb' }}>
                  <div>
                    <span style={{ fontWeight:600, fontSize:13 }}>{prov?.razon_social}</span>
                    <span style={{ fontSize:11, color:GR, marginLeft:8 }}>{c.concepto}</span>
                    {vencido && <span style={{ fontSize:10, color:RJ, marginLeft:8, fontWeight:600 }}>VENCIDO</span>}
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <span style={{ fontWeight:700, color:RJ }}>{fmt(c.saldo_pendiente)}</span>
                    <Btn small color={VD} onClick={()=>setForm({
                      medio_pago:'transferencia', fecha:hoy,
                      proveedor_id:c.proveedor_id, comprobante_id:c.id,
                      monto: c.saldo_pendiente
                    })}>Pagar</Btn>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Formulario */}
      {form && (
        <Card style={{ marginBottom:16, border:'1.5px solid #86efac' }}>
          <div style={{ fontWeight:700, color:VD, fontSize:13, marginBottom:14 }}>{form.id?'✏ Editar pago':'💸 Registrar pago'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Sel label="Proveedor *" value={form.proveedor_id||''} onChange={v=>setForm(f=>({...f,proveedor_id:v,comprobante_id:''}))}
              opts={[{v:'',l:'— Seleccione —'},...proveedores.map(p=>({v:p.id,l:p.razon_social}))]} />
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Comprobante (opcional)</div>
              <select value={form.comprobante_id||''} onChange={e=>setForm(f=>({...f,comprobante_id:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
                <option value="">Sin comprobante</option>
                {compsFiltro.map(c=>(
                  <option key={c.id} value={c.id}>{c.tipo} {c.numero||''} — ${Number(c.saldo_pendiente).toLocaleString('es-AR')}</option>
                ))}
              </select>
            </div>
            <Sel label="Medio de pago" value={form.medio_pago||'transferencia'} onChange={v=>setForm(f=>({...f,medio_pago:v}))} opts={MEDIOS} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Monto bruto *</div>
              <input type="number" min="0" step="0.01" value={form.monto||''}
                onChange={e=>setForm(f=>({...f,monto:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontWeight:700, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Fecha *</div>
              <input type="date" value={form.fecha||''} onChange={e=>setForm(f=>({...f,fecha:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Referencia / N° cheque</div>
              <input value={form.referencia||''} placeholder="Nro. operación, cheque, etc."
                onChange={e=>setForm(f=>({...f,referencia:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
          {/* Retenciones */}
          <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'12px 14px', marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:600, color:VD, marginBottom:10 }}>Retenciones impositivas (opcional)</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 }}>
              <div>
                <div style={{ fontSize:11, color:GR, marginBottom:3 }}>Ret. IIBB $</div>
                <input type="number" min="0" step="0.01" value={form.retencion_iibb||''} onChange={e=>setForm(f=>({...f,retencion_iibb:e.target.value}))}
                  style={{ width:'100%', padding:'7px 9px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, boxSizing:'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:GR, marginBottom:3 }}>Ret. Ganancias $</div>
                <input type="number" min="0" step="0.01" value={form.retencion_ganancias||''} onChange={e=>setForm(f=>({...f,retencion_ganancias:e.target.value}))}
                  style={{ width:'100%', padding:'7px 9px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, boxSizing:'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:GR, marginBottom:3 }}>Ret. IVA $</div>
                <input type="number" min="0" step="0.01" value={form.retencion_iva||''} onChange={e=>setForm(f=>({...f,retencion_iva:e.target.value}))}
                  style={{ width:'100%', padding:'7px 9px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, boxSizing:'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:GR, marginBottom:3 }}>N° Orden de pago</div>
                <input value={form.nro_orden_pago||''} onChange={e=>setForm(f=>({...f,nro_orden_pago:e.target.value}))}
                  style={{ width:'100%', padding:'7px 9px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, boxSizing:'border-box' }} />
              </div>
            </div>
            {(form.monto && (form.retencion_iibb||form.retencion_ganancias||form.retencion_iva)) && (
              <div style={{ marginTop:10, fontSize:13, fontWeight:700, color:VD }}>
                Neto a pagar: {fmt((parseFloat(form.monto)||0)-(parseFloat(form.retencion_iibb)||0)-(parseFloat(form.retencion_ganancias)||0)-(parseFloat(form.retencion_iva)||0))}
              </div>
            )}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar} disabled={guardando} style={{ background:VD, color:'#fff' }}>{guardando?'⏳':'✓ Registrar pago'}</Btn>
            <BtnSec onClick={()=>{setForm(null);setMsg(null)}}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {/* Historial */}
      <Card>
        <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>Historial de pagos</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'#f3f4f6' }}>
                {['Fecha','Proveedor','Concepto/Comp.','Medio','Monto','Acciones'].map((h,i) => (
                  <th key={i} style={{ padding:'7px 10px', textAlign:i===4?'right':'left',
                    fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagos.length === 0 ? (
                <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:GR }}>Sin pagos registrados</td></tr>
              ) : pagos.map(p => {
                const prov = proveedores.find(pr=>pr.id===p.proveedor_id)
                const comp = compPendientes.find(c=>c.id===p.comprobante_id)
                return (
                  <tr key={p.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'7px 10px', whiteSpace:'nowrap', color:GR, fontSize:11 }}>{fmtD(p.fecha)}</td>
                    <td style={{ padding:'7px 10px', fontWeight:600 }}>{prov?.razon_social||'—'}</td>
                    <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>
                      {comp ? `${comp.tipo} ${comp.numero||''}` : p.referencia||'—'}
                    </td>
                    <td style={{ padding:'7px 10px', textTransform:'capitalize', color:GR }}>{p.medio_pago?.replace('_',' ')}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700, color:VD }}>{fmt(p.monto)}</td>
                    <td style={{ padding:'7px 10px' }}>
                      <div style={{ display:'flex', gap:4 }}>
                        <Btn small onClick={()=>setForm({...p})} style={{ background:'#f3f4f6', color:'#374151' }} title="Editar">✏</Btn>
                        <Btn small onClick={()=>eliminarPago(p)} style={{ background:'#fee2e2', color:RJ }} title="Eliminar">✕</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
