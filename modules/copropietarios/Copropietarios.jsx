// modules — Copropietarios.jsx
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

export default function Copropietarios() {
  const { session, consorcioActivo, copropietarios, setCopropietarios, unidades, expensas } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [lista, setLista] = useState([])
  const [ufsMap, setUfsMap] = useState({}) // propietario_id → [{numero, id}]
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const [tabForm, setTabForm] = useState('principal')
  const [busqueda, setBusqueda] = useState('')
  const F = f => setForm(x => ({ ...x, ...f }))

  async function cargar() {
    const [{ data: cpData }, { data: ufData }] = await Promise.all([
      supabase.from('con_copropietarios').select('*')
        .eq('admin_id', uid).eq('consorcio_id', consorcioId).order('apellido_nombre'),
      supabase.from('con_unidades').select('id, numero, propietario_id, tipo, piso')
        .eq('consorcio_id', consorcioId).eq('estado', 'ocupada').order('numero')
    ])
    const cps = cpData || []
    // Construir mapa propietario_id → lista de UFs
    const mapa = {}
    for (const uf of (ufData || [])) {
      if (!uf.propietario_id) continue
      if (!mapa[uf.propietario_id]) mapa[uf.propietario_id] = []
      mapa[uf.propietario_id].push(uf)
    }
    setLista(cps)
    setUfsMap(mapa)
    if (false) (cps)
  }
  async function guardar() {
    if (!form.apellido_nombre) return setMsg({ tipo:'warn', texto:'Nombre obligatorio' })
    const id = form.id || nextId(lista, 'CP')
    const { error } = await supabase.from('con_copropietarios').upsert(
      { ...form, id, admin_id:uid, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Guardado' }); cargar()
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar copropietario?')) return
    await supabase.from('con_copropietarios').delete().eq('id', id); cargar()
  }
  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const tabsForm = [
    { id:'principal', label:'Principal' },
    { id:'contacto', label:'Contacto adicional' },
    { id:'ocupante', label:'Ocupante / Inquilino' },
    { id:'fiscal', label:'Datos fiscales' },
  ]

  const filtrados = lista.filter(cp => {
    const q = busqueda.toLowerCase()
    return !q || cp.apellido_nombre?.toLowerCase().includes(q)
      || cp.dni?.toLowerCase().includes(q) || cp.email?.toLowerCase().includes(q)
      || cp.telefono?.toLowerCase().includes(q)
  })
  function handlePDF() {
    exportarPDF({titulo:'Listado de Copropietarios',logoB64:null,
      columnas:[
        {key:'nombre',  label:'Apellido y Nombre'},
        {key:'ufs',     label:'UFs'},
        {key:'dni',     label:'DNI'},
        {key:'tel',     label:'Teléfono'},
        {key:'email',   label:'Email'},
        {key:'cons',    label:'Consejero'},
      ],
      filas:filtrados.map(cp=>{
        const ufs = ufsMap[cp.id] || []
        const ufsStr = ufs.length === 0 ? '—'
          : ufs.map(u => `UF ${u.numero}${u.tipo ? ' · ' + u.tipo : ''}`).join(', ')
        return {
          nombre: cp.apellido_nombre||'',
          ufs:    ufsStr,
          dni:    cp.dni||'',
          tel:    cp.telefono||'',
          email:  cp.email||'',
          cons:   cp.es_consejero?'Sí':'',
        }
      })
    })
  }
  function handleExcel() {
    exportarExcel({titulo:'Copropietarios',
      columnas:[
        {key:'nombre',    label:'Apellido y Nombre'},
        {key:'ufs',       label:'UFs'},
        {key:'cant_ufs',  label:'Cant. UFs'},
        {key:'dni',       label:'DNI'},
        {key:'tel',       label:'Teléfono'},
        {key:'email',     label:'Email'},
        {key:'cuit',      label:'CUIT/CUIL'},
        {key:'cons',      label:'Consejero'},
      ],
      filas:filtrados.map(cp=>{
        const ufs = ufsMap[cp.id] || []
        return {
          nombre:   cp.apellido_nombre||'',
          ufs:      ufs.map(u => `UF ${u.numero}`).join(' / ') || '—',
          cant_ufs: ufs.length,
          dni:      cp.dni||'',
          tel:      cp.telefono||'',
          email:    cp.email||'',
          cuit:     cp.cuit_cuil||'',
          cons:     cp.es_consejero?'Sí':'',
        }
      })
    })
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Copropietarios ({lista.length})</div>
        <Btn onClick={() => { setForm({}); setTabForm('principal') }}>+ Agregar</Btn>
      </div>
      <BarraListado busqueda={busqueda} onBuscar={setBusqueda} onPDF={handlePDF} onExcel={handleExcel} placeholder="Buscar por nombre, DNI, email..." />
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:12 }}>{form.id?'Editar copropietario':'Nuevo copropietario'}</div>
          {/* Tabs internos del form */}
          <div style={{ display:'flex', gap:4, marginBottom:14, borderBottom:'1px solid #e5e7eb' }}>
            {tabsForm.map(t=>(
              <button key={t.id} onClick={()=>setTabForm(t.id)}
                style={{ padding:'6px 14px', border:'none', background:'none', cursor:'pointer', fontSize:12, fontWeight:tabForm===t.id?700:400, color:tabForm===t.id?AZ:GR, borderBottom:tabForm===t.id?`2px solid ${AZ}`:'2px solid transparent', marginBottom:-1 }}>
                {t.label}
              </button>
            ))}
          </div>

          {tabForm==='principal' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <div style={{ gridColumn:'span 2' }}><Input label="Apellido y nombre *" value={form.apellido_nombre||''} onChange={v=>F({apellido_nombre:v})} required /></div>
              <Input label="DNI" value={form.dni||''} onChange={v=>F({dni:v})} />
              <Input label="Email principal" value={form.email||''} onChange={v=>F({email:v})} type="email" />
              <Input label="Teléfono / WhatsApp" value={form.telefono||''} onChange={v=>F({telefono:v})} />
              <div style={{ gridColumn:'span 2' }}>
                <Input label="Domicilio real (fuera del consorcio)" value={form.domicilio_real||''} onChange={v=>F({domicilio_real:v})} />
              </div>
              <div style={{ gridColumn:'span 2' }}>
                <Input label="Domicilio constituido (notificaciones legales — Art. 2067 CCCN)" value={form.domicilio_constituido||''} onChange={v=>F({domicilio_constituido:v})} />
              </div>
              <div style={{ gridColumn:'span 2' }}><Input label="Notas" value={form.notas||''} onChange={v=>F({notas:v})} /></div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="checkbox" checked={!!form.es_consejero} onChange={e=>F({es_consejero:e.target.checked})} id="consejero" />
                <label htmlFor="consejero" style={{ fontSize:13, cursor:'pointer' }}>Es consejero/a</label>
              </div>
            </div>
          )}

          {tabForm==='contacto' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <Input label="Email secundario" value={form.email_secundario||''} onChange={v=>F({email_secundario:v})} type="email" />
              <Input label="Teléfono secundario" value={form.telefono_secundario||''} onChange={v=>F({telefono_secundario:v})} />
              <Input label="Email para notificaciones" value={form.email_notificacion||''} onChange={v=>F({email_notificacion:v})} type="email" placeholder="Si difiere del principal" />
              <Input label="Teléfono para notificaciones" value={form.telefono_notificacion||''} onChange={v=>F({telefono_notificacion:v})} placeholder="Si difiere del principal" />
            </div>
          )}

          {tabForm==='ocupante' && (
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:12, background:'#f0f9ff', padding:'8px 12px', borderRadius:6 }}>
                Complete estos datos si la unidad está alquilada. El inquilino recibirá notificaciones a su propio email/teléfono.
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
                <div style={{ gridColumn:'span 2' }}><Input label="Nombre del ocupante / inquilino" value={form.nombre_ocupante||''} onChange={v=>F({nombre_ocupante:v})} /></div>
                <Input label="Email del ocupante" value={form.email_ocupante||''} onChange={v=>F({email_ocupante:v})} type="email" />
                <Input label="Teléfono del ocupante" value={form.telefono_ocupante||''} onChange={v=>F({telefono_ocupante:v})} />
              </div>
            </div>
          )}

          {tabForm==='fiscal' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <Input label="CUIT / CUIL" value={form.cuit_cuil||''} onChange={v=>F({cuit_cuil:v})} placeholder="20-00000000-0" />
              <Sel label="Tipo de persona" value={form.tipo_persona||'fisica'} onChange={v=>F({tipo_persona:v})} opts={[{v:'fisica',l:'Física'},{v:'juridica',l:'Jurídica'}]} />
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar</Btn>
            <BtnSec onClick={() => setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {filtrados.map(cp => {
          const ufs = ufsMap[cp.id] || []
          return (
          <Card key={cp.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:14, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                {cp.apellido_nombre}
                {cp.es_consejero && <Badge text="Consejero" color={AZ} />}
                {/* Badge con cantidad de UFs */}
                <span style={{
                  fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:12,
                  background: ufs.length > 1 ? '#fef3c7' : ufs.length === 1 ? '#f0f4ff' : '#f3f4f6',
                  color:      ufs.length > 1 ? '#92400e' : ufs.length === 1 ? '#1A3FA0' : '#9ca3af'
                }}>
                  {ufs.length === 0 ? 'Sin UF asignada' : ufs.length === 1 ? `UF ${ufs[0].numero}` : `${ufs.length} UFs`}
                </span>
              </div>
              {/* Listado de UFs cuando tiene más de 1 */}
              {ufs.length > 1 && (
                <div style={{ display:'flex', gap:4, marginTop:4, flexWrap:'wrap' }}>
                  {ufs.map(uf => (
                    <span key={uf.id} style={{
                      fontSize:10, padding:'1px 7px', borderRadius:10,
                      background:'#e0e7ff', color:'#3730a3', fontWeight:600
                    }}>
                      UF {uf.numero}{uf.tipo ? ` · ${uf.tipo}` : ''}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize:12, color:GR, marginTop:3, display:'flex', gap:14, flexWrap:'wrap' }}>
                {cp.dni && <span>🪪 {cp.dni}</span>}
                {cp.telefono && <span>📱 {cp.telefono}</span>}
                {cp.email && <span>✉ {cp.email}</span>}
                {cp.nombre_ocupante && <span style={{ color:'#7c3aed' }}>🏠 Ocup: {cp.nombre_ocupante}</span>}
                {cp.cuit_cuil && <span>🏛 CUIT: {cp.cuit_cuil}</span>}
              </div>
            </div>
            <div style={{ display:'flex', gap:6, marginLeft:8, flexShrink:0 }}>
              {cp.telefono && <Btn small color='#25d366' onClick={() => window.open(`https://wa.me/549${(()=>{let n=(cp.telefono||'').replace(/\D/g,'');if(n.startsWith('549'))return n;if(n.startsWith('54'))return '9'+n.slice(2);if(n.startsWith('0'))n=n.slice(1);return n})()}`)}>WhatsApp</Btn>}
              <Btn small onClick={() => { setForm({...cp}); setTabForm('principal') }} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
              <Btn small onClick={() => eliminar(cp.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
            </div>
          </Card>
          )
        })}
        {lista.length===0 && <Card style={{ textAlign:'center', color:GR, padding:32 }}>No hay copropietarios registrados.</Card>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. EXPENSAS
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN DE PERÍODO — crear, distribuir y cerrar expensas
// Basado en el flujo de Administración Global
// ══════════════════════════════════════════════════════════════════════════════
