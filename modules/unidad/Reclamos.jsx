// modules — Reclamos.jsx
// Extraído del V59. Props → useApp().

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Reclamos() {
  const { session, unidades, copropietarios } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [reclamos, setReclamos]     = useState([])
  const [tab, setTab]               = useState('lista')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroPrioridad, setFiltroPrioridad] = useState('')
  const [busqueda, setBusqueda]     = useState('')
  const [form, setForm]             = useState(null)
  const [detalle, setDetalle]       = useState(null)
  const [respuesta, setRespuesta]   = useState('')
  const [msg, setMsg]               = useState(null)
  const hoy = new Date().toISOString().split('T')[0]

  const TIPOS      = [['reclamo','🔴 Reclamo'],['consulta','💬 Consulta'],['sugerencia','💡 Sugerencia'],['urgente','🚨 Urgente']]
  const ESTADOS    = [['abierto','🔵 Abierto'],['en_proceso','🟡 En proceso'],['resuelto','🟢 Resuelto'],['cerrado','⚫ Cerrado'],['derivado','🔀 Derivado']]
  const PRIORIDAD  = [['baja','Baja'],['normal','Normal'],['alta','Alta'],['urgente','Urgente']]
  const CATEGORIAS = ['mantenimiento','limpieza','ruido','ascensor','gas','electricidad','administracion','otro']
  const COLORS_EST = { abierto:AZ, en_proceso:AM, resuelto:VD, cerrado:GR, derivado:'#7c3aed' }
  const COLORS_PRI = { baja:GR, normal:AZ, alta:AM, urgente:RJ }

  async function cargar() {
    let q = supabase.from('con_reclamos').select('*')
      .eq('admin_id', uid).eq('consorcio_id', consorcioId)
      .order('created_at', { ascending:false }).limit(200)
    if (filtroEstado)    q = q.eq('estado', filtroEstado)
    if (filtroPrioridad) q = q.eq('prioridad', filtroPrioridad)
    const { data } = await q
    setReclamos(data || [])
  }
  useEffect(() => { if (consorcioId) cargar() }, [consorcioId, filtroEstado, filtroPrioridad])

  async function guardar() {
    if (!form?.asunto?.trim()) return setMsg({ tipo:'warn', texto:'El asunto es requerido' })
    const payload = {
      ...form,
      id: form.id || `REC-${consorcioId}-${Date.now()}`,
      admin_id: uid,
      consorcio_id: consorcioId,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('con_reclamos').upsert([payload], { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto: error.message })
    setMsg({ tipo:'ok', texto:'✓ Reclamo guardado' })
    setForm(null); cargar()
  }

  async function cambiarEstado(rec, nuevoEstado) {
    await supabase.from('con_reclamos').update({
      estado: nuevoEstado,
      fecha_resolucion: nuevoEstado === 'resuelto' ? hoy : null,
      fecha_cierre:     nuevoEstado === 'cerrado'  ? hoy : null,
      updated_at: new Date().toISOString(),
    }).eq('id', rec.id)
    if (respuesta.trim() && detalle?.id === rec.id) {
      await supabase.from('con_reclamos').update({ respuesta: respuesta.trim() }).eq('id', rec.id)
    }
    setMsg({ tipo:'ok', texto:`✓ Estado → ${nuevoEstado}` })
    setRespuesta(''); setDetalle(null); cargar()
  }

  const fmt = d => d ? new Date(d).toLocaleDateString('es-AR') : '—'
  const filtrados = reclamos.filter(r => !busqueda ||
    r.asunto.toLowerCase().includes(busqueda.toLowerCase()) ||
    (r.descripcion||'').toLowerCase().includes(busqueda.toLowerCase()))

  const kpis = [
    { l:'Abiertos',     v:reclamos.filter(r=>r.estado==='abierto').length,     c:AZ },
    { l:'En proceso',   v:reclamos.filter(r=>r.estado==='en_proceso').length,  c:AM },
    { l:'Resueltos',    v:reclamos.filter(r=>r.estado==='resuelto').length,    c:VD },
    { l:'Urgentes',     v:reclamos.filter(r=>r.prioridad==='urgente').length,  c:RJ },
  ]

  if (detalle) return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
        <BtnSec onClick={()=>{ setDetalle(null); setRespuesta('') }}>← Volver</BtnSec>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:15 }}>{detalle.asunto}</div>
          <div style={{ fontSize:12, color:GR }}>
            {fmt(detalle.created_at)} · UF {unidades.find(u=>u.id===detalle.unidad_id)?.numero || '—'} ·
            <span style={{ color: COLORS_EST[detalle.estado], fontWeight:600 }}> {detalle.estado}</span>
          </div>
        </div>
      </div>
      <Msg data={msg} />
      <Card style={{ marginBottom:14 }}>
        <div style={{ fontSize:13, lineHeight:1.8, whiteSpace:'pre-wrap' }}>{detalle.descripcion || 'Sin descripción.'}</div>
      </Card>
      <Card style={{ marginBottom:14 }}>
        <div style={{ fontWeight:600, color:AZ, marginBottom:10 }}>Respuesta al copropietario</div>
        <textarea value={respuesta} onChange={e=>setRespuesta(e.target.value)}
          rows={5} placeholder="Escribí la respuesta para el copropietario..."
          style={{ width:'100%', padding:'10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
        <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
          {ESTADOS.map(([v,l]) => (
            <button key={v} type="button" onClick={() => cambiarEstado(detalle, v)}
              style={{ padding:'6px 14px', background: detalle.estado===v?COLORS_EST[v]:'#f3f4f6',
                color: detalle.estado===v?'#fff':GR, border:'none', borderRadius:7,
                fontSize:12, fontWeight:600, cursor:'pointer' }}>{l}</button>
          ))}
        </div>
      </Card>
    </div>
  )

  if (form) return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:16 }}>{form.id ? '✏ Editar reclamo' : '+ Nuevo reclamo'}</div>
      <Msg data={msg} />
      <Card>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Tipo</div>
            <select value={form.tipo||'reclamo'} onChange={e=>setForm(x=>({...x,tipo:e.target.value}))}
              style={{ width:'100%', padding:'8px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13 }}>
              {TIPOS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <Sel label="Unidad" value={form.unidad_id||''} onChange={v=>setForm(x=>({...x,unidad_id:v}))}
            opts={[{v:'',l:'— Seleccioná UF —'},...unidades.map(u=>{
              const cp=copropietarios.find(c=>c.id===u.propietario_id)
              return {v:u.id,l:`UF ${u.numero} — ${cp?.apellido_nombre||'Sin prop.'}`}
            })]} />
          <div style={{ gridColumn:'span 2' }}>
            <Input label="Asunto" value={form.asunto||''} onChange={v=>setForm(x=>({...x,asunto:v}))} required />
          </div>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Categoría</div>
            <select value={form.categoria||''} onChange={e=>setForm(x=>({...x,categoria:e.target.value}))}
              style={{ width:'100%', padding:'8px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, textTransform:'capitalize' }}>
              <option value=''>— Categoría —</option>
              {CATEGORIAS.map(c=><option key={c} value={c} style={{ textTransform:'capitalize' }}>{c}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Prioridad</div>
            <select value={form.prioridad||'normal'} onChange={e=>setForm(x=>({...x,prioridad:e.target.value}))}
              style={{ width:'100%', padding:'8px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13 }}>
              {PRIORIDAD.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div style={{ gridColumn:'span 2' }}>
            <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Descripción</div>
            <textarea value={form.descripcion||''} onChange={e=>setForm(x=>({...x,descripcion:e.target.value}))}
              rows={5} placeholder="Detalle del reclamo..."
              style={{ width:'100%', padding:'10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
          </div>
          <div style={{ gridColumn:'span 2' }}>
            <Input label="Notas internas (no visibles al vecino)" value={form.notas_internas||''} onChange={v=>setForm(x=>({...x,notas_internas:v}))} />
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn onClick={guardar}>💾 Guardar</Btn>
          <BtnSec onClick={()=>setForm(null)}>Cancelar</BtnSec>
        </div>
      </Card>
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>🎫 Reclamos y consultas</div>
        <Btn small onClick={()=>setForm({ tipo:'reclamo', prioridad:'normal', estado:'abierto' })}>+ Nuevo reclamo</Btn>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>Gestión de tickets de copropietarios</div>
      <Msg data={msg} />

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:14 }}>
        {kpis.map(({l,v,c}) => (
          <div key={l} style={{ background:'#fff', borderRadius:10, padding:'12px', textAlign:'center', boxShadow:'0 1px 4px #0001' }}>
            <div style={{ fontSize:22, fontWeight:800, color:c }}>{v}</div>
            <div style={{ fontSize:11, color:GR }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <Card style={{ marginBottom:14 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:10, alignItems:'end' }}>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Buscar</div>
            <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
              placeholder="Asunto, descripción..."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:12.5, boxSizing:'border-box' }} />
          </div>
          <Sel label="Estado" value={filtroEstado} onChange={setFiltroEstado}
            opts={[{v:'',l:'Todos los estados'},...ESTADOS.map(([v,l])=>({v,l}))]} />
          <Sel label="Prioridad" value={filtroPrioridad} onChange={setFiltroPrioridad}
            opts={[{v:'',l:'Todas las prioridades'},...PRIORIDAD.map(([v,l])=>({v,l}))]} />
          <Btn small onClick={cargar}>↺</Btn>
        </div>
      </Card>

      {/* Lista */}
      {filtrados.length === 0 ? (
        <Card>
          <div style={{ textAlign:'center', padding:'24px 0', color:GR }}>
            <div style={{ fontSize:36, marginBottom:8 }}>🎫</div>
            {reclamos.length === 0 ? 'Sin reclamos registrados' : 'Sin resultados para el filtro aplicado'}
          </div>
        </Card>
      ) : (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'#f8fafc', borderBottom:'1.5px solid #e5e7eb' }}>
                {['Fecha','UF — Vecino','Asunto','Cat.','Prioridad','Estado',''].map((h,i)=>(
                  <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, color:'#374151', fontSize:11.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(r => {
                const uf = unidades.find(u=>u.id===r.unidad_id)
                const cp = copropietarios.find(c=>c.id===uf?.propietario_id)
                return (
                  <tr key={r.id} style={{ borderBottom:'1px solid #f3f4f6', cursor:'pointer' }}
                    onClick={()=>{ setDetalle(r); setRespuesta(r.respuesta||'') }}>
                    <td style={{ padding:'8px 12px', color:GR, fontSize:11, whiteSpace:'nowrap' }}>{fmt(r.created_at)}</td>
                    <td style={{ padding:'8px 12px' }}>
                      {uf && <div style={{ fontWeight:600 }}>UF {uf.numero}</div>}
                      <div style={{ fontSize:11, color:GR }}>{cp?.apellido_nombre||'—'}</div>
                    </td>
                    <td style={{ padding:'8px 12px', maxWidth:200 }}>
                      <div style={{ fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.asunto}</div>
                      <div style={{ fontSize:10, color:GR, textTransform:'capitalize' }}>{r.tipo} {r.categoria?`· ${r.categoria}`:''}</div>
                    </td>
                    <td style={{ padding:'8px 12px', fontSize:11, color:GR, textTransform:'capitalize' }}>{r.categoria||'—'}</td>
                    <td style={{ padding:'8px 12px' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:6, fontWeight:600,
                        background: r.prioridad==='urgente'?'#fee2e2':r.prioridad==='alta'?'#fff8e1':'#f3f4f6',
                        color: COLORS_PRI[r.prioridad||'normal'] }}>{r.prioridad}</span>
                    </td>
                    <td style={{ padding:'8px 12px' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:6, fontWeight:600,
                        background: r.estado==='abierto'?'#eff6ff':r.estado==='resuelto'?'#dcfce7':r.estado==='en_proceso'?'#fff8e1':'#f3f4f6',
                        color: COLORS_EST[r.estado] }}>{r.estado.replace('_',' ')}</span>
                    </td>
                    <td style={{ padding:'8px 10px' }}><span style={{ color:AZ, fontWeight:600, fontSize:11 }}>Ver →</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ padding:'8px 14px', background:'#f8fafc', fontSize:11, color:GR, borderTop:'1px solid #e5e7eb' }}>
            {filtrados.length} reclamos · Click en fila para gestionar
          </div>
        </Card>
      )}
    </div>
  )
}
