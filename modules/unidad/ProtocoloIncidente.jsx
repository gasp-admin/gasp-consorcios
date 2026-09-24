// modules/unidad/ProtocoloIncidente.jsx
// F1 Incidentes y Protocolos (2026-09-23).
// Se monta dentro del detalle de un reclamo (Reclamos.jsx). Aplica un protocolo del catálogo
// (con_protocolos, GLOBAL + override por consorcio), genera el checklist (con_incidente_tareas),
// muestra contactos de emergencia (con_contactos_emergencia) y registra la bitácora en
// con_reclamos_seguimiento. Solo escribe en con_reclamos las columnas propias de F1
// (protocolo_codigo, nivel_riesgo, protocolo_aplicado_at, siniestro_seguro,
// fecha_limite_denuncia_seguro, fecha_denuncia_seguro, vence_notif_2067k). NO toca estado,
// categoria, prioridad ni es_emergencia.

import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { Card } from '../../components/ui'

const NIVELES = { rojo: { l: '🔴 Rojo', c: RJ, bg: '#fee2e2' }, amarillo: { l: '🟡 Amarillo', c: AM, bg: '#fff8e1' }, verde: { l: '🟢 Verde', c: VD, bg: '#dcfce7' } }
const RUBRO_LABEL = {
  emergencias: 'Emergencias', bomberos: 'Bomberos', medica: 'Emergencias médicas', municipal: 'Municipio',
  seguridad: 'Seguridad', gas_distribuidora: 'Distribuidora de gas', energia_agua: 'Luz / agua / cloaca',
  electrodependientes: 'Electrodependientes', administracion: 'Administración', gasista: 'Gasista matriculado',
  plomero: 'Plomero', electricista: 'Electricista matriculado', ascensor: 'Conservadora de ascensor',
  seguro: 'Aseguradora', letrado: 'Letrado del consorcio', otro: 'Otro',
}
const RUBROS_CONSORCIO = ['gasista', 'plomero', 'electricista', 'ascensor', 'seguro', 'letrado', 'otro']
const tramo = m => m === 0 ? 'Inmediato' : m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : m % 1440 === 0 && m >= 10080 ? `${m / 1440} días` : `${m / 60} h`
const telHref = t => 'tel:' + String(t || '').replace(/[^\d+]/g, '')
const waHref = w => 'https://wa.me/' + String(w || '').replace(/\D/g, '')
const pad = n => String(n).padStart(2, '0')
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const fmtDT = d => d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtD = d => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-AR') : '—'
function addBusinessDays(date, n) {
  const d = new Date(date); let k = 0
  while (k < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) k++ }
  return d
}
function restante(fechaLimite) {
  const ms = new Date(fechaLimite) - new Date()
  if (ms <= 0) return { txt: 'VENCIDO', c: RJ }
  const h = Math.floor(ms / 3600000)
  return { txt: h >= 48 ? `${Math.floor(h / 24)} días` : `${h} h ${Math.floor((ms % 3600000) / 60000)} min`, c: h < 24 ? RJ : AM }
}
const segId = () => 'seg_' + (crypto?.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2))

