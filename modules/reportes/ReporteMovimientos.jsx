// modules — ReporteMovimientos.jsx
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

export default function ReporteMovimientos() {
  const { session, consorcioActivo, expensas } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [expSel, setExpSel]     = useState('')
  const [datos, setDatos]       = useState(null)
  const [cargando, setCargando] = useState(false)

  async function cargar(eid) {
    if (!eid) return
    setCargando(true)
  const pLabel = eid => {
    const exp = expensas.find(e => e.id === eid)

    const [
      { data: detalles },
      { data: gastos },
      { data: cobranzas },
      { data: pagosProv },
      { data: movUnidad },
    ] = await Promise.all([
      supabase.from('con_expensas_detalle').select('*').eq('expensa_id', eid),
      supabase.from('con_gastos').select('*, con_proveedores(razon_social)').eq('expensa_id', eid),
      supabase.from('con_cobranzas').select('*').eq('expensa_id', eid).eq('estado','vigente'),
      supabase.from('con_pagos_proveedor').select('*, con_proveedores(razon_social)')
        .eq('consorcio_id', consorcioId)
        .gte('fecha', exp?.periodo ? exp.periodo + '-01' : '2000-01-01')
        .lte('fecha', exp?.periodo ? exp.periodo + '-31' : '2099-12-31'),
      supabase.from('con_movimientos_unidad').select('*').eq('expensa_id', eid),
    ])

    const totalExpensa  = detalles?.reduce((a,d) => a + (parseFloat(d.monto)||0), 0) || 0
    const totalCobrado  = cobranzas?.reduce((a,c) => a + (parseFloat(c.monto)||0), 0) || 0
    const totalGastos   = gastos?.reduce((a,g) => a + (parseFloat(g.monto)||0), 0) || 0
    const totalPagProv  = pagosProv?.reduce((a,p) => a + (parseFloat(p.monto)||0), 0) || 0
    const totalDebitos  = movUnidad?.filter(m=>m.tipo==='debito' && m.estado==='vigente').reduce((a,m)=>a+(parseFloat(m.monto)||0),0) || 0
    const totalCreditos = movUnidad?.filter(m=>m.tipo==='credito' && m.estado==='vigente').reduce((a,m)=>a+(parseFloat(m.monto)||0),0) || 0

    // Agrupar gastos por categoría
    const porCategoria = {}
    for (const g of (gastos||[])) {
      const cat = g.categoria || 'varios'
      if (!porCategoria[cat]) porCategoria[cat] = { total:0, items:[] }
      porCategoria[cat].total += parseFloat(g.monto)||0
      porCategoria[cat].items.push(g)
    }

    // Estado de cobranza por UF
    const morosas   = detalles?.filter(d => d.estado==='morosa').length || 0
    const pagadas   = detalles?.filter(d => d.estado==='pagada').length || 0
    const pendientes = detalles?.filter(d => d.estado==='pendiente').length || 0

    setDatos({ exp, totalExpensa, totalCobrado, totalGastos, totalPagProv,
      totalDebitos, totalCreditos, porCategoria, morosas, pagadas, pendientes,
      gastos, cobranzas, pagosProv })
    setCargando(false)
  }

  useEffect(() => { if (expSel) cargar(expSel) }, [expSel])

  const pLabel = p => {
    if (!p) return '—'
    const [y,m] = p.split('-')
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    return `${meses[parseInt(m)-1]} ${y}`
  }

  const CATS = {
    sueldos:'Sueldos', servicios_publicos:'Servicios públicos', contratos:'Contratos',
    honorarios_admin:'Honorarios administración', seguros:'Seguros',
    mantenimiento:'Mantenimiento', electricidad:'Electricidad',
    gastos_bancarios:'Gastos bancarios', impuesto_municipal:'Impuesto municipal',
    cargas_sociales:'Cargas sociales', varios:'Varios',
  }

  async function exportarExcel() {
    if (!datos) return
    // Cargar XLSX si no está disponible
    if (!window.XLSX) {
      await new Promise((res,rej) => {
        const s=document.createElement('script')
        s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
        s.onload=res; s.onerror=rej; document.head.appendChild(s)
      })
    }
    const XLSX=window.XLSX
    const wb=XLSX.utils.book_new()
    // Hoja 1: Gastos
    const gastosData=[(datos.gastos||[]).map(g=>g.fecha),(datos.gastos||[]).map(g=>g.concepto),(datos.gastos||[]).map(g=>g.categoria),(datos.gastos||[]).map(g=>g.proveedor_nombre||g.con_proveedores?.razon_social||''),(datos.gastos||[]).map(g=>g.monto)]
    const gastosRows=[['Fecha','Concepto','Categoría','Proveedor','Monto'],...(datos.gastos||[]).map(g=>[g.fecha,g.concepto,g.categoria,g.proveedor_nombre||g.con_proveedores?.razon_social||'',parseFloat(g.monto)||0])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gastosRows), 'Gastos')
    // Hoja 2: Cobranzas
    const cobRows=[['Fecha','UF','Monto','Medio de pago','Recibo'],...(datos.cobranzas||[]).map(c=>[c.fecha,c.unidad_id,parseFloat(c.monto)||0,c.medio_pago,c.recibo_numero||''])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cobRows), 'Cobranzas')
    XLSX.writeFile(wb, `ReporteMovimientos_${datos.exp?.periodo||'periodo'}.xlsx`)
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>📈 Movimientos por período</div>
        {datos && <Btn small color={VD} onClick={exportarExcel}>📊 Exportar Excel</Btn>}
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Resumen completo de ingresos, egresos y estado de cobranza por período
      </div>

      <Card style={{ marginBottom:16 }}>
        <Sel label="Seleccione período" value={expSel} onChange={setExpSel}
          opts={[{v:'',l:'— Seleccione —'},
            ...expensas.map(e => ({ v:e.id, l:`${periodoLabel(e.periodo)} — ${e.tipo||''}` }))
          ]} />
      </Card>

      {cargando && <div style={{ textAlign:'center', padding:32, color:GR }}>⏳ Calculando...</div>}

      {datos && !cargando && (
        <>
          {/* Header período */}
          <div style={{ background:AZ, borderRadius:10, padding:'16px 20px', marginBottom:16, color:'#fff' }}>
            <div style={{ fontSize:11, opacity:0.75, textTransform:'uppercase', letterSpacing:'0.06em' }}>
              {consorcioActivo?.nombre}
            </div>
            <div style={{ fontSize:18, fontWeight:700, marginTop:2 }}>
              Período {periodoLabel(datos.exp?.periodo)}
            </div>
            <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>
              Vto: {datos.exp?.fecha_vencimiento ? new Date(datos.exp.fecha_vencimiento+'T00:00:00').toLocaleDateString('es-AR') : '—'}
              &nbsp;·&nbsp; Tipo: {datos.exp?.tipo}
            </div>
          </div>

          {/* KPIs principales */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
            {[
              { l:'Total expensas', v:fmt(datos.totalExpensa), c:AZ, bg:'#eff6ff' },
              { l:'Total cobrado',  v:fmt(datos.totalCobrado),  c:VD, bg:'#f0fdf4' },
              { l:'Pendiente cobro',v:fmt(Math.max(0,datos.totalExpensa-datos.totalCobrado)), c:RJ, bg:'#fff1f2' },
            ].map((k,i) => (
              <div key={i} style={{ background:k.bg, borderRadius:10, padding:'16px 18px', textAlign:'center' }}>
                <div style={{ fontSize:11, color:k.c, fontWeight:600, textTransform:'uppercase', marginBottom:6 }}>{k.l}</div>
                <div style={{ fontSize:22, fontWeight:800, color:k.c }}>{k.v}</div>
              </div>
            ))}
          </div>

          {/* Estado de cobranza */}
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:12 }}>Estado de cobranza</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
              {[
                { l:'Pagadas', v:datos.pagadas, c:VD, bg:'#dcfce7' },
                { l:'Pendientes', v:datos.pendientes, c:AM, bg:'#fef9c3' },
                { l:'Morosas', v:datos.morosas, c:RJ, bg:'#fee2e2' },
                { l:'Total UFs', v:(datos.pagadas+datos.pendientes+datos.morosas), c:AZ, bg:'#eff6ff' },
              ].map((k,i) => (
                <div key={i} style={{ background:k.bg, borderRadius:8, padding:'12px', textAlign:'center' }}>
                  <div style={{ fontSize:24, fontWeight:800, color:k.c }}>{k.v}</div>
                  <div style={{ fontSize:11, color:k.c, fontWeight:600 }}>{k.l}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Egresos por categoría */}
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:12 }}>
              Egresos por rubro — Total {fmt(datos.totalGastos)}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {Object.entries(datos.porCategoria)
                .sort((a,b) => b[1].total - a[1].total)
                .map(([cat, info]) => {
                  const pct = datos.totalGastos > 0 ? (info.total/datos.totalGastos*100) : 0
                  return (
                    <div key={cat}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                        <span style={{ fontSize:12, fontWeight:500 }}>{CATS[cat]||cat}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:RJ }}>{fmt(info.total)}</span>
                      </div>
                      <div style={{ background:'#f3f4f6', borderRadius:4, height:6 }}>
                        <div style={{ background:AZ, width:`${pct}%`, height:6, borderRadius:4 }} />
                      </div>
                    </div>
                  )
                })
              }
            </div>
          </Card>

          {/* Pagos a proveedores en el período */}
          {datos.pagosProv?.length > 0 && (
            <Card style={{ marginBottom:16 }}>
              <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:12 }}>
                Pagos a proveedores — {fmt(datos.totalPagProv)}
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['Fecha','Proveedor','Medio','Monto'].map((h,i) => (
                      <th key={i} style={{ padding:'6px 10px', textAlign:i===3?'right':'left',
                        fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos.pagosProv.map(p => (
                    <tr key={p.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'6px 10px', color:GR, fontSize:11 }}>
                        {new Date(p.fecha+'T00:00:00').toLocaleDateString('es-AR')}
                      </td>
                      <td style={{ padding:'6px 10px' }}>{p.con_proveedores?.razon_social||'—'}</td>
                      <td style={{ padding:'6px 10px', color:GR, textTransform:'capitalize' }}>
                        {p.medio_pago?.replace('_',' ')}
                      </td>
                      <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600, color:RJ }}>
                        {fmt(p.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Cobranzas del período */}
          {datos.cobranzas?.length > 0 && (
            <Card>
              <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:12 }}>
                Cobranzas registradas — {fmt(datos.totalCobrado)}
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['Fecha','UF','Medio','Recibo','Monto'].map((h,i) => (
                      <th key={i} style={{ padding:'6px 10px', textAlign:i===4?'right':'left',
                        fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos.cobranzas.map(c => (
                    <tr key={c.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'6px 10px', color:GR, fontSize:11 }}>
                        {new Date(c.fecha+'T00:00:00').toLocaleDateString('es-AR')}
                      </td>
                      <td style={{ padding:'6px 10px', fontWeight:600 }}>{c.unidad_id?.split('-')[1]||c.unidad_id}</td>
                      <td style={{ padding:'6px 10px', color:GR, textTransform:'capitalize' }}>
                        {c.medio_pago?.replace('_',' ')||'—'}
                      </td>
                      <td style={{ padding:'6px 10px', color:GR, fontSize:11 }}>{c.recibo_numero||'—'}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600, color:VD }}>
                        {fmt(c.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
