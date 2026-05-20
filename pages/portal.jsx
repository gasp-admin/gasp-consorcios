// portal.jsx v3 — Portal del Copropietario GASP Consorcios
// Muestra planilla de liquidación completa al navegar a #liquidacion-YYYY-MM
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'
import { useRouter } from 'next/router'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const fmt  = n => '$' + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR') : '—'
const periodoLabel = p => {
  if (!p) return '—'
  const [y, m] = p.split('-')
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${meses[parseInt(m)-1]} ${y}`
}
const saldoDet = d => Math.max(0,
  (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0)
  + (parseFloat(d.interes_mora)||0) - (parseFloat(d.pagos_periodo)||0)
)

const AZ = '#1A3FA0', VD = '#1B6B35', RJ = '#B91C1C', AM = '#C07D10', GR = '#6B7280'

const RUBROS_PDF = [
  { numero:2,  label:'SUELDOS Y CARGAS SOCIALES' },
  { numero:3,  label:'SERVICIOS PÚBLICOS' },
  { numero:4,  label:'CONTRATOS Y ABONOS' },
  { numero:5,  label:'GASTOS DE ADMINISTRACIÓN' },
  { numero:6,  label:'SEGUROS' },
  { numero:7,  label:'MANTENIMIENTO GENERAL' },
  { numero:8,  label:'VARIOS' },
  { numero:9,  label:'GASTOS BANCARIOS' },
  { numero:10, label:'IMPUESTO MUNICIPAL' },
  { numero:11, label:'CARGAS SOCIALES' },
]
const CAT_RUBRO = {
  sueldos:2, fateryh:2, electricidad:3, gas:3, agua:3, servicios_publicos:3,
  telefonia:4, internet:4, contratos:4, abonos:4,
  honorarios_admin:5, honorarios_contador:5, honorarios:5, administracion:5,
  seguros:6, seguro:6,
  mantenimiento:7, pintura:7, plomeria:7, electricista:7, jardineria:7, reparaciones:7,
  limpieza:8, articulos_limpieza:8, varios:8, otro:8,
  gastos_bancarios:9, impuesto_municipal:10, municipalidad:10, cargas_sociales:11, vep_931:11,
}
function colGasto(g) {
  const c = (g.categoria||'').toLowerCase()
  if (c.includes('muni') || c.includes('impuesto_mun')) return 3
  if (c.includes('obra') || c.includes('pintura') || c.includes('fdo')) return 1
  return 2
}
function fmtN(n) {
  if (!n && n!==0) return '0,00'
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })
}

function generarPDFLiquidacion({ consorcioActivo, expensa, gastos, detalles, unidades, copropietarios, adminPerfil }) {
  const adm = adminPerfil || {}
  const totR={}; const gasR={}
  RUBROS_PDF.forEach(r => { totR[r.numero]=[0,0,0,0,0]; gasR[r.numero]=[] })
  const totGen=[0,0,0,0,0]
  gastos.forEach(g => {
    const rn=CAT_RUBRO[(g.categoria||'').toLowerCase()]||8; const ci=colGasto(g); const m=parseFloat(g.monto)||0
    if (!totR[rn]){totR[rn]=[0,0,0,0,0];gasR[rn]=[]}
    totR[rn][ci]+=m; gasR[rn].push({...g,ci}); totGen[ci]+=m
  })
  const honAdmin=parseFloat(expensa.total_administracion)||0
  if (honAdmin>0){totR[5][2]+=honAdmin;totGen[2]+=honAdmin;gasR[5].push({concepto:'Honorarios administración',proveedor_nombre:adm.nombre||'Administración Garcia Perez',monto:honAdmin,ci:2})}
  const totGlobal=totGen.reduce((a,b)=>a+b,0)

  const ufsTabla=detalles.map(det=>{
    const u=unidades.find(x=>x.id===det.unidad_id)||{}
    const cp=copropietarios.find(c=>c.id===u.propietario_id)||{}
    const pctFdo=parseFloat(u.pct_fdo_obras)||0; const pctGrales=parseFloat(u.pct_gtos_grales)||0
    const pctCoch=parseFloat(u.pct_cochera)||0; const pctPart=parseFloat(u.pct_gtos_part)||0
    const fdoUF=(pctFdo/100)*totGen[1]; const gralesUF=(pctGrales/100)*totGen[2]
    const cochUF=(pctCoch/100)*totGen[3]; const dptUF=(pctPart/100)*totGen[4]
    const salAnt=parseFloat(det.saldo_anterior)||0; const pagos=parseFloat(det.pagos_periodo)||0
    const interes=parseFloat(det.interes_mora)||0; const deuda=Math.max(0,salAnt-pagos)
    const total=deuda+interes+fdoUF+gralesUF+cochUF+dptUF
    return { uf:u.numero_interno||u.numero||det.unidad_id, dpto:u.piso?`${u.piso} ${u.numero||''}`.trim():(u.tipo||''), prop:cp.apellido_nombre||'—', salAnt, pagos, deuda, interes, pct:pctGrales, fdoUF, gralesUF, cochUF, dptUF, total, redondeo:parseFloat(det.redondeo)||0 }
  })
  const morosos=ufsTabla.filter(u=>u.deuda>0||u.interes>0)
  const totCobrado=ufsTabla.reduce((a,u)=>a+u.pagos,0)
  const totPend=ufsTabla.reduce((a,u)=>a+u.deuda,0)
  const salFinal=totCobrado-totGlobal
  const per=periodoLabel(expensa.periodo)

  const css=`*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:8.5pt;color:#111;background:#fff}.page{width:210mm;min-height:297mm;padding:11mm 13mm 9mm;page-break-after:always;position:relative}.page:last-child{page-break-after:auto}@page{size:A4;margin:0}@media print{body{margin:0}.no-print{display:none!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}.hdr{display:flex;align-items:flex-start;gap:14px;border-bottom:2px solid #1A3FA0;padding-bottom:9px;margin-bottom:8px}.hdr-logo{width:90px;flex-shrink:0;background:#1A3FA0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:900;height:55px}.hdr-title h1{font-size:13.5pt;color:#1A3FA0;font-weight:800}.hdr-title h2{font-size:10pt;color:#2e4057;margin-top:1px}.datos{display:flex;gap:22px;margin-bottom:9px}.datos-col{flex:1}.datos-col h3{font-size:7.5pt;color:#1A3FA0;text-transform:uppercase;letter-spacing:.5px;font-weight:700;border-bottom:1px solid #1A3FA0;padding-bottom:2px;margin-bottom:3px}.datos-col p{font-size:7pt;color:#222;line-height:1.55}.stitle{background:#1A3FA0;color:#fff;font-size:8pt;font-weight:700;text-transform:uppercase;padding:4px 8px;text-align:center;margin-bottom:0}table{width:100%;border-collapse:collapse;font-size:6.8pt}th{background:#2e4057;color:#fff;padding:4px 5px;text-align:right;font-weight:600;white-space:nowrap}th.L{text-align:left}td{padding:2.5px 5px;text-align:right;border-bottom:1px solid #e8e8e8}td.L{text-align:left}tr:nth-child(even) td{background:#f6f9fc}.rh td{background:#d4e8f6!important;font-weight:700;color:#1A3FA0;font-size:7pt}.rt td{background:#1A3FA0!important;color:#fff!important;font-weight:700;font-size:7pt}.gt td{background:#0d2b3e!important;color:#fff!important;font-weight:700;font-size:7.5pt}.ef-final td{background:#1A3FA0!important;color:#fff!important;font-weight:700}.nota{border:1px solid #ccc;border-radius:4px;padding:9px 11px;margin-top:9px;font-size:7pt;line-height:1.6;color:#333}.nota h4{font-size:7.5pt;color:#1A3FA0;font-weight:700;margin-bottom:5px}.fpago{border:1.5px solid #1A3FA0;border-radius:6px;padding:13px 17px;margin-top:18px;max-width:390px}.fpago h3{color:#1A3FA0;font-size:10pt;font-weight:700;margin-bottom:7px}.fpago p{font-size:7.5pt;line-height:1.8}.footer-p{position:absolute;bottom:7mm;left:13mm;right:13mm;display:flex;justify-content:space-between;border-top:1px solid #ddd;padding-top:3px;font-size:6pt;color:#888}.btn-print{display:block;margin:18px auto;padding:11px 30px;background:#1A3FA0;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}`

  const hdr=()=>`<div class="hdr"><div class="hdr-logo">${adm.sello_url?`<img src="${adm.sello_url}" style="max-height:50px;max-width:85px;object-fit:contain" onerror="this.parentNode.innerHTML='GASP'">`:' GASP'}</div><div class="hdr-title"><h1>Administración de Consorcios Pinamar</h1><h2>MIS EXPENSAS — Liquidación de mes: ${expensa.periodo||''}${expensa.numero_liquidacion_display?' &nbsp;|&nbsp; Liq. N° '+expensa.numero_liquidacion_display:''}</h2>${adm.texto_encabezado_liquidacion?`<p style="font-size:7pt;color:#555;margin-top:3px">${adm.texto_encabezado_liquidacion}</p>`:''}</div></div><div class="datos"><div class="datos-col"><h3>Administración</h3><p><b>Nombre:</b> ${adm.nombre||'Javier Garcia Perez'}<br/>${adm.direccion||'Lenguado 1313 - Loc 3'}<br/>${adm.email||'administracion@administracionpinamar.com'}<br/><b>CUIT:</b> ${adm.cuit||'20186006802'} &nbsp; <b>R.P.A:</b> ${adm.matricula_rpac||'83'}<br/><b>Tel:</b> ${adm.telefono||'02267 444034'}<br/><b>Situación fiscal:</b> ${adm.situacion_fiscal||'Monotributo'}</p></div><div class="datos-col"><h3>Consorcio</h3><p><b>${consorcioActivo.nombre||''}</b><br/><b>CUIT:</b> ${consorcioActivo.cuit||'—'}<br/><b>Clave SUTERH:</b> ${consorcioActivo.clave_suterh||''}</p></div></div>`
  const footer=n=>`<div class="footer-p"><span>${consorcioActivo.nombre} — Liquidación ${per}</span><span>R.P.A: ${adm.matricula_rpac||'83'} | CUIT: ${consorcioActivo.cuit||''} | Vto: ${expensa.fecha_vencimiento||''}</span><span>${n}</span></div>`

  let rows1=''
  RUBROS_PDF.forEach(rubro=>{
    const gl=gasR[rubro.numero]||[]; const tots=totR[rubro.numero]||[0,0,0,0,0]; const totRub=tots.reduce((a,b)=>a+b,0)
    if(totRub===0&&gl.length===0) return
    const pct=totGlobal>0?(totRub/totGlobal*100).toFixed(2):'0.00'
    rows1+=`<tr class="rh"><td class="L" colspan="2">${rubro.numero} ${rubro.label}</td><td>Grupo A</td><td>FDO OBRAS</td><td>GTOS GRALES</td><td>COCHERA</td><td>DPTOS</td><td>Total</td></tr>`
    gl.forEach(g=>{const c=[0,0,0,0,0];c[g.ci]=parseFloat(g.monto)||0;rows1+=`<tr><td class="L" colspan="2" style="padding-left:10px;font-size:6.3pt">${g.concepto||''}${g.proveedor_nombre?', '+g.proveedor_nombre:''}${g.comprobante?', '+g.comprobante:''}</td>${c.map(v=>`<td>${v>0?fmtN(v):'0,00'}</td>`).join('')}<td>${fmtN(parseFloat(g.monto)||0)}</td></tr>`})
    rows1+=`<tr class="rt"><td class="L" colspan="2">TOTAL RUBRO ${rubro.numero} &nbsp; ${pct}%</td>${tots.map(v=>`<td>${fmtN(v)}</td>`).join('')}<td>${fmtN(totRub)}</td></tr>`
  })
  rows1+=`<tr class="gt"><td class="L" colspan="2">TOTAL &nbsp; 100,00%</td>${totGen.map(v=>`<td>${fmtN(v)}</td>`).join('')}<td>${fmtN(totGlobal)}</td></tr>`

  const pag1=`<div class="page">${hdr()}<div class="stitle">PAGOS DEL PERÍODO POR SUMINISTROS, SERVICIOS, ABONOS Y SEGUROS</div><table><thead><tr><th class="L" colspan="2">Concepto</th><th>Grupo A</th><th>FDO OBRAS</th><th>GTOS GRALES</th><th>COCHERA</th><th>DPTOS</th><th>Total</th></tr></thead><tbody>${rows1}</tbody></table>${footer(1)}</div>`
  const firmaHtml=adm.firma_url?`<div style="margin-top:18px;display:flex;gap:40px;align-items:flex-end"><div style="text-align:center"><img src="${adm.firma_url}" style="max-height:55px;max-width:180px;object-fit:contain;display:block;margin:0 auto" onerror="this.style.display='none'"><div style="border-top:1px solid #333;padding-top:5px;font-size:7pt;margin-top:4px">${adm.nombre||'Administrador'}<br/>R.P.A: ${adm.matricula_rpac||'83'} — CUIT: ${adm.cuit||''}</div></div>${adm.sello_url?`<div style="text-align:center"><img src="${adm.sello_url}" style="max-height:55px;max-width:140px;object-fit:contain;display:block;margin:0 auto" onerror="this.style.display='none'"></div>`:''}</div>`:`<div style="margin-top:18px"><div style="display:inline-block;text-align:center;border-top:1px solid #333;padding-top:5px;font-size:7pt;min-width:200px">${adm.nombre||'Javier Garcia Perez'}<br/>R.P.A: ${adm.matricula_rpac||'83'} — CUIT: ${adm.cuit||'20186006802'}</div></div>`
  const pieTextoHtml=adm.texto_pie_liquidacion?`<div class="nota" style="margin-top:9px;font-size:7pt;border-color:#1A3FA0"><p>${adm.texto_pie_liquidacion}</p></div>`:''
  const pag2=`<div class="page">${hdr()}<div class="stitle">ESTADO FINANCIERO</div><table><thead><tr><th class="L">CONCEPTO</th><th>Grupo A</th><th>FDO OBRAS</th><th>GTOS GRALES</th><th>COCHERA</th><th>DPTOS</th><th>Total</th></tr></thead><tbody><tr><td class="L">Saldo anterior</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(ufsTabla.reduce((a,u)=>a+u.salAnt,0))}</td></tr><tr><td class="L" style="padding-left:16px;font-style:italic">Ingresos por pago en término</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(totCobrado)}</td></tr><tr><td class="L" style="padding-left:16px;font-style:italic">Ingresos por expensas adeudadas</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>0,00</td></tr><tr><td class="L" style="padding-left:16px;font-style:italic">Ingresos por intereses</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(ufsTabla.reduce((a,u)=>a+u.interes,0))}</td></tr><tr><td class="L" style="padding-left:16px;font-style:italic">Egresos por pagos</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(-totGlobal)}</td></tr><tr class="ef-final"><td class="L">Saldo final al ${expensa.fecha_vencimiento||'—'}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(salFinal)}</td></tr></tbody></table><div class="nota"><h4>NOTAS</h4><p>Saldo Liq $ ${fmtN(salFinal)} .-<br/>Pendiente de pagos $ ${fmtN(totPend)} -<br/>SALDO DISPONIBLE $ ${fmtN(salFinal+totPend)} .-</p></div><div class="nota" style="margin-top:9px;font-size:6.8pt"><p>COMUNICAMOS A LOS SRES PROPIETARIOS/INQUILINOS QUE LOS PAGOS QUE NO SE REALICEN ANTES DE LOS DIAS 28 DE CADA MES, NO PODRAN SER ACREDITADOS EN TIEMPO Y FORMA POR CUESTIONES OPERATIVAS.</p><br/><p><b>UBICACIÓN:</b> ${adm.direccion||'LENGUADO N° 1313 LOCAL 3'} &nbsp; <b>TEL:</b> ${adm.telefono||''} &nbsp; <b>HORARIO:</b> ${adm.horario||'LUNES A SABADOS 9:00 A 13:00 HS'}</p></div>${pieTextoHtml}${firmaHtml}${footer(2)}</div>`
  const filMor=morosos.map(u=>`<tr><td class="L">${String(u.uf).padStart(2,'0')}</td><td class="L">${u.dpto}</td><td class="L">${u.prop}</td><td>${fmtN(u.deuda)}</td><td style="font-weight:700">${fmtN(u.deuda+u.interes)}</td></tr>`).join('')
  const pag3=`<div class="page">${hdr()}${morosos.length>0?`<div class="stitle">UNIDADES CON DEUDA DE EXPENSAS</div><table><thead><tr><th class="L">U.F.</th><th class="L">Dpto.</th><th class="L">PROPIETARIO</th><th>DEUDA</th><th>TOTAL</th></tr></thead><tbody>${filMor}<tr class="gt"><td colspan="3" style="text-align:right;padding-right:10px">TOTAL</td><td>${fmtN(morosos.reduce((a,u)=>a+u.deuda,0))}</td><td>${fmtN(morosos.reduce((a,u)=>a+u.deuda+u.interes,0))}</td></tr></tbody></table>`:'<p style="text-align:center;color:#1B6B35;font-weight:600;margin-top:20px">✅ Sin unidades con deuda en este período.</p>'}${footer(3)}</div>`

  const CHUNK=33; const chunks=[]; for(let i=0;i<ufsTabla.length;i+=CHUNK) chunks.push(ufsTabla.slice(i,i+CHUNK))
  const tots2={salAnt:ufsTabla.reduce((a,u)=>a+u.salAnt,0),pagos:ufsTabla.reduce((a,u)=>a+u.pagos,0),deuda:ufsTabla.reduce((a,u)=>a+u.deuda,0),interes:ufsTabla.reduce((a,u)=>a+u.interes,0),fdoUF:ufsTabla.reduce((a,u)=>a+u.fdoUF,0),gralesUF:ufsTabla.reduce((a,u)=>a+u.gralesUF,0),cochUF:ufsTabla.reduce((a,u)=>a+u.cochUF,0),dptUF:ufsTabla.reduce((a,u)=>a+u.dptUF,0),total:ufsTabla.reduce((a,u)=>a+u.total,0)}
  const pagsProrr=chunks.map((chunk,ci)=>{
    const np=4+ci; const esUlt=ci===chunks.length-1
    const filas=chunk.map(u=>`<tr><td class="L">${String(u.uf).padStart(2,'0')}</td><td class="L">${u.dpto}</td><td class="L" style="max-width:70px;overflow:hidden;white-space:nowrap">${u.prop}</td><td>${fmtN(u.salAnt)}</td><td>${fmtN(u.pagos)}</td><td>${u.deuda>0?fmtN(u.deuda):'0,00'}</td><td>${u.interes>0?fmtN(u.interes):'0,00'}</td><td>${u.pct.toFixed(2)}%</td><td style="font-size:5.5pt">0,00%</td><td>${fmtN(u.fdoUF)}</td><td style="font-size:5.5pt">0,00%</td><td>${fmtN(u.gralesUF)}</td><td style="font-size:5.5pt">0,00%</td><td>${fmtN(u.cochUF)}</td><td>${fmtN(u.dptUF)}</td><td style="font-size:5.5pt">${fmtN(u.redondeo)}</td><td style="font-weight:600">${fmtN(u.total)}</td><td class="L" style="font-size:5.5pt;color:#888">${String(u.uf).padStart(2,'0')}</td></tr>`).join('')
    const filaTot=esUlt?`<tr class="gt"><td colspan="3" style="text-align:right">TOTAL</td><td>${fmtN(tots2.salAnt)}</td><td>${fmtN(tots2.pagos)}</td><td>${fmtN(tots2.deuda)}</td><td>${fmtN(tots2.interes)}</td><td>100%</td><td>,00</td><td>${fmtN(tots2.fdoUF)}</td><td>100%</td><td>${fmtN(tots2.gralesUF)}</td><td>100%</td><td>${fmtN(tots2.cochUF)}</td><td>${fmtN(tots2.dptUF)}</td><td>,00</td><td>${fmtN(tots2.total)}</td><td></td></tr>`:''
    return `<div class="page"><div style="font-size:6.8pt;color:#444;margin-bottom:3px"><b>Administración:</b> ${adm.nombre||'Javier Garcia Perez'} &nbsp;&nbsp; <b>Consorcio:</b> ${consorcioActivo.nombre||''} &nbsp;&nbsp; <b>Período:</b> ${expensa.periodo||''}<span style="float:right;font-size:6pt">R.P.A: ${adm.matricula_rpac||'83'} | CUIT: ${consorcioActivo.cuit||''} | Vencimiento: ${expensa.fecha_vencimiento||''}</span></div><div style="background:#1A3FA0;color:#fff;text-align:center;font-size:8pt;font-weight:700;padding:4px">ESTADO DE CUENTAS Y PRORRATEO</div><table style="font-size:5.8pt"><thead><tr><th class="L">U.F.</th><th class="L">Dpto.</th><th class="L">PROP.</th><th>SALDO ANT.</th><th>PAGOS</th><th>DEUDA</th><th>INTERES</th><th>GTOS PART.</th><th></th><th>FDO OBRAS</th><th></th><th>GTOS GRALES</th><th></th><th>COCH.</th><th>DPTOS</th><th>RED./AJ.</th><th>TOTAL</th><th>U.F.</th></tr></thead><tbody>${filas}${filaTot}</tbody></table>${footer(np)}</div>`
  }).join('')
  const pag6=`<div class="page">${hdr()}<div class="fpago"><h3>FORMAS DE PAGO</h3><p style="font-weight:600;margin-bottom:5px">DEPÓSITO O TRANSFERENCIA</p><p><b>Titular:</b> ${consorcioActivo.nombre||''}<br/><b>CBU:</b> ${consorcioActivo.cbu||'—'}<br/><b>Nº de cuenta:</b> ${consorcioActivo.nro_cuenta||'—'}<br/><b>Alias:</b> ${consorcioActivo.alias_cbu||'—'}<br/><b>Banco:</b> ${consorcioActivo.banco||'—'}<br/><b>Sucursal:</b> ${consorcioActivo.sucursal||'—'}</p></div>${footer(6)}</div>`
  const html=`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>Liquidación ${per} — ${consorcioActivo.nombre}</title><style>${css}</style></head><body><button class="btn-print no-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>${pag1}${pag2}${pag3}${pagsProrr}${pag6}</body></html>`
  const win=window.open('','_blank','width=900,height=720')
  win.document.write(html); win.document.close(); win.focus()
}

