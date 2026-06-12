// modules — AgendaVencimientos.jsx
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

export default function AgendaVencimientos() {
  const { session, consorcioActivo, proveedores } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [vencimientos, setVencimientos] = useState([])
  const [form, setForm]     = useState(null)
  const [msg, setMsg]       = useState(null)
  const [filtro, setFiltro] = useState('proximos')
  const [vistaAg, setVistaAg] = useState('lista')   // 'lista' | 'calendario'
  // Calendario
  const [calMes, setCalMes]   = useState(() => new Date().getMonth())
  const [calAnio, setCalAnio] = useState(() => new Date().getFullYear())

  const TIPOS = [
    ['expensa','💰 Expensa'],['poliza','🛡 Póliza de seguro'],['contrato_proveedor','🔧 Contrato proveedor'],
    ['asamblea_convocatoria','🏛 Convocatoria Asamblea'],['mandato_administrador','🔖 Mandato Administrador'],
    ['mantenimiento','🔨 Mantenimiento'],['impuesto','📋 Impuesto/tasa'],['reunion','👥 Reunión/Asamblea'],
    ['otro','📌 Otro']
  ]
  const TIPO_COLOR = {
    expensa:'#1A3FA0', poliza:'#7c3aed', contrato_proveedor:'#0891b2',
    asamblea_convocatoria:'#1A3FA0', mandato_administrador:'#d97706',
    mantenimiento:'#16a34a', impuesto:'#dc2626', reunion:'#0891b2', otro:'#6b7280'
  }
  const hoy  = new Date().toISOString().split('T')[0]
  const en30 = new Date(Date.now()+30*24*60*60*1000).toISOString().split('T')[0]
  const en7  = new Date(Date.now()+7*24*60*60*1000).toISOString().split('T')[0]
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const DIAS  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

  async function cargar() {
    // 1. Agenda manual
    const { data: agenda } = await supabase.from('con_agenda_vencimientos').select('*')
      .eq('admin_id', uid)
      .in('estado',['pendiente','vencido'])
      .order('fecha_vencimiento')

    // 2. Pólizas desde con_consorcios (automático desde ficha)
    const { data: cons } = await supabase.from('con_consorcios')
      .select('id,nombre,poliza_vto_hasta,poliza_nro,aseguradora,poliza_suma')
      .eq('admin_id', uid)
      .not('poliza_vto_hasta', 'is', null)

    // 3. ART y seguros de proveedores
    const { data: provs } = await supabase.from('con_proveedores')
      .select('id,razon_social,art_vencimiento,seguro_vencimiento,consorcio_id')
      .eq('admin_id', uid)
      .or('art_vencimiento.not.is.null,seguro_vencimiento.not.is.null')

    const extras = []
    const hoy = new Date(); hoy.setHours(0,0,0,0)

    // Pólizas
    for (const c of (cons||[])) {
      const dias = Math.round((new Date(c.poliza_vto_hasta+'T00:00:00') - hoy) / 86400000)
      const nro  = c.poliza_nro ? ' N° ' + c.poliza_nro : ''
      extras.push({
        id: 'AUTO-POL-' + c.id,
        tipo: 'poliza',
        descripcion: 'Póliza — ' + (c.aseguradora || 'Seguro del edificio') + nro,
        fecha_vencimiento: c.poliza_vto_hasta,
        monto: c.poliza_suma,
        consorcio_id: c.id,
        consorcio_nombre: c.nombre,
        estado: dias < 0 ? 'vencido' : 'pendiente',
        fuente: 'auto',
      })
    }

    // ART / Seguro proveedores
    for (const p of (provs||[])) {
      if (p.art_vencimiento) {
        const dias = Math.round((new Date(p.art_vencimiento+'T00:00:00') - hoy) / 86400000)
        extras.push({ id:'AUTO-ART-'+p.id, tipo:'poliza',
          descripcion:'ART — '+p.razon_social, fecha_vencimiento:p.art_vencimiento,
          consorcio_id:p.consorcio_id, estado:dias<0?'vencido':'pendiente', fuente:'auto' })
      }
      if (p.seguro_vencimiento) {
        const dias = Math.round((new Date(p.seguro_vencimiento+'T00:00:00') - hoy) / 86400000)
        extras.push({ id:'AUTO-SEG-'+p.id, tipo:'poliza',
          descripcion:'Seguro — '+p.razon_social, fecha_vencimiento:p.seguro_vencimiento,
          consorcio_id:p.consorcio_id, estado:dias<0?'vencido':'pendiente', fuente:'auto' })
      }
    }

    // Combinar: agenda manual primero, luego automáticos (sin duplicar)
    const idsAgenda = new Set((agenda||[]).map(a => a.id))
    const todos = [...(agenda||[]), ...extras.filter(e => !idsAgenda.has(e.id))]
    todos.sort((a,b) => new Date(a.fecha_vencimiento) - new Date(b.fecha_vencimiento))
    setVencimientos(todos)
  }
  useEffect(() => { if (uid) cargar() }, [consorcioId, uid])

  async function guardar() {
    if (!form?.descripcion?.trim() || !form?.fecha_vencimiento) return setMsg({ tipo:'warn', texto:'Descripción y fecha son requeridos' })
    const payload = {
      ...form,
      id: form.id || `VEN-${consorcioId}-${Date.now()}`,
      admin_id: uid,
      consorcio_id: consorcioId,
      estado: form.estado || 'pendiente',
    }
    const { error } = await supabase.from('con_agenda_vencimientos').upsert([payload], { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto: error.message })
    setMsg({ tipo:'ok', texto:'✓ Vencimiento guardado' })
    setForm(null); cargar()
  }

  async function completar(id) {
    await supabase.from('con_agenda_vencimientos').update({ estado:'completado' }).eq('id', id)
    cargar()
  }

  const fmtF = d => d ? new Date(d+'T12:00:00').toLocaleDateString('es-AR') : '—'
  const diasRestan = d => {
    if (!d) return 9999
    return Math.ceil((new Date(d+'T12:00:00').getTime() - Date.now()) / 86400000)
  }
  const colorDias = d => d < 0 ? RJ : d <= 7 ? '#d97706' : d <= 30 ? AM : VD

  const filtrados = vencimientos.filter(v => {
    if (filtro === 'proximos') return v.fecha_vencimiento <= en30
    if (filtro === 'urgentes') return v.fecha_vencimiento <= en7
    if (filtro === 'polizas')  return v.tipo === 'poliza'
    if (filtro === 'mandatos') return v.tipo === 'mandato_administrador'
    return true
  })

  // ── Helpers calendario ────────────────────────────────────────────────────
  const diasEnMes = (mes, anio) => new Date(anio, mes+1, 0).getDate()
  const primerDia = (mes, anio) => new Date(anio, mes, 1).getDay() // 0=dom

  const eventosDelDia = (dia) => {
    const fecha = `${calAnio}-${String(calMes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
    return vencimientos.filter(v =>
      v.fecha_vencimiento === fecha ||
      v.fecha_aviso1      === fecha ||
      v.fecha_aviso2      === fecha
    ).map(v => ({
      ...v,
      esDia:    v.fecha_vencimiento === fecha,
      esAviso1: v.fecha_aviso1      === fecha,
      esAviso2: v.fecha_aviso2      === fecha,
    }))
  }

  const mesAnterior = () => { if(calMes===0){setCalMes(11);setCalAnio(y=>y-1)}else{setCalMes(m=>m-1)} }
  const mesSiguiente = () => { if(calMes===11){setCalMes(0);setCalAnio(y=>y+1)}else{setCalMes(m=>m+1)} }
  const irHoy = () => { const hoyD=new Date(); setCalMes(hoyD.getMonth()); setCalAnio(hoyD.getFullYear()) }

  // Form
  if (form) return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:16 }}>{form.id?'✏ Editar':'+ Nuevo vencimiento'}</div>
      <Msg data={msg} />
      <Card>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Tipo</div>
            <select value={form.tipo||'otro'} onChange={e=>setForm(x=>({...x,tipo:e.target.value}))}
              style={{ width:'100%', padding:'8px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13 }}>
              {TIPOS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <Input label="Fecha de vencimiento" value={form.fecha_vencimiento||''} onChange={v=>setForm(x=>({...x,fecha_vencimiento:v}))} type="date"/>
          <div style={{ gridColumn:'span 2' }}>
            <Input label="Descripción" value={form.descripcion||''} onChange={v=>setForm(x=>({...x,descripcion:v}))} placeholder="ej: Vencimiento póliza de seguro contra incendio"/>
          </div>
          <Input label="Monto ($)" value={form.monto||''} onChange={v=>setForm(x=>({...x,monto:v}))} type="number"/>
          <Input label="1° Aviso (fecha)" value={form.fecha_aviso1||''} onChange={v=>setForm(x=>({...x,fecha_aviso1:v}))} type="date"/>
          <Input label="2° Aviso (fecha)" value={form.fecha_aviso2||''} onChange={v=>setForm(x=>({...x,fecha_aviso2:v}))} type="date"/>
          <div style={{ gridColumn:'span 2' }}>
            <Input label="Notas" value={form.notas||''} onChange={v=>setForm(x=>({...x,notas:v}))} placeholder="Información adicional"/>
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={!!form.recurrente} onChange={e=>setForm(x=>({...x,recurrente:e.target.checked}))}/>
            <span>Vencimiento recurrente anual</span>
          </label>
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
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>📅 Agenda de vencimientos</div>
        <Btn small onClick={()=>setForm({ tipo:'otro', estado:'pendiente' })}>+ Agregar</Btn>
      </div>

      {/* Tabs Vista / Calendario */}
      <div style={{display:'flex',gap:0,marginBottom:14,borderBottom:'2px solid #e5e7eb'}}>
        {[['lista','📋 Lista'],['calendario','📆 Calendario']].map(([id,l])=>(
          <button key={id} type="button" onClick={()=>setVistaAg(id)}
            style={{padding:'8px 18px',border:'none',borderBottom:vistaAg===id?'2px solid '+AZ:'2px solid transparent',
              background:'transparent',color:vistaAg===id?AZ:GR,fontWeight:vistaAg===id?700:400,cursor:'pointer',fontSize:13}}>
            {l}
          </button>
        ))}
      </div>

      <Msg data={msg} />

      {/* ── VISTA LISTA ── */}
      {vistaAg==='lista'&&(<>
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
          {[['todos','📋 Todos'],['proximos','⏰ Próx. 30d'],['urgentes','🚨 Esta semana'],['polizas','🛡 Pólizas'],['mandatos','🔖 Mandatos']].map(([v,l])=>(
            <button key={v} type="button" onClick={()=>setFiltro(v)}
              style={{ padding:'6px 14px', borderRadius:7, border:'none', fontSize:12, fontWeight:600,
                cursor:'pointer', background:filtro===v?AZ:'#f3f4f6', color:filtro===v?'#fff':GR }}>
              {l}
            </button>
          ))}
        </div>
        {filtrados.length === 0 ? (
          <Card>
            <div style={{ textAlign:'center', padding:'24px 0', color:GR }}>
              <div style={{ fontSize:36, marginBottom:8 }}>📅</div>
              {filtro==='proximos'?'Sin vencimientos en los próximos 30 días':filtro==='mandatos'?'Sin mandatos registrados':'Sin vencimientos en esta categoría'}
            </div>
          </Card>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {filtrados.map(v => {
              const dias = diasRestan(v.fecha_vencimiento)
              const tipoColor = TIPO_COLOR[v.tipo] || GR
              return (
                <Card key={v.id} style={{ border: dias<0?`1.5px solid ${RJ}`:dias<=7?`1.5px solid ${AM}`:'1px solid #e5e7eb' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                        <span style={{ fontWeight:600, fontSize:13 }}>{v.descripcion}</span>
                        <span style={{ fontSize:10, padding:'2px 8px', borderRadius:5, background:tipoColor+'15', color:tipoColor, fontWeight:600 }}>
                          {TIPOS.find(([tv])=>tv===v.tipo)?.[1]||v.tipo}
                        </span>
                      </div>
                      <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                        Vence: <strong>{fmtF(v.fecha_vencimiento)}</strong>
                        {v.fecha_aviso1 ? ' · Aviso 1: '+fmtF(v.fecha_aviso1) : ''}
                        {v.fecha_aviso2 ? ' · Aviso 2: '+fmtF(v.fecha_aviso2) : ''}
                        {v.monto ? ` · $${Number(v.monto).toLocaleString('es-AR')}` : ''}
                      </div>
                      {v.notas&&<div style={{fontSize:11,color:GR,marginTop:2,fontStyle:'italic'}}>{v.notas}</div>}
                    </div>
                    <div style={{ textAlign:'right', marginLeft:14, flexShrink:0 }}>
                      <div style={{ fontSize:16, fontWeight:800, color: colorDias(dias) }}>
                        {dias < 0 ? `${Math.abs(dias)}d vencido` : dias === 0 ? '¡Hoy!' : `${dias}d`}
                      </div>
                      <div style={{display:'flex',gap:6,marginTop:4,justifyContent:'flex-end'}}>
                        <button type="button" onClick={()=>setForm(v)}
                          style={{ padding:'3px 8px', background:'#f3f4f6', color:GR, border:'none', borderRadius:5, cursor:'pointer', fontSize:11 }}>
                          ✏
                        </button>
                        <button type="button" onClick={()=>completar(v.id)}
                          style={{ padding:'3px 10px', background:VD, color:'#fff', border:'none', borderRadius:5, cursor:'pointer', fontSize:11 }}>
                          ✓ Completar
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </>)}

      {/* ── VISTA CALENDARIO ── */}
      {vistaAg==='calendario'&&(
        <div>
          {/* Navegación */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,background:'#fff',borderRadius:12,padding:'12px 16px',boxShadow:'0 1px 6px #0001'}}>
            <button type="button" onClick={mesAnterior}
              style={{padding:'6px 14px',background:'#f3f4f6',border:'none',borderRadius:7,cursor:'pointer',fontSize:14,fontWeight:700}}>‹</button>
            <div style={{textAlign:'center'}}>
              <div style={{fontWeight:700,fontSize:16,color:AZ}}>{MESES[calMes]} {calAnio}</div>
              <button type="button" onClick={irHoy}
                style={{marginTop:2,padding:'2px 12px',background:'#eff6ff',color:AZ,border:'none',borderRadius:5,cursor:'pointer',fontSize:11,fontWeight:600}}>
                Hoy
              </button>
            </div>
            <button type="button" onClick={mesSiguiente}
              style={{padding:'6px 14px',background:'#f3f4f6',border:'none',borderRadius:7,cursor:'pointer',fontSize:14,fontWeight:700}}>›</button>
          </div>

          {/* Grilla */}
          <div style={{background:'#fff',borderRadius:12,padding:'12px',boxShadow:'0 1px 6px #0001',overflowX:'auto'}}>
            {/* Cabecera días */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:4}}>
              {DIAS.map(d=>(
                <div key={d} style={{textAlign:'center',fontSize:11,fontWeight:700,color:GR,padding:'4px 0'}}>{d}</div>
              ))}
            </div>
            {/* Celdas */}
            {(() => {
              const total = diasEnMes(calMes, calAnio)
              const inicio = primerDia(calMes, calAnio)
              const hoyStr = new Date().toISOString().slice(0,10)
              const cells = []
              // Celdas vacías iniciales
              for (let i=0; i<inicio; i++) cells.push(<div key={'e'+i}/>)
              for (let d=1; d<=total; d++) {
                const fechaStr = `${calAnio}-${String(calMes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                const eventos = eventosDelDia(d)
                const esHoy = fechaStr === hoyStr
                cells.push(
                  <div key={d} style={{
                    minHeight:64, border:'1px solid #f0f0f0', borderRadius:8, padding:'4px 5px',
                    background: esHoy ? '#eff6ff' : '#fafafa',
                    outline: esHoy ? '2px solid '+AZ : 'none'
                  }}>
                    <div style={{fontSize:12,fontWeight:esHoy?800:500,color:esHoy?AZ:'#374151',marginBottom:3}}>{d}</div>
                    {eventos.slice(0,3).map((ev,i)=>{
                      const col = TIPO_COLOR[ev.tipo]||GR
                      const label = ev.esDia ? '●' : ev.esAviso1 ? '◆' : '◇'
                      const title = (ev.esDia?'Vence: ':ev.esAviso1?'Aviso 1: ':'Aviso 2: ')+ev.descripcion
                      return (
                        <div key={i} title={title} style={{
                          fontSize:9.5, padding:'2px 4px', borderRadius:4, marginBottom:2,
                          background:col+'18', color:col, fontWeight:600,
                          overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis',
                          cursor:'default'
                        }}>
                          {label} {ev.descripcion.slice(0,18)}{ev.descripcion.length>18?'…':''}
                        </div>
                      )
                    })}
                    {eventos.length>3&&<div style={{fontSize:9,color:GR}}>+{eventos.length-3} más</div>}
                  </div>
                )
              }
              return <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>{cells}</div>
            })()}
          </div>

          {/* Leyenda */}
          <div style={{marginTop:12,display:'flex',flexWrap:'wrap',gap:8,fontSize:11,color:GR}}>
            <span style={{fontWeight:600}}>Leyenda:</span>
            <span>● Vencimiento</span>
            <span>◆ Aviso 1</span>
            <span>◇ Aviso 2</span>
            {Object.entries(TIPO_COLOR).slice(0,5).map(([k,c])=>(
              <span key={k} style={{color:c,fontWeight:600}}>{TIPOS.find(([v])=>v===k)?.[1]||k}</span>
            ))}
          </div>

          {/* Eventos del mes */}
          {vencimientos.filter(v=>{
            const [y,m] = (v.fecha_vencimiento||'').split('-')
            return parseInt(y)===calAnio && parseInt(m)-1===calMes
          }).length > 0 && (
            <div style={{marginTop:14}}>
              <div style={{fontWeight:600,fontSize:13,color:AZ,marginBottom:8}}>Vencimientos en {MESES[calMes]} {calAnio}</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {vencimientos.filter(v=>{
                  const [y,m] = (v.fecha_vencimiento||'').split('-')
                  return parseInt(y)===calAnio && parseInt(m)-1===calMes
                }).map(v=>{
                  const dias = diasRestan(v.fecha_vencimiento)
                  const col = TIPO_COLOR[v.tipo]||GR
                  return (
                    <div key={v.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'#fff',borderRadius:8,border:'1px solid #f0f0f0',fontSize:12}}>
                      <div style={{width:8,height:8,borderRadius:'50%',background:col,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <span style={{fontWeight:600}}>{v.descripcion}</span>
                        <span style={{color:GR,marginLeft:8}}>{fmtF(v.fecha_vencimiento)}</span>
                      </div>
                      <div style={{fontWeight:700,color:colorDias(dias),fontSize:11}}>{dias<0?`${Math.abs(dias)}d venc.`:dias===0?'¡Hoy!':dias+'d'}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
