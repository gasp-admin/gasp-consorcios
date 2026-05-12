// build 20260512 import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(SUPA_URL, SUPA_KEY)

const SUPERADMIN = 'javiergp@live.com.ar'

const AZ  = '#1A3FA0'
const VD  = '#1B6B35'
const RJ  = '#B91C1C'
const AM  = '#C07D10'
const GR  = '#6B7280'
const BG  = '#080D1A'
const AZ2 = '#1e4db7'

const fmt  = n => n ? '$' + Number(n).toLocaleString('es-AR') : '$0'
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR') : '—'
const nextId = (items, prefix) => {
  const nums = (items||[]).map(x=>x.id||'').filter(id=>id.startsWith(prefix))
    .map(id=>parseInt(id.slice(prefix.length),10)).filter(n=>!isNaN(n))
  return prefix + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3,'0')
}
const periodoLabel = p => {
  if (!p) return '—'
  const [y,m] = p.split('-')
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${meses[parseInt(m)-1]} ${y}`
}

// ── UI BASE ───────────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return <div style={{ background:'#fff', border:'0.5px solid #ddd', borderRadius:10, padding:16, ...style }}>{children}</div>
}
function Btn({ children, onClick, color, small, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding:small?'5px 12px':'8px 18px', borderRadius:7, border:'none',
        background:disabled?'#e5e7eb':(color||AZ), color:disabled?'#9ca3af':'#fff',
        cursor:disabled?'not-allowed':'pointer', fontSize:small?12:13, fontWeight:600, ...style }}>
      {children}
    </button>
  )
}
function BtnSec({ children, onClick, small, style }) {
  return (
    <button onClick={onClick}
      style={{ padding:small?'5px 12px':'8px 18px', borderRadius:7,
        border:'1px solid #d1d5db', background:'#fff', cursor:'pointer',
        fontSize:small?12:13, color:'#374151', ...style }}>
      {children}
    </button>
  )
}
function Input({ label, value, onChange, type='text', placeholder, required }) {
  return (
    <div>
      <div style={{ fontSize:12, color:'#6b7280', marginBottom:4, fontWeight:500 }}>
        {label}{required && <span style={{color:RJ}}> *</span>}
      </div>
      <input type={type} value={value||''} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', boxSizing:'border-box', outline:'none' }} />
    </div>
  )
}
function Sel({ label, value, onChange, opts, required }) {
  return (
    <div>
      <div style={{ fontSize:12, color:'#6b7280', marginBottom:4, fontWeight:500 }}>
        {label}{required && <span style={{color:RJ}}> *</span>}
      </div>
      <select value={value||''} onChange={e=>onChange(e.target.value)}
        style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', background:'#fff' }}>
        {opts.map(o => <option key={o.v||o} value={o.v||o}>{o.l||o}</option>)}
      </select>
    </div>
  )
}
function Badge({ text, color='#6b7280', bg }) {
  return (
    <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:'bold', background:bg||color+'20', color }}>
      {text}
    </span>
  )
}
function Msg({ data }) {
  if (!data) return null
  const colors = { ok:{bg:'#dcfce7',c:'#166534'}, error:{bg:'#fee2e2',c:'#991b1b'}, warn:{bg:'#fef9c3',c:'#854d0e'}, info:{bg:'#dbeafe',c:'#1e40af'} }
  const s = colors[data.tipo] || colors.info
  return <div style={{ background:s.bg, color:s.c, borderRadius:8, padding:'10px 14px', fontSize:13, marginBottom:14 }}>{data.texto}</div>
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF LIQUIDACIÓN — FORMATO ADMINISTRACIÓN GLOBAL (6 páginas)
// ══════════════════════════════════════════════════════════════════════════════
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

  const css=`*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:8.5pt;color:#111;background:#fff}.page{width:210mm;min-height:297mm;padding:11mm 13mm 9mm;page-break-after:always;position:relative}.page:last-child{page-break-after:auto}@page{size:A4;margin:0}@media print{body{margin:0}.no-print{display:none!important}}.hdr{display:flex;align-items:flex-start;gap:14px;border-bottom:2px solid #1A3FA0;padding-bottom:9px;margin-bottom:8px}.hdr-logo{width:90px;flex-shrink:0;background:#1A3FA0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:900;height:55px}.hdr-title h1{font-size:13.5pt;color:#1A3FA0;font-weight:800}.hdr-title h2{font-size:10pt;color:#2e4057;margin-top:1px}.datos{display:flex;gap:22px;margin-bottom:9px}.datos-col{flex:1}.datos-col h3{font-size:7.5pt;color:#1A3FA0;text-transform:uppercase;letter-spacing:.5px;font-weight:700;border-bottom:1px solid #1A3FA0;padding-bottom:2px;margin-bottom:3px}.datos-col p{font-size:7pt;color:#222;line-height:1.55}.stitle{background:#1A3FA0;color:#fff;font-size:8pt;font-weight:700;text-transform:uppercase;padding:4px 8px;text-align:center;margin-bottom:0}table{width:100%;border-collapse:collapse;font-size:6.8pt}th{background:#2e4057;color:#fff;padding:4px 5px;text-align:right;font-weight:600;white-space:nowrap}th.L{text-align:left}td{padding:2.5px 5px;text-align:right;border-bottom:1px solid #e8e8e8}td.L{text-align:left}tr:nth-child(even) td{background:#f6f9fc}.rh td{background:#d4e8f6!important;font-weight:700;color:#1A3FA0;font-size:7pt}.rt td{background:#1A3FA0!important;color:#fff!important;font-weight:700;font-size:7pt}.gt td{background:#0d2b3e!important;color:#fff!important;font-weight:700;font-size:7.5pt}.ef-final td{background:#1A3FA0!important;color:#fff!important;font-weight:700}.nota{border:1px solid #ccc;border-radius:4px;padding:9px 11px;margin-top:9px;font-size:7pt;line-height:1.6;color:#333}.nota h4{font-size:7.5pt;color:#1A3FA0;font-weight:700;margin-bottom:5px}.fpago{border:1.5px solid #1A3FA0;border-radius:6px;padding:13px 17px;margin-top:18px;max-width:390px}.fpago h3{color:#1A3FA0;font-size:10pt;font-weight:700;margin-bottom:7px}.fpago p{font-size:7.5pt;line-height:1.8}.footer-p{position:absolute;bottom:7mm;left:13mm;right:13mm;display:flex;justify-content:space-between;border-top:1px solid #ddd;padding-top:3px;font-size:6pt;color:#888}.btn-print{display:block;margin:18px auto;padding:11px 30px;background:#1A3FA0;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}`

  const hdr=()=>`<div class="hdr"><div class="hdr-logo">GASP</div><div class="hdr-title"><h1>Administración de Consorcios Pinamar</h1><h2>MIS EXPENSAS — Liquidación de mes: ${expensa.periodo||''}</h2></div></div><div class="datos"><div class="datos-col"><h3>Administración</h3><p><b>Nombre:</b> ${adm.nombre||'Javier Garcia Perez'}<br/>${adm.direccion||'Lenguado 1313 - Loc 3'}<br/>${adm.email||'administracion@administracionpinamar.com'}<br/><b>CUIT:</b> ${adm.cuit||'20186006802'} &nbsp; <b>R.P.A:</b> ${adm.matricula_rpac||'83'}<br/><b>Tel:</b> ${adm.telefono||'02267 444034'}<br/><b>Situación fiscal:</b> ${adm.situacion_fiscal||'Monotributo'}</p></div><div class="datos-col"><h3>Consorcio</h3><p><b>${consorcioActivo.nombre||''}</b><br/><b>CUIT:</b> ${consorcioActivo.cuit||'—'}<br/><b>Clave SUTERH:</b> ${consorcioActivo.clave_suterh||''}</p></div></div>`
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
  const pag2=`<div class="page">${hdr()}<div class="stitle">ESTADO FINANCIERO</div><table><thead><tr><th class="L">CONCEPTO</th><th>Grupo A</th><th>FDO OBRAS</th><th>GTOS GRALES</th><th>COCHERA</th><th>DPTOS</th><th>Total</th></tr></thead><tbody><tr><td class="L">Saldo anterior</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(ufsTabla.reduce((a,u)=>a+u.salAnt,0))}</td></tr><tr><td class="L" style="padding-left:16px;font-style:italic">Ingresos por pago en término</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(totCobrado)}</td></tr><tr><td class="L" style="padding-left:16px;font-style:italic">Ingresos por expensas adeudadas</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>0,00</td></tr><tr><td class="L" style="padding-left:16px;font-style:italic">Ingresos por intereses</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(ufsTabla.reduce((a,u)=>a+u.interes,0))}</td></tr><tr><td class="L" style="padding-left:16px;font-style:italic">Egresos por pagos</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(-totGlobal)}</td></tr><tr class="ef-final"><td class="L">Saldo final al ${expensa.fecha_vencimiento||'—'}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmtN(salFinal)}</td></tr></tbody></table><div class="nota"><h4>NOTAS</h4><p>Saldo Liq $ ${fmtN(salFinal)} .-<br/>Pendiente de pagos $ ${fmtN(totPend)} -<br/>SALDO DISPONIBLE $ ${fmtN(salFinal+totPend)} .-</p></div><div class="nota" style="margin-top:9px;font-size:6.8pt"><p>COMUNICAMOS A LOS SRES PROPIETARIOS/INQUILINOS QUE LOS PAGOS QUE NO SE REALICEN ANTES DE LOS DIAS 28 DE CADA MES, NO PODRAN SER ACREDITADOS EN TIEMPO Y FORMA POR CUESTIONES OPERATIVAS.</p><br/><p><b>UBICACIÓN:</b> ${adm.direccion||'LENGUADO N° 1313 LOCAL 3'} &nbsp; <b>TEL:</b> ${adm.telefono||''} &nbsp; <b>HORARIO:</b> ${adm.horario||'LUNES A SABADOS 9:00 A 13:00 HS'}</p></div>${footer(2)}</div>`
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

// ══════════════════════════════════════════════════════════════════════════════
// 1. UNIDADES FUNCIONALES
// ══════════════════════════════════════════════════════════════════════════════
function Unidades({ session, consorcioId, copropietarios }) {
  const [unidades, setUnidades] = useState([])
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const F = f => setForm(x => ({ ...x, ...f }))

  async function cargar() {
    const { data } = await supabase.from('con_unidades').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId).order('numero')
    setUnidades(data || [])
  }
  async function guardar() {
    if (!form.numero) return setMsg({ tipo:'warn', texto:'El número de UF es obligatorio' })
    const id = form.id || nextId(unidades, 'UF')
    const { error } = await supabase.from('con_unidades').upsert(
      { ...form, id, admin_id:session.user.id, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:'Error: '+error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Unidad guardada' }); cargar()
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar esta UF?')) return
    await supabase.from('con_unidades').delete().eq('id', id); cargar()
  }
  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const TIPOS=['departamento','local','cochera','baulera','oficina','otro']
  const ESTADOS=['ocupada','desocupada','en_venta']
  const totalCoef=unidades.reduce((a,u)=>a+(Number(u.porcentaje_fiscal)||0),0)

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:'#111' }}>Unidades Funcionales</div>
          <div style={{ fontSize:12, color:GR }}>{unidades.length} unidades · Coef. total: {totalCoef.toFixed(4)}%</div>
        </div>
        <Btn onClick={() => setForm({ tipo:'departamento', estado:'ocupada' })}>+ Nueva UF</Btn>
      </div>
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{form.id ? 'Editar UF' : 'Nueva Unidad Funcional'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Input label="Número / Código" value={form.numero} onChange={v=>F({numero:v})} placeholder="1A, 2B, PB-1..." required />
            <Sel label="Tipo" value={form.tipo} onChange={v=>F({tipo:v})} opts={TIPOS} />
            <Input label="Piso" value={form.piso} onChange={v=>F({piso:v})} placeholder="PB, 1°, 2°..." />
            <Input label="Sup. cubierta (m²)" value={form.superficie_cubierta} onChange={v=>F({superficie_cubierta:v})} type="number" />
            <Input label="Coeficiente fiscal %" value={form.porcentaje_fiscal} onChange={v=>F({porcentaje_fiscal:v})} type="number" placeholder="8.333..." required />
            <Sel label="Estado" value={form.estado} onChange={v=>F({estado:v})} opts={ESTADOS} />
            <Sel label="Copropietario" value={form.propietario_id} onChange={v=>F({propietario_id:v})}
              opts={[{v:'',l:'— Sin asignar —'}, ...copropietarios.map(c=>({v:c.id,l:c.apellido_nombre}))]} />
            <Input label="Descripción" value={form.descripcion} onChange={v=>F({descripcion:v})} placeholder="Observaciones..." />
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar</Btn>
            <BtnSec onClick={() => setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      {unidades.length === 0 ? (
        <Card style={{ textAlign:'center', color:GR, padding:32 }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🏢</div>
          <div>No hay unidades registradas. Agregá la primera UF.</div>
        </Card>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#f3f4f6' }}>
                {['UF','Tipo','Piso','Sup.','Coef. %','Copropietario','Estado',''].map((h,i) => (
                  <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unidades.map(u => {
                const cp=copropietarios.find(c=>c.id===u.propietario_id)
                const ec={ocupada:{c:VD,bg:'#dcfce7'},desocupada:{c:AM,bg:'#fef9c3'},en_venta:{c:AZ,bg:'#dbeafe'}}[u.estado]||{c:GR,bg:'#f3f4f6'}
                return (
                  <tr key={u.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:AZ }}>{u.numero}</td>
                    <td style={{ padding:'10px 12px', textTransform:'capitalize' }}>{u.tipo}</td>
                    <td style={{ padding:'10px 12px' }}>{u.piso||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{u.superficie_cubierta?u.superficie_cubierta+' m²':'—'}</td>
                    <td style={{ padding:'10px 12px', fontWeight:600 }}>{u.porcentaje_fiscal?Number(u.porcentaje_fiscal).toFixed(4)+'%':'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{cp?.apellido_nombre||'—'}</td>
                    <td style={{ padding:'10px 12px' }}><Badge text={u.estado} color={ec.c} bg={ec.bg} /></td>
                    <td style={{ padding:'10px 12px' }}>
                      <div style={{ display:'flex', gap:6 }}>
                        <Btn small onClick={() => setForm({...u})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                        <Btn small onClick={() => eliminar(u.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. COPROPIETARIOS
// ══════════════════════════════════════════════════════════════════════════════
function Copropietarios({ session, consorcioId, onUpdate }) {
  const [lista, setLista] = useState([])
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const F = f => setForm(x => ({ ...x, ...f }))

  async function cargar() {
    const { data } = await supabase.from('con_copropietarios').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId).order('apellido_nombre')
    setLista(data || [])
    if (onUpdate) onUpdate(data || [])
  }
  async function guardar() {
    if (!form.apellido_nombre) return setMsg({ tipo:'warn', texto:'Nombre obligatorio' })
    const id = form.id || nextId(lista, 'CP')
    const { error } = await supabase.from('con_copropietarios').upsert(
      { ...form, id, admin_id:session.user.id, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Guardado' }); cargar()
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar copropietario?')) return
    await supabase.from('con_copropietarios').delete().eq('id', id); cargar()
  }
  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Copropietarios ({lista.length})</div>
        <Btn onClick={() => setForm({})}>+ Agregar</Btn>
      </div>
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{form.id?'Editar copropietario':'Nuevo copropietario'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <Input label="Apellido y nombre" value={form.apellido_nombre} onChange={v=>F({apellido_nombre:v})} required />
            <Input label="DNI" value={form.dni} onChange={v=>F({dni:v})} />
            <Input label="Email" value={form.email} onChange={v=>F({email:v})} type="email" />
            <Input label="Teléfono / WhatsApp" value={form.telefono} onChange={v=>F({telefono:v})} />
            <div style={{ gridColumn:'span 2' }}>
              <Input label="Domicilio real (fuera del consorcio)" value={form.domicilio_real} onChange={v=>F({domicilio_real:v})} />
            </div>
            <div style={{ gridColumn:'span 2' }}>
              <Input label="Notas" value={form.notas} onChange={v=>F({notas:v})} />
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <input type="checkbox" checked={!!form.es_consejero} onChange={e=>F({es_consejero:e.target.checked})} id="consejero" />
              <label htmlFor="consejero" style={{ fontSize:13, cursor:'pointer' }}>Es consejero/a</label>
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar</Btn>
            <BtnSec onClick={() => setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {lista.map(cp => (
          <Card key={cp.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontWeight:700, fontSize:14 }}>
                {cp.apellido_nombre}
                {cp.es_consejero && <Badge text="Consejero" color={AZ} style={{ marginLeft:8 }} />}
              </div>
              <div style={{ fontSize:12, color:GR, marginTop:3, display:'flex', gap:14 }}>
                {cp.dni && <span>🪪 {cp.dni}</span>}
                {cp.telefono && <span>📱 {cp.telefono}</span>}
                {cp.email && <span>✉ {cp.email}</span>}
              </div>
            </div>
            <div style={{ display:'flex', gap:6 }}>
              {cp.telefono && <Btn small color='#25d366' onClick={() => window.open(`https://wa.me/549${cp.telefono.replace(/\D/g,'')}`)}>WhatsApp</Btn>}
              <Btn small onClick={() => setForm({...cp})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
              <Btn small onClick={() => eliminar(cp.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
            </div>
          </Card>
        ))}
        {lista.length===0 && <Card style={{ textAlign:'center', color:GR, padding:32 }}>No hay copropietarios registrados.</Card>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. EXPENSAS
// ══════════════════════════════════════════════════════════════════════════════
function Expensas({ session, consorcioId, unidades, copropietarios, adminPerfil }) {
  const [expensas, setExpensas] = useState([])
  const [selected, setSelected] = useState(null)
  const [detalles, setDetalles] = useState([])
  const [gastos, setGastos]     = useState([])
  const [form, setForm]         = useState(null)
  const [formGasto, setFormGasto] = useState(null)
  const [msg, setMsg]           = useState(null)
  const [tab, setTab]           = useState('detalle')
  const F = f => setForm(x=>({...x,...f}))

  async function cargar() {
    const { data } = await supabase.from('con_expensas').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .order('periodo', { ascending:false })
    setExpensas(data || [])
  }
  async function cargarDetalle(expId) {
    const [d,g] = await Promise.all([
      supabase.from('con_expensas_detalle').select('*').eq('expensa_id', expId).order('created_at'),
      supabase.from('con_gastos').select('*').eq('expensa_id', expId).order('fecha')
    ])
    setDetalles(d.data||[]); setGastos(g.data||[])
  }
  async function calcularYDistribuir(expensa) {
    if (!expensa || unidades.length===0) return
    setMsg({ tipo:'info', texto:'⏳ Calculando distribución...' })
    const totalGastos=gastos.reduce((a,g)=>a+Number(g.monto||0),0)
    const totalAdmin=Number(expensa.total_administracion||0)
    const totalExpensa=totalGastos+totalAdmin
    await supabase.from('con_expensas').update({ total_gastos:totalGastos, total_expensa:totalExpensa }).eq('id', expensa.id)
    const coefTotal=unidades.reduce((a,u)=>a+Number(u.porcentaje_fiscal||0),0)
    if (coefTotal===0) return setMsg({ tipo:'warn', texto:'Las UFs no tienen coeficiente asignado' })
    await supabase.from('con_expensas_detalle').delete().eq('expensa_id', expensa.id)
    const detallesNuevos=unidades.map(u=>{
      const coef=Number(u.porcentaje_fiscal||0)
      const monto=Math.round((totalExpensa*(coef/coefTotal))*100)/100
      return { id:`DET-${expensa.id}-${u.id}`, admin_id:session.user.id, expensa_id:expensa.id, unidad_id:u.id, consorcio_id:consorcioId, monto, estado:'pendiente', saldo_anterior:0, pagos_periodo:0 }
    })
    await supabase.from('con_expensas_detalle').insert(detallesNuevos)
    await cargarDetalle(expensa.id)
    setSelected({...expensa, total_gastos:totalGastos, total_expensa:totalExpensa})
    setMsg({ tipo:'ok', texto:`✓ Distribuido entre ${unidades.length} unidades. Total: ${fmt(totalExpensa)}` })
    cargar()
  }
  async function marcarPagada(det) {
    await supabase.from('con_expensas_detalle').update({ estado:'pagada', fecha_pago:new Date().toISOString().split('T')[0], pagos_periodo:det.monto }).eq('id', det.id)
    cargarDetalle(selected.id); setMsg({ tipo:'ok', texto:'✓ Marcado como pagado' })
  }
  async function guardarExpensa() {
    if (!form.periodo) return setMsg({ tipo:'warn', texto:'El período es obligatorio' })
    const id=form.id||nextId(expensas,'EXP')
    const { error }=await supabase.from('con_expensas').upsert({ ...form, id, admin_id:session.user.id, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Expensa guardada' }); cargar()
  }
  async function guardarGasto() {
    if (!formGasto.concepto||!formGasto.monto) return setMsg({ tipo:'warn', texto:'Concepto y monto obligatorios' })
    const g={...formGasto, admin_id:session.user.id, consorcio_id:consorcioId, expensa_id:selected.id}
    if (formGasto.id) await supabase.from('con_gastos').update(g).eq('id', formGasto.id)
    else await supabase.from('con_gastos').insert([{...g, id:nextId(gastos,'GAS')}])
    setFormGasto(null); cargarDetalle(selected.id); setMsg({ tipo:'ok', texto:'✓ Gasto registrado' })
  }
  async function generarPDF(expensa) {
    const { data:conData } = await supabase.from('con_consorcios').select('*').eq('id', consorcioId).single()
    generarPDFLiquidacion({ consorcioActivo:conData||{nombre:consorcioId}, expensa, gastos, detalles, unidades, copropietarios, adminPerfil })
  }
  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const CATEGORIAS=['limpieza','mantenimiento','seguro','seguros','honorarios','honorarios_admin','servicios_publicos','electricidad','gas','reparaciones','administracion','gastos_bancarios','impuesto_municipal','sueldos','cargas_sociales','otro']
  const periodoActual=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}

  if (selected) {
    const totalGasDet=gastos.reduce((a,g)=>a+Number(g.monto||0),0)
    const cobradas=detalles.filter(d=>d.estado==='pagada').length
    const pendientes=detalles.filter(d=>d.estado!=='pagada').length
    const morosas=detalles.filter(d=>d.estado==='morosa').length
    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
          <BtnSec onClick={() => { setSelected(null); setDetalles([]); setGastos([]) }}>← Volver</BtnSec>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:16 }}>Expensas {periodoLabel(selected.periodo)}</div>
            <div style={{ fontSize:12, color:GR }}>{selected.tipo} · Vto: {fmtD(selected.fecha_vencimiento)}</div>
          </div>
          <Btn onClick={() => calcularYDistribuir(selected)} color={AM}>⚡ Calcular y distribuir</Btn>
          <Btn onClick={() => generarPDF(selected)}>🖨 PDF liquidación</Btn>
        </div>
        <Msg data={msg} />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
          {[{l:'Total expensa',v:fmt(selected.total_expensa),c:AZ},{l:'Cobradas',v:cobradas,c:VD},{l:'Pendientes',v:pendientes,c:AM},{l:'Morosas',v:morosas,c:RJ}].map((k,i)=>(
            <Card key={i} style={{ textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:800, color:k.c }}>{k.v}</div>
              <div style={{ fontSize:11, color:GR, marginTop:4 }}>{k.l}</div>
            </Card>
          ))}
        </div>
        <div style={{ display:'flex', gap:4, marginBottom:16 }}>
          {['detalle','gastos'].map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{ padding:'7px 18px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, background:tab===t?AZ:'#f3f4f6', color:tab===t?'#fff':'#555', fontWeight:tab===t?'bold':'normal' }}>
              {t==='detalle'?'🏢 Por unidad':'💸 Gastos'}
            </button>
          ))}
        </div>
        {tab==='detalle' && (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['UF','Copropietario','Coef. %','Saldo ant.','Monto','Pagado','Estado','Acciones'].map((h,i)=>(
                    <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detalles.map(d=>{
                  const u=unidades.find(x=>x.id===d.unidad_id)
                  const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
                  const ec=d.estado==='pagada'?{c:VD,bg:'#dcfce7'}:d.estado==='morosa'?{c:RJ,bg:'#fee2e2'}:{c:AM,bg:'#fef9c3'}
                  return (
                    <tr key={d.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'10px 12px', fontWeight:700, color:AZ }}>{u?.numero||d.unidad_id}</td>
                      <td style={{ padding:'10px 12px' }}>{cp?.apellido_nombre||'—'}</td>
                      <td style={{ padding:'10px 12px' }}>{u?.porcentaje_fiscal?Number(u.porcentaje_fiscal).toFixed(4)+'%':'—'}</td>
                      <td style={{ padding:'10px 12px', color:parseFloat(d.saldo_anterior)>0?RJ:GR }}>{parseFloat(d.saldo_anterior)>0?fmt(d.saldo_anterior):'—'}</td>
                      <td style={{ padding:'10px 12px', fontWeight:700 }}>{fmt(d.monto)}</td>
                      <td style={{ padding:'10px 12px', color:VD }}>{parseFloat(d.pagos_periodo)>0?fmt(d.pagos_periodo):'—'}</td>
                      <td style={{ padding:'10px 12px' }}><Badge text={d.estado} color={ec.c} bg={ec.bg} /></td>
                      <td style={{ padding:'10px 12px' }}>
                        {d.estado!=='pagada' && (
                          <div style={{ display:'flex', gap:6 }}>
                            <Btn small color={VD} onClick={()=>marcarPagada(d)}>✓ Pagada</Btn>
                            <Btn small color={RJ} onClick={async()=>{await supabase.from('con_expensas_detalle').update({estado:'morosa'}).eq('id',d.id);cargarDetalle(selected.id)}}>⚠ Morosa</Btn>
                          </div>
                        )}
                        {d.estado==='pagada' && <Badge text="✓ Cobrada" color={VD} bg='#dcfce7' />}
                      </td>
                    </tr>
                  )
                })}
                {detalles.length===0 && <tr><td colSpan={8} style={{ padding:20, textAlign:'center', color:GR }}>Sin distribución. Hacé clic en "Calcular y distribuir".</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {tab==='gastos' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={{ fontWeight:600 }}>Total gastos: <span style={{ color:AZ, fontSize:16 }}>{fmt(totalGasDet)}</span></div>
              <Btn small onClick={()=>setFormGasto({fecha:new Date().toISOString().split('T')[0],categoria:'limpieza'})}>+ Agregar gasto</Btn>
            </div>
            {formGasto && (
              <Card style={{ marginBottom:14, border:`1px solid ${AZ}` }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
                  <Input label="Fecha" value={formGasto.fecha} onChange={v=>setFormGasto(x=>({...x,fecha:v}))} type="date" required />
                  <Input label="Concepto" value={formGasto.concepto} onChange={v=>setFormGasto(x=>({...x,concepto:v}))} required />
                  <Sel label="Categoría" value={formGasto.categoria} onChange={v=>setFormGasto(x=>({...x,categoria:v}))} opts={CATEGORIAS} />
                  <Input label="Monto $" value={formGasto.monto} onChange={v=>setFormGasto(x=>({...x,monto:v}))} type="number" required />
                  <Input label="Proveedor" value={formGasto.proveedor_nombre} onChange={v=>setFormGasto(x=>({...x,proveedor_nombre:v}))} />
                  <Input label="N° comprobante" value={formGasto.comprobante} onChange={v=>setFormGasto(x=>({...x,comprobante:v}))} />
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <Btn small onClick={guardarGasto}>Guardar</Btn>
                  <BtnSec small onClick={()=>setFormGasto(null)}>Cancelar</BtnSec>
                </div>
              </Card>
            )}
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['Fecha','Concepto','Categoría','Proveedor','Comprobante','Monto',''].map((h,i)=>(
                      <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gastos.map(g=>(
                    <tr key={g.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'9px 12px' }}>{fmtD(g.fecha)}</td>
                      <td style={{ padding:'9px 12px' }}>{g.concepto}</td>
                      <td style={{ padding:'9px 12px', textTransform:'capitalize' }}>{g.categoria||'—'}</td>
                      <td style={{ padding:'9px 12px' }}>{g.proveedor_nombre||'—'}</td>
                      <td style={{ padding:'9px 12px', color:GR }}>{g.comprobante||'—'}</td>
                      <td style={{ padding:'9px 12px', fontWeight:700 }}>{fmt(g.monto)}</td>
                      <td style={{ padding:'9px 12px' }}><Btn small onClick={()=>setFormGasto({...g})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn></td>
                    </tr>
                  ))}
                  {gastos.length===0 && <tr><td colSpan={7} style={{ padding:20, textAlign:'center', color:GR }}>Sin gastos registrados.</td></tr>}
                  {gastos.length>0 && <tr style={{ background:'#f3f4f6', fontWeight:700 }}><td colSpan={5} style={{ padding:'9px 12px' }}>+ Honorarios administración</td><td colSpan={2} style={{ padding:'9px 12px' }}>{fmt(selected.total_administracion)}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Expensas ({expensas.length})</div>
        <Btn onClick={()=>setForm({periodo:periodoActual(),tipo:'ordinaria',total_administracion:0,estado:'abierta'})}>+ Nuevo período</Btn>
      </div>
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>Nuevo período de expensas</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Input label="Período (YYYY-MM)" value={form.periodo} onChange={v=>F({periodo:v})} placeholder="2026-05" required />
            <Sel label="Tipo" value={form.tipo} onChange={v=>F({tipo:v})} opts={['ordinaria','extraordinaria']} />
            <Input label="Vencimiento" value={form.fecha_vencimiento} onChange={v=>F({fecha_vencimiento:v})} type="date" />
            <Input label="Honorarios admin. $" value={form.total_administracion} onChange={v=>F({total_administracion:v})} type="number" />
            <div style={{ gridColumn:'span 4' }}><Input label="Descripción / observaciones" value={form.descripcion} onChange={v=>F({descripcion:v})} /></div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardarExpensa}>💾 Crear período</Btn>
            <BtnSec onClick={()=>setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {expensas.map(exp=>{
          const ec=exp.estado==='cobrada'?{c:VD,bg:'#dcfce7'}:exp.estado==='cerrada'?{c:GR,bg:'#f3f4f6'}:{c:AM,bg:'#fef9c3'}
          return (
            <Card key={exp.id} style={{ cursor:'pointer' }} onClick={async()=>{setSelected(exp);await cargarDetalle(exp.id)}}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                    <span style={{ fontWeight:700, fontSize:15 }}>{periodoLabel(exp.periodo)}</span>
                    <Badge text={exp.tipo} color={exp.tipo==='extraordinaria'?RJ:AZ} />
                    <Badge text={exp.estado} color={ec.c} bg={ec.bg} />
                  </div>
                  <div style={{ fontSize:12, color:GR, display:'flex', gap:16 }}>
                    {exp.fecha_vencimiento && <span>📅 Vto: {fmtD(exp.fecha_vencimiento)}</span>}
                    {exp.total_expensa>0 && <span>💰 Total: {fmt(exp.total_expensa)}</span>}
                    {exp.descripcion && <span>{exp.descripcion}</span>}
                  </div>
                </div>
                <span style={{ color:GR, fontSize:20 }}>›</span>
              </div>
            </Card>
          )
        })}
        {expensas.length===0 && <Card style={{ textAlign:'center', color:GR, padding:32 }}><div style={{ fontSize:32, marginBottom:8 }}>📋</div><div>No hay períodos de expensas. Creá el primero.</div></Card>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. COBRANZAS (MÓDULO NUEVO)
// ══════════════════════════════════════════════════════════════════════════════
function Cobranzas({ session, consorcioId, unidades, copropietarios, adminPerfil }) {
  const [expensas, setExpensas]         = useState([])
  const [expSel, setExpSel]             = useState(null)
  const [detalles, setDetalles]         = useState([])
  const [cobranzas, setCobranzas]       = useState([])
  const [consorcio, setConsorcio]       = useState(null)
  const [form, setForm]                 = useState(null)
  const [tabMora, setTabMora]           = useState(false)
  const [previewMora, setPreviewMora]   = useState([])
  const [calculandoMora, setCalculandoMora] = useState(false)
  const [aplicandoMora, setAplicandoMora]   = useState(false)
  const [msg, setMsg]                   = useState(null)

  async function cargarExpensas() {
    const [expRes, conRes] = await Promise.all([
      supabase.from('con_expensas').select('*')
        .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
        .order('periodo', { ascending: false }),
      supabase.from('con_consorcios').select('*').eq('id', consorcioId).single()
    ])
    setExpensas(expRes.data || [])
    setConsorcio(conRes.data || null)
    if (expRes.data?.length > 0) seleccionarExpensa(expRes.data[0])
  }

  async function seleccionarExpensa(exp) {
    setExpSel(exp); setPreviewMora([]); setTabMora(false)
    const [d, c] = await Promise.all([
      supabase.from('con_expensas_detalle').select('*').eq('expensa_id', exp.id).order('created_at'),
      supabase.from('con_cobranzas').select('*').eq('expensa_id', exp.id).order('fecha', { ascending: false })
    ])
    setDetalles(d.data || []); setCobranzas(c.data || [])
  }

  async function registrarPago() {
    if (!form?.unidad_id || !form?.monto || !form?.fecha)
      return setMsg({ tipo:'warn', texto:'Unidad, fecha y monto son obligatorios' })
    const monto = parseFloat(form.monto)
    const { error } = await supabase.from('con_cobranzas').insert([{
      id: 'COB-' + Date.now(),
      admin_id: session.user.id, consorcio_id: consorcioId, expensa_id: expSel.id,
      unidad_id: form.unidad_id, fecha: form.fecha, monto,
      medio_pago: form.medio_pago || 'transferencia',
      recibo_numero: form.recibo_numero || '',
      observaciones: form.observaciones || ''
    }])
    if (error) return setMsg({ tipo:'error', texto: error.message })
    const det = detalles.find(d => d.unidad_id === form.unidad_id)
    if (det) {
      const nuevoPago = (parseFloat(det.pagos_periodo) || 0) + monto
      const deudaTotal = (parseFloat(det.saldo_anterior)||0) + (parseFloat(det.monto)||0) + (parseFloat(det.interes_mora)||0)
      const estado = nuevoPago >= deudaTotal ? 'pagada' : 'pendiente'
      await supabase.from('con_expensas_detalle')
        .update({ pagos_periodo: nuevoPago, estado, fecha_pago: estado==='pagada' ? form.fecha : null })
        .eq('id', det.id)
    }
    setForm(null)
    setMsg({ tipo:'ok', texto: `✓ Pago de ${fmt(monto)} registrado` })
    seleccionarExpensa(expSel)
  }

  async function eliminarCobranza(cob) {
    if (!confirm('¿Eliminar este pago?')) return
    await supabase.from('con_cobranzas').delete().eq('id', cob.id)
    const det = detalles.find(d => d.unidad_id === cob.unidad_id)
    if (det) {
      const nuevoPago = Math.max(0, (parseFloat(det.pagos_periodo)||0) - parseFloat(cob.monto))
      await supabase.from('con_expensas_detalle')
        .update({ pagos_periodo: nuevoPago, estado: nuevoPago > 0 ? 'pagada' : 'pendiente' })
        .eq('id', det.id)
    }
    seleccionarExpensa(expSel)
  }

  async function previsualizarMora() {
    if (!expSel) return
    setCalculandoMora(true); setTabMora(true)
    try {
      const { data, error } = await supabase.rpc('calcular_mora_expensa', { p_expensa_id: expSel.id })
      if (error) throw error
      const enriquecido = (data || []).map(row => {
        const u  = unidades.find(x => x.id === row.unidad_id) || {}
        const cp = copropietarios.find(c => c.id === u.propietario_id) || {}
        return { ...row, numero_uf: u.numero || row.unidad_id, propietario: cp.apellido_nombre || '—' }
      })
      setPreviewMora(enriquecido)
      if (enriquecido.length === 0) setMsg({ tipo:'info', texto:'No hay unidades con deuda vencida para calcular mora.' })
    } catch (e) {
      setMsg({ tipo:'error', texto: 'Error calculando mora: ' + e.message })
    }
    setCalculandoMora(false)
  }

  async function aplicarMora() {
    if (previewMora.length === 0) return
    if (!confirm(`¿Aplicar interés por mora a ${previewMora.length} unidad/es?`)) return
    setAplicandoMora(true)
    let ok = 0
    for (const row of previewMora) {
      if (parseFloat(row.monto_interes) <= 0) continue
      await supabase.from('con_expensas_detalle')
        .update({ interes_mora: row.nueva_mora_acum })
        .eq('expensa_id', expSel.id).eq('unidad_id', row.unidad_id)
      await supabase.from('con_mora_log').insert([{
        id: `MORA-${expSel.id}-${row.unidad_id}-${Date.now()}`,
        admin_id: session.user.id, consorcio_id: consorcioId,
        expensa_id: expSel.id, unidad_id: row.unidad_id,
        periodo: expSel.periodo, deuda_base: row.deuda_base,
        porcentaje: row.porcentaje_mora, monto_interes: row.monto_interes,
        dias_mora: row.dias_mora, fecha_calculo: new Date().toISOString().split('T')[0]
      }])
      ok++
    }
    setMsg({ tipo:'ok', texto: `✓ Mora aplicada a ${ok} unidad/es` })
    setPreviewMora([]); setTabMora(false)
    seleccionarExpensa(expSel)
    setAplicandoMora(false)
  }

  async function generarPDF() {
    if (!expSel) return
    const { data: gasData } = await supabase.from('con_gastos')
      .select('*').eq('expensa_id', expSel.id).order('fecha')
    generarPDFLiquidacion({
      consorcioActivo: consorcio || { nombre: consorcioId },
      expensa: expSel,
      gastos: gasData || [],
      detalles,
      unidades,
      copropietarios,
      adminPerfil: adminPerfil || {}
    })
  }

  async function cerrarPeriodo() {
    if (!expSel || !confirm(`¿Cerrar ${periodoLabel(expSel.periodo)}? Se trasladarán los saldos pendientes al período siguiente.`)) return
    await supabase.from('con_expensas').update({ estado: 'cerrada' }).eq('id', expSel.id)
    const siguiente = expensas.find(e => e.periodo > expSel.periodo)
    if (siguiente) {
      for (const det of detalles) {
        const salAnt = (parseFloat(det.saldo_anterior)||0) + (parseFloat(det.monto)||0)
          + (parseFloat(det.interes_mora)||0) - (parseFloat(det.pagos_periodo)||0)
        if (salAnt > 0) {
          const { data: detSig } = await supabase.from('con_expensas_detalle')
            .select('id').eq('expensa_id', siguiente.id).eq('unidad_id', det.unidad_id).single()
          if (detSig) await supabase.from('con_expensas_detalle')
            .update({ saldo_anterior: salAnt }).eq('id', detSig.id)
        }
      }
      setMsg({ tipo:'ok', texto: `✓ Período cerrado. Saldos trasladados a ${periodoLabel(siguiente.periodo)}` })
    } else {
      setMsg({ tipo:'ok', texto: '✓ Período cerrado.' })
    }
    cargarExpensas()
  }

  useEffect(() => { if (consorcioId) cargarExpensas() }, [consorcioId])

  const MEDIOS = ['transferencia','efectivo','debito','cheque','otro']
  const totalCobrado   = cobranzas.reduce((a, c) => a + parseFloat(c.monto||0), 0)
  const totalPendiente = detalles.filter(d => d.estado !== 'pagada').reduce((a, d) => {
    const s = (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0) + (parseFloat(d.interes_mora)||0) - (parseFloat(d.pagos_periodo)||0)
    return a + Math.max(0, s)
  }, 0)
  const totalMora = detalles.reduce((a, d) => a + (parseFloat(d.interes_mora)||0), 0)

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15 }}>💳 Cobranzas</div>
          <div style={{ fontSize:12, color:GR }}>
            Registro de pagos · Interés mora: {consorcio?.interes_mora || 0}% mensual
          </div>
        </div>
        {expSel && (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <Btn small color={VD}
              onClick={() => setForm({ fecha: new Date().toISOString().split('T')[0], medio_pago:'transferencia' })}>
              + Registrar pago
            </Btn>
            <Btn small color={AM} onClick={previsualizarMora}>
              {calculandoMora ? '⏳ Calculando...' : '📐 Calcular mora'}
            </Btn>
            <Btn small color={AZ} onClick={generarPDF}>
              🖨 PDF liquidación
            </Btn>
            {expSel.estado !== 'cerrada' && (
              <Btn small color={GR} onClick={cerrarPeriodo}>🔒 Cerrar período</Btn>
            )}
          </div>
        )}
      </div>

      <Msg data={msg} />

      {/* Selector de período */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        {expensas.map(e => {
          const activo = expSel?.id === e.id
          const ec = e.estado==='cerrada'?{c:GR,bg:'#f3f4f6'}:e.estado==='cobrada'?{c:VD,bg:'#dcfce7'}:{c:AM,bg:'#fef9c3'}
          return (
            <button key={e.id} onClick={() => seleccionarExpensa(e)}
              style={{ padding:'6px 14px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13,
                background:activo?AZ:'#f3f4f6', color:activo?'#fff':'#374151', fontWeight:activo?700:400 }}>
              {periodoLabel(e.periodo)}
              <span style={{ marginLeft:6, fontSize:10, padding:'1px 6px', borderRadius:8,
                background:activo?'rgba(255,255,255,0.2)':ec.bg, color:activo?'#fff':ec.c, fontWeight:700 }}>
                {e.estado}
              </span>
            </button>
          )
        })}
        {expensas.length === 0 && (
          <div style={{ color:GR, fontSize:13 }}>No hay períodos de expensas. Ir a Expensas para crear uno.</div>
        )}
      </div>

      {expSel && (
        <>
          {/* KPIs */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:16 }}>
            {[
              { l:'Total expensa',   v:fmt(expSel.total_expensa), c:AZ },
              { l:'Cobrado',         v:fmt(totalCobrado),         c:VD },
              { l:'Pendiente',       v:fmt(totalPendiente),       c:RJ },
              { l:'Mora acumulada',  v:fmt(totalMora),            c:AM },
            ].map((k,i) => (
              <Card key={i} style={{ textAlign:'center' }}>
                <div style={{ fontSize:18, fontWeight:800, color:k.c }}>{k.v}</div>
                <div style={{ fontSize:11, color:GR, marginTop:4 }}>{k.l}</div>
              </Card>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display:'flex', gap:4, marginBottom:14 }}>
            {[{id:false,label:'🏢 Estado por unidad'},{id:true,label:'📐 Interés por mora'}].map(t => (
              <button key={String(t.id)} onClick={() => setTabMora(t.id)}
                style={{ padding:'7px 18px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13,
                  background:tabMora===t.id?AZ:'#f3f4f6', color:tabMora===t.id?'#fff':'#555',
                  fontWeight:tabMora===t.id?'bold':'normal' }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Formulario nuevo pago */}
          {form && !tabMora && (
            <Card style={{ marginBottom:14, border:`1px solid ${VD}` }}>
              <div style={{ fontWeight:700, color:VD, marginBottom:12 }}>Registrar pago</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
                <div>
                  <div style={{ fontSize:12, color:'#6b7280', marginBottom:4, fontWeight:500 }}>
                    Unidad <span style={{color:RJ}}>*</span>
                  </div>
                  <select value={form.unidad_id||''} onChange={e => setForm(x=>({...x,unidad_id:e.target.value}))}
                    style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
                    <option value=''>— Seleccionar UF —</option>
                    {detalles.map(d => {
                      const u  = unidades.find(x=>x.id===d.unidad_id)
                      const cp = u ? copropietarios.find(c=>c.id===u.propietario_id) : null
                      const saldo = Math.max(0,
                        (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0) +
                        (parseFloat(d.interes_mora)||0) - (parseFloat(d.pagos_periodo)||0))
                      return (
                        <option key={d.unidad_id} value={d.unidad_id}>
                          {u?.numero||d.unidad_id} — {cp?.apellido_nombre||'Sin propietario'} (Saldo: {fmt(saldo)})
                        </option>
                      )
                    })}
                  </select>
                </div>
                <Input label="Fecha *" value={form.fecha} onChange={v=>setForm(x=>({...x,fecha:v}))} type="date" required />
                <Input label="Monto $ *" value={form.monto} onChange={v=>setForm(x=>({...x,monto:v}))} type="number" required />
                <Sel label="Medio de pago" value={form.medio_pago} onChange={v=>setForm(x=>({...x,medio_pago:v}))} opts={MEDIOS} />
                <Input label="N° recibo" value={form.recibo_numero} onChange={v=>setForm(x=>({...x,recibo_numero:v}))} />
                <Input label="Observaciones" value={form.observaciones} onChange={v=>setForm(x=>({...x,observaciones:v}))} />
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn small color={VD} onClick={registrarPago}>💾 Guardar pago</Btn>
                <BtnSec small onClick={() => setForm(null)}>Cancelar</BtnSec>
              </div>
            </Card>
          )}

          {/* ── TAB: ESTADO POR UNIDAD ── */}
          {!tabMora && (
            <>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:8 }}>
                Estado por unidad — {periodoLabel(expSel.periodo)}
              </div>
              <div style={{ overflowX:'auto', marginBottom:20 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead>
                    <tr style={{ background:'#f3f4f6' }}>
                      {['UF','Copropietario','Saldo ant.','Expensa','Mora','Pagado','Saldo total','Estado',''].map((h,i) => (
                        <th key={i} style={{ padding:'7px 10px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detalles.map(d => {
                      const u    = unidades.find(x=>x.id===d.unidad_id)
                      const cp   = u ? copropietarios.find(c=>c.id===u.propietario_id) : null
                      const pagado  = parseFloat(d.pagos_periodo) || 0
                      const salAnt  = parseFloat(d.saldo_anterior) || 0
                      const monto   = parseFloat(d.monto) || 0
                      const mora    = parseFloat(d.interes_mora) || 0
                      const saldo   = Math.max(0, salAnt + monto + mora - pagado)
                      const ec = d.estado==='pagada'
                        ? {c:VD,bg:'#dcfce7'}
                        : saldo>0 ? {c:RJ,bg:'#fee2e2'} : {c:AM,bg:'#fef9c3'}
                      return (
                        <tr key={d.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                          <td style={{ padding:'8px 10px', fontWeight:700, color:AZ }}>{u?.numero||d.unidad_id}</td>
                          <td style={{ padding:'8px 10px' }}>{cp?.apellido_nombre||'—'}</td>
                          <td style={{ padding:'8px 10px', color:salAnt>0?RJ:GR }}>{salAnt>0?fmt(salAnt):'—'}</td>
                          <td style={{ padding:'8px 10px', fontWeight:600 }}>{fmt(monto)}</td>
                          <td style={{ padding:'8px 10px', color:mora>0?AM:GR, fontWeight:mora>0?600:400 }}>{mora>0?fmt(mora):'—'}</td>
                          <td style={{ padding:'8px 10px', color:VD, fontWeight:600 }}>{pagado>0?fmt(pagado):'—'}</td>
                          <td style={{ padding:'8px 10px', fontWeight:700, color:saldo>0?RJ:VD }}>{fmt(saldo)}</td>
                          <td style={{ padding:'8px 10px' }}><Badge text={d.estado} color={ec.c} bg={ec.bg} /></td>
                          <td style={{ padding:'8px 10px' }}>
                            {d.estado !== 'pagada' && (
                              <Btn small color={VD} onClick={() => setForm({
                                fecha: new Date().toISOString().split('T')[0],
                                medio_pago: 'transferencia',
                                unidad_id: d.unidad_id,
                                monto: saldo
                              })}>💳 Cobrar</Btn>
                            )}
                            {d.estado === 'pagada' && <Badge text="✓ Cobrado" color={VD} bg='#dcfce7' />}
                          </td>
                        </tr>
                      )
                    })}
                    {detalles.length === 0 && (
                      <tr><td colSpan={9} style={{ padding:20, textAlign:'center', color:GR }}>
                        Sin distribución. Ir a Expensas → Calcular y distribuir.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Historial de pagos */}
              {cobranzas.length > 0 && (
                <>
                  <div style={{ fontWeight:600, fontSize:13, marginBottom:8 }}>
                    Pagos registrados — {periodoLabel(expSel.periodo)}
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                      <thead>
                        <tr style={{ background:'#f3f4f6' }}>
                          {['Fecha','UF','Copropietario','Medio','Monto','Recibo',''].map((h,i) => (
                            <th key={i} style={{ padding:'7px 10px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cobranzas.map(c => {
                          const u  = unidades.find(x=>x.id===c.unidad_id)
                          const cp = u ? copropietarios.find(x=>x.id===u.propietario_id) : null
                          return (
                            <tr key={c.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                              <td style={{ padding:'8px 10px' }}>{fmtD(c.fecha)}</td>
                              <td style={{ padding:'8px 10px', fontWeight:700, color:AZ }}>{u?.numero||c.unidad_id}</td>
                              <td style={{ padding:'8px 10px' }}>{cp?.apellido_nombre||'—'}</td>
                              <td style={{ padding:'8px 10px', textTransform:'capitalize' }}>{c.medio_pago||'—'}</td>
                              <td style={{ padding:'8px 10px', fontWeight:700, color:VD }}>{fmt(c.monto)}</td>
                              <td style={{ padding:'8px 10px', color:GR }}>{c.recibo_numero||'—'}</td>
                              <td style={{ padding:'8px 10px' }}>
                                <Btn small onClick={() => eliminarCobranza(c)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
                              </td>
                            </tr>
                          )
                        })}
                        <tr style={{ background:'#f3f4f6', fontWeight:700 }}>
                          <td colSpan={4} style={{ padding:'8px 10px' }}>Total cobrado</td>
                          <td style={{ padding:'8px 10px', color:VD }}>{fmt(totalCobrado)}</td>
                          <td colSpan={2} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── TAB: INTERÉS POR MORA ── */}
          {tabMora && (
            <div>
              <Card style={{ marginBottom:14, background:'#fef9c3', border:'1px solid #f59e0b' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ fontSize:13, color:'#78350f' }}>
                    <strong>Tasa configurada:</strong> {consorcio?.interes_mora || 0}% mensual ·{' '}
                    <strong>Vencimiento:</strong> {fmtD(expSel.fecha_vencimiento)} ·{' '}
                    <strong>Días vencidos:</strong>{' '}
                    {expSel.fecha_vencimiento
                      ? Math.max(0, Math.floor((new Date() - new Date(expSel.fecha_vencimiento + 'T00:00:00')) / 86400000))
                      : '—'} días
                  </div>
                  <Btn small color={AM} onClick={previsualizarMora}>
                    {calculandoMora ? '⏳ Calculando...' : '🔄 Recalcular'}
                  </Btn>
                </div>
              </Card>

              {calculandoMora && (
                <div style={{ textAlign:'center', color:GR, padding:30 }}>Calculando intereses...</div>
              )}

              {!calculandoMora && previewMora.length > 0 && (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <div style={{ fontWeight:600, fontSize:13 }}>
                      {previewMora.length} unidad/es con mora a aplicar
                    </div>
                    <Btn color={RJ} onClick={aplicarMora} disabled={aplicandoMora}>
                      {aplicandoMora ? '⏳ Aplicando...' : '⚡ Aplicar mora a todas'}
                    </Btn>
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                      <thead>
                        <tr style={{ background:'#fef2f2' }}>
                          {['UF','Propietario','Deuda base','Días mora','Tasa %','Interés nuevo','Mora acumulada',''].map((h,i) => (
                            <th key={i} style={{ padding:'7px 10px', textAlign:'left', fontSize:11, fontWeight:'bold', color:RJ, textTransform:'uppercase', borderBottom:'1px solid #fecaca' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewMora.map((row, i) => (
                          <tr key={i} style={{ borderBottom:'1px solid #fff1f1' }}>
                            <td style={{ padding:'8px 10px', fontWeight:700, color:AZ }}>{row.numero_uf}</td>
                            <td style={{ padding:'8px 10px' }}>{row.propietario}</td>
                            <td style={{ padding:'8px 10px', fontWeight:600, color:RJ }}>{fmt(row.deuda_base)}</td>
                            <td style={{ padding:'8px 10px', textAlign:'center' }}>{row.dias_mora}</td>
                            <td style={{ padding:'8px 10px', textAlign:'center' }}>{row.porcentaje_mora}%</td>
                            <td style={{ padding:'8px 10px', fontWeight:700, color:AM }}>{fmt(row.monto_interes)}</td>
                            <td style={{ padding:'8px 10px', fontWeight:700, color:RJ }}>{fmt(row.nueva_mora_acum)}</td>
                            <td style={{ padding:'8px 10px' }}>
                              <Btn small color={RJ} onClick={async () => {
                                if (parseFloat(row.monto_interes) <= 0) return
                                await supabase.from('con_expensas_detalle')
                                  .update({ interes_mora: row.nueva_mora_acum })
                                  .eq('expensa_id', expSel.id).eq('unidad_id', row.unidad_id)
                                await supabase.from('con_mora_log').insert([{
                                  id: `MORA-${expSel.id}-${row.unidad_id}-${Date.now()}`,
                                  admin_id: session.user.id, consorcio_id: consorcioId,
                                  expensa_id: expSel.id, unidad_id: row.unidad_id,
                                  periodo: expSel.periodo, deuda_base: row.deuda_base,
                                  porcentaje: row.porcentaje_mora, monto_interes: row.monto_interes,
                                  dias_mora: row.dias_mora, fecha_calculo: new Date().toISOString().split('T')[0]
                                }])
                                setMsg({ tipo:'ok', texto: `✓ Mora aplicada a UF ${row.numero_uf}: ${fmt(row.monto_interes)}` })
                                await seleccionarExpensa(expSel)
                                await previsualizarMora()
                              }}>Aplicar</Btn>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop:12, padding:'10px 14px', background:'#fef2f2', borderRadius:8, fontSize:12, color:'#7f1d1d' }}>
                    <strong>Total mora a aplicar:</strong> {fmt(previewMora.reduce((a,r)=>a+parseFloat(r.monto_interes||0),0))} ·{' '}
                    <strong>Total mora acumulada:</strong> {fmt(previewMora.reduce((a,r)=>a+parseFloat(r.nueva_mora_acum||0),0))}
                  </div>
                </>
              )}

              {!calculandoMora && previewMora.length === 0 && (
                <Card style={{ textAlign:'center', color:GR, padding:32 }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>📐</div>
                  <div style={{ marginBottom:8 }}>
                    Hacé clic en <strong>"Calcular mora"</strong> para ver el interés correspondiente.
                  </div>
                  <div style={{ fontSize:12, color:AM }}>
                    Tasa: {consorcio?.interes_mora || 0}% mensual sobre deuda vencida.
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. MOROSOS
// ══════════════════════════════════════════════════════════════════════════════
function Morosos({ session, consorcioId, unidades, copropietarios }) {
  const [morosos, setMorosos] = useState([])
  const [loading, setLoading] = useState(true)

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('con_expensas_detalle')
      .select('*, con_expensas!inner(periodo,fecha_vencimiento)')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .in('estado', ['pendiente','morosa']).order('created_at', { ascending:false })
    setMorosos(data||[]); setLoading(false)
  }
  async function enviarWA(det) {
    const u=unidades.find(x=>x.id===det.unidad_id)
    const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
    if (!cp?.telefono) return alert('El copropietario no tiene teléfono registrado')
    const msg=encodeURIComponent(`Estimado/a ${cp.apellido_nombre}, le informamos que tiene pendiente el pago de expensas del período ${periodoLabel(det.con_expensas?.periodo)} por ${fmt(det.monto)}. Por favor regularice su situación. Gracias.`)
    window.open(`https://wa.me/549${cp.telefono.replace(/\D/g,'')}?text=${msg}`,'_blank')
  }
  useEffect(()=>{ if (consorcioId) cargar() },[consorcioId])
  const totalDeuda=morosos.reduce((a,d)=>a+Number(d.monto||0),0)

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:RJ }}>⚠ Morosos</div>
          <div style={{ fontSize:12, color:GR }}>{morosos.length} cuotas pendientes · Total: {fmt(totalDeuda)}</div>
        </div>
        <Btn color={RJ} onClick={async()=>{
          for (const d of morosos) {
            const u=unidades.find(x=>x.id===d.unidad_id)
            const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
            if (cp?.telefono) {
              const msg=encodeURIComponent(`Estimado/a ${cp.apellido_nombre}, tiene expensas pendientes por ${fmt(d.monto)} del período ${periodoLabel(d.con_expensas?.periodo)}. Por favor regularice.`)
              window.open(`https://wa.me/549${cp.telefono.replace(/\D/g,'')}?text=${msg}`,'_blank')
              await new Promise(r=>setTimeout(r,500))
            }
          }
        }}>📱 WA masivo ({morosos.filter(d=>{const u=unidades.find(x=>x.id===d.unidad_id);const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null;return !!cp?.telefono}).length})</Btn>
      </div>
      {loading ? <div style={{ textAlign:'center', color:GR, padding:40 }}>Cargando...</div> : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#fef2f2' }}>
                {['UF','Copropietario','Período','Monto','Estado','Contacto'].map((h,i)=>(
                  <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:RJ, textTransform:'uppercase', borderBottom:'1px solid #fecaca' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {morosos.map(d=>{
                const u=unidades.find(x=>x.id===d.unidad_id)
                const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
                return (
                  <tr key={d.id} style={{ borderBottom:'1px solid #fef2f2' }}>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:AZ }}>{u?.numero||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{cp?.apellido_nombre||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{periodoLabel(d.con_expensas?.periodo)}</td>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:RJ }}>{fmt(d.monto)}</td>
                    <td style={{ padding:'10px 12px' }}><Badge text={d.estado} color={d.estado==='morosa'?RJ:AM} /></td>
                    <td style={{ padding:'10px 12px' }}>
                      <div style={{ display:'flex', gap:6 }}>
                        {cp?.telefono && <Btn small color='#25d366' onClick={()=>enviarWA(d)}>📱 WA</Btn>}
                        {cp?.email && <Btn small color={AZ} onClick={()=>window.open(`mailto:${cp.email}`)}>✉ Email</Btn>}
                        {!cp?.telefono&&!cp?.email && <span style={{ color:GR, fontSize:11 }}>Sin contacto</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {morosos.length===0 && <tr><td colSpan={6} style={{ padding:32, textAlign:'center', color:VD, fontWeight:600 }}>✅ No hay morosos registrados</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. PROVEEDORES
// ══════════════════════════════════════════════════════════════════════════════
function Proveedores({ session, consorcioId }) {
  const [lista, setLista] = useState([])
  const [form, setForm]   = useState(null)
  const [msg, setMsg]     = useState(null)
  const F = f => setForm(x=>({...x,...f}))

  async function cargar() {
    const { data } = await supabase.from('con_proveedores').select('*').eq('admin_id',session.user.id).eq('consorcio_id',consorcioId).order('razon_social')
    setLista(data||[])
  }
  async function guardar() {
    if (!form.razon_social) return setMsg({ tipo:'warn', texto:'Razón social obligatoria' })
    const id=form.id||nextId(lista,'PRV')
    const { error }=await supabase.from('con_proveedores').upsert({ ...form, id, admin_id:session.user.id, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Guardado' }); cargar()
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar?')) return
    await supabase.from('con_proveedores').delete().eq('id',id); cargar()
  }
  useEffect(()=>{ if (consorcioId) cargar() },[consorcioId])
  const RUBROS=['limpieza','plomería','electricidad','gas','pintura','jardinería','ascensores','seguros','administración','otros']

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Proveedores ({lista.length})</div>
        <Btn onClick={()=>setForm({activo:true})}>+ Agregar</Btn>
      </div>
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{form.id?'Editar proveedor':'Nuevo proveedor'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Input label="Razón social" value={form.razon_social} onChange={v=>F({razon_social:v})} required />
            <Input label="CUIT" value={form.cuit} onChange={v=>F({cuit:v})} />
            <Sel label="Rubro" value={form.rubro} onChange={v=>F({rubro:v})} opts={[{v:'',l:'Seleccionar...'},...RUBROS]} />
            <Input label="Teléfono" value={form.telefono} onChange={v=>F({telefono:v})} />
            <Input label="Email" value={form.email} onChange={v=>F({email:v})} />
            <Input label="Dirección" value={form.direccion} onChange={v=>F({direccion:v})} />
            <div style={{ gridColumn:'span 3' }}><Input label="Notas" value={form.notas} onChange={v=>F({notas:v})} /></div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar</Btn>
            <BtnSec onClick={()=>setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {lista.map(p=>(
          <Card key={p.id}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:14 }}>{p.razon_social}</div>
                <div style={{ fontSize:11, color:GR, marginTop:3 }}>
                  {p.rubro && <Badge text={p.rubro} color={AZ} style={{ marginRight:6 }} />}
                  {p.cuit && `CUIT: ${p.cuit}`}
                </div>
                <div style={{ fontSize:12, color:GR, marginTop:4, display:'flex', gap:10 }}>
                  {p.telefono && <span>📱 {p.telefono}</span>}
                  {p.email && <span>✉ {p.email}</span>}
                </div>
              </div>
              <div style={{ display:'flex', gap:4 }}>
                <Btn small onClick={()=>setForm({...p})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                <Btn small onClick={()=>eliminar(p.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
              </div>
            </div>
          </Card>
        ))}
        {lista.length===0 && <Card style={{ textAlign:'center', color:GR, padding:32, gridColumn:'span 2' }}>Sin proveedores.</Card>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. LIBRO DE ACTAS
// ══════════════════════════════════════════════════════════════════════════════
function Actas({ session, consorcioId, copropietarios }) {
  const [actas, setActas]     = useState([])
  const [form, setForm]       = useState(null)
  const [msg, setMsg]         = useState(null)
  const F = f => setForm(x=>({...x,...f}))

  async function cargar() {
    const { data } = await supabase.from('con_actas').select('*').eq('admin_id',session.user.id).eq('consorcio_id',consorcioId).order('fecha',{ascending:false})
    setActas(data||[])
  }
  async function guardar() {
    if (!form.fecha) return setMsg({ tipo:'warn', texto:'Fecha obligatoria' })
    const id=form.id||nextId(actas,'ACT')
    const numero=form.numero||(actas.length>0?Math.max(...actas.map(a=>a.numero||0))+1:1)
    const { error }=await supabase.from('con_actas').upsert({ ...form, id, numero, admin_id:session.user.id, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Acta guardada' }); cargar()
  }
  function imprimirActa(acta) {
    const presentes=(acta.presentes||[]).map(id=>copropietarios.find(c=>c.id===id)?.apellido_nombre||id).join(', ')
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px}h1{font-size:18px;text-align:center;text-transform:uppercase;border-bottom:2px solid #000;padding-bottom:10px}h2{font-size:14px;text-transform:uppercase;margin-top:24px}.field{margin:10px 0;font-size:13px;line-height:1.8}.label{font-weight:bold}.firma{margin-top:60px;display:flex;justify-content:space-between}.firma-box{text-align:center;border-top:1px solid #000;padding-top:8px;width:200px;font-size:11px}</style></head><body><h1>Libro de Actas — Acta N° ${acta.numero}</h1><div class="field"><span class="label">Tipo:</span> ${acta.tipo?.replace(/_/g,' ')}</div><div class="field"><span class="label">Fecha:</span> ${fmtD(acta.fecha)} · Hora: ${acta.hora||'—'}</div><div class="field"><span class="label">Lugar:</span> ${acta.lugar||'—'}</div><div class="field"><span class="label">Quórum:</span> ${acta.quorum?acta.quorum+'%':'—'}</div><div class="field"><span class="label">Presentes:</span> ${presentes||'—'}</div><h2>Orden del día</h2><div style="white-space:pre-line;font-size:13px">${acta.orden_del_dia||'—'}</div><h2>Resoluciones adoptadas</h2><div style="white-space:pre-line;font-size:13px">${acta.resoluciones||'—'}</div>${acta.observaciones?`<h2>Observaciones</h2><div style="white-space:pre-line;font-size:13px">${acta.observaciones}</div>`:''}<div class="firma"><div class="firma-box">Presidente de la asamblea</div><div class="firma-box">Secretario</div><div class="firma-box">Administrador</div></div></body></html>`
    const win=window.open('','_blank'); win.document.write(html); win.document.close(); setTimeout(()=>win.print(),500)
  }
  useEffect(()=>{ if (consorcioId) cargar() },[consorcioId])
  const TIPOS=['asamblea_ordinaria','asamblea_extraordinaria','reunion_consejo']

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Libro de Actas ({actas.length})</div>
        <Btn onClick={()=>setForm({tipo:'asamblea_ordinaria',fecha:new Date().toISOString().split('T')[0],presentes:[]})}>+ Nueva acta</Btn>
      </div>
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{form.id?'Editar acta':'Nueva acta'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Sel label="Tipo" value={form.tipo} onChange={v=>F({tipo:v})} opts={TIPOS} />
            <Input label="Fecha" value={form.fecha} onChange={v=>F({fecha:v})} type="date" required />
            <Input label="Hora" value={form.hora} onChange={v=>F({hora:v})} placeholder="10:00" />
            <Input label="Lugar" value={form.lugar} onChange={v=>F({lugar:v})} placeholder="Salón, domicilio..." />
            <Input label="Quórum %" value={form.quorum} onChange={v=>F({quorum:v})} type="number" placeholder="67" />
            <div />
            <div style={{ gridColumn:'span 3' }}>
              <div style={{ fontSize:12, color:'#6b7280', marginBottom:6, fontWeight:500 }}>Presentes</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {copropietarios.map(cp=>(
                  <label key={cp.id} style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', fontSize:13 }}>
                    <input type="checkbox" checked={(form.presentes||[]).includes(cp.id)}
                      onChange={e=>F({presentes:e.target.checked?[...(form.presentes||[]),cp.id]:(form.presentes||[]).filter(x=>x!==cp.id)})} />
                    {cp.apellido_nombre}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ gridColumn:'span 3' }}>
              <div style={{ fontSize:12, color:'#6b7280', marginBottom:4, fontWeight:500 }}>Orden del día</div>
              <textarea value={form.orden_del_dia||''} onChange={e=>F({orden_del_dia:e.target.value})} rows={4}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
            </div>
            <div style={{ gridColumn:'span 3' }}>
              <div style={{ fontSize:12, color:'#6b7280', marginBottom:4, fontWeight:500 }}>Resoluciones adoptadas</div>
              <textarea value={form.resoluciones||''} onChange={e=>F({resoluciones:e.target.value})} rows={4}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
            </div>
            <div style={{ gridColumn:'span 3' }}><Input label="Observaciones" value={form.observaciones} onChange={v=>F({observaciones:v})} /></div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar acta</Btn>
            <BtnSec onClick={()=>setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {actas.map(a=>(
          <Card key={a.id}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontWeight:700 }}>Acta N° {a.numero}</span>
                  <Badge text={a.tipo?.replace(/_/g,' ')} color={AZ} />
                  {a.firmada && <Badge text="✓ Firmada" color={VD} bg='#dcfce7' />}
                </div>
                <div style={{ fontSize:12, color:GR, display:'flex', gap:14 }}>
                  <span>📅 {fmtD(a.fecha)}{a.hora?` · ${a.hora}`:''}</span>
                  {a.lugar && <span>📍 {a.lugar}</span>}
                  {a.presentes?.length>0 && <span>👥 {a.presentes.length} presentes</span>}
                </div>
                {a.resoluciones && <div style={{ fontSize:12, color:'#374151', marginTop:4, fontStyle:'italic' }}>{a.resoluciones.slice(0,120)}{a.resoluciones.length>120?'...':''}</div>}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <Btn small onClick={()=>imprimirActa(a)}>🖨 Imprimir</Btn>
                <Btn small onClick={()=>setForm({...a})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                <Btn small onClick={async()=>{await supabase.from('con_actas').update({firmada:!a.firmada}).eq('id',a.id);cargar()}} color={a.firmada?GR:VD}>{a.firmada?'Desfirmar':'✓ Firmar'}</Btn>
              </div>
            </div>
          </Card>
        ))}
        {actas.length===0 && <Card style={{ textAlign:'center', color:GR, padding:32 }}>Sin actas registradas.</Card>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. PERFIL ADMIN — con persistencia real en con_admin_perfil
// ══════════════════════════════════════════════════════════════════════════════
function PerfilAdmin({ session }) {
  const [perfil, setPerfil] = useState({ nombre:'', telefono:'', matricula_rpac:'', email:'', direccion:'', horario:'', cuit:'', situacion_fiscal:'Monotributo' })
  const [guardando, setGuardando] = useState(false)
  const [cargando, setCargando]   = useState(true)
  const [msg, setMsg]             = useState(null)

  useEffect(() => {
    async function cargar() {
      const { data } = await supabase.from('con_admin_perfil').select('*').eq('admin_id',session.user.id).single()
      if (data) setPerfil({...data, email:data.email||session.user.email||''})
      else setPerfil(p=>({...p, email:session.user.email||''}))
      setCargando(false)
    }
    cargar()
  }, [session])

  async function guardar() {
    setGuardando(true)
    const { error } = await supabase.from('con_admin_perfil').upsert({ admin_id:session.user.id, ...perfil, updated_at:new Date().toISOString() }, { onConflict:'admin_id' })
    if (error) setMsg({ tipo:'error', texto:error.message })
    else setMsg({ tipo:'ok', texto:'✓ Perfil guardado correctamente' })
    setGuardando(false)
  }
  const P = f => setPerfil(p=>({...p,...f}))
  if (cargando) return <div style={{ textAlign:'center', color:GR, padding:40 }}>Cargando...</div>

  return (
    <div style={{ maxWidth:560 }}>
      <div style={{ fontWeight:700, fontSize:16, color:'#111827', marginBottom:20 }}>⚙️ Mi perfil de administrador</div>
      <Msg data={msg} />
      <Card style={{ marginBottom:16 }}>
        <div style={{ fontWeight:600, color:AZ, marginBottom:14, fontSize:13 }}>Datos personales y profesionales</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
          <Input label="Nombre completo" value={perfil.nombre} onChange={v=>P({nombre:v})} placeholder="Javier García Pérez" />
          <Input label="Email" value={perfil.email} onChange={v=>P({email:v})} />
          <Input label="Teléfono" value={perfil.telefono} onChange={v=>P({telefono:v})} placeholder="02267 444034" />
          <Input label="Matrícula RPAC" value={perfil.matricula_rpac} onChange={v=>P({matricula_rpac:v})} placeholder="83" />
          <Input label="CUIT" value={perfil.cuit} onChange={v=>P({cuit:v})} placeholder="20186006802" />
          <Sel label="Situación fiscal" value={perfil.situacion_fiscal} onChange={v=>P({situacion_fiscal:v})} opts={['Monotributo','Responsable Inscripto','Exento']} />
          <div style={{ gridColumn:'span 2' }}><Input label="Dirección de oficina" value={perfil.direccion} onChange={v=>P({direccion:v})} placeholder="Lenguado 1313 - Local 3" /></div>
          <div style={{ gridColumn:'span 2' }}><Input label="Horario de atención" value={perfil.horario} onChange={v=>P({horario:v})} placeholder="Lunes a Sábados 9:00 a 13:00 hs" /></div>
        </div>
        <Btn onClick={guardar} disabled={guardando}>{guardando?'Guardando...':'💾 Guardar perfil'}</Btn>
      </Card>
      <Card>
        <div style={{ fontSize:13, color:'#6b7280', marginBottom:8, fontWeight:600 }}>Sesión activa</div>
        <div style={{ fontSize:13, color:'#374151', marginBottom:10 }}>{session?.user?.email}</div>
        <Btn color='#991B1B' small onClick={async()=>{ await supabase.auth.signOut() }}>Cerrar sesión</Btn>
      </Card>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession]             = useState(null)
  const [cargando, setCargando]           = useState(true)
  const [pagina, setPagina]               = useState('dashboard')
  const [menuAbierto, setMenuAbierto]     = useState(false)
  const [isMobile, setIsMobile]           = useState(false)
  const [consorcios, setConsorcios]       = useState([])
  const [consorcioActivo, setConsorcioActivo] = useState(null)
  const [unidades, setUnidades]           = useState([])
  const [copropietarios, setCopropietarios] = useState([])
  const [adminPerfil, setAdminPerfil]     = useState({})
  const [esSuperAdmin, setEsSuperAdmin]   = useState(false)
  const [email, setEmail]                 = useState('')
  const [pass, setPass]                   = useState('')
  const [loginLoading, setLoginLoading]   = useState(false)
  const [loginError, setLoginError]       = useState('')
  const [formCon, setFormCon]             = useState(null)
  const [msgCon, setMsgCon]               = useState(null)

  useEffect(() => {
    const check=()=>setIsMobile(window.innerWidth<769)
    check(); window.addEventListener('resize',check); return()=>window.removeEventListener('resize',check)
  },[])
  useEffect(()=>{ if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{}) },[])
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{
      setSession(data?.session||null)
      if (data?.session) cargar(true)
      else setCargando(false)
    })
  },[])

  async function cargar(inicial=false) {
    if (inicial) setCargando(true)
    try {
      const uid=(await supabase.auth.getUser()).data.user?.id
      if (!uid) { setCargando(false); return }
      const { data:cons }=await supabase.from('con_consorcios').select('*').eq('admin_id',uid).eq('activo',true).order('nombre')
      setConsorcios(cons||[])
      if (cons?.length>0&&!consorcioActivo) { setConsorcioActivo(cons[0]); await cargarConsorcio(cons[0].id,uid) }
      setEsSuperAdmin((await supabase.auth.getUser()).data.user?.email===SUPERADMIN)
      // Cargar perfil del administrador
      const { data:perfData }=await supabase.from('con_admin_perfil').select('*').eq('admin_id',uid).single()
      if (perfData) setAdminPerfil(perfData)
    } catch(e) { console.error(e) } finally { if (inicial) setCargando(false) }
  }
  async function cargarConsorcio(cid,uid) {
    const [u,cp]=await Promise.all([
      supabase.from('con_unidades').select('*').eq('admin_id',uid||session?.user?.id).eq('consorcio_id',cid).order('numero'),
      supabase.from('con_copropietarios').select('*').eq('admin_id',uid||session?.user?.id).eq('consorcio_id',cid).order('apellido_nombre')
    ])
    setUnidades(u.data||[]); setCopropietarios(cp.data||[])
  }
  async function login() {
    setLoginLoading(true); setLoginError('')
    const { error }=await supabase.auth.signInWithPassword({ email, password:pass })
    if (error) { setLoginError('Email o contraseña incorrectos'); setLoginLoading(false); return }
    const { data }=await supabase.auth.getSession()
    setSession(data?.session||null)
    if (data?.session) cargar(true)
    setLoginLoading(false)
  }
  async function logout() { await supabase.auth.signOut(); setSession(null) }

  async function guardarConsorcio() {
    if (!formCon?.nombre) return setMsgCon({ tipo:'warn', texto:'El nombre es obligatorio' })
    const uid=session.user.id
    if (formCon.id) {
      await supabase.from('con_consorcios').update(formCon).eq('id',formCon.id)
    } else {
      const id=nextId(consorcios,'CON')
      await supabase.from('con_consorcios').insert([{ ...formCon, id, admin_id:uid, activo:true }])
    }
    setFormCon(null); setMsgCon({ tipo:'ok', texto:'✓ Consorcio guardado' }); cargar()
  }

  const NAV=[
    { id:'dashboard',      label:'Dashboard',        icon:'📊', sec:'Principal' },
    { id:'unidades',       label:'Unidades (UFs)',    icon:'🏢', sec:'Gestión' },
    { id:'copropietarios', label:'Copropietarios',    icon:'👤', sec:'Gestión' },
    { id:'expensas',       label:'Expensas',          icon:'💰', sec:'Gestión' },
    { id:'cobranzas',      label:'Cobranzas',         icon:'💳', sec:'Gestión' },
    { id:'morosos',        label:'Morosos',           icon:'⚠️', sec:'Gestión' },
    { id:'proveedores',    label:'Proveedores',       icon:'🔧', sec:'Gestión' },
    { id:'actas',          label:'Libro de Actas',    icon:'📖', sec:'Gestión' },
    { id:'perfil',         label:'Mi perfil',         icon:'⚙️', sec:'Admin' },
    ...(esSuperAdmin?[{id:'clientes',label:'Clientes GASP',icon:'🏢',sec:'Admin'}]:[]),
  ]
  const secciones=[...new Set(NAV.map(n=>n.sec))]

  if (cargando) return <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', color:'#4a7abf', fontFamily:'Arial', fontSize:14 }}>Cargando GASP Consorcios...</div>

  if (!session) return (
    <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Arial' }}>
      <Head><title>GASP Consorcios</title></Head>
      <div style={{ background:'#fff', borderRadius:14, padding:36, width:340, boxShadow:'0 8px 40px #0006' }}>
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <div style={{ fontSize:20, fontWeight:800, color:AZ }}>GASP Consorcios</div>
          <div style={{ fontSize:12, color:GR }}>Sistema de Administración</div>
        </div>
        {loginError && <div style={{ background:'#fee2e2', color:RJ, borderRadius:7, padding:'9px 12px', fontSize:13, marginBottom:14 }}>{loginError}</div>}
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email"
          style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8, marginBottom:10, fontSize:14, boxSizing:'border-box' }} />
        <input value={pass} onChange={e=>setPass(e.target.value)} placeholder="Contraseña" type="password"
          onKeyDown={e=>e.key==='Enter'&&login()}
          style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8, marginBottom:16, fontSize:14, boxSizing:'border-box' }} />
        <Btn onClick={login} disabled={loginLoading} style={{ width:'100%', justifyContent:'center' }}>
          {loginLoading?'Ingresando...':'Ingresar'}
        </Btn>
      </div>
    </div>
  )

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD — componente independiente (fuera de App para evitar re-renders)
// ══════════════════════════════════════════════════════════════════════════════
function Dashboard({ consorcios, consorcioActivo, unidades, copropietarios,
  formCon, setFormCon, msgCon, guardarConsorcio, setConsorcioActivo,
  cargarConsorcio, setPagina }) {
  const totalUFs  = unidades.length
  const ocupadas  = unidades.filter(u => u.estado==='ocupada').length
  const coefTotal = unidades.reduce((a,u) => a + Number(u.porcentaje_fiscal||0), 0)
    return (
      <div>
        {consorcios.length>1 && (
          <div style={{ marginBottom:16, display:'flex', gap:10, alignItems:'center' }}>
            <span style={{ fontSize:13, color:GR, fontWeight:500, whiteSpace:'nowrap' }}>Consorcio:</span>
            <select
              value={consorcioActivo?.id||''}
              onChange={e => {
                const c = consorcios.find(x => x.id === e.target.value)
                if (c) { setConsorcioActivo(c); cargarConsorcio(c.id) }
              }}
              style={{ flex:1, padding:'7px 11px', borderRadius:8, border:'1px solid #d1d5db', fontSize:13, background:'#fff', cursor:'pointer' }}>
              {consorcios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <Btn small onClick={()=>setFormCon({})}>+ Nuevo</Btn>
          </div>
        )}
        {consorcios.length===0 && (
          <Card style={{ textAlign:'center', padding:40, marginBottom:20, border:`2px dashed ${AZ}` }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🏢</div>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>Bienvenido a GASP Consorcios</div>
            <div style={{ color:GR, fontSize:13, marginBottom:20 }}>Creá tu primer consorcio para comenzar</div>
            <Btn onClick={()=>setFormCon({})}>+ Crear primer consorcio</Btn>
          </Card>
        )}
        {formCon && (
          <Card style={{ marginBottom:20, border:`1px solid ${AZ}` }}>
            <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{formCon.id?'Editar consorcio':'Nuevo consorcio'}</div>
            {msgCon && <Msg data={msgCon} />}
            <div style={{ fontWeight:600, color:GR, fontSize:12, marginBottom:10, textTransform:'uppercase', letterSpacing:'0.5px' }}>Datos generales</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
              <Input label="Nombre del consorcio" value={formCon.nombre} onChange={v=>setFormCon(x=>({...x,nombre:v}))} required />
              <Input label="CUIT" value={formCon.cuit} onChange={v=>setFormCon(x=>({...x,cuit:v}))} placeholder="30-XXXXXXXX-X" />
              <Input label="Dirección" value={formCon.direccion} onChange={v=>setFormCon(x=>({...x,direccion:v}))} />
              <Input label="Localidad" value={formCon.localidad} onChange={v=>setFormCon(x=>({...x,localidad:v}))} />
              <Input label="Clave SUTERH" value={formCon.clave_suterh} onChange={v=>setFormCon(x=>({...x,clave_suterh:v}))} />
              <Input label="Interés mora mensual %" value={formCon.interes_mora} onChange={v=>setFormCon(x=>({...x,interes_mora:v}))} type="number" placeholder="5" />
            </div>
            <div style={{ fontWeight:600, color:GR, fontSize:12, marginBottom:10, textTransform:'uppercase', letterSpacing:'0.5px' }}>Datos bancarios</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
              <Input label="CBU" value={formCon.cbu} onChange={v=>setFormCon(x=>({...x,cbu:v}))} placeholder="28505909300941..." />
              <Input label="Alias CBU" value={formCon.alias_cbu} onChange={v=>setFormCon(x=>({...x,alias_cbu:v}))} placeholder="PALABRA.PALABRA.PALABRA" />
              <Input label="Banco" value={formCon.banco} onChange={v=>setFormCon(x=>({...x,banco:v}))} placeholder="Macro" />
              <Input label="Sucursal" value={formCon.sucursal} onChange={v=>setFormCon(x=>({...x,sucursal:v}))} placeholder="Pinamar" />
              <Input label="Nº de cuenta" value={formCon.nro_cuenta} onChange={v=>setFormCon(x=>({...x,nro_cuenta:v}))} />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <Btn onClick={guardarConsorcio}>{formCon.id?'💾 Actualizar':'Crear'}</Btn>
              <BtnSec onClick={()=>setFormCon(null)}>Cancelar</BtnSec>
            </div>
          </Card>
        )}
        {consorcioActivo && (
          <>
            <div style={{ background:`linear-gradient(135deg,${AZ} 0%,${AZ2} 100%)`, borderRadius:12, padding:24, marginBottom:20, color:'#fff' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <div style={{ fontSize:11, opacity:0.7, textTransform:'uppercase', letterSpacing:1 }}>Consorcio activo</div>
                  <div style={{ fontSize:22, fontWeight:800, marginTop:4 }}>{consorcioActivo.nombre}</div>
                  {consorcioActivo.direccion && <div style={{ fontSize:13, opacity:0.8, marginTop:2 }}>📍 {consorcioActivo.direccion}{consorcioActivo.localidad?`, ${consorcioActivo.localidad}`:''}</div>}
                  {consorcioActivo.cbu && <div style={{ fontSize:11, opacity:0.7, marginTop:4 }}>CBU: {consorcioActivo.cbu} · Alias: {consorcioActivo.alias_cbu}</div>}
                </div>
                <BtnSec small onClick={()=>setFormCon({...consorcioActivo})} style={{ background:'rgba(255,255,255,0.15)', color:'#fff', border:'1px solid rgba(255,255,255,0.3)' }}>✏ Editar</BtnSec>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:24 }}>
              {[{l:'Unidades',v:totalUFs,c:AZ,icon:'🏢',action:'unidades'},{l:'Ocupadas',v:ocupadas,c:VD,icon:'✅',action:'unidades'},{l:'Copropietarios',v:copropietarios.length,c:AM,icon:'👤',action:'copropietarios'},{l:'Coef. total',v:coefTotal.toFixed(2)+'%',c:'#6d28d9',icon:'📊',action:null}].map((k,i)=>(
                <Card key={i} style={{ textAlign:'center', cursor:k.action?'pointer':'default' }} onClick={()=>k.action&&setPagina(k.action)}>
                  <div style={{ fontSize:24, marginBottom:6 }}>{k.icon}</div>
                  <div style={{ fontSize:26, fontWeight:800, color:k.c }}>{k.v}</div>
                  <div style={{ fontSize:11, color:GR, marginTop:4 }}>{k.l}</div>
                </Card>
              ))}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              {[{id:'expensas',icon:'💰',label:'Gestionar Expensas',desc:'Crear período, calcular, cobrar'},{id:'cobranzas',icon:'💳',label:'Cobranzas',desc:'Registrar pagos por unidad'},{id:'morosos',icon:'⚠️',label:'Ver Morosos',desc:'Cuotas pendientes y contacto'},{id:'actas',icon:'📖',label:'Libro de Actas',desc:'Asambleas y reuniones'}].map(m=>(
                <Card key={m.id} style={{ cursor:'pointer' }} onClick={()=>setPagina(m.id)}>
                  <div style={{ fontSize:28, marginBottom:8 }}>{m.icon}</div>
                  <div style={{ fontWeight:700, fontSize:15 }}>{m.label}</div>
                  <div style={{ fontSize:12, color:GR, marginTop:4 }}>{m.desc}</div>
                </Card>
              ))}
            </div>
          </>
        )}
        {consorcios.length===1 && (
          <div style={{ marginTop:20, textAlign:'right' }}>
            <BtnSec small onClick={()=>setFormCon({})}>+ Agregar otro consorcio</BtnSec>
          </div>
        )}
      </div>
    )
}


  const cid=consorcioActivo?.id
  const renderPagina=()=>{
    if (!cid&&pagina!=='dashboard') return <Card style={{ textAlign:'center', padding:40, color:GR }}>Seleccioná un consorcio primero.</Card>
    switch(pagina) {
      case 'dashboard':      return <Dashboard consorcios={consorcios} consorcioActivo={consorcioActivo} unidades={unidades} copropietarios={copropietarios} formCon={formCon} setFormCon={setFormCon} msgCon={msgCon} guardarConsorcio={guardarConsorcio} setConsorcioActivo={setConsorcioActivo} cargarConsorcio={cargarConsorcio} setPagina={setPagina} />
      case 'unidades':       return <Unidades session={session} consorcioId={cid} copropietarios={copropietarios} />
      case 'copropietarios': return <Copropietarios session={session} consorcioId={cid} onUpdate={setCopropietarios} />
      case 'expensas':       return <Expensas session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} adminPerfil={adminPerfil} />
      case 'cobranzas':      return <Cobranzas session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} adminPerfil={adminPerfil} />
      case 'morosos':        return <Morosos session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} />
      case 'proveedores':    return <Proveedores session={session} consorcioId={cid} />
      case 'actas':          return <Actas session={session} consorcioId={cid} copropietarios={copropietarios} />
      case 'perfil':         return <PerfilAdmin session={session} />
      case 'clientes':       return <Card style={{ textAlign:'center', padding:40, color:GR }}><div style={{fontSize:32,marginBottom:12}}>🚧</div><div style={{fontWeight:600}}>Panel de clientes en desarrollo</div></Card>
      default:               return <Dashboard consorcios={consorcios} consorcioActivo={consorcioActivo} unidades={unidades} copropietarios={copropietarios} formCon={formCon} setFormCon={setFormCon} msgCon={msgCon} guardarConsorcio={guardarConsorcio} setConsorcioActivo={setConsorcioActivo} cargarConsorcio={cargarConsorcio} setPagina={setPagina} />
    }
  }

  return (
    <div style={{ minHeight:'100vh', fontFamily:'Segoe UI, Arial, sans-serif', background:'#f8fafc', position:'relative' }}>
      <Head><title>GASP Consorcios</title></Head>
      {menuAbierto&&isMobile && <div onClick={()=>setMenuAbierto(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:199 }} />}

      {/* SIDEBAR */}
      <aside style={{ width:220, background:BG, display:'flex', flexDirection:'column', position:'fixed', top:0, left:0, height:'100vh', zIndex:200, overflowY:'auto', transform:isMobile&&!menuAbierto?'translateX(-100%)':'translateX(0)', transition:'transform 0.25s ease' }}>
        <div style={{ padding:'14px 14px 12px', borderBottom:'1px solid #1a2540' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
            <div style={{ width:38, height:38, background:AZ, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:14, fontWeight:900, flexShrink:0 }}>G</div>
            <div>
              <div style={{ fontSize:18, fontWeight:800, color:'#fff', lineHeight:1 }}>GASP</div>
              <div style={{ fontSize:9, color:'#4a6a8a', letterSpacing:'0.1em' }}>CONSORCIOS</div>
            </div>
          </div>
          {consorcioActivo && <div style={{ fontSize:11, color:'#7ab4ff', marginTop:6, fontWeight:600, lineHeight:1.3 }}>{consorcioActivo.nombre}</div>}
        </div>
        <nav style={{ flex:1, padding:'10px 8px' }}>
          {secciones.map(sec=>(
            <div key={sec}>
              <div style={{ fontSize:9, color:'#3a5a7a', fontWeight:'bold', letterSpacing:'0.15em', textTransform:'uppercase', padding:'10px 10px 4px' }}>{sec}</div>
              {NAV.filter(n=>n.sec===sec).map(n=>(
                <div key={n.id} onClick={()=>{ setPagina(n.id); setMenuAbierto(false) }}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', cursor:'pointer', borderRadius:7, margin:'1px 0', background:pagina===n.id?'rgba(26,63,160,0.25)':'transparent', color:pagina===n.id?'#7aacff':'#8aaabf', fontWeight:pagina===n.id?'bold':'normal', fontSize:13, transition:'all 0.15s' }}>
                  <span style={{ fontSize:15, width:20, textAlign:'center', flexShrink:0 }}>{n.icon}</span>
                  <span style={{ flex:1 }}>{n.label}</span>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ padding:'12px 14px', borderTop:'1px solid #1a2540' }}>
          <div style={{ fontSize:11, color:'#4a6a8a', marginBottom:8 }}>{session.user.email}</div>
          <BtnSec small onClick={logout} style={{ width:'100%', justifyContent:'center', color:'#8aaabf', borderColor:'#1a2540', background:'transparent' }}>Cerrar sesión</BtnSec>
        </div>
      </aside>

      {/* MAIN */}
      <div style={{ marginLeft:isMobile?0:220, minHeight:'100vh' }}>
        <div style={{ height:52, background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', padding:'0 20px', gap:14, position:'sticky', top:0, zIndex:100 }}>
          {isMobile && <button onClick={()=>setMenuAbierto(v=>!v)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:22, color:'#374151', padding:'0 6px' }}>☰</button>}
          <div style={{ flex:1, fontWeight:700, color:'#111', fontSize:15 }}>
            {NAV.find(n=>n.id===pagina)?.icon} {NAV.find(n=>n.id===pagina)?.label||'Dashboard'}
          </div>
          {consorcioActivo && <div style={{ fontSize:12, color:GR, background:'#f3f4f6', padding:'4px 12px', borderRadius:20 }}>{consorcioActivo.nombre}</div>}
        </div>
        <div style={{ padding:isMobile?14:24, maxWidth:1100, margin:'0 auto' }}>
          {renderPagina()}
        </div>
      </div>

      {/* NAV MOBILE BOTTOM */}
      {isMobile && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, height:54, background:BG, borderTop:'1px solid #1a2540', display:'flex', zIndex:100 }}>
          {[{id:'dashboard',icon:'📊'},{id:'expensas',icon:'💰'},{id:'cobranzas',icon:'💳'},{id:'morosos',icon:'⚠️'},{id:'actas',icon:'📖'}].map(n=>(
            <button key={n.id} onClick={()=>setPagina(n.id)}
              style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:1, background:'none', border:'none', cursor:'pointer', padding:'6px 0', color:pagina===n.id?'#7aacff':'#4a6a8a', borderTop:pagina===n.id?`2px solid ${AZ}`:'2px solid transparent' }}>
              <span style={{ fontSize:18 }}>{n.icon}</span>
              <span style={{ fontSize:8, fontWeight:pagina===n.id?'bold':'normal' }}>{n.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