export default function Portal() {
  const router = useRouter()
  const { token } = router.query

  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [unidad, setUnidad]           = useState(null)
  const [coprop, setCoprop]           = useState(null)
  const [consorcio, setConsorcio]     = useState(null)
  const [detalles, setDetalles]       = useState([])
  const [cobranzas, setCobranzas]     = useState([])
  const [adminPerfil, setAdminPerfil] = useState(null)
  const [cuentaBanco, setCuentaBanco] = useState(null)
  const [tab, setTab]                 = useState('cuenta')
  // Planilla de liquidación expandida
  const [periodoExpandido, setPeriodoExpandido] = useState(null) // 'YYYY-MM' | null
  const [gastosPeriodo, setGastosPeriodo]       = useState([])
  const [loadingGastos, setLoadingGastos]       = useState(false)

  useEffect(() => { if (token) cargar(token) }, [token])

  // Leer hash al montar y cuando cambia loading
  useEffect(() => {
    if (loading || !token) return
    const hash = window.location.hash
    if (!hash) return
    if (hash === '#cuenta-corriente') { setTab('cuenta'); return }
    if (hash === '#pagos') { setTab('pagos'); return }
    if (hash.startsWith('#liquidacion-')) {
      const per = hash.replace('#liquidacion-', '')
      setTab('cuenta')
      expandirPeriodo(per)
    }
  }, [loading])

  async function cargar(tk) {
    setLoading(true)
    try {
      const { data: uf, error: e1 } = await supabase
        .from('con_unidades').select('*').eq('portal_token', tk).single()
      if (e1 || !uf) { setError('Link no válido o expirado.'); setLoading(false); return }
      setUnidad(uf)

      const [
        { data: cp }, { data: con }, { data: adm },
        { data: cuentas }, { data: dets }, { data: cobs }
      ] = await Promise.all([
        supabase.from('con_copropietarios').select('*').eq('id', uf.propietario_id).single(),
        supabase.from('con_consorcios').select('*').eq('id', uf.consorcio_id).single(),
        supabase.from('con_admin_perfil').select('*').eq('admin_id', uf.admin_id).single(),
        supabase.from('con_cuentas_banco').select('*')
          .eq('consorcio_id', uf.consorcio_id).eq('activa', true).limit(1),
        supabase.from('con_expensas_detalle').select(`
          id, expensa_id, monto, saldo_anterior, pagos_periodo, interes_mora, estado,
          con_expensas:expensa_id (id, periodo, fecha_vencimiento, estado, tipo, total_expensa, total_gastos)
        `).eq('unidad_id', uf.id).order('created_at', { ascending: false }).limit(24),
        supabase.from('con_cobranzas').select(`
          id, monto, fecha, medio_pago, recibo_numero, observaciones,
          con_expensas:expensa_id (periodo)
        `).eq('unidad_id', uf.id).order('fecha', { ascending: false }).limit(30),
      ])

      setCoprop(cp); setConsorcio(con); setAdminPerfil(adm)
      setCuentaBanco(cuentas?.[0] || null)
      // Filtrar detalles válidos
      setDetalles((dets||[]).filter(d =>
        (parseFloat(d.monto)||0) > 0 || (parseFloat(d.saldo_anterior)||0) > 0
      ))
      setCobranzas(cobs||[])
    } catch(e) { setError('Error al cargar. Intente nuevamente.') }
    setLoading(false)
  }

  // Estado para datos del PDF completo
  const [todosDetalles, setTodosDetalles]   = useState([])
  const [todasUnidades, setTodasUnidades]   = useState([])
  const [todosCoprop, setTodosCoprop]       = useState([])
  const [generandoPDF, setGenerandoPDF]     = useState(false)
  const [expensaActual, setExpensaActual]   = useState(null)

  // Cargar y expandir la planilla de un período específico
  async function expandirPeriodo(per) {
    setPeriodoExpandido(per)
    setLoadingGastos(true)
    // Buscar la expensa_id del período desde los detalles cargados
    const det = detalles.find(d => d.con_expensas?.periodo === per)
    const expId = det?.expensa_id
    if (!expId) { setLoadingGastos(false); return }

    // Cargar en paralelo: gastos, todos los detalles del período, todas las UFs, todos los copropietarios, perfil expensa
    const [
      { data: gastos }, { data: todsDets }, { data: todsUfs },
      { data: todsCps }, { data: expData }
    ] = await Promise.all([
      supabase.from('con_gastos')
        .select('categoria, concepto, monto, proveedor_nombre, comprobante')
        .eq('expensa_id', expId).order('categoria'),
      supabase.from('con_expensas_detalle').select('*').eq('expensa_id', expId),
      supabase.from('con_unidades').select('*').eq('consorcio_id', unidad.consorcio_id),
      supabase.from('con_copropietarios').select('*').eq('consorcio_id', unidad.consorcio_id),
      supabase.from('con_expensas').select('*').eq('id', expId).single(),
    ])
    setGastosPeriodo(gastos||[])
    setTodosDetalles(todsDets||[])
    setTodasUnidades(todsUfs||[])
    setTodosCoprop(todsCps||[])
    setExpensaActual(expData||null)
    setLoadingGastos(false)
    setTimeout(() => {
      const el = document.getElementById('planilla-liq')
      if (el) el.scrollIntoView({ behavior:'smooth', block:'start' })
    }, 100)
  }

  function abrirPDFCompleto() {
    if (!expensaActual || !consorcio) return
    setGenerandoPDF(true)
    try {
      generarPDFLiquidacion({
        consorcioActivo: consorcio,
        expensa: expensaActual,
        gastos: gastosPeriodo,
        detalles: todosDetalles,
        unidades: todasUnidades,
        copropietarios: todosCoprop,
        adminPerfil: adminPerfil || {},
      })
    } catch(e) {
      alert('Error al generar PDF: ' + e.message)
    }
    setGenerandoPDF(false)
  }

  const detOrdenados = [...detalles].sort((a,b) =>
    (b.con_expensas?.periodo||'').localeCompare(a.con_expensas?.periodo||'')
  )
  const deudaReal = detOrdenados[0] ? saldoDet(detOrdenados[0]) : 0
  const estaAlDia = deudaReal === 0
  const ultimoPago = cobranzas[0] || null
  const cbu    = cuentaBanco?.cbu   || consorcio?.cbu   || null
  const alias  = cuentaBanco?.alias || consorcio?.alias_cbu || '—'
  const banco  = cuentaBanco?.banco || consorcio?.banco  || '—'

  if (!token) return null
  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff', display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:'Segoe UI,Arial,sans-serif' }}>
      <div style={{ textAlign:'center', color:AZ }}>
        <div style={{ fontSize:36, marginBottom:12 }}>⏳</div>
        <div>Cargando su portal...</div>
      </div>
    </div>
  )
  if (error) return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff', display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:'Segoe UI,Arial,sans-serif' }}>
      <div style={{ textAlign:'center', background:'#fff', borderRadius:14,
        padding:40, maxWidth:380, boxShadow:'0 4px 24px #0001' }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>Link no válido</div>
        <div style={{ color:GR, fontSize:14 }}>{error}</div>
        <div style={{ marginTop:20, fontSize:12, color:GR }}>
          Contacte a su administrador para obtener un nuevo link.
        </div>
      </div>
    </div>
  )

  // ── Planilla de liquidación expandida ──────────────────────────────────────
  const detExpandido = detOrdenados.find(d => d.con_expensas?.periodo === periodoExpandido)
  if (periodoExpandido && detExpandido) {
    const exp     = detExpandido.con_expensas || {}
    const salAnt  = parseFloat(detExpandido.saldo_anterior)||0
    const monto   = parseFloat(detExpandido.monto)||0
    const mora    = parseFloat(detExpandido.interes_mora)||0
    const pagado  = parseFloat(detExpandido.pagos_periodo)||0
    const saldo   = saldoDet(detExpandido)
    const esPag   = detExpandido.estado === 'pagada'
    const totalGastos = gastosPeriodo.reduce((a,g) => a + (parseFloat(g.monto)||0), 0)
    // Agrupar gastos por categoría
    const gastosPorCat = {}
    for (const g of gastosPeriodo) {
      const cat = g.categoria || 'varios'
      if (!gastosPorCat[cat]) gastosPorCat[cat] = []
      gastosPorCat[cat].push(g)
    }
    return (
      <div style={{ minHeight:'100vh', background:'#f0f4ff',
        fontFamily:'Segoe UI,Arial,sans-serif', paddingBottom:48 }}>
        <Head>
          <title>Liquidación {periodoLabel(periodoExpandido)} — {consorcio?.nombre}</title>
          <meta name="viewport" content="width=device-width,initial-scale=1" />
        </Head>
        {/* Header */}
        <div style={{ background:AZ, color:'#fff', padding:'14px 18px',
          position:'sticky', top:0, zIndex:10, boxShadow:'0 2px 8px #0003' }}>
          <div style={{ maxWidth:680, margin:'0 auto', display:'flex',
            alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <button onClick={() => setPeriodoExpandido(null)}
                style={{ background:'rgba(255,255,255,0.2)', border:'none', color:'#fff',
                  borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:13 }}>
                ← Volver
              </button>
              <div>
                <div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase' }}>
                  Liquidación
                </div>
                <div style={{ fontSize:15, fontWeight:700 }}>
                  {periodoLabel(periodoExpandido)} — {consorcio?.nombre}
                </div>
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, opacity:0.7 }}>Unidad</div>
              <div style={{ fontSize:20, fontWeight:800 }}>{unidad?.numero}</div>
            </div>
          </div>
        </div>

        <div id="planilla-liq" style={{ maxWidth:680, margin:'0 auto', padding:'16px 14px' }}>

          {/* Encabezado planilla */}
          <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
            marginBottom:14, boxShadow:'0 2px 12px #0001', borderLeft:`4px solid ${AZ}` }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:17, color:AZ }}>
                  📋 Liquidación {periodoLabel(periodoExpandido)}
                </div>
                <div style={{ fontSize:12, color:GR, marginTop:4 }}>
                  {consorcio?.nombre} · Unidad {unidad?.numero} · {coprop?.apellido_nombre}
                </div>
                {exp.fecha_vencimiento && (
                  <div style={{ fontSize:12, color:GR, marginTop:2 }}>
                    Vencimiento: <strong>{fmtD(exp.fecha_vencimiento)}</strong>
                  </div>
                )}
              </div>
              <div style={{ background: esPag ? '#dcfce7' : saldo > 0 ? '#fee2e2' : '#fef9c3',
                color: esPag ? VD : saldo > 0 ? RJ : AM,
                borderRadius:10, padding:'10px 18px', textAlign:'center', fontWeight:700 }}>
                <div style={{ fontSize:11, marginBottom:2 }}>
                  {esPag ? '✓ Pagada' : saldo > 0 ? 'Total a pagar' : 'Pendiente'}
                </div>
                <div style={{ fontSize:20 }}>{esPag ? '✓' : fmt(saldo)}</div>
              </div>
            </div>
          </div>

          {/* Tabla de composición de la expensa */}
          <div style={{ background:'#fff', borderRadius:14, overflow:'hidden',
            marginBottom:14, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ background:AZ, color:'#fff', padding:'10px 18px',
              fontWeight:700, fontSize:13 }}>
              Composición de su expensa
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <tbody>
                {salAnt > 0 && (
                  <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'11px 18px', color:GR }}>Saldo anterior</td>
                    <td style={{ padding:'11px 18px', textAlign:'right', color:RJ, fontWeight:600 }}>{fmt(salAnt)}</td>
                  </tr>
                )}
                <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                  <td style={{ padding:'11px 18px' }}>
                    Expensa {periodoLabel(periodoExpandido)}
                    <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                      Coef. fiscal: {Number(unidad?.porcentaje_fiscal||0).toFixed(4)}%
                    </div>
                  </td>
                  <td style={{ padding:'11px 18px', textAlign:'right', fontWeight:600 }}>{fmt(monto)}</td>
                </tr>
                {mora > 0 && (
                  <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'11px 18px', color:AM }}>Interés por mora</td>
                    <td style={{ padding:'11px 18px', textAlign:'right', color:AM, fontWeight:600 }}>{fmt(mora)}</td>
                  </tr>
                )}
                {pagado > 0 && (
                  <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'11px 18px', color:VD }}>Pagado</td>
                    <td style={{ padding:'11px 18px', textAlign:'right', color:VD, fontWeight:600 }}>− {fmt(pagado)}</td>
                  </tr>
                )}
                <tr style={{ background:'#f0f4ff', borderTop:`2px solid ${AZ}` }}>
                  <td style={{ padding:'13px 18px', fontWeight:700, color:AZ }}>Total</td>
                  <td style={{ padding:'13px 18px', textAlign:'right', fontWeight:800,
                    fontSize:17, color: esPag ? VD : saldo > 0 ? RJ : GR }}>
                    {esPag ? '✓ Pagada' : fmt(saldo)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Detalle de gastos del consorcio */}
          <div style={{ background:'#fff', borderRadius:14, overflow:'hidden',
            marginBottom:14, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ background:'#374151', color:'#fff', padding:'10px 18px',
              fontWeight:700, fontSize:13 }}>
              Gastos del consorcio — {periodoLabel(periodoExpandido)}
              {totalGastos > 0 && (
                <span style={{ float:'right', fontWeight:400, fontSize:12 }}>
                  Total: {fmt(totalGastos)}
                </span>
              )}
            </div>
            {loadingGastos ? (
              <div style={{ padding:24, textAlign:'center', color:GR }}>Cargando gastos...</div>
            ) : gastosPeriodo.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:GR, fontSize:13 }}>
                Sin gastos detallados para este período
              </div>
            ) : (
              <div>
                {Object.entries(gastosPorCat).map(([cat, gs]) => {
                  const subtotal = gs.reduce((a,g) => a + (parseFloat(g.monto)||0), 0)
                  return (
                    <div key={cat}>
                      <div style={{ background:'#eff6ff', padding:'7px 18px',
                        fontSize:11, fontWeight:700, color:AZ,
                        textTransform:'uppercase', letterSpacing:'0.04em',
                        display:'flex', justifyContent:'space-between' }}>
                        <span>{cat}</span>
                        <span>{fmt(subtotal)}</span>
                      </div>
                      {gs.map((g, i) => (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between',
                          alignItems:'center', padding:'9px 18px',
                          borderBottom:'1px solid #f3f4f6', fontSize:12 }}>
                          <div>
                            <div>{g.concepto}</div>
                            {g.proveedor_nombre && (
                              <div style={{ fontSize:11, color:GR }}>{g.proveedor_nombre}
                                {g.comprobante && ` · ${g.comprobante}`}
                              </div>
                            )}
                          </div>
                          <div style={{ fontWeight:600, whiteSpace:'nowrap', marginLeft:12 }}>
                            {fmt(parseFloat(g.monto)||0)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
                <div style={{ display:'flex', justifyContent:'space-between',
                  padding:'12px 18px', background:'#374151', color:'#fff', fontWeight:700 }}>
                  <span>TOTAL GASTOS CONSORCIO</span>
                  <span>{fmt(totalGastos)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Datos de pago */}
          {cbu && (
            <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
              marginBottom:14, border:`1.5px solid #dbeafe`, boxShadow:'0 2px 8px #0001' }}>
              <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:12 }}>
                💳 Cómo pagar
              </div>
              <div style={{ fontSize:13, color:'#374151', lineHeight:2 }}>
                <div><span style={{ color:GR }}>Titular:</span> <strong>{consorcio?.nombre}</strong></div>
                <div><span style={{ color:GR }}>CBU:</span>{' '}
                  <strong style={{ fontFamily:'monospace' }}>{cbu}</strong>
                </div>
                <div><span style={{ color:GR }}>Alias:</span> <strong>{alias}</strong></div>
                <div><span style={{ color:GR }}>Banco:</span> {banco}</div>
              </div>
              <div style={{ marginTop:10, padding:'8px 12px', background:'#eff6ff',
                borderRadius:8, fontSize:11, color:'#1e40af' }}>
                ℹ️ Incluya el importe exacto con centavos al transferir.
              </div>
            </div>
          )}

          {/* Botón PDF completo */}
          <button onClick={abrirPDFCompleto} disabled={generandoPDF || loadingGastos}
            style={{ width:'100%', padding:'13px', background:'#374151', color:'#fff',
              border:'none', borderRadius:12, fontWeight:700, fontSize:14,
              cursor:'pointer', marginBottom:10 }}>
            {generandoPDF ? '⏳ Generando...' : '📄 Ver planilla completa PDF (imprimible)'}
          </button>

          {/* Botón volver */}
          <button onClick={() => { setPeriodoExpandido(null); setGastosPeriodo([]) }}
            style={{ width:'100%', padding:'13px', background:AZ, color:'#fff',
              border:'none', borderRadius:12, fontWeight:700, fontSize:14, cursor:'pointer' }}>
            ← Volver al portal
          </button>
        </div>
      </div>
    )
  }

  // ── Vista principal del portal ─────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff',
      fontFamily:'Segoe UI,Arial,sans-serif', paddingBottom:48 }}>
      <Head>
        <title>Portal — {coprop?.apellido_nombre || 'Copropietario'} · GASP</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>

      {/* Header */}
      <div style={{ background:AZ, color:'#fff', padding:'16px 18px',
        position:'sticky', top:0, zIndex:10, boxShadow:'0 2px 8px #0003' }}>
        <div style={{ maxWidth:680, margin:'0 auto', display:'flex',
          alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:36, height:36, background:'rgba(255,255,255,0.15)',
              borderRadius:8, display:'flex', alignItems:'center',
              justifyContent:'center', fontSize:16, fontWeight:900 }}>G</div>
            <div>
              <div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Administración Pinamar
              </div>
              <div style={{ fontSize:15, fontWeight:700 }}>Portal del Copropietario</div>
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:10, opacity:0.7 }}>Unidad</div>
            <div style={{ fontSize:20, fontWeight:800 }}>{unidad?.numero}</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:680, margin:'0 auto', padding:'16px 14px' }}>

        {/* Tarjeta identidad */}
        <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
          marginBottom:14, boxShadow:'0 2px 12px #0001', borderLeft:`4px solid ${AZ}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:2 }}>Copropietario</div>
              <div style={{ fontWeight:700, fontSize:17 }}>{coprop?.apellido_nombre || '—'}</div>
              <div style={{ fontSize:12, color:GR, marginTop:5, display:'flex', gap:8, flexWrap:'wrap' }}>
                <span style={{ background:'#f0f4ff', color:AZ, borderRadius:6,
                  padding:'2px 10px', fontWeight:600 }}>
                  Unidad {unidad?.numero}
                </span>
                <span style={{ textTransform:'capitalize' }}>{unidad?.tipo}</span>
                {unidad?.piso && <span>Piso {unidad.piso}</span>}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:GR }}>Consorcio</div>
              <div style={{ fontWeight:600, fontSize:12, color:'#374151', lineHeight:1.4, maxWidth:170 }}>
                {consorcio?.nombre}
              </div>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
          <div style={{ background: estaAlDia ? '#dcfce7' : '#fee2e2',
            borderRadius:14, padding:'16px 18px', textAlign:'center' }}>
            <div style={{ fontSize:10, color: estaAlDia ? VD : RJ, fontWeight:700,
              textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
              {estaAlDia ? 'Estado' : 'Saldo pendiente'}
            </div>
            <div style={{ fontSize:22, fontWeight:800, color: estaAlDia ? VD : RJ }}>
              {estaAlDia ? '✓ Al día' : fmt(deudaReal)}
            </div>
          </div>
          <div style={{ background:'#fff', borderRadius:14, padding:'16px 18px',
            textAlign:'center', boxShadow:'0 2px 8px #0001' }}>
            <div style={{ fontSize:10, color:GR, fontWeight:700,
              textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
              Último pago
            </div>
            {ultimoPago ? (
              <>
                <div style={{ fontSize:20, fontWeight:800, color:VD }}>{fmt(ultimoPago.monto)}</div>
                <div style={{ fontSize:11, color:GR, marginTop:2 }}>{fmtD(ultimoPago.fecha)}</div>
              </>
            ) : (
              <div style={{ fontSize:13, color:GR, marginTop:4 }}>Sin pagos</div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:14,
          background:'#fff', borderRadius:12, padding:4, boxShadow:'0 2px 8px #0001' }}>
          {[
            { id:'cuenta', label:'📋 Cuenta corriente' },
            { id:'pagos',  label:'💳 Pagos' },
            { id:'contacto', label:'📞 Contacto' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ flex:1, padding:'9px 6px', border:'none', cursor:'pointer',
                borderRadius:9, fontSize:12, fontWeight: tab===t.id ? 700 : 500,
                background: tab===t.id ? AZ : 'transparent',
                color: tab===t.id ? '#fff' : GR }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB: CUENTA CORRIENTE */}
        {tab === 'cuenta' && (
          <div id="cuenta-corriente">
            {detOrdenados.length === 0 ? (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>Sin movimientos registrados</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {detOrdenados.map((d, idx) => {
                  const s      = saldoDet(d)
                  const monto  = parseFloat(d.monto)||0
                  const salAnt = parseFloat(d.saldo_anterior)||0
                  const mora   = parseFloat(d.interes_mora)||0
                  const pagado = parseFloat(d.pagos_periodo)||0
                  const esPag  = d.estado === 'pagada'
                  const esMor  = d.estado === 'morosa'
                  const per    = d.con_expensas?.periodo || ''
                  return (
                    <div key={d.id} id={`liquidacion-${per}`}
                      style={{ background:'#fff', borderRadius:12,
                        border:`1.5px solid ${esPag ? '#86efac' : esMor ? '#fca5a5' : '#fde68a'}`,
                        overflow:'hidden', boxShadow:'0 1px 6px #0001' }}>
                      <div style={{ display:'flex', justifyContent:'space-between',
                        alignItems:'center', padding:'12px 16px',
                        background: esPag ? '#f0fdf4' : esMor ? '#fff5f5' : '#fffbeb' }}>
                        <div>
                          <span style={{ fontWeight:700, fontSize:15 }}>
                            {periodoLabel(per)}
                          </span>
                          <span style={{ marginLeft:8, fontSize:10, padding:'2px 9px',
                            borderRadius:8, fontWeight:700,
                            background: esPag ? '#dcfce7' : esMor ? '#fee2e2' : '#fef9c3',
                            color: esPag ? VD : esMor ? RJ : AM }}>
                            {esPag ? '✓ Pagada' : esMor ? 'Morosa' : 'Pendiente'}
                          </span>
                          {idx === 0 && (
                            <span style={{ marginLeft:6, fontSize:9, padding:'1px 7px',
                              borderRadius:6, background:AZ, color:'#fff', fontWeight:600 }}>
                              ACTUAL
                            </span>
                          )}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ fontWeight:800, fontSize:16,
                            color: esPag ? VD : s > 0 ? RJ : GR }}>
                            {esPag ? '✓' : fmt(s)}
                          </div>
                          {/* Botón ver liquidación completa */}
                          <button onClick={() => expandirPeriodo(per)}
                            style={{ background:AZ, color:'#fff', border:'none',
                              borderRadius:7, padding:'5px 11px', fontSize:11,
                              fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                            📋 Ver
                          </button>
                        </div>
                      </div>
                      <div style={{ padding:'10px 16px 14px',
                        display:'grid', gridTemplateColumns:'1fr 1fr',
                        gap:'6px 16px', fontSize:12, color:GR }}>
                        {monto > 0 && <div>Expensa: <strong style={{ color:'#374151' }}>{fmt(monto)}</strong></div>}
                        {salAnt > 0 && <div>Saldo ant.: <strong style={{ color:RJ }}>{fmt(salAnt)}</strong></div>}
                        {mora > 0 && <div>Interés mora: <strong style={{ color:AM }}>{fmt(mora)}</strong></div>}
                        {pagado > 0 && <div>Pagado: <strong style={{ color:VD }}>{fmt(pagado)}</strong></div>}
                        {d.con_expensas?.fecha_vencimiento && (
                          <div>Vto.: <strong style={{ color:'#374151' }}>{fmtD(d.con_expensas.fecha_vencimiento)}</strong></div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Datos de pago en cuenta corriente */}
            {cbu && (
              <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
                marginTop:14, border:`1.5px solid #dbeafe`, boxShadow:'0 2px 8px #0001' }}>
                <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:12 }}>
                  💳 Cómo pagar
                </div>
                <div style={{ fontSize:13, color:'#374151', lineHeight:2 }}>
                  <div><span style={{ color:GR }}>Titular:</span> <strong>{consorcio?.nombre}</strong></div>
                  <div><span style={{ color:GR }}>CBU:</span>{' '}
                    <strong style={{ fontFamily:'monospace' }}>{cbu}</strong>
                  </div>
                  <div><span style={{ color:GR }}>Alias:</span> <strong>{alias}</strong></div>
                  <div><span style={{ color:GR }}>Banco:</span> {banco}</div>
                </div>
                <div style={{ marginTop:10, padding:'8px 12px', background:'#eff6ff',
                  borderRadius:8, fontSize:11, color:'#1e40af' }}>
                  ℹ️ Incluya el importe exacto con centavos al transferir.
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: PAGOS */}
        {tab === 'pagos' && (
          <div id="pagos">
            {cobranzas.length === 0 ? (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>
                <div style={{ fontSize:28, marginBottom:8 }}>💳</div>
                <div>Sin pagos registrados</div>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
                boxShadow:'0 2px 12px #0001' }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>
                  Historial de pagos
                </div>
                {cobranzas.map((c, i) => (
                  <div key={c.id} style={{ display:'flex', justifyContent:'space-between',
                    alignItems:'center', padding:'11px 0',
                    borderBottom: i < cobranzas.length-1 ? '1px solid #f3f4f6' : 'none' }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:13 }}>
                        {periodoLabel(c.con_expensas?.periodo)}
                      </div>
                      <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                        {fmtD(c.fecha)}
                        {c.medio_pago && <span style={{ marginLeft:8, textTransform:'capitalize' }}>· {c.medio_pago}</span>}
                        {c.recibo_numero && <span style={{ marginLeft:6 }}>· Rec. {c.recibo_numero}</span>}
                      </div>
                      {c.observaciones && <div style={{ fontSize:11, color:GR }}>{c.observaciones}</div>}
                    </div>
                    <div style={{ fontWeight:800, fontSize:16, color:VD }}>{fmt(c.monto)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: CONTACTO */}
        {tab === 'contacto' && (
          <div>
            {adminPerfil ? (
              <div style={{ background:'#fff', borderRadius:14, padding:20,
                boxShadow:'0 2px 12px #0001' }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>📞 Administración</div>
                <div style={{ display:'flex', flexDirection:'column', gap:12, fontSize:14 }}>
                  <div style={{ fontWeight:700, fontSize:15 }}>
                    {adminPerfil.nombre}
                    {adminPerfil.matricula_rpac && (
                      <span style={{ marginLeft:8, fontSize:12, color:GR, fontWeight:400 }}>
                        RPAC N° {adminPerfil.matricula_rpac}
                      </span>
                    )}
                  </div>
                  {adminPerfil.direccion && <div style={{ color:GR }}>📍 {adminPerfil.direccion}</div>}
                  {adminPerfil.telefono && (
                    <a href={`tel:${adminPerfil.telefono}`}
                      style={{ color:AZ, textDecoration:'none', fontWeight:600, display:'block',
                        background:'#eff6ff', padding:'10px 14px', borderRadius:8 }}>
                      📱 {adminPerfil.telefono}
                    </a>
                  )}
                  {adminPerfil.telefono && (
                    <a href={`https://wa.me/${adminPerfil.telefono?.replace(/\D/g,'')}`}
                      target="_blank" rel="noopener"
                      style={{ color:'#fff', textDecoration:'none', display:'block',
                        background:'#25D366', padding:'10px 16px', borderRadius:8,
                        fontWeight:700, textAlign:'center' }}>
                      💬 Contactar por WhatsApp
                    </a>
                  )}
                  {adminPerfil.email && (
                    <a href={`mailto:${adminPerfil.email}`}
                      style={{ color:AZ, textDecoration:'none', fontWeight:600 }}>
                      ✉ {adminPerfil.email}
                    </a>
                  )}
                  {adminPerfil.horario && (
                    <div style={{ fontSize:12, color:GR, background:'#f9fafb',
                      padding:'8px 12px', borderRadius:8 }}>
                      🕐 {adminPerfil.horario}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>Sin datos de contacto</div>
            )}
          </div>
        )}

        <div style={{ textAlign:'center', marginTop:28, fontSize:10, color:GR }}>
          Portal del copropietario · GASP Consorcios · administracionpinamar.com
        </div>
      </div>
    </div>
  )
}
