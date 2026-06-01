// modules — BalanceAnual.jsx
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

const BA_CATS_ORDER = ['contratos_abonos','gastos_bancarios','honorarios_admin','impuesto_municipal','mantenimiento','otros','seguros','servicios_publicos','varios']
const BA_CATS_LABEL = {
  contratos_abonos:'CONTRATOS Y ABONOS', gastos_bancarios:'GASTOS BANCARIOS',
  honorarios_admin:'GASTOS DE ADMINISTRACIÓN', impuesto_municipal:'IMPUESTO MUNICIPAL',
  mantenimiento:'MANTENIMIENTO GENERAL', otros:'OTROS EGRESOS',
  seguros:'SEGUROS', servicios_publicos:'SERVICIOS PÚBLICOS', varios:'VARIOS'
}
function baNormCat(c) {
  const cc = (c||'').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').trim()
  if (cc.includes('contrat')||cc.includes('abon')||cc.includes('piscin')||cc.includes('limpiez')||cc.includes('porton')||cc.includes('portón')) return 'contratos_abonos'
  if (cc.includes('banc')||cc.includes('financiero')) return 'gastos_bancarios'
  if (cc.includes('honorar')||cc.includes('admin')) return 'honorarios_admin'
  if (cc.includes('municipal')||cc.includes('impuest')) return 'impuesto_municipal'
  if (cc.includes('manten')||cc.includes('parque')||cc.includes('ascensor')||cc.includes('bomba')||cc.includes('pintura')||cc.includes('matafuego')||cc.includes('construc')||cc.includes('electric')||cc.includes('gas mant')) return 'mantenimiento'
  if (cc.includes('seguro')) return 'seguros'
  if (cc.includes('energia')||cc.includes('energía')||cc.includes('gas serv')||cc.includes('servicio publ')||cc.includes('calp')||cc.includes('camuzzi')||cc.includes('edenor')||cc.includes('edea')) return 'servicios_publicos'
  if (cc.includes('varios')||cc.includes('material')||cc.includes('ferret')) return 'varios'
  return 'otros'
}

