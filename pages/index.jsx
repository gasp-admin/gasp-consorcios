import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(SUPA_URL, SUPA_KEY)

const SUPERADMIN = 'javiergp@live.com.ar'

// ── COLORES ──────────────────────────────────────────────────────────────────
const AZ  = '#1A3FA0'
const VD  = '#1B6B35'
const RJ  = '#B91C1C'
const AM  = '#C07D10'
const GR  = '#6B7280'
const BG  = '#080D1A'
const AZ2 = '#1e4db7'

// ── HELPERS ───────────────────────────────────────────────────────────────────
const fmt = n => n ? '$' + Number(n).toLocaleString('es-AR') : '$0'
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR') : '—'
const nextId = (items, prefix) => {
  const nums = (items||[]).map(x=>x.id||'').filter(id=>id.startsWith(prefix))
    .map(id=>parseInt(id.slice(prefix.length),10)).filter(n=>!isNaN(n))
  return prefix + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3,'0')
}
const periodoLabel = p => {
  if (!p) return '—'
  const [y,m] = p.split('-')
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${meses[parseInt(m)-1]} ${y}`
}

// ── UI BASE ───────────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return <div style={{ background:'#fff', border:'0.5px solid #ddd', borderRadius:10, padding:16, ...style }}>{children}</div>
}
function Btn({ children, onClick, color, small, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: small ? '5px 12px' : '8px 18px', borderRadius:7, border:'none',
        background: disabled ? '#e5e7eb' : (color||AZ), color: disabled ? '#9ca3af' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer', fontSize: small ? 12 : 13,
        fontWeight:600, ...style }}>
      {children}
    </button>
  )
}
function BtnSec({ children, onClick, small, style }) {
  return (
    <button onClick={onClick}
      style={{ padding: small ? '5px 12px' : '8px 18px', borderRadius:7,
        border:'1px solid #d1d5db', background:'#fff', cursor:'pointer',
        fontSize: small ? 12 : 13, color:'#374151', ...style }}>
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
      <input type={type} value={value||''} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
          borderRadius:7, fontSize:13, fontFamily:'inherit', boxSizing:'border-box', outline:'none' }} />
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
        style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
          borderRadius:7, fontSize:13, fontFamily:'inherit', background:'#fff' }}>
        {opts.map(o => <option key={o.v||o} value={o.v||o}>{o.l||o}</option>)}
      </select>
    </div>
  )
}
function Badge({ text, color='#6b7280', bg }) {
  return (
    <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:'bold',
      background: bg||color+'20', color }}>
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
// 1. UNIDADES FUNCIONALES
// ══════════════════════════════════════════════════════════════════════════════
function Unidades({ session, consorcioId, copropietarios }) {
  const [unidades, setUnidades] = useState([])
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const F = f => setForm(x => ({ ...x, ...f }))

  async function cargar() {
    const { data } = await supabase.from('con_unidades').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .order('numero')
    setUnidades(data || [])
  }

  async function guardar() {
    if (!form.numero) return setMsg({ tipo:'warn', texto:'El número de UF es obligatorio' })
    const id = form.id || nextId(unidades, 'UF')
    const { error } = await supabase.from('con_unidades').upsert(
      { ...form, id, admin_id: session.user.id, consorcio_id: consorcioId },
      { onConflict:'id' }
    )
    if (error) return setMsg({ tipo:'error', texto:'Error: ' + error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Unidad guardada' }); cargar()
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar esta UF?')) return
    await supabase.from('con_unidades').delete().eq('id', id)
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const TIPOS = ['departamento','local','cochera','baulera','oficina','otro']
  const ESTADOS = ['ocupada','desocupada','en_venta']

  // Totales
  const totalCoef = unidades.reduce((a,u) => a + (Number(u.porcentaje_fiscal)||0), 0)

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
                const cp = copropietarios.find(c => c.id === u.propietario_id)
                const estadoColors = { ocupada:{c:VD,bg:'#dcfce7'}, desocupada:{c:AM,bg:'#fef9c3'}, en_venta:{c:AZ,bg:'#dbeafe'} }
                const ec = estadoColors[u.estado] || { c:GR, bg:'#f3f4f6' }
                return (
                  <tr key={u.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:AZ }}>{u.numero}</td>
                    <td style={{ padding:'10px 12px', textTransform:'capitalize' }}>{u.tipo}</td>
                    <td style={{ padding:'10px 12px' }}>{u.piso || '—'}</td>
                    <td style={{ padding:'10px 12px' }}>{u.superficie_cubierta ? u.superficie_cubierta + ' m²' : '—'}</td>
                    <td style={{ padding:'10px 12px', fontWeight:600 }}>{u.porcentaje_fiscal ? Number(u.porcentaje_fiscal).toFixed(4) + '%' : '—'}</td>
                    <td style={{ padding:'10px 12px' }}>{cp?.apellido_nombre || '—'}</td>
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
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .order('apellido_nombre')
    setLista(data || [])
    if (onUpdate) onUpdate(data || [])
  }

  async function guardar() {
    if (!form.apellido_nombre) return setMsg({ tipo:'warn', texto:'Nombre obligatorio' })
    const id = form.id || nextId(lista, 'CP')
    const { error } = await supabase.from('con_copropietarios').upsert(
      { ...form, id, admin_id: session.user.id, consorcio_id: consorcioId },
      { onConflict:'id' }
    )
    if (error) return setMsg({ tipo:'error', texto: error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Guardado' }); cargar()
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar copropietario?')) return
    await supabase.from('con_copropietarios').delete().eq('id', id)
    cargar()
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
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{form.id ? 'Editar copropietario' : 'Nuevo copropietario'}</div>
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
              {cp.telefono && (
                <Btn small color='#25d366' onClick={() => window.open(`https://wa.me/549${cp.telefono.replace(/\D/g,'')}`)}>
                  WhatsApp
                </Btn>
              )}
              <Btn small onClick={() => setForm({...cp})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
              <Btn small onClick={() => eliminar(cp.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
            </div>
          </Card>
        ))}
        {lista.length === 0 && (
          <Card style={{ textAlign:'center', color:GR, padding:32 }}>No hay copropietarios registrados.</Card>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. EXPENSAS — GESTIÓN COMPLETA
// ══════════════════════════════════════════════════════════════════════════════
function Expensas({ session, consorcioId, unidades, copropietarios }) {
  const [expensas, setExpensas] = useState([])
  const [selected, setSelected] = useState(null)  // expensa seleccionada para ver detalle
  const [detalles, setDetalles] = useState([])
  const [gastos, setGastos] = useState([])
  const [form, setForm] = useState(null)
  const [formGasto, setFormGasto] = useState(null)
  const [msg, setMsg] = useState(null)
  const [tab, setTab] = useState('detalle')  // detalle | gastos
  const F = f => setForm(x => ({...x,...f}))

  async function cargar() {
    const { data } = await supabase.from('con_expensas').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .order('periodo', { ascending:false })
    setExpensas(data || [])
  }

  async function cargarDetalle(expId) {
    const [d, g] = await Promise.all([
      supabase.from('con_expensas_detalle').select('*').eq('expensa_id', expId).order('created_at'),
      supabase.from('con_gastos').select('*').eq('expensa_id', expId).order('fecha')
    ])
    setDetalles(d.data || [])
    setGastos(g.data || [])
  }

  // Calcular y distribuir expensa entre unidades
  async function calcularYDistribuir(expensa) {
    if (!expensa || unidades.length === 0) return
    setMsg({ tipo:'info', texto:'⏳ Calculando distribución...' })

    // Total a distribuir = total_gastos + total_administracion
    const totalGastos = gastos.reduce((a,g) => a + Number(g.monto||0), 0)
    const totalAdmin = Number(expensa.total_administracion||0)
    const totalExpensa = totalGastos + totalAdmin

    // Actualizar total en expensa
    await supabase.from('con_expensas').update({
      total_gastos: totalGastos,
      total_expensa: totalExpensa
    }).eq('id', expensa.id)

    // Calcular coeficiente total para ajuste
    const coefTotal = unidades.reduce((a,u) => a + Number(u.porcentaje_fiscal||0), 0)
    if (coefTotal === 0) return setMsg({ tipo:'warn', texto:'Las UFs no tienen coeficiente asignado' })

    // Borrar detalles anteriores y recrear
    await supabase.from('con_expensas_detalle').delete().eq('expensa_id', expensa.id)

    const detallesNuevos = unidades.map((u,i) => {
      const coef = Number(u.porcentaje_fiscal||0)
      // Parte por coeficiente (70% del total) + parte fija igual (30% del total)
      const parteFija = totalExpensa * 0.3 / unidades.length
      const parteCoef = totalExpensa * 0.7 * (coef / coefTotal)
      const monto = Math.round((parteFija + parteCoef) * 100) / 100
      return {
        id: `DET-${expensa.id}-${u.id}`,
        admin_id: session.user.id,
        expensa_id: expensa.id,
        unidad_id: u.id,
        consorcio_id: consorcioId,
        monto,
        estado: 'pendiente'
      }
    })

    await supabase.from('con_expensas_detalle').insert(detallesNuevos)
    await cargarDetalle(expensa.id)
    setSelected({ ...expensa, total_gastos: totalGastos, total_expensa: totalExpensa })
    setMsg({ tipo:'ok', texto:`✓ Distribuido entre ${unidades.length} unidades. Total: ${fmt(totalExpensa)}` })
    cargar()
  }

  async function marcarPagada(det) {
    await supabase.from('con_expensas_detalle').update({
      estado: 'pagada',
      fecha_pago: new Date().toISOString().split('T')[0]
    }).eq('id', det.id)
    cargarDetalle(selected.id)
    setMsg({ tipo:'ok', texto:'✓ Marcado como pagado' })
  }

  async function guardarExpensa() {
    if (!form.periodo) return setMsg({ tipo:'warn', texto:'El período es obligatorio' })
    const id = form.id || nextId(expensas, 'EXP')
    const { error } = await supabase.from('con_expensas').upsert(
      { ...form, id, admin_id: session.user.id, consorcio_id: consorcioId },
      { onConflict:'id' }
    )
    if (error) return setMsg({ tipo:'error', texto: error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Expensa guardada' }); cargar()
  }

  async function guardarGasto() {
    if (!formGasto.concepto || !formGasto.monto) return setMsg({ tipo:'warn', texto:'Concepto y monto obligatorios' })
    const g = { ...formGasto, admin_id: session.user.id, consorcio_id: consorcioId, expensa_id: selected.id }
    if (formGasto.id) {
      await supabase.from('con_gastos').update(g).eq('id', formGasto.id)
    } else {
      await supabase.from('con_gastos').insert([{ ...g, id: nextId(gastos, 'GAS') }])
    }
    setFormGasto(null); cargarDetalle(selected.id)
    setMsg({ tipo:'ok', texto:'✓ Gasto registrado' })
  }

  async function generarPDF(expensa) {
    // PDF de liquidación de expensas
    const totalCobrado = detalles.filter(d=>d.estado==='pagada').reduce((a,d)=>a+Number(d.monto||0),0)
    const totalPendiente = detalles.filter(d=>d.estado!=='pagada').reduce((a,d)=>a+Number(d.monto||0),0)
    
    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:20px;color:#1a1a1a}
  .header{background:#1A3FA0;color:#fff;padding:24px;border-radius:8px;margin-bottom:20px}
  .header h1{margin:0;font-size:20px;font-weight:800}
  .header p{margin:4px 0 0;font-size:12px;opacity:0.8}
  .badge{display:inline-block;background:#dcfce7;color:#166534;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:bold}
  .kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
  .kpi-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;text-align:center}
  .kpi-box .val{font-size:22px;font-weight:800;color:#1A3FA0}
  .kpi-box .lbl{font-size:11px;color:#6b7280;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#f3f4f6;padding:8px 10px;text-align:left;font-size:10px;color:#6b7280;text-transform:uppercase;border-bottom:1px solid #e5e7eb}
  td{padding:8px 10px;border-bottom:1px solid #f3f4f6}
  .pendiente{color:#C07D10;font-weight:bold}
  .pagada{color:#166534;font-weight:bold}
  .gastos-section{margin-top:20px}
  h2{font-size:14px;color:#1A3FA0;border-bottom:2px solid #1A3FA0;padding-bottom:6px;margin:20px 0 12px}
  .footer{margin-top:30px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center}
</style></head><body>
<div class="header">
  <h1>📋 Liquidación de Expensas</h1>
  <p>${periodoLabel(expensa.periodo)} · ${expensa.tipo === 'extraordinaria' ? 'Extraordinaria' : 'Ordinaria'} · Vto: ${fmtD(expensa.fecha_vencimiento)}</p>
</div>
<div class="kpi">
  <div class="kpi-box"><div class="val">${fmt(expensa.total_expensa)}</div><div class="lbl">Total expensa</div></div>
  <div class="kpi-box"><div class="val">${fmt(totalCobrado)}</div><div class="lbl">Cobrado</div></div>
  <div class="kpi-box"><div class="val">${fmt(totalPendiente)}</div><div class="lbl">Pendiente</div></div>
</div>
<h2>Distribución por unidad</h2>
<table>
  <thead><tr><th>UF</th><th>Tipo</th><th>Copropietario</th><th>Coef. %</th><th>Monto</th><th>Estado</th><th>Fecha pago</th></tr></thead>
  <tbody>
    ${detalles.map(d => {
      const u = unidades.find(x=>x.id===d.unidad_id)
      const cp = u ? copropietarios.find(c=>c.id===u.propietario_id) : null
      return `<tr>
        <td><b>${u?.numero||d.unidad_id}</b></td>
        <td style="text-transform:capitalize">${u?.tipo||'—'}</td>
        <td>${cp?.apellido_nombre||'—'}</td>
        <td>${u?.porcentaje_fiscal ? Number(u.porcentaje_fiscal).toFixed(4)+'%' : '—'}</td>
        <td><b>${fmt(d.monto)}</b></td>
        <td class="${d.estado}">${d.estado}</td>
        <td>${fmtD(d.fecha_pago)}</td>
      </tr>`
    }).join('')}
  </tbody>
</table>
<div class="gastos-section">
<h2>Gastos del período</h2>
<table>
  <thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Monto</th></tr></thead>
  <tbody>
    ${gastos.map(g => `<tr>
      <td>${fmtD(g.fecha)}</td>
      <td>${g.concepto}</td>
      <td style="text-transform:capitalize">${g.categoria||'—'}</td>
      <td><b>${fmt(g.monto)}</b></td>
    </tr>`).join('')}
    <tr style="background:#f3f4f6"><td colspan="3"><b>Honorarios administración</b></td><td><b>${fmt(expensa.total_administracion)}</b></td></tr>
    <tr style="background:#1A3FA0;color:#fff"><td colspan="3"><b>TOTAL</b></td><td><b>${fmt(expensa.total_expensa)}</b></td></tr>
  </tbody>
</table>
</div>
<div class="footer">GASP Consorcios · Sistema de Administración · ${new Date().toLocaleDateString('es-AR')}</div>
</body></html>`

    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
    setTimeout(() => win.print(), 500)
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const CATEGORIAS = ['limpieza','mantenimiento','seguro','honorarios','servicios','reparaciones','administracion','otro']
  const periodoActual = () => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  }

  // ── Vista detalle expensa ──
  if (selected) {
    const totalGasDet = gastos.reduce((a,g)=>a+Number(g.monto||0),0)
    const cobradas = detalles.filter(d=>d.estado==='pagada').length
    const pendientes = detalles.filter(d=>d.estado!=='pagada').length
    const morosas = detalles.filter(d=>d.estado==='morosa').length

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

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
          {[
            { l:'Total expensa', v:fmt(selected.total_expensa), c:AZ },
            { l:'Cobradas', v:cobradas, c:VD },
            { l:'Pendientes', v:pendientes, c:AM },
            { l:'Morosas', v:morosas, c:RJ },
          ].map((k,i) => (
            <Card key={i} style={{ textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:800, color:k.c }}>{k.v}</div>
              <div style={{ fontSize:11, color:GR, marginTop:4 }}>{k.l}</div>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:16 }}>
          {['detalle','gastos'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding:'7px 18px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13,
                background: tab===t ? AZ : '#f3f4f6', color: tab===t ? '#fff' : '#555', fontWeight: tab===t ? 'bold' : 'normal' }}>
              {t === 'detalle' ? '🏢 Por unidad' : '💸 Gastos'}
            </button>
          ))}
        </div>

        {tab === 'detalle' && (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['UF','Copropietario','Coef. %','Monto','Estado','Fecha pago','Acciones'].map((h,i) => (
                    <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detalles.map(d => {
                  const u = unidades.find(x=>x.id===d.unidad_id)
                  const cp = u ? copropietarios.find(c=>c.id===u.propietario_id) : null
                  const ec = d.estado==='pagada' ? {c:VD,bg:'#dcfce7'} : d.estado==='morosa' ? {c:RJ,bg:'#fee2e2'} : {c:AM,bg:'#fef9c3'}
                  return (
                    <tr key={d.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'10px 12px', fontWeight:700, color:AZ }}>{u?.numero||d.unidad_id}</td>
                      <td style={{ padding:'10px 12px' }}>{cp?.apellido_nombre||'—'}</td>
                      <td style={{ padding:'10px 12px' }}>{u?.porcentaje_fiscal ? Number(u.porcentaje_fiscal).toFixed(4)+'%' : '—'}</td>
                      <td style={{ padding:'10px 12px', fontWeight:700 }}>{fmt(d.monto)}</td>
                      <td style={{ padding:'10px 12px' }}><Badge text={d.estado} color={ec.c} bg={ec.bg} /></td>
                      <td style={{ padding:'10px 12px' }}>{fmtD(d.fecha_pago)}</td>
                      <td style={{ padding:'10px 12px' }}>
                        {d.estado !== 'pagada' && (
                          <div style={{ display:'flex', gap:6 }}>
                            <Btn small color={VD} onClick={() => marcarPagada(d)}>✓ Pagada</Btn>
                            <Btn small color={RJ} onClick={async () => {
                              await supabase.from('con_expensas_detalle').update({ estado:'morosa' }).eq('id',d.id)
                              cargarDetalle(selected.id)
                            }}>⚠ Morosa</Btn>
                          </div>
                        )}
                        {d.estado === 'pagada' && <Badge text="✓ Cobrada" color={VD} bg='#dcfce7' />}
                      </td>
                    </tr>
                  )
                })}
                {detalles.length === 0 && (
                  <tr><td colSpan={7} style={{ padding:20, textAlign:'center', color:GR }}>
                    Sin distribución. Hacé clic en "Calcular y distribuir".
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'gastos' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={{ fontWeight:600 }}>Total gastos: <span style={{ color:AZ, fontSize:16 }}>{fmt(totalGasDet)}</span></div>
              <Btn small onClick={() => setFormGasto({ fecha: new Date().toISOString().split('T')[0], categoria:'limpieza' })}>+ Agregar gasto</Btn>
            </div>
            {formGasto && (
              <Card style={{ marginBottom:14, border:`1px solid ${AZ}` }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
                  <Input label="Fecha" value={formGasto.fecha} onChange={v=>setFormGasto(x=>({...x,fecha:v}))} type="date" required />
                  <Input label="Concepto" value={formGasto.concepto} onChange={v=>setFormGasto(x=>({...x,concepto:v}))} required />
                  <Sel label="Categoría" value={formGasto.categoria} onChange={v=>setFormGasto(x=>({...x,categoria:v}))} opts={CATEGORIAS} />
                  <Input label="Monto $" value={formGasto.monto} onChange={v=>setFormGasto(x=>({...x,monto:v}))} type="number" required />
                  <Input label="N° comprobante" value={formGasto.comprobante} onChange={v=>setFormGasto(x=>({...x,comprobante:v}))} />
                  <Input label="Notas" value={formGasto.notas} onChange={v=>setFormGasto(x=>({...x,notas:v}))} />
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <Btn small onClick={guardarGasto}>Guardar</Btn>
                  <BtnSec small onClick={() => setFormGasto(null)}>Cancelar</BtnSec>
                </div>
              </Card>
            )}
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['Fecha','Concepto','Categoría','Comprobante','Monto',''].map((h,i) => (
                      <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gastos.map(g => (
                    <tr key={g.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'9px 12px' }}>{fmtD(g.fecha)}</td>
                      <td style={{ padding:'9px 12px' }}>{g.concepto}</td>
                      <td style={{ padding:'9px 12px', textTransform:'capitalize' }}>{g.categoria||'—'}</td>
                      <td style={{ padding:'9px 12px', color:GR }}>{g.comprobante||'—'}</td>
                      <td style={{ padding:'9px 12px', fontWeight:700 }}>{fmt(g.monto)}</td>
                      <td style={{ padding:'9px 12px' }}>
                        <Btn small onClick={() => setFormGasto({...g})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                      </td>
                    </tr>
                  ))}
                  {gastos.length === 0 && <tr><td colSpan={6} style={{ padding:20, textAlign:'center', color:GR }}>Sin gastos registrados.</td></tr>}
                  {gastos.length > 0 && (
                    <tr style={{ background:'#f3f4f6', fontWeight:700 }}>
                      <td colSpan={4} style={{ padding:'9px 12px' }}>+ Honorarios administración</td>
                      <td colSpan={2} style={{ padding:'9px 12px' }}>{fmt(selected.total_administracion)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Lista de expensas ──
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Expensas ({expensas.length})</div>
        <Btn onClick={() => setForm({ periodo: periodoActual(), tipo:'ordinaria', total_administracion:0, estado:'abierta' })}>+ Nuevo período</Btn>
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
            <div style={{ gridColumn:'span 4' }}>
              <Input label="Descripción / observaciones" value={form.descripcion} onChange={v=>F({descripcion:v})} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardarExpensa}>💾 Crear período</Btn>
            <BtnSec onClick={() => setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {expensas.map(exp => {
          const ec = exp.estado==='cobrada' ? {c:VD,bg:'#dcfce7'} : exp.estado==='cerrada' ? {c:GR,bg:'#f3f4f6'} : {c:AM,bg:'#fef9c3'}
          return (
            <Card key={exp.id} style={{ cursor:'pointer', transition:'box-shadow 0.15s' }}
              onClick={async () => { setSelected(exp); await cargarDetalle(exp.id) }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                    <span style={{ fontWeight:700, fontSize:15 }}>{periodoLabel(exp.periodo)}</span>
                    <Badge text={exp.tipo} color={exp.tipo==='extraordinaria'?RJ:AZ} />
                    <Badge text={exp.estado} color={ec.c} bg={ec.bg} />
                  </div>
                  <div style={{ fontSize:12, color:GR, display:'flex', gap:16 }}>
                    {exp.fecha_vencimiento && <span>📅 Vto: {fmtD(exp.fecha_vencimiento)}</span>}
                    {exp.total_expensa > 0 && <span>💰 Total: {fmt(exp.total_expensa)}</span>}
                    {exp.descripcion && <span>{exp.descripcion}</span>}
                  </div>
                </div>
                <span style={{ color:GR, fontSize:20 }}>›</span>
              </div>
            </Card>
          )
        })}
        {expensas.length === 0 && (
          <Card style={{ textAlign:'center', color:GR, padding:32 }}>
            <div style={{ fontSize:32, marginBottom:8 }}>📋</div>
            <div>No hay períodos de expensas. Creá el primero.</div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. MOROSOS
// ══════════════════════════════════════════════════════════════════════════════
function Morosos({ session, consorcioId, unidades, copropietarios }) {
  const [morosos, setMorosos] = useState([])
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState({})

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('con_expensas_detalle').select('*, con_expensas!inner(periodo,fecha_vencimiento)')
      .eq('admin_id', session.user.id)
      .eq('consorcio_id', consorcioId)
      .in('estado', ['pendiente','morosa'])
      .order('created_at', { ascending:false })
    setMorosos(data || [])
    setLoading(false)
  }

  async function enviarWA(det) {
    const u = unidades.find(x=>x.id===det.unidad_id)
    const cp = u ? copropietarios.find(c=>c.id===u.propietario_id) : null
    if (!cp?.telefono) return alert('El copropietario no tiene teléfono registrado')
    const periodo = det.con_expensas?.periodo
    const msg = encodeURIComponent(
      `Estimado/a ${cp.apellido_nombre}, le informamos que tiene pendiente el pago de expensas del período ${periodoLabel(periodo)} por ${fmt(det.monto)}. Por favor regularice su situación. Gracias.`
    )
    window.open(`https://wa.me/549${cp.telefono.replace(/\D/g,'')}?text=${msg}`, '_blank')
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const totalDeuda = morosos.reduce((a,d)=>a+Number(d.monto||0),0)

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:RJ }}>⚠ Morosos</div>
          <div style={{ fontSize:12, color:GR }}>{morosos.length} cuotas pendientes · Total: {fmt(totalDeuda)}</div>
        </div>
        <Btn color={RJ} onClick={async () => {
          for (const d of morosos) {
            const u = unidades.find(x=>x.id===d.unidad_id)
            const cp = u ? copropietarios.find(c=>c.id===u.propietario_id) : null
            if (cp?.telefono) {
              const msg = encodeURIComponent(`Estimado/a ${cp.apellido_nombre}, tiene expensas pendientes por ${fmt(d.monto)} del período ${periodoLabel(d.con_expensas?.periodo)}. Por favor regularice.`)
              window.open(`https://wa.me/549${cp.telefono.replace(/\D/g,'')}?text=${msg}`, '_blank')
              await new Promise(r=>setTimeout(r,500))
            }
          }
        }}>📱 WA masivo ({morosos.filter(d=>{
          const u=unidades.find(x=>x.id===d.unidad_id)
          const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
          return !!cp?.telefono
        }).length})</Btn>
      </div>
      {loading ? <div style={{ textAlign:'center', color:GR, padding:40 }}>Cargando...</div> : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#fef2f2' }}>
                {['UF','Copropietario','Período','Monto','Estado','Contacto'].map((h,i) => (
                  <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:RJ, textTransform:'uppercase', borderBottom:'1px solid #fecaca' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {morosos.map(d => {
                const u = unidades.find(x=>x.id===d.unidad_id)
                const cp = u ? copropietarios.find(c=>c.id===u.propietario_id) : null
                return (
                  <tr key={d.id} style={{ borderBottom:'1px solid #fef2f2' }}>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:AZ }}>{u?.numero||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{cp?.apellido_nombre||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{periodoLabel(d.con_expensas?.periodo)}</td>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:RJ }}>{fmt(d.monto)}</td>
                    <td style={{ padding:'10px 12px' }}><Badge text={d.estado} color={d.estado==='morosa'?RJ:AM} /></td>
                    <td style={{ padding:'10px 12px' }}>
                      <div style={{ display:'flex', gap:6 }}>
                        {cp?.telefono && <Btn small color='#25d366' onClick={() => enviarWA(d)}>📱 WA</Btn>}
                        {cp?.email && <Btn small color={AZ} onClick={() => window.open(`mailto:${cp.email}`)}>✉ Email</Btn>}
                        {!cp?.telefono && !cp?.email && <span style={{ color:GR, fontSize:11 }}>Sin contacto</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {morosos.length === 0 && (
                <tr><td colSpan={6} style={{ padding:32, textAlign:'center', color:VD, fontWeight:600 }}>
                  ✅ No hay morosos registrados
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. PROVEEDORES
// ══════════════════════════════════════════════════════════════════════════════
function Proveedores({ session, consorcioId }) {
  const [lista, setLista] = useState([])
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const F = f => setForm(x=>({...x,...f}))

  async function cargar() {
    const { data } = await supabase.from('con_proveedores').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId).order('razon_social')
    setLista(data||[])
  }
  async function guardar() {
    if (!form.razon_social) return setMsg({ tipo:'warn', texto:'Razón social obligatoria' })
    const id = form.id || nextId(lista, 'PRV')
    const { error } = await supabase.from('con_proveedores').upsert(
      { ...form, id, admin_id:session.user.id, consorcio_id:consorcioId }, { onConflict:'id' }
    )
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Guardado' }); cargar()
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar?')) return
    await supabase.from('con_proveedores').delete().eq('id', id); cargar()
  }
  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const RUBROS = ['limpieza','plomería','electricidad','gas','pintura','jardinería','ascensores','seguros','administración','otros']

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Proveedores ({lista.length})</div>
        <Btn onClick={() => setForm({ activo:true })}>+ Agregar</Btn>
      </div>
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{form.id ? 'Editar proveedor' : 'Nuevo proveedor'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Input label="Razón social" value={form.razon_social} onChange={v=>F({razon_social:v})} required />
            <Input label="CUIT" value={form.cuit} onChange={v=>F({cuit:v})} />
            <Sel label="Rubro" value={form.rubro} onChange={v=>F({rubro:v})} opts={[{v:'',l:'Seleccionar...'},...RUBROS]} />
            <Input label="Teléfono" value={form.telefono} onChange={v=>F({telefono:v})} />
            <Input label="Email" value={form.email} onChange={v=>F({email:v})} />
            <Input label="Dirección" value={form.direccion} onChange={v=>F({direccion:v})} />
            <div style={{ gridColumn:'span 3' }}>
              <Input label="Notas" value={form.notas} onChange={v=>F({notas:v})} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar</Btn>
            <BtnSec onClick={() => setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {lista.map(p => (
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
                <Btn small onClick={() => setForm({...p})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                <Btn small onClick={() => eliminar(p.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
              </div>
            </div>
          </Card>
        ))}
        {lista.length === 0 && <Card style={{ textAlign:'center', color:GR, padding:32, gridColumn:'span 2' }}>Sin proveedores.</Card>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. LIBRO DE ACTAS
// ══════════════════════════════════════════════════════════════════════════════
function Actas({ session, consorcioId, copropietarios }) {
  const [actas, setActas] = useState([])
  const [form, setForm] = useState(null)
  const [selected, setSelected] = useState(null)
  const [msg, setMsg] = useState(null)
  const F = f => setForm(x=>({...x,...f}))

  async function cargar() {
    const { data } = await supabase.from('con_actas').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .order('fecha', { ascending:false })
    setActas(data||[])
  }
  async function guardar() {
    if (!form.fecha) return setMsg({ tipo:'warn', texto:'Fecha obligatoria' })
    const id = form.id || nextId(actas, 'ACT')
    const numero = form.numero || (actas.length > 0 ? Math.max(...actas.map(a=>a.numero||0)) + 1 : 1)
    const { error } = await supabase.from('con_actas').upsert(
      { ...form, id, numero, admin_id:session.user.id, consorcio_id:consorcioId }, { onConflict:'id' }
    )
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Acta guardada' }); cargar()
  }

  function imprimirActa(acta) {
    const presentes = (acta.presentes||[]).map(id => copropietarios.find(c=>c.id===id)?.apellido_nombre || id).join(', ')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px;color:#1a1a1a}
h1{font-size:18px;text-align:center;text-transform:uppercase;border-bottom:2px solid #000;padding-bottom:10px}
h2{font-size:14px;text-transform:uppercase;margin-top:24px}.field{margin:10px 0;font-size:13px;line-height:1.8}
.label{font-weight:bold}.firma{margin-top:60px;display:flex;justify-content:space-between}
.firma-box{text-align:center;border-top:1px solid #000;padding-top:8px;width:200px;font-size:11px}</style></head>
<body>
<h1>Libro de Actas — Acta N° ${acta.numero}</h1>
<div class="field"><span class="label">Tipo:</span> ${acta.tipo?.replace(/_/g,' ')}</div>
<div class="field"><span class="label">Fecha:</span> ${fmtD(acta.fecha)} · Hora: ${acta.hora||'—'}</div>
<div class="field"><span class="label">Lugar:</span> ${acta.lugar||'—'}</div>
<div class="field"><span class="label">Quórum:</span> ${acta.quorum ? acta.quorum + '%' : '—'}</div>
<div class="field"><span class="label">Presentes:</span> ${presentes||'—'}</div>
<h2>Orden del día</h2><div style="white-space:pre-line;font-size:13px">${acta.orden_del_dia||'—'}</div>
<h2>Resoluciones adoptadas</h2><div style="white-space:pre-line;font-size:13px">${acta.resoluciones||'—'}</div>
${acta.observaciones ? `<h2>Observaciones</h2><div style="white-space:pre-line;font-size:13px">${acta.observaciones}</div>` : ''}
<div class="firma">
  <div class="firma-box">Presidente de la asamblea</div>
  <div class="firma-box">Secretario</div>
  <div class="firma-box">Administrador</div>
</div>
</body></html>`
    const win = window.open('','_blank'); win.document.write(html); win.document.close(); setTimeout(()=>win.print(),500)
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const TIPOS = ['asamblea_ordinaria','asamblea_extraordinaria','reunion_consejo']

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Libro de Actas ({actas.length})</div>
        <Btn onClick={() => setForm({ tipo:'asamblea_ordinaria', fecha: new Date().toISOString().split('T')[0], presentes:[] })}>+ Nueva acta</Btn>
      </div>
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{form.id ? 'Editar acta' : 'Nueva acta'}</div>
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
                {copropietarios.map(cp => (
                  <label key={cp.id} style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', fontSize:13 }}>
                    <input type="checkbox"
                      checked={(form.presentes||[]).includes(cp.id)}
                      onChange={e => F({ presentes: e.target.checked
                        ? [...(form.presentes||[]), cp.id]
                        : (form.presentes||[]).filter(x=>x!==cp.id)
                      })} />
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
            <div style={{ gridColumn:'span 3' }}>
              <Input label="Observaciones" value={form.observaciones} onChange={v=>F({observaciones:v})} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar acta</Btn>
            <BtnSec onClick={() => setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {actas.map(a => (
          <Card key={a.id}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontWeight:700 }}>Acta N° {a.numero}</span>
                  <Badge text={a.tipo?.replace(/_/g,' ')} color={AZ} />
                  {a.firmada && <Badge text="✓ Firmada" color={VD} bg='#dcfce7' />}
                </div>
                <div style={{ fontSize:12, color:GR, display:'flex', gap:14 }}>
                  <span>📅 {fmtD(a.fecha)}{a.hora ? ` · ${a.hora}` : ''}</span>
                  {a.lugar && <span>📍 {a.lugar}</span>}
                  {a.presentes?.length > 0 && <span>👥 {a.presentes.length} presentes</span>}
                </div>
                {a.resoluciones && <div style={{ fontSize:12, color:'#374151', marginTop:4, fontStyle:'italic' }}>
                  {a.resoluciones.slice(0,120)}{a.resoluciones.length > 120 ? '...' : ''}
                </div>}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <Btn small onClick={() => imprimirActa(a)}>🖨 Imprimir</Btn>
                <Btn small onClick={() => setForm({...a})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                <Btn small onClick={async () => {
                  await supabase.from('con_actas').update({ firmada:!a.firmada }).eq('id',a.id); cargar()
                }} color={a.firmada ? GR : VD}>{a.firmada ? 'Desfirmar' : '✓ Firmar'}</Btn>
              </div>
            </div>
          </Card>
        ))}
        {actas.length === 0 && <Card style={{ textAlign:'center', color:GR, padding:32 }}>Sin actas registradas.</Card>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL — GASP CONSORCIOS
// ══════════════════════════════════════════════════════════════════════════════
// ── PERFIL ADMIN ──────────────────────────────────────────────────────────────
function PerfilAdmin({ session, supabase }) {
  const [perfil, setPerfil] = useState({ nombre:'', telefono:'', matricula:'', email:'' })
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (session) {
      setPerfil(p => ({ ...p, email: session.user.email || '' }))
    }
  }, [session])

  async function guardar() {
    setGuardando(true)
    await new Promise(r => setTimeout(r, 600))
    setMsg({ tipo:'ok', texto:'✓ Perfil guardado' })
    setGuardando(false)
  }

  return (
    <div style={{ maxWidth:500 }}>
      <div style={{ fontWeight:700, fontSize:16, color:'#111827', marginBottom:20 }}>⚙️ Mi perfil</div>
      <Msg data={msg} />
      <Card style={{ marginBottom:16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
          <Input label="Nombre completo" value={perfil.nombre} onChange={v=>setPerfil(p=>({...p,nombre:v}))} placeholder="Javier García Pérez" />
          <Input label="Email" value={perfil.email} onChange={v=>setPerfil(p=>({...p,email:v}))} />
          <Input label="Teléfono" value={perfil.telefono} onChange={v=>setPerfil(p=>({...p,telefono:v}))} placeholder="2254-XXXXXX" />
          <Input label="Matrícula RPAC" value={perfil.matricula} onChange={v=>setPerfil(p=>({...p,matricula:v}))} placeholder="N° 83" />
        </div>
        <Btn onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : '💾 Guardar perfil'}</Btn>
      </Card>
      <Card>
        <div style={{ fontSize:13, color:'#6b7280', marginBottom:8, fontWeight:600 }}>Sesión activa</div>
        <div style={{ fontSize:13, color:'#374151' }}>
          <div>Usuario: {session?.user?.email}</div>
          <div style={{ marginTop:6 }}>
            <Btn color='#991B1B' small onClick={async () => { await supabase.auth.signOut() }}>
              Cerrar sesión
            </Btn>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [pagina, setPagina] = useState('dashboard')
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Datos
  const [consorcios, setConsorcios] = useState([])
  const [consorcioActivo, setConsorcioActivo] = useState(null)
  const [unidades, setUnidades] = useState([])
  const [copropietarios, setCopropietarios] = useState([])
  const [perfil, setPerfil] = useState({})
  const [esSuperAdmin, setEsSuperAdmin] = useState(false)

  // Login
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')

  // Form nuevo consorcio
  const [formCon, setFormCon] = useState(null)
  const [msgCon, setMsgCon] = useState(null)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 769)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data?.session || null)
      if (data?.session) cargar(true)
      else setCargando(false)
    })
  }, [])

  async function cargar(inicial = false) {
    if (inicial) setCargando(true)
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id
      if (!uid) { setCargando(false); return }
      const { data: cons } = await supabase.from('con_consorcios').select('*')
        .eq('admin_id', uid).eq('activo', true).order('nombre')
      setConsorcios(cons || [])
      if (cons?.length > 0 && !consorcioActivo) {
        setConsorcioActivo(cons[0])
        await cargarConsorcio(cons[0].id, uid)
      }
      setEsSuperAdmin((await supabase.auth.getUser()).data.user?.email === SUPERADMIN)
    } catch(e) { console.error(e) } finally { if (inicial) setCargando(false) }
  }

  async function cargarConsorcio(cid, uid) {
    const [u, cp] = await Promise.all([
      supabase.from('con_unidades').select('*').eq('admin_id', uid||session?.user?.id).eq('consorcio_id', cid).order('numero'),
      supabase.from('con_copropietarios').select('*').eq('admin_id', uid||session?.user?.id).eq('consorcio_id', cid).order('apellido_nombre')
    ])
    setUnidades(u.data || [])
    setCopropietarios(cp.data || [])
  }

  async function login() {
    setLoginLoading(true); setLoginError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (error) { setLoginError('Email o contraseña incorrectos'); setLoginLoading(false); return }
    const { data } = await supabase.auth.getSession()
    setSession(data?.session || null)
    if (data?.session) cargar(true)
    setLoginLoading(false)
  }

  async function logout() {
    await supabase.auth.signOut(); setSession(null)
  }

  async function crearConsorcio() {
    if (!formCon?.nombre) return setMsgCon({ tipo:'warn', texto:'El nombre es obligatorio' })
    const uid = session.user.id
    const id = nextId(consorcios, 'CON')
    await supabase.from('con_consorcios').insert([{ ...formCon, id, admin_id:uid, activo:true }])
    setFormCon(null); setMsgCon({ tipo:'ok', texto:'✓ Consorcio creado' }); cargar()
  }

  // ── NAV ──────────────────────────────────────────────────────────────────────
  const NAV = [
    { id:'dashboard',      label:'Dashboard',         icon:'📊', sec:'Principal' },
    { id:'unidades',       label:'Unidades (UFs)',     icon:'🏢', sec:'Gestión' },
    { id:'copropietarios', label:'Copropietarios',     icon:'👤', sec:'Gestión' },
    { id:'expensas',       label:'Expensas',           icon:'💰', sec:'Gestión' },
    { id:'morosos',        label:'Morosos',            icon:'⚠️', sec:'Gestión' },
    { id:'proveedores',    label:'Proveedores',        icon:'🔧', sec:'Gestión' },
    { id:'actas',          label:'Libro de Actas',     icon:'📖', sec:'Gestión' },
    { id:'perfil',         label:'Mi perfil',          icon:'⚙️', sec:'Admin' },
    ...(esSuperAdmin ? [{ id:'clientes', label:'Clientes GASP', icon:'🏢', sec:'Admin' }] : []),
  ]
  const secciones = [...new Set(NAV.map(n => n.sec))]

  if (cargando) return (
    <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', color:'#4a7abf', fontFamily:'Arial', fontSize:14 }}>
      Cargando GASP Consorcios...
    </div>
  )

  if (!session) return (
    <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Arial' }}>
      <Head><title>GASP Consorcios</title></Head>
      <div style={{ background:'#fff', borderRadius:14, padding:36, width:340, boxShadow:'0 8px 40px #0006' }}>
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <img src="data:image/jpeg;base64,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aihHTRxdA7qjxw6Wlp5LlbwIkAAAACJBJD1J4n0PD1BAAJQJAABGTGLlvUDpLvHDv7HzjKfQ3FbCularYmQAAAAAAAAAAAAAAAAAAAAAAB41Zt/PJauOx1PPDYUfMkHo8zauGpdFbOSjtrBwWX6B7ODsdoOSzdOObzb4aXNtFUPdwV/WYY59jxPoeXoeHsY4yjBjtihj2Y02PejnMfTjk8HZo4Sv9DHzd9FrnBO0rnJuhqGpWq559eRf2fOjuL/zewfQXJbg2rz6oAAAAAAAAAAAAAAAAeT00ehjqtHo/ROPY7A552GxOGudqOZu7kVLPpQAAAAAAAAAAAAAAAAAAAAAAADx7FKju0cvS7UfPcP0eucA67Xmm3WtqHc3fnGwO3abcVIAAAAAAAAAAABBPjV62LXO9Rszidr041WxyKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYso1Ot6hHBePoFc1W70lM6lqdtQAAAAAAAAADBnHj2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGPzmQFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/8QAAv/aAAwDAQACAAMAAAAh888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888884+2iWOOey2688888888888888888888888888888888888888884+G4AcoGA0KIGE8888888888888888888888888888888888888846+406OYfmx9eMW88888888888888888888888888888888888888608ma6lOvbUPPaIc8888888888888888888888888888888888882MsoGX9J8tTDCYQee888888888888888888888888888888888884qi89R37lE5AAAcImm888888888888888888888888888888888888e+oo+HQS4CfQpoBOiCiSU88888888888888888888888888888884646xZgn32vLnGAOMIMau+U8888888888888888888888888888888Q/GV0AC9KMuuccsM888pU+U888888888888888888888888888888wYgXryymq+y488888888rj8U888888888888888888888888888888/GHVGMcuoMYgwm6y088ruJ8U888888888888888888888888888888stGcw2YAxpCCBBA7d88xcOQU88888888888888888888888888880Cc8w2cKAKiEZg58V/c84iC7sU888888888888888888888888888gc84WtQiTx1W49ejAXPX07uEG+c888888888888888888888888888883idLrW5MaXvTjWLVXUcx80V+0888888888888888888888888888yZ4WGlqjuR6Wf/s36HaXcI82IUU888888888888888888888888888v4fEJxZvuc846e288vd5UXxj9AU888888888888888888888888888888P+9888w6e0kceiS288+BDA+U88888888888888888888888888888888882aAdjEOCxP5yJ0JULx+U88888888888888888888888888888888+6p5bal0N0n6ADvctQmJ308888888888888888888888888888880iEvtGfwdZ++pXyydUwARX9U88888888888888888888888888888To9q87AC6lHjXj+GCwcjCP4588888888888888888888888888846msqNiCubpPve/9PfNCbewMW9K888888888888888888888888888cvI9KagDvf8846ay88sP8AHKMJQSfPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPLrvPPPMNvIVbnqNttPOw1VX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" alt="GASP" style={{ width:90, height:90, objectFit:'contain', marginBottom:8 }} />
          <div style={{ fontSize:20, fontWeight:800, color:'#1A3FA0' }}>GASP Consorcios</div>
          <div style={{ fontSize:12, color:GR }}>Sistema de Administración</div>
        </div>
        {loginError && <div style={{ background:'#fee2e2', color:RJ, borderRadius:7, padding:'9px 12px', fontSize:13, marginBottom:14 }}>{loginError}</div>}
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email"
          style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8, marginBottom:10, fontSize:14, boxSizing:'border-box' }} />
        <input value={pass} onChange={e=>setPass(e.target.value)} placeholder="Contraseña" type="password"
          onKeyDown={e=>e.key==='Enter'&&login()}
          style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8, marginBottom:16, fontSize:14, boxSizing:'border-box' }} />
        <Btn onClick={login} disabled={loginLoading} style={{ width:'100%', justifyContent:'center' }}>
          {loginLoading ? 'Ingresando...' : 'Ingresar'}
        </Btn>
      </div>
    </div>
  )

  // ── DASHBOARD ─────────────────────────────────────────────────────────────────
  function Dashboard() {
    const totalUFs = unidades.length
    const ocupadas = unidades.filter(u=>u.estado==='ocupada').length
    const coefTotal = unidades.reduce((a,u)=>a+Number(u.porcentaje_fiscal||0),0)
    return (
      <div>
        {/* Selector de consorcio */}
        {consorcios.length > 1 && (
          <div style={{ marginBottom:20, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <span style={{ fontSize:13, color:GR, fontWeight:500 }}>Consorcio activo:</span>
            {consorcios.map(c => (
              <button key={c.id} onClick={() => { setConsorcioActivo(c); cargarConsorcio(c.id) }}
                style={{ padding:'6px 14px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13,
                  background: consorcioActivo?.id===c.id ? AZ : '#f3f4f6',
                  color: consorcioActivo?.id===c.id ? '#fff' : '#374151',
                  fontWeight: consorcioActivo?.id===c.id ? 'bold' : 'normal' }}>
                {c.nombre}
              </button>
            ))}
            <Btn small onClick={() => setFormCon({})}>+ Nuevo consorcio</Btn>
          </div>
        )}
        {consorcios.length === 0 && (
          <Card style={{ textAlign:'center', padding:40, marginBottom:20, border:`2px dashed ${AZ}` }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🏢</div>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>Bienvenido a GASP Consorcios</div>
            <div style={{ color:GR, fontSize:13, marginBottom:20 }}>Creá tu primer consorcio para comenzar</div>
            <Btn onClick={() => setFormCon({})}>+ Crear primer consorcio</Btn>
          </Card>
        )}
        {formCon && (
          <Card style={{ marginBottom:20, border:`1px solid ${AZ}` }}>
            <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>Nuevo consorcio</div>
            {msgCon && <Msg data={msgCon} />}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <Input label="Nombre del consorcio" value={formCon.nombre} onChange={v=>setFormCon(x=>({...x,nombre:v}))} required />
              <Input label="Dirección" value={formCon.direccion} onChange={v=>setFormCon(x=>({...x,direccion:v}))} />
              <Input label="Localidad" value={formCon.localidad} onChange={v=>setFormCon(x=>({...x,localidad:v}))} />
              <Input label="CUIT" value={formCon.cuit} onChange={v=>setFormCon(x=>({...x,cuit:v}))} />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <Btn onClick={crearConsorcio}>Crear</Btn>
              <BtnSec onClick={() => setFormCon(null)}>Cancelar</BtnSec>
            </div>
          </Card>
        )}
        {consorcioActivo && (
          <>
            <div style={{ background:`linear-gradient(135deg, ${AZ} 0%, ${AZ2} 100%)`, borderRadius:12, padding:24, marginBottom:20, color:'#fff' }}>
              <div style={{ fontSize:11, opacity:0.7, textTransform:'uppercase', letterSpacing:1 }}>Consorcio activo</div>
              <div style={{ fontSize:22, fontWeight:800, marginTop:4 }}>{consorcioActivo.nombre}</div>
              {consorcioActivo.direccion && <div style={{ fontSize:13, opacity:0.8, marginTop:2 }}>📍 {consorcioActivo.direccion}{consorcioActivo.localidad ? `, ${consorcioActivo.localidad}` : ''}</div>}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:24 }}>
              {[
                { l:'Unidades', v:totalUFs, c:AZ, icon:'🏢', action:'unidades' },
                { l:'Ocupadas', v:ocupadas, c:VD, icon:'✅', action:'unidades' },
                { l:'Copropietarios', v:copropietarios.length, c:AM, icon:'👤', action:'copropietarios' },
                { l:'Coef. total', v:coefTotal.toFixed(2)+'%', c:'#6d28d9', icon:'📊', action:null },
              ].map((k,i) => (
                <Card key={i} style={{ textAlign:'center', cursor:k.action?'pointer':'default', transition:'box-shadow 0.15s' }}
                  onClick={() => k.action && setPagina(k.action)}>
                  <div style={{ fontSize:24, marginBottom:6 }}>{k.icon}</div>
                  <div style={{ fontSize:26, fontWeight:800, color:k.c }}>{k.v}</div>
                  <div style={{ fontSize:11, color:GR, marginTop:4 }}>{k.l}</div>
                </Card>
              ))}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <Card style={{ cursor:'pointer' }} onClick={() => setPagina('expensas')}>
                <div style={{ fontSize:28, marginBottom:8 }}>💰</div>
                <div style={{ fontWeight:700, fontSize:15 }}>Gestionar Expensas</div>
                <div style={{ fontSize:12, color:GR, marginTop:4 }}>Crear período, calcular, cobrar</div>
              </Card>
              <Card style={{ cursor:'pointer' }} onClick={() => setPagina('morosos')}>
                <div style={{ fontSize:28, marginBottom:8 }}>⚠️</div>
                <div style={{ fontWeight:700, fontSize:15, color:RJ }}>Ver Morosos</div>
                <div style={{ fontSize:12, color:GR, marginTop:4 }}>Cuotas pendientes y contacto</div>
              </Card>
              <Card style={{ cursor:'pointer' }} onClick={() => setPagina('actas')}>
                <div style={{ fontSize:28, marginBottom:8 }}>📖</div>
                <div style={{ fontWeight:700, fontSize:15 }}>Libro de Actas</div>
                <div style={{ fontSize:12, color:GR, marginTop:4 }}>Asambleas y reuniones</div>
              </Card>
              <Card style={{ cursor:'pointer' }} onClick={() => setPagina('proveedores')}>
                <div style={{ fontSize:28, marginBottom:8 }}>🔧</div>
                <div style={{ fontWeight:700, fontSize:15 }}>Proveedores</div>
                <div style={{ fontSize:12, color:GR, marginTop:4 }}>Directorio de proveedores</div>
              </Card>
            </div>
          </>
        )}
        {consorcios.length === 1 && (
          <div style={{ marginTop:20, textAlign:'right' }}>
            <BtnSec small onClick={() => setFormCon({})}>+ Agregar otro consorcio</BtnSec>
          </div>
        )}
      </div>
    )
  }

  const cid = consorcioActivo?.id

  const renderPagina = () => {
    if (!cid && pagina !== 'dashboard') return (
      <Card style={{ textAlign:'center', padding:40, color:GR }}>Seleccioná un consorcio primero.</Card>
    )
    switch(pagina) {
      case 'dashboard':      return <Dashboard />
      case 'unidades':       return <Unidades session={session} consorcioId={cid} copropietarios={copropietarios} />
      case 'copropietarios': return <Copropietarios session={session} consorcioId={cid} onUpdate={setCopropietarios} />
      case 'expensas':       return <Expensas session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} />
      case 'morosos':        return <Morosos session={session} consorcioId={cid} unidades={unidades} copropietarios={copropietarios} />
      case 'proveedores':    return <Proveedores session={session} consorcioId={cid} />
      case 'actas':          return <Actas session={session} consorcioId={cid} copropietarios={copropietarios} />
      case 'perfil':         return <PerfilAdmin session={session} supabase={supabase} />
      case 'clientes':       return <Card style={{ textAlign:'center', padding:40, color:GR }}><div style={{fontSize:32,marginBottom:12}}>🚧</div><div style={{fontWeight:600,marginBottom:8}}>Panel de clientes en desarrollo</div></Card>
      default:               return <Dashboard />
    }
  }

  return (
    <div style={{ minHeight:'100vh', fontFamily:'Segoe UI, Arial, sans-serif', background:'#f8fafc', position:'relative' }}>
      <Head><title>GASP Consorcios</title></Head>

      {menuAbierto && isMobile && (
        <div onClick={() => setMenuAbierto(false)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:199 }} />
      )}

      {/* SIDEBAR */}
      <aside style={{ width:220, background:BG, display:'flex', flexDirection:'column',
        position:'fixed', top:0, left:0, height:'100vh', zIndex:200, overflowY:'auto',
        transform: isMobile && !menuAbierto ? 'translateX(-100%)' : 'translateX(0)',
        transition:'transform 0.25s ease' }}>
        <div style={{ padding:'14px 14px 12px', borderBottom:'1px solid #1a2540' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
            <img src="data:image/jpeg;base64,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aihHTRxdA7qjxw6Wlp5LlbwIkAAAACJBJD1J4n0PD1BAAJQJAABGTGLlvUDpLvHDv7HzjKfQ3FbCularYmQAAAAAAAAAAAAAAAAAAAAAAB41Zt/PJauOx1PPDYUfMkHo8zauGpdFbOSjtrBwWX6B7ODsdoOSzdOObzb4aXNtFUPdwV/WYY59jxPoeXoeHsY4yjBjtihj2Y02PejnMfTjk8HZo4Sv9DHzd9FrnBO0rnJuhqGpWq559eRf2fOjuL/zewfQXJbg2rz6oAAAAAAAAAAAAAAAAeT00ehjqtHo/ROPY7A552GxOGudqOZu7kVLPpQAAAAAAAAAAAAAAAAAAAAAAADx7FKju0cvS7UfPcP0eucA67Xmm3WtqHc3fnGwO3abcVIAAAAAAAAAAABBPjV62LXO9Rszidr041WxyKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYso1Ot6hHBePoFc1W70lM6lqdtQAAAAAAAAADBnHj2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGPzmQFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/8QAAv/aAAwDAQACAAMAAAAh888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888884+2iWOOey2688888888888888888888888888888888888888884+G4AcoGA0KIGE8888888888888888888888888888888888888846+406OYfmx9eMW88888888888888888888888888888888888888608ma6lOvbUPPaIc8888888888888888888888888888888888882MsoGX9J8tTDCYQee888888888888888888888888888888888884qi89R37lE5AAAcImm888888888888888888888888888888888888e+oo+HQS4CfQpoBOiCiSU88888888888888888888888888888884646xZgn32vLnGAOMIMau+U8888888888888888888888888888888Q/GV0AC9KMuuccsM888pU+U888888888888888888888888888888wYgXryymq+y488888888rj8U888888888888888888888888888888/GHVGMcuoMYgwm6y088ruJ8U888888888888888888888888888888stGcw2YAxpCCBBA7d88xcOQU88888888888888888888888888880Cc8w2cKAKiEZg58V/c84iC7sU888888888888888888888888888gc84WtQiTx1W49ejAXPX07uEG+c888888888888888888888888888883idLrW5MaXvTjWLVXUcx80V+0888888888888888888888888888yZ4WGlqjuR6Wf/s36HaXcI82IUU888888888888888888888888888v4fEJxZvuc846e288vd5UXxj9AU888888888888888888888888888888P+9888w6e0kceiS288+BDA+U88888888888888888888888888888888882aAdjEOCxP5yJ0JULx+U88888888888888888888888888888888+6p5bal0N0n6ADvctQmJ308888888888888888888888888888880iEvtGfwdZ++pXyydUwARX9U88888888888888888888888888888To9q87AC6lHjXj+GCwcjCP4588888888888888888888888888846msqNiCubpPve/9PfNCbewMW9K888888888888888888888888888cvI9KagDvf8846ay88sP8AHKMJQSfPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPLrvPPPMNvIVbnqNttPOw1VXfPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPMvmE59HzsrSCq3POXdNPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPnCRHKwQFSAVyWwXPPLsnlPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPNqoOKLvfnKKElQko6nPPHTx/PPPPPPPPPPPPPPPPPPPPPPPPPPPPOOtfntBnp4/8AGUMNLNN5zzy2+/zzzzzzzzzzzzzzzzzzzzzzzzzzziTV98/Z722pX4493qzrbhzzzxPpTzzzzzzzzzzzzzzzzzzzzzzzzzzy4vIIWhl/L7baaoLJb7L77jjx/VTzzzzzzzzzzzzzzzzzzzzzzzzzzzjqY5rCwzzzDrpCzjrQwAACzx7bTjzzzzzzzzzzzzzzzzzzzzzzzzrwjyxoIL446wzyywywwzzxz7q7rYqaCrbzzzzzzzzzzzzzzzzzyrJK5Z6zzzzzzzzzzzzzzzzzzzzzzzzzz76r7p7jzzzzzzzzzzzzzYa7zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzyx45bDzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz7zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz//EAAL/2gAMAwEAAgADAAAAEPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOPvDAoAEFFsvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOPsGj5EiEjvNPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOJlDu9flNGDSNhkPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOJpqnM7pE2lSf4IlvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPIvmhGNbah4jb+pDMnvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPMoIGxchrFe/f026iHvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPJvkLredIvS1V4044jIIJFPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOEmGuCmxN+IRO+NvMqkpEPlPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOGHkmZuP/DBpKnHDPHPPOSSFPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOLFRYXX1iOmltNPPPPPPPMUVlPPPPPPPPPPPPPPPPPPPPPPPPPPPPPLHt3QOjOMqkBDnnEstPPL5tzlPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPCs9vMEFrQZh4hpMws9PAIW0lPPPPPPPPPPPPPPPPPPPPPPPPPPPPPKvHOJrhG5kLizNhxbZfPCREblPPPPPPPPPPPPPPPPPPPPPPPPPPPMPHNHK5AYDitVnjU4H0tfKp7WWXPPPPPPPPPPPPPPPPPPPPPPPPPPPPONV76lSRilUT24SclaFFJPJ4hdPPPPPPPPPPPPPPPPPPPPPPPPPPPI+M4LGyJcV7SLTmAHC061HKVCllPPPPPPPPPPPPPPPPPPPPPPPPPPPL4j+Bd7UHHPPImPvPD/iHAI9FtvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPLPrHfPPOPs+pioIMOtPDQ6InFPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOtD0c6ALRQqyu1K9gZFFPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOhCS67GyDE8f+EF9L0rCddPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPMDMaaeYTs5KraSiQYtOT80HVPPPPPPPPPPPPPPPPPPPPPPPPPPPPPAP5WsiCkXCm+8dhMH+FB/Tv2/PPPPPPPPPPPPPPPPPPPPPPPPPPOJHtOdzJcG9/FnnjsfALsFiz0+R/PPPPPPPPPPPPPPPPPPPPPPPPPPHL3wHzDjNHXPONkMtPPLKFLG/gP8ATzzzzzzzzzzzzzzzzzzzzzzzzzzzzyz8xzzzzgC6VtSAJTbDytT1LlTzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz6Q/q2hqQNvnMHzzR8Izzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzy4akM1b9wMosrf51zxr3EtTzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzYSTJSSqQpdQNQNObnzy7G6Xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz1aJ+aD3a5cn2d5/rr5Tzz+yTzzzzzzzzzzzzzzzzzzzzzzzzzzzzZuGHfOeAS6i4949DSoVTzzz4WFTzzzzzzzzzzzzzzzzzzzzzzzzzwz91W/uVuwaxBaoogL7g7bbzzT45TzzzzzzzzzzzzzzzzzzzzzzzzzzzTr7ziLCFDD64r6LKzo7QpLoKC7jDTzzzzzzzzzzzzzzzzzzzzzzDLZrb6zRLb45xxwzzyywxwxy5pQQj7ypjLTzzzzzzzzzzzzzzzzjYjjhZ6xzzzzzzzzzzzzzzzzzzzzzzzxx45iTgLDzzzzzzzzzzzzj6L7zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzxy6Z7jzzzzzzzzzyxzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzy7zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz//EADQRAAEEAAQEBQMDAgcAAAAAAAEAAgMRBAUQMRIgIUETQFBRcSIyYSMkMDSRFENTcICBof/aAAgBAgEBPwD/AH2sLiVq1atWrVq/S7V8taDb0u1elFUqVIRvOzCUMPOdon/2X+ExP+i/+yfFLH97CPkaj0e9QEyKSQ0xhJ/AUWUYx9W0N+VHkTf8yQn4UeUYNm7L+UzCYZm0TR/0iI27AK2ovAWZ4nxpyBs3Tv6PapBqw+VYqajw8LfcrD5Lho6L7eUyKNgprANCQAi8BF5RJOmY4nwYDR+p3QIn0e1SDewWFymeYgvHA1YbL8NB9rLPudS8BOkK6kahONWVj8R485I2HQIlD0alhcDNiXfSKb3cVhMsgw4Brid7nVzwEXk6FzRuU/EwtHV4T8yw7RunZxCNgn5yOzFLm0j2OaBVjW1av0MAkgALAZQX0+cUOzUxjWABoAAV0nPRk6dVLjYGDq8KXOGAUwWpM2nd9vROxc793lF7ju7Q60q9FjjfI8MYLJWX5UyAB7+r1YCMgU+Nhiu3qfODswKTHYiTd5Rc525VFAKv4Io3SSNYNyVj4hFIGgdvQoonzPDGCyVgcBHhWA7vO5UkzGNslYnNo2/YbKmzHESn7qCLnONkqlSsK/4sow1/qkfCzltTj49BYx0jw1oslYPCw4KLieRxkdSsVm7W2I+pU2MnmP1ONKtbV8lq1fLEwySNaO5WGiaxjGjsFnoqVnoOGlhwjOM06Q/+LEYyed31O6chdpYTpWhOlcT0XivCEzl434QmavFb7oOB2KvXKYOJ7pCOg2USz772eiXo54anTeyL3HvrV6Va4CuBAUm7DXL4vDwzB3PVRhZ8PsPoRKtOlaEZXFGz3Va0SuFcLV05Iz00wzPEnjb+U1tNATNlno/Tafz6ASnPA3KdKeyL3HfkooBdOUaxaZVHxTl3sEE3ZZ4P0Ah50kBOmHZOlcVenVUumgY87BNgPcoQtQa0bBUEY2oxIxvCII7aMPXTJ4/oe/3KG4XZZyP2yHnS0HdOgHYoxPHZEEKkGPOwTYH9ymwtCDWjtyEq1fJwBeGAdMqZWFB9yhuhss4F4VyHoBaDuEGNGw5r03XTWyrV65e2sLH8IbhDZZoLwj139EtXoSAjKAnSuKEr/dCZyE57hCYLxWnug4HYq0Fgf6WL4Q3CGyzIXhJPhd/Q70dIGp0zuyLnHvy1a4FwIdE3qBpgf6WL4Td0NljheFk+F39BtEgJ0wGyMriVur0KpBqAHLHtplpvCs0bssULgk+E4fWfnz5cjI0J0p7IuJ0rlAJVH25Qo9MndeHI9jozZTi4X/Cf97vnzrnAJ0qL3HkrQAlCJ57IYc9yhCwIADYKkWNK8Ee6MblwuHbRh+oaZK/rIzSPZS9Y3/Cm6Su+fOloKdC3snQuCII7IWUI3nshB7lCFgQaBsOQlcSvkLQeyEYBsaZZL4eKb+eiCZupB9DvhYkVO/59ALQUGgbDmJV8tq1esbyyRrh2KieHxtcO4Td077T8LGCsS/59EtXoSAjKBsnSuPdB7/dCV4XjnuEJx7IStQc07FDXKpuPD8J3ahuF2KzAVin/AD6FaJ0dI0J0p7IvcRydVRQauAIUE02Brlk/hTgdnIdkNis0H7t3oF6EgblOmHZGRxV9eSkGoBq6ckZsagkEELA4gTwNd32KB6LNumKPny5OlaE6Vx2RJ0rStQCdgqI7a2r0j35MrxJil8M7OTCs5FYkH8edc4NT5j2CLnFUgqVKj7LgedmlCJ5QgHcoRMCAA0LGoxBGJ3uvCcuB3smBwO3ICQQRuFl+LE8Yv7h0KzsfqsPnSAUYWleCUIPyhC1CNg7KmqwrVq1atWrVq1atWr5MPiHwScTVjMWMTwmqI89atX/Ef4rVq/N2r5AFSpUqVfy0qVKuS1avydq1RVKlXm6VKlWl+Rr0WlXrFf8ABT//xAAwEQACAgIBAQYEBwADAQAAAAABAgADBBExBRASITJBUCJAQlETICMwM2FxUoCQkf/aAAgBAwEBPwD/AKyF0HLCG6ofWJ+NV/zEV1bgg+3NYi+ZgI+dSvB3G6ix8qiNm3n6obrW5YxUsb7xcUnkxKkX0lKd1fayQJbm01+G9mW59r+XwELM3JJ7FRm4EXGPrFoRZrXZWu29q3qXZtaeCnZluVbZyewAmJjsYmMg58YFA4/LWvdX2m7JrqHidn7S7LssPOh2KpbgRMZjzFpRfTs0YFJn4TQUmfgwVDY9oJ0Jk5wG1r/+wuWOyYFLcCV4pPmiVIg8BAjH0gpgqUQKo9Jr2t3VFJY6EycxrCVXwWAE8CV4rHxMroA4EWkesCKPT9xjoEyl++CfYrLFrUsxmRkPcf6lWM7n+pViKvpAij9/IfSkTCO0P++wswVSTLbLMmzS8SnCA8Wioq8D5AnQmS/wNOnHaH/fYbEe5tcKJXSlY8B+ZrEQbYgTI61jVbCnvGZPW8mxtKe6InUsldfGTE6zeORE64PqSJ1fHaL1HFb6xFyaW4cTfbc2hqZZPdAnTT8Dey7EvzsegbZxMnr/ACKll2fkXedzCdz1HYIFJ4EFTQVCJtDsTDcvSpPbY22mUfi1Om/V7HZdXWNswEyet49Y0nxGZHWsi3YB0I9rudsx7NGKhMXHYkQUrBWg9Jodhm50x916+3Yx0DCfGZB3bOmn4mHsBIHMyOpYtAPecb+0yevsRqoal+ZfcfjczRgQmCgxaAIK1HpO6IlbsR3VJjV2DlT2jt6W+nK9lx0s9Jcd2GdOPxt89ZYlalmIAmR1yhNisFjMjq2Vdsb0PsI3fY7OzFpY+kXHgpUTuAQKfQSrCybfLWZT0dyP1DqV9Kx052YlFSDSoBCiHlRLMKh/p1H6VWeGj9MvXjxj0XIdFDO4eSJgt3chey48Q8S3zmdPP6p+etpruXuuNiXdFqbxrOpb0vIq+nY/qNUV5WBCeBK8LJfyoZV0i4+cgSvpNC+YkyvFor8tY/ZIB5EbHqblRBgVBw6+BB7LvNG8sfzNMA/rewvj0v5kETFoTisQAD8/E2Pv+xYfiMbgxvMZhfzr7RZfVWCWYCZPXKKwQnxGXdYyrToNoROoZKjzmJ1fJHOjE6431JE61SeRF6njN9UTLofhxNg9j+Yw8GP5jMM6vX2UkAbJmR1PFp3t9n7CZPX7GJFQ1Lsq+47dz2A+IgizuMfSCowVCL8PEwn79KnsfzGH1lvnaY/hcn+wcexW5FNQ27gTK69SnhWNmZHVsm7Y72hGZmOyezRMFTGLjNsRalAG4FUcD8vS23UR2WeY9l41YZR/Kv8AsHA+fLKOTMjquLTv4tn7CZPXbX2Kx3RLci607diZqCtjxBjmChRAqj0giV2MfBSYabNbKmcdu+zpT6dl7LvN2ZQ/UlXhYv8AsXyj52/JqoXbtqZHXVGxUm5fn5d/LED7CFLDyDBSTFo+5grQekAi1u3AMq6dkuPBJV0UkfqNqU9Lxq/Qt/sSmtPKgEKqeQJZh0WDRWP0uoj4Wj9KuHlIMsxLk5Qw1sORMF+7kL/fZcOOzMHiDEOmEQ7RfnbaKrRp0BlvR8dvJ8Mu6TcnivjHotTzIYlVjcKTKunZD/RKuit9byvpeMnI3EoqTyoB+zoGNRU3KCDCpVgyjRHZaNr2ZS/CDF8wlX8a+wNWjcqDFqrXhQP2CQOTNg/sEbEI0Zeu0MHMo/iX2e3JpqBLMBMnr9KbFY2Zf1fKubXe0P6iZ2QvFhidWyR67idbsHmWJ1qs8rF6rjHkxM3HfhxAQRsdtq6aMNqYw00xjulfZCyqNkzI6ti0jzbP2EyevWvsV+AluTdaSXYnsHMHEECE+kFTQVLF+HiYNnfoXtsXa9l408wzulfYrsuikEu4mT1+tfCobl/VMq4nbnULMTsnsAJgqJi0eI3FqUcwBR6fl6W+6yPsfyWL3WmSvjuYP8I+faxFGyRL+r41WwDszK63fZsJ8Ill9thJZiZ4wVMYuOYKFgRR6diVWMRpTDTYOVM0R6fl6U+nZfyWrsbmQu0MwD+l87kZVVC7czI65yKkP+mXZWXd5mMKWE8RaWPMGOIKAOFi0WnWqzBh5J4rMq6VktyupX0YfW8r6bi1/Tv/AGLXWvlUCFVPIEfEoflY/S6jwSI/SbB5WBh6ZePSHp94+mYmPfVcpKnX5b00CJg+CsP7+detHGmUGWdMxnHwjumHo7ejiDo33eV9Jx1HxbMXBxl4SCikcIIFUcAfIuoYalVX4ZP9/wDhZ//EAEcQAAEDAQMGCwYEBAYBBQEAAAEAAgMEBRExEBIgITJREyIwNEFCYXFygZFDUFJTYKEUFSMzQFRisQYWRIKS0SRjZJCgosH/2gAIAQEAAT8C/wDmhLmjpCdVUzcZmeqNpUI/1DPVG1qAe3avzmg+avzqg+NfnNB8xfnFB84IWpQfzDELQojhOz1TaiB2ErT5q8b/AKclrqSLbmapLepRsMe5SW/J1IB5lPtmvd1mt8k+srH7VQ7+yJc7Fzj5q4buRuG5CWZuzK8eaZaVez2/qmW5Vjaax32Vn1j6thcYs0b9/wBKyTxRC97wFNbtI39sOf3KS3Kx+yGsHqVJVVMm3O8/ZXDd/BUVI6rmDBs9YqONkbGsaLgPpKSWONuc94aO1T27Ssv4MGQ/ZVFrVk+D8xu5qOs3kknt5C8K8LMecI3+iEM59hJ/xX4Sq/l5fRfgqz+Wk9F+Cq/5aT0X4aqH+nl/4oxSjGJ//FXO+F3poMY+R4YwXuKoKNtLAG9brH6Rnq6enF8kgCqLeedUEd39Tv8ApTTTTuvleXHt0mRyP2GOd3C9R2XXyexu8WpMsGqO3KxvdrTLAh680h7tSbY1nj2V/eSmUFGzZgZ6IRRjBgVw3ado1DKamc8gX4BazrOWx6Dgm8NIOO7DsH0hU2hTU44z9fwjFVNtVMmqO6MfdEkm8kk7zoNa57s1rS47gobHrZMWhniUf+H4vaTPPdqUNmUMOzCL+3WgAMBomRgxcEaqnGMrfVGvox7ZqNpUfzQvzWj+NfmtH8a/NqL5ignjnZnsN4yWvVcPU5g2Y/75bIoeHl4V44jfufo+praemH6j9e7pVXbM83Fi4jd/Su3pyta95ua0k7gqaxaqXW/9MdusqGxaNm0C89qZFHGLmMA7srnsbi4BPtOjb7UHuT7Zi6rHFPtic7LGhPr6x3tbu4IyzO2pXn/crlcN2S8IyIuKhhdPKyMdJ+yijbHG1jcAFadV+HpXEbTtTctJSvqphG3zKiibFG1jRqA+jZZY4mlz3ABVVuOdxacXD4inOc9xc5xJ3nLBZ9VPsxm7edSp7Bibrmfn9mAUUEUQujYG5CQMSpbQpYsX3nsUlsn2cXqpLQq5Ovm9ycS7aJPfpXhcIs46FjUmYwzOGt2HdktOrNRUuuPEZqbkaC5waBrOCs+jFLCB1jtfRtba8MF7Gcd6nqJqh18ryezoydNypbHqp9bv029uKprJpINebnO3uyy1tPFi8Ke15Haom5vaVJPNLtyE6d6L0XnSo6c1E7WdHT3JrQ1oAwCtar/D05APHfqGWxaH/USDwD6MmnigZnyOACrrXkn4sV7Gfc5ACSABedypbFqJdcvEb91TUFNTDiR69/Tke9rBe5wAUtrwDVGC7+ynrambF9w3BXaZeFnnkbHpuCgzyOM/JadT+IqnEbLdQyWbRGqm1/tt2v8ApAAC4fRddaUNKLtp/wAKqKmapfnSOv7OgZKSyamo1n9Nm84qls+mpRxG3u+I45JJWRi97gAp7Y6IG/7ipZpZTfI8n+2neEZNyvPJUFN+JqWt6o1uQFwVsVRgprmHjP1ZIYXzyNjZiVS0zKaFsbej6LtC2Q2+On1u6XdARJcS5xvJxKpaOeqddG3V8RwVHZNPT8Y8d+85HOa0XuNwVTawHFgF5+LoUkksrs6R5cdMvCLzytl0n4envO27WVgrRqfxNU53Vbqbksmg/DxZ7x+o/wC30U97WNLnG4BWjarp744jdHv3pjHPOaxt53BUNiYPqf8Agmtaxoa0XAZKm1IYr2t4zlPUTTm97vLo0y8IknlqLgPxDTM8Bg16062LPHtVV21TvgeyLOziN2SkfBFM18rS4DAdq/P4fkvX+YIvkPX+YI/kPX5/D8l6/P4PlPX5/TfA9RSCSNrxgRf9BzTRwsL3uuCr7RkqnXYR7v8AtUdnz1WzqZ8RVHQwUreINfS7pyT1EUDb3uVVaU0+pvFZ99IoybleeQvWcr1eVeeWOBVFzSDwD6CqamKnjL3lVdZNWS68OqxUFjZwz6kdzP8AtNa1jQ1ouAyVdpMi4rOM7+yke+V2c83nRvARk0r1er/4U4FUfNYPAPoGpqYqaIveU99XaVRxR5dDVQWZFSi/ak6Tke9rGlzjcFV2m+W9sWpu/pOiXAIvOjer+TvQZIcI3HyQpqk4QSei/AVv8u5fltf/AC59V+V1/wAj7r8pr/lD1X5TX/KHqvymv+UPVflVf8n7r8sr/wCX+6lp54buFjzb8MpwKo+aw+AfQFTUR08RkeU2KqtWoz3aox9u7tVNTRU8YYwZKiojgZnOPkqmrlqXcbZ6G6BICL8t6zlfpXjemte/Za49wTLPrn4QO89SZYdc7Esamf4fd16j0CbYFMNqR5+ybY1A32d/eU2z6JuEDPRCGIYMCzRu5EkAElWhUfiZS/qjU3KcCqLmsPgHv+aaOGNz3m4BRwT2nPw017YBst3pjGRtDWtuA6MlXWR07d7ugKaWSZ+e868pNyL92XO0mhzzc1pcewKKza2TCAjxalFYLz+7KB2NTLCohtZz+8qOz6KPZgZ6XoNa3AAfwNtVWZEIWnjP/snD9MZXYFUXNYfAPfznBrSSdQTYH183CzaoW7DN/aVhkra9tOLhrfuTnue4ucbycpfuRKvV+gxj3m5gLu4KOya+T2eb2uUFgH283k1RWTQx+yzvFrTY2N2Wgfwr3hjHOOACnndUTukPSdXcpP28pwKouaw+Ae/nxmZwztgdG/LXVwgGa3W8pznOcXON5OQvCLlfoRU1RN+3E4/2UFhTu/deG9mKhsWjjN5Bf4kyNjBc1oGWptWkg6+cdwVRbVVLqj/TH3Udp10fts7xKG3pB+7Ff2tUds0T+vm96ZPC/ZeD/A25U3RiAYux7k0a1JsZTgVR81h8A+gK6tbTtuGt5wCcXOcXON5KJATpFnZYqaom/bicVBYMjtcz83sChsmiiu/SzjvOtBoAuAyvkZG3Oe4AKotynZqiGefsqi0KufakuG4aQ1Yau5RWhWRbMxPYdait6UfuxX9yjtujdtEs71FV00uxK08o5wa0k9CqJTNPJJvOruUY1p+xlOBVFzWHwD3/AFtW2nj/AKjgE57nuL3HWU54RdfkjjkkOaxhcexQWJUv1yEMHqVT2VRwa8zOdvKAAw0J6unp23yPAU9vuOqCLzcpZ5p3XyvJ/tynSo66si2Z3eetR27UDaja5R29TE8djmKKtpZtiVpV9+nbNTwcAiB40n9skafsnKcCqLmsPgHv6pqGU8Re5T1DpXmR51n7IyE5IKKpqP24zd8RwVPYMQ1zPLuzoUUEUTbmMAGjU2nSU+pz73bgqm2amW8M/Tb90SXG9xJO86LInu6E2maMVwTEYdxXAuXBv3K47tPUo6qqi2JnBR21WtxzHfZUs3DwRy3XZww0bSn4arfubqGRmCdsnKcCqLmsHgHv1zg1pcTqCr678RJeNkbKJJKpbJqp9ZbmN3lU1k0kOstz3b3aOCqbYpYbw057twVTadVUdbMbubogE4BNpXHaNyZCxvRyGa3cjGzcuBauA7VwLkY37lcctm8xg8OhX1H4eme/pwGUJ2ycpwKouaw+Ae/J6mGBmdI65V1pvq/02NIZu6SqaxqqbW/9Nv3VNZ9NTDis1/EcdEkDFVVtU8V7Y/1HfZVNoVVReHvub8I0WwyO6E2laNrWgAMByt6zgs9ElOxyWdzKDw6FuS/txeZyDEZDgcpwKo+aw+Ae+662Gxng4OO/+yisutq3cJUPLe/FU1BTU2wzXvOOiXBovJVVbcEfFi47vsqitqag8eQ3fCMNANJwCZTE7RTYmNwHK5wWes46L8lBzODwaFZNw1VK7tuGRm1onAqj5rD4B75nqIoGZzyntrrQ1EGGH/8ARVLZ9LTbDNe/p0b7lVWzTRXhnHd2KpraipPHdq+EaDIXu6E2maMdaAAw5POCz1nHkX4ZKHmcHgGWuk4Olld/ShkjxynHIcCqLmsPgHvh5d1UylYHZ7+M/ef/AOaVZa1PT3gcd+4KptGqqMXZrfhGVrHOwCbS7ymxMb0ckXhcIUXHlThkouaQeAZbckuhZH8Ryx5XbRyHAqi5pB4B79qa6nph+o/Xu6VV2tUT3hvEZ98rIHu7EynYMdauAw5DPC4TsWe7+DoeZweAZbXlz6wj4Bljwyu2jkOBVFzSDwD33JLHE3Oe4AKstwuvbTi7+sokuN7iSd5TWOdgE2l+IpsbG4DTzgjINyLzyHZ0p17doEd/KnEqi5pB4BkOCqH59RM7e7KzZyv2zkOBVFzWDwD31W2vDBe2Pjv/ALKepnqX3yOv7OhNge7sTII29uleFwgXCFXnfp5wUdNUS7ETio7HqHbTg37qOx6cbZc9R08MY4kYCdGx200FS2VRydTN8OpPsI9Sf1CksmsZgA7uT4Z49uJ48leOQcqLmkHgGSqfmQSO7EMrcBlk2zkOBVHzWDwD3xLNHCwve64BVdp1FUcyG9sf3KZS/EU2NjcBlvG9Zzd6zwjIi47+QZBO/YjcVHZFQ7aIb90yx4BtkuUVFTRbEQ5KShpJNqFqfYtKdnOapLFl6kgPepKCrjxhJ7taIIxGg/BUfNYPAMlrvzaJ/bq0G4DLLtZDgVR81g8A98SwxzMzZG3hS2OzGJ+b2KWhrY+reOxEuBuN45NsM0mzG4qOyat2NzVFY0Q23lyjo6ePZjCu/gXRxv2mgqWyqOT2d3cpLB+XMfNOsitb0NPcVNS1DAc6JypOaw+AZLdd+lE3e7QGGWXayHAqj5rD4B77kp4ZNtgKlseM/tuIUtnVUfVzh2I3g3EXHQZDNJsRkqOyal21c1MsaPrvJUVDTR7MYVwHIue1gvcQFU23Tx6o+Ofsp7TrJvaZo3BMq6qPZnf/AHUVt1bNsNePRR29Tn9xjmqKvpZdmUK8Hkbstuu/UhHYdAZZschwKo+aw+Ae/pKeGXbYCpbHgdsEtUdixjbeSo6CljwiCAA6OTnq6eD9yQBVNu4iBn+4qWeeX9yQu/tpsnqI9iZ481DbVYzbzXj0UdvQe0Y5v3UdpUUmEzUCDgeQts/+W3waAwyzdGQ4FUXNYPAPouqtalp9V+e7cFUW1VSXiPiD7okk5xOvfylwUcssexI5vmo7ZrWYlru9M/xA3rwO8lDatFLd+rcdx1IOa7Ag6Frm+tPh0Bhlm6MhwKouaw+AfRBcGi8lVNt08d4j47vsqi0ayfakuG5uk2ne7sTadg7VwbNy4Eb1wJ3rgnrNdu5Bkkkew9ze4qO1q9ntQ7xBUM756WORw1kZLU59J3DQGGWbAZDgVRc1g8A+hpJo4he9wAVTbrBe2Bud29CmqZ5zfJIT2dGi2N7sAm0vxFNY1uA5C5Zjdy4Ji4Eb1wPajE5Zrt2WzeYweHJafPpfLQbgMsuGQ4FUfNYfAPoSaeKFuc94CqLeOsQR+ZUksszs6R5cdAAlMp3nHUmwRt7eWvCzws8q8p2OSzuZQeHJanPpO4aDNkZZdnIcCqLmkHgH0FLPFC297wFV2448WnH+4qR75HZz3Fx7dBsT3dCZTDrJrWtwHKXhZ6z1edF+Sz+ZweDJa4/8092gzZyybOQ4FUXNIPAPoCWaKFudI4AKqt3op2/7ipJHyOzpHFx7coBOATKZxx1JsMbejk7ws9Z5V/IvwyUHM4PAMltc7b4NCPDLJsnIcCqLmkHgHv572sF7jcFV26Be2nbf/UcFNNLM7OkeScrYXu6E2mb060AG4Dkc4IyLPcrzyrsMlDzSDwDJbrf1oXdh0I+nK/ZOQ4FUXNIPAPfl9yrLZhhvbHx3fZT1VRUEmR9/Z0ZA0uwCZSnrFNiY3AcheN64QLhCrz/B0PM4PAMlvN/Thd/VoR45XYHIcCqLmkHgHvurtOmpsTe74Qqu0aipOs5rPhCuTIHu6E2mYMdauA0y8LhFnE9PINa5+poJ7k+GVm1G4eXKnEqi5pB4BktlmdRu7DfoM2spwOQ4FUXNIPAPfM9VDTtzpHgKrtqaW9sQzG7+lBj3YXplKesU2NjcBpZ7VwnYs93INvds61HZ9VJ1Lu9MsV3Xm8gorLpI+rf3prGNwaArgehS0FJLtRBS2HEf25HN+6dYs7dl4cpKGrZjC7yRvbiCOQcqLmkHgGStZn0so/pQwyjHROBVFzSDwD3u97GC9xuCq7bGtlOLz8XQiyad2fI+89qbTxt7VqCzhvWe3es9qzwuEWe5X6es4C9R0FXJ7O7vUdjO9pJ6Jll0jcW396ZFGzZYByT4Yn7TGlPsmjd1Lu5SWGOpKVJZNW3AByfDLGeOwjQkwVHzWDwDI4XghTNzZpW7nHT6UcCqLmkHgHvZ+ddxcU+zeHdnVEhd/TgFHQ0sY4sTVNZVO/ZvaexS2VVM2TnhPjkj22OHJC92yCUyhq34RHzUVjP9pJ5BR2XSs6t/emxRt2WgcgSAg5pwPIkA4hSUNLJtRBSWJTnYJapLFqBsPaVNZ9Ywa4T5a1SAilhB+AZbUj4Otf8A1a9BuGU4lHAqi5pB4B77cxrsQprKppNYGaexSWRO3YcHKWKSL9xhblGs3DWo6Crf7O7vUdjSHblu7lHZVKzEF3emRRs2WAclJNFEL3vAVRbrBqgZnHecFPXVU+3J5DUmSyx7Ejh5qK2KxmJDu9RW/r/VhuHZrUNqUcuEl3fqQc12BHK29F+1L5aEeGV20UcCqLmkHgHv4tacQpbLpJOpcexMsmkbiC7vTIYmbLAOUqLQpYNuQX7lVW5K/VCMztT5JJDe95ce3TbJK3Zkc3uKhtWuj9pnDtUVvj2kJ8lHa1C/2t3fqTZGPF7XA8jacXC0knZrQyx5X7RRwKouaQeAfRRIAvJVTbNLFeGcd3Yqi1qua8X5jezlmuLdlxHcVHaldH7W/vUdvu9pD6KK2qJ+Ls3vTJon7LwdFwzmkb1NFwU0ke45WY5ZNpHAqi5pB4B9ESSxxi97gFUW8wXiFmd29CnrKmf9yQ3bhhogE4BMpnHHUmwMasxu5cE1cD2rgXLg3blmndpgluySO5R2lWx4TX96opXzUsUj8SNC24c2Zkg62rKMsm0jgVRc0g8A+hp6ungH6kgCqrccdUDbv6ipJJJTe95d36LYXu6E2lb0oNa3AcjcNy4Nu5cC1cB2owuRY7LZ/MoPDoWtCZaR12Ldeg3DJLijgVRc0g8A+hKiup6ccd4v3Kotyd+qJuYPunEucXOJJ3nQDScAm0zjimwsb0ctnBZ6zjkdjkoOZweDQIvBCqojDUSRnfq7srMMk3QjgVRc1g8A+gqiupqccd4v3KptmolvEfEb90bybybzoNge7oTKZox1oADAcpnBZ6zzpPyUPM4PANG3Kc8ScdGp2VmOSboRwKouaw+AfQFTW09MP1H+Sq7ZnlvbEMxu/pRvJvJ178rWudgE2lPWKbExuA5MkLPWceSfhkoeaQeAaM8LZonsd0hOaWPcw4tN2QY5JsAjgVRc1h8A9/TVEMDc6R4CqrclfqgGaN5xTnFxznEk78raeR3Ym07BjrQuHIlzd64RF7uWOGSi5pB4BpW1S5jxO3B2p2UYKbAI4FUXNIPAPfj3sYL3G4KstzFtOP8AcpJZJXZ0jy45Gsc7AJlL8RTWMbgOQzgjIs9yv/gt6ouaQeAaVVAJ4HxnpCc1zHOY7EHXkZgpdhHAqi5rD4B76JAxVXbMEV7YuO77KeqmqHXyPv7OhXX4JtM89ibBGO3TJG9cIFwhV/ICKV+ywlOpaluMLlhjyjulUfNYPANO2qXNeJ24HU7IzFS7COBVFzWHwD3zWWlT0o1m93wqqtKpqdROa3cE2J5wCZTDrJrGtwGjnBcIFwhV5071HDPJsxkqOyqp2NwUdjR9d5KjoaWPCMINAwGSSmgk2owVJY1I7AFvcn2G8bEt/en2XWN6l/cnwzM2o3DkHqj5rB4BpzRNmjcxw1FTwOgldG7owTcVJ+2jslUXNYfAPe81RFA3OkeAqq2J5iWwNLW/EhAXnOc9Niias5q4Rq4Rq4Rq4QLhESdC9XhBjzgxx8kKOqOEJTbNrD1AE2yJztPATLGh67iVHQ00ezGEAByRaD0KShpZNqIJ1jUxOouCNiRfMcjYf/rFGw3/ADkbFn+MI2RV/wBKksuuu/bvVM0sp4mnENHIWrR8NFntHHbkd+2jgVR81h8A97ODiNRuX5ZTl2fLfI7tTYYmC5rApbPpZcWeYU1jP9lJ5FS0dTFtRHy15b0NeATKad+ELk2zKx3swO8ptizHalA7k2xIutI4ptk0g6t6bQUrcIghBCMI2q4btK8b1nN3hcLGOuEamAe1b6r8ZS/OZ6r8fR/PZ6r8fRfzDPVfj6L+YZ6r8fRfzDPVfjqP57PVfjKX5zPVfiID7RvquFj+MLObvCvHLWrRmCXhGjiO+xQN7CjgVR81h8A9+S0VNNtxhCxaa/bfduTLMo2ey9U2KNmywDQzgOlOqqdmMrfVOtegHtkbepOhrz5J/wDiD4IPUp1v1PRCz1RtutPQwL82r/mD0TrQrXe3d5I1lUfbv9UZZDjI/wBVnu3n1R1q4blcNy8l5LyXkvJXDcrhkz3fEfVCWUYSv9V+Mqh7d6baNa325Qtev+MeiFuVY6rChb9R0wN9Uy3x14D5IW5R9OcPJNtWhd7YJtTA7CVvqrxv0HsY8XOaCE+yqJ1/6V3cpLBhI4krh91DHwcTGX4C736SB0p9bSx7UrU+3KJuBLu5Pt8dSE+afbdY7DMan2hWvxqHIySnGR581cPcIklbhI8eabaFa3/UOUdtVjdrNcmW/wDHAfJR21RPxdm96ZV0z9mVqBB6ffT54o9p4CltqiZg4u7lJb59nD6qS161/XDe5PmlftSOPmrhu/gLxoZrtxWY/wCErMf8JWY/4Ss1246F/wDAak2eZmzK4eaZbFcw7QcO1RW/8yE+Sitiif183vTJon7LwfeRc1uJU1q0cOL7+5S2+8/tReqltKtk9rd3Jxc7aJPfyNxOAJTaeodhC/0Qs6ud7AptjVx6rR5pth1PS5oQsCT549F/l/8A9x9k2wKfpkcV+RUX9Xqm2PQj2d6FmUPyGoWfRjCBq/C0/wApq4CH5bVwUXwBcFH8AXBs+ELMZ8IWYz4QsxnwhcGz4QuCj+ALgYvgC4CH5bV+Fp/lNRoKM+wavyyh+Q1GyKD5SNh0R+L1RsGl6HPCP+Hx0VB9EbAf8/7J1hVAwe0o2NXDoafNGza8exTqepZtQv8ARaxi08i0uZsuI7lHadbH7W/vUNvn2sXmFDadHNhJd3oEHA+63yMZtOAU1s0kd4ac89imtqqfsAMH3Uk00m3I46Qa52DSfJMoKx+ELkyxK12Oa1MsA9aZMsKmGLnFNsehHs0yhpGYQtQjjbgwBXD3GY2HFoT6GkfjC1Gx6E+zT7Cpjg5wT7Ad1JvVPsWtbhmuT6GsZtQORa4YtI8leN+hcmVE8exK4KG26ll3CNDgoLYpJcXZp7U1zXC8EH3NUWnSwYvvO4Ke3Z3ftMDR2qWWSU3yPLtBlLUybMLymWPXO6jW95TLAPXm9FHYdGzEF3emUNIzZhagxgwaPeRjYcWhSWfRyYwtT7Co3bOc1PsCQbE3qE+yK5nUDu4p9PUR7ULx5aENRPAb45CFT27INUzL+0KntCln2X69x9wue1ovcblU23Ay8RDPP2U9o1c+1JcNwyNa55uaCT2KOyq5/sru9R2BJ7Se7uUdh0bdrOd3lR0tPHsxNHl79uCko6WXbiaVJYdI7YzmqSwZhsTA96ks6tjxhJ7taIux1ZILTq4cH5w3FU1s08twk4h+ya5rheDf/GPexjb3OuCqbcYNUAzjv6FPUz1LuO4u7FFZ9ZLhCe86lDYL/ayjyUVj0MfUzu9MijYOKwD6GfBDJtxtKksWifg0t7lLYMg/alv7CpaGsi2oTd2a1BV1FMf03kf0lUttxP4swzDv6E1zXC9pvH8QSALyVNamsspozK77J1n2nWHOneGjcoLEpmfuXvKjp4Y9iNo+jpKWnl24mlTWFA7XG4s/smUVq0ZvhIcNyp7Ua45k7DE7tQIP8NJA2Xb1jcmxsYLmtA+lHxRv2mgqOFsWzhu/+lf/AP/EAC0QAAIBAgQFAwUBAQEBAAAAAAABESExEEFRYSBxgZGhMFCxYMHR8PFA4ZCg/9oACAEBAAE/If8A2huiupYJzUu2GKaBuex+xYI3+Q+0seBpBOsn022ldwWE7SMY3NKF5MhP2yLDyQ+GI89jMS8hC0wnhhaI2h4gHICGfJODshv7hSlcn0q6J61ZRWOyF5HTKEvUMph4M6H+KhUldNCmacJfSTNqo0EA25TuZNLuV3Ge8g0vz6DRdidaXyUiuhyctzeoTSpg4Ru8AyhPqGq6ub8DhLMJCM1auo/pHbqVm+hMljREWRclwuh5cMWbqh4xkhP4Ub63OixsWM9BKshC4YWg2SejuyWO43LxdbpT9IDtG+cE2vuSzvq7JfBtR0llXXbq+BGOS0iEber8wvhCWi4JWpY11LeRdO4Jg/4TedmNf/DLpTeMJ5uVzCwzIdPo+oxWTOJiTvo6ts5a7dW8ds5EssbtpOgnW/n+yFVT0SMUsqN2ZmOoQ/Gnk1clz7d8nzBPsNHeXzbYtEU2Gi7EZDeZWLdbbMIUiEiaHzTP2cLIl9JEWaEvo1Ld5tk9+k6IYGd6jwki+2wrGbSEHtssLIImEnQqGadQ6RaF/PN0ipbhaLsaZIb8+D7CHFi8wfkeEspkJub9dt/o1tyKrLmxs0jkdMFVElvJKrPAcr6Ef3aEklCUEwX/AD0VWWNOofgoFC4mizEqykZzgfCn+5whKEQhP6sMiULD5afP0Y4IvUmdcskkhjRlkq2OVy/OUJanq3XBlWF23BOtOoa+Le4kXE2hEbrFXxtll1ToNpKWIev05wXWlWW1YQEQlZfReerZPuOO2fEwhOWFXJHPCVMDOos2zXvZ6HI4fw42q7NAN136TWSqghCVkU5HQ5ZiUCrJf2Woi+yr1ev0U2kpZJlWvhNx9G6Lst2L2BBp8PyWD2qjNiyFrLDnBCy5LjQGdvUrkQCRW0jbshsl8DrhlEK7dPopEFCW2T5Z2cpLDLIqJipeS/cWBQhJDcDKj8lZcxjlLLK4m0rsyXqtJKPKpRmS3yTY5OhTRBRFUsaVPUaePPov+eai+hkap1+g0EkajsjeXr3D+UWda6ELle5dg2rLbMYN78wS4WSuxmQbLvjoQIE8Yl8Ev0fG+gwQN0rLN8hTaOql+3K5EBYFCiWE99tE5vwciOB3g7Ibb4OpDDMl/wCTx/oLEYdZLNvRDHK60yG4jvU/VYIxou2VhcXCatQnGUsxmfpSlcg6Kp4Wnw9U23jP4YTf+YsWzrtu0ac3aR5msx8f6B5DqSss29EVkOXyTQKLZZu7wbuSzMbG0S2OuE4XRjnag64NUSJPi2B5zRn7vepAd6l4FfmPGfecZWVhaX0EmyELT0HtQkpbG5qdHXHx/oBiE6RH5uRZZaiYX1KbDLbsuWKEqx7DY2kPQNt5kcG2HGMs46j2pSfLP3cdD51fcF0LNlH+HczNgpQY+F7+yLMiWxAQ2yiSRJKEsL122jmZ3dPBuL4JjuyI2fBMiaMZpvqQXf6urFvkBGkmWij/ACuziQz7R9FKLHxvf2flJe+wkkoWFP8AZLTdjEF08ENxzuxlucXvWY+RCNPoqJ/vsQjJGiWDaSlskU+p2Wp7ofU6D8EIl/ozKW5tsCFPlz/wy1zeUUvB+N9A8eY/6hjRTUtl0GPBMja1HEbrELuxF5LfcmkECVkEtFi/Iq7bJljXQYuTl5CVuDmO3l22rQWsOSLe7zey2EjSbw/UYNRJY97p2gqBasfG+gGSqjKmdXmJWHirubDUSSP0eCMTqMSQiXA8bUzZagv2oTSujs5L1ISkqPVUMouhQfOFQjW9Oq8C6eqCRJTnjvZEBCUb4F43v7HjWstWaFoWjTDG9WP1yAgQbTooEZbaLh8gDZ2Mh3/WS+GzwWrEEvI97BGLQGm7cbUphTqJIX6TK8je13UjVzOFPFgyU8E8f35C8SRLbHNZoPubmILu/wCxC9RHgSSUJQuBtJLcD+Ev1knl+2zKcDeGMrUAs83q8HZ8TZdBoNmbNheTDEC1ZPjPYZ1GVzvnhYuAeP76xyVRd2Nq1DgOq1K5W5zhIJZJDRBo0s6lTA2URGXBbKNWXpLQXwhcDsZv0ILMayeSGsynAkcjwKcTziwSeZh4GPj+98bSUtlLerdBTXHzdCyFHzbhOiSWrJlHKs6jdXdjgO4YzJg191fGzPglLMaieSG3MfAlhHjsW4TYyTp2qwSjB2Y7vDxveuPUPRZvkXWPOyJVHv14TRJbofZXF1HqdZbBEYKtjRi3K3UFMJHovMlK7Gchsz9FAuCiZrMULC5jc54eN7yyDC11dkfa93JlxSD/AFqj1rpr5xzYGOsRafRNpXYiPIQzn6q1cOIz/jjnx8jDx/fgUsaFqw7bemr+pLzLlyUNzVwSEIlx0Q05j0hszJxdvVdjXgJpTB39A/je+AcV3myhM/SEPrruyWXdZ+PRYfnxtN2ZAM7Dbd3xurhXQriNhrsj/AMNDMVqrjY4Z43vaOiLVuYmnfJbOSL9RuVxqW4kkqYxg1XY8mWPJhDdfiNm4W4NWoXkivnwvrm7heBGXI0L4TbqTVvVhnPkXlnfklKDm6BOz9C98sQbPOSal517+hh43vOFGs8x+RqgQl4EWN54StTbYBrGZIZ9BC81ihFNfpcfjmRay9Yl+SEvQaTuirvvWI+CQn1JF7VsgfULUnsMT0aG+C/UaYdOfRL8b3nD4rpsclptVUScurOsqZNHQl6+jK1HyXSKDFU+7k7HVkWN7wJFZegmnZ+isjmyklrurQIq+QXBCKZTpJ+00w/dtOC1jaw8b3zi2BJZtdHVEtETMJKWg6YtrU+JMi38sTjkyoZm9XUVokvRdETVkgt7Yo7/AFNy3Tm/uI7ygfnXQrnvYEhKafotHdCSShYcrs4LFjZEeOfvNPflEc2RLN33R4j6EXW6upZkXppp2eaki/W9Bq3tz+zipMwPJgLXLsQa8gHrtsIxTnk3DE8ofodB4FjG/B430WhtIkO6ZChd8MbTe7OX6jZdDeeXCJhdlT5CeSgkduhdKzZ8EQ0TgscJ430Sx0SSWbLF7T7iVUvteeFVcIrzo3E8urCPLYeUWrca7uNPR8V7wx9LwMhH6WELlXJYPPAlrhHjfQ6HXfplUtroOsRo7COBiP4xFn8HZ8UHdDblGzIeWw3yCOUjRdyMFjBePxlbw8b6F42JK1Y8JvDQ1suS4GMJNmihlktxJJUUcDs/RgzGDBszFwLHL+nwHjfQYHxZ3ZJwV+0G7mOBbepiN0lmVxuz4WrMajYbMyeJ4bCDdXgtY38PG+gQPKq1JJ/a6DNqRie1GVB4GsuYo9F5jRmNMkMJP0UCxAsb/AucCR43v4G9dGbGX6mUOawrLksEaUW4vVwuhC9FpzEZIZNmY7+olQsUQaxXog8b30DRJbhDLo+weTR5bMHUPYzkbI+/voNVw02qNtqDfd/4XYzeJOW/nwNVj42Hje+AQNd3B6Tcj7zFoNGLc1+EpCSXE2ldie43yQ+NKDSW6JJ5JAnPqU4mJFpcCxj4GHje9AdUDTNiecTduDN3bzGKxbI+deCBxqNGY9IbMx14pEYkjbZSaVa0D8ODVBVK++RJHKEO+Rmc/VU+MHV+OIkaDWokQ43UE8a1b2xBuWxYxeE54uzM2eF7wBrXRmzrqNhKgzP7CuOoWVCIcA3MNrkhuzgbO7fGkxJjbItEGtBSdlCEldahHCvZeknjnqJqJ9wzLS2akb0rZkE6PwfAfqNMENM1wMJCssNR3czxvdwVcVzEXodBZEl0JF7kLRdhjprnKE16KshhspIuEtaB2qkF6n6hTHJl6CCW4LCP0bMM+3mC7t3LOu9BmmgoSGpFjsOC8DSuPnHje+ARQtrcqR1hbE3oxvHQqCc4K4ltolJZYNaCyWxCuMNwnjkS9KIr3ZPOciETMlyQ07GOzmkC7/WcW/bQl0vcn6tkycuvA3Bnje/wWwhrceN81SRje7hTCvZepJrZdWI3Fa6s5gWTxOHdSMU4zYGildJfwQY5x5MnvoS4iPR+jGoqkOg0pPFqtcA8b6LhHklqyRW1Z3IsmZX9y7l31u+CSeOjyKnzMRZIdFkX+Vy8z6KI55c+FLOyQOfbfLFoXG6eN9EwYVVZtjps2ugk5TbXCpMhUmgIrS9xvLfqh6S0Wgaw05uKaDiWOrQXJSMskIFe44IfUSXNYtDT4LwvocEu2LMl4wZzrdTtw2uCFKvIopLB2fFQb8o2hi0yCAhkRgscvwbNz0JmuLSuC0njfQoOVEW7JlDVdQ2C71OB3cL5jYV0lwvP0WjMa5DcVeYgR47gU8s0ZLkuYLC8sLh430Gh65ZuOwZmmmZur4NKLcqxJYQuN2fAxoHpQ2jbfEXFSmv2QsGxXjfQLKMU8szKqULMMNrtVvFpXY5WDZH3s9JtJOom7j0Ib8yW/RQr7cTFFSojP3jB4XGeP7+x5QSZ/fyBnZN2cvBJuxeFDcr9QREJJeg3AkHoQxmN0r6kCVmvGBCZ8hri0oJ3jxvfQNa6M2Zjb7dBgYGv2x8zOghLRXH1GvMTkhu2Gzzf+F2Y+MDY1OYgiI2B5PzHhe9sQS0I7YEOj3hCahCsugvqkJJKEo4kw8oeSN3d8crUz7tEfaSOWih7+pQ+Q/caccZv0ZwepYHje9MYVo6XJ/8Aa1SLVEumksQPgaMxkybs+NofCcZB9xLxtCEr9XUsYhpPIT+KJGY3FuuQZW5hQekcE8CX5ehiWsmDO+VaoaELx4h+s093dUFas2wlVY41TvLlssMEOeJbRtDbJDeeMkNTcPDwPmTQ+VTPHEKR8OZ2tXUsiS9K5Iz/AIBJ9ylmSJGXYMj4CdniVpFsXkYuWETXoZfum60ENLnjH7zT3ZxUzUXOyP8AYiArkTEafIYlVDQzdNrQJrGeEEV4Y+VS5XpA6sA8VaT4UUM/czPtTLSOgl2Ti2h/eHfd0uSQ18UdKUrJliK0cE23dP7xJmvVdRrqMIWL2vfOQmXhPWzJVtm4WJH3C6ORIhYu6RFu4kaHyqKProqV+0ZDd4pp5I3FaV7RFwE7lrrH/wBcNmb7vDbAhaOxC0ELR2IWghaDYG0KVZvuz+qLeOsVt3yxdWGIZ5/4QM6zbr80jzSU0NCJ1oXOhPsj4Gt5ZM185vAyrnYuSjly99uyIWSl1PFoKrqmg+1STKBtQ8qjmx7AklVKHqPJ5Y5a+rDPs7gXCrNxdHkQX9dSzI/elU8+ZRWGySybzYZuEdEGcv8AcbD1qakrU3MO5D0fYTvxH8s/ln8sar9oro+x3JIErUlalPVjQRVLtAVunCz11Rd5NFgQp8qfuSyVrmUhLaVGUO5u8OijWWu6fQlai8JkXPC2L50LlzAf/NGaAtblJFLOmPu8xMPsZEu3bEu3YP5Z/BP4x/IP4B/IP4x/FP4Y3/gGy/YLj2RsBjKZMnIffZgFySlF9uLSRnt8mPISDVo80SvQaS53QW+HRZEYRKhRs8qGL5Q1t7Wjlbu4JgEicXegqvPWQuCVqPofbMfN6heYfh6Pm7Gefm2fZvJ4ykbC9ihaFzfQuH6Gl+TY3nrYn9sSX2R8CKnkSZGw4IEfSbKaDRNVqjItbEYczVP2WYKX1vZSNRVMl8t3inLhX0M6zOIQ7qAf+JTzUC0joWUdPcr2Oh9kkHxhZbNlaDFqgc8HY5BXl2Evy6LVGuWfsMWKaslXWPjyzfPUWG1kkkLEOrwPWOSWs0IcoklZe+Nl0jviQXw3Zlc2hDu8Ex4VtuoLOVfVEMoX9ZO+L+4QEkea/wBjUsrNit70iSvtNl0IuOuSG2motFIRt31eSDK9lH0MojmKL1u8mWgs5z6gfEVOxEeUwtqMs1/ofkElmTINzVnU5hE0XREG23VEI10BfR092Afts0uNQkzo+jEHtaYgTTlf5m1T7AigNl9KKYWbopjtdb/4r//EAC0QAQACAAUDAwQCAwEBAQAAAAEAERAhMUFRYXGhIIGRUGCx8DDxQMHR4ZCg/9oACAEBAAE/EP8A7QWECUg5BPC+I2nsjN6ezNKL2Gf2WHN+cH1CA6XckJtUiBI6qB2js/bZ9kOVqCKqcKxN0CfmlVnXP9c3Vc7OpLWzfM/CWze655NE+O4Bs+CXLcy3llvLLecF9W7hE2wHky/EcGn0ykJB5scvgL7qLE1JT9qhq5bWS5538vJD28wfQWoeJWZ9kXdzflhVf4N9NHwPuwUxT7B9pEgOpz5gg10TOoGbX8lzrwqfNFrD0GGgp3YpVzhIO+Rc8P0tCl0KZ1UW2Lul2F1j4OzKrEVCR/nsQNQJv/tH668t9oRKoba/cEEnWqns2R6CZFqB1ajCV+v5IKmbOeTh8rt75LD0ylExU5k1K7zVYZXZSQOgdidAlHGNHBOmhYdtg3JchfoKLeML7xbSzbr9oVO1Mkv9iX9HeeurIH92GUvA++aL8UKOZ/x5vHOESSHhvOR59oAB6EtRPPWCM13wRSvZxutA/wDDhOtUiDOVA0XXeLFsl08b7MhWChbvl0iAABQfZ1lTFg32CBHVMlaRarHVcAtonVT7+Il0myqC8RRct3UDRMoD+GK0w1QI6jwV5uzjlKywOJXm1stsXlaXN91A+KRC+9/KQGnwwNh8CaOkLvWcOl2AV+DVAAiF2h5UFEAQzVdVaq6uAYJ2uYSDA7fZoUltMEfLzx1GTQXtVmCCrQjaM0v58vWMnVBgHDdjMA7A5Wo4AOtjiqtmqageAln7yo+IKGjoFQZWeFTO5F1ma7TtNdbXDKl4IlbAHKCgVaCA9jC2WIRUR5dVROAkc/7MKAq0TLX49nFW0a7MMSRS0JT2IGd1u7EJZf6mHhA0AqIFrRDnrnhlQ3juBK6HdPEHprmtEmRSI7EStrbgYXAYc5xhCnAhwEr6Gn+YIAb6sci7qXBXdPswd22i1eCDr0mjEDIjAroqroE8h1kEC1r5cWA/EsYEZIe0qFou26eyllRqyoVMpeANWbjbwTSFEXMW/S4UShfm9lJKJKAtZfete7HmAjJwfwIQlIgAoA+y1d6f/fxIsdbXjxQ1YUdXSPztHA3wCqFoghti53HtRc12TQ7HFgkswLyJsZHXHQ/gWKkfoaECegAOAlGvX83oAAmWXc43H2mUC6nvr7KQIAFqwTP5q/8Aah/XWu06sbZsNNOrneKzDDoi1KCON3p/cQWu1ZGBjlhfl2zSUHBG3A/hpZBXYN4FE0zcoAVeAgyaz2mscbqgG6uxC08EOuz9lUdEWoAi2nYrJPJ4LRXOruRkd5DlcHoAgBVojMuo8ojkr8lT294ZFVhWOjBCZG2O5uNfwXKbsr3ibzbiqvQguUuNpqLRigoMib5WRNjDJ8GFG6ibkZrmyByDB1r7DCo9VUF+njZKf014AzIU2/wRCu252JwAEZDANPSfcNAHdm8nrvcxOPUjdpOKWbyzV9HUZb6K9B+fP0fH2EKoXUeBNMRMzX/YUDTT/tgYXA9AEUC2ZD9FTzR4tt2uXQJW2GWFzXBcTkaitriRTeE4nYi0W1fWfyE87P3fH2CaoCvjRC6n/K8HyAzfxhMh9qoIorRujscEyxoYTm58RyjSWW1xdZAmhFYt+pwqOoVB2YngWE33YzWf7ifnTSC6e7Hfh3mrY7mf1mP/AIuIbvaW/PaLDNuBuu2PnZ+/4+wKXL8CggWn/wB9RRr45blcBtnFq8BHhmqdHDyYZQgZmXsTJsqJVrCblHaI7r0EWUNIPVIpTt1X40mYCOaxJRvVyc37BzOOzmGBWTkBNzRgQEHBJoT9idNKOPWSBZGgEN12+11i8K+9n63j6+5VSq+CFs3DyTKRUC0BhSUDadXq8E2XMNngYEtgEyYUcxXNmrMbZNaUMTOudM+I33pAmfFclzzFdKk+Kw894S+Z6ZoIeJR/gKGHv4g4yHKb4eXn63j68O5hDQBLFuX3kjrAAAoAwSuF/wCyHkOt/wAHBEbgi1UqKHuxC5puTHNcVAtQmSjLtJ8EJsGyPxJ+HP8AMkgBu7JNEoDB8f4p50meCNtsDj0IQLnHz8/W8fXVAthc6e+h/BAAABQGD1Au3gh1LfeCEy0zTO/anDE1MAikqwPGnuU5TYbPiyNx9ggleUCMHwANVgQ+zOuA507FW4tjrrD/AOoaGcKSaHdKWCOj/gL4vWRNZkbQWnrDQw8vP3vH11BKYAYLyFXHC3K56sFtTKLojxi1AVdIL6br3YHwl18jNObrVQMf0AAxOUdjAQDs+JLnPOfdhpAXq7uOUQSgJwzqPMPxEhORDAK54fXGXiof0DUgiWN/x1Zmp0I6RX25AS5uCFXDDy8/W8fX09xK52NLbb/g6EdT5xJY2Zp1Cmqd4/JbQrYpW8LBDYPRUD9LntEueBf6xM5bZJgFy8K9VwAuPRFfJGAUdGr5h4K3ZcoHuIl7ZRQZVEORv15YHsO5gAAKDaEcxhvtQMK+/n63j69oclb+0Evsdr2BLCb9PfSGVlujnK73noT0CPQoFrGUtTUtoZsuaWDxqr5n0DKFXgKmeVCWmge8O7X3gDJGaveaI5l1PSNRQTewwgKafhrw8PhvB1Gjdrr0LQsR1bPGhqwZRM/HgaTys/V8fXW1MQoAjEV02ZJDanI1XsRhhNmvbPVxa/jB4QFAFB6HggarFK67NDvDlvcal7yGbrry930EFLwSpBxGbKNPuLB2njR1ZWLTsTWXOCdppQR/9JD/AO1NXftNQLDnsw12HoOgVUeZgrVaVXK5sq6IKLgJm7OBPOz9bx9cB/2i/AS7aZNUXG7gkQ7SvLfpf0qygtVojNyRvXekf+0+MAKAdsS1olHkroQi14GRBRnpDHU7YiODhUCOqBN4vtgCzB92G/Z9I8Yu79GYVqCZy6o5L3w8rP3vH1p0ADVY+JuSJtkofwdEy/i7s69JQHqlE73X50NANzSgBoB2xvyOhKRo8GsJEnuIOWDAx0PaOqDi6oR7IuOhRNQlLq3DHWTd2YKxEnNAuO2xXSwbsHwGeXh5efvePrJ5zt5vwN2MO9LJMhLJnnnpaCAWrEFo7a7rF1xbUh78wOQA7YBVWWL33UVSsKARhZ6alTIdkXNEForHbIHTHvg+ioSztZv7MFYkrUUAnLCjarqvKwhtuDB0YK77Dy8/W8fWMmt5AG6rkOlMvSUC1hp4aNo9cVCnN8oA2omcRB+raHHZiFFa8uOXq04JphbNqELZbVtuHoPRUMLjho9mGsedBnc9pDAZPHJ3WHlZ+j4+u3kDGQO/xQ9dyFLUqua6veBYAV4I0MQBZeppCwTgwr0rqITm/Qiae4ziJLOrcXA0u0HPEjDSVnKxuEAolUjv6JU62E98RpPLgQ13ITy8/R8fWz0La9EHa0UZLvG2E92PV1jQhUMMYBdWsyl4rGiaW+2cFkz3mjJ2TVh7zLG4TTaKq1NCtexOGoC/lKclllQ9N4EWpcNF0YawcWNAWAhsWPbKGBrDIcDy8/V8fWVAVZlf5f5s7cMkzPic2qUqOeKsAOMWGaOwmhI7RDUyZRwqNyg1maDVdpQrvTzKBkHuZyN/siqACRwjOh+jHmHqNd5Fpeilsk3ml+IyROpL8iWVFqDilYLFmRuufr+MAm9h1Er3XCMydrAhqFTy8/d8fWCbVa0YTtuUjtBu5j7s0CPLNjUr1BKJJbZoSsVpE1f2EYMuWS5eD4EdBT5M5nZJTK25cqd5d8iAlAHrqDICRhQNRf8AMAWZ4rPmKrwpFKt2AInMmlAkAg4HX0YawMhzVB7wKA4JoYCuxgQeENJ5+fu+PrDZui8xOIvR7TvhQgHgqp18e7Cucb9Bby4l4O3GfJj4dzNSrPCRRdG6zC6AOh61AtaIPYPb+FQN4OLTVd1OVpxcmi9TDJQbTcfJChoiYZgz6P48MDXahpPJz9vx9aQYnuW6Zy7/AGku8BuGN+Iu0tNZcDViMV1gQfLAkBwt4wudpMp3oBaFAYbBX8J13qoEV5EaUKei+vmKSpNhEKDsxiwHUKkFXvZshwY7jf8ACFQPeAAANDC7CiYeNDA/DNE8r9e+QYtOu4XO3iWGfM8ZMuFRs38wSiOh/HZ1c7L2j9vtD2i7t7tfBDSVKxpBFQyagtzQAhO6MNFyRoTnApEyGl40w4HdxH+BE4EMPBwIM2bTy8/V8fZQFrRCiqtNaO8ZV5NvGWk3dYMcBlnqYjYsAUrZq+GFgzs58iZI7OSUCjiIbaCxB9DQsGPi4jLB5efr+PsgoLWpQRUbvMpZsG6L+8UmxKwuFIFeCFAHJqioWrfSLLdezG6GbOe5HMgwaA6h3MTC2NBD3C4DPNLw+IWmQZFsWB9aXCtcFizxcbe5h5Ofq+PsYKu3IjyJ6TVx51uHsJQKAD0Z4k52gFN8Kql1dZdzP2okJZgx0Q9yalLdJ2YvQQGgzT/aw8WGkpga9mF2X0aIxfBib7mHk5+/4+xB91sEZ7RNpCXTcIHC0M4IoK7msJt6yKMQ4JqRmkXxSs2VgTfAlR1kE0zmyylpbiFmZZ9nEAK68zHN2MT5wnk5+j4+wij3gIufvj+EbL+qX8EohDOUV4dglOuuDSAh1jeXGXjUy9iXmwiRo1cGbAuJ0KmqRbEIdGG/ZgrCQf6GoGBvA8nP0fH2BvuWdQyoiZ5XxCaW2JddiNy4EEeky9cG8rEt5igoKP4CVqztGm4NBHSOsWVjtjeF3az/AFYKwy+eiVlw4kZaJ5Ofo+PrwXcteghM2NOR3Q+20FhFloj5T5IrVrjaDMGNYmKw3OR70dwS0tTUieglY3jZLd2Ya9HIKYPRiL7cNJ5efo+PrjQQarBLAG15/VjU4syu2ReZdB9JQonuMKyL5zMNAPRUqUzSwmnVSyoRrC4GCazS5cS5UCBgEfRnRAoe+Mrek3sPRUXJjmmNJ5efo+PrZN9rNnd3MSfQ+xKdeqiiU+KFBhsEywMdGCZPauk/7ea0vaJBqDKiYDbNi3kgKLKXywQbUkJUrExqVNofYOJ8h7fQTqHOBvuIb955efo+PrJHkZJ+Ahy8qLURiVbzSndWEAYC8q+WbLwMCGoJlLbtNn5pxPtE5lvBYVi0Ljdds34SmR87Kdd5GJDfPAPEGwEMojqS0U8C/wAxTPTUrCn3e3H7IcElBk0jKAab9LhV1SCv38sBRha36hT7QwucBEhvtMSg6s8/P0PH1cCOWqBDmxSVw3H8b8NpXB3ICqhwR1QlOzBp6K4Y21CGaiEr0KGqRY8aBmUy808QxOPcSAniAyAH8CDqSvM6bLc7bqRDgkcPntsY4fcqqKEEZUFJ6sZhYsQYRGgj5uGCpHrFadMEy7J5qeTn7Hj6sjYVpsJSPGrQlidKVswkezTKWaE4ZrVTmr5ii4VheIyyNUrOmimhW0t8Mpi24yhULdsBghwkAPWgGOWGX2ZH+E+hOEuZg95LPEu3u6kUXg13KTGmlgiITKFIhiwdAhHLBntPEV3E8nP2PH1tG3agGPvKPUv0/sJhuAKle5DFjLOYD2pUvEXz234pnlo67lu4h0z0CAGh/CoI9yJ7Tw+I0ZusyjSt09L1GD0fyVHI2hNDLf1kMBXRB/ho9GTvrtwEqEsRw4MFB1nk5+g4+vI37UAkDdrcZfDO8xfHBkAP48n+NXwksvvHFtzw3wNCXhcuZwaB3EdtCgYHtA4p+tigHdzGecQU0ofJP8I5ujoCaJi/ypc5hqXk/stCoD1SiWgn/eio/wDveXNuW2pseq4j/CJqB7lxK13d/iYcBjoeVwvJxQ5+CGQbxvpOG0rskL/XO7mQw7iyg4ny8/UcfZA+KtEQV4nVvptUHIKyMVqLWF0gYLg3id02sPNiO5QEhrBTWlNShSbOF4VBCNnWcP7W/EysNQAkjKelR6NYR4IToYwbB5hrDT7Tzc/Z8fY16bte1g/siX9bG3SKJQYa5Rgt5GUK3xDBEuZ+xEzlYGFLUJqyYdRpZgPQEZqMKGmBd9mF6D1PVwOSQAGiQYENEyhCdJ5efo+PsROk3C5JT5iohtFljDCvOo8JmMoK5ZoUaYs0dkNWJKmmNRQ1Zq8bRN0qKmalDZu7MFejTAFAneFZQ+1eaTMGD7JhrDndJ5Ofq+PsJoFRpLcOvzOa7bns93EzQM3iVaWt4oUVCgCWypXo8TAlRBqk3LEA3ZjDEUDDr2YK9JO0T5LRmjCqvJAgqfJz9bx9gBFuKefaCCOm15qarZg9wsuLBxAKBD3ISU3zmYaQjDFwGNCNIq1RzCg6xxGX6LiN+Gb+71KLqpBm0v2dML7hres8jP1vH14t55c3oEJdWxzl2TeoJRg7QV4JQI80VoPW0goYbBHG8sWBqamqr2n/AL84D2iqssuJAleusFwwyOxhr9/L1UXafx8N1TLxM6jzU/Y8fXDO5aoEpQec5pVXb07NpcQp3rtNCMrHXN5eDHFQ1E1uQ70347JqXyQwc4mT2hL/AIKhhnDpBR2MNfv5eoYrGtwNGMCWJ5MMg4gsR52frePrSsoFqtEBrH7HdhOJ0CnaI+JXgJVCdTWU6ocyrIcEGXMrwamriE0XHbCa2RSDLwqURHUQwKFkrHaJ2bCgEtQVB64mIYEXAe5fwLNV9Pc2jSV8ghz9552frePrICqc3bmecuWu90vSOrIhgtuCA0brvMzjbzNXMDoLG5FE194Z3AlRCWQSG8VK53yEoUK5WypelZMuFBsWh1DdCpqwYwO/G5dG+8bLs0x1Dm8UVeaq6ljKY+lUPlz93x6ykKoZexece2yzdYLj5v6w0NyryBZmgqNrK7VrfcSxYbHlhlayreEXYUdhx+1Ec3G92XKG8N0fMNA+OcaM25GFj8VB4sOtkXQrLU+bDSP2XgWgVGdCv4h0M6kz9DyFvEcB+Iu08/24YPSe8+Q4n+9bLwnfQr+yH8AtnE+fC0Z7Enn/AKvEQVCst1HSqbvodoy4VVAhKXwFHZCaEFjWwoajkkFm8YkEzwYSrvdHywJfNHFb6AkHC25Uav33PyZtPGwZpo7Eo9FnMR1D3iWpeyaV+5nl8E1b48Q1+LP6DHe+DP6DP67NbXthV9uE1V+2DafEhpm7Ms/kAEdGKKznST8BPm8/e8fW0FIMvngk8hAPs5ZYTWv5TJkAcJANDHzXMKWp5EDvT4sVILhSW07spbR7qisdoGHXL7RYCdAGDAnRdZqAW7/94mqd2nQSn/mQP/in9aT+kT+sJ/Wk5/hJW5E7KR0oexf7gOh9v+8f+LlpU9rNWvbD8vIPL+bB/Foi06hMzq0Zcrq2y8VWc8CeN59Gv2I7IHkLWib9v0mdLmFXT67bvfEI0p/TMqe4dlou4HASIHhslMB4ElpbzWCy7Krq5vmZm6f4pgetbEWyLAA0GSfEsTICM9wCAte6TgjBuTSNU11oFG76YKJDuN/WVDVjUycJEnit4evsCi3M9IqctfBG0c3mpRD0Hrs5JfBOgwAjz8Mp4+DD/wBRBrGO6H/sYf8AvZ/aZoQ7qV/7EbNvgyhz8M6s6KdF8y+ZCpl6GXLwrDKZ11O2T4nRRCp8MuEA0rmhDypFKPyiD6rpS/UmpM1UGHFuyAPPLU7YIxft1nYgBt6KYkz6hQO+bHp6q9wmASD32xYQ5btP/KGUScQpyBA+5M0WD1gZ08e2aavbP6nAdPgz+hT+gT+oT+gRXVfZH/wMV1+HNQ+LNfPtmvWb+57K9ljyk6tvul5eUhwibv8AeM+b1uL57HFhfbbEfu8zJu4pCylmW3pJqVtDPO6xUkuPeew8SqGLW6v6X1TIUObHBjqxk+I+qHwQLQDtAl4PGh/roIppuTNUn/MQZ3adG86M2a/fpos7mDq7AkA0L2+hL6ieeksHS44JHlH26OejSWr9iZaqdGL7Q6prGEYJBsQs5I4KagvMKI+kv8Gb5TS7JX2qhhZ2SfRUBVAl+XZlqs49Olt7R2IMbYOYI2CviVKRoiGqnmyU9Ybw6k8xPBWEV24QA0PqCDqQlD+oZbL3kgxbSeYH8QXaDmQl86UksFMiajky4hol3CnRtt91KsiHGpY7NWpgiWP0BGX6qBH/AGxzGkXtvssau1HJq91mi0BFvianraRn/SphDBAwcChBcGoDsfXBaV3JeWzwjLl7uyOPZbl7XG+CKABpGV+8ClKGYlJ2SU8CDX+IWEqZus9IFvViWP8AmHuq16CNv28sxDt8L7Rj176aHN1y5nAy2Lk8ebH9jK/DpsuXkca7LYaYbbjUoaNLlfmnlrEx0zaLE/yBRNamghavwad6LKGlKwdJDG/n4SFFKVYj9moMIC6UqbjTrvkKKnKuUNNyStP0YDdCxGx/xqoVcr17oSGtAD7U7H+GFPPlodv/AMV//9k=" alt="GASP" style={{ width:38, height:38, objectFit:'contain', flexShrink:0 }} />
            <div>
              <div style={{ fontSize:18, fontWeight:800, color:'#fff', lineHeight:1 }}>GASP</div>
              <div style={{ fontSize:9, color:'#4a6a8a', letterSpacing:'0.1em' }}>CONSORCIOS</div>
            </div>
          </div>
          {consorcioActivo && (
            <div style={{ fontSize:11, color:'#7ab4ff', marginTop:6, fontWeight:600, lineHeight:1.3 }}>
              {consorcioActivo.nombre}
            </div>
          )}
        </div>
        <nav style={{ flex:1, padding:'10px 8px' }}>
          {secciones.map(sec => (
            <div key={sec}>
              <div style={{ fontSize:9, color:'#3a5a7a', fontWeight:'bold', letterSpacing:'0.15em', textTransform:'uppercase', padding:'10px 10px 4px' }}>{sec}</div>
              {NAV.filter(n=>n.sec===sec).map(n => (
                <div key={n.id} onClick={() => { setPagina(n.id); setMenuAbierto(false) }}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', cursor:'pointer', borderRadius:7, margin:'1px 0',
                    background: pagina===n.id ? 'rgba(26,63,160,0.25)' : 'transparent',
                    color: pagina===n.id ? '#7aacff' : '#8aaabf',
                    fontWeight: pagina===n.id ? 'bold' : 'normal', fontSize:13, transition:'all 0.15s' }}>
                  <span style={{ fontSize:15, width:20, textAlign:'center', flexShrink:0 }}>{n.icon}</span>
                  <span style={{ flex:1 }}>{n.label}</span>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ padding:'12px 14px', borderTop:'1px solid #1a2540' }}>
          <div style={{ fontSize:11, color:'#4a6a8a', marginBottom:8 }}>{session.user.email}</div>
          <BtnSec small onClick={logout} style={{ width:'100%', justifyContent:'center', color:'#8aaabf', borderColor:'#1a2540', background:'transparent' }}>
            Cerrar sesión
          </BtnSec>
        </div>
      </aside>

      {/* MAIN */}
      <div style={{ marginLeft: isMobile ? 0 : 220, minHeight:'100vh' }}>
        {/* TOPBAR */}
        <div style={{ height:52, background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', padding:'0 20px', gap:14, position:'sticky', top:0, zIndex:100 }}>
          {isMobile && (
            <button onClick={() => setMenuAbierto(v=>!v)}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:22, color:'#374151', padding:'0 6px' }}>☰</button>
          )}
          <div style={{ flex:1, fontWeight:700, color:'#111', fontSize:15 }}>
            {NAV.find(n=>n.id===pagina)?.icon} {NAV.find(n=>n.id===pagina)?.label || 'Dashboard'}
          </div>
          {consorcioActivo && (
            <div style={{ fontSize:12, color:GR, background:'#f3f4f6', padding:'4px 12px', borderRadius:20 }}>
              {consorcioActivo.nombre}
            </div>
          )}
        </div>
        {/* CONTENT */}
        <div style={{ padding: isMobile ? 14 : 24, maxWidth:1100, margin:'0 auto' }}>
          {renderPagina()}
        </div>
      </div>

      {/* NAV MOBILE BOTTOM */}
      {isMobile && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, height:54, background:BG, borderTop:'1px solid #1a2540', display:'flex', zIndex:100 }}>
          {[{id:'dashboard',icon:'📊'},{id:'unidades',icon:'🏢'},{id:'expensas',icon:'💰'},{id:'morosos',icon:'⚠️'},{id:'actas',icon:'📖'}].map(n => (
            <button key={n.id} onClick={() => setPagina(n.id)}
              style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:1,
                background:'none', border:'none', cursor:'pointer', padding:'6px 0',
                color: pagina===n.id ? '#7aacff' : '#4a6a8a',
                borderTop: pagina===n.id ? `2px solid ${AZ}` : '2px solid transparent' }}>
              <span style={{ fontSize:18 }}>{n.icon}</span>
              <span style={{ fontSize:8, fontWeight: pagina===n.id ? 'bold' : 'normal' }}>{n.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
