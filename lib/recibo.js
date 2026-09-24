// lib/recibo.js
// Recibo de pago de expensas — contenido obligatorio del art. 12 Ley 14.701 (PBA).
// FUENTE ÚNICA: lo usan el sistema (modules/cobranzas/ReciboPago.jsx) y el Portal (pages/portal.jsx).
// No calcula saldos: el estado de deuda (inc. h) lo recibe ya resuelto desde get-cuenta-corriente.
//
// Art. 12 — a) denominación y domicilio del consorcio · b) piso/dpto/UF · c) propietario
//           d) mes/período/concepto · e) vencimiento con su interés · f) datos del administrador,
//           firma y aclaración, CUIT y N° de inscripción · g) lugar y formas de pago
//           h) detalle de deuda a la fecha o "Sin deuda a la fecha". Numerados.

import { LOGO_ADM_B64 } from './logo'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const esc  = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]))
const trim = s => String(s ?? '').trim()
const fmtM = n => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtF = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const pct  = v => { const n = parseFloat(v) || 0; return (Number.isInteger(n) ? n : n.toFixed(2)).toString().replace('.', ',') + ' %' }

export function periodoTexto(p) {
  if (!p) return '—'
  const [y, m] = String(p).split('-')
  return m ? `${MESES[parseInt(m, 10) - 1] || m} ${y}` : String(p)
}

// Numeración: se conserva el criterio vigente (A2 — numeración correlativa — pendiente de definición).
export function numeroRecibo(cob) {
  return trim(cob?.nro_recibo) || trim(cob?.recibo_numero) || String(cob?.id || '').slice(-8).toUpperCase()
}

// Saldo de la cuenta corriente (respuesta de get-cuenta-corriente). Positivo = deuda.
export function saldoDesdeCtaCte(data) {
  if (!data) return null
  if (data.saldo_total !== undefined && data.saldo_total !== null && !isNaN(parseFloat(data.saldo_total))) return parseFloat(data.saldo_total)
  const l = Array.isArray(data.lineas) ? data.lineas : []
  return l.length ? (parseFloat(l[l.length - 1].saldo_acum) || 0) : null
}

function lineasVencimiento(expensa, con) {
  const out = []
  const v1 = expensa?.fecha_vencimiento
  out.push(`1º vencimiento: <b>${fmtF(v1)}</b>`)
  const r2 = parseFloat(con?.interes_mora_2) || 0
  const im = parseFloat(con?.interes_mora) || 0
  const d2 = parseInt(con?.vto2_dia, 10)
  if (v1 && d2 && d2 > parseInt(String(v1).slice(8, 10), 10)) {
    const [y, m] = String(v1).slice(0, 7).split('-')
    out.push(`2º vencimiento: <b>${String(d2).padStart(2, '0')}/${m}/${y}</b>${r2 > 0 ? ` — recargo ${pct(r2)} sobre la expensa del período` : ' — sin recargo'}`)
  } else if (r2 > 0) {
    out.push(`Pago posterior al 1º vencimiento: recargo ${pct(r2)} sobre la expensa del período`)
  }
  out.push(im > 0 ? `Interés por mora: ${pct(im)} mensual sobre el saldo deudor de períodos anteriores` : 'Interés por mora: no aplica (sin tasa configurada)')
  return out
}

function bloqueDeuda(saldo, fechaEmision) {
  const f = fmtF(fechaEmision)
  if (saldo === null || saldo === undefined || isNaN(saldo))
    return { cls: 'nd', txt: `Estado de deuda no disponible al momento de la emisión (${f}). Consulte su cuenta corriente.` }
  if (saldo > 0.005)  return { cls: 'deu', txt: `Deuda a la fecha (${f}): <b>${fmtM(saldo)}</b>` }
  if (saldo < -0.005) return { cls: 'ok',  txt: `Sin deuda a la fecha (${f}) — saldo a favor: <b>${fmtM(-saldo)}</b>` }
  return { cls: 'ok', txt: `<b>Sin deuda a la fecha</b> (${f})` }
}

/**
 * @param {object} p
 *  cob            fila de con_cobranzas (id, fecha, monto, medio_pago, canal_cobro, nro_recibo, recibo_numero)
 *  consorcio      con_consorcios (nombre, direccion, localidad, cuit, interes_mora, interes_mora_2, vto2_dia, cbu, alias_cbu, banco)
 *  unidad         con_unidades (numero, nro_uf_pdf, piso, tipo)
 *  copropietario  con_copropietarios (apellido_nombre)
 *  expensa        { periodo, fecha_vencimiento } de la expensa imputada (puede ser parcial)
 *  adm            con_admin_perfil
 *  cuentaBanco    con_cuentas_banco activa (opcional; prioridad sobre los datos del consorcio)
 *  interfast      { cpe, cvu, alias } si el consorcio tiene Interfast activo (opcional)
 *  saldo          saldo de la cta cte a la fecha (get-cuenta-corriente), o null si no se pudo obtener
 *  autoPrint      true → imprime al cargar (ventana); false → descarga HTML
 */
