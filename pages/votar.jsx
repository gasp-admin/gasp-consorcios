// pages/votar.jsx — §60 Votaciones: vista del PROPIETARIO (todos los consorcios, nativos e históricos).
// Acceso por el portal_token de la UF (?token=...&v=<votacion_id opcional>).
// Todo por /api/portal (acciones vot_*). No usa cliente Supabase (WebView in-app, ver §13).
// Expone solo: votaciones en cuyo padrón figura la UF, sus opciones, el voto propio y —si la
// votación lo permite— el escrutinio sin nombres de propietarios.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

const AZ = '#1A3FA0', VD = '#1B6B35', RJ = '#B91C1C', AM = '#C07D10', GR = '#6B7280'
const TZ = 'America/Argentina/Buenos_Aires'

const TIPO = {
  consulta: {
    t: 'Consulta a los propietarios',
    d: 'Consulta sobre la propuesta detallada. El resultado se informa al cierre.',
  },
  ausentes_2060: {
    t: 'Comunicación a propietarios ausentes — art. 2060 CCyC',
    d: 'La decisión fue propuesta en asamblea por la mayoría de los presentes. Si usted no estuvo presente, puede expresar su conformidad u oposición antes del cierre. Si no se forma una oposición con mayoría suficiente dentro del plazo, la decisión se tiene por aprobada.',
  },
  unanimidad_2059: {
    t: 'Decisión por unanimidad sin asamblea — art. 2059 CCyC',
    d: 'La propuesta solo se aprueba con el voto afirmativo de la totalidad de los propietarios.',
  },
}
const RESULTADO = {
  en_curso: ['Votación en curso', AM],
  aprobada: ['Aprobada', VD],
  no_aprobada: ['No aprobada', RJ],
  aprobada_expresa: ['Aprobada (mayoría expresa)', VD],
  aprobada_tacita: ['Aprobada (sin oposición suficiente)', VD],
  rechazada_por_oposicion: ['Rechazada por oposición', RJ],
  opcion_ganadora: ['Opción ganadora', VD],
  sin_mayoria: ['Sin mayoría', GR],
  sin_definicion: ['Sin definición (empate)', GR],
  sin_votos: ['Sin votos', GR],
}

const fFecha = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' hs'
  } catch { return String(iso) }
}

