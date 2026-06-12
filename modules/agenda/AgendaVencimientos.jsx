// modules/agenda/AgendaVencimientos.jsx
// Módulo independiente: Agenda de Vencimientos — todos los consorcios
// Vista global + por consorcio, filtros, gestión completa de vencimientos

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { fmt, fmtD, periodoLabel } from '../../lib/formatters'
import { Card, Btn, BtnSec } from '../../components/ui'

// ── Constantes ──────────────────────────────────────────────────────────────
const TIPOS = [
  { value:'poliza',        label:'Póliza',         icon:'🛡️' },
  { value:'art',           label:'ART',            icon:'🦺' },
  { value:'seguro',        label:'Seguro',         icon:'🔒' },
  { value:'impuesto',      label:'Impuesto',       icon:'🏛️' },
  { value:'asamblea',      label:'Asamblea',       icon:'👥' },
  { value:'mantenimiento', label:'Mantenimiento',  icon:'🔧' },
  { value:'certificado',   label:'Certificado',    icon:'📄' },
  { value:'contrato',      label:'Contrato',       icon:'📋' },
  { value:'habilitacion',  label:'Habilitación',   icon:'✅' },
  { value:'otro',          label:'Otro',           icon:'📌' },
]
const TIPO_MAP = Object.fromEntries(TIPOS.map(t => [t.value, t]))
const ESTADO_VALIDO = ['pendiente','cumplido','vencido_archivado']