export default function BalanceAnual() {
  const { session, consorcioActivo } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [periodoDesde, setPeriodoDesde] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear()-1); return d.toISOString().slice(0,7)
  })
  const [periodoHasta, setPeriodoHasta] = useState(() => new Date().toISOString().slice(0,7))
  const [datos, setDatos]       = useState(null)
  const [cargando, setCargando] = useState(false)
  const [msg, setMsg]           = useState(null)
  const [vista, setVista]       = useState('tabla') // 'tabla' | 'analisis'

  const fmt  = n => (Number(n)||0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})
  const fmtS = (n, forzarSigno) => {
    const v = Number(n)||0; if (v===0) return '—'
    const s = '$' + Math.abs(v).toLocaleString('es-AR',{minimumFractionDigits:2})
    return v < 0 ? '-' + s : (forzarSigno && v > 0 ? '+' + s : s)
  }
  const perLabel = p => {
    if (!p) return ''
    const [y,m] = p.split('-')
    return (['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][parseInt(m)-1]||m) + ' ' + y.slice(2)
  }

  async function generar() {
    if (!periodoDesde || !periodoHasta || periodoDesde > periodoHasta)
      return setMsg({tipo:'warn', texto:'Seleccioná un rango de períodos válido'})
    setCargando(true); setDatos(null); setMsg(null)
    try {
      // 1) Expensas del rango
      const {data: expensas, error: errExp} = await supabase.from('con_expensas')
        .select('id,periodo,total_cobrado,saldo_caja_final,ingresos_termino,ingresos_adeudados,ingresos_intereses')
        .eq('consorcio_id', consorcioId)
        .gte('periodo', periodoDesde).lte('periodo', periodoHasta)
        .order('periodo')
      if (errExp) throw new Error(errExp.message)
      if (!expensas || expensas.length === 0) {
        setMsg({tipo:'warn', texto:'No hay períodos en el rango seleccionado'})
        setCargando(false); return
      }

      const expIds = expensas.map(e => e.id)

      // 2) Ítems de liquidación (rubros estructurados) — fuente principal de gastos
      const {data: items} = await supabase.from('con_liquidacion_items')
        .select('rubro_nro,rubro_nombre,concepto,proveedor_nombre,importe_total,expensa_id')
        .in('expensa_id', expIds)

      // 3) Gastos adicionales (no importados desde PDF)
      const {data: gastos} = await supabase.from('con_gastos')
        .select('categoria,concepto,monto,expensa_id')
        .in('expensa_id', expIds)
        .not('id','like','GHIST-%') // excluir los gastos generados automáticamente desde historial

      // 4) Saldo anterior al primer período
      let saldoInicial0 = 0
      const {data: expAnt} = await supabase.from('con_expensas')
        .select('saldo_caja_final').eq('consorcio_id', consorcioId)
        .lt('periodo', periodoDesde).order('periodo', {ascending:false}).limit(1)
      if (expAnt && expAnt[0]) saldoInicial0 = parseFloat(expAnt[0].saldo_caja_final)||0

      // ── Construir mapas de ingresos y saldos por período ──
      const saldoInicialPorPeriodo = {}
      const saldoFinalPorPeriodo   = {}
      const ingExpensasPorPeriodo  = {}
      const ingVariosPorPeriodo    = {}
      const ingInteresesPorPeriodo = {}
      let totalIngresos = 0, totalIngExpensas = 0, totalIngVarios = 0

      for (let i = 0; i < expensas.length; i++) {
        const p  = expensas[i].periodo
        const sf = parseFloat(expensas[i].saldo_caja_final)||0
        const tc = parseFloat(expensas[i].ingresos_termino) || parseFloat(expensas[i].total_cobrado)||0
        const iv = parseFloat(expensas[i].ingresos_adeudados)||0
        const ii = parseFloat(expensas[i].ingresos_intereses)||0
        saldoInicialPorPeriodo[p] = i===0 ? saldoInicial0 : (parseFloat(expensas[i-1].saldo_caja_final)||0)
        saldoFinalPorPeriodo[p]   = sf
        ingExpensasPorPeriodo[p]  = tc
        ingVariosPorPeriodo[p]    = iv
        ingInteresesPorPeriodo[p] = ii
        totalIngExpensas += tc; totalIngVarios += iv
        totalIngresos    += tc + iv + ii
      }

      // ── Construir mapa de egresos: cat → concepto → período → monto ──
      // Priorizar con_liquidacion_items (rubros del PDF)
      const mapa        = {}  // cat → concepto → { per → monto }
      const totalsCat   = {}  // cat → { per → monto }
      const totalsGlobal = {} // per → monto
      let totalAnual = 0

      const registrarGasto = (cat, concepto, per, monto) => {
        if (!per || !monto) return
        if (!mapa[cat])               mapa[cat] = {}
        if (!mapa[cat][concepto])     mapa[cat][concepto] = {}
        if (!totalsCat[cat])          totalsCat[cat] = {}
        mapa[cat][concepto][per]  = (mapa[cat][concepto][per]  || 0) + monto
        totalsCat[cat][per]       = (totalsCat[cat][per]       || 0) + monto
        totalsGlobal[per]         = (totalsGlobal[per]         || 0) + monto
        totalAnual += monto
      }

      // Ítems del PDF (fuente estructurada)
      const expMap = new Map(expensas.map(e => [e.id, e.periodo]))
      for (const it of (items||[])) {
        const per    = expMap.get(it.expensa_id)
        const monto  = parseFloat(it.importe_total)||0
        if (!per || !monto) continue
        // Usar rubro_nombre como categoría (más preciso que categoria libre)
        const cat    = baNormCat(it.rubro_nombre)
        // Concepto: proveedor_nombre o concepto, acortado
        const conc   = (it.proveedor_nombre || it.concepto || it.rubro_nombre || '').slice(0,60)
        registrarGasto(cat, conc, per, monto)
      }

      // Gastos adicionales no derivados del historial
      for (const g of (gastos||[])) {
        const per   = expMap.get(g.expensa_id)
        const monto = parseFloat(g.monto)||0
        const cat   = baNormCat(g.categoria)
        const conc  = (g.concepto||'').slice(0,60)
        registrarGasto(cat, conc, per, monto)
      }

      const periodos       = expensas.map(e => e.periodo)
      const resultadoNeto  = totalIngresos - totalAnual

      // ── Análisis ejecutivo ──
      // Ingresos vs egresos por período
      const evolucion = periodos.map(p => ({
        mes: perLabel(p),
        ingresos: (ingExpensasPorPeriodo[p]||0) + (ingVariosPorPeriodo[p]||0),
        egresos:   totalsGlobal[p]||0,
        diferencia: ((ingExpensasPorPeriodo[p]||0) + (ingVariosPorPeriodo[p]||0)) - (totalsGlobal[p]||0),
        saldo: saldoFinalPorPeriodo[p]||0
      }))

      // Top categorías por egreso total
      const topCats = BA_CATS_ORDER
        .map(cat => ({
          label: BA_CATS_LABEL[cat],
          total: Object.values(totalsCat[cat]||{}).reduce((a,b)=>a+b,0),
          pct:   0
        }))
        .filter(c => c.total > 0)
        .sort((a,b) => b.total - a.total)
      if (totalAnual > 0) topCats.forEach(c => { c.pct = (c.total/totalAnual*100).toFixed(2) })

      // Detalle del bloque más grande
      const topCatKey = BA_CATS_ORDER
        .map(cat => [cat, Object.values(totalsCat[cat]||{}).reduce((a,b)=>a+b,0)])
        .sort((a,b)=>b[1]-a[1])[0]?.[0]
      const topCatLabel = BA_CATS_LABEL[topCatKey] || ''
      const topCatTotal = topCatKey ? Object.values(totalsCat[topCatKey]||{}).reduce((a,b)=>a+b,0) : 0
      const detalleTopCat = topCatKey ? Object.entries(mapa[topCatKey]||{}).map(([conc,perMap]) => ({
        concepto: conc,
        total: Object.values(perMap).reduce((a,b)=>a+b,0),
        pct: 0
      })).sort((a,b)=>b.total-a.total) : []
      if (topCatTotal > 0) detalleTopCat.forEach(d => { d.pct = (d.total/topCatTotal*100).toFixed(1) })

      const mesMayorIngreso = evolucion.reduce((a,b) => b.ingresos>a.ingresos?b:a, evolucion[0]||{})
      const mesMayorEgreso  = evolucion.reduce((a,b) => b.egresos>a.egresos?b:a, evolucion[0]||{})
      const mesMejorDif     = evolucion.reduce((a,b) => b.diferencia>a.diferencia?b:a, evolucion[0]||{})
      const mesPeorDif      = evolucion.reduce((a,b) => b.diferencia<a.diferencia?b:a, evolucion[0]||{})
      const mesesPositivo   = evolucion.filter(e=>e.saldo>=0).length
      const saldoMinimo     = evolucion.reduce((a,b)=>b.saldo<a.saldo?b:a, evolucion[0]||{})
      const saldoMaximo     = evolucion.reduce((a,b)=>b.saldo>a.saldo?b:a, evolucion[0]||{})

      setDatos({
        periodos, mapa, totalsCat, totalsGlobal, totalAnual, totalIngresos,
        totalIngExpensas, totalIngVarios,
        ingExpensasPorPeriodo, ingVariosPorPeriodo,
        saldoInicialPorPeriodo, saldoFinalPorPeriodo,
        promedioIngresos: periodos.length>0 ? totalIngresos/periodos.length : 0,
        promedioEgresos:  periodos.length>0 ? totalAnual/periodos.length    : 0,
        resultadoNeto, mesesPositivo, evolucion, topCats, topCatLabel, topCatTotal,
        detalleTopCat, mesMayorIngreso, mesMayorEgreso, mesMejorDif, mesPeorDif,
        saldoMinimo, saldoMaximo,
      })
    } catch (err) {
      setMsg({tipo:'error', texto:'Error al generar: ' + (err.message || String(err))})
    }
    setCargando(false)
  }

  function exportarPDFBalance() {
    if (!datos) return
    const d   = datos
    const w   = window.open('', '_blank')
    if (!w) { alert('Habilitá las ventanas emergentes para imprimir.'); return }
    const hoy = new Date().toLocaleDateString('es-AR')
    const f2  = n => { const v=Number(n)||0; return v!==0 ? v.toLocaleString('es-AR',{minimumFractionDigits:2}) : '—' }
    const f2s = n => { const v=Number(n)||0; if(v===0) return '—'; const s=Math.abs(v).toLocaleString('es-AR',{minimumFractionDigits:2}); return v<0?'-$'+s:'$'+s }
    const nCols = d.periodos.length + 4 // concepto + períodos + total + % + prom

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Balance Anual</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:7.5px;padding:8px;color:#111}
      h2{font-size:13px;font-weight:800;margin-bottom:1px}
      .sub{font-size:9px;color:#555;margin-bottom:8px}
      table{width:100%;border-collapse:collapse;margin-bottom:8px}
      th{background:#1A3FA0;color:#fff;padding:3px 4px;text-align:right;white-space:nowrap;font-size:7px}
      th.l{text-align:left;min-width:160px}
      td{padding:2px 4px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap}
      td.l{text-align:left}
      .si{background:#f0fdf4;font-weight:700;font-size:8px}
      .ing-h{background:#dbeafe;font-weight:700;font-size:7px;text-transform:uppercase}
      .ing-sub{background:#eff6ff;font-weight:700;font-size:7.5px}
      .ing-row td{color:#15803d}
      .eg-h{background:#fee2e2;font-weight:700;font-size:7px;text-transform:uppercase}
      .cat{background:#eff6ff;font-weight:700;font-size:7px;text-transform:uppercase}
      .sub-cat{background:#e0e7ff;font-weight:700;font-size:7px}
      .conc td{color:#555;font-size:7px}
      .tot-eg{background:#1A3FA0;color:#fff;font-weight:700;font-size:8px}
      .sf{background:#f0fdf4;font-weight:700;font-size:8px}
      .neg{color:#dc2626}.pos{color:#15803d}
      .foot{font-size:7.5px;border-top:1px solid #1A3FA0;padding-top:4px;margin-top:4px;color:#555}
      @media print{@page{size:A3 landscape;margin:5mm}body{padding:0}}
    </style></head><body>
    <h2>RENDICIÓN DE CUENTAS ${d.periodos[0]} / ${d.periodos[d.periodos.length-1]}</h2>
    <div class="sub">${consorcioActivo?consorcioActivo.nombre:''} &nbsp;·&nbsp; Javier García Pérez · RPAC N° 83 &nbsp;·&nbsp; ${hoy}</div>
    <table><thead><tr>
      <th class="l">Categoría / Concepto</th>
      ${d.periodos.map(p=>'<th>'+perLabel(p)+'</th>').join('')}
      <th>TOTAL</th><th>%</th><th>PROM.</th>
    </tr></thead><tbody>`

    // Saldo inicial
    html += '<tr class="si"><td class="l">SALDO INICIAL</td>'
    html += d.periodos.map(p=>{const v=d.saldoInicialPorPeriodo[p]||0; return '<td class="'+(v<0?'neg':'pos')+'">'+f2s(v)+'</td>'}).join('')
    html += '<td></td><td></td><td></td></tr>'

    // Ingresos
    html += `<tr class="ing-h"><td class="l" colspan="${nCols}">INGRESOS</td></tr>`
    if (Object.values(d.ingVariosPorPeriodo).some(v=>v>0)) {
      const totV = Object.values(d.ingVariosPorPeriodo).reduce((a,b)=>a+b,0)
      html += '<tr class="ing-row"><td class="l" style="padding-left:10px">Ingresos varios</td>'
      html += d.periodos.map(p=>'<td class="pos">'+f2(d.ingVariosPorPeriodo[p])+'</td>').join('')
      html += `<td class="pos"><b>${f2(totV)}</b></td><td>—</td><td>${f2(totV/d.periodos.length)}</td></tr>`
    }
    html += '<tr class="ing-row"><td class="l" style="padding-left:10px">Expensas</td>'
    html += d.periodos.map(p=>'<td class="pos">'+f2(d.ingExpensasPorPeriodo[p])+'</td>').join('')
    html += `<td class="pos"><b>${f2(d.totalIngExpensas)}</b></td><td style="font-size:7px;color:#555">Incidencia</td><td style="color:#555">Promedio</td></tr>`
    html += '<tr class="ing-sub"><td class="l">Total ingresos</td>'
    html += d.periodos.map(p=>{
      const v=(d.ingExpensasPorPeriodo[p]||0)+(d.ingVariosPorPeriodo[p]||0)
      return '<td class="pos">'+f2(v)+'</td>'
    }).join('')
    html += `<td class="pos"><b>${f2(d.totalIngresos)}</b></td><td></td><td>${f2(d.promedioIngresos)}</td></tr>`

    // Egresos
    html += `<tr class="eg-h"><td class="l" colspan="${nCols}">EGRESOS</td></tr>`
    for (const cat of BA_CATS_ORDER) {
      const conceps = Object.keys(d.mapa[cat]||{})
      if (!conceps.length) continue
      const totalCat = Object.values(d.totalsCat[cat]||{}).reduce((a,b)=>a+b,0)
      const pct = d.totalAnual>0 ? (totalCat/d.totalAnual*100).toFixed(2)+'%' : '0%'
      // Conceptos individuales
      for (const con of conceps) {
        const totalCon = Object.values(d.mapa[cat][con]).reduce((a,b)=>a+b,0)
        html += '<tr class="conc"><td class="l" style="padding-left:12px">'+con+'</td>'
        html += d.periodos.map(p=>'<td>'+f2(d.mapa[cat][con][p])+'</td>').join('')
        html += `<td>${f2(totalCon)}</td><td></td><td>${f2(totalCon/d.periodos.length)}</td></tr>`
      }
      // Subtotal categoría
      html += '<tr class="sub-cat"><td class="l">Subtotal '+BA_CATS_LABEL[cat]+'</td>'
      html += d.periodos.map(p=>'<td><b>'+f2(d.totalsCat[cat]?d.totalsCat[cat][p]:0)+'</b></td>').join('')
      html += `<td><b>${f2(totalCat)}</b></td><td>${pct}</td><td>${f2(totalCat/d.periodos.length)}</td></tr>`
    }
    // Total egresos
    html += '<tr class="tot-eg"><td class="l">Total egresos</td>'
    html += d.periodos.map(p=>'<td>'+f2(d.totalsGlobal[p]||0)+'</td>').join('')
    html += `<td><b>${f2(d.totalAnual)}</b></td><td>100%</td><td>${f2(d.promedioEgresos)}</td></tr>`
    // Saldo final
    html += '<tr class="sf"><td class="l">SALDO FINAL</td>'
    html += d.periodos.map(p=>{const v=d.saldoFinalPorPeriodo[p]||0; return '<td class="'+(v<0?'neg':'pos')+'"><b>'+f2s(v)+'</b></td>'}).join('')
    html += '<td></td><td></td><td></td></tr>'
    html += '</tbody></table>'

    // Resumen pie
    html += `<div class="foot">Ingresos: $${f2(d.totalIngresos)} &nbsp;|&nbsp; Egresos: $${f2(d.totalAnual)} &nbsp;|&nbsp; Resultado neto: $${f2(d.resultadoNeto)} &nbsp;|&nbsp; Meses con saldo positivo: ${d.mesesPositivo}/${d.periodos.length}</div>`

    // ── PÁGINA 2: ANÁLISIS EJECUTIVO ──────────────────────────────────────
    html += `<div style="page-break-before:always"></div>`
    html += `<h2>ANÁLISIS EJECUTIVO — ${d.periodos[0]} / ${d.periodos[d.periodos.length-1]}</h2>`
    html += `<div class="sub">${consorcioActivo?consorcioActivo.nombre:''} &nbsp;·&nbsp; Javier García Pérez · RPAC N° 83 &nbsp;·&nbsp; ${hoy}</div>`

    // KPIs
    html += `<table style="margin-bottom:8px"><tr>
      <th class="l" style="background:#0f2d7a">Indicador</th><th style="background:#0f2d7a">Valor</th></tr>
      <tr><td class="l">Total ingresos anual</td><td class="pos"><b>$${f2(d.totalIngresos)}</b></td></tr>
      <tr><td class="l">Total egresos anual</td><td class="neg"><b>$${f2(d.totalAnual)}</b></td></tr>
      <tr><td class="l">Resultado neto</td><td class="${d.resultadoNeto>=0?'pos':'neg'}"><b>${d.resultadoNeto>=0?'+':''}$${f2(Math.abs(d.resultadoNeto))}</b></td></tr>
      <tr><td class="l">Promedio mensual ingresos</td><td>$${f2(d.promedioIngresos)}</td></tr>
      <tr><td class="l">Promedio mensual egresos</td><td>$${f2(d.promedioEgresos)}</td></tr>
      <tr><td class="l">Meses con saldo positivo</td><td>${d.mesesPositivo} / ${d.periodos.length}</td></tr>
    </table>`

    // Hallazgos
    const topCats3pct = (d.topCats||[]).length>=3
      ? ((d.topCats.slice(0,3).reduce((a,c)=>a+parseFloat(c.pct||0),0)).toFixed(1))
      : '—'
    const hallazgos = [
      `El período cierra con un resultado neto de ${d.resultadoNeto>=0?'superávit':'déficit'} de $${f2(Math.abs(d.resultadoNeto))} (${d.totalIngresos>0?(Math.abs(d.resultadoNeto)/d.totalIngresos*100).toFixed(1):'0'}% de los ingresos).`,
      `${d.mesMayorIngreso?.mes||'—'} fue el mes de mayor ingreso ($${f2(d.mesMayorIngreso?.ingresos||0)}).`,
      `${d.mesMayorEgreso?.mes||'—'} registró el mayor egreso ($${f2(d.mesMayorEgreso?.egresos||0)}).`,
      `El saldo final tocó su mínimo en ${d.saldoMinimo?.mes||'—'} ($${f2(d.saldoMinimo?.saldo||0)}) y su máximo en ${d.saldoMaximo?.mes||'—'} ($${f2(d.saldoMaximo?.saldo||0)}).`,
      `Las 3 categorías más grandes concentran ${topCats3pct}% del gasto: ${(d.topCats||[]).slice(0,3).map(c=>c.label).join(', ')}.`,
      `La mejor diferencia mensual fue ${d.mesMejorDif?.mes||'—'} ($${f2(d.mesMejorDif?.diferencia||0)}) y la peor fue ${d.mesPeorDif?.mes||'—'} ($${f2(d.mesPeorDif?.diferencia||0)}).`,
      `Hubo ${d.mesesPositivo} ${d.mesesPositivo!==1?'meses':'mes'} con saldo final positivo y ${d.periodos.length-d.mesesPositivo} con saldo negativo.`,
      `Mayor concentración de gasto: ${(d.topCats||[])[0]?.label||'—'} ($${f2((d.topCats||[])[0]?.total||0)}, ${(d.topCats||[])[0]?.pct||0}%).`,
    ]
    html += `<div style="margin-bottom:8px;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px">
      <div style="font-weight:700;font-size:9px;margin-bottom:5px;color:#1A3FA0">🧠 Hallazgos del período</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
        ${hallazgos.map(t=>`<div style="font-size:7.5px;padding:3px 5px;background:#fff;border:1px solid #e5e7eb;border-radius:3px;line-height:1.4"><span style="color:#1A3FA0;margin-right:3px">•</span>${t}</div>`).join('')}
      </div>
    </div>`

    // Tabla de 3 columnas
    html += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">`

    // Col 1: Top categorías
    html += `<table><thead><tr>
      <th class="l" colspan="3">Top categorías de egresos</th></tr>
      <tr style="background:#f8fafc"><th class="l" style="background:#f8fafc;color:#555;font-size:7px">Categoría</th>
      <th style="background:#f8fafc;color:#555;font-size:7px">Total</th>
      <th style="background:#f8fafc;color:#555;font-size:7px">%</th></tr>
    </thead><tbody>`
    ;(d.topCats||[]).forEach(c => {
      html += `<tr><td class="l">${c.label}</td><td><b>$${f2(c.total)}</b></td><td style="color:#4338ca">${c.pct}%</td></tr>`
    })
    html += `<tr class="sub-cat"><td class="l">TOTAL</td><td><b>$${f2(d.totalAnual)}</b></td><td>100%</td></tr>`
    html += `</tbody></table>`

    // Col 2: Ingresos vs egresos por mes
    html += `<table><thead><tr>
      <th class="l" colspan="4">Ingresos vs Egresos por mes</th></tr>
      <tr style="background:#f8fafc">
      <th class="l" style="background:#f8fafc;color:#555;font-size:7px">Mes</th>
      <th style="background:#f8fafc;color:#15803d;font-size:7px">Ingresos</th>
      <th style="background:#f8fafc;color:#dc2626;font-size:7px">Egresos</th>
      <th style="background:#f8fafc;color:#555;font-size:7px">Diferencia</th></tr>
    </thead><tbody>`
    ;(d.evolucion||[]).forEach(e => {
      const dif = e.diferencia||0
      html += `<tr><td class="l">${e.mes}</td><td class="pos">$${f2(e.ingresos)}</td><td class="neg">$${f2(e.egresos)}</td><td class="${dif>=0?'pos':'neg'}">${dif>=0?'+':''}$${f2(dif)}</td></tr>`
    })
    html += `<tr class="sub-cat"><td class="l">TOTAL</td><td class="pos"><b>$${f2(d.totalIngresos)}</b></td><td class="neg"><b>$${f2(d.totalAnual)}</b></td><td class="${d.resultadoNeto>=0?'pos':'neg'}"><b>${d.resultadoNeto>=0?'+':''}$${f2(d.resultadoNeto)}</b></td></tr>`
    html += `</tbody></table>`

    // Col 3: Evolución saldo final
    html += `<table><thead><tr>
      <th class="l" colspan="2">Evolución del saldo final</th></tr>
      <tr style="background:#f8fafc">
      <th class="l" style="background:#f8fafc;color:#555;font-size:7px">Mes</th>
      <th style="background:#f8fafc;color:#555;font-size:7px">Saldo final</th></tr>
    </thead><tbody>`
    ;(d.evolucion||[]).forEach(e => {
      const sf = e.saldo||0
      html += `<tr${sf<0?' style="background:#fff5f5"':''}><td class="l">${e.mes}</td><td class="${sf<0?'neg':'pos'}"><b>${sf!==0?(sf>0?'+':'')+'$'+f2(sf):'—'}</b></td></tr>`
    })
    html += `</tbody></table>`
    html += `</div>` // cierra grid 3 columnas

    // Detalle bloque mayor
    if ((d.detalleTopCat||[]).length > 0) {
      html += `<table style="margin-top:4px"><thead><tr>
        <th class="l" colspan="3">Detalle de ${d.topCatLabel||''} — mayor concentración de gasto</th></tr>
        <tr style="background:#f8fafc">
        <th class="l" style="background:#f8fafc;color:#555;font-size:7px">Concepto</th>
        <th style="background:#f8fafc;color:#555;font-size:7px">Total anual</th>
        <th style="background:#f8fafc;color:#555;font-size:7px">% del total</th></tr>
      </thead><tbody>`
      ;(d.detalleTopCat||[]).forEach(dt => {
        html += `<tr><td class="l">${dt.concepto||''}</td><td><b>$${f2(dt.total)}</b></td><td style="color:#4338ca">${dt.pct}%</td></tr>`
      })
      html += `<tr class="sub-cat"><td class="l">TOTAL ${d.topCatLabel||''}</td><td><b>$${f2(d.topCatTotal)}</b></td><td>100%</td></tr>`
      html += `</tbody></table>`
    }

    html += `<div class="foot" style="margin-top:6px">Rendición de cuentas generada por GASP Consorcios · administracionpinamar.com · ${hoy}</div>`
    html += '</body></html>'
    w.document.write(html); w.document.close(); w.focus()
    setTimeout(()=>{try{w.print()}catch(e){}},600)
  }

  async function exportarExcelBalance() {
    if (!datos) return
    if (!window.XLSX) {
      await new Promise((res,rej)=>{
        const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
        s.onload=res; s.onerror=rej; document.head.appendChild(s)
      })
    }
    const XLSX = window.XLSX; const d = datos; const fv = n => Number(n)||0
    const rows = [
      ['Rendición de cuentas — '+(consorcioActivo?consorcioActivo.nombre:'')],
      ['Período: '+d.periodos[0]+' al '+d.periodos[d.periodos.length-1]],
      [],
      ['Concepto',...d.periodos,'TOTAL','%','PROMEDIO'],
      ['SALDO INICIAL',...d.periodos.map(p=>fv(d.saldoInicialPorPeriodo[p])),'','',''],
      ['INGRESOS',...d.periodos.map(()=>''),'','',''],
    ]
    if (Object.values(d.ingVariosPorPeriodo).some(v=>v>0)) {
      const totV = Object.values(d.ingVariosPorPeriodo).reduce((a,b)=>a+b,0)
      rows.push(['  Ingresos varios',...d.periodos.map(p=>fv(d.ingVariosPorPeriodo[p])),totV,'',totV/d.periodos.length])
    }
    rows.push(['  Expensas',...d.periodos.map(p=>fv(d.ingExpensasPorPeriodo[p])),d.totalIngExpensas,'Incidencia','Promedio'])
    rows.push(['Total ingresos',...d.periodos.map(p=>(fv(d.ingExpensasPorPeriodo[p])+fv(d.ingVariosPorPeriodo[p]))),d.totalIngresos,'',d.promedioIngresos])
    rows.push(['EGRESOS',...d.periodos.map(()=>''),'','',''])
    for (const cat of BA_CATS_ORDER) {
      const conceps = Object.keys(d.mapa[cat]||{})
      if (!conceps.length) continue
      const totalCat = Object.values(d.totalsCat[cat]||{}).reduce((a,b)=>a+b,0)
      const pct = d.totalAnual>0 ? (totalCat/d.totalAnual*100).toFixed(2)+'%' : '0%'
      for (const con of conceps) {
        const totalCon = Object.values(d.mapa[cat][con]).reduce((a,b)=>a+b,0)
        rows.push(['  '+con,...d.periodos.map(p=>fv(d.mapa[cat][con][p])),totalCon,'',totalCon/d.periodos.length])
      }
      rows.push(['Subtotal '+BA_CATS_LABEL[cat],...d.periodos.map(p=>fv(d.totalsCat[cat]?d.totalsCat[cat][p]:0)),totalCat,pct,totalCat/d.periodos.length])
    }
    rows.push(['Total egresos',...d.periodos.map(p=>fv(d.totalsGlobal[p])),d.totalAnual,'100%',d.promedioEgresos])
    rows.push(['SALDO FINAL',...d.periodos.map(p=>fv(d.saldoFinalPorPeriodo[p])),'','',''])
    rows.push([],['Total ingresos',fv(d.totalIngresos)],['Total egresos',fv(d.totalAnual)],['Resultado neto',fv(d.resultadoNeto)])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Balance Anual')
    const nombre = consorcioActivo ? consorcioActivo.id : 'cons'
    XLSX.writeFile(wb, 'BalanceAnual_'+nombre+'_'+d.periodos[0]+'_'+d.periodos[d.periodos.length-1]+'.xlsx')
  }

  // ── Construcción de filas de la tabla principal ──
  function buildTablaRows(d) {
    if (!d) return []
    const rows = []

    // Saldo inicial
    rows.push(
      <tr key="si" style={{background:'#f0fdf4',fontWeight:700}}>
        <td style={{padding:'5px 10px',fontSize:10,position:'sticky',left:0,background:'#f0fdf4',fontWeight:700}}>SALDO INICIAL</td>
        {d.periodos.map(p=>{const v=d.saldoInicialPorPeriodo[p]||0
          return <td key={p} style={{padding:'5px 6px',textAlign:'right',color:v<0?RJ:VD,fontSize:9,fontWeight:700}}>{v!==0?fmtS(v,true):'—'}</td>
        })}
        <td colSpan={3}></td>
      </tr>
    )

    // Ingresos header
    rows.push(
      <tr key="ing-h" style={{background:'#dbeafe',fontWeight:700}}>
        <td style={{padding:'5px 10px',fontSize:9,textTransform:'uppercase',position:'sticky',left:0,background:'#dbeafe',fontWeight:700}}>INGRESOS</td>
        {d.periodos.map(p=><td key={p}></td>)}
        <td colSpan={3}></td>
      </tr>
    )

    // Ingresos varios (si los hay)
    if (Object.values(d.ingVariosPorPeriodo).some(v=>v>0)) {
      const totV = Object.values(d.ingVariosPorPeriodo).reduce((a,b)=>a+b,0)
      rows.push(
        <tr key="ing-varios">
          <td style={{padding:'4px 10px',paddingLeft:18,fontSize:9,position:'sticky',left:0,background:'#fff'}}>Ingresos varios</td>
          {d.periodos.map(p=>(
            <td key={p} style={{padding:'4px 6px',textAlign:'right',color:VD,fontSize:9}}>
              {d.ingVariosPorPeriodo[p]>0?'$'+fmt(d.ingVariosPorPeriodo[p]):'—'}
            </td>
          ))}
          <td style={{padding:'4px 6px',textAlign:'right',fontWeight:700,color:VD,fontSize:9}}>${fmt(totV)}</td>
          <td><span style={{fontSize:8,color:GR}}>—</span></td>
          <td style={{padding:'4px 6px',textAlign:'right',fontSize:8,color:GR}}>${fmt(totV/d.periodos.length)}</td>
        </tr>
      )
    }

    // Expensas
    rows.push(
      <tr key="ing-exp">
        <td style={{padding:'4px 10px',paddingLeft:18,fontSize:9,position:'sticky',left:0,background:'#fff'}}>Expensas</td>
        {d.periodos.map(p=>(
          <td key={p} style={{padding:'4px 6px',textAlign:'right',color:VD,fontSize:9}}>
            {d.ingExpensasPorPeriodo[p]>0?'$'+fmt(d.ingExpensasPorPeriodo[p]):'—'}
          </td>
        ))}
        <td style={{padding:'4px 6px',textAlign:'right',fontWeight:700,color:VD,fontSize:9}}>${fmt(d.totalIngExpensas)}</td>
        <td style={{fontSize:8,color:GR,textAlign:'right'}}>Incid.</td>
        <td style={{padding:'4px 6px',textAlign:'right',fontSize:8,color:GR}}>Promedio</td>
      </tr>
    )

    // Total ingresos
    rows.push(
      <tr key="ing-tot" style={{background:'#eff6ff',fontWeight:700}}>
        <td style={{padding:'5px 10px',fontSize:9,position:'sticky',left:0,background:'#eff6ff',fontWeight:700}}>Total ingresos</td>
        {d.periodos.map(p=>{
          const v=(d.ingExpensasPorPeriodo[p]||0)+(d.ingVariosPorPeriodo[p]||0)
          return <td key={p} style={{padding:'5px 6px',textAlign:'right',color:VD,fontWeight:600,fontSize:9}}>${fmt(v)}</td>
        })}
        <td style={{padding:'5px 6px',textAlign:'right',fontWeight:800,color:VD,fontSize:10}}>${fmt(d.totalIngresos)}</td>
        <td></td>
        <td style={{padding:'5px 6px',textAlign:'right',fontSize:9,color:GR}}>${fmt(d.promedioIngresos)}</td>
      </tr>
    )

    // Egresos header
    rows.push(
      <tr key="eg-h" style={{background:'#fee2e2',fontWeight:700}}>
        <td style={{padding:'5px 10px',fontSize:9,textTransform:'uppercase',position:'sticky',left:0,background:'#fee2e2',fontWeight:700}}>EGRESOS</td>
        {d.periodos.map(p=><td key={p}></td>)}
        <td colSpan={3}></td>
      </tr>
    )

    // Categorías con subtotales
    for (const cat of BA_CATS_ORDER) {
      const conceps = Object.keys(d.mapa[cat]||{})
      if (!conceps.length) continue
      const totalCat = Object.values(d.totalsCat[cat]||{}).reduce((a,b)=>a+b,0)
      const pct      = d.totalAnual>0 ? (totalCat/d.totalAnual*100).toFixed(2) : '0'

      // Conceptos individuales
      for (const con of conceps) {
        const totalCon = Object.values(d.mapa[cat][con]).reduce((a,b)=>a+b,0)
        rows.push(
          <tr key={'con-'+cat+'-'+con} style={{borderBottom:'1px solid #f3f4f6'}}>
            <td style={{padding:'3px 10px',paddingLeft:20,fontSize:9,color:GR,position:'sticky',left:0,background:'#fff'}}>{con}</td>
            {d.periodos.map(p=>(
              <td key={p} style={{padding:'3px 6px',textAlign:'right',fontSize:8}}>
                {d.mapa[cat][con][p]?'$'+fmt(d.mapa[cat][con][p]):'—'}
              </td>
            ))}
            <td style={{padding:'3px 6px',textAlign:'right',fontSize:8}}>${fmt(totalCon)}</td>
            <td></td>
            <td style={{padding:'3px 6px',textAlign:'right',fontSize:8,color:GR}}>${fmt(totalCon/d.periodos.length)}</td>
          </tr>
        )
      }

      // Subtotal categoría
      rows.push(
        <tr key={'subtot-'+cat} style={{background:'#e0e7ff',borderTop:'2px solid #c7d2fe'}}>
          <td style={{padding:'4px 10px',fontWeight:700,fontSize:9,position:'sticky',left:0,background:'#e0e7ff'}}>Subtotal {BA_CATS_LABEL[cat]}</td>
          {d.periodos.map(p=>(
            <td key={p} style={{padding:'4px 6px',textAlign:'right',fontWeight:700,fontSize:9}}>
              {(d.totalsCat[cat]&&d.totalsCat[cat][p])?'$'+fmt(d.totalsCat[cat][p]):'—'}
            </td>
          ))}
          <td style={{padding:'4px 6px',textAlign:'right',fontWeight:800,fontSize:9}}>${fmt(totalCat)}</td>
          <td style={{padding:'4px 6px',textAlign:'right',fontSize:8,color:'#4338ca'}}>{pct}%</td>
          <td style={{padding:'4px 6px',textAlign:'right',fontSize:8,color:GR}}>${fmt(totalCat/d.periodos.length)}</td>
        </tr>
      )
    }

    // Total egresos
    rows.push(
      <tr key="total-eg" style={{background:AZ,color:'#fff',fontWeight:700}}>
        <td style={{padding:'6px 10px',fontSize:10,position:'sticky',left:0,background:AZ,fontWeight:700}}>Total egresos</td>
        {d.periodos.map(p=>(
          <td key={p} style={{padding:'6px 6px',textAlign:'right',fontSize:9}}>${fmt(d.totalsGlobal[p]||0)}</td>
        ))}
        <td style={{padding:'6px 6px',textAlign:'right',fontWeight:800,fontSize:10}}>${fmt(d.totalAnual)}</td>
        <td style={{padding:'6px 6px',textAlign:'right',fontSize:8}}>100%</td>
        <td style={{padding:'6px 6px',textAlign:'right',fontSize:9}}>${fmt(d.promedioEgresos)}</td>
      </tr>
    )

    // Saldo final
    rows.push(
      <tr key="sf" style={{background:'#f0fdf4',fontWeight:700}}>
        <td style={{padding:'6px 10px',fontSize:10,position:'sticky',left:0,background:'#f0fdf4',fontWeight:700}}>SALDO FINAL</td>
        {d.periodos.map(p=>{const v=d.saldoFinalPorPeriodo[p]||0
          return (
            <td key={p} style={{padding:'6px 6px',textAlign:'right',color:v<0?RJ:VD,fontWeight:700,fontSize:9}}>
              {v!==0?fmtS(v,true):'—'}
            </td>
          )
        })}
        <td colSpan={3}></td>
      </tr>
    )

    return rows
  }

  return (
    <div>
      {/* Encabezado */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <div style={{fontWeight:700,fontSize:15}}>📊 Balance Anual</div>
        {datos && (
          <div style={{display:'flex',gap:8}}>
            <Btn small color={GR} onClick={exportarPDFBalance}>🖨️ PDF / Imprimir</Btn>
            <Btn small color={VD} onClick={exportarExcelBalance}>📊 Excel</Btn>
          </div>
        )}
      </div>
      <div style={{fontSize:12,color:GR,marginBottom:16}}>Rendición de cuentas entre períodos seleccionados</div>
      <Msg data={msg} />

      {/* Selector de rango */}
      <Card style={{marginBottom:16}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:12,alignItems:'flex-end'}}>
          <div>
            <div style={{fontSize:12,color:GR,marginBottom:4,fontWeight:500}}>Período desde</div>
            <input type="month" value={periodoDesde} onChange={e=>setPeriodoDesde(e.target.value)}
              style={{width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13,boxSizing:'border-box'}} />
          </div>
          <div>
            <div style={{fontSize:12,color:GR,marginBottom:4,fontWeight:500}}>Período hasta</div>
            <input type="month" value={periodoHasta} onChange={e=>setPeriodoHasta(e.target.value)}
              style={{width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13,boxSizing:'border-box'}} />
          </div>
          <Btn onClick={generar} disabled={cargando}>
            {cargando ? '⏳ Calculando...' : '🔄 Generar balance'}
          </Btn>
        </div>
      </Card>

      {cargando && <div style={{textAlign:'center',padding:32,color:GR}}>⏳ Cargando datos del período...</div>}

      {datos && !cargando && (
        <>
          {/* KPIs principales */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
            {[
              {l:'Total ingresos',  v:'$'+fmt(datos.totalIngresos),  c:VD},
              {l:'Total egresos',   v:'$'+fmt(datos.totalAnual),      c:RJ},
              {l:'Resultado neto',  v:(datos.resultadoNeto>=0?'+':'')+fmtS(Math.abs(datos.resultadoNeto)), c:datos.resultadoNeto>=0?VD:RJ},
              {l:'Meses saldo +',   v:datos.mesesPositivo+' / '+datos.periodos.length, c:AZ},
            ].map((k,i)=>(
              <Card key={i} style={{textAlign:'center',padding:'12px 10px'}}>
                <div style={{fontSize:10,color:GR,textTransform:'uppercase',fontWeight:600,marginBottom:4}}>{k.l}</div>
                <div style={{fontSize:16,fontWeight:800,color:k.c}}>{k.v}</div>
              </Card>
            ))}
          </div>

          {/* Selector de vista */}
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            {[['tabla','📋 Rendición de cuentas'],['analisis','📈 Análisis ejecutivo']].map(([v,l])=>(
              <button key={v} onClick={()=>setVista(v)} style={{
                padding:'6px 16px',borderRadius:6,border:'1px solid '+(vista===v?AZ:'#d1d5db'),
                background:vista===v?AZ:'#fff',color:vista===v?'#fff':GR,
                fontWeight:600,fontSize:12,cursor:'pointer'
              }}>{l}</button>
            ))}
          </div>

          {/* VISTA: TABLA RENDICIÓN */}
          {vista==='tabla' && (
            <Card style={{padding:0,overflowX:'auto',marginBottom:16}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:10,minWidth:datos.periodos.length*75+380}}>
                <thead>
                  <tr style={{background:AZ,color:'#fff'}}>
                    <th style={{padding:'6px 10px',textAlign:'left',fontWeight:700,fontSize:9,minWidth:190,position:'sticky',left:0,background:AZ}}>
                      Categoría / Concepto
                    </th>
                    {datos.periodos.map(p=>(
                      <th key={p} style={{padding:'6px 6px',textAlign:'right',fontSize:8,minWidth:70,whiteSpace:'nowrap'}}>{perLabel(p)}</th>
                    ))}
                    <th style={{padding:'6px 6px',textAlign:'right',fontSize:9,minWidth:90,background:'#0f2d7a'}}>TOTAL</th>
                    <th style={{padding:'6px 6px',textAlign:'right',fontSize:8,minWidth:44,background:'#0f2d7a'}}>%</th>
                    <th style={{padding:'6px 6px',textAlign:'right',fontSize:8,minWidth:80,background:'#0f2d7a'}}>PROM.</th>
                  </tr>
                </thead>
                <tbody>{buildTablaRows(datos)}</tbody>
              </table>
            </Card>
          )}

          {/* VISTA: ANÁLISIS EJECUTIVO */}
          {vista==='analisis' && (
            <div>
              {/* Hallazgos en texto */}
              <Card style={{marginBottom:16,background:'#f8fafc',border:'1px solid #e2e8f0'}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12,color:AZ}}>🧠 Hallazgos del período</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,fontSize:12,color:GR}}>
                  {[
                    `El período cierra con un resultado neto de ${datos.resultadoNeto>=0?'superávit':'déficit'} de $${fmt(Math.abs(datos.resultadoNeto))} (${datos.totalIngresos>0?(Math.abs(datos.resultadoNeto)/datos.totalIngresos*100).toFixed(1):'0'}% de los ingresos).`,
                    `${datos.mesMayorIngreso?.mes||'—'} fue el mes de mayor ingreso ($${fmt(datos.mesMayorIngreso?.ingresos||0)}).`,
                    `${datos.mesMayorEgreso?.mes||'—'} registró el mayor egreso ($${fmt(datos.mesMayorEgreso?.egresos||0)}).`,
                    `El saldo final tocó su mínimo en ${datos.saldoMinimo?.mes||'—'} ($${fmt(datos.saldoMinimo?.saldo||0)}) y su máximo en ${datos.saldoMaximo?.mes||'—'} ($${fmt(datos.saldoMaximo?.saldo||0)}).`,
                    `Las 3 categorías más grandes concentran ${datos.topCats.length>=3?((datos.topCats.slice(0,3).reduce((a,c)=>a+parseFloat(c.pct||0),0)).toFixed(1)):'—'}% del gasto: ${datos.topCats.slice(0,3).map(c=>c.label).join(', ')}.`,
                    `La mejor diferencia mensual fue ${datos.mesMejorDif?.mes||'—'} ($${fmt(datos.mesMejorDif?.diferencia||0)}) y la peor fue ${datos.mesPeorDif?.mes||'—'} ($${fmt(datos.mesPeorDif?.diferencia||0)}).`,
                    `Hubo ${datos.mesesPositivo} mes${datos.mesesPositivo!==1?'es':''} con saldo final positivo y ${datos.periodos.length-datos.mesesPositivo} con saldo negativo.`,
                    `Mayor concentración de gasto: ${datos.topCats[0]?.label||'—'} ($${fmt(datos.topCats[0]?.total||0)}, ${datos.topCats[0]?.pct||0}%).`,
                  ].map((t,i)=>(
                    <div key={i} style={{display:'flex',gap:6,alignItems:'flex-start',padding:'6px 8px',background:'#fff',borderRadius:6,border:'1px solid #e5e7eb'}}>
                      <span style={{color:AZ,flexShrink:0,marginTop:1}}>•</span>
                      <span style={{lineHeight:1.5}}>{t}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Tablas analíticas en 3 columnas */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>

                {/* Resumen egresos por categoría */}
                <Card style={{padding:0,overflow:'hidden'}}>
                  <div style={{background:AZ,color:'#fff',padding:'8px 12px',fontWeight:700,fontSize:11}}>
                    Top categorías de egresos
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{background:'#f8fafc'}}>
                        <th style={{padding:'6px 10px',textAlign:'left',fontSize:9,fontWeight:600,color:GR}}>Categoría</th>
                        <th style={{padding:'6px 8px',textAlign:'right',fontSize:9,fontWeight:600,color:GR}}>Total</th>
                        <th style={{padding:'6px 8px',textAlign:'right',fontSize:9,fontWeight:600,color:GR}}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.topCats.map((c,i)=>(
                        <tr key={i} style={{borderBottom:'1px solid #f3f4f6'}}>
                          <td style={{padding:'5px 10px',fontSize:10}}>{c.label}</td>
                          <td style={{padding:'5px 8px',textAlign:'right',fontSize:10,fontWeight:600}}>${fmt(c.total)}</td>
                          <td style={{padding:'5px 8px',textAlign:'right',fontSize:10,color:'#4338ca'}}>{c.pct}%</td>
                        </tr>
                      ))}
                      <tr style={{background:'#f0f4ff',fontWeight:700}}>
                        <td style={{padding:'6px 10px',fontSize:10}}>TOTAL</td>
                        <td style={{padding:'6px 8px',textAlign:'right',fontSize:10}}>${fmt(datos.totalAnual)}</td>
                        <td style={{padding:'6px 8px',textAlign:'right',fontSize:10}}>100%</td>
                      </tr>
                    </tbody>
                  </table>
                </Card>

                {/* Evolución mensual ingresos vs egresos */}
                <Card style={{padding:0,overflow:'hidden'}}>
                  <div style={{background:AZ,color:'#fff',padding:'8px 12px',fontWeight:700,fontSize:11}}>
                    Ingresos vs Egresos por mes
                  </div>
                  <div style={{overflowY:'auto',maxHeight:320}}>
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                      <thead>
                        <tr style={{background:'#f8fafc'}}>
                          <th style={{padding:'6px 8px',textAlign:'left',fontSize:9,fontWeight:600,color:GR}}>Mes</th>
                          <th style={{padding:'6px 6px',textAlign:'right',fontSize:9,fontWeight:600,color:VD}}>Ingresos</th>
                          <th style={{padding:'6px 6px',textAlign:'right',fontSize:9,fontWeight:600,color:RJ}}>Egresos</th>
                          <th style={{padding:'6px 6px',textAlign:'right',fontSize:9,fontWeight:600,color:GR}}>Dif.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {datos.evolucion.map((e,i)=>(
                          <tr key={i} style={{borderBottom:'1px solid #f3f4f6'}}>
                            <td style={{padding:'4px 8px',fontSize:10}}>{e.mes}</td>
                            <td style={{padding:'4px 6px',textAlign:'right',fontSize:9,color:VD}}>${fmt(e.ingresos)}</td>
                            <td style={{padding:'4px 6px',textAlign:'right',fontSize:9,color:RJ}}>${fmt(e.egresos)}</td>
                            <td style={{padding:'4px 6px',textAlign:'right',fontSize:9,color:e.diferencia>=0?VD:RJ,fontWeight:600}}>
                              {e.diferencia>=0?'+':''}{fmtS(e.diferencia)}
                            </td>
                          </tr>
                        ))}
                        <tr style={{background:'#f0f4ff',fontWeight:700}}>
                          <td style={{padding:'5px 8px',fontSize:10}}>TOTAL</td>
                          <td style={{padding:'5px 6px',textAlign:'right',fontSize:10,color:VD}}>${fmt(datos.totalIngresos)}</td>
                          <td style={{padding:'5px 6px',textAlign:'right',fontSize:10,color:RJ}}>${fmt(datos.totalAnual)}</td>
                          <td style={{padding:'5px 6px',textAlign:'right',fontSize:10,color:datos.resultadoNeto>=0?VD:RJ,fontWeight:700}}>
                            {datos.resultadoNeto>=0?'+':''}{fmtS(datos.resultadoNeto)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* Evolución del saldo final */}
                <Card style={{padding:0,overflow:'hidden'}}>
                  <div style={{background:AZ,color:'#fff',padding:'8px 12px',fontWeight:700,fontSize:11}}>
                    Evolución del saldo final
                  </div>
                  <div style={{overflowY:'auto',maxHeight:320}}>
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                      <thead>
                        <tr style={{background:'#f8fafc'}}>
                          <th style={{padding:'6px 10px',textAlign:'left',fontSize:9,fontWeight:600,color:GR}}>Mes</th>
                          <th style={{padding:'6px 10px',textAlign:'right',fontSize:9,fontWeight:600,color:GR}}>Saldo final</th>
                        </tr>
                      </thead>
                      <tbody>
                        {datos.evolucion.map((e,i)=>(
                          <tr key={i} style={{borderBottom:'1px solid #f3f4f6',background:e.saldo<0?'#fff5f5':'#fff'}}>
                            <td style={{padding:'5px 10px',fontSize:10}}>{e.mes}</td>
                            <td style={{padding:'5px 10px',textAlign:'right',fontSize:10,fontWeight:700,color:e.saldo<0?RJ:VD}}>
                              {e.saldo!==0?(e.saldo>0?'+':'')+fmtS(e.saldo):'—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              {/* Detalle del bloque mayor */}
              {datos.detalleTopCat.length > 0 && (
                <Card style={{padding:0,overflow:'hidden',marginBottom:16}}>
                  <div style={{background:'#0f2d7a',color:'#fff',padding:'8px 14px',fontWeight:700,fontSize:11}}>
                    Detalle de {datos.topCatLabel} — mayor concentración de gasto
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{background:'#f8fafc'}}>
                        <th style={{padding:'7px 14px',textAlign:'left',fontSize:9,fontWeight:600,color:GR}}>Concepto</th>
                        <th style={{padding:'7px 12px',textAlign:'right',fontSize:9,fontWeight:600,color:GR}}>Total anual</th>
                        <th style={{padding:'7px 12px',textAlign:'right',fontSize:9,fontWeight:600,color:GR}}>% del total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.detalleTopCat.map((d,i)=>(
                        <tr key={i} style={{borderBottom:'1px solid #f3f4f6'}}>
                          <td style={{padding:'6px 14px',fontSize:11}}>{d.concepto}</td>
                          <td style={{padding:'6px 12px',textAlign:'right',fontSize:11,fontWeight:600}}>${fmt(d.total)}</td>
                          <td style={{padding:'6px 12px',textAlign:'right',fontSize:11,color:'#4338ca'}}>{d.pct}%</td>
                        </tr>
                      ))}
                      <tr style={{background:'#e0e7ff',fontWeight:700}}>
                        <td style={{padding:'7px 14px',fontSize:11}}>TOTAL {datos.topCatLabel}</td>
                        <td style={{padding:'7px 12px',textAlign:'right',fontSize:11}}>${fmt(datos.topCatTotal)}</td>
                        <td style={{padding:'7px 12px',textAlign:'right',fontSize:11}}>100%</td>
                      </tr>
                    </tbody>
                  </table>
                </Card>
              )}

              {/* ── GRÁFICOS SVG NATIVOS ── función separada, sin IIFE ── */}
              {GraficosBalance(datos)}


              {/* Indicadores clave — 6 KPIs en grilla */}
              <Card style={{background:'#f8fafc',border:'1px solid #e2e8f0'}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:12,color:AZ}}>📊 Indicadores clave</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                  {[
                    {l:'Total Ingresos Anual',  v:'$'+fmt(datos.totalIngresos),  c:VD},
                    {l:'Total Egresos Anual',   v:'$'+fmt(datos.totalAnual),      c:RJ},
                    {l:'Resultado Neto',        v:(datos.resultadoNeto>=0?'+':'')+fmtS(datos.resultadoNeto), c:datos.resultadoNeto>=0?VD:RJ},
                    {l:'Prom. Mensual Ingresos',v:'$'+fmt(datos.promedioIngresos), c:AZ},
                    {l:'Prom. Mensual Egresos', v:'$'+fmt(datos.promedioEgresos),  c:AZ},
                    {l:'Saldo Final',           v:fmtS(datos.saldoFinalPorPeriodo[datos.periodos[datos.periodos.length-1]]||0), c:((datos.saldoFinalPorPeriodo[datos.periodos[datos.periodos.length-1]]||0)>=0?VD:RJ)},
                  ].map((k,i)=>(
                    <div key={i} style={{textAlign:'center',padding:'10px 8px',background:'#fff',borderRadius:8,border:'1px solid #e5e7eb'}}>
                      <div style={{fontSize:10,color:GR,textTransform:'uppercase',fontWeight:600,marginBottom:4,lineHeight:1.3}}>{k.l}</div>
                      <div style={{fontSize:15,fontWeight:800,color:k.c}}>{k.v}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
