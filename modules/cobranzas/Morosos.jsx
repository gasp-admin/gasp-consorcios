// modules — Morosos.jsx
// Morosos según la CUENTA CORRIENTE (saldo deudor real). Filtros por meses de mora e importe,
// selección múltiple y 3 modelos de intimación (1º informativo, 2º firme, 3º formal) a elección.

import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { fmt } from '../../lib/formatters'
import { Btn, BtnSec, Card } from '../../components/ui'
import { LOGO_ADM_B64 } from '../../lib/logo'

const AVISOS = {
  1: { label: '1º Aviso (informativo)', titulo: 'Aviso de Deuda de Expensas — Primer Aviso' },
  2: { label: '2º Aviso (firme)',       titulo: 'Intimación de Deuda de Expensas — Segundo Aviso' },
  3: { label: '3º Aviso (formal)',      titulo: 'Intimación de Pago de Expensas — Aviso Final' },
}

function cuerpoAviso(tipo, saldoTxt) {
  if (String(tipo) === '1') return `
    <p>De nuestra consideración:</p>
    <p>Nos dirigimos a usted a los efectos de informarle que en nuestros sistemas informáticos se registra la deuda que a continuación se detalla:</p>
    <div class="monto">Total por expensas adeudadas: $ ${saldoTxt}<br/><span style="font-size:10pt;font-weight:normal">(incluyendo los intereses moratorios correspondientes)</span></div>
    <p>Por lo expuesto, y en el supuesto caso que hubiesen sido pagados por Ud., le agradecemos tenga a bien enviar a nuestras oficinas los recibos de pago con los respectivos sellos de la entidad financiera cobradora para poder efectuar los asientos contables pertinentes; caso contrario se le emitirá un nuevo comprobante con los intereses actualizados por el pago fuera de término.</p>
    <p>Sin otro particular y agradeciendo su predisposición lo saludamos muy atte.</p>`
  if (String(tipo) === '2') return `
    <p>En mi carácter de <strong>Administrador del Consorcio</strong> de referencia le <strong>INFORMAMOS</strong> que a la fecha registra una deuda de pesos:</p>
    <div class="monto">$ ${saldoTxt}<br/><span style="font-size:10pt;font-weight:normal">(incluyendo los intereses moratorios correspondientes)</span></div>
    <p>Dicho importe deberá ser cancelado depositando dicha suma en la cuenta corriente del consorcio, o en el domicilio de la administración, en concepto de capital e intereses moratorios y punitorios, para poder cancelar los compromisos contraídos de gastos normales con los proveedores.</p>
    <p>Sin otro particular, y a la espera que regularice su situación, saludamos a Ud., muy atte.</p>`
  return `
    <p>Por medio de la presente, en mi carácter de <strong>Administrador del Consorcio</strong>, me dirijo a Ud. a fin de <strong>intimarle fehacientemente</strong> el pago de las expensas comunes adeudadas, en los términos del <strong>artículo 2046 inciso a) del Código Civil y Comercial de la Nación (Ley 26.994)</strong>.</p>
    <p>El artículo citado establece que el propietario está obligado a <em>"pagar las expensas comunes ordinarias de conservación y de administración del inmueble"</em>, siendo dicha obligación inherente al dominio de la unidad funcional.</p>
    <p>Se hace saber que la <strong>mora es automática</strong> a partir del día del vencimiento de cada período, devengándose los intereses pactados en el Reglamento de Copropiedad, conforme lo establecido por el art. 2048 del mismo cuerpo normativo.</p>
    <div class="monto">DEUDA TOTAL: $ ${saldoTxt}<br/><span style="font-size:10pt;font-weight:normal">(incluyendo los intereses moratorios correspondientes)</span></div>
    <p>Se le otorga el plazo improrrogable de <strong>cinco (5) días hábiles</strong> contados desde la recepción del presente para que proceda a regularizar la situación descripta, bajo apercibimiento de iniciar las acciones legales pertinentes para el cobro compulsivo de las sumas adeudadas, con más los intereses, costas y costos del proceso.</p>
    <p>Los pagos deberán realizarse en la Administración sita en Lenguado 1313, Local 3, Pinamar, en días hábiles de 9 a 13 hs, o mediante transferencia bancaria a los datos oportunamente comunicados.</p>
    <p>Sin otro particular, saludo a Ud. atte.</p>`
}

