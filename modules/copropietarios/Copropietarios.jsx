// modules — Copropietarios.jsx
// Extraído del V59. Refactorizado: props → useApp(). Cero cambios de comportamiento.
// 2026-10-17: Ocupante POR UF. La solapa "Ocupante / Inquilino" edita con_unidades.ocupante_*
//   (una ficha por cada UF del propietario) + flags ocupante_recibe_liquidacion / ocupante_recibe_avisos
//   que leen enviar-liquidacion v13 y enviar-notificacion v10 (BCC informativo).
//   Los campos viejos con_copropietarios.*_ocupante quedan solo lectura ("dato anterior").

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

// Nro real de UF (nro_uf_pdf) como entero, igual que en la liquidación. Fallback al crudo.
function ufNum(u) {
  const n = parseInt(u?.nro_uf_pdf, 10)
  return isNaN(n) ? (u?.nro_uf_pdf ?? '—') : n
}

export default function Copropietarios() {
  const { session, consorcioActivo, copropietarios, setCopropietarios, unidades, setUnidades, expensas, puede } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [lista, setLista] = useState([])
  const [ufsMap, setUfsMap] = useState({}) // propietario_id → [{numero, id}]
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const [tabForm, setTabForm] = useState('principal')
  const [busqueda, setBusqueda] = useState('')
  const [ocup, setOcup] = useState({}) // unidad_id → { ocupante_* } (edición por UF)
  const F = f => setForm(x => ({ ...x, ...f }))
  const FO = (ufId, f) => setOcup(x => ({ ...x, [ufId]: { ...(x[ufId] || {}), ...f } }))
  const OCUP_KEYS = ['ocupante_nombre', 'ocupante_email', 'ocupante_telefono', 'ocupante_recibe_liquidacion', 'ocupante_recibe_avisos']
  const ocupDe = uf => Object.fromEntries(OCUP_KEYS.map(k => [k, k.startsWith('ocupante_recibe') ? !!uf?.[k] : (uf?.[k] || '')]))

  function abrirForm(cp) {
    setForm(cp ? { ...cp } : {})
    setTabForm('principal')
    const m = {}
    for (const uf of (cp ? (ufsMap[cp.id] || []) : [])) m[uf.id] = ocupDe(uf)
    setOcup(m)
  }

  async function cargar() {
    const [{ data: cpData }, { data: ufData }] = await Promise.all([
      supabase.from('con_copropietarios').select('*')
        .eq('admin_id', uid).eq('consorcio_id', consorcioId).order('apellido_nombre'),
      supabase.from('con_unidades').select('id, numero, propietario_id, tipo, piso, nro_uf_pdf, ' + OCUP_KEYS.join(', '))
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
    if (!puede('editar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite editar datos.' })
    if (!form.apellido_nombre) return setMsg({ tipo:'warn', texto:'Nombre obligatorio' })
// IDs únicos (2026-09-25): antes nextId() generaba 'EXP001'/'UF001'/'CP001'/'PRV001' contando solo la lista visible;
// junto con upsert(onConflict:'id') pisó la liquidación de Agosto de Dorado 1056 con la de Septiembre de Triplex Náyades (§51).
    const id = form.id || `CP-${consorcioId}-${Date.now()}`
    const { error } = await supabase.from('con_copropietarios').upsert(
      { ...form, id, admin_id:uid, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:error.message })

    // Ocupante por UF: solo las UF de este propietario cuyo dato cambió
    const ufsProp = form.id ? (ufsMap[form.id] || []) : []
    const cambios = ufsProp
      .map(uf => ({ uf, nuevo: ocup[uf.id] }))
      .filter(({ uf, nuevo }) => nuevo && OCUP_KEYS.some(k => ocupDe(uf)[k] !== nuevo[k]))
    for (const { uf, nuevo } of cambios) {
      const payload = {
        ocupante_nombre:   (nuevo.ocupante_nombre || '').trim() || null,
        ocupante_email:    (nuevo.ocupante_email || '').trim() || null,
        ocupante_telefono: (nuevo.ocupante_telefono || '').trim() || null,
        ocupante_recibe_liquidacion: !!nuevo.ocupante_recibe_liquidacion,
        ocupante_recibe_avisos:      !!nuevo.ocupante_recibe_avisos,
      }
      const { error: eUf } = await supabase.from('con_unidades').update(payload)
        .eq('id', uf.id).eq('consorcio_id', consorcioId)
      if (eUf) return setMsg({ tipo:'error', texto:`Propietario guardado, pero falló el ocupante de UF ${uf.numero}: ${eUf.message}` })
      // Mantener sincronizado el contexto (lo usan las pantallas de envío)
      if (setUnidades) setUnidades(prev => (prev || []).map(u => u.id === uf.id ? { ...u, ...payload } : u))
    }
    setForm(null); setOcup({}); setMsg({ tipo:'ok', texto: cambios.length ? `✓ Guardado (ocupante actualizado en ${cambios.length} UF)` : '✓ Guardado' }); cargar()
  }
  async function eliminar(id) {
    if (!puede('editar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite editar datos.' })
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
          : ufs.map(u => `UF ${ufNum(u)} · ${u.numero}${u.tipo ? ' · ' + u.tipo : ''}`).join(', ')
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
          ufs:      ufs.map(u => `UF ${ufNum(u)} · ${u.numero}`).join(' / ') || '—',
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
        <Btn onClick={() => abrirForm(null)}>+ Agregar</Btn>
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

          {tabForm==='ocupante' && (() => {
            const ufsProp = form.id ? (ufsMap[form.id] || []) : []
            const legado = [form.nombre_ocupante, form.email_ocupante, form.telefono_ocupante].filter(x => (x || '').trim())
            return (
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:12, background:'#f0f9ff', padding:'8px 12px', borderRadius:6, lineHeight:1.5 }}>
                El ocupante se carga <strong>por unidad</strong>. Si tilda las casillas, recibe una <strong>copia informativa</strong> (en copia oculta) de la liquidación — con el link al portal de esa UF — y/o de las notificaciones.
                Las convocatorias a asamblea y las votaciones se dirigen solo al propietario.
              </div>

              {legado.length > 0 && (
                <div style={{ fontSize:12, marginBottom:12, background:'#fffbeb', border:'1px solid #fde68a', padding:'8px 12px', borderRadius:6, color:'#92400e' }}>
                  <strong>Dato anterior (cargado por propietario, no se usa para envíos):</strong> {legado.join(' · ')}
                  {ufsProp.length > 0 && <div style={{ marginTop:4 }}>Use “Copiar dato anterior” en la UF que corresponda.</div>}
                </div>
              )}

              {!form.id && (
                <div style={{ fontSize:12, color:GR, marginBottom:12 }}>Guarde primero el copropietario y asígnele la unidad desde <strong>Unidades</strong>; luego podrá cargar el ocupante de cada UF.</div>
              )}
              {form.id && ufsProp.length === 0 && (
                <div style={{ fontSize:12, color:GR, marginBottom:12 }}>Este copropietario no tiene unidades asignadas.</div>
              )}

              {ufsProp.map(uf => {
                const o = ocup[uf.id] || ocupDe(uf)
                const idL = `ocl-${uf.id}`, idA = `oca-${uf.id}`
                return (
                  <div key={uf.id} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:12, marginBottom:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, gap:8, flexWrap:'wrap' }}>
                      <div style={{ fontWeight:700, fontSize:13, color:AZ }}>UF {ufNum(uf)} · {uf.numero}{uf.tipo ? ` · ${uf.tipo}` : ''}</div>
                      {legado.length > 0 && (
                        <button type="button" onClick={() => FO(uf.id, {
                            ocupante_nombre:   form.nombre_ocupante || '',
                            ocupante_email:    form.email_ocupante || '',
                            ocupante_telefono: form.telefono_ocupante || '' })}
                          style={{ fontSize:11, padding:'3px 8px', border:'1px solid #fde68a', background:'#fffbeb', color:'#92400e', borderRadius:6, cursor:'pointer' }}>
                          Copiar dato anterior
                        </button>
                      )}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:8 }}>
                      <div style={{ gridColumn:'span 2' }}><Input label="Nombre del ocupante / inquilino" value={o.ocupante_nombre} onChange={v=>FO(uf.id,{ocupante_nombre:v})} /></div>
                      <Input label="Email(s) del ocupante (separe con ;)" value={o.ocupante_email} onChange={v=>FO(uf.id,{ocupante_email:v})} />
                      <Input label="Teléfono del ocupante" value={o.ocupante_telefono} onChange={v=>FO(uf.id,{ocupante_telefono:v})} />
                    </div>
                    <div style={{ display:'flex', gap:18, flexWrap:'wrap', fontSize:12 }}>
                      <label htmlFor={idL} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                        <input id={idL} type="checkbox" checked={!!o.ocupante_recibe_liquidacion} onChange={e=>FO(uf.id,{ocupante_recibe_liquidacion:e.target.checked})} />
                        Recibe copia de la liquidación
                      </label>
                      <label htmlFor={idA} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                        <input id={idA} type="checkbox" checked={!!o.ocupante_recibe_avisos} onChange={e=>FO(uf.id,{ocupante_recibe_avisos:e.target.checked})} />
                        Recibe copia de notificaciones
                      </label>
                    </div>
                    {(o.ocupante_recibe_liquidacion || o.ocupante_recibe_avisos) && !(o.ocupante_email || '').trim() && (
                      <div style={{ fontSize:11, color:RJ, marginTop:6 }}>Tildó envío pero no cargó email: no se enviará nada al ocupante.</div>
                    )}
                  </div>
                )
              })}
            </div>
            )
          })()}

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
                  {ufs.length === 0 ? 'Sin UF asignada' : ufs.length === 1 ? `UF ${ufNum(ufs[0])} · ${ufs[0].numero}` : `${ufs.length} UFs`}
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
                      UF {ufNum(uf)} · {uf.numero}{uf.tipo ? ` · ${uf.tipo}` : ''}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize:12, color:GR, marginTop:3, display:'flex', gap:14, flexWrap:'wrap' }}>
                {cp.dni && <span>🪪 {cp.dni}</span>}
                {cp.telefono && <span>📱 {cp.telefono}</span>}
                {cp.email && <span>✉ {cp.email}</span>}
                {ufs.filter(u => u.ocupante_nombre || u.ocupante_email).map(u => (
                  <span key={'oc'+u.id} style={{ color:'#7c3aed' }}>
                    🏠 {ufs.length > 1 ? `UF ${ufNum(u)}: ` : ''}{u.ocupante_nombre || u.ocupante_email}
                    {(u.ocupante_recibe_liquidacion || u.ocupante_recibe_avisos) ? ' ✉' : ''}
                  </span>
                ))}
                {cp.cuit_cuil && <span>🏛 CUIT: {cp.cuit_cuil}</span>}
              </div>
            </div>
            <div style={{ display:'flex', gap:6, marginLeft:8, flexShrink:0 }}>
              {cp.telefono && <Btn small color='#25d366' onClick={() => window.open(`https://wa.me/549${(()=>{let n=(cp.telefono||'').replace(/\D/g,'');if(n.startsWith('549'))return n;if(n.startsWith('54'))return '9'+n.slice(2);if(n.startsWith('0'))n=n.slice(1);return n})()}`)}>WhatsApp</Btn>}
              <Btn small onClick={() => abrirForm(cp)} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
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
