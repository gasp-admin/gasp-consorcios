// modules — PerfilAdmin.jsx
// Extraído del V59. Props → useApp().
// v2: uploader de sello/firma a Supabase Storage (bucket público 'perfil-assets').
//     Sube el archivo, guarda la URL pública (corta) en sello_url/firma_url.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function PerfilAdmin() {
  const { session, consorcioActivo} = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [perfil, setPerfil] = useState({ nombre:'', telefono:'', matricula_rpac:'', email:'', direccion:'', horario:'', cuit:'', situacion_fiscal:'Monotributo', firma_url:'', sello_url:'', texto_encabezado_liquidacion:'', texto_pie_liquidacion:'' })
  const [guardando, setGuardando] = useState(false)
  const [cargando, setCargando]   = useState(true)
  const [msg, setMsg]             = useState(null)
  const [tabActiva, setTabActiva] = useState('datos')
  const [subiendo, setSubiendo]   = useState(null) // 'sello' | 'firma' | null
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [cambiandoPass, setCambiandoPass] = useState(false)
  const [msgPass, setMsgPass] = useState(null)

  async function cambiarPassword() {
    if (!pass1 || pass1.length < 6) return setMsgPass({ tipo:'warn', texto:'La contraseña debe tener al menos 6 caracteres' })
    if (pass1 !== pass2)            return setMsgPass({ tipo:'warn', texto:'Las contraseñas no coinciden' })
    setCambiandoPass(true); setMsgPass(null)
    const { error } = await supabase.auth.updateUser({ password: pass1 })
    if (error) setMsgPass({ tipo:'error', texto: 'No se pudo cambiar: ' + error.message })
    else { setMsgPass({ tipo:'ok', texto: 'Contraseña actualizada correctamente' }); setPass1(''); setPass2('') }
    setCambiandoPass(false)
  }
  const selloRef = useRef(null)
  const firmaRef = useRef(null)

  useEffect(() => {
    if (!uid) return
    async function cargar() {
      const { data } = await supabase.from('con_admin_perfil').select('*').eq('admin_id',uid).single()
      if (data) setPerfil({...data, email:data.email||session?.user?.email||''})
      else setPerfil(p=>({...p, email:session?.user?.email||''}))
      setCargando(false)
    }
    cargar()
  }, [session])

  async function guardar() {
    setGuardando(true)
    const { error } = await supabase.from('con_admin_perfil').upsert({ admin_id:uid, ...perfil, updated_at:new Date().toISOString() }, { onConflict:'admin_id' })
    if (error) setMsg({ tipo:'error', texto:error.message })
    else setMsg({ tipo:'ok', texto:'✓ Perfil guardado correctamente' })
    setGuardando(false)
  }

  // Sube una imagen (sello/firma) a Storage y guarda su URL pública en el perfil.
  async function subirImagen(file, tipo) {
    if (!file) return
    if (!file.type.startsWith('image/')) return setMsg({ tipo:'error', texto:'El archivo debe ser una imagen (PNG, JPG o WebP).' })
    if (file.size > 5 * 1024 * 1024) return setMsg({ tipo:'error', texto:'La imagen no debe superar los 5 MB.' })
    setSubiendo(tipo)
    try {
      const path = `${uid}/${tipo}`  // una sola imagen por tipo; se sobrescribe en cada subida
      const { error } = await supabase.storage.from('perfil-assets')
        .upload(path, file, { upsert:true, contentType:file.type, cacheControl:'3600' })
      if (error) throw error
      const { data } = supabase.storage.from('perfil-assets').getPublicUrl(path)
      const url = `${data.publicUrl}?t=${Date.now()}`  // cache-bust para ver la nueva al instante
      P({ [`${tipo}_url`]: url })
      setMsg({ tipo:'ok', texto:`✓ ${tipo === 'sello' ? 'Sello' : 'Firma'} subido. Tocá "Guardar configuración PDF" para conservarlo.` })
    } catch (e) {
      setMsg({ tipo:'error', texto:'Error al subir la imagen: ' + (e.message || e) })
    }
    setSubiendo(null)
  }

  const P = f => setPerfil(p=>({...p,...f}))
  if (cargando) return <div style={{ textAlign:'center', color:GR, padding:40 }}>Cargando...</div>

  const tabs = [
    { id:'datos', label:'Datos personales' },
    { id:'pdf', label:'PDF de liquidación' },
  ]

  return (
    <div style={{ maxWidth:640 }}>
      <div style={{ fontWeight:700, fontSize:16, color:'#111827', marginBottom:16 }}>⚙️ Mi perfil de administrador</div>
      <Msg data={msg} />

      {/* Alerta si el perfil está vacío */}
      {!perfil.nombre && (
        <div style={{ background:'#fff3cd', border:'1px solid #ffc107', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:13, color:'#856404' }}>
          ⚠️ <strong>Perfil incompleto.</strong> El nombre y los datos del administrador aparecerán en el PDF de liquidación. Completá el perfil antes de generar liquidaciones.
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'2px solid #e5e7eb' }}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTabActiva(t.id)}
            style={{ padding:'8px 18px', border:'none', background:'none', cursor:'pointer', fontSize:13, fontWeight:tabActiva===t.id?700:400, color:tabActiva===t.id?AZ:GR, borderBottom:tabActiva===t.id?`2px solid ${AZ}`:'2px solid transparent', marginBottom:-2 }}>
            {t.label}
          </button>
        ))}
      </div>

      {tabActiva === 'datos' && (
        <Card style={{ marginBottom:16 }}>
          <div style={{ fontWeight:600, color:AZ, marginBottom:14, fontSize:13 }}>Datos personales y profesionales</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
            <Input label="Nombre completo" value={perfil.nombre||''} onChange={v=>P({nombre:v})} placeholder="Javier García Pérez" />
            <Input label="Email" value={perfil.email||''} onChange={v=>P({email:v})} />
            <Input label="Teléfono" value={perfil.telefono||''} onChange={v=>P({telefono:v})} placeholder="02267 444034" />
            <Input label="Matrícula RPAC" value={perfil.matricula_rpac||''} onChange={v=>P({matricula_rpac:v})} placeholder="83" />
            <Input label="CUIT" value={perfil.cuit||''} onChange={v=>P({cuit:v})} placeholder="20186006802" />
            <Sel label="Situación fiscal" value={perfil.situacion_fiscal||'Monotributo'} onChange={v=>P({situacion_fiscal:v})} opts={['Monotributo','Responsable Inscripto','Exento']} />
            <div style={{ gridColumn:'span 2' }}><Input label="Dirección de oficina" value={perfil.direccion||''} onChange={v=>P({direccion:v})} placeholder="Lenguado 1313 - Local 3" /></div>
            <div style={{ gridColumn:'span 2' }}><Input label="Horario de atención" value={perfil.horario||''} onChange={v=>P({horario:v})} placeholder="Lunes a Sábados 9:00 a 13:00 hs" /></div>
          </div>
          <Btn onClick={guardar} disabled={guardando}>{guardando?'Guardando...':'💾 Guardar perfil'}</Btn>
        </Card>
      )}

      {tabActiva === 'pdf' && (
        <Card style={{ marginBottom:16 }}>
          <div style={{ fontWeight:600, color:AZ, marginBottom:14, fontSize:13 }}>Configuración del PDF de liquidación</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
            <div style={{ gridColumn:'span 2' }}>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Texto de encabezado (aparece arriba, debajo del logo)</div>
              <textarea value={perfil.texto_encabezado_liquidacion||''} onChange={e=>P({texto_encabezado_liquidacion:e.target.value})}
                rows={3} placeholder="Ej: Período de liquidación correspondiente al mes de..."
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
            </div>
            <div style={{ gridColumn:'span 2' }}>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Texto de pie de página (aparece al final del PDF)</div>
              <textarea value={perfil.texto_pie_liquidacion||''} onChange={e=>P({texto_pie_liquidacion:e.target.value})}
                rows={3} placeholder="Ej: Atención: Los pagos realizados fuera de término..."
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
            </div>

            {/* FIRMA */}
            <div style={{ gridColumn:'span 2' }}>
              <Input label="Firma digital (imagen PNG/JPG, fondo transparente)" value={perfil.firma_url||''} onChange={v=>P({firma_url:v})} placeholder="Subí un archivo o pegá una URL directa https://..." />
              <input ref={firmaRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display:'none' }}
                onChange={e=>{ const f=e.target.files?.[0]; e.target.value=''; subirImagen(f,'firma') }} />
              <div style={{ marginTop:8 }}>
                <Btn small color={VD} onClick={()=>firmaRef.current?.click()} disabled={subiendo==='firma'}>
                  {subiendo==='firma' ? 'Subiendo...' : '📤 Subir imagen de firma'}
                </Btn>
              </div>
              {perfil.firma_url && <img src={perfil.firma_url} alt="Firma" style={{ marginTop:8, maxHeight:60, maxWidth:200, border:'1px solid #e5e7eb', borderRadius:6 }} onError={e=>e.target.style.display='none'} />}
            </div>

            {/* SELLO */}
            <div style={{ gridColumn:'span 2' }}>
              <Input label="Sello / logo (imagen PNG/JPG, fondo transparente)" value={perfil.sello_url||''} onChange={v=>P({sello_url:v})} placeholder="Subí un archivo o pegá una URL directa https://..." />
              <input ref={selloRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display:'none' }}
                onChange={e=>{ const f=e.target.files?.[0]; e.target.value=''; subirImagen(f,'sello') }} />
              <div style={{ marginTop:8 }}>
                <Btn small color={VD} onClick={()=>selloRef.current?.click()} disabled={subiendo==='sello'}>
                  {subiendo==='sello' ? 'Subiendo...' : '📤 Subir imagen de sello/logo'}
                </Btn>
              </div>
              {perfil.sello_url && <img src={perfil.sello_url} alt="Sello" style={{ marginTop:8, maxHeight:60, maxWidth:200, border:'1px solid #e5e7eb', borderRadius:6 }} onError={e=>e.target.style.display='none'} />}
            </div>
          </div>
          <div style={{ fontSize:11, color:GR, marginBottom:12, background:'#f9fafb', padding:'8px 12px', borderRadius:6 }}>
            💡 Lo más simple es <strong>subir la imagen</strong> con el botón (se guarda en el sistema y queda una URL corta). Si preferís, también podés pegar una URL de imagen <strong>directa</strong> (ej. de <a href="https://imgbb.com" target="_blank" rel="noreferrer" style={{ color:AZ }}>ImgBB</a>). Evitá pegar links de Google Drive del tipo <code>/file/…</code>: no cargan como imagen. Si dejás el sello vacío, el PDF usa el logo por defecto de la administración.
          </div>
          <Btn onClick={guardar} disabled={guardando}>{guardando?'Guardando...':'💾 Guardar configuración PDF'}</Btn>
        </Card>
      )}

      <Card style={{ marginBottom:16 }}>
        <div style={{ fontSize:13, color:AZ, marginBottom:12, fontWeight:600 }}>🔒 Cambiar contraseña</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
          <Input label="Nueva contraseña" type="password" value={pass1} onChange={setPass1} placeholder="Mínimo 6 caracteres" />
          <Input label="Repetir contraseña" type="password" value={pass2} onChange={setPass2} placeholder="Repetir" />
        </div>
        {msgPass && <div style={{ fontSize:12, marginBottom:10, fontWeight:500, color: msgPass.tipo==='ok'?'#15803d':(msgPass.tipo==='error'?'#B91C1C':'#92400e') }}>{msgPass.texto}</div>}
        <Btn onClick={cambiarPassword} disabled={cambiandoPass || !pass1 || !pass2}>{cambiandoPass?'Cambiando...':'Cambiar contraseña'}</Btn>
      </Card>

      <Card>
        <div style={{ fontSize:13, color:'#6b7280', marginBottom:8, fontWeight:600 }}>Sesión activa</div>
        <div style={{ fontSize:13, color:'#374151', marginBottom:10 }}>{session?.user?.email}</div>
        <Btn color='#991B1B' small onClick={async()=>{ await supabase.auth.signOut() }}>Cerrar sesión</Btn>
      </Card>
    </div>
  )
}