const FLD  = { fontSize:13, padding:'8px 10px', border:'1px solid #d0d9e8', borderRadius:7, width:'100%', boxSizing:'border-box' }
const LBL  = { fontSize:12, color:'#5a6a8a', fontWeight:600, marginBottom:3, display:'block' }
const COL2 = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 14px' }
const COL3 = { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px 14px' }

// ── Helpers ──────────────────────────────────────────────────────────────────
function diasHasta(fecha) {
  const hoy = new Date(); hoy.setHours(0,0,0,0)
  const fv  = new Date(fecha + 'T00:00:00')
  return Math.round((fv - hoy) / 86400000)
}
function colorDias(d) { return d < 0 ? '#B91C1C' : d <= 7 ? '#B91C1C' : d <= 30 ? '#C07D10' : '#1B6B35' }
function bgDias(d)    { return d < 0 ? '#fff1f1' : d <= 7 ? '#fff1f1'  : d <= 30 ? '#fffbea'  : '#f0fdf4'  }
function labelDias(d) {
  if (d < 0)  return `Vencido hace ${Math.abs(d)}d`
  if (d === 0) return 'Vence HOY ⚡'
  if (d === 1) return 'Vence mañana'
  return `En ${d} días`
}
function urgencia(d) { return d < 0 ? 3 : d <= 7 ? 2 : d <= 30 ? 1 : 0 }

// ── Componente principal ──────────────────────────────────────────────────────
export default function AgendaVencimientos() {
  const { session, consorcios, consorcioActivo, setConsorcioActivo } = useApp()
  const uid = session?.user?.id

  // Estado
  const [items,       setItems]       = useState([])
  const [cargando,    setCargando]    = useState(false)
  const [filtroUrgencia, setFiltroUrgencia] = useState('todos')  // todos | vencido | proximo7 | proximo30 | ok
  const [filtroTipo,  setFiltroTipo]  = useState('todos')
  const [filtroCon,   setFiltroCon]   = useState('todos')
  const [busqueda,    setBusqueda]    = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando,    setEditando]    = useState(null)
  const [guardando,   setGuardando]   = useState(false)
  const [msg,         setMsg]         = useState(null)

  const FORM_VACIO = { tipo:'poliza', descripcion:'', consorcio_id:'', fecha_vencimiento:'', fecha_aviso1:'', fecha_aviso2:'', monto:'', notas:'', recurrente:false, frecuencia_dias:'' }
  const [form, setForm] = useState(FORM_VACIO)

  // ── Carga ──────────────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    if (!uid) return
    setCargando(true)
    try {
      const hoy = new Date(); hoy.setHours(0,0,0,0)

      // 1. Agenda manual
      const { data: agenda } = await supabase
        .from('con_agenda_vencimientos')
        .select('*, con_consorcios(nombre)')
        .eq('admin_id', uid)
        .not('estado', 'eq', 'vencido_archivado')
        .order('fecha_vencimiento', { ascending: true })

      // 2. Pólizas de todos los consorcios
      const { data: cons } = await supabase
        .from('con_consorcios')
        .select('id,nombre,poliza_vto_hasta,poliza_nro,aseguradora,poliza_suma')
        .eq('admin_id', uid)
        .not('poliza_vto_hasta', 'is', null)

      // 3. ART y seguros de proveedores
      const { data: provs } = await supabase
        .from('con_proveedores')
        .select('id,razon_social,art_vencimiento,seguro_vencimiento,consorcio_id,con_consorcios(nombre)')
        .eq('admin_id', uid)
        .or('art_vencimiento.not.is.null,seguro_vencimiento.not.is.null')

      const list = []

      // Agenda manual
      for (const a of (agenda||[])) {
        const d = diasHasta(a.fecha_vencimiento)
        list.push({
          id: a.id, fuente:'agenda',
          tipo: a.tipo, desc: a.descripcion,
          consorcio_id: a.consorcio_id,
          consorcio_nombre: a.con_consorcios?.nombre || 'Todos',
          fecha: a.fecha_vencimiento,
          fecha_aviso1: a.fecha_aviso1, fecha_aviso2: a.fecha_aviso2,
          dias: d, monto: a.monto, estado: a.estado,
          notas: a.notas, recurrente: a.recurrente,
          frecuencia_dias: a.frecuencia_dias,
        })
      }

      // Pólizas
      for (const c of (cons||[])) {
        const d = diasHasta(c.poliza_vto_hasta)
        list.push({
          id: 'poliza-'+c.id, fuente:'consorcio',
          tipo:'poliza',
          desc: `Póliza ${c.aseguradora||''} N° ${c.poliza_nro||''}`.trim().replace(/^Póliza\s*$/, 'Póliza del edificio'),
          consorcio_id: c.id, consorcio_nombre: c.nombre,
          fecha: c.poliza_vto_hasta, dias: d,
          monto: c.poliza_suma,
          estado: d < 0 ? 'vencido' : d <= 30 ? 'proximo' : 'vigente',
          notas: null, recurrente: true, frecuencia_dias: 365,
        })
      }

      // ART / Seguro proveedores
      for (const p of (provs||[])) {
        const cnombre = p.con_consorcios?.nombre || '—'
        if (p.art_vencimiento) {
          const d = diasHasta(p.art_vencimiento)
          list.push({ id:'art-'+p.id, fuente:'proveedor', tipo:'art',
            desc:`ART — ${p.razon_social}`, consorcio_id: p.consorcio_id,
            consorcio_nombre: cnombre, fecha: p.art_vencimiento, dias: d,
            estado: d<0?'vencido':d<=30?'proximo':'vigente', recurrente:true, frecuencia_dias:365 })
        }
        if (p.seguro_vencimiento) {
          const d = diasHasta(p.seguro_vencimiento)
          list.push({ id:'seg-'+p.id, fuente:'proveedor', tipo:'seguro',
            desc:`Seguro — ${p.razon_social}`, consorcio_id: p.consorcio_id,
            consorcio_nombre: cnombre, fecha: p.seguro_vencimiento, dias: d,
            estado: d<0?'vencido':d<=30?'proximo':'vigente', recurrente:true, frecuencia_dias:365 })
        }
      }

      // Ordenar: más urgentes primero
      list.sort((a,b) => urgencia(b.dias) - urgencia(a.dias) || new Date(a.fecha) - new Date(b.fecha))
      setItems(list)
    } catch(e) { console.error('Agenda carga:', e) }
    finally { setCargando(false) }
  }, [uid])

  useEffect(() => { cargar() }, [cargar])

  // ── Guardar / Editar ───────────────────────────────────────────────────────
  async function guardar() {
    if (!form.descripcion.trim() || !form.fecha_vencimiento) return
    setGuardando(true); setMsg(null)
    try {
      const payload = {
        admin_id: uid,
        consorcio_id: form.consorcio_id || null,
        tipo: form.tipo,
        descripcion: form.descripcion.trim(),
        fecha_vencimiento: form.fecha_vencimiento,
        fecha_aviso1: form.fecha_aviso1 || null,
        fecha_aviso2: form.fecha_aviso2 || null,
        monto: form.monto ? parseFloat(form.monto) : null,
        notas: form.notas || null,
        recurrente: form.recurrente,
        frecuencia_dias: form.recurrente && form.frecuencia_dias ? parseInt(form.frecuencia_dias) : null,
        estado: 'pendiente',
      }
      if (editando) {
        await supabase.from('con_agenda_vencimientos').update(payload).eq('id', editando)
      } else {
        await supabase.from('con_agenda_vencimientos').insert([{ id:'AV-'+Date.now(), ...payload }])
      }
      setMostrarForm(false); setEditando(null); setForm(FORM_VACIO)
      setMsg({ tipo:'ok', txt: editando ? '✅ Vencimiento actualizado.' : '✅ Vencimiento agregado.' })
      cargar()
    } catch(e) { setMsg({ tipo:'err', txt:'❌ Error al guardar: ' + e.message }) }
    finally { setGuardando(false) }
  }

  async function marcarCumplido(id) {
    await supabase.from('con_agenda_vencimientos').update({ estado:'cumplido' }).eq('id', id)
    setMsg({ tipo:'ok', txt:'✅ Marcado como cumplido.' })
    cargar()
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este vencimiento?')) return
    await supabase.from('con_agenda_vencimientos').update({ estado:'vencido_archivado' }).eq('id', id)
    setMsg({ tipo:'ok', txt:'Vencimiento archivado.' })
    cargar()
  }

  function abrirEditar(item) {
    setForm({
      tipo: item.tipo, descripcion: item.desc,
      consorcio_id: item.consorcio_id || '',
      fecha_vencimiento: item.fecha,
      fecha_aviso1: item.fecha_aviso1 || '',
      fecha_aviso2: item.fecha_aviso2 || '',
      monto: item.monto ? String(item.monto) : '',
      notas: item.notas || '',
      recurrente: item.recurrente || false,
      frecuencia_dias: item.frecuencia_dias ? String(item.frecuencia_dias) : '',
    })
    setEditando(item.id)
    setMostrarForm(true)
    window.scrollTo({ top: 0, behavior:'smooth' })
  }

  function cancelarForm() {
    setMostrarForm(false); setEditando(null); setForm(FORM_VACIO)
  }

  // ── Filtrado ───────────────────────────────────────────────────────────────
  const filtrados = items.filter(item => {
    if (filtroUrgencia === 'vencido'   && item.dias >= 0) return false
    if (filtroUrgencia === 'proximo7'  && (item.dias < 0 || item.dias > 7)) return false
    if (filtroUrgencia === 'proximo30' && (item.dias < 0 || item.dias > 30)) return false
    if (filtroUrgencia === 'ok'        && item.dias < 0) return false
    if (filtroTipo !== 'todos' && item.tipo !== filtroTipo) return false
    if (filtroCon  !== 'todos' && item.consorcio_id !== filtroCon) return false
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase()
      if (!item.desc?.toLowerCase().includes(b) && !item.consorcio_nombre?.toLowerCase().includes(b)) return false
    }
    return true
  })

  // Contadores para badges
  const cVencidos  = items.filter(i => i.dias < 0).length
  const cProximo7  = items.filter(i => i.dias >= 0 && i.dias <= 7).length
  const cProximo30 = items.filter(i => i.dias > 7 && i.dias <= 30).length

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth:860, margin:'0 auto', padding:'0 0 48px' }}>

      {/* Encabezado */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, color:AZ }}>📅 Agenda de Vencimientos</h2>
          <div style={{ fontSize:12, color:GR, marginTop:2 }}>
            {items.length} vencimientos totales · {cVencidos > 0 ? <span style={{ color:RJ, fontWeight:700 }}>{cVencidos} vencidos</span> : '0 vencidos'} · {cProximo7} en 7d · {cProximo30} en 30d
          </div>
        </div>
        <Btn onClick={() => { cancelarForm(); setMostrarForm(f => !f) }}
          style={{ background:AZ, color:'#fff', padding:'8px 16px', fontSize:13, fontWeight:700 }}>
          {mostrarForm && !editando ? '✕ Cancelar' : '＋ Agregar vencimiento'}
        </Btn>
      </div>

      {/* Mensaje */}
      {msg && (
        <div style={{ padding:'9px 14px', borderRadius:8, marginBottom:14, fontSize:13, fontWeight:600,
          background: msg.tipo==='ok'?'#f0fdf4':'#fff1f1',
          color: msg.tipo==='ok'?VD:RJ }}>
          {msg.txt}
        </div>
      )}

      {/* Formulario alta / edición */}
      {mostrarForm && (
        <Card style={{ marginBottom:20, background:'#f8faff', border:'1px solid #c0cfe8' }}>
          <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:14 }}>
            {editando ? '✏️ Editar vencimiento' : '➕ Nuevo vencimiento'}
          </div>
          <div style={COL3}>
            <div>
              <label style={LBL}>Tipo *</label>
              <select style={FLD} value={form.tipo} onChange={e => setForm(f=>({...f, tipo:e.target.value}))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Consorcio</label>
              <select style={FLD} value={form.consorcio_id} onChange={e => setForm(f=>({...f, consorcio_id:e.target.value}))}>
                <option value="">— General (todos) —</option>
                {(consorcios||[]).sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(c =>
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                )}
              </select>
            </div>
            <div>
              <label style={LBL}>Fecha de vencimiento *</label>
              <input style={FLD} type="date" value={form.fecha_vencimiento} onChange={e => setForm(f=>({...f, fecha_vencimiento:e.target.value}))} />
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label style={LBL}>Descripción *</label>
              <input style={FLD} placeholder="Ej: Póliza edificio — La Segunda N° 250230761945" value={form.descripcion} onChange={e => setForm(f=>({...f, descripcion:e.target.value}))} />
            </div>
            <div>
              <label style={LBL}>Aviso 1° (fecha)</label>
              <input style={FLD} type="date" value={form.fecha_aviso1} onChange={e => setForm(f=>({...f, fecha_aviso1:e.target.value}))} />
            </div>
            <div>
              <label style={LBL}>Aviso 2° (fecha)</label>
              <input style={FLD} type="date" value={form.fecha_aviso2} onChange={e => setForm(f=>({...f, fecha_aviso2:e.target.value}))} />
            </div>
            <div>
              <label style={LBL}>Monto ($)</label>
              <input style={FLD} type="number" placeholder="0.00" value={form.monto} onChange={e => setForm(f=>({...f, monto:e.target.value}))} />
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label style={LBL}>Notas</label>
              <input style={FLD} placeholder="Observaciones, número de póliza, etc." value={form.notas} onChange={e => setForm(f=>({...f, notas:e.target.value}))} />
            </div>
            <div style={{ gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:10 }}>
              <input type="checkbox" id="rec" checked={form.recurrente} onChange={e => setForm(f=>({...f, recurrente:e.target.checked}))} />
              <label htmlFor="rec" style={{ fontSize:13, color:'#374151' }}>🔁 Recurrente</label>
              {form.recurrente && (
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:12, color:GR }}>cada</span>
                  <input style={{ ...FLD, width:80 }} type="number" placeholder="días" value={form.frecuencia_dias} onChange={e => setForm(f=>({...f, frecuencia_dias:e.target.value}))} />
                  <span style={{ fontSize:12, color:GR }}>días</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ marginTop:16, display:'flex', gap:10 }}>
            <Btn onClick={guardar} disabled={guardando || !form.descripcion.trim() || !form.fecha_vencimiento}
              style={{ background:VD, color:'#fff', padding:'9px 22px', fontWeight:700,
                opacity:(!form.descripcion.trim()||!form.fecha_vencimiento)?0.5:1 }}>
              {guardando ? 'Guardando...' : editando ? '💾 Actualizar' : '💾 Guardar'}
            </Btn>
            <BtnSec onClick={cancelarForm}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, alignItems:'center' }}>
        {/* Urgencia */}
        {[
          { v:'todos',    l:'Todos',      bg:'#f3f4f6', color:'#374151' },
          { v:'vencido',  l:`🔴 Vencidos${cVencidos>0?\` (${cVencidos})`:''}`, bg:'#fff1f1', color:'#B91C1C' },
          { v:'proximo7', l:`🟡 ≤7d${cProximo7>0?\` (${cProximo7})`:''}`,       bg:'#fffbea', color:'#C07D10' },
          { v:'proximo30',l:`🟡 ≤30d${cProximo30>0?\` (${cProximo30})`:''}`,    bg:'#fffbea', color:'#C07D10' },
          { v:'ok',       l:'🟢 Al día',  bg:'#f0fdf4', color:'#1B6B35' },
        ].map(f => (
          <button key={f.v} onClick={() => setFiltroUrgencia(f.v)}
            style={{ padding:'5px 11px', fontSize:12, fontWeight:600, border:'1px solid',
              borderColor: filtroUrgencia===f.v ? f.color : '#d1d5db',
              background: filtroUrgencia===f.v ? f.bg : '#fff',
              color: filtroUrgencia===f.v ? f.color : '#6B7280',
              borderRadius:20, cursor:'pointer' }}>
            {f.l}
          </button>
        ))}

        {/* Tipo */}
        <select style={{ ...FLD, width:'auto', padding:'5px 9px', fontSize:12 }}
          value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
        </select>

        {/* Consorcio */}
        <select style={{ ...FLD, width:'auto', padding:'5px 9px', fontSize:12 }}
          value={filtroCon} onChange={e => setFiltroCon(e.target.value)}>
          <option value="todos">Todos los consorcios</option>
          {(consorcios||[]).sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(c =>
            <option key={c.id} value={c.id}>{c.nombre}</option>
          )}
        </select>

        {/* Busqueda */}
        <input style={{ ...FLD, width:160, padding:'5px 9px', fontSize:12 }}
          placeholder="🔍 Buscar..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
      </div>

      {/* Lista */}
      {cargando ? (
        <div style={{ color:GR, fontSize:13, padding:'20px 0', textAlign:'center' }}>Cargando agenda...</div>
      ) : filtrados.length === 0 ? (
        <Card>
          <div style={{ color:GR, fontSize:13, textAlign:'center', padding:'20px 0', fontStyle:'italic' }}>
            {items.length === 0
              ? 'Sin vencimientos registrados. Usá ＋ Agregar para incorporar pólizas, ART, impuestos, etc.'
              : 'No hay vencimientos que coincidan con los filtros seleccionados.'}
          </div>
        </Card>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtrados.map(item => (
            <div key={item.id} style={{
              display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
              background: bgDias(item.dias),
              border:`1px solid ${item.dias<0?'#fca5a5':item.dias<=7?'#fcd34d':item.dias<=30?'#fde68a':'#bbf7d0'}`,
              borderRadius:9,
            }}>
              {/* Ícono tipo */}
              <span style={{ fontSize:20, flexShrink:0 }}>{TIPO_MAP[item.tipo]?.icon || '📌'}</span>

              {/* Info principal */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, fontWeight:700, color:'#111827' }}>{item.desc}</span>
                  <span style={{ fontSize:11, color:'#6B7280', background:'rgba(0,0,0,0.05)', padding:'1px 7px', borderRadius:10 }}>
                    {TIPO_MAP[item.tipo]?.label || item.tipo}
                  </span>
                  {item.recurrente && <span style={{ fontSize:10, color:AM }}>🔁</span>}
                  {item.fuente !== 'agenda' && (
                    <span style={{ fontSize:10, color:'#9CA3AF', fontStyle:'italic' }}>
                      {item.fuente === 'consorcio' ? 'desde ficha' : 'desde proveedor'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize:11, color:'#6B7280', marginTop:2, display:'flex', gap:12, flexWrap:'wrap' }}>
                  <span>📍 {item.consorcio_nombre || 'Todos'}</span>
                  <span>📅 {new Date(item.fecha + 'T00:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric' })}</span>
                  {item.monto && <span>💰 ${Number(item.monto).toLocaleString('es-AR')}</span>}
                  {item.notas && <span>💬 {item.notas}</span>}
                  {item.fecha_aviso1 && <span>🔔 Aviso: {new Date(item.fecha_aviso1+'T00:00:00').toLocaleDateString('es-AR')}</span>}
                </div>
              </div>

              {/* Días + Acciones */}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                <div style={{ fontSize:12, fontWeight:700, color:colorDias(item.dias),
                  background:'rgba(255,255,255,0.75)', borderRadius:6, padding:'3px 9px', whiteSpace:'nowrap' }}>
                  {labelDias(item.dias)}
                </div>
                {item.fuente === 'agenda' && (
                  <div style={{ display:'flex', gap:4 }}>
                    <button onClick={() => abrirEditar(item)}
                      style={{ fontSize:10, padding:'2px 7px', background:'#e0e7ff', color:AZ, border:'none', borderRadius:4, cursor:'pointer', fontWeight:600 }}>
                      ✏️ Editar
                    </button>
                    {item.estado !== 'cumplido' && (
                      <button onClick={() => marcarCumplido(item.id)}
                        style={{ fontSize:10, padding:'2px 7px', background:'#d1fae5', color:'#065f46', border:'none', borderRadius:4, cursor:'pointer', fontWeight:600 }}>
                        ✓ Cumplido
                      </button>
                    )}
                    <button onClick={() => eliminar(item.id)}
                      style={{ fontSize:10, padding:'2px 7px', background:'#fee2e2', color:RJ, border:'none', borderRadius:4, cursor:'pointer' }}>
                      ✕
                    </button>
                  </div>
                )}
                {item.fuente !== 'agenda' && (
                  <div style={{ fontSize:10, color:'#9CA3AF' }}>Solo lectura</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer con totales */}
      {filtrados.length > 0 && (
        <div style={{ marginTop:16, fontSize:12, color:GR, textAlign:'right' }}>
          Mostrando {filtrados.length} de {items.length} vencimientos
        </div>
      )}
    </div>
  )
}