export default function ProtocoloIncidente({ reclamo, onUpdate }) {
  const { session, usuarioId, puede } = useApp()
  const adminId = session?.user?.id
  const puedeEditar = puede ? puede('editar') : true
  const cid = reclamo?.consorcio_id

  const [protocolos, setProtocolos] = useState([])
  const [contactos, setContactos]   = useState([])
  const [tareas, setTareas]         = useState([])
  const [bitacora, setBitacora]     = useState([])
  const [email, setEmail]           = useState('')
  const [sel, setSel]               = useState('')
  const [nivel, setNivel]           = useState('')
  const [conocido, setConocido]     = useState(toLocalInput(new Date()))
  const [verContactos, setVerContactos] = useState(false)
  const [nuevoCto, setNuevoCto]     = useState(null)
  const [msg, setMsg]               = useState(null)
  const [ocupado, setOcupado]       = useState(false)
  const [, setTick]                 = useState(0)

  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(t) }, [])
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setEmail(data?.user?.email || '')) }, [])

  async function cargar() {
    if (!reclamo?.id) return
    const [p, c, t, b] = await Promise.all([
      supabase.from('con_protocolos').select('*').in('consorcio_id', ['GLOBAL', cid]).eq('activo', true),
      supabase.from('con_contactos_emergencia').select('*').in('consorcio_id', ['GLOBAL', cid]).eq('activo', true).order('orden'),
      supabase.from('con_incidente_tareas').select('*').eq('reclamo_id', reclamo.id).order('paso_orden'),
      supabase.from('con_reclamos_seguimiento').select('*').eq('reclamo_id', reclamo.id).order('created_at', { ascending: false }).limit(50),
    ])
    const err = p.error || c.error || t.error || b.error
    if (err) setMsg({ tipo: 'error', texto: 'Error al cargar protocolo: ' + err.message })
    // Override por consorcio gana sobre GLOBAL (mismo codigo)
    const m = {}
    ;(p.data || []).forEach(x => { if (!m[x.codigo] || x.consorcio_id !== 'GLOBAL') m[x.codigo] = x })
    setProtocolos(Object.values(m).sort((a, b) => a.nombre.localeCompare(b.nombre)))
    setContactos(c.data || [])
    setTareas(t.data || [])
    setBitacora(b.data || [])
  }
  useEffect(() => { cargar() }, [reclamo?.id])

  const prot = protocolos.find(p => p.codigo === (reclamo?.protocolo_codigo || sel))
  const contactosDe = rubro => {
    const propios = contactos.filter(x => x.rubro === rubro && x.consorcio_id === cid)
    return propios.length ? propios : contactos.filter(x => x.rubro === rubro && x.consorcio_id === 'GLOBAL')
  }

  async function logSeg(tipo, contenido) {
    const { error } = await supabase.from('con_reclamos_seguimiento').insert([{
      id: segId(), reclamo_id: reclamo.id, admin_id: adminId, tipo, contenido, autor: email || 'admin',
    }])
    if (error) setMsg({ tipo: 'warn', texto: 'Acción hecha, pero no se pudo registrar en la bitácora: ' + error.message })
  }

  async function aplicar() {
    if (!puedeEditar) return setMsg({ tipo: 'warn', texto: 'Tu rol no permite aplicar protocolos.' })
    const p = protocolos.find(x => x.codigo === sel)
    if (!p) return setMsg({ tipo: 'warn', texto: 'Seleccioná un protocolo.' })
    const t0 = new Date(conocido)
    if (isNaN(t0)) return setMsg({ tipo: 'warn', texto: 'Fecha/hora de conocimiento inválida.' })
    if (!confirm(`¿Aplicar el protocolo "${p.nombre}" a este reclamo?\n\nSe genera el checklist de ${p.pasos.length} pasos.`)) return
    setOcupado(true); setMsg(null)
    const filas = (p.pasos || []).map(s => ({
      id: `TAR-${reclamo.id}-${s.orden}`, admin_id: adminId, reclamo_id: reclamo.id, consorcio_id: cid,
      protocolo_codigo: p.codigo, paso_orden: s.orden, minuto: s.minuto || 0, texto: s.texto,
      rubro: s.rubro || null, critico: !!s.critico,
    }))
    const { error: e1 } = await supabase.from('con_incidente_tareas').insert(filas)
    if (e1) { setOcupado(false); return setMsg({ tipo: 'error', texto: 'No se pudo generar el checklist: ' + e1.message }) }
    const campos = {
      protocolo_codigo: p.codigo, nivel_riesgo: nivel || p.nivel_default, protocolo_aplicado_at: t0.toISOString(),
      vence_notif_2067k: p.codigo === 'RECLAMO_JUDICIAL' ? addBusinessDays(t0, 2).toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    const { error: e2 } = await supabase.from('con_reclamos').update(campos).eq('id', reclamo.id)
    if (e2) {
      await supabase.from('con_incidente_tareas').delete().eq('reclamo_id', reclamo.id)
      setOcupado(false); return setMsg({ tipo: 'error', texto: 'No se pudo aplicar el protocolo: ' + e2.message })
    }
    await logSeg('protocolo', `Protocolo aplicado: ${p.nombre} (v${p.version}) · nivel ${campos.nivel_riesgo} · conocimiento ${fmtDT(t0)}`)
    onUpdate?.(campos)
    setOcupado(false); setMsg({ tipo: 'ok', texto: `✓ Protocolo "${p.nombre}" aplicado` }); cargar()
  }

  async function quitar() {
    if (tareas.some(t => t.hecho_at)) return setMsg({ tipo: 'warn', texto: 'Hay pasos cumplidos: no se puede quitar el protocolo.' })
    if (!confirm('¿Quitar el protocolo de este reclamo? Se borra el checklist (sin pasos cumplidos).')) return
    const { error: e1 } = await supabase.from('con_incidente_tareas').delete().eq('reclamo_id', reclamo.id)
    if (e1) return setMsg({ tipo: 'error', texto: e1.message })
    const campos = { protocolo_codigo: null, nivel_riesgo: null, protocolo_aplicado_at: null, vence_notif_2067k: null, updated_at: new Date().toISOString() }
    const { error: e2 } = await supabase.from('con_reclamos').update(campos).eq('id', reclamo.id)
    if (e2) return setMsg({ tipo: 'error', texto: e2.message })
    await logSeg('protocolo', `Protocolo quitado: ${prot?.nombre || reclamo.protocolo_codigo}`)
    onUpdate?.(campos); setSel(''); cargar()
  }

  async function toggleTarea(t) {
    if (!puedeEditar) return
    const hecho = !t.hecho_at
    const upd = hecho
      ? { hecho_at: new Date().toISOString(), hecho_por: usuarioId || adminId, hecho_por_email: email || null }
      : { hecho_at: null, hecho_por: null, hecho_por_email: null }
    const { error } = await supabase.from('con_incidente_tareas').update(upd).eq('id', t.id)
    if (error) return setMsg({ tipo: 'error', texto: 'No se pudo actualizar el paso: ' + error.message })
    await logSeg('tarea', `${hecho ? '✓' : '↺ Desmarcado'} Paso ${t.paso_orden}: ${t.texto.slice(0, 120)}`)
    cargar()
  }

  async function guardarNota(t, nota) {
    if ((t.nota || '') === nota) return
    const { error } = await supabase.from('con_incidente_tareas').update({ nota: nota || null }).eq('id', t.id)
    if (error) return setMsg({ tipo: 'error', texto: 'No se pudo guardar la nota: ' + error.message })
    await logSeg('nota', `Nota paso ${t.paso_orden}: ${nota}`)
    cargar()
  }

  async function setSeguro(on) {
    const base = reclamo.protocolo_aplicado_at ? new Date(reclamo.protocolo_aplicado_at) : new Date()
    const lim = new Date(base); lim.setDate(lim.getDate() + 3)
    const campos = on
      ? { siniestro_seguro: true, fecha_limite_denuncia_seguro: toLocalInput(lim).slice(0, 10) }
      : { siniestro_seguro: false, fecha_limite_denuncia_seguro: null }
    const { error } = await supabase.from('con_reclamos').update(campos).eq('id', reclamo.id)
    if (error) return setMsg({ tipo: 'error', texto: error.message })
    await logSeg('seguro', on ? `Siniestro con cobertura: denuncia al seguro vence ${fmtD(campos.fecha_limite_denuncia_seguro)} (art. 46 Ley 17.418)` : 'Marcado sin siniestro de seguro')
    onUpdate?.(campos); cargar()
  }

  async function setFechaDenuncia(v) {
    const { error } = await supabase.from('con_reclamos').update({ fecha_denuncia_seguro: v || null }).eq('id', reclamo.id)
    if (error) return setMsg({ tipo: 'error', texto: error.message })
    await logSeg('seguro', v ? `Denuncia al seguro realizada el ${fmtD(v)}` : 'Fecha de denuncia al seguro borrada')
    onUpdate?.({ fecha_denuncia_seguro: v || null }); cargar()
  }

  async function guardarContacto() {
    const c = nuevoCto
    if (!c?.nombre?.trim() || !(c.telefono?.trim() || c.whatsapp?.trim())) return setMsg({ tipo: 'warn', texto: 'Nombre y teléfono (o WhatsApp) son requeridos.' })
    const { error } = await supabase.from('con_contactos_emergencia').insert([{
      id: `CEM-${cid}-${Date.now()}`, admin_id: adminId, consorcio_id: cid, rubro: c.rubro, nombre: c.nombre.trim(),
      telefono: c.telefono?.trim() || null, whatsapp: c.whatsapp?.trim() || null, disponible_24h: !!c.h24,
      orden: contactos.filter(x => x.consorcio_id === cid && x.rubro === c.rubro).length + 1, notas: c.notas?.trim() || null,
    }])
    if (error) return setMsg({ tipo: 'error', texto: 'No se pudo guardar el contacto: ' + error.message })
    setMsg({ tipo: 'ok', texto: `✓ Contacto de ${RUBRO_LABEL[c.rubro]} cargado para este consorcio` })
    setNuevoCto(null); cargar()
  }

  // ── UI helpers ──
  const box = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }
  const lbl = { fontSize: 12, color: GR, marginBottom: 4 }
  const inp = { width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5, boxSizing: 'border-box' }
  const btn = (bg, dis) => ({ padding: '7px 14px', background: dis ? '#cbd5e1' : bg, color: '#fff', border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: dis ? 'default' : 'pointer' })
  const MsgBox = () => msg ? (
    <div style={{ fontSize: 12, padding: '7px 10px', borderRadius: 7, marginBottom: 10,
      background: msg.tipo === 'ok' ? '#dcfce7' : msg.tipo === 'error' ? '#fee2e2' : '#fff8e1',
      color: msg.tipo === 'ok' ? VD : msg.tipo === 'error' ? RJ : AM }}>{msg.texto}</div>) : null
  const Llamar = ({ c }) => (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginRight: 8 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{c.nombre}{c.disponible_24h ? ' · 24 h' : ''}</span>
      {c.telefono && <a href={telHref(c.telefono)} style={{ fontSize: 11.5, color: AZ, fontWeight: 700, textDecoration: 'none' }}>📞 {c.telefono}</a>}
      {c.telefono_alt && <a href={telHref(c.telefono_alt)} style={{ fontSize: 11.5, color: AZ, textDecoration: 'none' }}>📞 {c.telefono_alt}</a>}
      {c.whatsapp && <a href={waHref(c.whatsapp)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: VD, textDecoration: 'none' }}>💬 WA</a>}
    </span>
  )
  const FormContacto = () => (
    <div style={{ ...box, background: '#f8fafc', marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>+ Contacto de este consorcio</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><div style={lbl}>Rubro</div>
          <select value={nuevoCto.rubro} onChange={e => setNuevoCto(x => ({ ...x, rubro: e.target.value }))} style={inp}>
            {RUBROS_CONSORCIO.map(r => <option key={r} value={r}>{RUBRO_LABEL[r]}</option>)}
          </select></div>
        <div><div style={lbl}>Nombre / empresa</div>
          <input style={inp} value={nuevoCto.nombre || ''} onChange={e => setNuevoCto(x => ({ ...x, nombre: e.target.value }))} /></div>
        <div><div style={lbl}>Teléfono</div>
          <input style={inp} value={nuevoCto.telefono || ''} onChange={e => setNuevoCto(x => ({ ...x, telefono: e.target.value }))} /></div>
        <div><div style={lbl}>WhatsApp (549…)</div>
          <input style={inp} value={nuevoCto.whatsapp || ''} onChange={e => setNuevoCto(x => ({ ...x, whatsapp: e.target.value }))} /></div>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '8px 0' }}>
        <input type="checkbox" checked={!!nuevoCto.h24} onChange={e => setNuevoCto(x => ({ ...x, h24: e.target.checked }))} /> Atiende 24 h
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={btn(AZ)} onClick={guardarContacto}>Guardar</button>
        <button type="button" style={{ ...btn(GR), background: '#f3f4f6', color: GR }} onClick={() => setNuevoCto(null)}>Cancelar</button>
      </div>
    </div>
  )

  if (!reclamo) return null
  const aplicado = !!reclamo.protocolo_codigo
  const nivelR = NIVELES[reclamo.nivel_riesgo]
  const t0 = reclamo.protocolo_aplicado_at ? new Date(reclamo.protocolo_aplicado_at) : null
  const transcurrido = t0 ? (Date.now() - t0) / 60000 : 0
  const hechas = tareas.filter(t => t.hecho_at).length
  const criticasPend = tareas.filter(t => t.critico && !t.hecho_at).length

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, color: AZ }}>📋 Protocolo de actuación</div>
        <button type="button" onClick={() => setVerContactos(v => !v)}
          style={{ fontSize: 12, background: '#f3f4f6', border: 'none', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', color: GR, fontWeight: 600 }}>
          📞 Contactos de emergencia {verContactos ? '▲' : '▼'}
        </button>
      </div>
      <MsgBox />

      {verContactos && (
        <div style={{ ...box, marginBottom: 12 }}>
          {Object.keys(RUBRO_LABEL).map(r => {
            const cs = contactosDe(r)
            if (!cs.length) return null
            return (
              <div key={r} style={{ padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 10.5, color: GR, textTransform: 'uppercase', fontWeight: 700 }}>
                  {RUBRO_LABEL[r]}{cs[0].consorcio_id === cid ? ' · del consorcio' : ''}
                </div>
                {cs.map(c => <Llamar key={c.id} c={c} />)}
              </div>
            )
          })}
          {puedeEditar && !nuevoCto && (
            <button type="button" onClick={() => setNuevoCto({ rubro: 'gasista' })}
              style={{ marginTop: 8, fontSize: 12, background: 'none', border: `1px dashed ${AZ}`, color: AZ, borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }}>
              + Cargar contacto del consorcio
            </button>
          )}
          {nuevoCto && FormContacto()}
        </div>
      )}

      {!aplicado && (
        puedeEditar ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1.2fr auto', gap: 10, alignItems: 'end' }}>
            <div><div style={lbl}>Protocolo</div>
              <select value={sel} onChange={e => { setSel(e.target.value); setNivel('') }} style={inp}>
                <option value="">— Seleccioná —</option>
                {protocolos.map(p => <option key={p.codigo} value={p.codigo}>{p.icono} {p.nombre}</option>)}
              </select></div>
            <div><div style={lbl}>Nivel de riesgo</div>
              <select value={nivel || prot?.nivel_default || ''} onChange={e => setNivel(e.target.value)} style={inp} disabled={!sel}>
                {Object.entries(NIVELES).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
              </select></div>
            <div><div style={lbl}>Conocimiento del hecho</div>
              <input type="datetime-local" value={conocido} onChange={e => setConocido(e.target.value)} style={inp} /></div>
            <button type="button" style={btn(AZ, !sel || ocupado)} disabled={!sel || ocupado} onClick={aplicar}>
              {ocupado ? 'Aplicando…' : 'Aplicar'}
            </button>
            {prot && (
              <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: GR }}>
                {prot.descripcion} · {prot.pasos.length} pasos · Base: {prot.base_legal || '—'}
                {!prot.revisado && <span style={{ color: AM, fontWeight: 700 }}> · Texto en borrador, pendiente de revisión</span>}
              </div>
            )}
          </div>
        ) : <div style={{ fontSize: 12, color: GR }}>Sin protocolo aplicado.</div>
      )}

      {aplicado && (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{prot?.icono} {prot?.nombre || reclamo.protocolo_codigo}</span>
            {nivelR && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 700, background: nivelR.bg, color: nivelR.c }}>{nivelR.l}</span>}
            <span style={{ fontSize: 11.5, color: GR }}>desde {fmtDT(t0)} · {hechas}/{tareas.length} pasos</span>
            {criticasPend > 0 && <span style={{ fontSize: 11, color: RJ, fontWeight: 700 }}>⚠ {criticasPend} crítico(s) pendiente(s)</span>}
            {prot && !prot.revisado && <span style={{ fontSize: 11, color: AM, fontWeight: 700 }}>Borrador</span>}
            {puedeEditar && hechas === 0 && (
              <button type="button" onClick={quitar} style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: 'none', color: GR, cursor: 'pointer', textDecoration: 'underline' }}>Quitar protocolo</button>
            )}
          </div>

          {reclamo.vence_notif_2067k && (
            <div style={{ ...box, marginBottom: 10, background: '#eff6ff' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: AZ }}>⚖️ Notificación a propietarios (art. 2067 inc. k CCCN)</div>
              <div style={{ fontSize: 12 }}>Vence: <b>{fmtDT(reclamo.vence_notif_2067k)}</b>
                {(() => { const paso = tareas.find(t => /2067 inc\. k/.test(t.texto)); if (paso?.hecho_at) return <span style={{ color: VD, fontWeight: 700 }}> · ✓ cumplido</span>
                  const r = restante(reclamo.vence_notif_2067k); return <span style={{ color: r.c, fontWeight: 700 }}> · restan {r.txt}</span> })()}
              </div>
              <div style={{ fontSize: 10.5, color: GR }}>48 h hábiles contadas en días hábiles (lun-vie). No contempla feriados: verificar.</div>
            </div>
          )}

          <div style={{ ...box, marginBottom: 10 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 600 }}>
              <input type="checkbox" checked={!!reclamo.siniestro_seguro} disabled={!puedeEditar} onChange={e => setSeguro(e.target.checked)} />
              🛡️ Siniestro con posible cobertura del seguro integral
            </label>
            {reclamo.siniestro_seguro && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
                <span>Límite de denuncia: <b>{fmtD(reclamo.fecha_limite_denuncia_seguro)}</b>
                  {!reclamo.fecha_denuncia_seguro && reclamo.fecha_limite_denuncia_seguro && (() => {
                    const r = restante(reclamo.fecha_limite_denuncia_seguro + 'T23:59:59'); return <span style={{ color: r.c, fontWeight: 700 }}> · restan {r.txt}</span> })()}
                </span>
                <span>Denunciado el: <input type="date" disabled={!puedeEditar} value={reclamo.fecha_denuncia_seguro || ''}
                  onChange={e => setFechaDenuncia(e.target.value)} style={{ ...inp, width: 150, display: 'inline-block' }} /></span>
                <span style={{ fontSize: 10.5, color: GR }}>3 días desde el conocimiento (art. 46 Ley 17.418)</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tareas.map(t => {
              const vencida = !t.hecho_at && t.minuto > 0 && transcurrido > t.minuto
              const cs = t.rubro ? contactosDe(t.rubro) : []
              return (
                <div key={t.id} style={{ ...box, padding: '8px 10px', background: t.hecho_at ? '#f0fdf4' : vencida ? '#fef2f2' : '#fff',
                  borderColor: t.hecho_at ? '#bbf7d0' : vencida ? '#fecaca' : '#e5e7eb' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={!!t.hecho_at} disabled={!puedeEditar} onChange={() => toggleTarea(t)} style={{ marginTop: 3 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: t.critico ? RJ : GR }}>
                        {tramo(t.minuto)}{t.critico ? ' · CRÍTICO' : ''}{vencida ? ' · FUERA DE TIEMPO' : ''}
                      </div>
                      <div style={{ fontSize: 12.5, textDecoration: t.hecho_at ? 'line-through' : 'none', color: t.hecho_at ? GR : '#111827' }}>{t.texto}</div>
                      {t.rubro && (
                        <div style={{ marginTop: 4 }}>
                          {cs.length ? cs.map(c => <Llamar key={c.id} c={c} />) : (
                            <span style={{ fontSize: 11, color: AM }}>⚠ Sin contacto de {RUBRO_LABEL[t.rubro] || t.rubro} para este consorcio
                              {puedeEditar && <button type="button" onClick={() => { setVerContactos(true); setNuevoCto({ rubro: RUBROS_CONSORCIO.includes(t.rubro) ? t.rubro : 'otro' }) }}
                                style={{ marginLeft: 6, fontSize: 11, background: 'none', border: 'none', color: AZ, cursor: 'pointer', textDecoration: 'underline' }}>cargar</button>}
                            </span>
                          )}
                        </div>
                      )}
                      {t.hecho_at && <div style={{ fontSize: 10.5, color: VD, marginTop: 2 }}>✓ {fmtDT(t.hecho_at)} · {t.hecho_por_email || '—'}</div>}
                      <input defaultValue={t.nota || ''} placeholder="Nota (nº de reclamo, hora, técnico…)" disabled={!puedeEditar}
                        onBlur={e => guardarNota(t, e.target.value.trim())}
                        style={{ ...inp, marginTop: 5, fontSize: 11.5, padding: '5px 8px', background: '#fafafa' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {bitacora.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 12, color: GR, cursor: 'pointer', fontWeight: 600 }}>🗒️ Bitácora ({bitacora.length})</summary>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {bitacora.map(b => (
              <div key={b.id} style={{ fontSize: 11.5, borderLeft: '3px solid #e5e7eb', paddingLeft: 8 }}>
                <span style={{ color: GR }}>{fmtDT(b.created_at)} · {b.autor || '—'} · {b.tipo}</span>
                <div style={{ whiteSpace: 'pre-wrap' }}>{b.contenido}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  )
}
