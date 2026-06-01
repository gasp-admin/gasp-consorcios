// modules — EstadoFinanciero.jsx
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

export default function EstadoFinanciero() {
  const { session, consorcioActivo, proveedores, expensas } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [datos, setDatos]       = useState(null)
  const [cargando, setCargando] = useState(true)
  const [desde, setDesde]       = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth()-3); return d.toISOString().split('T')[0]
  })
  const [hasta, setHasta]       = useState(new Date().toISOString().split('T')[0])

  async function cargar() {
    setCargando(true)
    const [
      { data: detalles },
      { data: cobranzas },
      { data: gastos },
      { data: pagosProv },
      { data: movUnidad },
      { data: compPend },
      { data: expensasCerradas },
    ] = await Promise.all([
      supabase.from('con_expensas_detalle').select('monto,saldo_anterior,interes_mora,pagos_periodo,estado')
        .eq('consorcio_id', consorcioId),
      supabase.from('con_cobranzas').select('monto,fecha,medio_pago')
        .eq('consorcio_id', consorcioId).in('estado',['vigente','acreditado','cobrado'])
        .gte('fecha', desde).lte('fecha', hasta),
      supabase.from('con_gastos').select('monto,categoria,fecha')
        .eq('consorcio_id', consorcioId)
        .gte('fecha', desde).lte('fecha', hasta),
      supabase.from('con_pagos_proveedor').select('monto,fecha')
        .eq('consorcio_id', consorcioId)
        .gte('fecha', desde).lte('fecha', hasta),
      supabase.from('con_movimientos_unidad').select('monto,tipo')
        .eq('consorcio_id', consorcioId).eq('estado','vigente'),
      supabase.from('con_comprobantes_proveedor').select('saldo_pendiente')
        .eq('consorcio_id', consorcioId).in('estado',['pendiente','pagado_parcial']),
      // Últimas expensas cerradas para mostrar saldos reales migrados
      supabase.from('con_expensas').select('periodo,saldo_caja_final,total_cobrado,total_gastos,total_expensa')
        .eq('consorcio_id', consorcioId).in('estado',['cerrado','cerrada'])
        .order('periodo', { ascending: false }).limit(13),
    ])

    // Deudores — saldo pendiente según la última expensa abierta
    // Se toma de con_expensas_detalle filtrado a la expensa abierta actual
    // Si no hay expensa abierta, se toma la última cerrada
    // Fórmula por UF: MAX(0, saldo_anterior + monto + interes - pagos)
    // Deudores: usar el estado del detalle como fuente de verdad
    // 'pagada' = sin deuda | 'parcial' = debe parte | 'pendiente' = debe todo
    const deudores = (detalles||[]).reduce((a,d) => {
      if (d.estado === 'pagada') return a  // Sin deuda
      if (d.estado === 'pendiente') return a + (parseFloat(d.monto)||0) + (parseFloat(d.interes_mora)||0)
      // parcial: debe la diferencia
      const pagado = parseFloat(d.pagos_periodo)||0
      const cargo  = (parseFloat(d.monto)||0) + (parseFloat(d.interes_mora)||0)
      return a + Math.max(0, cargo - pagado)
    }, 0)

    // Acreedores (facturas pendientes de pagar a proveedores)
    const acreedores = (compPend||[]).reduce((a,c) => a + (parseFloat(c.saldo_pendiente)||0), 0)

    // Ingresos del período
    // Fuente 1: cobranzas operativas registradas en con_cobranzas (fecha en rango)
    const ingresosCobranzas = (cobranzas||[]).reduce((a,c) => a + (parseFloat(c.monto)||0), 0)
    // Fuente 2: total_cobrado de expensas cerradas del período (para consorcios históricos)
    // Solo usar si no hay cobranzas operativas (evitar doble conteo)
    const ingresosPorExpensas = ingresosCobranzas === 0
      ? (expensasCerradas||[]).reduce((a,e) => {
          // Solo incluir expensas cuyo período cae en el rango seleccionado
          const periodoFecha = new Date(e.periodo + '-15')
          const desdeDate = desde ? new Date(desde) : null
          const hastaDate = hasta ? new Date(hasta) : null
          if (desdeDate && periodoFecha < desdeDate) return a
          if (hastaDate && periodoFecha > hastaDate) return a
          return a + (parseFloat(e.total_cobrado)||0)
        }, 0)
      : 0
    const ingresos = ingresosCobranzas + ingresosPorExpensas

    // Egresos del período
    // NOTA: con_gastos ya incluye todos los gastos del consorcio (honorarios, servicios, etc.)
    // con_pagos_proveedor son pagos efectivos a proveedores — pueden solaparse con gastos
    // Para evitar doble conteo, el egreso del período = solo gastos del consorcio
    const egresosGastos   = (gastos||[]).reduce((a,g) => a + (parseFloat(g.monto)||0), 0)
    const egresosPagProv  = (pagosProv||[]).reduce((a,p) => a + (parseFloat(p.monto)||0), 0)
    // Egresos = gastos del consorcio (la fuente más confiable para el período)
    const egresos = egresosGastos

    // Resultado del período = Ingresos cobrados - Gastos ejecutados
    const resultado = ingresos - egresos

    // Ingresos por medio de pago
    const porMedio = {}
    for (const c of (cobranzas||[])) {
      const m = c.medio_pago || 'otros'
      porMedio[m] = (porMedio[m]||0) + (parseFloat(c.monto)||0)
    }

    // Última expensa cerrada con saldo real (datos migrados del PDF)
    const ultimaExpensa = (expensasCerradas||[])[0] || null
    const saldoCajaUltimo = ultimaExpensa ? parseFloat(ultimaExpensa.saldo_caja_final)||0 : null
    const cobradoUltimo   = ultimaExpensa ? parseFloat(ultimaExpensa.total_cobrado)||0   : null
    const gastosUltimo    = ultimaExpensa ? parseFloat(ultimaExpensa.total_gastos)||0    : null

    setDatos({ deudores, acreedores, ingresos, egresos, egresosGastos,
      egresosPagProv, resultado, porMedio,
      expensasCerradas: expensasCerradas||[],
      ultimaExpensa, saldoCajaUltimo, cobradoUltimo, gastosUltimo })
    setCargando(false)
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId, desde, hasta])

  const MEDIOS_LABEL = {
    transferencia:'Transferencia', efectivo:'Efectivo',
    cheque_propio:'Cheque propio', cheque_tercero:'Cheque de tercero', otros:'Otros'
  }

  async function exportarEFPDF() {
    if (!datos) return
    exportarPDF({
      titulo: 'Estado Financiero',
      subtitulo: (consorcioActivo?.nombre||'') + '  |  Período: ' + desde + ' al ' + hasta,
      logoB64: null,
      columnas: [{key:'concepto',label:'Concepto'},{key:'importe',label:'Importe'}],
      filas: [
        {concepto:'Deudores (a cobrar)', importe:'$'+(Number(datos.deudores)||0).toLocaleString('es-AR',{minimumFractionDigits:2})},
        {concepto:'Acreedores (a pagar)', importe:'$'+(Number(datos.acreedores)||0).toLocaleString('es-AR',{minimumFractionDigits:2})},
        {concepto:'─── INGRESOS DEL PERÍODO ───', importe:''},
        {concepto:'  Cobrado en período', importe:'$'+(Number(datos.ingresos)||0).toLocaleString('es-AR',{minimumFractionDigits:2})},
        {concepto:'─── EGRESOS DEL PERÍODO ───', importe:''},
        {concepto:'  Gastos del consorcio', importe:'$'+(Number(datos.egresosGastos)||0).toLocaleString('es-AR',{minimumFractionDigits:2})},
        {concepto:'  TOTAL EGRESOS', importe:'$'+(Number(datos.egresos)||0).toLocaleString('es-AR',{minimumFractionDigits:2})},
        {concepto:'RESULTADO NETO', importe:(datos.resultado>=0?'+':'')+('$'+(Number(datos.resultado)||0).toLocaleString('es-AR',{minimumFractionDigits:2}))},
      ],
    })
  }

  async function exportarEFExcel() {
    if (!datos) return
    if (!window.XLSX) await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)})
    const XLSX = window.XLSX
    const rows = [
      ['Estado Financiero — ' + (consorcioActivo?.nombre||'')],
      ['Período: ' + desde + ' al ' + hasta],
      [],
      ['Concepto','Importe'],
      ['Deudores (a cobrar)', fmt(datos.deudores)],
      ['Acreedores (a pagar)', fmt(datos.acreedores)],
      [],['INGRESOS'],
      ['Cobrado en período', fmt(datos.ingresos)],
      [],['EGRESOS'],
      ['Gastos del consorcio', fmt(datos.egresosGastos)],
      ['Total egresos', fmt(datos.egresos)],
      [],
      ['RESULTADO NETO', fmt(datos.resultado)],
      [],
      ['HISTORIAL LIQUIDACIONES','','',''],
      ['Período','Total gastos','Total cobrado','Saldo final'],
      ...(datos.expensasCerradas||[]).map(e=>[e.periodo,fmt(e.total_gastos),fmt(e.total_cobrado),fmt(e.saldo_caja_final)]),
    ]
    XLSX.utils.book_append_sheet(XLSX.utils.book_new(), XLSX.utils.aoa_to_sheet(rows), 'Estado Financiero')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Estado Financiero')
    XLSX.writeFile(wb, `EstadoFinanciero_${consorcioActivo?.id||'cons'}_${hasta}.xlsx`)
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>🏦 Estado financiero</div>
        {datos && (
          <div style={{ display:'flex', gap:8 }}>
            <Btn small color={GR} onClick={exportarEFPDF}>🖨️ PDF</Btn>
            <Btn small color={VD} onClick={exportarEFExcel}>📊 Excel</Btn>
          </div>
        )}
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Posición financiera general de {consorcioActivo?.nombre}
      </div>

      {/* Filtro período */}
      <Card style={{ marginBottom:16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Desde</div>
            <input type="date" value={desde} onChange={e=>setDesde(e.target.value)}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Hasta</div>
            <input type="date" value={hasta} onChange={e=>setHasta(e.target.value)}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
          </div>
        </div>
      </Card>

      {cargando ? (
        <div style={{ textAlign:'center', padding:32, color:GR }}>⏳ Calculando...</div>
      ) : datos && (
        <>
          {/* Posición patrimonial */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
            <div style={{ background:'#eff6ff', borderRadius:10, padding:'20px', border:'1px solid #bfdbfe' }}>
              <div style={{ fontSize:12, fontWeight:600, color:AZ, textTransform:'uppercase', marginBottom:8 }}>
                📥 Deudores (a cobrar)
              </div>
              <div style={{ fontSize:28, fontWeight:800, color:AZ }}>{fmt(datos.deudores)}</div>
              <div style={{ fontSize:11, color:GR, marginTop:4 }}>
                Expensas pendientes de cobro a propietarios
              </div>
            </div>
            <div style={{ background:'#fff1f2', borderRadius:10, padding:'20px', border:'1px solid #fecdd3' }}>
              <div style={{ fontSize:12, fontWeight:600, color:RJ, textTransform:'uppercase', marginBottom:8 }}>
                📤 Acreedores (a pagar)
              </div>
              <div style={{ fontSize:28, fontWeight:800, color:RJ }}>{fmt(datos.acreedores)}</div>
              <div style={{ fontSize:11, color:GR, marginTop:4 }}>
                Facturas de proveedores pendientes de pago
              </div>
            </div>
          </div>

          {/* Resultado del período */}
          <Card style={{ marginBottom:16, background: datos.resultado>=0?'#f0fdf4':'#fff1f2',
            border:`1.5px solid ${datos.resultado>=0?'#86efac':'#fca5a5'}` }}>
            <div style={{ fontWeight:600, fontSize:13, color: datos.resultado>=0?VD:RJ, marginBottom:14 }}>
              Resultado del período seleccionado
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
              {[
                { l:'Ingresos (cobrado)', v:fmt(datos.ingresos), c:VD },
                { l:'Egresos (pagado)',   v:fmt(datos.egresos),  c:RJ },
                { l:'Resultado neto',     v:`${datos.resultado>=0?'+':''}${fmt(datos.resultado)}`, c:datos.resultado>=0?VD:RJ },
              ].map((k,i) => (
                <div key={i} style={{ textAlign:'center', padding:'12px', background:'#fff',
                  borderRadius:8, boxShadow:'0 1px 4px #0001' }}>
                  <div style={{ fontSize:11, color:GR, fontWeight:600, textTransform:'uppercase', marginBottom:6 }}>{k.l}</div>
                  <div style={{ fontSize:20, fontWeight:800, color:k.c }}>{k.v}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Detalle egresos */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
            <Card>
              <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>Detalle egresos</div>
              <div style={{ display:'flex', justifyContent:'space-between',
                padding:'8px 0', borderBottom:'1px solid #f3f4f6' }}>
                <span style={{ fontSize:13 }}>Gastos del consorcio</span>
                <span style={{ fontWeight:700, color:RJ }}>{fmt(datos.egresosGastos)}</span>
              </div>
              {datos.egresosPagProv > 0 && (
                <div style={{ display:'flex', justifyContent:'space-between',
                  padding:'4px 0', borderBottom:'1px solid #f3f4f6' }}>
                  <span style={{ fontSize:11, color:GR, fontStyle:'italic' }}>
                    Pagos a proveedores (informativo)
                  </span>
                  <span style={{ fontSize:11, color:GR }}>{fmt(datos.egresosPagProv)}</span>
                </div>
              )}
              <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 0',
                borderTop:'2px solid #1A3FA0', marginTop:4 }}>
                <span style={{ fontWeight:700, fontSize:13 }}>Total</span>
                <span style={{ fontWeight:800, color:RJ }}>{fmt(datos.egresos)}</span>
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>Ingresos por medio</div>
              {Object.entries(datos.porMedio).length === 0 ? (
                <div style={{ color:GR, fontSize:12, padding:'8px 0' }}>Sin cobranzas en el período</div>
              ) : Object.entries(datos.porMedio).map(([m,v],i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between',
                  padding:'8px 0', borderBottom:'1px solid #f3f4f6' }}>
                  <span style={{ fontSize:13 }}>{MEDIOS_LABEL[m]||m}</span>
                  <span style={{ fontWeight:700, color:VD }}>{fmt(v)}</span>
                </div>
              ))}
            </Card>
          </div>

          {/* Historial de liquidaciones cerradas (datos migrados de PDFs) */}
          {(datos.expensasCerradas||[]).length > 0 && (
            <Card style={{ marginBottom:16 }}>
              <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>
                📋 Historial de liquidaciones cerradas
              </div>
              <div style={{ fontSize:11, color:GR, marginBottom:10 }}>
                Saldos finales reales según liquidaciones Abril 2026 (datos migrados de PDFs)
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f3f4f6' }}>
                      <th style={{ padding:'6px 10px', textAlign:'left', fontWeight:600 }}>Período</th>
                      <th style={{ padding:'6px 10px', textAlign:'right', fontWeight:600 }}>Total gastos</th>
                      <th style={{ padding:'6px 10px', textAlign:'right', fontWeight:600 }}>Total cobrado</th>
                      <th style={{ padding:'6px 10px', textAlign:'right', fontWeight:600 }}>Saldo final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(datos.expensasCerradas||[]).map((e,i) => {
                      const sf = parseFloat(e.saldo_caja_final)||0
                      return (
                        <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                          <td style={{ padding:'6px 10px', fontWeight:600 }}>{e.periodo}</td>
                          <td style={{ padding:'6px 10px', textAlign:'right', color:RJ }}>
                            {e.total_gastos > 0 ? fmt(e.total_gastos) : '—'}
                          </td>
                          <td style={{ padding:'6px 10px', textAlign:'right', color:VD }}>
                            {e.total_cobrado > 0 ? fmt(e.total_cobrado) : '—'}
                          </td>
                          <td style={{ padding:'6px 10px', textAlign:'right',
                            fontWeight:800, color: sf >= 0 ? VD : RJ }}>
                            {sf !== 0 ? (sf > 0 ? '+' : '') + fmt(sf) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {datos.ultimaExpensa && datos.saldoCajaUltimo !== null && (
                <div style={{ marginTop:10, padding:'10px 12px', borderRadius:8,
                  background: datos.saldoCajaUltimo >= 0 ? '#f0fdf4' : '#fff1f2',
                  border: '1px solid ' + (datos.saldoCajaUltimo >= 0 ? '#86efac' : '#fca5a5') }}>
                  <span style={{ fontSize:12, fontWeight:600,
                    color: datos.saldoCajaUltimo >= 0 ? VD : RJ }}>
                    💰 Saldo arrastrado a Mayo 2026: {datos.saldoCajaUltimo > 0 ? '+' : ''}{fmt(datos.saldoCajaUltimo)}
                  </span>
                  <span style={{ fontSize:11, color:GR, marginLeft:8 }}>
                    (saldo final Abril 2026 según liquidación)
                  </span>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
