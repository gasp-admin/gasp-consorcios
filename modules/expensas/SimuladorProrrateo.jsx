import { useState, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { AZ, GR, BG, RJ } from '../../lib/config'
import { exportarExcel } from '../../lib/exportExcel'
import { Btn, Card, Input, Sel, Msg } from '../../components/ui'

const COEFS = [
  { v: 'porcentaje_fiscal', l: 'Coeficiente fiscal (%)' },
  { v: 'pct_gtos_grales',   l: 'Gastos generales' },
  { v: 'pct_fdo_obras',     l: 'Fondo de obras' },
  { v: 'pct_gtos_part',     l: 'Gastos particulares' },
  { v: 'pct_cochera',       l: 'Cochera' },
]

const th = { padding: '9px 12px', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }
const td = { padding: '8px 12px' }
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default function SimuladorProrrateo() {
  const { consorcioActivo, unidades, copropietarios, adminPerfil } = useApp()
  const [monto, setMonto]         = useState('')
  const [concepto, setConcepto]   = useState('')
  const [campoCoef, setCampoCoef] = useState('porcentaje_fiscal')
  const [ajuste, setAjuste]       = useState(true)

  const fmt  = n => '$' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtN = n => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const ufs = useMemo(
    () => (unidades || []).filter(u => u.consorcio_id === consorcioActivo?.id),
    [unidades, consorcioActivo]
  )

  const res = useMemo(() => {
    const total = parseFloat(monto) || 0
    if (total <= 0 || !ufs.length) return null
    const coefTotal = ufs.reduce((a, u) => a + (parseFloat(u[campoCoef]) || 0), 0)
    if (coefTotal <= 0) return { error: 'Las unidades no tienen cargado ese coeficiente. Probá con otro.' }
    let acum = 0
    const filas = ufs.slice()
      .sort((a, b) => (parseInt(a.numero) || 0) - (parseInt(b.numero) || 0) || String(a.numero).localeCompare(String(b.numero)))
      .map(u => {
        const coef = parseFloat(u[campoCoef]) || 0
        const m = Math.round(total * (coef / coefTotal) * 100) / 100
        acum += m
        const cp = (copropietarios || []).find(c => c.id === u.propietario_id)
        return { numero: u.numero, prop: cp?.apellido_nombre || '\u2014', pct: coef / coefTotal * 100, monto: m }
      })
    const dif = Math.round((total - acum) * 100) / 100
    if (ajuste && filas.length && Math.abs(dif) >= 0.01) {
      filas[0].monto = Math.round((filas[0].monto + dif) * 100) / 100
    }
    const suma = Math.round(filas.reduce((a, f) => a + f.monto, 0) * 100) / 100
    return { filas, coefTotal, suma, total }
  }, [monto, campoCoef, ajuste, ufs, copropietarios])

  const coefLabel = COEFS.find(c => c.v === campoCoef)?.l || campoCoef

  function exportarXls() {
    if (!res?.filas) return
    exportarExcel({
      titulo: `Prorrateo-${consorcioActivo?.nombre || ''}${concepto ? '-' + concepto : ''}`,
      columnas: [
        { key: 'numero',   label: 'UF' },
        { key: 'prop',     label: 'Propietario' },
        { key: 'pctTxt',   label: 'Coeficiente %' },
        { key: 'montoTxt', label: 'Monto estimado' },
      ],
      filas: [
        { numero: 'SIMULACIÓN', prop: concepto || '(sin concepto)', pctTxt: 'Reparto por: ' + coefLabel, montoTxt: 'Total: ' + fmtN(res.total) },
        ...res.filas.map(f => ({ numero: f.numero, prop: f.prop, pctTxt: f.pct.toFixed(4), montoTxt: f.monto.toFixed(2) })),
        { numero: '', prop: 'TOTAL', pctTxt: '100.0000', montoTxt: res.suma.toFixed(2) },
      ],
    })
  }

  function exportarPdf() {
    if (!res?.filas) return
    const adm = adminPerfil || {}
    const logoSrc = adm.sello_url || ''
    const hoy = new Date().toLocaleDateString('es-AR')
    const filas = res.filas.map((f, i) =>
      `<tr style="background:${i % 2 ? '#f6f9fc' : '#fff'}"><td class="L" style="font-weight:600">${esc(f.numero)}</td><td class="L">${esc(f.prop)}</td><td>${f.pct.toFixed(4)}%</td><td>$${fmtN(f.monto)}</td></tr>`
    ).join('')
    const logoHtml = logoSrc
      ? `<img src="${logoSrc}" style="max-height:50px;max-width:85px;object-fit:contain" onerror="this.style.display='none'">`
      : `<span style="color:#1A3FA0;font-weight:900;font-size:20px">GASP</span>`
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Simulación de prorrateo</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9pt;color:#111;background:#fff}
.page{width:210mm;min-height:297mm;padding:12mm 14mm}
@page{size:A4;margin:0}@media print{body{margin:0}.no-print{display:none!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
.hdr{display:flex;align-items:flex-start;gap:14px;border-bottom:2px solid #1A3FA0;padding-bottom:9px;margin-bottom:10px}
.hdr-logo{width:92px;height:56px;flex-shrink:0;border:1px solid #e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;background:#fff}
.hdr-title h1{font-size:14pt;color:#1A3FA0;font-weight:800}
.hdr-title h2{font-size:10.5pt;color:#2e4057;margin-top:2px}
.datos{display:flex;gap:22px;margin-bottom:10px}
.datos-col{flex:1}
.datos-col h3{font-size:8pt;color:#1A3FA0;text-transform:uppercase;letter-spacing:.5px;font-weight:700;border-bottom:1px solid #1A3FA0;padding-bottom:2px;margin-bottom:3px}
.datos-col p{font-size:7.5pt;color:#222;line-height:1.6}
.aviso{background:#fef9c3;border:1px solid #eab308;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:8.5pt;color:#854d0e;line-height:1.5}
.aviso b{color:#713f12}
.resumen{display:flex;gap:14px;margin-bottom:9px;flex-wrap:wrap}
.resumen div{background:#f0f4ff;border-radius:6px;padding:7px 14px;font-size:8.5pt}
.stitle{background:#1A3FA0;color:#fff;font-size:9pt;font-weight:700;text-transform:uppercase;padding:5px 10px;text-align:center}
table{width:100%;border-collapse:collapse;font-size:8.5pt}
th{background:#2e4057;color:#fff;padding:5px 8px;text-align:right;font-weight:600}
th.L{text-align:left}
td{padding:4px 8px;text-align:right;border-bottom:1px solid #e8e8e8}
td.L{text-align:left}
.rt td{background:#1A3FA0!important;color:#fff!important;font-weight:700}
.footer{margin-top:12px;border-top:1px solid #ddd;padding-top:4px;font-size:7pt;color:#888;display:flex;justify-content:space-between}
.btn-imp{display:block;margin:14px auto;padding:10px 26px;background:#1A3FA0;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}
</style></head><body>
<button class="btn-imp no-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
<div class="page">
  <div class="hdr">
    <div class="hdr-logo">${logoHtml}</div>
    <div class="hdr-title"><h1>Administración de Consorcios Pinamar</h1><h2>SIMULACIÓN DE PRORRATEO${concepto ? ' — ' + esc(concepto) : ''}</h2></div>
  </div>
  <div class="datos">
    <div class="datos-col"><h3>Administración</h3><p><b>${esc(adm.nombre) || 'Javier García Pérez'}</b><br/>${esc(adm.direccion) || ''}<br/>${esc(adm.email) || ''}<br/><b>CUIT:</b> ${esc(adm.cuit) || ''} &nbsp; <b>R.P.A.C.:</b> ${esc(adm.matricula_rpac) || '83'}<br/><b>Tel:</b> ${esc(adm.telefono) || ''}</p></div>
    <div class="datos-col"><h3>Consorcio</h3><p><b>${esc(consorcioActivo?.nombre) || ''}</b><br/><b>CUIT:</b> ${esc(consorcioActivo?.cuit) || '—'}<br/><b>Fecha:</b> ${hoy}</p></div>
  </div>
  <div class="aviso"><b>⚠️ DOCUMENTO INFORMATIVO — SIMULACIÓN.</b> Esta planilla es una <b>estimación</b> del costo por unidad funcional${concepto ? ' para «' + esc(concepto) + '»' : ''}, calculada por ${coefLabel.toLowerCase()}. <b>No constituye una liquidación de expensas</b> ni genera obligación de pago; se emite a título orientativo para evaluar el reparto.</div>
  <div class="resumen">
    <div><b>Monto total a prorratear:</b> $${fmtN(res.total)}</div>
    <div><b>Reparto por:</b> ${coefLabel}</div>
    <div><b>Unidades:</b> ${res.filas.length}</div>
  </div>
  <div class="stitle">Estimación de costo por unidad</div>
  <table>
    <thead><tr><th class="L">U.F.</th><th class="L">Propietario</th><th>Coef. %</th><th>Monto estimado</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr class="rt"><td class="L" colspan="3">TOTAL</td><td>$${fmtN(res.suma)}</td></tr></tfoot>
  </table>
  <div class="footer"><span>Simulación de prorrateo${concepto ? ' — ' + esc(concepto) : ''}</span><span>R.P.A.C. N° ${esc(adm.matricula_rpac) || '83'} — Administración Pinamar</span><span>${hoy}</span></div>
</div></body></html>`
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'width=950,height=760')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  if (!consorcioActivo) {
    return <div style={{ padding: 20 }}><Msg data={{ tipo: 'warn', texto: 'Seleccioná un consorcio primero.' }} /></div>
  }

  return (
    <div style={{ padding: 20, maxWidth: 920, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: AZ, fontSize: 20 }}>🧮 Simulador de prorrateo</h2>
        <p style={{ color: GR, fontSize: 13, marginTop: 4 }}>
          Estimá cuánto le tocaría a cada unidad al repartir un monto por coeficiente — por ejemplo,
          el costo de una obra — <b>sin generar ninguna liquidación ni tocar datos</b>.
        </p>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Input label="Monto total a prorratear" type="number" value={monto} onChange={setMonto} placeholder="Ej: 1000000" />
          <Input label="Concepto (opcional)" value={concepto} onChange={setConcepto} placeholder="Ej: Obra fachada" />
          <Sel label="Coeficiente de reparto" value={campoCoef} onChange={setCampoCoef} opts={COEFS} />
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
            <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', color: '#374151' }}>
              <input type="checkbox" checked={ajuste} onChange={e => setAjuste(e.target.checked)} />
              Ajustar centavos en la 1ª UF (para cuadrar el total)
            </label>
          </div>
        </div>
      </Card>

      {res?.error && <div style={{ marginTop: 14 }}><Msg data={{ tipo: 'warn', texto: res.error }} /></div>}

      {res?.filas && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, color: GR }}>{res.filas.length} unidades · repartido por <b>{coefLabel}</b></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn small color="#B91C1C" onClick={exportarPdf}>📄 PDF</Btn>
              <Btn small color="#16a34a" onClick={exportarXls}>📊 Excel</Btn>
            </div>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: BG }}>
                  <th style={{ ...th, textAlign: 'center' }}>UF</th>
                  <th style={{ ...th, textAlign: 'left' }}>Propietario</th>
                  <th style={{ ...th, textAlign: 'right' }}>Coef. %</th>
                  <th style={{ ...th, textAlign: 'right' }}>Monto estimado</th>
                </tr>
              </thead>
              <tbody>
                {res.filas.map((f, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ ...td, fontWeight: 600, textAlign: 'center' }}>{f.numero}</td>
                    <td style={td}>{f.prop}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{f.pct.toFixed(4)}%</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(f.monto)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid ' + AZ, background: BG }}>
                  <td style={{ ...td, fontWeight: 700 }} colSpan={3}>TOTAL</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: AZ }}>{fmt(res.suma)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {Math.abs(res.suma - res.total) > 0.005 && (
            <div style={{ fontSize: 11, color: RJ, marginTop: 6 }}>
              ⚠️ La suma ({fmt(res.suma)}) difiere del monto ingresado ({fmt(res.total)}) por {fmt(res.suma - res.total)} — activá "Ajustar centavos" para cuadrar.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
