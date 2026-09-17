// modules — EnviarNotificacion.jsx
// Extraído del V59. Props → useApp().

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, SUPA_KEY, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, enviarNotificacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function EnviarNotificacion() {
  const { session, consorcioActivo, unidades, copropietarios, adminPerfil, puede } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [asunto, setAsunto]       = useState('')
  const [cuerpo, setCuerpo]       = useState('')
  const [selUFs, setSelUFs]       = useState([])   // IDs seleccionadas; vacío = todas
  const [todos, setTodos]         = useState(true)
  const [inclDrive, setInclDrive] = useState(false)
  const [adjuntos, setAdjuntos]   = useState([])    // [{ nombre, tipo, base64, size }]
  const [testEmail, setTestEmail] = useState('')
  const [enviando, setEnviando]   = useState(false)
  const [msg, setMsg]             = useState(null)
  const [resultado, setResultado] = useState(null)
  const [avisarWa, setAvisarWa]   = useState(false)
  const [telWaPrueba, setTelWaPrueba] = useState('')

  const driveFolderUrl = consorcioActivo?.drive_folder_url || null
  const ufsConEmail = unidades.filter(u => {
    const cp = copropietarios.find(c => c.id === u.propietario_id)
    return cp?.email || cp?.email_notificacion
  })

  const MAX_ADJ_FILE  = 4 * 1024 * 1024      // 4 MB por archivo
  const MAX_ADJ_TOTAL = 15 * 1024 * 1024     // 15 MB en total (todos los adjuntos)

  const leerB64 = (file) => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })

  async function cargarAdjuntos(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    let total = adjuntos.reduce((acc, a) => acc + (a.size || 0), 0)
    const nuevos = []
    for (const file of files) {
      if (file.size > MAX_ADJ_FILE) {
        setMsg({ tipo:'warn', texto:`"${file.name}" supera 4 MB y se omitió` }); continue
      }
      if (adjuntos.some(a => a.nombre === file.name) || nuevos.some(a => a.nombre === file.name)) {
        setMsg({ tipo:'warn', texto:`"${file.name}" ya estaba agregado` }); continue
      }
      if (total + file.size > MAX_ADJ_TOTAL) {
        setMsg({ tipo:'warn', texto:'Se alcanzó el límite total de 15 MB; algunos archivos no se agregaron' }); break
      }
      const b64 = await leerB64(file)
      nuevos.push({ nombre: file.name, tipo: file.type, base64: b64, size: file.size })
      total += file.size
    }
    if (nuevos.length) setAdjuntos(prev => [...prev, ...nuevos])
  }

  const quitarAdjunto = (nombre) => setAdjuntos(prev => prev.filter(a => a.nombre !== nombre))

  async function enviar(esTest) {
    if (!puede('comunicar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite enviar comunicaciones.' })
    if (!asunto.trim()) return setMsg({ tipo:'warn', texto:'El asunto es requerido' })
    if (!cuerpo.trim())  return setMsg({ tipo:'warn', texto:'El cuerpo del mensaje es requerido' })
    if (esTest && !testEmail) return setMsg({ tipo:'warn', texto:'Ingresá el email de prueba' })
    if (!esTest) {
      const ufsTarget = todos ? ufsConEmail.length : selUFs.length
      if (ufsTarget === 0) return setMsg({ tipo:'warn', texto:'No hay unidades seleccionadas con email registrado' })
      if (!window.confirm(`¿Enviar la notificación a ${ufsTarget} ${todos?'unidades (todas)':'unidades seleccionadas'}?`)) return
    }

    setEnviando(true); setMsg(null); setResultado(null)
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      // En prueba se envía una sola muestra; en real: vacío = todas, o las UFs seleccionadas.
      const ufsEnvio = esTest
        ? (todos ? (ufsConEmail[0] ? [ufsConEmail[0].id] : []) : (selUFs[0] ? [selUFs[0]] : []))
        : (todos ? [] : selUFs)
      const payload = {
        admin_id:      uid,
        consorcio_id:  consorcioId,
        asunto:        asunto.trim(),
        cuerpo:        cuerpo.trim(),
        unidades_ids:  ufsEnvio,
        test_email:    esTest ? testEmail : undefined,
        adjuntos:      adjuntos.map(a => ({ nombre: a.nombre, tipo: a.tipo, base64: a.base64 })),
        drive_link:    (inclDrive && driveFolderUrl) ? driveFolderUrl : null,
      }
      const res  = await enviarNotificacion(payload, sess?.access_token)

      let msgWa = ''
      if (avisarWa) {
        if (esTest && !telWaPrueba.trim()) {
          msgWa = ' · 📱 WhatsApp: ingresá un teléfono de prueba'
        } else {
          try {
            const resWa = await fetch(`${SUPA_URL}/functions/v1/enviar-notificacion-wa`, {
              method: 'POST',
              headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${sess?.access_token}`, 'apikey': SUPA_KEY },
              body: JSON.stringify({ admin_id: uid, consorcio_id: consorcioId, cuerpo: cuerpo.trim(), test_telefono: esTest ? telWaPrueba.trim() : undefined, unidades_ids: ufsEnvio }),
            })
            const dataWa = await resWa.json()
            msgWa = dataWa.ok
              ? ` · 📱 WhatsApp: ${dataWa.enviados} enviados${dataWa.sinTel?`, ${dataWa.sinTel} sin tel`:''}${dataWa.errores?`, ${dataWa.errores} err`:''}`
              : ` · ⚠️ WhatsApp: ${dataWa.error}`
          } catch(ew) { msgWa = ` · ⚠️ WhatsApp falló: ${ew.message}` }
        }
      }
      setMsg({ tipo:'ok', texto: (esTest ? `✓ Notificación de prueba enviada a ${testEmail}` : '✓ Notificación enviada') + msgWa })
      setCuerpo(''); setAdjuntos([])
    } catch(e) {
      setMsg({ tipo:'error', texto: 'Error: ' + e.message })
    }
    setEnviando(false)
  }

  const totalSeleccionadas = todos ? ufsConEmail.length : selUFs.length

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>📣 Enviar notificación</div>
      <div style={{ fontSize:12, color:GR, marginBottom:20 }}>
        Comunicación libre a copropietarios — Permite adjuntar archivos y link de documentos del consorcio
      </div>

      <Msg data={msg} />

      {/* Destinatarios */}
      <Card style={{ marginBottom:14 }}>
        <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>👥 Destinatarios</div>
        <div style={{ display:'flex', gap:16, marginBottom:12 }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
            <input type="radio" checked={todos} onChange={()=>{ setTodos(true); setSelUFs([]) }} />
            <span>Todas las UFs con email ({ufsConEmail.length})</span>
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
            <input type="radio" checked={!todos} onChange={()=>setTodos(false)} />
            <span>Seleccionar UFs específicas</span>
          </label>
        </div>
        {!todos && (
          <div style={{ border:'1px solid #e5e7eb', borderRadius:8, maxHeight:220, overflowY:'auto', padding:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8, fontSize:12 }}>
              <span style={{ color:GR }}>{selUFs.length} seleccionadas</span>
              <div style={{ display:'flex', gap:8 }}>
                <button type="button" onClick={()=>setSelUFs(ufsConEmail.map(u=>u.id))}
                  style={{ fontSize:11, color:AZ, background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
                  Todas
                </button>
                <button type="button" onClick={()=>setSelUFs([])}
                  style={{ fontSize:11, color:GR, background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
                  Ninguna
                </button>
              </div>
            </div>
            {ufsConEmail.map(u => {
              const cp = copropietarios.find(c => c.id === u.propietario_id)
              const checked = selUFs.includes(u.id)
              return (
                <label key={u.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 6px',
                  borderRadius:6, cursor:'pointer', background: checked ? '#f0f4ff' : 'transparent' }}>
                  <input type="checkbox" checked={checked}
                    onChange={e => setSelUFs(prev => e.target.checked ? [...prev, u.id] : prev.filter(x=>x!==u.id))} />
                  <span style={{ fontSize:12, flex:1 }}>
                    <strong>UF {u.numero}</strong> {u.piso?`· Piso ${u.piso}`:''} — {cp?.apellido_nombre||'Sin propietario'}
                  </span>
                  <span style={{ fontSize:10, color:GR }}>{cp?.email_notificacion||cp?.email||''}</span>
                </label>
              )
            })}
          </div>
        )}
      </Card>

      {/* Asunto y cuerpo */}
      <Card style={{ marginBottom:14 }}>
        <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>✍️ Mensaje</div>
        <Input label="Asunto" value={asunto} onChange={setAsunto}
          placeholder="Ej: Convocatoria a Asamblea Ordinaria — Junio 2026" />
        <div style={{ marginTop:12 }}>
          <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Cuerpo del mensaje</div>
          <textarea value={cuerpo} onChange={e=>setCuerpo(e.target.value)}
            placeholder="Estimados propietarios:&#10;&#10;Por medio del presente los convocamos a la Asamblea..."
            rows={8}
            style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:7,
              fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box', lineHeight:1.6 }} />
          <div style={{ fontSize:11, color:GR, marginTop:4 }}>
            Los saltos de línea se conservan en el email. No usar HTML.
          </div>
        </div>
      </Card>

      {/* Opciones adicionales */}
      <Card style={{ marginBottom:14 }}>
        <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>📎 Opciones adicionales</div>

        {/* Adjuntos (múltiples) */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, color:GR, fontWeight:500, marginBottom:6 }}>Archivos adjuntos (opcional, máx. 4 MB c/u · 15 MB total)</div>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <input type="file" id="notif-adjunto" multiple
              onChange={e => { cargarAdjuntos(e.target.files); e.target.value='' }}
              style={{ display:'none' }} />
            <button type="button"
              onClick={() => document.getElementById('notif-adjunto').click()}
              style={{ padding:'7px 14px', background:'#f3f4f6', color:'#374151', border:'1px solid #d1d5db',
                borderRadius:7, fontSize:12.5, fontWeight:600, cursor:'pointer' }}>
              📎 Agregar archivos
            </button>
            {adjuntos.length === 0 && <span style={{ fontSize:11, color:GR }}>Sin adjuntos</span>}
          </div>
          {adjuntos.length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:10 }}>
              {adjuntos.map(a => (
                <div key={a.nombre} style={{ display:'flex', alignItems:'center', gap:8, background:'#f0fdf4',
                  border:'1px solid #bbf7d0', borderRadius:7, padding:'6px 12px', fontSize:12 }}>
                  <span>✓ {a.nombre}{a.size ? ` · ${(a.size/1024/1024).toFixed(1)} MB` : ''}</span>
                  <button type="button" onClick={()=>quitarAdjunto(a.nombre)}
                    style={{ background:'none', border:'none', color:RJ, cursor:'pointer', fontWeight:700, fontSize:14 }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Link Drive */}
        {driveFolderUrl && (
          <div>
            <label style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer' }}>
              <input type="checkbox" checked={inclDrive} onChange={e=>setInclDrive(e.target.checked)}
                style={{ marginTop:2 }} />
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'#14532d' }}>
                  📁 Incluir link a la carpeta de documentos del consorcio (Google Drive)
                </div>
                <div style={{ fontSize:11, color:'#166534', marginTop:2 }}>
                  {driveFolderUrl.length > 60 ? driveFolderUrl.slice(0,60)+'…' : driveFolderUrl}
                </div>
              </div>
            </label>
          </div>
        )}
        {!driveFolderUrl && (
          <div style={{ fontSize:12, color:GR, fontStyle:'italic' }}>
            Sin carpeta Drive configurada para este consorcio. Configurar en Mis Consorcios → Editar.
          </div>
        )}
      </Card>

      {/* Email de prueba + envío */}
      <Card style={{ background:'#f0f4ff', border:'1px solid #bfdbfe', marginBottom:14 }}>
        <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:10 }}>Resumen del envío</div>
        <div style={{ fontSize:13, color:'#374151', marginBottom:14, lineHeight:1.7 }}>
          <div>📬 Destinatarios: <strong>{totalSeleccionadas} unidades</strong>{todos?' (todas)':''}</div>
          {adjuntos.length > 0 && <div>📎 Adjunto{adjuntos.length>1?'s':''} ({adjuntos.length}): <strong>{adjuntos.map(a=>a.nombre).join(', ')}</strong></div>}
          {inclDrive && driveFolderUrl && <div>📁 Se incluirá el link a Drive del consorcio</div>}
        </div>

        <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'12px 14px', marginBottom:12 }}>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontWeight:600, fontSize:13, color:'#166534' }}>
            <input type="checkbox" checked={avisarWa} onChange={e=>setAvisarWa(e.target.checked)} />
            📱 Avisar también por WhatsApp
          </label>
          <div style={{ fontSize:11, color:'#166534', marginTop:6 }}>
            Envía el cuerpo de la notificación por WhatsApp (template "aviso_general") a las UF con teléfono — respeta la selección de arriba. Las UF sin teléfono se saltean.
          </div>
          {avisarWa && (
            <input value={telWaPrueba} onChange={e=>setTelWaPrueba(e.target.value)}
              placeholder="Teléfono de prueba (ej. 5492254614043) — solo para Test"
              style={{ width:'100%', marginTop:8, padding:'8px 11px', border:'1px solid #86efac', borderRadius:7, fontSize:12.5, boxSizing:'border-box' }} />
          )}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:10, marginBottom:10, alignItems:'end' }}>
          <Input label="Email de prueba (enviar solo a este email primero)"
            value={testEmail} onChange={setTestEmail}
            placeholder="test@correo.com" type="email" />
          <Btn onClick={()=>enviar(true)} disabled={enviando||!testEmail}
            style={{ background:'#374151', opacity:(enviando||!testEmail)?0.5:1, whiteSpace:'nowrap' }}>
            ✉ Test
          </Btn>
        </div>
        <Btn onClick={()=>enviar(false)} disabled={enviando||!asunto||!cuerpo||totalSeleccionadas===0}
          style={{ width:'100%', opacity:(enviando||!asunto||!cuerpo||totalSeleccionadas===0)?0.5:1, fontSize:14, padding:'12px' }}>
          {enviando ? '⏳ Enviando...' : `📣 Enviar a ${totalSeleccionadas} unidad${totalSeleccionadas!==1?'es':''}`}
        </Btn>
      </Card>

      {/* Resultado */}
      {resultado && (
        <Card style={{ background: resultado.errores > 0 ? '#fff8f0' : '#f0fdf4',
          border: `1px solid ${resultado.errores > 0 ? '#fcd34d' : '#bbf7d0'}` }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:8 }}>Resultado del envío</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:10 }}>
            {[
              { l:'Enviados', v:resultado.enviados, c:VD },
              { l:'Sin email', v:resultado.sinEmail, c:GR },
              { l:'Errores', v:resultado.errores, c:RJ },
            ].map(({l,v,c}) => (
              <div key={l} style={{ textAlign:'center', background:'#fff', borderRadius:8, padding:'10px' }}>
                <div style={{ fontSize:22, fontWeight:800, color:c }}>{v}</div>
                <div style={{ fontSize:11, color:GR }}>{l}</div>
              </div>
            ))}
          </div>
          {resultado.ufs_enviadas?.length > 0 && (
            <div style={{ fontSize:11, color:GR }}>
              UFs enviadas: {resultado.ufs_enviadas.join(', ')}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