export default function Votar() {
  const router = useRouter()
  const { token, v } = router.query

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [data, setData]       = useState(null)

  useEffect(() => { if (token) cargar() }, [token]) // eslint-disable-line

  async function cargar() {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/portal?accion=vot_listar&token=' + encodeURIComponent(token))
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) {
        setError(d.error === 'link_invalido' ? 'El link no es válido. Solicite uno nuevo a la administración.' : 'No se pudo cargar la información.')
      } else setData(d)
    } catch { setError('Error de conexión. Intente nuevamente.') }
    setLoading(false)
  }

  const lista = (data?.votaciones || []).slice().sort((a, b) => {
    if (v && a.id === v) return -1
    if (v && b.id === v) return 1
    if (a.estado !== b.estado) return a.estado === 'abierta' ? -1 : 1
    return 0
  })

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4ff', fontFamily: 'Segoe UI, Arial, sans-serif', color: '#111' }}>
      <Head><title>Votaciones — Administración Pinamar</title><meta name="viewport" content="width=device-width,initial-scale=1" /></Head>
      <div style={{ background: AZ, color: '#fff', padding: '18px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 }}>Administración de Consorcios Pinamar</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>🗳️ Votaciones</div>
          {data && <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>{data.consorcio} · UF {data.unidad}</div>}
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
        {!token && !loading && <Aviso c={RJ}>Falta el link de acceso.</Aviso>}
        {loading && token && <div style={{ color: GR, padding: 20, textAlign: 'center' }}>Cargando…</div>}
        {error && <Aviso c={RJ}>{error}</Aviso>}
        {data && !lista.length && <Aviso c={GR}>No hay votaciones disponibles para su unidad.</Aviso>}
        {lista.map((vt) => <TarjetaVotacion key={vt.id} vt={vt} token={token} onCambio={cargar} destacada={vt.id === v} />)}
        <div style={{ fontSize: 11, color: GR, textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
          Cada voto queda registrado con fecha, hora y un código de verificación.<br />
          Consultas: administracion@administracionpinamar.com
        </div>
      </div>
    </div>
  )
}

function Aviso({ c, children }) {
  return <div style={{ background: '#fff', borderLeft: '4px solid ' + c, borderRadius: 8, padding: '12px 14px', fontSize: 14, marginBottom: 14 }}>{children}</div>
}

function TarjetaVotacion({ vt, token, onCambio, destacada }) {
  const [sel, setSel]           = useState(vt.mi_voto?.opcion_id || '')
  const [editando, setEditando] = useState(!vt.mi_voto)
  const [codigo, setCodigo]     = useState('')
  const [otpEnviado, setOtpEnviado] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg]           = useState(null)
  const [hecho, setHecho]       = useState(null)

  const tipo = TIPO[vt.tipo] || TIPO.consulta
  const abierta = vt.estado === 'abierta'
  const noEmpezo = abierta && vt.apertura && new Date(vt.apertura) > new Date()
  const opcMia = vt.opciones.find((o) => o.id === vt.mi_voto?.opcion_id)

  async function pedirCodigo() {
    setEnviando(true); setMsg(null)
    try {
      const r = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'vot_otp', token, votacion_id: vt.id }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) setMsg({ c: RJ, t: d.error || 'No se pudo enviar el código' })
      else { setOtpEnviado(d.email_mask); setMsg({ c: VD, t: 'Le enviamos un código de 6 dígitos a ' + d.email_mask + '. Vence en 15 minutos.' }) }
    } catch { setMsg({ c: RJ, t: 'Error de conexión' }) }
    setEnviando(false)
  }

  async function votar() {
    if (!sel) return setMsg({ c: AM, t: 'Seleccione una opción' })
    if (vt.requiere_otp && !/^\d{6}$/.test(codigo.trim())) return setMsg({ c: AM, t: 'Ingrese el código de 6 dígitos recibido por email' })
    const et = vt.opciones.find((o) => o.id === sel)?.etiqueta || ''
    if (typeof window !== 'undefined' && !window.confirm('¿Confirma su voto: "' + et + '"?')) return
    setEnviando(true); setMsg(null)
    try {
      const r = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'vot_emitir', token, votacion_id: vt.id, opcion_id: sel, codigo: vt.requiere_otp ? codigo.trim() : undefined }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) setMsg({ c: RJ, t: d.error || 'No se pudo registrar el voto' })
      else {
        setHecho({ et, emitido_at: d.emitido_at, hash: d.hash, constancia: d.constancia_enviada })
        setEditando(false); setCodigo(''); setOtpEnviado(null)
        onCambio()
      }
    } catch { setMsg({ c: RJ, t: 'Error de conexión' }) }
    setEnviando(false)
  }

  const chip = abierta ? (noEmpezo ? ['Próximamente', AM] : ['Abierta', VD]) : ['Cerrada', GR]

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,.08)', border: destacada ? '2px solid ' + AZ : '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.3 }}>{vt.titulo}</div>
        <span style={{ background: chip[1], color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{chip[0]}</span>
      </div>
      <div style={{ fontSize: 12, color: AZ, fontWeight: 700, marginTop: 6 }}>{tipo.t}</div>
      <div style={{ fontSize: 12, color: GR, marginTop: 4, lineHeight: 1.5 }}>{tipo.d}</div>
      <div style={{ fontSize: 12, color: '#374151', marginTop: 8 }}>
        <strong>Apertura:</strong> {fFecha(vt.apertura)} · <strong>Cierre:</strong> {fFecha(vt.cierre)}
      </div>

      {vt.descripcion && <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 12, whiteSpace: 'pre-wrap' }}>{vt.descripcion}</div>}

      {(vt.adjuntos || []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Documentación</div>
          {vt.adjuntos.map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 13, color: AZ, padding: '4px 0' }}>📎 {a.nombre || 'Archivo ' + (i + 1)}</a>
          ))}
        </div>
      )}

      {vt.tipo === 'ausentes_2060' && vt.presente_asamblea && (
        <div style={{ marginTop: 12 }}><Aviso c={AZ}>Su unidad estuvo presente en la asamblea; su voto quedó registrado en ella.</Aviso></div>
      )}

      {/* Voto propio vigente */}
      {vt.mi_voto && !editando && (
        <div style={{ marginTop: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 13 }}>✓ Su voto registrado: <strong>{opcMia?.etiqueta || '—'}</strong></div>
          <div style={{ fontSize: 11, color: GR, marginTop: 4 }}>Fecha: {fFecha(vt.mi_voto.emitido_at)} · Código: {String(vt.mi_voto.hash || '').slice(0, 12).toUpperCase()}</div>
          {vt.puede_votar && vt.permite_cambio && (
            <button onClick={() => { setEditando(true); setSel(vt.mi_voto.opcion_id); setMsg(null) }}
              style={{ marginTop: 8, background: 'none', border: '1px solid ' + AZ, color: AZ, borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Cambiar mi voto (hasta el cierre)
            </button>
          )}
        </div>
      )}

      {hecho && (
        <div style={{ marginTop: 10 }}><Aviso c={VD}>Voto registrado: <strong>{hecho.et}</strong>.{hecho.constancia ? ' Le enviamos la constancia por email.' : ''}</Aviso></div>
      )}

      {/* Formulario de voto */}
      {vt.puede_votar && !noEmpezo && editando && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Seleccione su voto</div>
          {vt.opciones.map((o) => (
            <label key={o.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '1px solid ' + (sel === o.id ? AZ : '#e5e7eb'), background: sel === o.id ? '#eff6ff' : '#fff', borderRadius: 8, marginBottom: 8, cursor: 'pointer' }}>
              <input type="radio" name={'op-' + vt.id} checked={sel === o.id} onChange={() => setSel(o.id)} style={{ marginTop: 3 }} />
              <span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{o.etiqueta}</span>
                {o.detalle && <span style={{ display: 'block', fontSize: 12, color: GR, marginTop: 2 }}>{o.detalle}</span>}
              </span>
            </label>
          ))}

          {vt.requiere_otp && (
            <div style={{ marginTop: 8, padding: 10, background: '#f8fafc', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>Para votar se requiere un código enviado a su email registrado{vt.email_mask ? ' (' + vt.email_mask + ')' : ''}.</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={pedirCodigo} disabled={enviando}
                  style={{ background: '#fff', border: '1px solid ' + AZ, color: AZ, borderRadius: 7, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {otpEnviado ? 'Reenviar código' : 'Enviar código'}
                </button>
                <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000"
                  style={{ width: 110, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 16, letterSpacing: 3 }} />
              </div>
            </div>
          )}

          {msg && <div style={{ marginTop: 10 }}><Aviso c={msg.c}>{msg.t}</Aviso></div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={votar} disabled={enviando}
              style={{ flex: 1, background: enviando ? '#9ca3af' : AZ, color: '#fff', border: 'none', borderRadius: 8, padding: '12px 16px', fontSize: 15, fontWeight: 800, cursor: enviando ? 'default' : 'pointer' }}>
              {enviando ? 'Registrando…' : (vt.mi_voto ? 'Confirmar cambio de voto' : 'Emitir voto')}
            </button>
            {vt.mi_voto && (
              <button onClick={() => { setEditando(false); setMsg(null) }}
                style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '12px 14px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
            )}
          </div>
        </div>
      )}

      {!vt.puede_votar && abierta && !vt.mi_voto && !(vt.tipo === 'ausentes_2060' && vt.presente_asamblea) && !noEmpezo && vt.requiere_otp && !vt.tiene_email && (
        <div style={{ marginTop: 12 }}><Aviso c={AM}>Su unidad no tiene email registrado, requisito para votar en esta consulta. Comuníquese con la administración.</Aviso></div>
      )}

      {/* Resultados */}
      {vt.resultados && <Resultados r={vt.resultados} cerrada={vt.estado === 'cerrada'} />}
    </div>
  )
}

function Resultados({ r, cerrada }) {
  const [verUF, setVerUF] = useState(false)
  const lab = RESULTADO[r.resultado] || [r.resultado, GR]
  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{cerrada ? 'Escrutinio final' : 'Escrutinio parcial'}</div>
        <span style={{ background: lab[1], color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
          {lab[0]}{r.ganador?.etiqueta ? ': ' + r.ganador.etiqueta : ''}
        </span>
      </div>
      <div style={{ fontSize: 11, color: GR, marginTop: 4 }}>Participación: {r.votos_emitidos} de {r.total_uf} UF ({r.participacion_pct_uf}%). Porcentajes sobre la totalidad de las unidades.</div>
      {r.opciones.map((o) => (
        <div key={o.opcion_id} style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{o.etiqueta}</span>
            <span>{o.uf} UF · {o.pct_uf}% · coef. {o.pct_coef}%</span>
          </div>
          <div style={{ height: 8, background: '#eef2f7', borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ width: Math.min(100, Number(o.pct_coef) || 0) + '%', height: '100%', background: o.clave === 'no' ? RJ : o.clave === 'abstencion' ? GR : AZ }} />
          </div>
          {verUF && o.unidades.length > 0 && <div style={{ fontSize: 11, color: GR, marginTop: 3 }}>UF: {o.unidades.join(', ')}</div>}
        </div>
      ))}
      {r.no_voto && <div style={{ fontSize: 12, color: GR, marginTop: 10 }}>No votaron: {r.no_voto.uf} UF · {r.no_voto.pct_uf}% · coef. {r.no_voto.pct_coef}%</div>}
      <button onClick={() => setVerUF(!verUF)} style={{ marginTop: 8, background: 'none', border: 'none', color: AZ, fontSize: 12, cursor: 'pointer', padding: 0 }}>
        {verUF ? 'Ocultar detalle por unidad' : 'Ver detalle por unidad'}
      </button>
    </div>
  )
}