export function generarReciboHTML({ cob, consorcio, unidad, copropietario, expensa, adm, cuentaBanco, interfast, saldo, autoPrint = true }) {
  const con = consorcio || {}, uf = unidad || {}, cp = copropietario || {}, a = adm || {}
  const nro = numeroRecibo(cob)
  const emision = new Date()
  const emisionISO = emision.toISOString().slice(0, 10)
  const logo = a.sello_url || LOGO_ADM_B64
  const logoErr = a.sello_url ? `onerror="this.onerror=null;this.src='${LOGO_ADM_B64}'"` : ''

  const domicilioCon = [trim(con.direccion), trim(con.localidad)].filter(Boolean).join(', ') || '—'
  const ufTxt = [
    `UF ${esc(trim(uf.nro_uf_pdf) || trim(uf.numero) || '?')}`,
    uf.piso ? `Piso ${esc(uf.piso)}` : '',
    uf.numero && uf.piso ? `Dpto. ${esc(uf.numero)}` : '',
    uf.tipo ? esc(uf.tipo) : '',
  ].filter(Boolean).join(' · ')

  const matricula = trim(a.matricula_rpac).replace(/^N[°º.]?\s*/i, '') || '83'
  const nombreAdm = trim(a.nombre) || 'Javier García Pérez'
  const cuitAdm = trim(a.cuit)

  const cbu = trim(cuentaBanco?.cbu) || trim(con.cbu)
  const alias = trim(cuentaBanco?.alias) || trim(con.alias_cbu)
  const banco = trim(cuentaBanco?.banco) || trim(con.banco)
  const formas = []
  if (cbu || alias) formas.push(`<b>Transferencia o depósito</b> a la cuenta del consorcio (titular: ${esc(con.nombre || '—')})${banco ? ` — Banco ${esc(banco)}` : ''}${cbu ? ` — CBU ${esc(cbu)}` : ''}${alias ? ` — Alias ${esc(alias)}` : ''}`)
  if (interfast?.cvu) formas.push(`<b>Pago electrónico Interfast</b> — CVU ${esc(interfast.cvu)}${interfast.alias ? ` — Alias ${esc(interfast.alias)}` : ''}${interfast.cpe ? ` — Código ${esc(interfast.cpe)}` : ''}`)
  const ofi = [trim(a.direccion), trim(a.horario)].filter(Boolean).join(' — ')
  if (ofi) formas.push(`<b>En la administración:</b> ${esc(ofi)}${a.telefono ? ` — Tel. ${esc(trim(a.telefono))}` : ''}`)

  const venc = lineasVencimiento(expensa, con)
  const deu = bloqueDeuda(saldo, emisionISO)
  const medio = (cob?.medio_pago || '—').replace(/_/g, ' ')

  const firma = a.firma_url
    ? `<img src="${esc(a.firma_url)}" style="max-height:52px;max-width:170px;object-fit:contain;display:block;margin:0 auto 2px" onerror="this.style.display='none'">`
    : '<div style="height:34px"></div>'

  const row = (l, v) => `<div class="row"><span class="label">${l}</span><span class="value">${v}</span></div>`

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Recibo ${esc(nro)} — ${esc(con.nombre || '')}</title><style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:11.5px;color:#111}
.recibo{width:182mm;margin:7mm auto;padding:7mm 8mm;border:2px solid #1A3FA0;border-radius:6px}
.header{background:#1A3FA0;color:#fff;padding:9px 14px;border-radius:4px 4px 0 0;margin:-7mm -8mm 10px -8mm;display:flex;justify-content:space-between;align-items:center;gap:12px}
.header h1{font-size:15px;font-weight:700}.header p{font-size:10.5px;opacity:.85;margin-top:2px}
.logo{background:#fff;border-radius:6px;padding:4px;display:flex;align-items:center}
.nro{text-align:right}.nro span{font-size:20px;font-weight:800;display:block}.nro div{font-size:10.5px;opacity:.85}
.sec{font-size:9.5px;font-weight:700;color:#1A3FA0;text-transform:uppercase;letter-spacing:.4px;margin:10px 0 3px;border-bottom:1px solid #1A3FA0;padding-bottom:2px}
.row{display:flex;justify-content:space-between;gap:14px;padding:4px 0;border-bottom:1px solid #eef0f3}
.label{color:#6B7280;font-size:10.5px;white-space:nowrap}.value{font-weight:600;text-align:right}
.monto-box{background:#f0fdf4;border:2px solid #86efac;border-radius:8px;padding:10px;text-align:center;margin:10px 0}
.monto{font-size:26px;font-weight:800;color:#1B6B35}.mlabel{color:#166534;font-size:11px;margin-top:2px}
.txt{font-size:10.5px;line-height:1.6;padding:2px 0}
.deu{margin-top:8px;padding:8px 10px;border-radius:6px;font-size:11.5px}
.deu.ok{background:#f0fdf4;border:1px solid #86efac;color:#166534}.deu.deu{background:#fef2f2;border:1px solid #fca5a5;color:#991b1b}.deu.nd{background:#fffbeb;border:1px solid #fcd34d;color:#92400e}
.firma{margin-top:16px;display:flex;justify-content:flex-end}.firma-box{text-align:center;min-width:230px}
.firma-box .ac{border-top:1px solid #374151;padding-top:4px;font-size:10px;line-height:1.5;color:#374151}
.pie{margin-top:10px;font-size:9px;color:#9ca3af;text-align:center}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="recibo">
<div class="header"><div style="display:flex;align-items:center;gap:12px"><div class="logo"><img src="${logo}" style="max-height:44px;max-width:80px;object-fit:contain" ${logoErr}></div>
<div><h1>RECIBO DE PAGO DE EXPENSAS</h1><p>Art. 12 Ley 14.701 — Provincia de Buenos Aires</p></div></div>
<div class="nro"><span>N° ${esc(nro)}</span><div>Emitido el ${fmtF(emisionISO)}</div></div></div>

<div class="sec">Consorcio</div>
${row('Denominación', esc(con.nombre || '—'))}
${row('Domicilio', esc(domicilioCon))}
${trim(con.cuit) ? row('CUIT', esc(trim(con.cuit))) : ''}

<div class="sec">Unidad y propietario</div>
${row('Unidad funcional', ufTxt)}
${row('Propietario/a', esc(cp.apellido_nombre || '—'))}

<div class="sec">Pago</div>
${row('Concepto', 'Expensas comunes')}
${row('Período', esc(periodoTexto(expensa?.periodo)))}
${row('Fecha de pago', fmtF(cob?.fecha))}
${row('Medio de pago', esc(medio))}${cob?.canal_cobro ? row('Canal', esc(cob.canal_cobro)) : ''}
<div class="monto-box"><div class="monto">${fmtM(cob?.monto)}</div><div class="mlabel">Importe recibido</div></div>

<div class="sec">Vencimientos e intereses del período</div>
${venc.map(v => `<div class="txt">${v}</div>`).join('')}

<div class="deu ${deu.cls}">${deu.txt}</div>

<div class="sec">Lugar y formas de pago</div>
${formas.length ? formas.map(f => `<div class="txt">${f}</div>`).join('') : '<div class="txt">Consulte en la administración.</div>'}

<div class="sec">Administración</div>
${row('Administrador', esc(nombreAdm))}
${row('CUIT', esc(cuitAdm || '—'))}
${row('Inscripción RPAC (Ley 14.701)', 'Mat. N° ' + esc(matricula))}
${a.direccion ? row('Domicilio', esc(trim(a.direccion))) : ''}

<div class="firma"><div class="firma-box">${firma}<div class="ac"><b>${esc(nombreAdm)}</b><br>Administrador de Consorcios — RPAC Mat. N° ${esc(matricula)}${cuitAdm ? `<br>CUIT ${esc(cuitAdm)}` : ''}<br>Pinamar, Provincia de Buenos Aires</div></div></div>
<div class="pie">Comprobante emitido por GASP Consorcios — ${esc(emision.toLocaleString('es-AR'))}</div>
</div>${autoPrint ? `<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},350)}</script>` : ''}</body></html>`
}

// Abre una ventana en el gesto del usuario (evita bloqueo de pop-ups) y la completa cuando llegan los datos.
export function abrirVentanaRecibo() {
  const win = window.open('', '_blank', 'width=820,height=760')
  if (win) win.document.write('<p style="font-family:Arial;padding:24px;color:#555">Generando recibo…</p>')
  return win
}
export function escribirVentanaRecibo(win, html) {
  if (!win) return false
  win.document.open(); win.document.write(html); win.document.close()
  return true
}