function docIntimacion(tipo, datos) {
  const hoy = new Date().toLocaleDateString('es-AR')
  const esFinal = String(tipo) === '3'
  return `
    <div class="hoja">
      <div class="encabezado">
        <div style="display:flex;align-items:center;gap:12px">
          <img src="${LOGO_ADM_B64}" alt="Administración de Consorcios Pinamar" style="width:58px;height:auto;object-fit:contain"/>
          <div><strong>Administración de Consorcios Pinamar</strong><br/>Lenguado 1313, Local 3 — Pinamar, Buenos Aires<br/>Tel: 02267 444034</div>
        </div>
        <div style="text-align:right">Pinamar, ${hoy}<br/><strong>Ref.:</strong> UF ${datos.unidad} — ${datos.consorcio}</div>
      </div>
      <h1${esFinal ? ' class="final"' : ''}>${esFinal ? '⚠ ' : ''}${AVISOS[tipo].titulo}</h1>
      <div class="datos">
        <strong>Destinatario/a:</strong> Sr./a Propietario/a UF ${datos.unidad}${datos.piso ? ', Piso ' + datos.piso : ''} — ${datos.consorcio}<br/>
        <strong>${datos.destinatario}</strong>
      </div>
      <div class="cuerpo">${cuerpoAviso(tipo, datos.saldo)}</div>
      <div class="firma">
        <div class="firma-box">Javier García Pérez<br/>Administrador de Consorcios<br/>R.P.A.C. Mat. N° 83<br/>CUIT: 20-18600680-2</div>
        <div class="firma-box">Notificado/a<br/>Aclaración:<br/><br/>Fecha:</div>
      </div>
      <div class="pie">Documento generado el ${hoy} — GASP Consorcios — Administración Pinamar</div>
    </div>`
}

