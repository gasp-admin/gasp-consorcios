// portal.jsx v6 — Portal del Copropietario GASP Consorcios
// NUEVO v6: la cuenta corriente usa la EF get-cuenta-corriente (misma fuente que la
//           pantalla interna del sistema). Antes el Portal la calculaba con lógica
//           propia y duplicaba movimientos (expensa del período y pagos ya liquidados).
// v5: Sección "📁 Documentación del consorcio" con link a carpeta Drive
// + Tab "Documentos" con acceso directo y descripción de contenidos disponibles
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { generarPDFLiquidacion } from '../lib/exportPdf'
import { generarReciboHTML, saldoDesdeCtaCte, abrirVentanaRecibo, escribirVentanaRecibo } from '../lib/recibo'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const fmt  = n => '$' + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR') : '—'
const periodoLabel = p => {
  if (!p) return '—'
  const [y, m] = p.split('-')
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${meses[parseInt(m)-1]} ${y}`
}
const saldoDet = d => Math.max(0,
  (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0)
  + (parseFloat(d.interes_mora)||0) - (parseFloat(d.pagos_periodo)||0)
)

const AZ = '#1A3FA0', VD = '#1B6B35', RJ = '#B91C1C', AM = '#C07D10', GR = '#6B7280'


// ── Adjuntos del portal (comprobante de pago / adjunto de reclamo) ──
// El WebView Android bloquea supabase.co → el archivo sube a /api/portal-adjunto (mismo dominio),
// que lo guarda con service role en el bucket privado `consorcios-adjuntos`. Se envían BYTES CRUDOS
// (sin base64) para no inflar +33% ni chocar el tope de ~4,5 MB de Vercel.
// Poné true para EXIGIR el comprobante al informar un pago:
const ADJUNTO_PAGO_OBLIGATORIO = false
const MIME_ADJUNTO = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
const MAX_PDF = 4 * 1024 * 1024

async function comprimirImagen(file) {
  // Redimensiona a lado máx 1600px y re-encoda JPEG 0.72. Si algo falla, devuelve el original.
  if (!file || !file.type || !file.type.startsWith('image/')) return file
  try {
    const dataUrl = await new Promise((ok, no) => {
      const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(file)
    })
    const img = await new Promise((ok, no) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = dataUrl
    })
    const MAXL = 1600
    let w = img.width, h = img.height
    if (w > MAXL || h > MAXL) { const r = Math.min(MAXL / w, MAXL / h); w = Math.round(w * r); h = Math.round(h * r) }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    cv.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.72))
    if (!blob) return file
    return new File([blob], (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return file }
}

async function subirAdjunto(fileRaw, token) {
  // Valida, comprime imágenes y sube al server. Devuelve el path en Storage.
  let file = fileRaw
  const mime = (file.type || '').toLowerCase()
  if (!MIME_ADJUNTO.includes(mime)) throw new Error('Formato no permitido. Adjuntá una imagen (JPG/PNG/WEBP) o un PDF.')
  if (mime === 'application/pdf' && file.size > MAX_PDF) throw new Error('El PDF supera 4 MB. Reducilo e intentá de nuevo.')
  if (mime.startsWith('image/')) file = await comprimirImagen(file)
  const tk = Array.isArray(token) ? token[0] : token
  const qs = 'token=' + encodeURIComponent(tk) + '&nombre=' + encodeURIComponent(file.name || 'adjunto')
  const resp = await fetch('/api/portal-adjunto?' + qs, {
    method: 'POST', headers: { 'Content-Type': file.type }, body: file,
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || !data.ok) {
    const M = { tipo_no_permitido: 'Formato no permitido.', muy_grande: 'El archivo es demasiado grande (máx. 4 MB).', link_invalido: 'Enlace inválido.', vacio: 'El archivo está vacío.' }
    throw new Error(M[data.error] || ('Error al subir el adjunto' + (data.error ? ': ' + data.error : '')))
  }
  return data.path
}

function Reclamo({ unidadId, copropietarioId, consorcioId, adminEmail, adminId, token }) {
  const [asunto, setAsunto]   = useState('')
  const [detalle, setDetalle] = useState('')
  const [tipo, setTipo]       = useState('reclamo')
  const [enviado, setEnviado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg]         = useState(null)
  const [fileRec, setFileRec] = useState(null)
  const [subiendoRec, setSubiendoRec] = useState(false)

  const TIPOS = [
    ['reclamo',    '🔧 Reclamo técnico'],
    ['consulta',   '❓ Consulta administrativa'],
    ['expensa',    '💳 Consulta sobre expensas'],
    ['ruido',      '🔊 Ruidos/molestias'],
    ['otro',       '📝 Otro'],
  ]

  const enviar = async () => {
    if (!asunto.trim() || !detalle.trim()) return setMsg('Completá el asunto y el detalle')
    setEnviando(true)
    try {
      let adjuntos = null
      if (fileRec) {
        setSubiendoRec(true)
        try { adjuntos = [await subirAdjunto(fileRec, token)] }
        catch (e) { setSubiendoRec(false); setEnviando(false); return setMsg(e.message) }
        setSubiendoRec(false)
      }
      const resp = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'reclamo', token, prefijo: 'REC', categoria: tipo, titulo: asunto, descripcion: detalle, adjuntos }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.error) throw new Error(data.error || 'error')
      setEnviado(true)
      setAsunto(''); setDetalle(''); setMsg(null); setFileRec(null)
    } catch (e) {
      setMsg('Error al enviar. Intentá de nuevo.')
    }
    setEnviando(false)
  }

  if (enviado) return (
    <div style={{ textAlign:'center', padding:'24px 0' }}>
      <div style={{ fontSize:36, marginBottom:8 }}>✅</div>
      <div style={{ fontWeight:700, marginBottom:6 }}>Reclamo enviado</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>El administrador recibirá tu reclamo y te contactará a la brevedad.</div>
      <button onClick={() => setEnviado(false)}
        style={{ padding:'8px 20px', background:AZ, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600 }}>
        Enviar otro
      </button>
    </div>
  )

  return (
    <div>
      {msg && <div style={{ padding:'8px 12px', background:'#fef2f2', borderRadius:8, fontSize:12, color:RJ, marginBottom:12 }}>{msg}</div>}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Tipo de consulta</div>
        <select value={tipo} onChange={e => setTipo(e.target.value)}
          style={{ width:'100%', padding:'10px', border:'1px solid #d1d5db', borderRadius:8, fontSize:13 }}>
          {TIPOS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Asunto</div>
        <input value={asunto} onChange={e => setAsunto(e.target.value)}
          placeholder="Describí brevemente el problema"
          style={{ width:'100%', padding:'10px', border:'1px solid #d1d5db', borderRadius:8, fontSize:13, boxSizing:'border-box' }}/>
      </div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Detalle</div>
        <textarea value={detalle} onChange={e => setDetalle(e.target.value)} rows={4}
          placeholder="Describí el problema con el mayor detalle posible..."
          style={{ width:'100%', padding:'10px', border:'1px solid #d1d5db', borderRadius:8, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }}/>
      </div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Adjuntar imagen o PDF (opcional · máx. 4 MB)</div>
        <input type="file" accept="image/*,application/pdf"
          onChange={e => setFileRec(e.target.files?.[0] || null)}
          style={{ width:'100%', fontSize:12 }} />
        {fileRec && <div style={{ fontSize:11, color:GR, marginTop:4 }}>📎 {fileRec.name}</div>}
      </div>
      <button onClick={enviar} disabled={enviando || subiendoRec || !asunto.trim() || !detalle.trim()}
        style={{ width:'100%', padding:'12px', background:AZ, color:'#fff', border:'none', borderRadius:8,
          cursor: enviando||subiendoRec||!asunto.trim()||!detalle.trim() ? 'not-allowed' : 'pointer',
          opacity: enviando||subiendoRec||!asunto.trim()||!detalle.trim() ? 0.5 : 1,
          fontWeight:700, fontSize:14 }}>
        {subiendoRec ? '⏳ Subiendo adjunto...' : enviando ? '⏳ Enviando...' : '📤 Enviar reclamo'}
      </button>
    </div>
  )
}


export default function Portal() {
  const router = useRouter()
  const { token } = router.query

  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [unidad, setUnidad]           = useState(null)
  const [coprop, setCoprop]           = useState(null)
  const [consorcio, setConsorcio]     = useState(null)
  const [detalles, setDetalles]       = useState([])
  const [cobranzas, setCobranzas]     = useState([])
  const [adminPerfil, setAdminPerfil] = useState(null)
  const [cuentaBanco, setCuentaBanco] = useState(null)
  const [interfast, setInterfast]     = useState(null)
  const [tab, setTab]                 = useState('cuenta')
  const [periodoExpandido, setPeriodoExpandido] = useState(null)
  const [gastosPeriodo, setGastosPeriodo]       = useState([])
  const [comprobantesPeriodo, setComprobantesPeriodo] = useState([])
  const [loadingGastos, setLoadingGastos]       = useState(false)
  // Cta cte y pago
  const [movsCta, setMovsCta]             = useState([])
  const [loadingCta, setLoadingCta]       = useState(false)
  const [errorCta, setErrorCta]           = useState(null)
  const [formPago, setFormPago]           = useState(null)
  const [msgPago, setMsgPago]             = useState(null)
  const [enviandoPago, setEnviandoPago]   = useState(false)
  const [archivoPago, setArchivoPago]     = useState(null)
  // ── SUM / Amenities ──
  const [sumEspacios, setSumEspacios]   = useState([])
  const [sumDispo, setSumDispo]         = useState([])
  const [sumReservas, setSumReservas]   = useState([])
  const [sumEspSel, setSumEspSel]       = useState(null)
  const [sumFecha, setSumFecha]         = useState('')
  const [sumFranja, setSumFranja]       = useState('')
  const [sumDesde, setSumDesde]         = useState('')
  const [sumHasta, setSumHasta]         = useState('')
  const [sumRecurso, setSumRecurso]     = useState('')
  const [sumInvs, setSumInvs]           = useState([])
  const [sumInvNota, setSumInvNota]     = useState('')
  const [sumMsg, setSumMsg]             = useState(null)
  const [sumEnviando, setSumEnviando]   = useState(false)
  const [sumArchivo, setSumArchivo]     = useState(null)
  const [sumUltima, setSumUltima]       = useState(null)

  async function cargarSum() {
    try {
      const resp = await fetch('/api/portal?accion=sum_config&token=' + encodeURIComponent(token))
      const data = await resp.json().catch(() => ({}))
      const esps = data.espacios || []
      setSumEspacios(esps); setSumDispo(data.dispo || []); setSumReservas(data.reservas || [])
      setSumEspSel(prev => esps.find(e => e.id === prev?.id) || esps[0] || null)
      if (esps.some(e => e.permite_invitados)) cargarInvs()
    } catch (e) { /* si no hay espacios, la pestaña no aparece */ }
  }
  async function cargarInvs() {
    try {
      const resp = await fetch('/api/portal?accion=inv_listar&token=' + encodeURIComponent(token))
      const data = await resp.json().catch(() => ({}))
      setSumInvs(data.invitaciones || [])
    } catch (e) { /* noop */ }
  }
  function linkInv(tk) { return (typeof window !== 'undefined' ? window.location.origin : '') + '/reservas?inv=' + tk }
  async function copiarInv(tk) { try { await navigator.clipboard.writeText(linkInv(tk)); setSumMsg({ t: 'ok', m: 'Link copiado' }) } catch (e) { setSumMsg({ t: 'warn', m: linkInv(tk) }) } }
  async function crearInv() {
    try {
      const resp = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'inv_crear', token, dias: 90, nota: sumInvNota }) })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.error) return setSumMsg({ t: 'error', m: data.error === 'invitados_no_habilitado' ? 'La administración no habilitó invitados en este consorcio' : 'No se pudo generar el link' })
      setSumInvNota(''); cargarInvs(); setSumMsg({ t: 'ok', m: 'Link generado. Copialo y compartilo con el inquilino.' })
    } catch (e) { setSumMsg({ t: 'error', m: 'Error de conexión' }) }
  }
  async function revocarInv(id) {
    if (!confirm('¿Revocar este link? El inquilino ya no podrá reservar.')) return
    await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'inv_revocar', token, id }) })
    cargarInvs()
  }

  function sumVentanasDe(ymd) {
    if (!sumEspSel || !ymd) return []
    const dow = new Date(ymd + 'T12:00:00Z').getUTCDay()
    return sumDispo.filter(d => d.espacio_id === sumEspSel.id && d.dia_semana === dow)
  }
  function sumLabelRec(nro) {
    if (!sumEspSel) return ''
    const labels = (sumEspSel.reglas && Array.isArray(sumEspSel.reglas.recursos)) ? sumEspSel.reglas.recursos : []
    return labels[nro - 1] || ((sumEspSel.capacidad || 1) > 1 ? sumEspSel.nombre + ' ' + nro : sumEspSel.nombre)
  }
  function sumOcupadasDe(ymd) {
    if (!sumEspSel || !ymd) return []
    const cap = sumEspSel.capacidad || 1
    return sumReservas
      .filter(r => r.espacio_id === sumEspSel.id && r.fecha === ymd)
      .map(r => (cap > 1 ? sumLabelRec(r.recurso_nro) + ': ' : '') + (r.hora_inicio_txt || '') + '–' + (r.hora_fin_txt || ''))
      .filter(x => !x.endsWith('–'))
  }
  function sumDiasDisponibles() {
    if (!sumEspSel) return []
    const maxd = sumEspSel.anticipacion_max_dias || 60
    const conVentana = new Set(sumDispo.filter(d => d.espacio_id === sumEspSel.id).map(d => d.dia_semana))
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

  async function reservarSum() {
    if (!sumEspSel || !sumFecha || !sumDesde || !sumHasta) return setSumMsg({ t: 'warn', m: 'Elegí día, desde y hasta' })
    setSumEnviando(true); setSumMsg(null)
    try {
      const resp = await fetch('/api/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'sum_reservar', token, espacio_id: sumEspSel.id, fecha: sumFecha, hora_inicio: sumDesde, hora_fin: sumHasta, recurso_nro: sumRecurso }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.error) {
        const M = { ocupado: 'Ese horario ya está reservado', limite_reservas: 'Alcanzaste el máximo de reservas activas', fuera_de_ventana: 'El horario está fuera del rango habilitado', duracion_invalida: 'La duración no está permitida', granularidad: 'Elegí horarios en múltiplos permitidos', dia_no_disponible: 'Ese día no está habilitado', fecha_fuera_de_rango: 'Fecha fuera del rango permitido', hora_invalida: 'Horario inválido', recurso_invalido: 'Unidad no válida' }
        return setSumMsg({ t: 'error', m: M[data.error] || 'No se pudo reservar' })
      }
      setSumUltima(data)
      const rec = data.recurso_label ? (data.recurso_label + ' — ') : ''
      if (data.pago_requerido) setSumMsg({ t: 'ok', m: rec + 'Reserva tomada. Falta el pago ($' + Number(data.tarifa).toLocaleString('es-AR') + '). Subí el comprobante.' })
      else setSumMsg({ t: 'ok', m: rec + (data.estado === 'solicitada' ? 'Reserva enviada, queda a confirmación de la administración' : 'Reserva confirmada') })
      setSumFecha(''); setSumDesde(''); setSumHasta(''); setSumRecurso(''); cargarSum()
    } catch (e) { setSumMsg({ t: 'error', m: 'Error de conexión' }) }
    setSumEnviando(false)
  }

  async function subirComprobanteSum() {
    if (!sumArchivo || !sumUltima?.reserva_id) return
    setSumEnviando(true)
    try {
      const path = await subirAdjunto(sumArchivo, token)
      const resp = await fetch('/api/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'sum_adjuntar_pago', token, reserva_id: sumUltima.reserva_id, path }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.error) return setSumMsg({ t: 'error', m: 'No se pudo adjuntar el comprobante' })
      setSumMsg({ t: 'ok', m: 'Comprobante enviado. La administración confirmará el pago.' })
      setSumArchivo(null); setSumUltima(null); cargarSum()
    } catch (e) { setSumMsg({ t: 'error', m: 'Error al subir el comprobante' }) }
    setSumEnviando(false)
  }

  useEffect(() => { if (unidad?.id && token) cargarSum() }, [unidad?.id]) // eslint-disable-line

  useEffect(() => { if (token) cargar(token) }, [token])
  // Cargar la cta cte (EF get-cuenta-corriente) apenas se conoce la unidad: es la
  // fuente única del saldo. El badge de estado se calcula de acá, no del detalle.
  useEffect(() => { if (unidad?.id) cargarCtaCte(unidad.id) }, [unidad?.id]) // eslint-disable-line

  useEffect(() => {
    if (loading || !token) return
    const hash = window.location.hash
    if (!hash) return
    if (hash === '#cuenta-corriente') { setTab('cuenta'); return }
    if (hash === '#pagos') { setTab('pagos'); return }
    if (hash === '#documentos') { setTab('documentos'); return }
    if (hash.startsWith('#recibo-')) { setTab('pagos'); return }
    if (hash.startsWith('#liquidacion-')) {
      const per = hash.replace('#liquidacion-', '')
      setTab('cuenta')
      expandirPeriodo(per)
    }
  }, [loading])

  async function cargar(tk) {
    setLoading(true)
    try {
      // Carga vía endpoint del propio dominio (/api/portal). El WebView in-app de Android
      // bloquea supabase.co; el servidor de Vercel hace las consultas y devuelve los datos.
      const resp = await fetch('/api/portal?accion=init&token=' + encodeURIComponent(tk))
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.error || !data.uf) { setError('Link no válido o expirado.'); setLoading(false); return }
      const { uf, cp, con, adm, cuentas, dets, cobs, interfast } = data
      setUnidad(uf)
      setCoprop(cp); setConsorcio(con); setAdminPerfil(adm)
      setCuentaBanco(cuentas?.[0] || null)
      setInterfast(interfast || null)
      setDetalles((dets||[]).filter(d =>
        (parseFloat(d.monto)||0) > 0 || (parseFloat(d.saldo_anterior)||0) > 0
      ))
      setCobranzas(cobs||[])
    } catch(e) { setError('Error al cargar. Intente nuevamente.') }
    setLoading(false)
  }

  const [todosDetalles, setTodosDetalles]   = useState([])
  const [todasUnidades, setTodasUnidades]   = useState([])
  const [lufsHist, setLufsHist]             = useState([])
  const [todosCoprop, setTodosCoprop]       = useState([])
  const [generandoPDF, setGenerandoPDF]     = useState(false)
  const [expensaActual, setExpensaActual]   = useState(null)

  async function expandirPeriodo(per) {
    setPeriodoExpandido(per)
    setLoadingGastos(true)
    const det = detalles.find(d => d.con_expensas?.periodo === per)
    const expId = det?.expensa_id
    if (!expId) { setLoadingGastos(false); return }
    const resp = await fetch('/api/portal?accion=liq&token=' + encodeURIComponent(token) + '&exp=' + encodeURIComponent(expId))
    const data = await resp.json().catch(() => ({}))
    setGastosPeriodo(data.gastos || [])
    setComprobantesPeriodo(data.comprobantes || [])
    setTodosDetalles(data.dets || [])
    setTodasUnidades(data.ufs || [])
    setTodosCoprop(data.cps || [])
    setExpensaActual(data.exp || null)
    setLufsHist(data.lufs || [])
    setLoadingGastos(false)
    setTimeout(() => {
      const el = document.getElementById('planilla-liq')
      if (el) el.scrollIntoView({ behavior:'smooth', block:'start' })
    }, 100)
  }

  async function abrirPDFCompleto() {
    if (!expensaActual || !consorcio) return
    setGenerandoPDF(true)
    try {
      generarPDFLiquidacion({
        consorcioActivo: consorcio,
        expensa: expensaActual,
        gastos: gastosPeriodo,
        comprobantes: comprobantesPeriodo,
        detalles: todosDetalles,
        unidades: todasUnidades,
        copropietarios: todosCoprop,
        adminPerfil: adminPerfil || {},
        lufsHist,
      })
    } catch(e) { alert('Error al generar PDF: ' + e.message) }
    setGenerandoPDF(false)
  }

  // Recibo de pago — art. 12 Ley 14.701. Generador único compartido con el sistema (lib/recibo.js).
  // Estado de deuda (inc. h): cta cte vía /api/portal?accion=cta (get-cuenta-corriente, misma fuente).
  async function generarReciboCob(cob) {
    if (!cob) return
    const win = abrirVentanaRecibo()
    if (!win) { alert('Habilite las ventanas emergentes para descargar el recibo.'); return }
    let saldo = null
    try {
      const resp = await fetch('/api/portal?accion=cta&token=' + encodeURIComponent(token))
      const data = await resp.json().catch(() => null)
      if (resp.ok && data && !data.error) saldo = saldoDesdeCtaCte(data)
    } catch (e) { saldo = null }
    const det = (detalles || []).find(d => d.expensa_id === cob.expensa_id)
    const expensa = { periodo: cob.con_expensas?.periodo || det?.con_expensas?.periodo || null,
      fecha_vencimiento: det?.con_expensas?.fecha_vencimiento || null }
    escribirVentanaRecibo(win, generarReciboHTML({
      cob, consorcio: consorcio || {}, unidad: unidad || {}, copropietario: coprop || {}, expensa,
      adm: adminPerfil || {}, cuentaBanco, interfast, saldo, autoPrint: true,
    }))
  }

  // ── Cuenta corriente ───────────────────────────────────────────────────────
  // Usa la MISMA fuente que la pantalla interna del sistema: la Edge Function
  // get-cuenta-corriente. Antes el Portal armaba la cta cte con lógica propia y
  // duplicaba movimientos:
  //   (a) sumaba cobranzas de períodos ya liquidados, que ya vienen en con_liquidacion_uf.pagos
  //   (b) el filtro de detalle ('-HIST-' en el id) no excluía las liquidaciones nativas,
  //       por lo que la expensa del período se contaba dos veces
  //   (c) no leía con_movimientos_unidad (no veía los MOV-COB ni el recargo de 2º vencimiento)
  // La EF ya contempla esos tres casos según el modelo_cc del consorcio.
  async function cargarCtaCte(ufId) {
    setLoadingCta(true); setErrorCta(null)
    try {
      const resp = await fetch('/api/portal?accion=cta&token=' + encodeURIComponent(token))
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error('http ' + resp.status)
      if (data?.error) throw new Error(data.error)
      const lineas = (data?.lineas || []).map(l => ({
        fecha:    l.fecha,
        tipo:     l.tipo,
        concepto: l.concepto,
        monto:    parseFloat(l.monto) || 0,
        nro:      l.nro || null,
        saldo:    parseFloat(l.saldo_acum) || 0,
      }))
      setMovsCta(lineas)
      if (!lineas.length) setErrorCta('Sin movimientos registrados.')
    } catch (e) {
      setMovsCta([])
      setErrorCta('No se pudo cargar la cuenta corriente. Reintente en unos minutos o contacte a la administración.')
    }
    setLoadingCta(false)
  }

  async function enviarNotificacionPago() {
    if (!formPago || !formPago.monto || !formPago.fecha) {
      return setMsgPago({ tipo:'warn', texto:'Complete monto y fecha del pago.' })
    }
    if (ADJUNTO_PAGO_OBLIGATORIO && !archivoPago) {
      return setMsgPago({ tipo:'warn', texto:'Adjunte el comprobante del pago (imagen o PDF).' })
    }
    setEnviandoPago(true)
    try {
      let adjuntos = null
      if (archivoPago) {
        setMsgPago({ tipo:'warn', texto:'⏳ Subiendo comprobante...' })
        adjuntos = [await subirAdjunto(archivoPago, token)]
      }
      // Insertar aviso en con_reclamos (con tipo especial de pago)
      const resp = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'reclamo', token, prefijo: 'PAY', categoria: 'pago_informado',
          titulo: `Aviso de pago — ${coprop?.apellido_nombre}`,
          adjuntos,
          descripcion: `PAGO INFORMADO POR PROPIETARIO:\nMonto: $${formPago.monto}\nFecha: ${formPago.fecha}\nMedio: ${formPago.medio||'No especificado'}\nComprobante: ${formPago.comprobante||'Sin referencia'}\nAdjunto: ${adjuntos ? 'Sí (ver en el sistema)' : 'No'}\nObservaciones: ${formPago.obs||'—'}` }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.error) throw new Error(data.error || 'error')
      setMsgPago({ tipo:'ok', texto:'✓ Aviso enviado al administrador. Se verificará su pago a la brevedad.' })
      setFormPago(null); setArchivoPago(null)
    } catch(e) {
      setMsgPago({ tipo:'error', texto:'Error al enviar: ' + e.message })
    }
    setEnviandoPago(false)
  }

  const fmtD2 = d => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'

  const detOrdenados = [...detalles].sort((a,b) =>
    (b.con_expensas?.periodo||'').localeCompare(a.con_expensas?.periodo||'')
  )
  // §14: en liquidaciones NATIVAS ya cerradas, pagos_periodo queda congelado en 0
  // (el pago va a con_cobranzas / cta cte). El pago real se lee de con_cobranzas
  // imputadas a esa expensa (fallback a pagos_periodo). Históricos: sin cambio.
  const pagadoReal = d => {
    if (d?.con_expensas?.fuente !== 'gasp') return parseFloat(d?.pagos_periodo)||0
    const c = (cobranzas||[])
      .filter(x => x.expensa_id === d.expensa_id)
      .reduce((a,x) => a + (parseFloat(x.monto)||0), 0)
    return c > 0 ? c : (parseFloat(d.pagos_periodo)||0)
  }
  const saldoDetReal = d => Math.max(0,
    (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0)
    + (parseFloat(d.interes_mora)||0) - pagadoReal(d)
  )
  // Fuente única del saldo: la cta cte de la EF (get-cuenta-corriente). El saldo
  // corrido incluye la deuda arrastrada de períodos anteriores. Fallback al detalle
  // del último período solo mientras la cta cte no cargó todavía.
  const saldoCta = movsCta.length ? (movsCta[movsCta.length - 1].saldo || 0) : null
  const deudaReal = saldoCta != null
    ? Math.max(0, saldoCta)
    : (detOrdenados[0] ? saldoDetReal(detOrdenados[0]) : 0)
  const estaAlDia = deudaReal <= 0.005
  const ultimoPago = cobranzas[0] || null
  const cbu    = cuentaBanco?.cbu   || consorcio?.cbu   || null
  const alias  = cuentaBanco?.alias || consorcio?.alias_cbu || '—'
  const banco  = cuentaBanco?.banco || consorcio?.banco  || '—'
  const bloqueComoPagar = (interfast?.cvu || cbu) ? (
    <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
      marginBottom:14, border:'1.5px solid #dbeafe', boxShadow:'0 2px 8px #0001' }}>
      <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:12 }}>💳 Cómo pagar</div>
      {interfast?.cvu ? (
        <div>
          <div style={{ fontWeight:700, fontSize:13, color:'#166534', marginBottom:10 }}>🏦 Pago electrónico (Interfast)</div>
          <a href={`https://interfast.com.ar/pagar/${interfast.cpe}`} target="_blank" rel="noreferrer"
            style={{ display:'block', padding:'12px', background:'#16a34a', color:'#fff', textAlign:'center',
              borderRadius:10, fontWeight:700, fontSize:15, textDecoration:'none', marginBottom:12 }}>
            💳 Pagar online con tarjeta
          </a>
          <div style={{ fontSize:12.5, color:'#374151', lineHeight:1.9 }}>
            <div style={{ color:GR, marginBottom:4 }}>O transferí desde tu billetera / homebanking a:</div>
            <div><span style={{ color:GR }}>CVU:</span> <strong style={{ fontFamily:'monospace' }}>{interfast.cvu}</strong></div>
            {interfast.alias && <div><span style={{ color:GR }}>Alias:</span> <strong>{interfast.alias}</strong></div>}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize:13, color:'#374151', lineHeight:2 }}>
            <div><span style={{ color:GR }}>Titular:</span> <strong>{consorcio?.nombre}</strong></div>
            <div><span style={{ color:GR }}>CBU:</span> <strong style={{ fontFamily:'monospace' }}>{cbu}</strong></div>
            <div><span style={{ color:GR }}>Alias:</span> <strong>{alias}</strong></div>
            <div><span style={{ color:GR }}>Banco:</span> {banco}</div>
          </div>
          <div style={{ marginTop:10, padding:'8px 12px', background:'#eff6ff',
            borderRadius:8, fontSize:11, color:'#1e40af' }}>
            ℹ️ Incluí el importe exacto con centavos al transferir.
          </div>
        </div>
      )}
    </div>
  ) : null

  // ── Drive ──────────────────────────────────────────────────────────────────
  const driveFolderUrl = consorcio?.drive_folder_url || null

  if (!token) return null
  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff', display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:'Segoe UI,Arial,sans-serif' }}>
      <div style={{ textAlign:'center', color:AZ }}>
        <div style={{ fontSize:36, marginBottom:12 }}>⏳</div>
        <div>Cargando su portal...</div>
      </div>
    </div>
  )
  if (error) return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff', display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:'Segoe UI,Arial,sans-serif' }}>
      <div style={{ textAlign:'center', background:'#fff', borderRadius:14,
        padding:40, maxWidth:380, boxShadow:'0 4px 24px #0001' }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>Link no válido</div>
        <div style={{ color:GR, fontSize:14 }}>{error}</div>
        <div style={{ marginTop:20, fontSize:12, color:GR }}>
          Contacte a su administrador para obtener un nuevo link.
        </div>
      </div>
    </div>
  )

  // ── Planilla de liquidación expandida ──────────────────────────────────────
  const detExpandido = detOrdenados.find(d => d.con_expensas?.periodo === periodoExpandido)
  if (periodoExpandido && detExpandido) {
    const exp     = detExpandido.con_expensas || {}
    const salAnt  = parseFloat(detExpandido.saldo_anterior)||0
    const monto   = parseFloat(detExpandido.monto)||0
    const mora    = parseFloat(detExpandido.interes_mora)||0
    const pagado  = pagadoReal(detExpandido)
    const saldo   = saldoDetReal(detExpandido)
    const esPag   = detExpandido.estado === 'pagada' || saldo <= 0.005
    const totalGastos = gastosPeriodo.reduce((a,g) => a + (parseFloat(g.monto)||0), 0)
    const gastosPorCat = {}
    for (const g of gastosPeriodo) {
      const cat = g.categoria || 'varios'
      if (!gastosPorCat[cat]) gastosPorCat[cat] = []
      gastosPorCat[cat].push(g)
    }
    return (
      <div style={{ minHeight:'100vh', background:'#f0f4ff',
        fontFamily:'Segoe UI,Arial,sans-serif', paddingBottom:48 }}>
        <Head>
          <title>Liquidación {periodoLabel(periodoExpandido)} — {consorcio?.nombre}</title>
          <meta name="viewport" content="width=device-width,initial-scale=1" />
        </Head>
        <div style={{ background:AZ, color:'#fff', padding:'14px 18px',
          position:'sticky', top:0, zIndex:10, boxShadow:'0 2px 8px #0003' }}>
          <div style={{ maxWidth:680, margin:'0 auto', display:'flex',
            alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <button onClick={() => setPeriodoExpandido(null)}
                style={{ background:'rgba(255,255,255,0.2)', border:'none', color:'#fff',
                  borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:13 }}>
                ← Volver
              </button>
              <div>
                <div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase' }}>Liquidación</div>
                <div style={{ fontSize:15, fontWeight:700 }}>
                  {periodoLabel(periodoExpandido)} — {consorcio?.nombre}
                </div>
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, opacity:0.7 }}>Unidad</div>
              <div style={{ fontSize:20, fontWeight:800 }}>{unidad?.numero}</div>
            </div>
          </div>
        </div>

        <div id="planilla-liq" style={{ maxWidth:680, margin:'0 auto', padding:'16px 14px' }}>
          <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
            marginBottom:14, boxShadow:'0 2px 12px #0001', borderLeft:`4px solid ${AZ}` }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:17, color:AZ }}>
                  📋 Liquidación {periodoLabel(periodoExpandido)}
                </div>
                <div style={{ fontSize:12, color:GR, marginTop:4 }}>
                  {consorcio?.nombre} · Unidad {unidad?.numero} · {coprop?.apellido_nombre}
                </div>
                {exp.fecha_vencimiento && (
                  <div style={{ fontSize:12, color:GR, marginTop:2 }}>
                    Vencimiento: <strong>{fmtD(exp.fecha_vencimiento)}</strong>
                  </div>
                )}
              </div>
              <div style={{ background: esPag ? '#dcfce7' : saldo > 0 ? '#fee2e2' : '#fef9c3',
                color: esPag ? VD : saldo > 0 ? RJ : AM,
                borderRadius:10, padding:'10px 18px', textAlign:'center', fontWeight:700 }}>
                <div style={{ fontSize:11, marginBottom:2 }}>
                  {esPag ? '✓ Pagada' : saldo > 0 ? 'Total a pagar' : 'Pendiente'}
                </div>
                <div style={{ fontSize:20 }}>{esPag ? '✓' : fmt(saldo)}</div>
              </div>
            </div>
          </div>

          <div style={{ background:'#fff', borderRadius:14, overflow:'hidden',
            marginBottom:14, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ background:AZ, color:'#fff', padding:'10px 18px', fontWeight:700, fontSize:13 }}>
              Composición de su expensa
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <tbody>
                {salAnt > 0 && (
                  <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'11px 18px', color:GR }}>Saldo anterior</td>
                    <td style={{ padding:'11px 18px', textAlign:'right', color:RJ, fontWeight:600 }}>{fmt(salAnt)}</td>
                  </tr>
                )}
                <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                  <td style={{ padding:'11px 18px' }}>
                    Expensa {periodoLabel(periodoExpandido)}
                    <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                      Coef. fiscal: {Number(unidad?.porcentaje_fiscal||0).toFixed(4)}%
                    </div>
                  </td>
                  <td style={{ padding:'11px 18px', textAlign:'right', fontWeight:600 }}>{fmt(monto)}</td>
                </tr>
                {mora > 0 && (
                  <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'11px 18px', color:AM }}>Interés por mora</td>
                    <td style={{ padding:'11px 18px', textAlign:'right', color:AM, fontWeight:600 }}>{fmt(mora)}</td>
                  </tr>
                )}
                {pagado > 0 && (
                  <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'11px 18px', color:VD }}>Pagado</td>
                    <td style={{ padding:'11px 18px', textAlign:'right', color:VD, fontWeight:600 }}>− {fmt(pagado)}</td>
                  </tr>
                )}
                <tr style={{ background:'#f0f4ff', borderTop:`2px solid ${AZ}` }}>
                  <td style={{ padding:'13px 18px', fontWeight:700, color:AZ }}>Total</td>
                  <td style={{ padding:'13px 18px', textAlign:'right', fontWeight:800,
                    fontSize:17, color: esPag ? VD : saldo > 0 ? RJ : GR }}>
                    {esPag ? '✓ Pagada' : fmt(saldo)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ background:'#fff', borderRadius:14, overflow:'hidden',
            marginBottom:14, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ background:'#374151', color:'#fff', padding:'10px 18px', fontWeight:700, fontSize:13 }}>
              Gastos del consorcio — {periodoLabel(periodoExpandido)}
              {totalGastos > 0 && (
                <span style={{ float:'right', fontWeight:400, fontSize:12 }}>Total: {fmt(totalGastos)}</span>
              )}
            </div>
            {loadingGastos ? (
              <div style={{ padding:24, textAlign:'center', color:GR }}>Cargando gastos...</div>
            ) : gastosPeriodo.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:GR, fontSize:13 }}>
                Sin gastos detallados para este período
              </div>
            ) : (
              <div>
                {Object.entries(gastosPorCat).map(([cat, gs]) => {
                  const subtotal = gs.reduce((a,g) => a + (parseFloat(g.monto)||0), 0)
                  return (
                    <div key={cat}>
                      <div style={{ background:'#eff6ff', padding:'7px 18px',
                        fontSize:11, fontWeight:700, color:AZ, textTransform:'uppercase',
                        letterSpacing:'0.04em', display:'flex', justifyContent:'space-between' }}>
                        <span>{cat}</span><span>{fmt(subtotal)}</span>
                      </div>
                      {gs.map((g, i) => (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between',
                          alignItems:'center', padding:'9px 18px',
                          borderBottom:'1px solid #f3f4f6', fontSize:12 }}>
                          <div>
                            <div>{g.concepto}</div>
                            {g.proveedor_nombre && (
                              <div style={{ fontSize:11, color:GR }}>{g.proveedor_nombre}
                                {g.comprobante && ` · ${g.comprobante}`}
                              </div>
                            )}
                          </div>
                          <div style={{ fontWeight:600, whiteSpace:'nowrap', marginLeft:12 }}>
                            {fmt(parseFloat(g.monto)||0)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
                <div style={{ display:'flex', justifyContent:'space-between',
                  padding:'12px 18px', background:'#374151', color:'#fff', fontWeight:700 }}>
                  <span>TOTAL GASTOS CONSORCIO</span>
                  <span>{fmt(totalGastos)}</span>
                </div>
              </div>
            )}
          </div>

          {bloqueComoPagar}

          <button onClick={abrirPDFCompleto} disabled={generandoPDF || loadingGastos}
            style={{ width:'100%', padding:'13px', background:'#374151', color:'#fff',
              border:'none', borderRadius:12, fontWeight:700, fontSize:14,
              cursor:'pointer', marginBottom:10 }}>
            {generandoPDF ? '⏳ Generando...' : '📄 Ver planilla completa PDF (imprimible)'}
          </button>

          <button onClick={() => { setPeriodoExpandido(null); setGastosPeriodo([]); setComprobantesPeriodo([]) }}
            style={{ width:'100%', padding:'13px', background:AZ, color:'#fff',
              border:'none', borderRadius:12, fontWeight:700, fontSize:14, cursor:'pointer' }}>
            ← Volver al portal
          </button>
        </div>
      </div>
    )
  }

  // ── Vista principal del portal ─────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff',
      fontFamily:'Segoe UI,Arial,sans-serif', paddingBottom:48 }}>
      <Head>
        <title>Portal — {coprop?.apellido_nombre || 'Copropietario'} · GASP</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>

      {/* Header */}
      <div style={{ background:AZ, color:'#fff', padding:'16px 18px',
        position:'sticky', top:0, zIndex:10, boxShadow:'0 2px 8px #0003' }}>
        <div style={{ maxWidth:680, margin:'0 auto', display:'flex',
          alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:36, height:36, background:'rgba(255,255,255,0.15)',
              borderRadius:8, display:'flex', alignItems:'center',
              justifyContent:'center', fontSize:16, fontWeight:900 }}>G</div>
            <div>
              <div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Administración Pinamar
              </div>
              <div style={{ fontSize:15, fontWeight:700 }}>Portal del Copropietario</div>
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:10, opacity:0.7 }}>Unidad</div>
            <div style={{ fontSize:20, fontWeight:800 }}>{unidad?.numero}</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:680, margin:'0 auto', padding:'16px 14px' }}>

        {/* Tarjeta identidad */}
        <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
          marginBottom:14, boxShadow:'0 2px 12px #0001', borderLeft:`4px solid ${AZ}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:2 }}>Copropietario</div>
              <div style={{ fontWeight:700, fontSize:17 }}>{coprop?.apellido_nombre || '—'}</div>
              <div style={{ fontSize:12, color:GR, marginTop:5, display:'flex', gap:8, flexWrap:'wrap' }}>
                <span style={{ background:'#f0f4ff', color:AZ, borderRadius:6,
                  padding:'2px 10px', fontWeight:600 }}>
                  Unidad {unidad?.numero}
                </span>
                <span style={{ textTransform:'capitalize' }}>{unidad?.tipo}</span>
                {unidad?.piso && <span>Piso {unidad.piso}</span>}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:GR }}>Consorcio</div>
              <div style={{ fontWeight:600, fontSize:12, color:'#374151', lineHeight:1.4, maxWidth:170 }}>
                {consorcio?.nombre}
              </div>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
          <div style={{ background: estaAlDia ? '#dcfce7' : '#fee2e2',
            borderRadius:14, padding:'16px 18px', textAlign:'center' }}>
            <div style={{ fontSize:10, color: estaAlDia ? VD : RJ, fontWeight:700,
              textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
              {estaAlDia ? 'Estado' : 'Saldo pendiente'}
            </div>
            <div style={{ fontSize:22, fontWeight:800, color: estaAlDia ? VD : RJ }}>
              {estaAlDia ? '✓ Al día' : fmt(deudaReal)}
            </div>
          </div>
          <div style={{ background:'#fff', borderRadius:14, padding:'16px 18px',
            textAlign:'center', boxShadow:'0 2px 8px #0001' }}>
            <div style={{ fontSize:10, color:GR, fontWeight:700,
              textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
              Último pago
            </div>
            {ultimoPago ? (
              <>
                <div style={{ fontSize:20, fontWeight:800, color:VD }}>{fmt(ultimoPago.monto)}</div>
                <div style={{ fontSize:11, color:GR, marginTop:2 }}>{fmtD(ultimoPago.fecha)}</div>
              </>
            ) : (
              <div style={{ fontSize:13, color:GR, marginTop:4 }}>Sin pagos</div>
            )}
          </div>
        </div>

        {/* ── ACCESO RÁPIDO DRIVE (si existe) ── */}
        {driveFolderUrl && (
          <a href={driveFolderUrl} target="_blank" rel="noreferrer"
            style={{ display:'flex', alignItems:'center', gap:14, padding:'16px 20px',
              background:'linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)',
              border:'1.5px solid #86efac', borderRadius:14, marginBottom:14,
              textDecoration:'none', boxShadow:'0 2px 8px #0001' }}>
            <div style={{ width:44, height:44, background:'#16a34a', borderRadius:10,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:22, flexShrink:0 }}>
              📁
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:14, color:'#14532d' }}>
                Documentación del consorcio
              </div>
              <div style={{ fontSize:12, color:'#166534', marginTop:2, lineHeight:1.4 }}>
                Acceda al reglamento de propiedad, planos, actas de asamblea y liquidaciones históricas
              </div>
            </div>
            <div style={{ color:'#16a34a', fontSize:20, fontWeight:700 }}>›</div>
          </a>
        )}

        {/* Tabs — incluye "Documentos" si hay Drive */}
        <div style={{ display:'flex', gap:4, marginBottom:14,
          background:'#fff', borderRadius:12, padding:4, boxShadow:'0 2px 8px #0001',
          overflowX:'auto' }}>
          {[
            { id:'cuenta',    label:'📋 Expensas' },
            { id:'ctacte',    label:'📊 Cta. corriente' },
            { id:'pagos',     label:'💳 Pagos' },
            { id:'informar',  label:'📤 Informar pago' },
            ...(sumEspacios.length ? [{ id:'sum', label:'🏖️ Reservas' }] : []),
            ...(driveFolderUrl ? [{ id:'documentos', label:'📁 Documentos' }] : []),
            { id:'reclamos',  label:'🎫 Reclamos' },
            { id:'contacto',  label:'📞 Contacto' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ flex:'1 0 auto', padding:'9px 8px', border:'none', cursor:'pointer',
                borderRadius:9, fontSize:12, fontWeight: tab===t.id ? 700 : 500,
                background: tab===t.id ? AZ : 'transparent',
                color: tab===t.id ? '#fff' : GR, whiteSpace:'nowrap' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB: CUENTA CORRIENTE */}
        {tab === 'cuenta' && (
          <div id="cuenta-corriente">
            {bloqueComoPagar}
            {detOrdenados.length === 0 ? (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>Sin movimientos registrados</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {detOrdenados.map((d, idx) => {
                  const s      = saldoDetReal(d)
                  const monto  = parseFloat(d.monto)||0
                  const salAnt = parseFloat(d.saldo_anterior)||0
                  const mora   = parseFloat(d.interes_mora)||0
                  const pagado = pagadoReal(d)
                  const esPag  = d.estado === 'pagada' || s <= 0.005
                  const esMor  = d.estado === 'morosa'
                  const per    = d.con_expensas?.periodo || ''
                  return (
                    <div key={d.id} id={`liquidacion-${per}`}
                      style={{ background:'#fff', borderRadius:12,
                        border:`1.5px solid ${esPag ? '#86efac' : esMor ? '#fca5a5' : '#fde68a'}`,
                        overflow:'hidden', boxShadow:'0 1px 6px #0001' }}>
                      <div style={{ display:'flex', justifyContent:'space-between',
                        alignItems:'center', padding:'12px 16px',
                        background: esPag ? '#f0fdf4' : esMor ? '#fff5f5' : '#fffbeb' }}>
                        <div>
                          <span style={{ fontWeight:700, fontSize:15 }}>
                            {periodoLabel(per)}
                          </span>
                          <span style={{ marginLeft:8, fontSize:10, padding:'2px 9px',
                            borderRadius:8, fontWeight:700,
                            background: esPag ? '#dcfce7' : esMor ? '#fee2e2' : '#fef9c3',
                            color: esPag ? VD : esMor ? RJ : AM }}>
                            {esPag ? '✓ Pagada' : esMor ? 'Morosa' : 'Pendiente'}
                          </span>
                          {idx === 0 && (
                            <span style={{ marginLeft:6, fontSize:9, padding:'1px 7px',
                              borderRadius:6, background:AZ, color:'#fff', fontWeight:600 }}>
                              ACTUAL
                            </span>
                          )}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ fontWeight:800, fontSize:16,
                            color: esPag ? VD : s > 0 ? RJ : GR }}>
                            {esPag ? '✓' : fmt(s)}
                          </div>
                          <button onClick={() => expandirPeriodo(per)}
                            style={{ background:AZ, color:'#fff', border:'none',
                              borderRadius:7, padding:'5px 11px', fontSize:11,
                              fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                            📋 Ver
                          </button>
                        </div>
                      </div>
                      <div style={{ padding:'10px 16px 14px',
                        display:'grid', gridTemplateColumns:'1fr 1fr',
                        gap:'6px 16px', fontSize:12, color:GR }}>
                        {monto > 0 && <div>Expensa: <strong style={{ color:'#374151' }}>{fmt(monto)}</strong></div>}
                        {salAnt > 0 && <div>Saldo ant.: <strong style={{ color:RJ }}>{fmt(salAnt)}</strong></div>}
                        {mora > 0 && <div>Interés mora: <strong style={{ color:AM }}>{fmt(mora)}</strong></div>}
                        {pagado > 0 && <div>Pagado: <strong style={{ color:VD }}>{fmt(pagado)}</strong></div>}
                        {d.con_expensas?.fecha_vencimiento && (
                          <div>Vto.: <strong style={{ color:'#374151' }}>{fmtD(d.con_expensas.fecha_vencimiento)}</strong></div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB: CUENTA CORRIENTE (movimientos) */}
        {tab === 'ctacte' && (
          <div id="cta-corriente">
            {loadingCta ? (
              <div style={{ textAlign:'center', padding:32, color:GR }}>⏳ Cargando...</div>
            ) : movsCta.length === 0 ? (
              <div style={{ background:'#fff', borderRadius:14, padding:32, textAlign:'center', color:GR }}>
                <div style={{ fontSize:28, marginBottom:8 }}>📊</div>
                {errorCta && (
                  <div style={{ fontSize:13, color:RJ, marginBottom:12 }}>{errorCta}</div>
                )}
                <button onClick={() => cargarCtaCte(unidad.id)}
                  style={{ background:AZ, color:'#fff', border:'none', borderRadius:9,
                    padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Cargar cuenta corriente
                </button>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px', boxShadow:'0 2px 12px #0001' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                  <div style={{ fontWeight:700, fontSize:14 }}>📊 Cuenta corriente</div>
                  <div style={{ fontWeight:800, fontSize:15,
                    color: movsCta[movsCta.length-1]?.saldo > 0 ? RJ : VD }}>
                    Saldo: {movsCta[movsCta.length-1]?.saldo > 0
                      ? `Debe ${fmt(movsCta[movsCta.length-1].saldo)}`
                      : movsCta[movsCta.length-1]?.saldo < 0
                        ? `A favor ${fmt(Math.abs(movsCta[movsCta.length-1].saldo))}`
                        : 'Al día ✓'}
                  </div>
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ background:'#f3f4f6', textAlign:'left' }}>
                        <th style={{ padding:'7px 10px', fontWeight:600 }}>Fecha</th>
                        <th style={{ padding:'7px 10px', fontWeight:600 }}>Concepto</th>
                        <th style={{ padding:'7px 10px', textAlign:'right', fontWeight:600 }}>Débito</th>
                        <th style={{ padding:'7px 10px', textAlign:'right', fontWeight:600 }}>Crédito</th>
                        <th style={{ padding:'7px 10px', textAlign:'right', fontWeight:600 }}>Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movsCta.map((m,i) => (
                        <tr key={i} style={{ borderBottom:'1px solid #f3f4f6',
                          background: m.tipo==='credito' ? '#f0fdf4' : '#fff' }}>
                          <td style={{ padding:'7px 10px', whiteSpace:'nowrap' }}>{fmtD2(m.fecha)}</td>
                          <td style={{ padding:'7px 10px' }}>{m.concepto}{m.nro ? ` — N° ${m.nro}` : ''}</td>
                          <td style={{ padding:'7px 10px', textAlign:'right', color:RJ, fontWeight:600 }}>
                            {m.tipo==='debito' ? fmt(m.monto) : ''}
                          </td>
                          <td style={{ padding:'7px 10px', textAlign:'right', color:VD, fontWeight:600 }}>
                            {m.tipo==='credito' ? fmt(m.monto) : ''}
                          </td>
                          <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700,
                            color: m.saldo > 0 ? RJ : m.saldo < 0 ? VD : GR }}>
                            {fmt(Math.abs(m.saldo))}{m.saldo < 0 ? ' CR' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {movsCta.length === 0 && !loadingCta && unidad && (
              <div style={{ marginTop:10 }}>
                <button onClick={() => cargarCtaCte(unidad.id)}
                  style={{ width:'100%', background:AZ, color:'#fff', border:'none',
                    borderRadius:10, padding:'12px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Cargar cuenta corriente
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB: INFORMAR PAGO */}
        {tab === 'informar' && (
          <div id="informar-pago">
            <div style={{ background:'#fff', borderRadius:14, padding:'20px', boxShadow:'0 2px 12px #0001' }}>
              <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:4 }}>📤 Informar pago de expensas</div>
              <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
                Complete el formulario para notificar al administrador sobre un pago realizado.
                El administrador verificará y acreditará el pago en su cuenta.
              </div>
              {msgPago && (
                <div style={{ padding:'12px', borderRadius:9, marginBottom:14, fontSize:13,
                  background: msgPago.tipo==='ok' ? '#f0fdf4' : msgPago.tipo==='warn' ? '#fffbeb' : '#fff1f2',
                  color: msgPago.tipo==='ok' ? VD : msgPago.tipo==='warn' ? AM : RJ,
                  border: '1px solid ' + (msgPago.tipo==='ok' ? '#86efac' : msgPago.tipo==='warn' ? '#fde68a' : '#fca5a5') }}>
                  {msgPago.texto}
                </div>
              )}
              {!msgPago && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Monto pagado *</div>
                    <input type="number" placeholder="Ej: 150000.00"
                      value={formPago?.monto||''} onChange={e=>setFormPago(f=>({...f,monto:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Fecha del pago *</div>
                    <input type="date" value={formPago?.fecha||''}
                      onChange={e=>setFormPago(f=>({...f,fecha:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Medio de pago</div>
                    <select value={formPago?.medio||'transferencia'}
                      onChange={e=>setFormPago(f=>({...f,medio:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box', background:'#fff' }}>
                      <option value="transferencia">Transferencia bancaria</option>
                      <option value="efectivo">Efectivo</option>
                      <option value="cheque_propio">Cheque propio</option>
                      <option value="plataforma">Plataforma de pagos (EP / SIRO)</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>N° de comprobante / referencia</div>
                    <input type="text" placeholder="Número de transferencia, recibo, etc."
                      value={formPago?.comprobante||''}
                      onChange={e=>setFormPago(f=>({...f,comprobante:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Observaciones</div>
                    <textarea placeholder="Aclaraciones adicionales..." rows={3}
                      value={formPago?.obs||''}
                      onChange={e=>setFormPago(f=>({...f,obs:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box', resize:'vertical' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>
                      Comprobante {ADJUNTO_PAGO_OBLIGATORIO ? '*' : '(opcional)'} — imagen o PDF (máx. 4 MB)
                    </div>
                    <input type="file" accept="image/*,application/pdf"
                      onChange={e=>setArchivoPago(e.target.files?.[0]||null)}
                      style={{ width:'100%', fontSize:12, padding:'8px 0' }} />
                    {archivoPago && <div style={{ fontSize:11, color:VD, marginTop:4 }}>📎 {archivoPago.name}</div>}
                  </div>
                  <div style={{ padding:'10px 12px', background:'#eff6ff', borderRadius:8, fontSize:11, color:'#1e40af' }}>
                    ℹ️ Los pagos realizados por Expensas Pagas o SIRO se acreditan automáticamente y no requieren aviso.
                  </div>
                  <button onClick={enviarNotificacionPago} disabled={enviandoPago}
                    style={{ background: enviandoPago ? GR : AZ, color:'#fff', border:'none',
                      borderRadius:10, padding:'13px', fontSize:14, fontWeight:700,
                      cursor: enviandoPago ? 'default' : 'pointer' }}>
                    {enviandoPago ? '⏳ Enviando...' : '📤 Enviar aviso de pago'}
                  </button>
                </div>
              )}
              {msgPago?.tipo === 'ok' && (
                <button onClick={() => { setMsgPago(null); setFormPago({}) }}
                  style={{ width:'100%', marginTop:12, background:'#f3f4f6', color:'#374151',
                    border:'none', borderRadius:10, padding:'12px', fontSize:13, cursor:'pointer' }}>
                  Informar otro pago
                </button>
              )}
            </div>
          </div>
        )}

        {/* TAB: PAGOS */}
        {tab === 'pagos' && (
          <div id="pagos">
            {cobranzas.length === 0 ? (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>
                <div style={{ fontSize:28, marginBottom:8 }}>💳</div>
                <div>Sin pagos registrados</div>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
                boxShadow:'0 2px 12px #0001' }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Historial de pagos</div>
                {cobranzas.map((c, i) => (
                  <div key={c.id} style={{ display:'flex', justifyContent:'space-between',
                    alignItems:'center', padding:'11px 0',
                    borderBottom: i < cobranzas.length-1 ? '1px solid #f3f4f6' : 'none' }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:13 }}>
                        {periodoLabel(c.con_expensas?.periodo)}
                      </div>
                      <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                        {fmtD(c.fecha)}
                        {c.medio_pago && <span style={{ marginLeft:8, textTransform:'capitalize' }}>· {c.medio_pago}</span>}
                        {(c.nro_recibo || c.recibo_numero) && <span style={{ marginLeft:6 }}>· Rec. {c.nro_recibo || c.recibo_numero}</span>}
                      </div>
                      {c.observaciones && <div style={{ fontSize:11, color:GR }}>{c.observaciones}</div>}
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontWeight:800, fontSize:16, color:VD }}>{fmt(c.monto)}</div>
                      <button onClick={() => generarReciboCob(c)} style={{ marginTop:5, background:'#1A3FA0', color:'#fff', border:'none', borderRadius:6, padding:'5px 11px', fontSize:11, fontWeight:600, cursor:'pointer' }}>🧾 Recibo</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: DOCUMENTOS */}
        {tab === 'documentos' && (
          <div id="documentos">
            {driveFolderUrl ? (
              <div>
                {/* Botón principal */}
                <a href={driveFolderUrl} target="_blank" rel="noreferrer"
                  style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                    padding:'18px 20px', background:'#16a34a', color:'#fff',
                    textDecoration:'none', borderRadius:14, fontWeight:700, fontSize:16,
                    marginBottom:16, boxShadow:'0 4px 16px #16a34a33' }}>
                  <span style={{ fontSize:24 }}>📁</span>
                  Abrir carpeta de documentos del consorcio
                  <span style={{ fontSize:16, opacity:0.7 }}>↗</span>
                </a>

                {/* Descripción de contenidos */}
                <div style={{ background:'#fff', borderRadius:14, padding:'20px',
                  boxShadow:'0 2px 12px #0001', marginBottom:14 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:'#14532d', marginBottom:14 }}>
                    📂 Documentos disponibles en la carpeta
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {[
                      { icon:'📜', title:'Reglamento de propiedad horizontal',
                        desc:'Documento constitutivo del consorcio. Establece los derechos y obligaciones de cada propietario.' },
                      { icon:'🗓️', title:'Actas de asambleas',
                        desc:'Registro de todas las reuniones de propietarios, decisiones tomadas y votaciones.' },
                      { icon:'📐', title:'Planos del edificio',
                        desc:'Planos originales y actualizaciones de la propiedad.' },
                      { icon:'📊', title:'Liquidaciones históricas',
                        desc:'Liquidaciones de expensas de períodos anteriores en formato PDF.' },
                      { icon:'📋', title:'Contratos y pólizas',
                        desc:'Seguros vigentes, contratos de mantenimiento y otros documentos operativos.' },
                    ].map(({ icon, title, desc }) => (
                      <div key={title} style={{ display:'flex', gap:12, padding:'12px',
                        background:'#f9fafb', borderRadius:10, border:'1px solid #e5e7eb' }}>
                        <div style={{ fontSize:24, flexShrink:0 }}>{icon}</div>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13, color:'#111', marginBottom:3 }}>{title}</div>
                          <div style={{ fontSize:12, color:GR, lineHeight:1.5 }}>{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Nota acceso */}
                <div style={{ padding:'12px 16px', background:'#fffbeb', border:'1px solid #fde68a',
                  borderRadius:10, fontSize:12, color:'#92400e' }}>
                  ℹ️ Para acceder necesita una cuenta Google. Si no tiene acceso a algún documento,
                  contacte a su administrador.
                </div>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>
                <div style={{ fontSize:36, marginBottom:12 }}>📁</div>
                <div style={{ fontWeight:600, marginBottom:8 }}>Documentación no disponible</div>
                <div style={{ fontSize:13 }}>
                  La administración aún no ha configurado la carpeta de documentos para este consorcio.
                  Contacte al administrador.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab Reclamos */}
        {/* TAB: RESERVAS SUM / AMENITIES */}
        {tab === 'sum' && (
          <div>
            {sumEspacios.some(e => e.permite_invitados) && (
              <div style={{ background:'#fff', borderRadius:14, padding:16, boxShadow:'0 2px 8px #0001', marginBottom:12 }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:6 }}>🔑 Link para inquilino</div>
                <div style={{ fontSize:12, color:GR, marginBottom:8 }}>Genera un acceso que permite <b>solo reservar</b> el espacio común (no ve tu cuenta ni tus expensas). Podés revocarlo cuando quieras.</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                  <input value={sumInvNota} onChange={e=>setSumInvNota(e.target.value)} placeholder="Nota (ej. inquilino verano, opcional)"
                    style={{ flex:1, minWidth:160, padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13 }} />
                  <button onClick={crearInv} style={{ padding:'8px 14px', border:'none', borderRadius:8, background:AZ, color:'#fff', fontWeight:600, cursor:'pointer' }}>Generar link</button>
                </div>
                {sumInvs.filter(i=>i.vigente).length === 0
                  ? <div style={{ fontSize:12, color:GR }}>Sin links activos.</div>
                  : sumInvs.filter(i=>i.vigente).map(i => (
                      <div key={i.id} style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', padding:'6px 0', borderTop:'1px solid #f1f5f9' }}>
                        <span style={{ fontSize:12, color:GR, flex:1, minWidth:140, wordBreak:'break-all' }}>{linkInv(i.token)}</span>
                        {i.expira && <span style={{ fontSize:11, color:GR }}>vence {i.expira}</span>}
                        <button onClick={()=>copiarInv(i.token)} style={{ padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:7, background:'#fff', cursor:'pointer', fontSize:12 }}>Copiar</button>
                        <button onClick={()=>revocarInv(i.id)} style={{ padding:'6px 10px', border:'none', borderRadius:7, background:'#fee2e2', color:RJ, cursor:'pointer', fontSize:12 }}>Revocar</button>
                      </div>
                    ))}
              </div>
            )}
            {sumEspacios.length > 1 && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
                {sumEspacios.map(e => (
                  <button key={e.id} onClick={()=>{ setSumEspSel(e); setSumFecha(''); setSumFranja('') }}
                    style={{ padding:'8px 12px', borderRadius:10, border:`1.5px solid ${sumEspSel?.id===e.id?AZ:'#e5e7eb'}`,
                      background: sumEspSel?.id===e.id?'#eff6ff':'#fff', cursor:'pointer', fontSize:13 }}>
                    {e.nombre}{e.requiere_pago ? ` · $${Number(e.tarifa).toLocaleString('es-AR')}` : ''}
                  </button>
                ))}
              </div>
            )}
            {sumEspSel && (
              <div style={{ background:'#fff', borderRadius:14, padding:18, boxShadow:'0 2px 8px #0001' }}>
                <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>🏖️ {sumEspSel.nombre}</div>
                {sumEspSel.requiere_pago &&
                  <div style={{ fontSize:13, color:GR, marginBottom:8 }}>Uso con cargo: ${Number(sumEspSel.tarifa).toLocaleString('es-AR')}</div>}
                {sumMsg && (
                  <div style={{ margin:'8px 0', padding:'8px 12px', borderRadius:8, fontSize:13,
                    background: sumMsg.t==='ok'?'#f0fdf4':sumMsg.t==='error'?'#fef2f2':'#fffbeb',
                    color: sumMsg.t==='ok'?'#166534':sumMsg.t==='error'?'#991b1b':'#92400e' }}>{sumMsg.m}</div>
                )}

                {sumUltima?.pago_requerido && (
                  <div style={{ border:'1px dashed #fca5a5', borderRadius:10, padding:12, margin:'8px 0', background:'#fff8f8' }}>
                    <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>Subí el comprobante del pago</div>
                    <input type="file" accept="image/*,application/pdf" onChange={e=>setSumArchivo(e.target.files?.[0]||null)} />
                    <div style={{ marginTop:8 }}>
                      <button disabled={!sumArchivo||sumEnviando} onClick={subirComprobanteSum}
                        style={{ padding:'8px 14px', border:'none', borderRadius:8, background:AZ, color:'#fff', fontWeight:600,
                          cursor:(!sumArchivo||sumEnviando)?'default':'pointer', opacity:(!sumArchivo||sumEnviando)?0.6:1 }}>
                        Enviar comprobante
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ fontSize:13, fontWeight:600, margin:'10px 0 6px' }}>Elegí un día disponible</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', maxHeight:200, overflowY:'auto', marginBottom:10 }}>
                  {sumDiasDisponibles().length === 0
                    ? <div style={{ color:GR, fontSize:13 }}>No hay días disponibles por ahora.</div>
                    : sumDiasDisponibles().map(d => (
                        <button key={d.ymd} onClick={()=>{ setSumFecha(d.ymd); setSumDesde(''); setSumHasta(''); setSumRecurso('') }}
                          style={{ padding:'8px 10px', borderRadius:9, border:`1.5px solid ${sumFecha===d.ymd?AZ:'#e5e7eb'}`,
                            background: sumFecha===d.ymd?'#eff6ff':'#fff', cursor:'pointer', fontSize:12 }}>
                          {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.dow]} {d.ymd.slice(8,10)}/{d.ymd.slice(5,7)}
                        </button>
                      ))}
                </div>

                {sumFecha && (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:12, color:GR, marginBottom:6 }}>
                      Horario habilitado: {sumVentanasDe(sumFecha).map(w => String(w.hora_inicio).slice(0,5) + '–' + (w.hora_fin <= w.hora_inicio ? '24:00' : String(w.hora_fin).slice(0,5))).join(' · ') || '—'}
                    </div>
                    {sumOcupadasDe(sumFecha).length > 0 && (
                      <div style={{ fontSize:12, color:RJ, marginBottom:8 }}>Ocupado: {sumOcupadasDe(sumFecha).join(' · ')}</div>
                    )}
                    <div style={{ fontSize:13, fontWeight:600, margin:'6px 0' }}>Elegí tu horario</div>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                      <span style={{ fontSize:12, color:GR }}>Desde</span>
                      <input type="time" step="1800" value={sumDesde} onChange={e=>setSumDesde(e.target.value)}
                        style={{ padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13 }} />
                      <span style={{ fontSize:12, color:GR }}>Hasta</span>
                      <input type="time" step="1800" value={sumHasta} onChange={e=>setSumHasta(e.target.value)}
                        style={{ padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13 }} />
                    </div>
                    {(sumEspSel.capacidad || 1) > 1 && (
                      <div style={{ marginTop:8 }}>
                        <span style={{ fontSize:12, color:GR, marginRight:6 }}>Unidad</span>
                        <select value={sumRecurso} onChange={e=>setSumRecurso(e.target.value)}
                          style={{ padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13 }}>
                          <option value="">Cualquiera disponible</option>
                          {Array.from({ length: sumEspSel.capacidad || 1 }, (_, i) => i + 1).map(n => (
                            <option key={n} value={n}>{sumLabelRec(n)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                <button disabled={!sumFecha||!sumDesde||!sumHasta||sumEnviando} onClick={reservarSum}
                  style={{ width:'100%', padding:'12px', border:'none', borderRadius:10, background:VD, color:'#fff',
                    fontWeight:700, fontSize:14, cursor:(!sumFecha||!sumDesde||!sumHasta||sumEnviando)?'default':'pointer',
                    opacity:(!sumFecha||!sumDesde||!sumHasta||sumEnviando)?0.6:1 }}>
                  {sumEnviando ? 'Procesando…' : 'Reservar'}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'reclamos' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ background:'#fff', borderRadius:14, padding:20, boxShadow:'0 2px 12px #0001' }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>🎫 Reclamos y Consultas</div>
              <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
                Enviá un reclamo o consulta al administrador. Te responderemos a la brevedad.
              </div>
              <Reclamo
                unidadId={unidad?.id}
                copropietarioId={coprop?.id}
                consorcioId={unidad?.consorcio_id}
                adminEmail={adminPerfil?.email}
                adminId={unidad?.admin_id}
                token={token}
              />
            </div>
          </div>
        )}

        {/* TAB: CONTACTO */}
        {tab === 'contacto' && (
          <div>
            {adminPerfil ? (
              <div style={{ background:'#fff', borderRadius:14, padding:20,
                boxShadow:'0 2px 12px #0001' }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>📞 Administración</div>
                <div style={{ display:'flex', flexDirection:'column', gap:12, fontSize:14 }}>
                  <div style={{ fontWeight:700, fontSize:15 }}>
                    {adminPerfil.nombre}
                    {adminPerfil.matricula_rpac && (
                      <span style={{ marginLeft:8, fontSize:12, color:GR, fontWeight:400 }}>
                        RPAC N° {adminPerfil.matricula_rpac}
                      </span>
                    )}
                  </div>
                  {adminPerfil.direccion && <div style={{ color:GR }}>📍 {adminPerfil.direccion}</div>}
                  {adminPerfil.telefono && (
                    <a href={`tel:${adminPerfil.telefono}`}
                      style={{ color:AZ, textDecoration:'none', fontWeight:600, display:'block',
                        background:'#eff6ff', padding:'10px 14px', borderRadius:8 }}>
                      📱 {adminPerfil.telefono}
                    </a>
                  )}
                  {adminPerfil.telefono && (
                    <a href={`https://wa.me/${adminPerfil.telefono?.replace(/\D/g,'')}`}
                      target="_blank" rel="noopener"
                      style={{ color:'#fff', textDecoration:'none', display:'block',
                        background:'#25D366', padding:'10px 16px', borderRadius:8,
                        fontWeight:700, textAlign:'center' }}>
                      💬 Contactar por WhatsApp
                    </a>
                  )}
                  {adminPerfil.email && (
                    <a href={`mailto:${adminPerfil.email}`}
                      style={{ color:AZ, textDecoration:'none', fontWeight:600 }}>
                      ✉ {adminPerfil.email}
                    </a>
                  )}
                  {adminPerfil.horario && (
                    <div style={{ fontSize:12, color:GR, background:'#f9fafb',
                      padding:'8px 12px', borderRadius:8 }}>
                      🕐 {adminPerfil.horario}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>Sin datos de contacto</div>
            )}
          </div>
        )}

        <div style={{ textAlign:'center', marginTop:28, fontSize:10, color:GR }}>
          Portal del copropietario · GASP Consorcios · administracionpinamar.com
        </div>
      </div>
    </div>
  )
}
