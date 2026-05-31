// modules — CtaProveedor.jsx
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

export default function CtaProveedor() {
  const { session, consorcioId, proveedores } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [provSel, setProvSel] = useState('')
  const [comps, setComps]     = useState([])
  const [pagos, setPagos]     = useState([])
  const [cargando, setCargando] = useState(false)

  async function cargar(pid) {
    if (!pid) return
    setCargando(true)
    const [{ data:c }, { data:p }] = await Promise.all([
      supabase.from('con_comprobantes_proveedor').select('*')
        .eq('proveedor_id', pid).eq('consorcio_id', consorcioId)
        .order('fecha', { ascending:true }),
      supabase.from('con_pagos_proveedor').select('*')
        .eq('proveedor_id', pid).eq('consorcio_id', consorcioId)
        .order('fecha', { ascending:true }),
    ])
    setComps(c||[])
    setPagos(p||[])
    setCargando(false)
  }

  useEffect(() => { if (provSel) cargar(provSel) }, [provSel])

  const fmt = n => '$' + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2 })
  const fmtD = d => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')

  const totalDeuda    = comps.filter(c=>c.estado!=='anulado').reduce((a,c)=>a+(parseFloat(c.monto_total)||0),0)
  const totalPagado   = pagos.reduce((a,p)=>a+(parseFloat(p.monto)||0),0)
  const saldoAdeudado = Math.max(0, totalDeuda - totalPagado)
  const prov = proveedores.find(p=>p.id===provSel)

  // Construir movimientos combinados con filtro por fechas
  const movs = [
    ...comps.filter(c=>c.estado!=='anulado').map(c=>({ fecha:c.fecha, tipo:'debito', concepto:`${c.tipo} ${c.numero||''} — ${c.concepto}`, monto:parseFloat(c.monto_total)||0 })),
    ...pagos.map(p=>({ fecha:p.fecha, tipo:'credito', concepto:`Pago — ${p.medio_pago?.replace('_',' ')||''}${p.referencia?' ('+p.referencia+')':''}`, monto:parseFloat(p.monto)||0 })),
  ].sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||''))
   .filter(m=>(!fDesde||m.fecha>=fDesde)&&(!fHasta||m.fecha<=fHasta))

  let acc = 0
  const conSaldo = movs.map(m => {
    if (m.tipo==='debito')  acc += m.monto
    if (m.tipo==='credito') acc -= m.monto
    return { ...m, saldo_acum: acc }
  })

  function handlePDFCta(){
    exportarPDF({titulo:`Cuenta Corriente — ${prov?.razon_social||'Proveedor'}`,logoB64:null,
      columnas:[{key:'fecha',label:'Fecha',nowrap:true},{key:'concepto',label:'Concepto'},
        {key:'debito',label:'Débito',align:'right'},{key:'credito',label:'Crédito',align:'right'},{key:'saldo',label:'Saldo',align:'right'}],
      filas:conSaldo.map(m=>({fecha:fmtD(m.fecha),concepto:m.concepto,
        debito:m.tipo==='debito'?fmt(m.monto):'',credito:m.tipo==='credito'?fmt(m.monto):'',
        saldo:fmt(Math.abs(m.saldo_acum))+(m.saldo_acum<0?' CR':'')})),
      totales:{fecha:'',concepto:'Saldo adeudado',debito:fmt(totalDeuda),credito:fmt(totalPagado),saldo:fmt(saldoAdeudado)}
    })
  }
  function handleExcelCta(){
    exportarExcel({titulo:`Cta-Cte-${prov?.razon_social||'Proveedor'}`,
      columnas:[{key:'fecha',label:'Fecha'},{key:'concepto',label:'Concepto'},{key:'tipo',label:'Tipo'},
        {key:'debito',label:'Débito'},{key:'credito',label:'Crédito'},{key:'saldo',label:'Saldo Acum.'}],
      filas:conSaldo.map(m=>({fecha:m.fecha,concepto:m.concepto,tipo:m.tipo==='debito'?'Débito':'Crédito',
        debito:m.tipo==='debito'?m.monto:'',credito:m.tipo==='credito'?m.monto:'',saldo:m.saldo_acum}))
    })
  }

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>📊 Cuenta corriente proveedor</div>
      <div style={{ fontSize:12, color:GR, marginBottom:12 }}>Comprobantes, pagos y saldo adeudado por proveedor</div>

      <Card style={{ marginBottom:12 }}>
        <Sel label="Proveedor" value={provSel} onChange={v=>{setProvSel(v);setFDesde('');setFHasta('')}}
          opts={[{v:'',l:'— Seleccione proveedor —'},...proveedores.map(p=>({v:p.id,l:p.razon_social}))]} />
      </Card>

      {provSel && (
        <>
          {/* Info proveedor + KPIs */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div style={{ background: saldoAdeudado>0?'#fee2e2':'#dcfce7', borderRadius:10, padding:'14px 18px', textAlign:'center' }}>
              <div style={{ fontSize:11, fontWeight:600, color:saldoAdeudado>0?RJ:VD, textTransform:'uppercase', marginBottom:4 }}>Saldo adeudado</div>
              <div style={{ fontSize:22, fontWeight:800, color:saldoAdeudado>0?RJ:VD }}>
                {saldoAdeudado>0 ? fmt(saldoAdeudado) : '✓ Sin deuda'}
              </div>
            </div>
            <div style={{ background:'#fff', borderRadius:10, padding:'14px 18px', textAlign:'center', boxShadow:'0 1px 6px #0001' }}>
              <div style={{ fontSize:11, fontWeight:600, color:GR, textTransform:'uppercase', marginBottom:4 }}>Total facturado</div>
              <div style={{ fontSize:20, fontWeight:700, color:RJ }}>{fmt(totalDeuda)}</div>
            </div>
            <div style={{ background:'#fff', borderRadius:10, padding:'14px 18px', textAlign:'center', boxShadow:'0 1px 6px #0001' }}>
              <div style={{ fontSize:11, fontWeight:600, color:GR, textTransform:'uppercase', marginBottom:4 }}>Total pagado</div>
              <div style={{ fontSize:20, fontWeight:700, color:VD }}>{fmt(totalPagado)}</div>
            </div>
          </div>

          {/* Filtros CtaProveedor */}
          <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ fontSize:12, color:GR, display:'flex', gap:6, alignItems:'center' }}>
              <span>Desde</span>
              <input type="date" value={fDesde} onChange={e=>setFDesde(e.target.value)} style={{ padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12 }} />
              <span>hasta</span>
              <input type="date" value={fHasta} onChange={e=>setFHasta(e.target.value)} style={{ padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12 }} />
              {(fDesde||fHasta) && <Btn small onClick={()=>{setFDesde('');setFHasta('')}} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>}
            </div>
            <Btn small color={GR} onClick={handlePDFCta}>🖨️ PDF</Btn>
            <Btn small color={VD} onClick={handleExcelCta}>📊 Excel</Btn>
          </div>

          <Card>
            {cargando ? (
              <div style={{ textAlign:'center', padding:24, color:GR }}>⏳ Cargando...</div>
            ) : conSaldo.length===0 ? (
              <div style={{ textAlign:'center', padding:24, color:GR }}>Sin movimientos para este proveedor{(fDesde||fHasta)?' en el rango seleccionado':''}</div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f3f4f6' }}>
                      {['Fecha','Concepto','Débito','Crédito','Saldo'].map((h,i)=>(
                        <th key={i} style={{ padding:'7px 10px', textAlign:i>=2?'right':'left',
                          fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {conSaldo.map((m,i)=>(
                      <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                        <td style={{ padding:'7px 10px', whiteSpace:'nowrap', color:GR, fontSize:11 }}>{fmtD(m.fecha)}</td>
                        <td style={{ padding:'7px 10px' }}>{m.concepto}</td>
                        <td style={{ padding:'7px 10px', textAlign:'right', color:RJ, fontWeight:600 }}>{m.tipo==='debito'?fmt(m.monto):''}</td>
                        <td style={{ padding:'7px 10px', textAlign:'right', color:VD, fontWeight:600 }}>{m.tipo==='credito'?fmt(m.monto):''}</td>
                        <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700, color:m.saldo_acum>0?RJ:VD }}>
                          {fmt(Math.abs(m.saldo_acum))}{m.saldo_acum<0&&<span style={{fontSize:9,marginLeft:2}}>CR</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'#f0f4ff', borderTop:'2px solid #1A3FA0' }}>
                      <td colSpan={2} style={{ padding:'8px 10px', fontWeight:700, color:AZ }}>Saldo final</td>
                      <td colSpan={3} style={{ padding:'8px 10px', textAlign:'right', fontWeight:800, fontSize:15, color:saldoAdeudado>0?RJ:VD }}>
                        {saldoAdeudado>0 ? `Debe ${fmt(saldoAdeudado)}` : 'Sin deuda'}
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
