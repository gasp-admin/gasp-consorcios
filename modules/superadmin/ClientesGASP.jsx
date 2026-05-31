// modules — ClientesGASP.jsx
// Extraído del V59. Refactorizado: props → useApp(). Cero cambios de comportamiento.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function ClientesGASP() {
  const { session } = useApp()
  const uid = session?.user?.id
  const token = session?.access_token

  const EF_URL = `${SUPA_URL}/functions/v1/gestionar-clientes-gasp`
  const EF_DEMO = `${SUPA_URL}/functions/v1/crear-demo-consorcios`

  const [tab, setTab]               = useState('dashboard')
  const [dashData, setDashData]     = useState(null)
  const [cargando, setCargando]     = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [msg, setMsg]               = useState(null)
  const [modal, setModal]           = useState(null)   // 'nuevo_cliente' | 'pago' | 'detalle'
  const [form, setForm]             = useState({})
  const [demos, setDemos]           = useState([])
  const [cargandoDemos, setCargandoDemos] = useState(false)
  const [clienteSel, setClienteSel] = useState(null)

  // Colores de estado
  const EST_COLOR = { activo:'#166534', por_vencer:'#92400E', vencido:'#991B1B', suspendido:'#374151', trial:'#1A3FA0', cancelado:'#6B7280' }
  const EST_BG    = { activo:'#D1FAE5', por_vencer:'#FEF3C7', vencido:'#FEE2E2', suspendido:'#F3F4F6', trial:'#DBEAFE', cancelado:'#F3F4F6' }
  const EST_LABEL = { activo:'✅ Activo', por_vencer:'⚠️ Por vencer', vencido:'🔴 Vencido', suspendido:'⛔ Suspendido', trial:'🔵 Trial', cancelado:'⬜ Cancelado' }

  const PLANES = ['mensual','anual','enterprise']
  const SISTEMAS_DISP = ['Consorcios','Anual','Temporario','Inmo','Full']
  const MEDIOS_PAGO = ['transferencia','mercadopago','efectivo','otro']

  async function llamarEF(accion, extra = {}) {
    const res = await fetch(EF_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session?.access_token}` },
      body: JSON.stringify({ accion, ...extra })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Error desconocido')
    return data
  }

  async function cargarDashboard() {
    if (!session?.access_token) { setCargando(false); return }
    setCargando(true)
    try {
      const data = await llamarEF('dashboard')
      setDashData(data)
    } catch(e) { setMsg({ tipo:'error', texto: e.message }) }
    setCargando(false)
  }

  async function cargarDemos() {
    setCargandoDemos(true)
    try {
      const { data } = await supabase.from('usuarios_demo')
        .select('*').eq('sistemas', '{Consorcios}').order('fecha_expiracion', { ascending: false })
      setDemos(data || [])
    } catch(e) { console.error(e) }
    setCargandoDemos(false)
  }

  async function crearDemo() {
    if (!form.nombre || !form.email || !form.password) return setMsg({ tipo:'error', texto:'Nombre, email y contraseña son requeridos' })
    setProcesando(true); setMsg(null)
    try {
      const res = await fetch(EF_DEMO, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session?.access_token}` },
        body: JSON.stringify({ ...form, sistemas: ['Consorcios'] })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Error al crear demo')
      setMsg({ tipo:'ok', texto:`✅ Demo creada: ${form.email}` })
      setModal(null); setForm({})
      cargarDemos()
    } catch(e) { setMsg({ tipo:'error', texto: e.message }) }
    setProcesando(false)
  }

  async function crearCliente() {
    if (!form.nombre || !form.email || !form.plan) return setMsg({ tipo:'error', texto:'Nombre, email y plan son requeridos' })
    setProcesando(true); setMsg(null)
    try {
      const data = await llamarEF('crear', { ...form, sistemas: form.sistemas || ['Consorcios'] })
      setMsg({ tipo:'ok', texto: data.mensaje })
      setModal(null); setForm({}); cargarDashboard()
    } catch(e) { setMsg({ tipo:'error', texto: e.message }) }
    setProcesando(false)
  }

  async function registrarPago() {
    if (!clienteSel) return
    setProcesando(true); setMsg(null)
    try {
      const data = await llamarEF('registrar_pago', { cliente_id: clienteSel.id, ...form })
      setMsg({ tipo:'ok', texto: data.mensaje })
      setModal(null); setForm({}); setClienteSel(null); cargarDashboard()
    } catch(e) { setMsg({ tipo:'error', texto: e.message }) }
    setProcesando(false)
  }

  async function accionCliente(accion, cliente, extra = {}) {
    if (!confirm(`¿Confirmar: ${accion} para ${cliente.nombre}?`)) return
    setProcesando(true)
    try {
      const data = await llamarEF(accion, { cliente_id: cliente.id, ...extra })
      setMsg({ tipo:'ok', texto: data.mensaje || 'OK' }); cargarDashboard()
    } catch(e) { setMsg({ tipo:'error', texto: e.message }) }
    setProcesando(false)
  }

  async function enviarAvisos() {
    setProcesando(true); setMsg(null)
    try {
      const data = await llamarEF('enviar_avisos_pendientes')
      setMsg({ tipo:'ok', texto: data.mensaje || `${data.enviados || 0} avisos enviados` })
      cargarDashboard()
    } catch(e) { setMsg({ tipo:'error', texto: e.message }) }
    setProcesando(false)
  }

  useEffect(() => { cargarDashboard() }, [])
  useEffect(() => { if (tab === 'demos') cargarDemos() }, [tab])

  const stats    = dashData?.stats || {}
  const clientes = dashData?.clientes || []
  const pagosRec = dashData?.pagos_recientes || []
  const avisos   = dashData?.mensajes_pendientes_lista || []

  // ── estilos inline ──
  const S = {
    card:  { background:'#fff', borderRadius:10, border:'1px solid #E5E7EB', padding:16, marginBottom:16 },
    th:    { padding:'7px 10px', textAlign:'left', color:GR, fontWeight:600, fontSize:12, background:'#F9FAFB' },
    td:    { padding:'7px 10px', fontSize:13, borderBottom:'1px solid #F3F4F6', verticalAlign:'middle' },
    btnPri:{ padding:'8px 16px', borderRadius:6, background:AZ, color:'#fff', border:'none', cursor:'pointer', fontSize:13, fontWeight:600 },
    btnSec:{ padding:'6px 12px', borderRadius:6, background:'#F3F4F6', color:'#374151', border:'none', cursor:'pointer', fontSize:12 },
    btnSm: (bg,c='#fff') => ({ padding:'3px 9px', borderRadius:5, background:bg, color:c, border:'none', cursor:'pointer', fontSize:11, fontWeight:600 }),
    input: { width:'100%', padding:'8px 10px', border:'1px solid #D1D5DB', borderRadius:6, fontSize:13, outline:'none' },
    label: { fontSize:12, color:GR, marginBottom:4, display:'block' },
    row2:  { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 },
  }

  const etiqueta = (est) => (
    <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:EST_BG[est]||'#F3F4F6', color:EST_COLOR[est]||GR }}>
      {EST_LABEL[est]||est}
    </span>
  )

  if (cargando) return <div style={{ padding:40, textAlign:'center', color:GR }}>Cargando Clientes GASP…</div>

  return (
    <div>
      {/* ENCABEZADO */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:700, margin:0 }}>🏢 Clientes GASP</h2>
          <p style={{ fontSize:13, color:GR, margin:'4px 0 0' }}>Cobranza y suscripciones</p>
        </div>
        <button style={S.btnPri} onClick={() => { setModal('nuevo_cliente'); setForm({ sistemas:['Consorcios'], plan:'mensual', moneda_cobro:'USD', precio_usd:25 }) }}>
          + Nuevo cliente
        </button>
      </div>

      {/* MENSAJE */}
      {msg && (
        <div onClick={() => setMsg(null)} style={{ padding:'10px 14px', borderRadius:8, marginBottom:16, fontSize:13, cursor:'pointer',
          background: msg.tipo==='ok' ? '#D1FAE5' : '#FEE2E2', color: msg.tipo==='ok' ? '#166534' : '#991B1B' }}>
          {msg.texto}
        </div>
      )}

      {/* TABS */}
      <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'2px solid #E5E7EB' }}>
        {[['dashboard','📊 Dashboard'],['demos','🚀 Demos'],['clientes','👥 Clientes'],['pagos','💰 Pagos'],['avisos','🔔 Avisos']].map(([id,lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding:'8px 16px', border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
            background:'none', marginBottom:-2,
            borderBottom: tab===id ? '2px solid '+AZ : '2px solid transparent',
            color: tab===id ? AZ : GR }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD ── */}
      {tab === 'dashboard' && (
        <div>
          {/* KPIs */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
            {[
              { icon:'✅', label:'Clientes activos',       value: stats.activos||0,             bg:'#D1FAE5', color:'#166534' },
              { icon:'⚠️', label:'Por vencer / Vencidos', value:`${stats.por_vencer||0} / ${stats.vencidos||0}`, bg:'#FEF3C7', color:'#92400E' },
              { icon:'⛔', label:'Suspendidos',            value: stats.suspendidos||0,          bg:'#FEE2E2', color:'#991B1B' },
              { icon:'💵', label:'Ingreso est. mensual',  value:`USD ${Math.round(stats.ingreso_mensual_usd||0)}`, bg:'#DBEAFE', color:AZ },
            ].map((k,i) => (
              <div key={i} style={{ background:k.bg, borderRadius:10, padding:16 }}>
                <div style={{ fontSize:20 }}>{k.icon}</div>
                <div style={{ fontSize:22, fontWeight:800, color:k.color, marginTop:4 }}>{k.value}</div>
                <div style={{ fontSize:12, color:GR, marginTop:4 }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Alertas */}
          {(stats.vencidos > 0 || stats.suspendidos > 0 || stats.mensajes_pendientes > 0) && (
            <div style={{ background:'#FEF3C7', border:'1px solid #F59E0B', borderRadius:10, padding:14, marginBottom:20, fontSize:13 }}>
              <div style={{ fontWeight:700, color:'#92400E', marginBottom:8 }}>⚠️ Atención requerida</div>
              {stats.vencidos > 0 && <div style={{ color:'#92400E' }}>🔴 {stats.vencidos} cliente{stats.vencidos>1?'s':''} con suscripción vencida</div>}
              {stats.suspendidos > 0 && <div style={{ color:'#991B1B' }}>⛔ {stats.suspendidos} cliente{stats.suspendidos>1?'s':''} suspendido{stats.suspendidos>1?'s':''}</div>}
              {stats.mensajes_pendientes > 0 && (
                <div style={{ color:AZ }}>
                  🔔 {stats.mensajes_pendientes} aviso{stats.mensajes_pendientes>1?'s':''} pendiente{stats.mensajes_pendientes>1?'s':''} →{' '}
                  <button onClick={() => setTab('avisos')} style={{ background:'none', border:'none', cursor:'pointer', color:AZ, fontWeight:700, textDecoration:'underline', fontSize:13 }}>Ver avisos</button>
                </div>
              )}
            </div>
          )}

          {/* Últimos pagos */}
          <div style={S.card}>
            <div style={{ fontWeight:700, fontSize:14, marginBottom:12 }}>💰 Últimos pagos recibidos</div>
            {pagosRec.length === 0 ? (
              <div style={{ color:'#9CA3AF', fontSize:13 }}>Sin pagos registrados aún</div>
            ) : (
              <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
                <thead>
                  <tr>{['ID','Cliente','Fecha','Importe','Medio','Período hasta'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {pagosRec.slice(0,10).map(p => {
                    const cli = clientes.find(c => c.id === p.cliente_id)
                    return (
                      <tr key={p.id}>
                        <td style={{ ...S.td, color:'#9CA3AF', fontSize:11 }}>{p.id}</td>
                        <td style={{ ...S.td, fontWeight:600 }}>{cli?.nombre || p.cliente_id}</td>
                        <td style={S.td}>{p.fecha_pago}</td>
                        <td style={{ ...S.td, fontWeight:700, color:'#166534' }}>{p.moneda} {p.importe}</td>
                        <td style={S.td}>{p.medio_pago}</td>
                        <td style={S.td}>{p.periodo_hasta || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── DEMOS ── */}
      {tab === 'demos' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div style={{ fontSize:14, fontWeight:600 }}>Demos activas — GASP Consorcios</div>
            <button style={S.btnPri} onClick={() => { setModal('nueva_demo'); setForm({ sistemas:['Consorcios'] }) }}>
              + Nueva demo
            </button>
          </div>
          {cargandoDemos ? (
            <div style={{ color:GR, fontSize:13 }}>Cargando…</div>
          ) : demos.length === 0 ? (
            <div style={{ ...S.card, color:GR, fontSize:13 }}>No hay demos activas para GASP Consorcios.</div>
          ) : (
            <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse', background:'#fff', borderRadius:10, overflow:'hidden', border:'1px solid #E5E7EB' }}>
              <thead><tr>{['Nombre','Email','Vence','Activo','Acciones'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {demos.map(d => (
                  <tr key={d.admin_id}>
                    <td style={{ ...S.td, fontWeight:600 }}>{d.nombre}</td>
                    <td style={S.td}>{d.email}</td>
                    <td style={S.td}>{d.fecha_expiracion}</td>
                    <td style={S.td}>{d.activo ? <span style={{ color:'#166534', fontWeight:700 }}>✅ Sí</span> : <span style={{ color:GR }}>No</span>}</td>
                    <td style={S.td}>
                      {d.activo && (
                        <button onClick={async () => {
                          if (!confirm(`¿Desactivar demo de ${d.nombre}?`)) return
                          await supabase.from('usuarios_demo').update({ activo:false }).eq('admin_id', d.admin_id)
                          setMsg({ tipo:'ok', texto:`Demo ${d.nombre} desactivada` }); cargarDemos()
                        }} style={S.btnSm('#9CA3AF')}>Desactivar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── CLIENTES ── */}
      {tab === 'clientes' && (
        <div>
          {clientes.length === 0 ? (
            <div style={{ ...S.card, color:GR, fontSize:13, textAlign:'center', padding:32 }}>
              <div style={{ fontSize:28, marginBottom:8 }}>👥</div>
              No hay clientes aún. Creá el primero con el botón + Nuevo cliente.
            </div>
          ) : (
            <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse', background:'#fff', borderRadius:10, overflow:'hidden', border:'1px solid #E5E7EB' }}>
              <thead><tr>{['ID','Nombre','Email','Plan','Sistemas','Estado','Próx. vto','Saldo','Acciones'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {clientes.map(c => (
                  <tr key={c.id} style={{ cursor:'pointer' }} onClick={() => { setClienteSel(c); setModal('detalle') }}>
                    <td style={{ ...S.td, fontSize:11, color:'#9CA3AF', fontFamily:'monospace' }}>{c.id?.slice(-6)}</td>
                    <td style={{ ...S.td, fontWeight:600 }}>{c.nombre}</td>
                    <td style={S.td}>{c.email}</td>
                    <td style={S.td}><span style={{ textTransform:'capitalize' }}>{c.plan}</span></td>
                    <td style={{ ...S.td, fontSize:11 }}>{(c.sistemas||[]).join(', ')}</td>
                    <td style={S.td}>{etiqueta(c.estado)}</td>
                    <td style={S.td}>{c.fecha_proximo_vto || '—'}</td>
                    <td style={{ ...S.td, color: parseFloat(c.saldo_deuda)>0 ? '#991B1B':'#166534', fontWeight:700 }}>
                      {parseFloat(c.saldo_deuda)>0 ? `USD ${c.saldo_deuda}` : '—'}
                    </td>
                    <td style={S.td} onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4 }}>
                        <button onClick={() => { setClienteSel(c); setModal('pago'); setForm({ moneda:'USD', medio_pago:'transferencia' }) }} style={S.btnSm('#166534')}>💰 Pago</button>
                        {c.estado === 'activo' && <button onClick={() => accionCliente('suspender', c)} style={S.btnSm('#991B1B')}>⛔</button>}
                        {c.estado === 'suspendido' && <button onClick={() => accionCliente('reactivar', c)} style={S.btnSm(AZ)}>▶ Reactivar</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── PAGOS ── */}
      {tab === 'pagos' && (
        <div style={S.card}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:12 }}>💰 Historial de pagos</div>
          {pagosRec.length === 0 ? (
            <div style={{ color:GR, fontSize:13 }}>Sin pagos registrados aún.</div>
          ) : (
            <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
              <thead><tr>{['ID','Cliente','Fecha pago','Importe','Moneda','Medio','Período','Comprobante'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {pagosRec.map(p => {
                  const cli = clientes.find(c => c.id === p.cliente_id)
                  return (
                    <tr key={p.id}>
                      <td style={{ ...S.td, fontSize:11, fontFamily:'monospace' }}>{p.id?.slice(-8)}</td>
                      <td style={{ ...S.td, fontWeight:600 }}>{cli?.nombre || p.cliente_id}</td>
                      <td style={S.td}>{p.fecha_pago}</td>
                      <td style={{ ...S.td, fontWeight:700, color:'#166534' }}>{p.importe}</td>
                      <td style={S.td}>{p.moneda}</td>
                      <td style={S.td}>{p.medio_pago}</td>
                      <td style={S.td}>{p.periodo_hasta ? `hasta ${p.periodo_hasta}` : '—'}</td>
                      <td style={{ ...S.td, fontSize:11, color:'#9CA3AF' }}>{p.comprobante || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── AVISOS ── */}
      {tab === 'avisos' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div style={{ fontSize:14, fontWeight:600 }}>🔔 Avisos pendientes de envío</div>
            <button onClick={enviarAvisos} disabled={procesando} style={{ ...S.btnPri, opacity: procesando ? 0.6:1 }}>
              {procesando ? 'Enviando…' : '📤 Enviar todos los avisos'}
            </button>
          </div>
          {avisos.length === 0 ? (
            <div style={{ ...S.card, color:GR, fontSize:13, textAlign:'center', padding:32 }}>
              <div style={{ fontSize:28, marginBottom:8 }}>✅</div>
              No hay avisos pendientes. Todos los clientes están al día.
            </div>
          ) : (
            <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse', background:'#fff', borderRadius:10, overflow:'hidden', border:'1px solid #E5E7EB' }}>
              <thead><tr>{['Cliente','Email','Tipo aviso','Días','Estado','Acción'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {avisos.map((a,i) => (
                  <tr key={i}>
                    <td style={{ ...S.td, fontWeight:600 }}>{a.nombre}</td>
                    <td style={S.td}>{a.email}</td>
                    <td style={S.td}>{a.tipo_aviso}</td>
                    <td style={{ ...S.td, color:'#92400E', fontWeight:700 }}>{a.dias_vto != null ? `${a.dias_vto}d` : '—'}</td>
                    <td style={S.td}>{etiqueta(a.estado)}</td>
                    <td style={S.td}>
                      <button onClick={() => llamarEF('marcar_enviado', { cliente_id: a.id, tipo: a.tipo_aviso }).then(() => cargarDashboard())} style={S.btnSm('#6B7280')}>✓ Marcar enviado</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ══ MODALES ══ */}

      {/* Modal: Nuevo Cliente */}
      {modal === 'nuevo_cliente' && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:12, padding:28, width:520, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:20 }}>+ Nuevo cliente GASP Consorcios</div>
            <div style={S.row2}>
              <div><label style={S.label}>Nombre / Razón social *</label><input style={S.input} value={form.nombre||''} onChange={e=>setForm({...form,nombre:e.target.value})} /></div>
              <div><label style={S.label}>Email *</label><input style={S.input} type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})} /></div>
            </div>
            <div style={S.row2}>
              <div><label style={S.label}>Teléfono / WhatsApp</label><input style={S.input} value={form.telefono||''} onChange={e=>setForm({...form,telefono:e.target.value})} /></div>
              <div><label style={S.label}>Localidad</label><input style={S.input} value={form.localidad||''} onChange={e=>setForm({...form,localidad:e.target.value})} /></div>
            </div>
            <div style={S.row2}>
              <div>
                <label style={S.label}>Plan *</label>
                <select style={{ ...S.input }} value={form.plan||'mensual'} onChange={e=>setForm({...form,plan:e.target.value})}>
                  {PLANES.map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Sistemas contratados</label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:4 }}>
                  {SISTEMAS_DISP.map(s => (
                    <label key={s} style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, cursor:'pointer' }}>
                      <input type="checkbox" checked={(form.sistemas||['Consorcios']).includes(s)}
                        onChange={e => {
                          const prev = form.sistemas || ['Consorcios']
                          setForm({ ...form, sistemas: e.target.checked ? [...prev,s] : prev.filter(x=>x!==s) })
                        }} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div style={S.row2}>
              <div><label style={S.label}>Precio USD</label><input style={S.input} type="number" value={form.precio_usd||25} onChange={e=>setForm({...form,precio_usd:parseFloat(e.target.value)})} /></div>
              <div>
                <label style={S.label}>Moneda de cobro</label>
                <select style={{ ...S.input }} value={form.moneda_cobro||'USD'} onChange={e=>setForm({...form,moneda_cobro:e.target.value})}>
                  <option value="USD">USD</option><option value="ARS">ARS</option>
                </select>
              </div>
            </div>
            <div style={S.row2}>
              <div><label style={S.label}>Fecha inicio cobro</label><input style={S.input} type="date" value={form.fecha_inicio_cobro||''} onChange={e=>setForm({...form,fecha_inicio_cobro:e.target.value})} /></div>
              <div><label style={S.label}>Día vto. mensual</label><input style={S.input} type="number" min={1} max={28} value={form.dia_vto_mensual||10} onChange={e=>setForm({...form,dia_vto_mensual:parseInt(e.target.value)})} /></div>
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={S.label}>Notas de cobro</label>
              <textarea style={{ ...S.input, height:60, resize:'vertical' }} value={form.notas_cobro||''} onChange={e=>setForm({...form,notas_cobro:e.target.value})} />
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => { setModal(null); setForm({}) }} style={S.btnSec}>Cancelar</button>
              <button onClick={crearCliente} disabled={procesando} style={{ ...S.btnPri, opacity:procesando?0.6:1 }}>
                {procesando ? 'Guardando…' : 'Crear cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nueva Demo */}
      {modal === 'nueva_demo' && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:12, padding:28, width:420, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:20 }}>🚀 Nueva demo GASP Consorcios</div>
            <div style={{ marginBottom:10 }}><label style={S.label}>Nombre completo *</label><input style={S.input} value={form.nombre||''} onChange={e=>setForm({...form,nombre:e.target.value})} /></div>
            <div style={{ marginBottom:10 }}><label style={S.label}>Email *</label><input style={S.input} type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Contraseña inicial *</label><input style={S.input} type="password" value={form.password||''} onChange={e=>setForm({...form,password:e.target.value})} /></div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => { setModal(null); setForm({}) }} style={S.btnSec}>Cancelar</button>
              <button onClick={crearDemo} disabled={procesando} style={{ ...S.btnPri, opacity:procesando?0.6:1 }}>
                {procesando ? 'Creando…' : 'Crear demo (7 días)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Registrar Pago */}
      {modal === 'pago' && clienteSel && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:12, padding:28, width:420, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>💰 Registrar pago</div>
            <div style={{ fontSize:13, color:GR, marginBottom:20 }}>{clienteSel.nombre} · {clienteSel.plan}</div>
            <div style={S.row2}>
              <div><label style={S.label}>Importe *</label><input style={S.input} type="number" step="0.01" value={form.importe||''} onChange={e=>setForm({...form,importe:parseFloat(e.target.value)})} /></div>
              <div>
                <label style={S.label}>Moneda</label>
                <select style={{ ...S.input }} value={form.moneda||'USD'} onChange={e=>setForm({...form,moneda:e.target.value})}>
                  <option value="USD">USD</option><option value="ARS">ARS</option>
                </select>
              </div>
            </div>
            <div style={S.row2}>
              <div><label style={S.label}>Fecha de pago</label><input style={S.input} type="date" value={form.fecha_pago||new Date().toISOString().split('T')[0]} onChange={e=>setForm({...form,fecha_pago:e.target.value})} /></div>
              <div><label style={S.label}>Período hasta</label><input style={S.input} type="date" value={form.periodo_hasta||''} onChange={e=>setForm({...form,periodo_hasta:e.target.value})} /></div>
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={S.label}>Medio de pago</label>
              <select style={{ ...S.input }} value={form.medio_pago||'transferencia'} onChange={e=>setForm({...form,medio_pago:e.target.value})}>
                {MEDIOS_PAGO.map(m=><option key={m} value={m}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Comprobante / Referencia</label><input style={S.input} value={form.comprobante||''} onChange={e=>setForm({...form,comprobante:e.target.value})} /></div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => { setModal(null); setClienteSel(null); setForm({}) }} style={S.btnSec}>Cancelar</button>
              <button onClick={registrarPago} disabled={procesando} style={{ ...S.btnPri, opacity:procesando?0.6:1 }}>
                {procesando ? 'Guardando…' : 'Registrar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Detalle Cliente */}
      {modal === 'detalle' && clienteSel && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:12, padding:28, width:520, maxHeight:'85vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:16 }}>{clienteSel.nombre}</div>
              {etiqueta(clienteSel.estado)}
            </div>
            {[
              ['Email', clienteSel.email],
              ['Teléfono', clienteSel.telefono || '—'],
              ['Localidad', clienteSel.localidad || '—'],
              ['Plan', clienteSel.plan],
              ['Sistemas', (clienteSel.sistemas||[]).join(', ')],
              ['Precio', `${clienteSel.moneda_cobro} ${clienteSel.precio_usd}`],
              ['Próx. vencimiento', clienteSel.fecha_proximo_vto || '—'],
              ['Último pago', clienteSel.fecha_ultimo_pago || '—'],
              ['Saldo deuda', parseFloat(clienteSel.saldo_deuda||0) > 0 ? `USD ${clienteSel.saldo_deuda}` : 'Sin deuda'],
              ['Meses deuda', clienteSel.meses_deuda || 0],
            ].map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #F3F4F6', fontSize:13 }}>
                <span style={{ color:GR }}>{k}</span>
                <span style={{ fontWeight:600 }}>{v}</span>
              </div>
            ))}
            {clienteSel.notas_cobro && (
              <div style={{ marginTop:12, padding:10, background:'#F9FAFB', borderRadius:6, fontSize:12, color:GR }}>
                📝 {clienteSel.notas_cobro}
              </div>
            )}
            <div style={{ display:'flex', gap:8, marginTop:20, flexWrap:'wrap' }}>
              <button onClick={() => { setModal('pago'); setForm({ moneda:'USD', medio_pago:'transferencia' }) }} style={S.btnPri}>💰 Registrar pago</button>
              {clienteSel.estado === 'activo' && <button onClick={() => { accionCliente('suspender', clienteSel); setModal(null) }} style={S.btnSm('#991B1B')}>⛔ Suspender</button>}
              {clienteSel.estado === 'suspendido' && <button onClick={() => { accionCliente('reactivar', clienteSel); setModal(null) }} style={S.btnSm(AZ)}>▶ Reactivar</button>}
              <button onClick={() => { setModal(null); setClienteSel(null) }} style={S.btnSec}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



export default function App() {
  const [cargando, setCargando]           = useState(true)
  const [pagina, setPagina]               = useState('dashboard')
  const [menuAbierto, setMenuAbierto]     = useState(false)
  const [isMobile, setIsMobile]           = useState(false)
  const [consorcios, setConsorcios]       = useState([])
  const [consorcioActivo, setConsorcioActivo] = useState(null)
  const [unidades, setUnidades]           = useState([])
  const [copropietarios, setCopropietarios] = useState([])
  const [adminPerfil, setAdminPerfil]     = useState({})
  const [expensas, setExpensas]           = useState([])
  const [proveedores, setProveedores]     = useState([])
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
    const [u,cp,exp,prov]=await Promise.all([
      supabase.from('con_unidades').select('*').eq('admin_id',uid||session?.user?.id).eq('consorcio_id',cid).order('numero'),
      supabase.from('con_copropietarios').select('*').eq('admin_id',uid||session?.user?.id).eq('consorcio_id',cid).order('apellido_nombre'),
      supabase.from('con_expensas').select('*').eq('admin_id',uid||session?.user?.id).eq('consorcio_id',cid).order('periodo',{ascending:false}),
      supabase.from('con_proveedores').select('*').eq('admin_id',uid||session?.user?.id).or(`consorcio_id.eq.${cid},consorcio_id.is.null`).order('razon_social')
    ])
    setUnidades(u.data||[]); setCopropietarios(cp.data||[]); setExpensas(exp.data||[]); setProveedores(prov.data||[])
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
    const uid=uid
    if (formCon.id) {
      await supabase.from('con_consorcios').update(formCon).eq('id',formCon.id)
    } else {
      const id=nextId(consorcios,'CON')
      await supabase.from('con_consorcios').insert([{ ...formCon, id, admin_id:uid, activo:true }])
    }
    setFormCon(null); setMsgCon({ tipo:'ok', texto:'✓ Consorcio guardado' }); cargar()
  }

  const NAV=[
    { id:'dashboard',           label:'Dashboard',              icon:'📊', sec:'Inicio' },
    { id:'listado_consorcios',  label:'Mis Consorcios',         icon:'🏛️', sec:'Consorcio' },
    { id:'unidades',            label:'Unidades (UFs)',         icon:'🏢', sec:'Consorcio' },
    { id:'copropietarios',      label:'Copropietarios',         icon:'👤', sec:'Consorcio' },
    { id:'cta_corriente',       label:'Cta. corriente UF',     icon:'📋', sec:'Consorcio' },
    { id:'reclamos',            label:'Reclamos / Tickets',     icon:'🎫', sec:'Consorcio' },
    { id:'cert_libre_deuda',    label:'Certificado Libre Deuda',icon:'📜', sec:'Consorcio' },
    { id:'rendicion_cuentas',   label:'Rendición de cuentas',   icon:'📊', sec:'Expensas' },
    { id:'liquidacion',         label:'Liquidar período',       icon:'📝', sec:'Expensas' },
    { id:'expensas',            label:'Períodos',               icon:'📅', sec:'Expensas' },
    { id:'periodos',            label:'Control períodos',       icon:'🔒', sec:'Expensas' },
    { id:'historial_liquidaciones', label:'Historial Liquidaciones', icon:'📂', sec:'Expensas' },
    { id:'cobranzas',           label:'Cobranzas',              icon:'💳', sec:'Cobranzas' },
    { id:'cobranzas_auto',      label:'Cobranzas automáticas',  icon:'🏦', sec:'Cobranzas' },
    { id:'generar_debito',      label:'Generar débito',         icon:'📤', sec:'Cobranzas' },
    { id:'anular_cobranza',     label:'Anular cobranzas',       icon:'↩️', sec:'Cobranzas' },
    { id:'mora_diferencial',    label:'Interés por mora',       icon:'⚖️', sec:'Cobranzas' },
    { id:'morosos',             label:'Morosos',                icon:'⚠️', sec:'Cobranzas' },
    { id:'recibos',             label:'Recibos de pago',        icon:'🧾', sec:'Cobranzas' },
    { id:'proveedores',         label:'Proveedores',            icon:'🔧', sec:'Proveedores' },
    { id:'comprobantes',        label:'Comprobantes',           icon:'🧾', sec:'Proveedores' },
    { id:'pagos_prov',          label:'Pagos',                  icon:'💸', sec:'Proveedores' },
    { id:'cta_proveedor',       label:'Cta. corriente prov.',   icon:'📊', sec:'Proveedores' },
    { id:'sueldos',             label:'Sueldos',                icon:'💼', sec:'Contabilidad' },
    { id:'cuentas_banco',       label:'Cuentas bancarias',      icon:'🏛️', sec:'Contabilidad' },
    { id:'mov_entre_cuentas',   label:'Mov. entre cuentas',     icon:'↔️', sec:'Contabilidad' },
    { id:'mov_varios',          label:'Movimientos varios',     icon:'🔄', sec:'Contabilidad' },
    { id:'movimientos',         label:'Notas Déb/Cré UF',      icon:'↕️', sec:'Contabilidad' },
    { id:'reporte_movimientos', label:'Movim. por período',     icon:'📈', sec:'Reportes' },
    { id:'estado_financiero',   label:'Estado financiero',      icon:'🏦', sec:'Reportes' },
    { id:'balance_anual',       label:'Balance Anual',          icon:'📊', sec:'Reportes' },
    { id:'asambleas',           label:'Asambleas',              icon:'🏛', sec:'Comunicaciones' },
    { id:'emails',              label:'Enviar liquidación',     icon:'✉️', sec:'Comunicaciones' },
    { id:'notificacion',        label:'Enviar notificación',    icon:'📣', sec:'Comunicaciones' },
    { id:'consultar_enviados',  label:'Consultar enviados',     icon:'📂', sec:'Comunicaciones' },
    { id:'email_tracking',      label:'Seguimiento liquidaciones',icon:'📬',sec:'Comunicaciones' },
    { id:'agenda_venc',         label:'Agenda vencimientos',    icon:'📅', sec:'Comunicaciones' },
    { id:'plan_cuentas',        label:'Plan de cuentas',        icon:'📑', sec:'Configuración' },
    { id:'grupos_liquidacion',  label:'Grupos de liquidación',  icon:'🗂️', sec:'Configuración' },
    { id:'importar',            label:'Importar datos',         icon:'📥', sec:'Configuración' },
    { id:'importar_pdf',        label:'Migrar desde PDF (IA)',   icon:'🤖', sec:'Configuración' },
    { id:'equipo',              label:'Equipo',                 icon:'👥', sec:'Configuración' },
    { id:'perfil',              label:'Mi perfil',              icon:'⚙️', sec:'Configuración' },
    ...(esSuperAdmin?[{id:'clientes',label:'Clientes GASP',icon:'🏢',sec:'Configuración'}]:[]),
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


  const cid=consorcioActivo?.id
  const renderPagina=()=>{
    if (!cid&&pagina!=='dashboard') return <Card style={{ textAlign:'center', padding:40, color:GR }}>Seleccioná un consorcio primero.</Card>
    switch(pagina) {
      case 'dashboard':      return <Dashboard consorcios={consorcios} consorcioActivo={consorcioActivo} unidades={unidades} copropietarios={copropietarios} formCon={formCon} setFormCon={setFormCon} msgCon={msgCon} guardarConsorcio={guardarConsorcio} setConsorcioActivo={setConsorcioActivo} cargarConsorcio={cargarConsorcio} setPagina={setPagina} />
      case 'listado_consorcios': return <ListadoConsorcios session={session} consorcios={consorcios} />
      case 'unidades':       return <Unidades session={session} consorcioId={cid} copropietarios={copropietarios} []={[]} />
      case 'copropietarios': return <Copropietarios session={session} consorcioId={cid} (() => {})={setCopropietarios} />
      case 'sueldos':        return <Sueldos session={session} consorcioId={cid} consorcioActivo={consorcioActivo} expensas={expensas} />
      case 'liquidacion':    return <LiquidacionPeriodo session={session} consorcioId={cid} consorcioActivo={consorcioActivo} unidades={unidades} copropietarios={copropietarios} adminPerfil={adminPerfil} expensas={expensas} setExpensas={setExpensas} cargar={()=>cargarConsorcio(cid, session?.user?.id)} setPagina={setPagina} />
      case 'expensas':       return <Expensas session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} adminPerfil={adminPerfil} />
      case 'cobranzas':      return <Cobranzas session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} adminPerfil={adminPerfil} />
      case 'morosos':        return <Morosos session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} />
      case 'proveedores':    return <Proveedores session={session} consorcioId={cid} />
      case 'asambleas':        return <Asambleas session={session} consorcioId={cid} consorcioActivo={consorcioActivo} unidades={unidades} copropietarios={copropietarios} expensas={expensas} />
      case 'reclamos':          return <Reclamos session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} />
      case 'historial_liquidaciones': return <HistorialLiquidaciones session={session} consorcioId={cid} consorcioActivo={consorcioActivo} consorcios={consorcios} />;
      case 'agenda_venc':        return <AgendaVencimientos session={session} consorcioId={cid} consorcioActivo={consorcioActivo} proveedores={proveedores} />
      case 'rendicion_cuentas':  return <RendicionCuentas session={session} consorcioId={cid} consorcioActivo={consorcioActivo} expensas={expensas} copropietarios={copropietarios} unidades={unidades} />
      case 'cert_libre_deuda':  return <CertificadoLibreDeuda session={session} consorcioId={cid} consorcioActivo={consorcioActivo} unidades={unidades} copropietarios={copropietarios} expensas={expensas} />
      case 'equipo':         return <Equipo session={session} />
      case 'perfil':         return <PerfilAdmin session={session} />
      case 'plan_cuentas':     return <PlanCuentas session={session} consorcioId={cid} />
      case 'grupos_liquidacion': return <GruposLiquidacion session={session} consorcioId={cid} consorcioActivo={consorcioActivo} />
      case 'mora_diferencial': return <MoraDiferencial session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} />
      case 'mov_varios':       return <MovimientosVarios session={session} consorcioId={cid} expensas={expensas} />
      case 'reporte_movimientos': return <ReporteMovimientos session={session} consorcioId={cid} consorcioActivo={consorcioActivo} expensas={expensas} />
      case 'estado_financiero':   return <EstadoFinanciero session={session} consorcioId={cid} consorcioActivo={consorcioActivo} />
      case 'balance_anual':       return <BalanceAnual session={session} consorcioId={cid} consorcioActivo={consorcioActivo} adminPerfil={adminPerfil} />
      case 'anular_cobranza':     return <AnularCobranzas session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} expensas={expensas} />
      case 'comprobantes':   return <Comprobantes session={session} consorcioId={cid} proveedores={proveedores} expensas={expensas} />
      case 'pagos_prov':     return <PagosProveedor session={session} consorcioId={cid} proveedores={proveedores} />
      case 'cta_proveedor':  return <CtaProveedor session={session} consorcioId={cid} proveedores={proveedores} />
      case 'cta_corriente':
  return <CtaCorriente session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} />
      case 'movimientos':    return <MovimientosUnidad session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} expensas={expensas} />
      case 'periodos':       return <ControlPeriodos session={session} consorcioId={cid} consorcioActivo={consorcioActivo} expensas={expensas} />
      case 'importar':       return <ImportarExcel session={session} consorcioId={cid} onDone={() => { cargar(); setPagina('unidades') }} />
      case 'importar_pdf':   return <ImportarPDF session={session} consorcioId={cid} consorcioActivo={consorcioActivo} onDone={() => { cargar(); setPagina('dashboard') }} />
      case 'cobranzas_auto':  return <CobranzasAutomaticas session={session} consorcioId={cid} consorcioActivo={consorcioActivo} unidades={unidades} copropietarios={copropietarios} expensas={expensas} />
      case 'generar_debito':  return <GenerarDebito session={session} consorcioId={cid} consorcioActivo={consorcioActivo} unidades={unidades} copropietarios={copropietarios} expensas={expensas} />
      case 'recibos':          return <ReciboPago session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} expensas={expensas} consorcioActivo={consorcioActivo} />
      case 'cuentas_banco':    return <CuentasBancarias session={session} consorcioId={cid} consorcioActivo={consorcioActivo} />
      case 'mov_entre_cuentas': return <MovEntrecuentas session={session} consorcioId={cid} />
      case 'email_tracking': return <EmailTracking session={session} consorcioId={cid} />
      case 'emails':             return <EnviarEmails session={session} consorcioId={cid} unidades={unidades} adminPerfil={adminPerfil} />
      case 'notificacion':       return <EnviarNotificacion session={session} consorcioId={cid} consorcioActivo={consorcioActivo} unidades={unidades} copropietarios={copropietarios} adminPerfil={adminPerfil} />
      case 'consultar_enviados': return <ConsultarEnviados session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} />
      case 'clientes':       return <ClientesGASP session={session} />
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
          {/* Selector de consorcio en sidebar */}
          <div style={{ marginTop:8 }}>
            <select
              value={consorcioActivo?.id || ''}
              onChange={e => {
                const c = consorcios.find(x => x.id === e.target.value)
                if (c) {
                  setConsorcioActivo(c)
                  cargarConsorcio(c.id, session?.user?.id)
                }
              }}
              style={{
                width:'100%', padding:'6px 8px',
                background:'rgba(26,63,160,0.3)',
                border:'1px solid rgba(122,172,255,0.3)',
                borderRadius:6, color:'#7ab4ff',
                fontSize:11, fontWeight:700,
                cursor:'pointer', outline:'none',
              }}>
              {consorcios.length === 0 && (
                <option value="">Sin consorcios</option>
              )}
              {consorcios.map(c => (
                <option key={c.id} value={c.id}
                  style={{ background:'#0f1f3d', color:'#fff' }}>
                  {c.nombre}
                </option>
              ))}
            </select>
            {consorcioActivo && (
              <div style={{ fontSize:9, color:'#4a6a8a', marginTop:3, textAlign:'center' }}>
                {unidades.length} UFs · {consorcioActivo.banco || 'Sin banco'}
              </div>
            )}
          </div>
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
          {consorcioActivo && (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <select
                value={consorcioActivo?.id || ''}
                onChange={e => {
                  const c = consorcios.find(x => x.id === e.target.value)
                  if (c) { setConsorcioActivo(c); cargarConsorcio(c.id, session?.user?.id) }
                }}
                style={{ padding:'4px 10px', borderRadius:20, border:'1px solid #e5e7eb',
                  background:'#f3f4f6', fontSize:12, color:'#374151',
                  fontWeight:600, cursor:'pointer', outline:'none', maxWidth:220 }}>
                {consorcios.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
          )}
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
