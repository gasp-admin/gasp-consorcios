// lib/exportPdf.js
// ═══════════════════════════════════════════════════════════════════
// Exportación a PDF para GASP Consorcios.
// Contiene exportarPDF() y generarPDFLiquidacion() extraídos del V59.
// ═══════════════════════════════════════════════════════════════════

export function exportarPDF({ titulo, subtitulo, columnas, filas, totales, consorcioNombre, logoB64 }) {
  const fmtN = n => (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2 })
  const logo = logoB64 ? `<img src="${logoB64}" style="height:48px;width:auto;object-fit:contain"/>` : ''
  const encHTML = columnas.map(c=>`<th style="padding:4px 7px;background:#2e4057;color:#fff;font-size:8pt;white-space:nowrap;text-align:${c.align||'left'}">${c.label}</th>`).join('')
  const filasHTML = filas.map((f,i)=>`<tr style="background:${i%2===0?'#fff':'#f4f8fc'};border-bottom:1px solid #e0e8f0">${
    columnas.map(c=>`<td style="padding:3px 7px;font-size:8pt;text-align:${c.align||'left'};white-space:${c.nowrap?'nowrap':'normal'}">${f[c.key]??'—'}</td>`).join('')
  }</tr>`).join('')
  const totalesHTML = totales ? `<tr style="background:#0d2b3e;color:#fff;font-weight:700">${
    columnas.map(c=>`<td style="padding:4px 7px;font-size:8pt;text-align:${c.align||'left'}">${totales[c.key]??''}</td>`).join('')
  }</tr>` : ''
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9pt;color:#111}
    .page{width:210mm;padding:10mm 11mm 8mm}
    @page{size:A4 portrait;margin:0}@media print{body{margin:0}.no-print{display:none!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
    .hdr{display:flex;align-items:center;gap:12px;border-bottom:3px solid #1A3FA0;padding-bottom:6px;margin-bottom:10px}
    table{width:100%;border-collapse:collapse}
    .footer{margin-top:10px;border-top:1px solid #ccc;padding-top:3px;font-size:6.5pt;color:#666;display:flex;justify-content:space-between}
    .btn-imp{display:block;margin:10px auto;padding:8px 22px;background:#1A3FA0;color:#fff;border:none;border-radius:5px;font-size:13px;cursor:pointer}
  </style></head><body>
  <button class="btn-imp no-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
  <div class="page">
    <div class="hdr">
      ${logo}
      <div style="flex:1">
        <div style="font-size:12pt;font-weight:700;color:#1A3FA0">${titulo}</div>
        ${subtitulo?`<div style="font-size:9pt;color:#374151">${subtitulo}</div>`:''}
        ${consorcioNombre?`<div style="font-size:8.5pt;color:#6b7280">Consorcio: ${consorcioNombre}</div>`:''}
        <div style="font-size:8pt;color:#9ca3af">Generado: ${new Date().toLocaleDateString('es-AR')} — Administración de Consorcios Pinamar — R.P.A.C. N° 83</div>
      </div>
    </div>
    <table><thead><tr>${encHTML}</tr></thead><tbody>${filasHTML}</tbody>${totalesHTML?`<tfoot>${totalesHTML}</tfoot>`:''}</table>
    <div class="footer"><span>${titulo}</span><span>R.P.A.C. N°83 | Administración Pinamar</span><span>${new Date().toLocaleDateString('es-AR')}</span></div>
  </div></body></html>`
  const blob = new Blob([html], { type:'text/html;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  window.open(url, '_blank', 'width=950,height=700')
  setTimeout(()=>URL.revokeObjectURL(url), 60000)
}


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
  gastos_bancarios:9, impuesto_municipal:10, municipalidad:10, cargas_sociales:2, vep_931:2,
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


export function generarPDFLiquidacion({ consorcioActivo, expensa, gastos, detalles, unidades, copropietarios, adminPerfil }) {
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
