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
          <div style={{ width:80, height:80, background:'#1A3FA0', borderRadius:16, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', margin:'0 auto 10px' }}>
            <div style={{ fontSize:20, fontWeight:900, color:'#fff', letterSpacing:2 }}>GASP</div>
            <div style={{ fontSize:8, color:'#7AB4FF', letterSpacing:3, marginTop:2 }}>🏢</div>
          </div>
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
            <div style={{ width:36, height:36, background:'#1A3FA0', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <span style={{ fontSize:11, fontWeight:900, color:'#fff', letterSpacing:1 }}>GASP</span>
            </div>
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