function abrirDocumento(tipo, listaDatos) {
  const hojas = listaDatos.map(d => docIntimacion(tipo, d)).join('<div class="salto"></div>')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Intimaciones</title><style>
    body{font-family:Arial,sans-serif;margin:0;padding:0;font-size:12pt;line-height:1.7;color:#111}
    .hoja{max-width:760px;margin:0 auto;padding:40px}
    .salto{page-break-after:always}
    h1{font-size:15pt;text-align:center;text-transform:uppercase;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:24px}
    h1.final{color:#b91c1c;border-color:#b91c1c}
    .encabezado{display:flex;justify-content:space-between;margin-bottom:26px;font-size:11pt}
    .datos{background:#f5f5f5;padding:14px;border-radius:6px;margin-bottom:20px;font-size:11pt}
    .cuerpo{text-align:justify;margin-bottom:20px}
    .cuerpo p{margin:10px 0}
    .monto{font-size:14pt;font-weight:bold;text-align:center;margin:20px 0;padding:12px;border:2px solid #000;border-radius:6px}
    .firma{margin-top:60px;display:flex;justify-content:space-between}
    .firma-box{text-align:center;border-top:1px solid #000;padding-top:8px;width:220px;font-size:10pt}
    .pie{margin-top:30px;font-size:9pt;color:#666;text-align:center}
    @media print{.hoja{padding:20px}}
  </style></head><body>${hojas}<script>setTimeout(function(){window.print()},500)</script></body></html>`
  const w = window.open('', '_blank')
  if (!w) { alert('El navegador bloqueó la ventana. Habilitá los pop-ups para este sitio.'); return }
  w.document.write(html); w.document.close()
}

function waLink(tel, texto) {
  let n = (tel || '').replace(/\D/g, '')
  if (n.startsWith('549')) {} else if (n.startsWith('54')) n = '9' + n.slice(2)
  else { if (n.startsWith('0')) n = n.slice(1); n = '549' + n }
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`
}

export default function Morosos() {
  const { session, unidades, copropietarios, consorcioActivo } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [morosos, setMorosos] = useState([])
  const [loading, setLoading] = useState(true)
  const [convenioForm, setConvenioForm] = useState(null)
  const [fMeses, setFMeses] = useState(0)
  const [fImporte, setFImporte] = useState(0)
  const [tipoAviso, setTipoAviso] = useState(1)
  const [sel, setSel] = useState(() => new Set())

  async function cargar() {
    setLoading(true)
    const corte = consorcioActivo?.fecha_corte_nativo || null
    const { data: exps } = await supabase.from('con_expensas')
      .select('id, periodo, fecha_vencimiento').eq('consorcio_id', consorcioId).eq('estado', 'cerrada')
      .order('periodo', { ascending: false }).limit(1)
    const ult = exps?.[0] || null

    const expUF = {}
    if (ult) {
      const { data: le } = await supabase.from('con_liquidacion_uf')
        .select('unidad_id, expensa_calculada').eq('expensa_id', ult.id)
      for (const l of (le || [])) expUF[l.unidad_id] = Number(l.expensa_calculada || 0)
    }

    const saldoUF = {}
    if (corte) {
      const { data: movs } = await supabase.from('con_movimientos_unidad')
        .select('unidad_id, tipo, monto, categoria, id, fecha')
        .eq('consorcio_id', consorcioId).eq('estado', 'vigente')
      for (const m of (movs || [])) {
        const esApert = String(m.id || '').startsWith('MOV-APERT-')
        if (!esApert && String(m.fecha || '') < corte) continue
        const val = m.tipo === 'debito' ? Number(m.monto || 0) : -Number(m.monto || 0)
        if (!saldoUF[m.unidad_id]) saldoUF[m.unidad_id] = { deuda: 0, interes: 0 }
        saldoUF[m.unidad_id].deuda += val
        if (m.categoria === 'interes_mora' && m.tipo === 'debito') saldoUF[m.unidad_id].interes += Number(m.monto || 0)
      }
    } else if (ult) {
      const { data: lufs } = await supabase.from('con_liquidacion_uf')
        .select('unidad_id, deuda, interes, ajustes, total_uf').eq('expensa_id', ult.id)
      for (const l of (lufs || [])) {
        saldoUF[l.unidad_id] = {
          deuda: Number(l.total_uf || 0),                            // saldo final EXACTO (= cta cte / PDF) → reclamo
          vencida: Number(l.deuda || 0) + Number(l.ajustes || 0),    // capital vencido neto → criterio de mora
          interes: Number(l.interes || 0),
        }
      }
    }

    const numUF = (id) => { const u = unidades.find(x => x.id === id); return parseInt(u?.nro_uf_pdf ?? u?.numero, 10) || 999 }
    const lista = Object.entries(saldoUF)
      .map(([unidad_id, s]) => {
        const deuda = Math.round(s.deuda * 100) / 100                              // saldo total exacto (reclamo)
        const vencida = Math.round((s.vencida != null ? s.vencida : s.deuda) * 100) / 100  // capital vencido (criterio)
        const exp = expUF[unidad_id] || 0
        const meses = exp > 0 ? Math.max(1, Math.round(deuda / exp)) : 1
        return {
          unidad_id, deuda, vencida, interes: Math.round(s.interes * 100) / 100, meses,
          periodo: ult?.periodo || null, expensa_id: ult?.id || null,
        }
      })
      .filter(x => x.vencida > 1)
      .sort((a, b) => numUF(a.unidad_id) - numUF(b.unidad_id))
    setMorosos(lista); setSel(new Set()); setLoading(false)
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId]) // eslint-disable-line

  const filtrados = useMemo(
    () => morosos.filter(m => m.meses >= (Number(fMeses) || 0) && m.deuda >= (Number(fImporte) || 0)),
    [morosos, fMeses, fImporte]
  )
  const totalFiltrado = filtrados.reduce((a, d) => a + d.deuda, 0)
  const seleccionados = filtrados.filter(m => sel.has(m.unidad_id))

  const datosDe = (d) => {
    const u = unidades.find(x => x.id === d.unidad_id)
    const cp = u ? copropietarios.find(c => c.id === u.propietario_id) : null
    return {
      unidad: u?.nro_uf_pdf || u?.numero || d.unidad_id, piso: u?.piso || '',
      consorcio: consorcioActivo?.nombre || consorcioId,
      destinatario: cp?.apellido_nombre || 'Copropietario/a',
      saldo: fmt(d.deuda).replace('$', '').trim(), tel: cp?.telefono, email: cp?.email,
    }
  }

  function generarLote() {
    const base = seleccionados.length ? seleccionados : filtrados
    if (!base.length) return alert('No hay unidades para intimar con los filtros actuales.')
    abrirDocumento(tipoAviso, base.map(datosDe))
  }
  function generarUna(d) { abrirDocumento(tipoAviso, [datosDe(d)]) }

  function enviarWA(d) {
    const dd = datosDe(d)
    if (!dd.tel) return alert('El copropietario no tiene teléfono registrado')
    const intro = String(tipoAviso) === '3' ? 'INTIMACIÓN de pago'
      : String(tipoAviso) === '2' ? 'Segundo aviso de deuda' : 'Le informamos que registra deuda'
    const txt = `Estimado/a ${dd.destinatario}, ${intro} de expensas de la UF ${dd.unidad} (${dd.consorcio}) por $ ${dd.saldo} (incluye intereses). Por favor regularice su situación. Gracias.`
    window.open(waLink(dd.tel, txt), '_blank')
  }

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleTodos = () => setSel(s => {
    const allSel = filtrados.length > 0 && filtrados.every(m => s.has(m.unidad_id))
    return allSel ? new Set() : new Set(filtrados.map(m => m.unidad_id))
  })

  async function guardarConvenio() {
    if (!convenioForm?.det || !convenioForm.cuotas || !convenioForm.monto_total) return
    const det = convenioForm.det
    const cuotas = parseInt(convenioForm.cuotas)
    const montoCuota = parseFloat(convenioForm.monto_total) / cuotas
    await supabase.from('con_unidades').update({ convenio_pago: true, convenio_detalle: convenioForm.detalle || '' }).eq('id', det.unidad_id)
    for (let i = 1; i <= cuotas; i++) {
      await supabase.from('con_movimientos_unidad').insert([{
        id: `CONV-${det.unidad_id}-${i}-${Date.now()}`,
        admin_id: uid, consorcio_id: consorcioId, unidad_id: det.unidad_id, expensa_id: det.expensa_id || null,
        tipo: 'convenio_cuota', concepto: `Convenio de pago — Cuota ${i}/${cuotas}`,
        monto: montoCuota, es_debito: true, es_convenio_pago: true, cuotas_total: cuotas, cuota_numero: i, monto_cuota: montoCuota,
        created_at: new Date().toISOString(),
      }])
    }
    setConvenioForm(null)
    alert(`✓ Convenio registrado: ${cuotas} cuotas de ${fmt(montoCuota)}`)
    cargar()
  }

  const inputS = { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }
  const th = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 'bold', color: RJ, textTransform: 'uppercase', borderBottom: '1px solid #fecaca' }
  const todosSel = filtrados.length > 0 && filtrados.every(m => sel.has(m.unidad_id))
  const baseAccion = seleccionados.length ? seleccionados : filtrados

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: RJ }}>⚠ Morosos</div>
          <div style={{ fontSize: 12, color: GR }}>{filtrados.length} unidad(es) · Total: {fmt(totalFiltrado)}{morosos.length !== filtrados.length ? ` (de ${morosos.length} deudoras)` : ''}</div>
        </div>
      </div>

      <Card style={{ marginBottom: 14, background: '#fff7ed', border: `1px solid ${AM}` }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, color: GR, marginBottom: 3, fontWeight: 600 }}>Meses de mora ≥</div>
            <input type="number" min="0" value={fMeses} onChange={e => setFMeses(e.target.value)} style={{ ...inputS, width: 90 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: GR, marginBottom: 3, fontWeight: 600 }}>Importe ≥ ($)</div>
            <input type="number" min="0" step="1000" value={fImporte} onChange={e => setFImporte(e.target.value)} style={{ ...inputS, width: 130 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: GR, marginBottom: 3, fontWeight: 600 }}>Tipo de aviso</div>
            <select value={tipoAviso} onChange={e => setTipoAviso(e.target.value)} style={{ ...inputS, background: '#fff' }}>
              {Object.entries(AVISOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn color={RJ} onClick={generarLote}>📄 Generar {AVISOS[tipoAviso].label.split(' ')[0]} ({baseAccion.length})</Btn>
            <Btn color='#25d366' onClick={async () => {
              for (const d of baseAccion) { if (datosDe(d).tel) { enviarWA(d); await new Promise(r => setTimeout(r, 500)) } }
            }}>📱 WA ({baseAccion.filter(d => datosDe(d).tel).length})</Btn>
          </div>
        </div>
        <div style={{ fontSize: 11, color: GR, marginTop: 8 }}>
          Sin selección la acción aplica a todos los filtrados. Los meses de mora son estimados (deuda ÷ expensa mensual).
        </div>
      </Card>

      {convenioForm && (
        <Card style={{ marginBottom: 16, border: `1.5px solid ${AM}`, background: '#fffbeb' }}>
          <div style={{ fontWeight: 700, color: AM, marginBottom: 12 }}>📋 Convenio de pago en cuotas</div>
          <div style={{ fontSize: 12, color: GR, marginBottom: 12 }}>
            UF {unidades.find(x => x.id === convenioForm.det?.unidad_id)?.numero || '—'} — {copropietarios.find(c => c.id === unidades.find(x => x.id === convenioForm.det?.unidad_id)?.propietario_id)?.apellido_nombre || '—'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4, fontWeight: 500 }}>Monto total a convenir *</div>
              <input type="number" min="0" step="0.01" value={convenioForm.monto_total || ''} onChange={e => setConvenioForm(f => ({ ...f, monto_total: e.target.value }))} style={{ ...inputS, width: '100%', fontWeight: 700 }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4, fontWeight: 500 }}>Número de cuotas *</div>
              <select value={convenioForm.cuotas || ''} onChange={e => setConvenioForm(f => ({ ...f, cuotas: e.target.value }))} style={{ ...inputS, width: '100%', background: '#fff' }}>
                <option value="">— Seleccione —</option>
                {[2, 3, 4, 6, 8, 10, 12, 18, 24].map(n => <option key={n} value={n}>{n} cuotas de {convenioForm.monto_total ? fmt(parseFloat(convenioForm.monto_total) / n) : '—'}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4, fontWeight: 500 }}>Detalle del acuerdo</div>
              <textarea value={convenioForm.detalle || ''} onChange={e => setConvenioForm(f => ({ ...f, detalle: e.target.value }))} rows={2} style={{ ...inputS, width: '100%', fontFamily: 'inherit' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn color={AM} onClick={guardarConvenio}>✓ Confirmar convenio</Btn>
            <BtnSec onClick={() => setConvenioForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {loading ? <div style={{ textAlign: 'center', color: GR, padding: 40 }}>Cargando...</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fef2f2' }}>
                <th style={{ ...th, width: 30 }}><input type="checkbox" checked={todosSel} onChange={toggleTodos} title="Seleccionar todos" /></th>
                {['UF', 'Copropietario', 'Meses', 'Deuda', 'Mora incl.', 'Acciones'].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(d => {
                const u = unidades.find(x => x.id === d.unidad_id)
                const cp = u ? copropietarios.find(c => c.id === u.propietario_id) : null
                return (
                  <tr key={d.unidad_id} style={{ borderBottom: '1px solid #fef2f2', background: sel.has(d.unidad_id) ? '#fff7ed' : 'transparent' }}>
                    <td style={{ padding: '9px 10px' }}><input type="checkbox" checked={sel.has(d.unidad_id)} onChange={() => toggle(d.unidad_id)} /></td>
                    <td style={{ padding: '9px 10px', fontWeight: 700, color: AZ }}>{u?.numero || '—'}</td>
                    <td style={{ padding: '9px 10px' }}>{cp?.apellido_nombre || '—'}</td>
                    <td style={{ padding: '9px 10px' }}><span style={{ background: d.meses >= 3 ? '#fee2e2' : '#fef9c3', color: d.meses >= 3 ? RJ : '#92400e', padding: '2px 8px', borderRadius: 10, fontWeight: 700, fontSize: 12 }}>{d.meses}</span></td>
                    <td style={{ padding: '9px 10px', fontWeight: 700, color: RJ }}>{fmt(d.deuda)}</td>
                    <td style={{ padding: '9px 10px', color: d.interes > 0 ? RJ : GR }}>{d.interes > 0 ? fmt(d.interes) : '—'}</td>
                    <td style={{ padding: '9px 10px' }}>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {cp?.telefono && <Btn small color='#25d366' onClick={() => enviarWA(d)}>📱</Btn>}
                        {cp?.email && <Btn small color={AZ} onClick={() => window.open(`mailto:${cp.email}`)}>✉</Btn>}
                        <Btn small color={RJ} title="Generar intimación (tipo seleccionado)" onClick={() => generarUna(d)}>📄</Btn>
                        <Btn small color={AM} title="Convenio de pago en cuotas" onClick={() => setConvenioForm({ det: d, cuotas: '', monto_total: d.deuda, detalle: '' })}>📋</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtrados.length === 0 && <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: VD, fontWeight: 600 }}>✅ No hay morosos con los filtros actuales</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
