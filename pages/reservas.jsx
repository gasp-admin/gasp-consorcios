// pages/reservas.jsx — Vista de reservas para el INQUILINO (alcance solo-reservas).
// Acceso por token de invitación (?inv=...). No expone cta cte, expensas, pagos ni datos de la unidad.
// Todo por /api/portal?...&inv=... (mismo dominio; el WebView no bloquea). No usa cliente Supabase.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'

const AZ = '#1A3FA0', VD = '#1B6B35', RJ = '#B91C1C', AM = '#C07D10', GR = '#6B7280'
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export default function Reservas() {
  const router = useRouter()
  const { inv } = router.query

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [espacios, setEspacios] = useState([])
  const [dispo, setDispo]       = useState([])
  const [reservas, setReservas] = useState([])
  const [espSel, setEspSel]     = useState(null)
  const [fecha, setFecha]       = useState('')
  const [desde, setDesde]       = useState('')
  const [hasta, setHasta]       = useState('')
  const [recurso, setRecurso]   = useState('')
  const [msg, setMsg]           = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [ultima, setUltima]     = useState(null)
  const [archivo, setArchivo]   = useState(null)

  useEffect(() => { if (inv) cargar() }, [inv]) // eslint-disable-line

  async function cargar() {
    setLoading(true)
    try {
      const resp = await fetch('/api/portal?accion=sum_config&inv=' + encodeURIComponent(inv))
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.error) { setError(data.error === 'link_invalido' ? 'Link inválido o vencido.' : 'No se pudo cargar.'); setLoading(false); return }
      const esps = data.espacios || []
      setEspacios(esps); setDispo(data.dispo || []); setReservas(data.reservas || [])
      setEspSel(prev => esps.find(e => e.id === prev?.id) || esps[0] || null)
    } catch (e) { setError('Error de conexión.') }
    setLoading(false)
  }

  function labelRec(nro) {
    if (!espSel) return ''
    const labels = (espSel.reglas && Array.isArray(espSel.reglas.recursos)) ? espSel.reglas.recursos : []
    return labels[nro - 1] || ((espSel.capacidad || 1) > 1 ? espSel.nombre + ' ' + nro : espSel.nombre)
  }
  function ventanasDe(ymd) {
    if (!espSel || !ymd) return []
    const dow = new Date(ymd + 'T12:00:00Z').getUTCDay()
    return dispo.filter(d => d.espacio_id === espSel.id && d.dia_semana === dow)
  }
  function ocupadasDe(ymd) {
    if (!espSel || !ymd) return []
    const cap = espSel.capacidad || 1
    return reservas.filter(r => r.espacio_id === espSel.id && r.fecha === ymd)
      .map(r => (cap > 1 ? labelRec(r.recurso_nro) + ': ' : '') + (r.hora_inicio_txt || '') + '–' + (r.hora_fin_txt || ''))
      .filter(x => !x.endsWith('–'))
  }
  function diasDisponibles() {
    if (!espSel) return []
    const maxd = espSel.anticipacion_max_dias || 60
    const conVentana = new Set(dispo.filter(d => d.espacio_id === espSel.id).map(d => d.dia_semana))
    const out = []
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    for (let i = 0; i <= maxd; i++) {
      const d = new Date(hoy.getTime() + i * 86400000)
      const ymd = d.toISOString().slice(0, 10)
      const dow = new Date(ymd + 'T12:00:00Z').getUTCDay()
      if (conVentana.has(dow)) out.push({ ymd, dow })
    }
    return out
  }

  async function reservar() {
    if (!espSel || !fecha || !desde || !hasta) return setMsg({ t: 'warn', m: 'Elegí día, desde y hasta' })
    setEnviando(true); setMsg(null)
    try {
      const resp = await fetch('/api/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'sum_reservar', inv, espacio_id: espSel.id, fecha, hora_inicio: desde, hora_fin: hasta, recurso_nro: recurso }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.error) {
        const M = { ocupado: 'Ese horario ya está reservado', limite_reservas: 'Alcanzaste el máximo de reservas activas', fuera_de_ventana: 'El horario está fuera del rango habilitado', duracion_invalida: 'La duración no está permitida', granularidad: 'Elegí horarios en múltiplos permitidos', dia_no_disponible: 'Ese día no está habilitado', fecha_fuera_de_rango: 'Fecha fuera del rango permitido', hora_invalida: 'Horario inválido', recurso_invalido: 'Unidad no válida', scope: 'Este espacio no admite reservas por invitado' }
        return setMsg({ t: 'error', m: M[data.error] || 'No se pudo reservar' })
      }
      setUltima(data)
      const rec = data.recurso_label ? (data.recurso_label + ' — ') : ''
      if (data.pago_requerido) setMsg({ t: 'ok', m: rec + 'Reserva tomada. Falta el pago ($' + Number(data.tarifa).toLocaleString('es-AR') + '). Subí el comprobante.' })
      else setMsg({ t: 'ok', m: rec + (data.estado === 'solicitada' ? 'Reserva enviada, queda a confirmación de la administración' : 'Reserva confirmada') })
      setFecha(''); setDesde(''); setHasta(''); setRecurso(''); cargar()
    } catch (e) { setMsg({ t: 'error', m: 'Error de conexión' }) }
    setEnviando(false)
  }

  async function subirArchivo(file) {
    const mime = (file.type || '').toLowerCase()
    const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!ok.includes(mime)) throw new Error('Formato no permitido (JPG/PNG/WEBP/PDF)')
    if (mime === 'application/pdf' && file.size > 4 * 1024 * 1024) throw new Error('El PDF supera 4 MB')
    const qs = 'inv=' + encodeURIComponent(inv) + '&nombre=' + encodeURIComponent(file.name || 'comprobante')
    const resp = await fetch('/api/portal-adjunto?' + qs, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || !data.ok) throw new Error('No se pudo subir el comprobante')
    return data.path
  }
  async function subirComprobante() {
    if (!archivo || !ultima?.reserva_id) return
    setEnviando(true)
    try {
      const path = await subirArchivo(archivo)
      const resp = await fetch('/api/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'sum_adjuntar_pago', inv, reserva_id: ultima.reserva_id, path }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.error) return setMsg({ t: 'error', m: 'No se pudo adjuntar el comprobante' })
      setMsg({ t: 'ok', m: 'Comprobante enviado. La administración confirmará el pago.' })
      setArchivo(null); setUltima(null); cargar()
    } catch (e) { setMsg({ t: 'error', m: e.message || 'Error al subir el comprobante' }) }
    setEnviando(false)
  }

  const box = { maxWidth: 560, margin: '0 auto', padding: 16, fontFamily: 'system-ui, -apple-system, sans-serif' }
  if (loading) return <div style={box}>Cargando…</div>
  if (error) return <div style={box}><div style={{ background: '#fef2f2', color: '#991b1b', padding: 16, borderRadius: 12 }}>{error}</div></div>
  if (!espacios.length) return <div style={box}><div style={{ color: GR }}>No hay espacios habilitados para reservar con este link.</div></div>

  return (
    <div style={box}>
      <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>🏖️ Reservá el espacio común</div>
      <div style={{ fontSize: 12, color: GR, marginBottom: 12 }}>Acceso de reservas para el inquilino</div>

      {espacios.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {espacios.map(e => (
            <button key={e.id} onClick={() => { setEspSel(e); setFecha(''); setDesde(''); setHasta(''); setRecurso('') }}
              style={{ padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${espSel?.id === e.id ? AZ : '#e5e7eb'}`, background: espSel?.id === e.id ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 13 }}>
              {e.nombre}{e.requiere_pago ? ` · $${Number(e.tarifa).toLocaleString('es-AR')}` : ''}
            </button>
          ))}
        </div>
      )}

      {espSel && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 8px #0001' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>🏖️ {espSel.nombre}</div>
          {espSel.requiere_pago && <div style={{ fontSize: 13, color: GR, marginBottom: 8 }}>Uso con cargo: ${Number(espSel.tarifa).toLocaleString('es-AR')}</div>}
          {msg && (
            <div style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 8, fontSize: 13,
              background: msg.t === 'ok' ? '#f0fdf4' : msg.t === 'error' ? '#fef2f2' : '#fffbeb',
              color: msg.t === 'ok' ? '#166534' : msg.t === 'error' ? '#991b1b' : '#92400e' }}>{msg.m}</div>
          )}

          {ultima?.pago_requerido && (
            <div style={{ border: '1px dashed #fca5a5', borderRadius: 10, padding: 12, margin: '8px 0', background: '#fff8f8' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Subí el comprobante del pago</div>
              <input type="file" accept="image/*,application/pdf" onChange={e => setArchivo(e.target.files?.[0] || null)} />
              <div style={{ marginTop: 8 }}>
                <button disabled={!archivo || enviando} onClick={subirComprobante}
                  style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: AZ, color: '#fff', fontWeight: 600, cursor: (!archivo || enviando) ? 'default' : 'pointer', opacity: (!archivo || enviando) ? 0.6 : 1 }}>
                  Enviar comprobante
                </button>
              </div>
            </div>
          )}

          <div style={{ fontSize: 13, fontWeight: 600, margin: '10px 0 6px' }}>Elegí un día disponible</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
            {diasDisponibles().length === 0
              ? <div style={{ color: GR, fontSize: 13 }}>No hay días disponibles por ahora.</div>
              : diasDisponibles().map(d => (
                  <button key={d.ymd} onClick={() => { setFecha(d.ymd); setDesde(''); setHasta(''); setRecurso('') }}
                    style={{ padding: '8px 10px', borderRadius: 9, border: `1.5px solid ${fecha === d.ymd ? AZ : '#e5e7eb'}`, background: fecha === d.ymd ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 12 }}>
                    {DIAS[d.dow]} {d.ymd.slice(8, 10)}/{d.ymd.slice(5, 7)}
                  </button>
                ))}
          </div>

          {fecha && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: GR, marginBottom: 6 }}>
                Horario habilitado: {ventanasDe(fecha).map(w => String(w.hora_inicio).slice(0, 5) + '–' + (w.hora_fin <= w.hora_inicio ? '24:00' : String(w.hora_fin).slice(0, 5))).join(' · ') || '—'}
              </div>
              {ocupadasDe(fecha).length > 0 && <div style={{ fontSize: 12, color: RJ, marginBottom: 8 }}>Ocupado: {ocupadasDe(fecha).join(' · ')}</div>}
              <div style={{ fontSize: 13, fontWeight: 600, margin: '6px 0' }}>Elegí tu horario</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: GR }}>Desde</span>
                <input type="time" step="1800" value={desde} onChange={e => setDesde(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13 }} />
                <span style={{ fontSize: 12, color: GR }}>Hasta</span>
                <input type="time" step="1800" value={hasta} onChange={e => setHasta(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13 }} />
              </div>
              {(espSel.capacidad || 1) > 1 && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: GR, marginRight: 6 }}>Unidad</span>
                  <select value={recurso} onChange={e => setRecurso(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13 }}>
                    <option value="">Cualquiera disponible</option>
                    {Array.from({ length: espSel.capacidad || 1 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{labelRec(n)}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          <button disabled={!fecha || !desde || !hasta || enviando} onClick={reservar}
            style={{ width: '100%', padding: 12, border: 'none', borderRadius: 10, background: VD, color: '#fff', fontWeight: 700, fontSize: 14, cursor: (!fecha || !desde || !hasta || enviando) ? 'default' : 'pointer', opacity: (!fecha || !desde || !hasta || enviando) ? 0.6 : 1 }}>
            {enviando ? 'Procesando…' : 'Reservar'}
          </button>
        </div>
      )}
    </div>
  )
}
