// modules/agenda/AgendaVencimientos.jsx
// Módulo independiente: Agenda de Vencimientos — todos los consorcios

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { Card, Btn, BtnSec } from '../../components/ui'

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

const FLD  = { fontSize:13, padding:'8px 10px', border:'1px solid #d0d9e8', borderRadius:7, width:'100%', boxSizing:'border-box' }
const LBL  = { fontSize:12, color:'#5a6a8a', fontWeight:600, marginBottom:3, display:'block' }
const COL3 = { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px 14px' }

function diasHasta(fecha) {
  const hoy = new Date(); hoy.setHours(0,0,0,0)
  return Math.round((new Date(fecha + 'T00:00:00') - hoy) / 86400000)
}
function colorDias(d) { return d < 0 ? '#B91C1C' : d <= 7 ? '#B91C1C' : d <= 30 ? '#C07D10' : '#1B6B35' }
function bgDias(d)    { return d < 0 ? '#fff1f1' : d <= 7 ? '#fff1f1'  : d <= 30 ? '#fffbea'  : '#f0fdf4'  }
function borderDias(d){ return d < 0 ? '#fca5a5' : d <= 7 ? '#fca5a5'  : d <= 30 ? '#fcd34d'  : '#bbf7d0'  }
function labelDias(d) {
  if (d < 0)  return 'Vencido hace ' + Math.abs(d) + 'd'
  if (d === 0) return 'Vence HOY ⚡'
  if (d === 1) return 'Vence mañana'
  return 'En ' + d + ' días'
}
function urgencia(d) { return d < 0 ? 3 : d <= 7 ? 2 : d <= 30 ? 1 : 0 }

function badgeFiltro(label, count) {
  return count > 0 ? label + ' (' + count + ')' : label
}

export default function AgendaVencimientos() {
  const { session, consorcios } = useApp()
  const uid = session?.user?.id

  const [items,        setItems]        = useState([])
  const [cargando,     setCargando]     = useState(false)
  const [filtroU,      setFiltroU]      = useState('todos')
  const [filtroTipo,   setFiltroTipo]   = useState('todos')
  const [filtroCon,    setFiltroCon]    = useState('todos')
  const [busqueda,     setBusqueda]     = useState('')
  const [mostrarForm,  setMostrarForm]  = useState(false)
  const [editando,     setEditando]     = useState(null)
  const [guardando,    setGuardando]    = useState(false)
  const [msg,          setMsg]          = useState(null)

  const FORM0 = { tipo:'poliza', descripcion:'', consorcio_id:'', fecha_vencimiento:'', fecha_aviso1:'', fecha_aviso2:'', monto:'', notas:'', recurrente:false, frecuencia_dias:'' }
  const [form, setForm] = useState(FORM0)
  const upd = (k,v) => setForm(f => ({...f, [k]:v}))

  const cargar = useCallback(async () => {
    if (!uid) return
    setCargando(true)
    try {
      const { data: agenda } = await supabase
        .from('con_agenda_vencimientos')
        .select('*, con_consorcios(nombre)')
        .eq('admin_id', uid)
        .not('estado', 'eq', 'vencido_archivado')
        .order('fecha_vencimiento', { ascending: true })

      const { data: cons } = await supabase
        .from('con_consorcios')
        .select('id,nombre,poliza_vto_hasta,poliza_nro,aseguradora,poliza_suma')
        .eq('admin_id', uid)
        .not('poliza_vto_hasta', 'is', null)

      const { data: provs } = await supabase
        .from('con_proveedores')
        .select('id,razon_social,art_vencimiento,seguro_vencimiento,consorcio_id,con_consorcios(nombre)')
        .eq('admin_id', uid)
        .or('art_vencimiento.not.is.null,seguro_vencimiento.not.is.null')

      const list = []

      for (const a of (agenda||[])) {
        const d = diasHasta(a.fecha_vencimiento)
        list.push({ id:a.id, fuente:'agenda', tipo:a.tipo, desc:a.descripcion,
          consorcio_id:a.consorcio_id, consorcio_nombre:a.con_consorcios?.nombre||'General',
          fecha:a.fecha_vencimiento, fecha_aviso1:a.fecha_aviso1, fecha_aviso2:a.fecha_aviso2,
          dias:d, monto:a.monto, estado:a.estado, notas:a.notas,
          recurrente:a.recurrente, frecuencia_dias:a.frecuencia_dias })
      }

      for (const c of (cons||[])) {
        const d = diasHasta(c.poliza_vto_hasta)
        const nro = c.poliza_nro ? ' N° ' + c.poliza_nro : ''
        const aseg = c.aseguradora ? c.aseguradora + nro : 'Póliza del edificio'
        list.push({ id:'poliza-'+c.id, fuente:'consorcio', tipo:'poliza',
          desc:'Póliza — ' + aseg, consorcio_id:c.id, consorcio_nombre:c.nombre,
          fecha:c.poliza_vto_hasta, dias:d, monto:c.poliza_suma,
          estado:d<0?'vencido':d<=30?'proximo':'vigente', recurrente:true })
      }

      for (const p of (provs||[])) {
        const cn = p.con_consorcios?.nombre || '—'
        if (p.art_vencimiento) {
          const d = diasHasta(p.art_vencimiento)
          list.push({ id:'art-'+p.id, fuente:'proveedor', tipo:'art',
            desc:'ART — ' + p.razon_social, consorcio_id:p.consorcio_id,
            consorcio_nombre:cn, fecha:p.art_vencimiento, dias:d,
            estado:d<0?'vencido':d<=30?'proximo':'vigente', recurrente:true })
        }
        if (p.seguro_vencimiento) {
          const d = diasHasta(p.seguro_vencimiento)
          list.push({ id:'seg-'+p.id, fuente:'proveedor', tipo:'seguro',
            desc:'Seguro — ' + p.razon_social, consorcio_id:p.consorcio_id,
            consorcio_nombre:cn, fecha:p.seguro_vencimiento, dias:d,
            estado:d<0?'vencido':d<=30?'proximo':'vigente', recurrente:true })
        }
      }

      list.sort((a,b) => urgencia(b.dias) - urgencia(a.dias) || new Date(a.fecha) - new Date(b.fecha))
      setItems(list)
    } catch(e) { console.error('Agenda:', e) }
    finally { setCargando(false) }
  }, [uid])

  useEffect(() => { cargar() }, [cargar])

  async function guardar() {
    if (!form.descripcion.trim() || !form.fecha_vencimiento) return
    setGuardando(true); setMsg(null)
    try {
      const payload = {
        admin_id: uid,
        consorcio_id: form.consorcio_id || null,
        tipo: form.tipo, descripcion: form.descripcion.trim(),
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
        setMsg({ tipo:'ok', txt:'✅ Vencimiento actualizado.' })
      } else {
        await supabase.from('con_agenda_vencimientos').insert([{ id:'AV-'+Date.now(), ...payload }])
        setMsg({ tipo:'ok', txt:'✅ Vencimiento agregado.' })
      }
      setMostrarForm(false); setEditando(null); setForm(FORM0)
      cargar()
    } catch(e) { setMsg({ tipo:'err', txt:'❌ Error: ' + e.message }) }
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
    setForm({ tipo:item.tipo, descripcion:item.desc, consorcio_id:item.consorcio_id||'',
      fecha_vencimiento:item.fecha, fecha_aviso1:item.fecha_aviso1||'',
      fecha_aviso2:item.fecha_aviso2||'', monto:item.monto?String(item.monto):'',
      notas:item.notas||'', recurrente:item.recurrente||false,
      frecuencia_dias:item.frecuencia_dias?String(item.frecuencia_dias):'' })
    setEditando(item.id); setMostrarForm(true)
    window.scrollTo({ top:0, behavior:'smooth' })
  }

  function cancelarForm() { setMostrarForm(false); setEditando(null); setForm(FORM0) }

  const filtrados = items.filter(item => {
    if (filtroU === 'vencido'    && item.dias >= 0) return false
    if (filtroU === 'proximo7'   && (item.dias < 0 || item.dias > 7)) return false
    if (filtroU === 'proximo30'  && (item.dias < 0 || item.dias > 30)) return false
    if (filtroU === 'ok'         && item.dias < 0) return false
    if (filtroTipo !== 'todos'   && item.tipo !== filtroTipo) return false
    if (filtroCon  !== 'todos'   && item.consorcio_id !== filtroCon) return false
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase()
      if (!item.desc?.toLowerCase().includes(b) && !item.consorcio_nombre?.toLowerCase().includes(b)) return false
    }
    return true
  })

  const cVen  = items.filter(i => i.dias < 0).length
  const cP7   = items.filter(i => i.dias >= 0 && i.dias <= 7).length
  const cP30  = items.filter(i => i.dias > 7 && i.dias <= 30).length

  const btnFiltro = (v, l, color, bg) => (
    <button key={v} onClick={() => setFiltroU(v)}
      style={{ padding:'5px 12px', fontSize:12, fontWeight:600, cursor:'pointer',
        borderRadius:20, border:'1px solid', whiteSpace:'nowrap',
        borderColor: filtroU===v ? color : '#d1d5db',
        background:  filtroU===v ? bg    : '#fff',
        color:       filtroU===v ? color : '#6B7280' }}>
      {l}
    </button>
  )

  return (
    <div style={{ maxWidth:880, margin:'0 auto', padding:'0 0 48px' }}>

      {/* Encabezado */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, color:AZ }}>📅 Agenda de Vencimientos</h2>
          <div style={{ fontSize:12, color:GR, marginTop:3, display:'flex', gap:14 }}>
            <span>{items.length} vencimientos</span>
            {cVen  > 0 && <span style={{ color:RJ,  fontWeight:700 }}>🔴 {cVen} vencidos</span>}
            {cP7   > 0 && <span style={{ color:'#B45309', fontWeight:700 }}>🟡 {cP7} en 7d</span>}
            {cP30  > 0 && <span style={{ color:AM }}>🟡 {cP30} en 30d</span>}
          </div>
        </div>
        <Btn onClick={() => { cancelarForm(); setMostrarForm(f => !f) }}
          style={{ background:AZ, color:'#fff', padding:'8px 16px', fontSize:13, fontWeight:700 }}>
          {mostrarForm && !editando ? '✕ Cancelar' : '＋ Agregar'}
        </Btn>
      </div>

      {/* Mensaje */}
      {msg && (
        <div style={{ padding:'9px 14px', borderRadius:8, marginBottom:14, fontSize:13, fontWeight:600,
          background:msg.tipo==='ok'?'#f0fdf4':'#fff1f1', color:msg.tipo==='ok'?VD:RJ }}>
          {msg.txt}
        </div>
      )}

      {/* Formulario */}
      {mostrarForm && (
        <Card style={{ marginBottom:20, background:'#f8faff', border:'1px solid #c0cfe8' }}>
          <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:14 }}>
            {editando ? '✏️ Editar vencimiento' : '➕ Nuevo vencimiento'}
          </div>
          <div style={COL3}>
            <div>
              <label style={LBL}>Tipo *</label>
              <select style={FLD} value={form.tipo} onChange={e => upd('tipo', e.target.value)}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Consorcio</label>
              <select style={FLD} value={form.consorcio_id} onChange={e => upd('consorcio_id', e.target.value)}>
                <option value="">— General —</option>
                {(consorcios||[]).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).map(c =>
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                )}
              </select>
            </div>
            <div>
              <label style={LBL}>Vencimiento *</label>
              <input style={FLD} type="date" value={form.fecha_vencimiento} onChange={e => upd('fecha_vencimiento', e.target.value)} />
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label style={LBL}>Descripción *</label>
              <input style={FLD} placeholder="Ej: Póliza La Segunda N° 250230761945"
                value={form.descripcion} onChange={e => upd('descripcion', e.target.value)} />
            </div>
            <div>
              <label style={LBL}>Aviso anticipado 1</label>
              <input style={FLD} type="date" value={form.fecha_aviso1} onChange={e => upd('fecha_aviso1', e.target.value)} />
            </div>
            <div>
              <label style={LBL}>Aviso anticipado 2</label>
              <input style={FLD} type="date" value={form.fecha_aviso2} onChange={e => upd('fecha_aviso2', e.target.value)} />
            </div>
            <div>
              <label style={LBL}>Monto ($)</label>
              <input style={FLD} type="number" placeholder="0.00"
                value={form.monto} onChange={e => upd('monto', e.target.value)} />
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label style={LBL}>Notas</label>
              <input style={FLD} placeholder="Observaciones, compañía, número, contacto..."
                value={form.notas} onChange={e => upd('notas', e.target.value)} />
            </div>
            <div style={{ gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:10 }}>
              <input type="checkbox" id="rec" checked={form.recurrente}
                onChange={e => upd('recurrente', e.target.checked)} />
              <label htmlFor="rec" style={{ fontSize:13, color:'#374151', cursor:'pointer' }}>🔁 Recurrente</label>
              {form.recurrente && (
                <>
                  <span style={{ fontSize:12, color:GR }}>cada</span>
                  <input style={{ ...FLD, width:80 }} type="number" placeholder="días"
                    value={form.frecuencia_dias} onChange={e => upd('frecuencia_dias', e.target.value)} />
                  <span style={{ fontSize:12, color:GR }}>días</span>
                </>
              )}
            </div>
          </div>
          <div style={{ marginTop:16, display:'flex', gap:10 }}>
            <Btn onClick={guardar}
              disabled={guardando || !form.descripcion.trim() || !form.fecha_vencimiento}
              style={{ background:VD, color:'#fff', padding:'9px 22px', fontWeight:700,
                opacity:(!form.descripcion.trim()||!form.fecha_vencimiento)?0.5:1 }}>
              {guardando ? 'Guardando...' : editando ? '💾 Actualizar' : '💾 Guardar'}
            </Btn>
            <BtnSec onClick={cancelarForm}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16, alignItems:'center' }}>
        {btnFiltro('todos',    'Todos',                          '#374151', '#f3f4f6')}
        {btnFiltro('vencido',  badgeFiltro('🔴 Vencidos', cVen),  '#B91C1C', '#fff1f1')}
        {btnFiltro('proximo7', badgeFiltro('🟡 ≤7 días', cP7),    '#B45309', '#fffbea')}
        {btnFiltro('proximo30',badgeFiltro('🟡 ≤30 días', cP30),  '#C07D10', '#fffbea')}
        {btnFiltro('ok',       '🟢 Al día',                       '#1B6B35', '#f0fdf4')}

        <select style={{ ...FLD, width:'auto', padding:'5px 9px', fontSize:12 }}
          value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
        </select>

        <select style={{ ...FLD, width:'auto', padding:'5px 9px', fontSize:12 }}
          value={filtroCon} onChange={e => setFiltroCon(e.target.value)}>
          <option value="todos">Todos los consorcios</option>
          {(consorcios||[]).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).map(c =>
            <option key={c.id} value={c.id}>{c.nombre}</option>
          )}
        </select>

        <input style={{ ...FLD, width:160, padding:'5px 9px', fontSize:12 }}
          placeholder="🔍 Buscar..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
      </div>

      {/* Lista */}
      {cargando ? (
        <div style={{ color:GR, fontSize:13, padding:'24px 0', textAlign:'center' }}>Cargando agenda...</div>
      ) : filtrados.length === 0 ? (
        <Card>
          <div style={{ color:GR, fontSize:13, textAlign:'center', padding:'20px 0', fontStyle:'italic' }}>
            {items.length === 0
              ? 'Sin vencimientos registrados. Usá ＋ Agregar para incorporar pólizas, ART, impuestos, asambleas, etc.'
              : 'No hay vencimientos con los filtros seleccionados.'}
          </div>
        </Card>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtrados.map(item => (
            <div key={item.id} style={{ display:'flex', alignItems:'center', gap:12,
              padding:'10px 14px', borderRadius:9,
              background:bgDias(item.dias), border:'1px solid ' + borderDias(item.dias) }}>

              <span style={{ fontSize:20, flexShrink:0 }}>{TIPO_MAP[item.tipo]?.icon||'📌'}</span>

              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, fontWeight:700, color:'#111827' }}>{item.desc}</span>
                  <span style={{ fontSize:11, color:'#6B7280', background:'rgba(0,0,0,0.05)',
                    padding:'1px 7px', borderRadius:10 }}>
                    {TIPO_MAP[item.tipo]?.label||item.tipo}
                  </span>
                  {item.recurrente && <span style={{ fontSize:10, color:AM }}>🔁</span>}
                  {item.fuente !== 'agenda' && (
                    <span style={{ fontSize:10, color:'#9CA3AF', fontStyle:'italic' }}>
                      {item.fuente === 'consorcio' ? 'desde ficha' : 'desde proveedor'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize:11, color:'#6B7280', marginTop:3, display:'flex', gap:12, flexWrap:'wrap' }}>
                  <span>📍 {item.consorcio_nombre}</span>
                  <span>📅 {new Date(item.fecha + 'T00:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric' })}</span>
                  {item.monto && <span>💰 ${Number(item.monto).toLocaleString('es-AR')}</span>}
                  {item.notas && <span>💬 {item.notas}</span>}
                  {item.fecha_aviso1 && (
                    <span>🔔 Aviso: {new Date(item.fecha_aviso1+'T00:00:00').toLocaleDateString('es-AR')}</span>
                  )}
                </div>
              </div>

              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                <div style={{ fontSize:12, fontWeight:700, color:colorDias(item.dias),
                  background:'rgba(255,255,255,0.8)', borderRadius:6, padding:'3px 9px', whiteSpace:'nowrap' }}>
                  {labelDias(item.dias)}
                </div>
                {item.fuente === 'agenda' ? (
                  <div style={{ display:'flex', gap:4 }}>
                    <button onClick={() => abrirEditar(item)}
                      style={{ fontSize:10, padding:'2px 7px', background:'#e0e7ff', color:AZ,
                        border:'none', borderRadius:4, cursor:'pointer', fontWeight:600 }}>
                      ✏️ Editar
                    </button>
                    {item.estado !== 'cumplido' && (
                      <button onClick={() => marcarCumplido(item.id)}
                        style={{ fontSize:10, padding:'2px 7px', background:'#d1fae5', color:'#065f46',
                          border:'none', borderRadius:4, cursor:'pointer', fontWeight:600 }}>
                        ✓ Cumplido
                      </button>
                    )}
                    <button onClick={() => eliminar(item.id)}
                      style={{ fontSize:10, padding:'2px 7px', background:'#fee2e2', color:RJ,
                        border:'none', borderRadius:4, cursor:'pointer' }}>
                      ✕
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize:10, color:'#9CA3AF' }}>Solo lectura</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {filtrados.length > 0 && (
        <div style={{ marginTop:14, fontSize:12, color:GR, textAlign:'right' }}>
          {filtrados.length} de {items.length} vencimientos
        </div>
      )}
    </div>
  )
}
