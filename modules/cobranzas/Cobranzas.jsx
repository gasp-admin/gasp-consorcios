import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Cobranzas() {
  const { session, consorcioActivo, unidades, copropietarios, expensas } = useApp() session, consorcioId, unidades, copropietarios, adminPerfil } session, consorcioId, unidades, copropietarios, adminPerfil } session, consorcioId, unidades, copropietarios, adminPerfil }
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
    const exps = expRes.data || []
    setExpensas(exps)
    setConsorcio(conRes.data || null)
    if (exps.length > 0) {
      // Prioridad: 1) expensa abierta con detalles, 2) cerrada más reciente con detalles, 3) cualquier abierta, 4) la primera
      // Buscar la expensa más relevante para mostrar
      // Preferir cerrada con datos sobre abierta sin datos
      const abConDatos = exps.find(e => e.estado === 'abierta' && e.tipo !== 'migracion' && parseFloat(e.total_expensa) > 0)
      const cerradaReciente = exps.find(e => e.estado === 'cerrada')
      const abSinDatos = exps.find(e => e.estado === 'abierta' && e.tipo !== 'migracion')
      seleccionarExpensa(abConDatos || cerradaReciente || abSinDatos || exps[0])
    }
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
    const monto = Math.round(parseFloat(form.monto) * 100) / 100
    if (isNaN(monto) || monto <= 0)
      return setMsg({ tipo:'warn', texto:'El monto debe ser un número mayor a cero' })
    const { error } = await supabase.from('con_cobranzas').insert([{
      id: 'COB-' + Date.now(),
      admin_id: session.user.id, consorcio_id: consorcioId, expensa_id: expSel.id,
      unidad_id: form.unidad_id, fecha: form.fecha, monto,
      medio_pago: form.medio_pago || 'transferencia',
      recibo_numero: form.recibo_numero || '',
      observaciones: form.observaciones || '',
      estado: 'acreditado'
    }])
    if (error) return setMsg({ tipo:'error', texto: error.message })
    const det = detalles.find(d => d.unidad_id === form.unidad_id)
    if (det) {
      const nuevoPago = Math.round(((parseFloat(det.pagos_periodo) || 0) + monto) * 100) / 100
      const deudaTotal = Math.round(((parseFloat(det.saldo_anterior)||0) + (parseFloat(det.monto)||0) + (parseFloat(det.interes_mora)||0)) * 100) / 100
      const estado = nuevoPago >= deudaTotal ? 'pagada' : 'parcial'
      await supabase.from('con_expensas_detalle')
        .update({ pagos_periodo: nuevoPago, estado, fecha_pago: estado==='pagada' ? form.fecha : null })
        .eq('id', det.id)
    }
    setForm(null)
    setMsg({ tipo:'ok', texto: `✓ Pago de ${fmt(monto)} registrado` })
    // P2-E: Notificación automática al copropietario
    try {
      const cobId = 'COB-' + Date.now()
      const uf = unidades.find(u => u.id === form.unidad_id)
      const cp = copropietarios.find(c => c.id === uf?.propietario_id)
      if (cp?.email) {
        await supabase.rpc('registrar_notificacion_pago', {
          p_cobranza_id: cobId, p_admin_id: session.user.id, p_consorcio_id: consorcioId
        })
      }
    } catch(e) { /* no crítico */ }
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
                      const saldo = Math.round(Math.max(0,
                        (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0) +
                        (parseFloat(d.interes_mora)||0) - (parseFloat(d.pagos_periodo)||0)
                      ) * 100) / 100
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
                            {u?.portal_token && (
                              <Btn small title="Enviar link portal por WhatsApp" onClick={() => {
                                const url = 'https://consorcios.administracionpinamar.com/portal?token=' + u?.portal_token
                                const cp2 = copropietarios.find(c => c.id === u.propietario_id)
                                if (cp2?.telefono) {
                                  const txt = encodeURIComponent(`Estimado/a ${cp2.apellido_nombre}, consulte su estado de cuenta en:\n${url}`)
                                  window.open(`https://wa.me/549${(()=>{let n=(cp2.telefono||'').replace(/\D/g,'');if(n.startsWith('549'))return n;if(n.startsWith('54'))return '9'+n.slice(2);if(n.startsWith('0'))n=n.slice(1);return n})()}?text=${txt}`, '_blank')
                                } else {
                                  navigator.clipboard.writeText(url)
                                    .then(() => setMsg({ tipo:'ok', texto:`✓ Link copiado — ${u.numero}` }))
                                }
                              }} style={{ background:'#f0fdf4', color:'#166534' }}>🔗</Btn>
                            )}
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
