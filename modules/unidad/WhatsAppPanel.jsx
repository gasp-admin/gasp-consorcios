// modules — WhatsAppPanel.jsx
// Panel de conversaciones del bot de WhatsApp. Permite ver todas las conversaciones
// (filtradas por consorcio activo), leer el hilo en vivo (Realtime) y, cuando hace
// falta, TOMAR la conversación para responder manualmente (el bot se pausa) o
// DEVOLVERLA al bot. Respeta la ventana de 24 h de WhatsApp.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG } from '../../lib/config'
import { Btn, BtnSec, Card, Badge, Msg } from '../../components/ui'

export default function WhatsAppPanel() {
  const { session, consorcioActivo, copropietarios } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [convs, setConvs]       = useState([])
  const [sel, setSel]           = useState(null)      // conversación seleccionada (telefono)
  const [mensajes, setMensajes] = useState([])
  const [texto, setTexto]       = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [msg, setMsg]           = useState(null)
  const [enviando, setEnviando] = useState(false)
  const finRef = useRef(null)

  const nombreDe = useCallback((c) => {
    if (c.copropietario_id && copropietarios) {
      const cp = copropietarios.find(x => x.id === c.copropietario_id)
      if (cp) return cp.apellido_nombre
    }
    return c.telefono
  }, [copropietarios])

  // ---- Cargar lista de conversaciones del consorcio activo ----
  const cargarConvs = useCallback(async () => {
    if (!uid || !consorcioId) { setConvs([]); return }
    const { data } = await supabase.from('con_wa_conversaciones')
      .select('telefono, copropietario_id, consorcio_id, modo, no_leidos, ventana_hasta, ultimo_mensaje, updated_at')
      .eq('admin_id', uid).eq('consorcio_id', consorcioId)
      .order('updated_at', { ascending: false }).limit(200)
    setConvs(data || [])
  }, [uid, consorcioId])

  useEffect(() => { cargarConvs() }, [cargarConvs])

  // ---- Cargar mensajes de la conversación seleccionada ----
  const cargarMensajes = useCallback(async (telefono) => {
    if (!telefono) { setMensajes([]); return }
    const { data } = await supabase.from('con_wa_mensajes')
      .select('id, origen, cuerpo, created_at, leido')
      .eq('telefono', telefono).order('created_at', { ascending: true }).limit(500)
    setMensajes(data || [])
    // marcar como leídos
    await supabase.from('con_wa_mensajes').update({ leido: true }).eq('telefono', telefono).eq('leido', false)
    await supabase.from('con_wa_conversaciones').update({ no_leidos: 0 }).eq('telefono', telefono)
    cargarConvs()
  }, [cargarConvs])

  useEffect(() => { if (sel) cargarMensajes(sel) }, [sel, cargarMensajes])

  // ---- Realtime: token + suscripción a mensajes y conversaciones ----
  useEffect(() => {
    if (!uid) return
    let canal
    const suscribir = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      if (token) supabase.realtime.setAuth(token)
      canal = supabase.channel(`wa-panel-${uid}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'con_wa_mensajes', filter: `admin_id=eq.${uid}` },
          (payload) => {
            const m = payload.new
            setConvs(prev => prev.length ? prev : prev) // no-op para forzar refresco abajo
            cargarConvs()
            // si el mensaje es de la conversación abierta, agregarlo en vivo
            setSel(curr => {
              if (curr && m.telefono === curr) {
                setMensajes(prevM => [...prevM, { id: m.id, origen: m.origen, cuerpo: m.cuerpo, created_at: m.created_at, leido: true }])
              }
              return curr
            })
          })
        .subscribe()
    }
    suscribir()
    return () => { if (canal) supabase.removeChannel(canal) }
  }, [uid, cargarConvs])

  // scroll al último mensaje
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [mensajes])

  const convSel = convs.find(c => c.telefono === sel)
  const ventanaAbierta = convSel?.ventana_hasta ? new Date(convSel.ventana_hasta) > new Date() : false

  // ---- Acciones (llaman a la Edge Function wa-responder) ----
  async function accionar(body) {
    const { data: s } = await supabase.auth.getSession()
    const token = s?.session?.access_token
    const r = await fetch(`${SUPA_URL}/functions/v1/wa-responder`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return r.json()
  }

  async function tomar() {
    const res = await accionar({ telefono: sel, accion: 'tomar' })
    if (res.ok) { setMsg({ tipo: 'ok', texto: 'Tomaste la conversación. El bot quedó en pausa.' }); cargarConvs(); cargarMensajes(sel) }
    else setMsg({ tipo: 'err', texto: 'No se pudo tomar la conversación.' })
  }
  async function devolver() {
    const res = await accionar({ telefono: sel, accion: 'devolver' })
    if (res.ok) { setMsg({ tipo: 'ok', texto: 'Conversación devuelta al bot.' }); cargarConvs() }
    else setMsg({ tipo: 'err', texto: 'No se pudo devolver la conversación.' })
  }
  async function enviar() {
    if (!texto.trim()) return
    setEnviando(true); setMsg(null)
    const res = await accionar({ telefono: sel, texto: texto.trim() })
    setEnviando(false)
    if (res.ok) { setTexto(''); cargarMensajes(sel) }
    else if (res.error === 'ventana_cerrada') setMsg({ tipo: 'err', texto: 'La ventana de 24 h está cerrada. No se puede responder por texto libre hasta que el copropietario vuelva a escribir.' })
    else setMsg({ tipo: 'err', texto: 'No se pudo enviar el mensaje.' })
  }

  const convsFiltradas = convs.filter(c => {
    if (!busqueda) return true
    const t = busqueda.toLowerCase()
    return nombreDe(c).toLowerCase().includes(t) || (c.telefono || '').includes(t) || (c.ultimo_mensaje || '').toLowerCase().includes(t)
  })

  const fmtHora = (iso) => { try { return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

  if (!consorcioId) return <div style={{ textAlign: 'center', padding: 40, color: GR }}>Seleccioná un consorcio primero.</div>

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ color: AZ, margin: '0 0 4px' }}>💬 Conversaciones WhatsApp</h2>
      <p style={{ color: GR, fontSize: 13, margin: '0 0 16px' }}>
        Atención del bot para {consorcioActivo?.nombre}. Podés tomar una conversación para responder vos; el bot se pausa hasta que la devuelvas.
      </p>

      {msg && <div style={{ marginBottom: 12 }}><Msg data={msg} /></div>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ----- Lista de conversaciones ----- */}
        <div style={{ flex: '1 1 320px', maxWidth: 400 }}>
          <input
            value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, teléfono o mensaje..."
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 10, fontSize: 14 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 560, overflowY: 'auto' }}>
            {convsFiltradas.length === 0 && <div style={{ color: GR, fontSize: 13, padding: 12 }}>No hay conversaciones todavía.</div>}
            {convsFiltradas.map(c => (
              <div key={c.telefono} onClick={() => setSel(c.telefono)}
                style={{
                  padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                  background: sel === c.telefono ? '#EEF2FF' : '#fff',
                  border: `1px solid ${sel === c.telefono ? AZ : '#e5e7eb'}`,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{nombreDe(c)}</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {c.modo === 'humano'
                      ? <Badge text="👤 Humano" color={VD} />
                      : <Badge text="🤖 Bot" color={AZ} />}
                    {c.no_leidos > 0 && <span style={{ background: RJ, color: '#fff', fontSize: 11, fontWeight: 800, minWidth: 18, height: 18, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{c.no_leidos}</span>}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: GR, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.ultimo_mensaje || '—'}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{fmtHora(c.updated_at)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ----- Hilo de la conversación ----- */}
        <div style={{ flex: '2 1 420px' }}>
          {!sel ? (
            <Card><div style={{ padding: 30, textAlign: 'center', color: GR }}>Elegí una conversación para ver el detalle.</div></Card>
          ) : (
            <Card>
              <div style={{ padding: 14 }}>
                {/* cabecera */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800, color: '#111' }}>{convSel ? nombreDe(convSel) : sel}</div>
                    <div style={{ fontSize: 12, color: GR }}>+{sel}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {convSel?.modo === 'humano'
                      ? <Btn small color={AZ} onClick={devolver}>↩ Devolver al bot</Btn>
                      : <Btn small color={VD} onClick={tomar}>👤 Tomar conversación</Btn>}
                  </div>
                </div>

                {/* mensajes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto', padding: '4px 2px' }}>
                  {mensajes.map(m => {
                    const esCopro = m.origen === 'copropietario'
                    const bg = esCopro ? '#F3F4F6' : (m.origen === 'humano' ? '#DCFCE7' : '#EEF2FF')
                    const align = esCopro ? 'flex-start' : 'flex-end'
                    const etq = esCopro ? 'Copropietario' : (m.origen === 'humano' ? 'Vos (admin)' : 'Bot')
                    const etqColor = esCopro ? GR : (m.origen === 'humano' ? VD : AZ)
                    return (
                      <div key={m.id} style={{ alignSelf: align, maxWidth: '80%' }}>
                        <div style={{ fontSize: 10, color: etqColor, fontWeight: 700, marginBottom: 2, textAlign: esCopro ? 'left' : 'right' }}>{etq}</div>
                        <div style={{ background: bg, padding: '8px 12px', borderRadius: 12, fontSize: 14, color: '#111', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.cuerpo}</div>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, textAlign: esCopro ? 'left' : 'right' }}>{fmtHora(m.created_at)}</div>
                      </div>
                    )
                  })}
                  <div ref={finRef} />
                </div>

                {/* barra de envío */}
                <div style={{ borderTop: '1px solid #eee', paddingTop: 10, marginTop: 10 }}>
                  {convSel?.modo !== 'humano' && (
                    <div style={{ fontSize: 12, color: AM, marginBottom: 8 }}>
                      🤖 El bot está atendiendo esta conversación. Tomala para responder vos.
                    </div>
                  )}
                  {convSel?.modo === 'humano' && !ventanaAbierta && (
                    <div style={{ fontSize: 12, color: RJ, marginBottom: 8 }}>
                      ⏰ La ventana de 24 h está cerrada. No podés responder por texto libre hasta que el copropietario vuelva a escribir.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea
                      value={texto} onChange={e => setTexto(e.target.value)}
                      disabled={convSel?.modo !== 'humano' || !ventanaAbierta || enviando}
                      placeholder={convSel?.modo === 'humano' ? 'Escribí tu respuesta...' : 'Tomá la conversación para escribir'}
                      rows={2}
                      style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <Btn onClick={enviar} disabled={convSel?.modo !== 'humano' || !ventanaAbierta || enviando || !texto.trim()}>
                      {enviando ? 'Enviando...' : 'Enviar'}
                    </Btn>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
