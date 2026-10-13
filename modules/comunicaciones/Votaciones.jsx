// modules/comunicaciones/Votaciones.jsx — §60 Votaciones (lado admin).
// Tipos: consulta | ausentes_2060 (art. 2060 CCyC) | unanimidad_2059 (art. 2059 CCyC).
// Toda la lógica crítica (padrón congelado, ventana, presentes, cambio de voto, escrutinio con
// doble cómputo UF + coeficiente sobre la totalidad) vive en las RPC vot_* de la BD.
// Este módulo: alta en borrador → abrir → notificar → seguimiento → cerrar → acta de escrutinio.
// Opera SOLO sobre votaciones del consorcio activo (regla §56: nada de registros de otro consorcio).
// Controles nativos (input/select): el Input/Sel de components/ui reenvía el VALOR, no el evento.

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, VD, RJ, AM, GR } from '../../lib/config'
import { exportarExcel } from '../../lib/exportExcel'
import { Btn, BtnSec, Card, Msg } from '../../components/ui'

const TZ = 'America/Argentina/Buenos_Aires'
const INP = { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', width: '100%' }
const LBL = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }

const TIPOS = {
  consulta:        { l: 'Consulta a propietarios', d: 'Relevamiento sobre una propuesta (presupuesto, proyecto, etc.). Admite opciones múltiples.' },
  ausentes_2060:   { l: 'Ausentes — art. 2060 CCyC', d: 'Decisión propuesta por la mayoría de presentes en asamblea, comunicada a los ausentes. Se tiene por aprobada a los 15 días salvo oposición con mayoría suficiente.' },
  unanimidad_2059: { l: 'Unanimidad sin asamblea — art. 2059 CCyC', d: 'Solo se aprueba con el SÍ de la totalidad de las unidades.' },
}
const MAYORIAS = {
  simple_votantes: 'Simple de votantes (solo consulta)',
  absoluta:        'Absoluta sobre la totalidad (art. 2060)',
  dos_tercios:     'Dos tercios de la totalidad',
  unanimidad:      'Unanimidad',
}
const CAMPOS_COEF = ['porcentaje_fiscal', 'pct_gtos_grales', 'pct_fdo_obras', 'pct_cochera', 'pct_gtos_part']
const EST_COLOR = { borrador: GR, abierta: VD, cerrada: AZ, anulada: RJ }
const RESULTADO = {
  en_curso: 'En curso', aprobada: 'Aprobada', no_aprobada: 'No aprobada',
  aprobada_expresa: 'Aprobada (mayoría expresa)', aprobada_tacita: 'Aprobada (silencios a favor, sin oposición suficiente)',
  rechazada_por_oposicion: 'Rechazada por oposición', opcion_ganadora: 'Opción ganadora',
  sin_mayoria: 'Sin mayoría', sin_definicion: 'Sin definición (empate)', sin_votos: 'Sin votos', sin_padron: 'Sin padrón',
}
const ORIGEN = { portal: 'Portal', admin: 'Mail / nota', asamblea: 'Asamblea' }

// §60.8 — identificación de UF presentes desde con_asambleas.unidades_presentes (regla §56:
// match EXACTO normalizado, nunca substring; prioridad numero_interno → numero → descripcion).
const normUF = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^0+(?=\d)/, '')
function matchPresentesUF(etiquetas, unidades) {
  const ids = new Set(), noRec = [], ambig = []
  for (const raw of etiquetas || []) {
    const n = normUF(raw)
    if (!n) continue
    let c = (unidades || []).filter((u) => u.numero_interno && normUF(u.numero_interno) === n)
    if (!c.length) c = (unidades || []).filter((u) => !u.numero_interno && normUF(u.numero) === n)
    if (!c.length) c = (unidades || []).filter((u) => normUF(u.numero) === n || normUF(u.descripcion) === n)
    if (c.length === 1) ids.add(c[0].id)
    else if (c.length > 1) ambig.push(String(raw))
    else noRec.push(String(raw))
  }
  return { ids: [...ids], noRec, ambig }
}
const fD = (iso) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return String(iso) }
}
const fDf = (ymd) => (ymd ? String(ymd).split('-').reverse().join('/') : '—')
const APROB = ['aprobada', 'aprobada_expresa', 'aprobada_tacita', 'opcion_ganadora']
const nUF = (n) => `${n} UF`
const pcts = (x) => `${x.pct_uf}% de las unidades y ${x.pct_coef}% de los porcentuales`

// §60.9 — Detalle del resultado art. 2060 (silencios a favor, oposición acumulada)
function detalle2060(v, e) {
  const a = e?.art2060
  if (!a) return `Resultado: ${RESULTADO[e?.resultado] || e?.resultado || '—'}.`
  const P = a.presentes, A = a.ausentes, F = a.favor, O = a.oposicion
  const t = []
  t.push(`votaron a favor ${nUF(P.si.uf)} presentes${A.si.uf ? ` y ${nUF(A.si.uf)} ausentes en forma expresa` : ''}`)
  if (a.silencio_positivo) t.push(`${nUF(A.silencio.uf)} ausentes no formularon oposición dentro del plazo (silencio computado a favor, art. 263 CCyC)`)
  else t.push(`${nUF(A.silencio.uf)} ausentes no contestaron; por tratarse de supresión o limitación de derechos (art. 2061 CCyC) el silencio no se computa a favor`)
  if (A.no.uf || P.no.uf) {
    t.push(`se recibieron ${A.no.uf} oposiciones de ausentes${P.no.uf ? `, que sumadas a los ${P.no.uf} votos negativos de los presentes totalizan ${nUF(O.uf)}` : ''} (${pcts(O)}), ${O.mayoria_suficiente ? 'alcanzando' : 'sin alcanzar'} la mayoría suficiente para revertir la propuesta`)
  } else t.push('no se recibieron oposiciones')
  if (A.abstencion.uf || P.abstencion.uf) t.push(`${nUF(A.abstencion.uf + P.abstencion.uf)} se abstuvieron`)
  t.push(`en consecuencia la propuesta reúne ${nUF(F.uf)} (${pcts(F)})`)
  return t.join('; ') + '.'
}
function textoNotaCierre(items, asm, adminPerfil) {
  // items: [{ v, e }] con e = escrutinio final (resultado_final)
  const ap = items.filter((x) => APROB.includes(x.e?.resultado))
  const de = items.filter((x) => !APROB.includes(x.e?.resultado))
  const v0 = items[0]?.v
  const asmTxt = asm ? `la Asamblea ${asm.tipo === 'ordinaria' ? 'Ordinaria' : 'Extraordinaria'} del ${fDf(asm.fecha)}` : 'la asamblea'
  const plazo = v0 ? ` (notificación del ${fD(v0.apertura)}; plazo de quince días corridos vencido el ${fD(v0.cierre)})` : ''
  const lineas = items.map((x, i) => `${items.length > 1 ? (i + 1) + ') ' : ''}«${x.v.titulo}»${x.v.descripcion ? ' — ' + String(x.v.descripcion).trim().replace(/\s+/g, ' ') : ''}: ${detalle2060(x.v, x.e)} ${APROB.includes(x.e?.resultado) ? 'QUEDA APROBADA.' : 'QUEDA DESAPROBADA.'}`)
  let fin
  if (!de.length) fin = `por lo tanto quedan aprobados los puntos propuestos.`
  else if (!ap.length) fin = `por lo tanto quedan desaprobados los puntos propuestos.`
  else fin = `por lo tanto quedan aprobados los puntos: ${ap.map((x) => '«' + x.v.titulo + '»').join(', ')}; y desaprobados: ${de.map((x) => '«' + x.v.titulo + '»').join(', ')}.`
  const firma = [adminPerfil?.nombre, 'Administrador', adminPerfil?.matricula_rpac ? 'RPAC N° ' + adminPerfil.matricula_rpac : null].filter(Boolean).join(' — ')
  return `Dejo constancia que se comunicó fehacientemente a los propietarios ausentes, mediante los correos electrónicos registrados en el Libro de Propietarios, respecto de lo tratado en ${asmTxt}${plazo}.\n\n`
    + `Informo que:\n${lineas.join('\n')}\n\n`
    + `De acuerdo a lo establecido por las leyes vigentes (arts. 2060, 263 y 2061 del Código Civil y Comercial de la Nación), ${fin}\n\n${firma}`
}

// Art. 6 CCyC: en plazos de días se excluye el día de la notificación y el plazo vence a la
// medianoche del último día → cierre = (fecha de notificación + 15 días) a las 23:59.
function cierre2060(aperturaLocal) {
  const ymd = String(aperturaLocal || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ''
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 15)
  return d.toISOString().slice(0, 10) + 'T23:59'
}

const fechaAsmLocal = (asm) => (asm?.fecha ? `${asm.fecha}T${(asm.hora || '12:00').slice(0, 5)}` : '')

// datetime-local (hora AR) <-> ISO
const pad2 = (n) => String(n).padStart(2, '0')
function isoALocal(iso) {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() - 3 * 3600000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}
const localAIso = (v) => (v ? new Date(v + ':00-03:00').toISOString() : null)
const fF = (iso) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return String(iso) }
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const etiquetaUF = (u) => String(u?.numero_interno || u?.numero || u?.id || '').trim()
const errTxt = (e) => String(e?.message || e || 'Error').replace(/^VOT:\s*/, '')

const formVacio = () => {
  const ahora = new Date()
  const cierre = new Date(ahora.getTime() + 7 * 86400000)
  return {
    id: null, tipo: 'consulta', titulo: '', descripcion: '', mayoria: 'absoluta', campo_coef: 'porcentaje_fiscal',
    apertura: '', cierre: isoALocal(cierre.toISOString()), permite_cambio: true, requiere_otp: false,
    resultados_visibles: 'al_cierre', asamblea_id: '', adjuntos: [],
    opciones: [{ etiqueta: 'SÍ', clave: 'si', detalle: '' }, { etiqueta: 'NO', clave: 'no', detalle: '' }],
    multiple: false, presentes: [], modalidad: 'online', silencio_positivo: true,
  }
}

export default function Votaciones() {
  const app = useApp()
  const { session, consorcioActivo, unidades, adminPerfil } = app
  const puede = app.puede || (() => true)
  const consorcioId = consorcioActivo?.id
  const adminId = session?.user?.id

  const [lista, setLista]         = useState([])
  const [vista, setVista]         = useState('lista')   // lista | form | detalle
  const [form, setForm]           = useState(formVacio())
  const [detalle, setDetalle]     = useState(null)
  const [esc_, setEsc]            = useState(null)
  const [opcs, setOpcs]           = useState([])
  const [eventos, setEventos]     = useState([])
  const [asambleas, setAsambleas] = useState([])
  const [msg, setMsg]             = useState(null)
  const [ocupado, setOcupado]     = useState(false)
  const [subiendo, setSubiendo]   = useState(false)
  const [planilla, setPlanilla]   = useState([])     // §60.8 carga masiva de votos
  const [fechaDef, setFechaDef]   = useState('')     // fecha/hora de recepción por defecto
  const [presAviso, setPresAviso] = useState(null)   // UF presentes no reconocidas/ambiguas
  const [presentesSel, setPresentesSel] = useState([])
  const [notaTxt, setNotaTxt]     = useState('')     // §60.9 nota de cierre de la votación
  const [notaAsm, setNotaAsm]     = useState(null)   // §60.9 nota combinada de la asamblea { asm, texto, items }

  const puedeOperar = puede('comunicar') || puede('editar')

  const cargar = useCallback(async () => {
    if (!consorcioId) return
    const [{ data }, { data: asm }] = await Promise.all([
      supabase.from('con_votaciones').select('*').eq('consorcio_id', consorcioId).order('created_at', { ascending: false }),
      supabase.from('con_asambleas').select('id, consorcio_id, fecha, hora, tipo, estado, orden_del_dia, unidades_presentes').eq('consorcio_id', consorcioId).order('fecha', { ascending: false }).limit(30),
    ])
    setLista(data || []); setAsambleas(asm || [])
  }, [consorcioId])

  useEffect(() => { cargar(); setVista('lista'); setDetalle(null) }, [cargar])

  const abrirDetalle = useCallback(async (v) => {
    if (v.consorcio_id !== consorcioId) { setMsg({ tipo: 'error', texto: 'La votación pertenece a otro consorcio. Seleccione ese consorcio en el menú principal.' }); return }
    setDetalle(v); setVista('detalle'); setEsc(null); setMsg(null)
    const [{ data: o }, { data: ev }] = await Promise.all([
      supabase.from('con_votacion_opciones').select('*').eq('votacion_id', v.id).order('orden'),
      supabase.from('con_votacion_eventos').select('*').eq('votacion_id', v.id).order('created_at', { ascending: false }).limit(200),
    ])
    setOpcs(o || []); setEventos(ev || [])
    setPlanilla([]); setPresAviso(null); setNotaAsm(null); setNotaTxt(v.nota_cierre || '')
    const asm = v.asamblea_id ? (asambleas || []).find((a) => a.id === v.asamblea_id) : null

    // Borrador art. 2060 vinculado a una asamblea: precargar las UF presentes desde el registro de asistencia
    if (v.estado === 'borrador' && v.tipo === 'ausentes_2060' && asm && (asm.unidades_presentes || []).length) {
      const m = matchPresentesUF(asm.unidades_presentes, unidades)
      setPresentesSel(m.ids)
      setPresAviso({ total: asm.unidades_presentes.length, ok: m.ids.length, noRec: m.noRec, ambig: m.ambig, fecha: asm.fecha })
    }

    if (v.estado !== 'borrador') {
      const { data, error } = await supabase.rpc('vot_escrutinio', { p_votacion_id: v.id })
      if (error) setMsg({ tipo: 'error', texto: errTxt(error) }); else setEsc(data)
    }

    // Planilla de carga: padrón congelado + votos vigentes
    if (v.estado === 'abierta') {
      const [{ data: pad }, { data: vts }] = await Promise.all([
        supabase.from('con_votacion_padron').select('unidad_id, etiqueta, propietario_nombre, coeficiente, presente_asamblea').eq('votacion_id', v.id),
        supabase.from('con_votacion_votos').select('unidad_id, opcion_id, origen, emitido_at, nota').eq('votacion_id', v.id),
      ])
      const porUF = new Map((vts || []).map((x) => [x.unidad_id, x]))
      const asmLocal = fechaAsmLocal(asm)
      setPlanilla((pad || [])
        .slice().sort((a, b) => String(a.etiqueta).localeCompare(String(b.etiqueta), 'es', { numeric: true }))
        .map((p) => {
          const x = porUF.get(p.unidad_id)
          const orig = x ? { opcion_id: x.opcion_id, emitido: isoALocal(x.emitido_at), nota: x.nota || '' } : { opcion_id: '', emitido: '', nota: '' }
          return {
            unidad_id: p.unidad_id, etiqueta: p.etiqueta, propietario: p.propietario_nombre || '', coef: p.coeficiente,
            presente: !!p.presente_asamblea, origen_actual: x?.origen || null,
            opcion_id: orig.opcion_id, emitido: orig.emitido || (p.presente_asamblea && v.tipo === 'ausentes_2060' ? asmLocal : ''),
            nota: orig.nota, orig,
          }
        }))
    }
  }, [consorcioId, asambleas, unidades])

  const refrescarDetalle = async () => {
    if (!detalle) return
    const { data } = await supabase.from('con_votaciones').select('*').eq('id', detalle.id).single()
    await cargar()
    if (data) await abrirDetalle(data)
  }

  // ── Formulario ──────────────────────────────────────────────────────────
  function setTipo(tipo) {
    setForm((f) => {
      const n = { ...f, tipo }
      if (tipo === 'unanimidad_2059') { n.mayoria = 'unanimidad'; n.multiple = false }
      else if (tipo === 'ausentes_2060') {
        n.mayoria = 'absoluta'; n.multiple = false
        const base = f.apertura ? new Date(localAIso(f.apertura)) : new Date()
        n.cierre = cierre2060(f.apertura || isoALocal(base.toISOString()))
      } else if (f.mayoria === 'unanimidad') n.mayoria = 'absoluta'
      if (tipo !== 'consulta' || !n.multiple) n.opciones = [{ etiqueta: 'SÍ', clave: 'si', detalle: '' }, { etiqueta: 'NO', clave: 'no', detalle: '' }]
      return n
    })
  }
  function setMultiple(m) {
    setForm((f) => ({
      ...f, multiple: m,
      mayoria: m && f.mayoria === 'unanimidad' ? 'simple_votantes' : f.mayoria,
      opciones: m
        ? [{ etiqueta: 'Opción A', clave: 'opcion', detalle: '' }, { etiqueta: 'Opción B', clave: 'opcion', detalle: '' }]
        : [{ etiqueta: 'SÍ', clave: 'si', detalle: '' }, { etiqueta: 'NO', clave: 'no', detalle: '' }],
    }))
  }
  const setOpc = (i, k, val) => setForm((f) => ({ ...f, opciones: f.opciones.map((o, j) => (j === i ? { ...o, [k]: val } : o)) }))

  // Inicio: en art. 2060 el cierre acompaña (inicio + 15 días)
  function setApertura(val) {
    setForm((f) => {
      const n = { ...f, apertura: val }
      if (f.tipo === 'ausentes_2060' && val) n.cierre = cierre2060(val)
      return n
    })
  }
  function setModalidad(registro) {
    setForm((f) => ({
      ...f, modalidad: registro ? 'registro' : 'online',
      requiere_otp: registro ? false : f.requiere_otp,
      resultados_visibles: registro ? 'nunca' : (f.resultados_visibles === 'nunca' ? 'al_cierre' : f.resultados_visibles),
    }))
  }
  // Vincular asamblea (+ opcionalmente tomar un punto del orden del día como título)
  function setAsamblea(id) {
    setForm((f) => ({ ...f, asamblea_id: id }))
  }
  function tomarPunto(i) {
    const asm = asambleas.find((a) => a.id === form.asamblea_id)
    const p = (asm?.orden_del_dia || [])[i]
    if (!p) return
    const fd = asm.fecha ? String(asm.fecha).split('-').reverse().join('/') : ''
    setForm((f) => ({
      ...f,
      titulo: f.titulo || `Asamblea ${asm.tipo === 'ordinaria' ? 'Ordinaria' : 'Extraordinaria'} ${fd} — Punto ${i + 1}`,
      descripcion: f.descripcion || String(p).trim(),
    }))
  }

  async function editarBorrador(v) {
    const { data: o } = await supabase.from('con_votacion_opciones').select('*').eq('votacion_id', v.id).order('orden')
    const sinAbs = (o || []).filter((x) => x.clave !== 'abstencion')
    setForm({
      id: v.id, tipo: v.tipo, titulo: v.titulo, descripcion: v.descripcion || '', mayoria: v.mayoria, campo_coef: v.campo_coef,
      apertura: isoALocal(v.apertura), cierre: isoALocal(v.cierre), permite_cambio: v.permite_cambio, requiere_otp: v.requiere_otp,
      resultados_visibles: v.resultados_visibles, asamblea_id: v.asamblea_id || '', adjuntos: v.adjuntos || [],
      opciones: sinAbs.map((x) => ({ etiqueta: x.etiqueta, clave: x.clave, detalle: x.detalle || '' })),
      multiple: sinAbs.some((x) => x.clave === 'opcion'), presentes: [], modalidad: v.modalidad || 'online',
      silencio_positivo: v.silencio_positivo !== false,
    })
    setVista('form'); setMsg(null)
  }

  async function subirAdjunto(file) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) return setMsg({ tipo: 'warn', texto: 'Solo PDF o imágenes' })
    if (file.size > 10 * 1024 * 1024) return setMsg({ tipo: 'warn', texto: 'El archivo supera 10 MB' })
    setSubiendo(true)
    try {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
      const path = `votaciones/${adminId}/${consorcioId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('actas-pdf').upload(path, file, { upsert: false, contentType: file.type })
      if (error) throw error
      const { data } = supabase.storage.from('actas-pdf').getPublicUrl(path)
      setForm((f) => ({ ...f, adjuntos: [...f.adjuntos, { nombre: file.name, path, url: data.publicUrl }] }))
    } catch (e) { setMsg({ tipo: 'error', texto: 'No se pudo subir: ' + errTxt(e) }) }
    setSubiendo(false)
  }

  function validarForm() {
    if (!form.titulo.trim()) return 'Falta el título'
    if (!form.cierre) return 'Falta la fecha de cierre'
    const registro = form.modalidad === 'registro'
    if (registro && !form.apertura) return form.tipo === 'ausentes_2060' ? 'Indique la fecha de notificación a los ausentes' : 'Indique la fecha de inicio'
    const ap = form.apertura ? new Date(localAIso(form.apertura)) : new Date()
    const ci = new Date(localAIso(form.cierre))
    if (ci <= ap) return 'El cierre debe ser posterior a la apertura'
    if (!registro && ci <= new Date()) return 'El cierre debe ser futuro'
    if (registro && ap > new Date()) return 'En un registro manual la fecha de inicio no puede ser futura'
    if (form.tipo === 'ausentes_2060' && (ci - ap) < 15 * 86400000 - 60000) return 'Art. 2060: el plazo debe ser de al menos 15 días desde la ' + (registro ? 'notificación' : 'apertura')
    if (registro && form.tipo === 'ausentes_2060' && !form.asamblea_id) return 'Vincule la asamblea de origen (de ella se toman las UF presentes)'
    const ets = form.opciones.map((o) => o.etiqueta.trim())
    if (ets.some((x) => !x)) return 'Hay opciones sin texto'
    if (new Set(ets.map((x) => x.toLowerCase())).size !== ets.length) return 'Hay opciones repetidas'
    if (form.opciones.length < 2) return 'Se requieren al menos dos opciones'
    if (form.tipo === 'consulta' && form.multiple && form.mayoria === 'unanimidad') return 'Unanimidad no aplica a opciones múltiples'
    return null
  }

  async function guardarBorrador() {
    if (!puedeOperar) return setMsg({ tipo: 'error', texto: 'Su rol no permite operar votaciones' })
    const err = validarForm(); if (err) return setMsg({ tipo: 'warn', texto: err })
    setOcupado(true); setMsg(null)
    try {
      const id = form.id || `VOT-${consorcioId}-${Date.now()}`
      const row = {
        id, admin_id: adminId, consorcio_id: consorcioId, tipo: form.tipo, titulo: form.titulo.trim(),
        descripcion: form.descripcion.trim() || null, adjuntos: form.adjuntos, mayoria: form.mayoria, campo_coef: form.campo_coef,
        apertura: localAIso(form.apertura), cierre: localAIso(form.cierre), permite_cambio: !!form.permite_cambio,
        requiere_otp: form.modalidad === 'registro' ? false : !!form.requiere_otp, resultados_visibles: form.resultados_visibles,
        modalidad: form.modalidad === 'registro' ? 'registro' : 'online',
        silencio_positivo: form.tipo === 'ausentes_2060' ? form.silencio_positivo !== false : true,
        asamblea_id: form.asamblea_id || null, created_by: app.usuarioId || adminId,
      }
      if (form.id) {
        const { error } = await supabase.from('con_votaciones').update(row).eq('id', id).eq('estado', 'borrador')
        if (error) throw error
        const { error: e2 } = await supabase.from('con_votacion_opciones').delete().eq('votacion_id', id)
        if (e2) throw e2
      } else {
        const { error } = await supabase.from('con_votaciones').insert([row])
        if (error) throw error
      }
      const op = form.opciones.map((o, i) => ({
        id: `${id}-O${i + 1}`, votacion_id: id, admin_id: adminId, orden: i + 1,
        clave: form.tipo === 'consulta' && form.multiple ? 'opcion' : (i === 0 ? 'si' : 'no'),
        etiqueta: o.etiqueta.trim(), detalle: o.detalle?.trim() || null,
      }))
      op.push({ id: `${id}-O${op.length + 1}`, votacion_id: id, admin_id: adminId, orden: op.length + 1, clave: 'abstencion', etiqueta: 'ABSTENCIÓN', detalle: null })
      const { error: e3 } = await supabase.from('con_votacion_opciones').insert(op)
      if (e3) throw e3
      setMsg({ tipo: 'ok', texto: '✓ Borrador guardado. Revíselo y ábralo cuando esté listo.' })
      await cargar()
      const { data } = await supabase.from('con_votaciones').select('*').eq('id', id).single()
      if (data) await abrirDetalle(data)
      setForm((f) => ({ ...f, id }))
    } catch (e) { setMsg({ tipo: 'error', texto: errTxt(e) }) }
    setOcupado(false)
  }

  // ── Acciones sobre la votación ──────────────────────────────────────────

  async function abrir() {
    if (!puedeOperar) return
    if (detalle.tipo === 'ausentes_2060' && !presentesSel.length) return setMsg({ tipo: 'warn', texto: 'Marque las UF presentes en la asamblea' })
    const n = (unidades || []).length
    const extra = detalle.modalidad === 'registro' ? ' Es un REGISTRO MANUAL: no se notifica a los propietarios ni se habilita el voto por el portal.' : ''
    if (!window.confirm(`Se congelará el padrón (${n} UF, coeficiente "${detalle.campo_coef}"${detalle.tipo === 'ausentes_2060' ? `, ${presentesSel.length} presentes` : ''}) y la votación quedará ABIERTA. Las condiciones ya no podrán modificarse.${extra} ¿Continuar?`)) return
    setOcupado(true)
    const { error } = await supabase.rpc('vot_abrir', { p_votacion_id: detalle.id, p_presentes: detalle.tipo === 'ausentes_2060' ? presentesSel : null })
    setOcupado(false)
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    setMsg({ tipo: 'ok', texto: detalle.modalidad === 'registro'
      ? '✓ Registro abierto. Cargue los votos en la planilla.'
      : '✓ Votación abierta. Ahora puede enviar la notificación a los propietarios.' })
    setPresentesSel([]); refrescarDetalle()
  }

  async function notificar(accion) {
    const txt = accion === 'recordatorio'
      ? 'Se enviará un recordatorio por email a las UF que todavía no votaron. ¿Continuar?'
      : 'Se enviará la notificación con el link de votación a todas las UF del padrón con email. ¿Continuar?'
    if (!window.confirm(txt)) return
    setOcupado(true); setMsg(null)
    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      const r = await fetch(SUPA_URL + '/functions/v1/votacion-notificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s?.access_token, 'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
        body: JSON.stringify({ accion, votacion_id: detalle.id }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) setMsg({ tipo: 'error', texto: d.error || 'No se pudo enviar' })
      else setMsg({ tipo: d.errores ? 'warn' : 'ok', texto: `✓ Enviados: ${d.enviados} · Sin email: ${d.sin_email}${d.errores ? ' · Errores: ' + d.errores : ''}` })
    } catch (e) { setMsg({ tipo: 'error', texto: errTxt(e) }) }
    setOcupado(false); refrescarDetalle()
  }

  // ── §60.8 Planilla de carga masiva ──────────────────────────────────────
  const origenFila = (r) => (detalle?.tipo === 'ausentes_2060' && r.presente ? 'asamblea' : 'admin')
  const filaSucia = (r) => r.opcion_id && (r.opcion_id !== r.orig.opcion_id || (r.emitido || '') !== (r.orig.emitido || '') || (r.nota || '') !== (r.orig.nota || ''))
  function setFila(uid, k, val) {
    setPlanilla((rows) => rows.map((r) => {
      if (r.unidad_id !== uid) return r
      const n = { ...r, [k]: val }
      if (k === 'opcion_id' && val && !n.emitido && origenFila(r) === 'admin' && fechaDef) n.emitido = fechaDef
      return n
    }))
  }

  async function guardarPlanilla() {
    const sucias = planilla.filter(filaSucia)
    if (!sucias.length) return setMsg({ tipo: 'info', texto: 'No hay cambios para guardar' })
    const faltan = sucias.filter((r) => origenFila(r) === 'admin' && (!r.emitido || !String(r.nota || '').trim()))
    if (faltan.length) return setMsg({ tipo: 'warn', texto: 'Complete fecha de recepción y respaldo en: ' + faltan.map((r) => r.etiqueta).join(', ') })
    setOcupado(true); setMsg(null)
    const items = sucias.map((r) => ({
      unidad_id: r.unidad_id, opcion_id: r.opcion_id, origen: origenFila(r),
      emitido_at: r.emitido ? localAIso(r.emitido) : null, nota: String(r.nota || '').trim() || null,
    }))
    const { data, error } = await supabase.rpc('vot_registrar_lote', { p_votacion_id: detalle.id, p_items: items })
    setOcupado(false)
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    const errs = data?.errores || []
    setMsg({
      tipo: errs.length ? 'warn' : 'ok',
      texto: `✓ Registrados: ${data?.registrados || 0}` + (data?.sin_cambios ? ` · Sin cambios: ${data.sin_cambios}` : '')
        + (errs.length ? ` · Con error (${errs.length}): ` + errs.map((e) => `${e.etiqueta || e.unidad_id}: ${e.error}`).join(' | ') : ''),
    })
    await refrescarDetalle()
    if (errs.length) {   // conservar en pantalla lo que no se pudo guardar
      const bad = new Map(sucias.filter((r) => errs.some((e) => e.unidad_id === r.unidad_id)).map((r) => [r.unidad_id, r]))
      setPlanilla((rows) => rows.map((r) => (bad.has(r.unidad_id) ? { ...r, opcion_id: bad.get(r.unidad_id).opcion_id, emitido: bad.get(r.unidad_id).emitido, nota: bad.get(r.unidad_id).nota } : r)))
    }
  }

  // ── §60.9 Notas de cierre ───────────────────────────────────────────────
  function notaGenerada() {
    if (!detalle || !esc_) return ''
    const asm = detalle.asamblea_id ? asambleas.find((a) => a.id === detalle.asamblea_id) : null
    return textoNotaCierre([{ v: detalle, e: esc_ }], asm, adminPerfil)
  }
  async function guardarNota() {
    const { error } = await supabase.from('con_votaciones').update({ nota_cierre: notaTxt }).eq('id', detalle.id)
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    setDetalle((d) => ({ ...d, nota_cierre: notaTxt }))
    setMsg({ tipo: 'ok', texto: '✓ Nota de cierre guardada' })
  }
  async function generarNotaAsamblea() {
    const asm = asambleas.find((a) => a.id === detalle.asamblea_id)
    const { data } = await supabase.from('con_votaciones').select('*')
      .eq('asamblea_id', detalle.asamblea_id).eq('consorcio_id', consorcioId).neq('estado', 'anulada').order('created_at')
    const lista2 = data || []
    const abiertas = lista2.filter((x) => x.estado !== 'cerrada')
    const items = lista2.filter((x) => x.estado === 'cerrada' && x.resultado_final).map((x) => ({ v: x, e: x.resultado_final }))
    if (!items.length) return setMsg({ tipo: 'warn', texto: 'No hay votaciones cerradas vinculadas a esta asamblea' })
    setNotaAsm({ asm, items, abiertas: abiertas.map((x) => x.titulo), texto: textoNotaCierre(items, asm, adminPerfil) })
  }
  function copiar(txt) {
    try { navigator.clipboard.writeText(txt); setMsg({ tipo: 'ok', texto: '✓ Texto copiado' }) } catch { setMsg({ tipo: 'warn', texto: 'No se pudo copiar; seleccione el texto manualmente' }) }
  }
  function imprimirNota(titulo, texto) {
    const w = window.open('', '_blank')
    if (!w) return setMsg({ tipo: 'warn', texto: 'Habilite las ventanas emergentes' })
    w.document.open()
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(titulo)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:12px;margin:24px;line-height:1.6}h1{font-family:Georgia,serif;font-size:16px;color:#133F58}</style></head><body><h1>${esc(titulo)}</h1><div><strong>${esc(consorcioActivo?.nombre || '')}</strong></div><p style="white-space:pre-wrap">${esc(texto)}</p><script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  async function quitarVoto(r) {
    const motivo = window.prompt(`Quitar el voto cargado de la UF ${r.etiqueta}. Motivo (queda registrado):`)
    if (!motivo || !motivo.trim()) return
    setOcupado(true)
    const { error } = await supabase.rpc('vot_quitar', { p_votacion_id: detalle.id, p_unidad_id: r.unidad_id, p_motivo: motivo.trim() })
    setOcupado(false)
    if (error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message || '')))
      return setMsg({ tipo: 'warn', texto: 'La función para quitar votos todavía no está habilitada en la base. Mientras tanto puede corregir el voto eligiendo otra opción.' })
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    setMsg({ tipo: 'ok', texto: `✓ Voto de la UF ${r.etiqueta} quitado` }); refrescarDetalle()
  }


  async function cerrar() {
    const anticipado = new Date(detalle.cierre) > new Date()
    if (!window.confirm(anticipado ? 'La votación se cerrará ANTES de la fecha prevista y no admitirá más votos. ¿Confirma?' : 'Se registrará el escrutinio final. ¿Confirma?')) return
    setOcupado(true)
    const { error } = await supabase.rpc('vot_cerrar', { p_votacion_id: detalle.id })
    setOcupado(false)
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    setMsg({ tipo: 'ok', texto: '✓ Votación cerrada. Escrutinio final registrado.' }); refrescarDetalle()
  }

  async function anular() {
    const motivo = window.prompt('Motivo de la anulación (queda registrado):')
    if (!motivo || !motivo.trim()) return
    setOcupado(true)
    const { error } = await supabase.rpc('vot_anular', { p_votacion_id: detalle.id, p_motivo: motivo.trim() })
    setOcupado(false)
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    setMsg({ tipo: 'ok', texto: 'Votación anulada' }); refrescarDetalle()
  }

  async function prorrogar() {
    const nuevo = window.prompt('Nuevo cierre (formato AAAA-MM-DD HH:MM, hora Argentina):', isoALocal(detalle.cierre).replace('T', ' '))
    if (!nuevo) return
    const m = String(nuevo).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/)
    if (!m) return setMsg({ tipo: 'warn', texto: 'Formato inválido' })
    const motivo = window.prompt('Motivo de la prórroga (queda registrado):')
    if (!motivo || !motivo.trim()) return
    setOcupado(true)
    const { error } = await supabase.rpc('vot_prorrogar', { p_votacion_id: detalle.id, p_nuevo_cierre: localAIso(m[1] + 'T' + m[2]), p_motivo: motivo.trim() })
    setOcupado(false)
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    setMsg({ tipo: 'ok', texto: '✓ Cierre prorrogado' }); refrescarDetalle()
  }

  async function eliminarBorrador() {
    if (!window.confirm('¿Eliminar este borrador?')) return
    const { error } = await supabase.from('con_votaciones').delete().eq('id', detalle.id).eq('estado', 'borrador')
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    setVista('lista'); setDetalle(null); cargar()
  }

  // ── Exportaciones ───────────────────────────────────────────────────────
  function filasDetalle() {
    if (!esc_) return []
    const filas = []
    for (const o of esc_.opciones || []) for (const u of o.unidades || []) {
      filas.push({ uf: u.etiqueta, propietario: u.propietario || '', coef: u.coeficiente, voto: o.etiqueta, origen: ORIGEN[u.origen] || u.origen || '', fecha: fF(u.emitido_at), respaldo: u.nota || '' })
    }
    for (const u of esc_.no_voto?.unidades || []) {
      filas.push({ uf: u.etiqueta, propietario: u.propietario || '', coef: u.coeficiente, voto: u.presente_asamblea ? 'PRESENTE (sin voto cargado)' : 'NO VOTÓ', origen: '', fecha: '', respaldo: '' })
    }
    return filas.sort((a, b) => String(a.uf).localeCompare(String(b.uf), 'es', { numeric: true }))
  }

  function excel() {
    exportarExcel({
      titulo: `Escrutinio ${detalle.titulo} - ${consorcioActivo?.nombre || ''}`,
      columnas: [{ key: 'uf', label: 'UF' }, { key: 'propietario', label: 'Propietario' }, { key: 'coef', label: 'Coeficiente' }, { key: 'voto', label: 'Voto' }, { key: 'origen', label: 'Origen' }, { key: 'fecha', label: 'Fecha y hora' }, { key: 'respaldo', label: 'Respaldo' }],
      filas: filasDetalle(),
    })
  }

  function actaPDF() {
    if (!esc_) return
    const e = esc_
    const filas = filasDetalle()
    const resLabel = (RESULTADO[e.resultado] || e.resultado) + (e.ganador?.etiqueta ? ': ' + e.ganador.etiqueta : '')
    const estadoTxt = e.estado_efectivo === 'cerrada' ? 'ESCRUTINIO FINAL' : 'ESCRUTINIO PARCIAL (votación en curso)'
    const asmA = detalle.asamblea_id ? asambleas.find((x) => x.id === detalle.asamblea_id) : null
    const A6 = e.art2060
    const pc = (x) => (e.total_coef > 0 ? (100 * Number(x.coef) / Number(e.total_coef)).toFixed(4) : '0')
    const pu = (x) => (100 * x.uf / e.total_uf).toFixed(2)
    const f6 = (l, x, b) => `<tr${b ? ' style="font-weight:700"' : ''}><td>${l}</td><td class="n">${x.uf}</td><td class="n">${pu(x)}%</td><td class="n">${pc(x)}%</td></tr>`
    const a60html = A6 ? `<h2>Cómputo art. 2060 CCyC ${A6.silencio_positivo ? '(silencios de ausentes computados a favor, art. 263)' : '(conformidad expresa, art. 2061)'}</h2>
<div class="k">Presentes en la asamblea: ${A6.presentes.uf} UF (${A6.presentes_pct_uf}% de las unidades / ${A6.presentes_pct_coef}% de los porcentuales)${A6.presentes_pct_uf > 50 && A6.presentes_pct_coef > 50 ? '' : ' — no se alcanzó la doble mayoría: lo resuelto constituyó una propuesta, comunicada a los ausentes.'}</div>
<table style="margin-top:6px"><tr><th>Concepto</th><th>UF</th><th>% UF</th><th>% Coef.</th></tr>
${f6('SÍ presentes', A6.presentes.si)}${f6('SÍ ausentes (expreso)', A6.ausentes.si)}${f6(A6.silencio_positivo ? 'Silencios de ausentes (a favor)' : 'Silencios de ausentes (no computan)', A6.ausentes.silencio)}
${f6('TOTAL A FAVOR DE LA PROPUESTA', A6.favor, true)}
${f6('NO presentes', A6.presentes.no)}${f6('Oposiciones de ausentes', A6.ausentes.no)}
${f6('TOTAL OPOSICIÓN' + (A6.oposicion.mayoria_suficiente ? ' — alcanza mayoría suficiente' : ' — no alcanza mayoría suficiente'), A6.oposicion, true)}
${f6('Abstenciones', { uf: A6.presentes.abstencion.uf + A6.ausentes.abstencion.uf, coef: Number(A6.presentes.abstencion.coef) + Number(A6.ausentes.abstencion.coef) })}
</table>` : ''
    const notaFinal = detalle.tipo === 'ausentes_2060' && e.estado_efectivo === 'cerrada' ? (notaTxt || detalle.nota_cierre || textoNotaCierre([{ v: detalle, e }], asmA, adminPerfil)) : ''
    const notaHtml = notaFinal ? `<h2>Nota de cierre</h2><p style="white-space:pre-wrap;line-height:1.6">${esc(notaFinal)}</p>` : ''
    const asmActa = asmA ? `${asmA.tipo === 'ordinaria' ? 'Ordinaria' : 'Extraordinaria'} del ${String(asmA.fecha).split('-').reverse().join('/')} — presentes: ${(asmA.unidades_presentes || []).length} UF (${(asmA.unidades_presentes || []).join(', ')})` : ''
    const avisos = (e.avisos || []).map((a) => a.tipo === 'coef_suma' ? a.detalle : a.tipo === 'coef_cero' ? 'UF con coeficiente 0: ' + (a.unidades || []).join(', ') : '').filter(Boolean)
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Acta de escrutinio — ${esc(detalle.titulo)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-family:Georgia,serif;font-size:17px;color:#133F58;margin:0 0 4px}
h2{font-family:Georgia,serif;font-size:13px;color:#133F58;margin:16px 0 6px;border-bottom:1px solid #133F58;padding-bottom:2px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}th{background:#E8F0F5}
td.n{text-align:right}.k{color:#555}.box{border:1px solid #133F58;padding:8px;margin-top:8px}@media print{body{margin:10mm}}</style></head><body>
<h1>ACTA DE ESCRUTINIO — ${esc(estadoTxt)}</h1>
<div><strong>${esc(consorcioActivo?.nombre || '')}</strong>${consorcioActivo?.cuit ? ' · CUIT ' + esc(consorcioActivo.cuit) : ''}${consorcioActivo?.direccion ? ' · ' + esc(consorcioActivo.direccion) : ''}</div>
<div class="k">Administración: ${esc(adminPerfil?.nombre || '')}${adminPerfil?.matricula_rpac ? ' — RPAC N° ' + esc(adminPerfil.matricula_rpac) : ''}</div>
<h2>Votación</h2>
<table><tr><th style="width:28%">Asunto</th><td>${esc(detalle.titulo)}</td></tr>
<tr><th>Tipo</th><td>${esc(TIPOS[detalle.tipo]?.l || detalle.tipo)}${detalle.modalidad === 'registro' ? ' — registro manual de votos recibidos por medios fehacientes (mail / nota)' : ''}</td></tr>
${asmActa ? `<tr><th>Asamblea de origen</th><td>${esc(asmActa)}</td></tr>` : ''}
<tr><th>Mayoría requerida</th><td>${esc(MAYORIAS[detalle.mayoria] || detalle.mayoria)} — cómputo doble: unidades y coeficiente (${esc(detalle.campo_coef)})</td></tr>
<tr><th>${detalle.modalidad === 'registro' && detalle.tipo === 'ausentes_2060' ? 'Notificación a ausentes / Cierre del plazo' : 'Apertura / Cierre'}</th><td>${fF(detalle.apertura)} hs / ${fF(detalle.cierre)} hs</td></tr>
${detalle.descripcion ? `<tr><th>Propuesta</th><td style="white-space:pre-wrap">${esc(detalle.descripcion)}</td></tr>` : ''}
</table>
<h2>Resultado</h2>
<table><tr><th>Opción</th><th>UF</th><th>% UF</th><th>% Coef.</th><th>Alcanza mayoría</th></tr>
${(e.opciones || []).map((o) => `<tr><td>${esc(o.etiqueta)}</td><td class="n">${o.uf}</td><td class="n">${o.pct_uf}%</td><td class="n">${o.pct_coef}%</td><td>${o.alcanza_mayoria == null ? '—' : o.alcanza_mayoria ? 'Sí' : 'No'}</td></tr>`).join('')}
<tr><td>No votaron</td><td class="n">${e.no_voto?.uf ?? 0}</td><td class="n">${e.no_voto?.pct_uf ?? 0}%</td><td class="n">${e.no_voto?.pct_coef ?? 0}%</td><td>—</td></tr>
<tr><th>Total padrón</th><th class="n">${e.total_uf}</th><th class="n">100%</th><th class="n">100%</th><th></th></tr></table>
<div class="box"><strong>Resultado:</strong> ${esc(resLabel)} · Participación ${e.votos_emitidos}/${e.total_uf} UF (${e.participacion_pct_uf}%)</div>
${avisos.length ? `<div class="k" style="margin-top:6px">Observaciones: ${avisos.map(esc).join(' · ')}</div>` : ''}
${a60html}
${notaHtml}
<h2>Detalle por unidad funcional</h2>
<table><tr><th>UF</th><th>Propietario</th><th>Coef.</th><th>Voto</th><th>Origen</th><th>Fecha y hora</th><th>Respaldo</th></tr>
${filas.map((f) => `<tr><td>${esc(f.uf)}</td><td>${esc(f.propietario)}</td><td class="n">${esc(f.coef)}</td><td>${esc(f.voto)}</td><td>${esc(f.origen)}</td><td>${esc(f.fecha)}</td><td>${esc(f.respaldo)}</td></tr>`).join('')}
</table>
<p class="k" style="margin-top:14px">${detalle.modalidad === 'registro' ? 'Los votos fueron cargados por la administración con la fecha de recepción y el respaldo de cada uno; los originales (mails / notas) quedan a disposición de los propietarios.' : 'Cada voto emitido por el portal queda registrado con fecha, hora, IP y un código de verificación (SHA-256).'} Los cambios de voto se conservan en historial. Documento generado por GASP Consorcios el ${fF(new Date().toISOString())} hs.</p>
<br><br><table style="border:none"><tr><td style="border:none;width:50%;text-align:center">_____________________________<br>${esc(adminPerfil?.nombre || 'Administrador')}${adminPerfil?.matricula_rpac ? '<br>RPAC N° ' + esc(adminPerfil.matricula_rpac) : ''}</td><td style="border:none"></td></tr></table>
<script>window.onload=function(){window.print()}</script></body></html>`
    const w = window.open('', '_blank')
    if (!w) return setMsg({ tipo: 'warn', texto: 'Habilite las ventanas emergentes para generar el acta' })
    w.document.open(); w.document.write(html); w.document.close()
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (!consorcioId) return <Card><div style={{ color: GR }}>Seleccione un consorcio.</div></Card>

  if (vista === 'form') {
    const t = TIPOS[form.tipo]
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{form.id ? 'Editar borrador' : 'Nueva votación'} — {consorcioActivo?.nombre}</h2>
          <BtnSec small onClick={() => { setVista('lista'); setMsg(null) }}>← Volver</BtnSec>
        </div>
        <Msg data={msg} />
        <Card style={{ marginBottom: 12 }}>
          <label style={LBL}>Tipo de votación</label>
          <select style={INP} value={form.tipo} onChange={(e) => setTipo(e.target.value)}>
            {Object.entries(TIPOS).map(([k, x]) => <option key={k} value={k}>{x.l}</option>)}
          </select>
          <div style={{ fontSize: 12, color: GR, marginTop: 6 }}>{t.d}</div>
          <div style={{ fontSize: 11, color: AM, marginTop: 6 }}>La validez de cada modalidad depende de lo que disponga el Reglamento de Propiedad Horizontal. Verifique antes de usarla para decisiones vinculantes.</div>
        </Card>

        {(() => {
          const asmSel = asambleas.find((a) => a.id === form.asamblea_id)
          const registro = form.modalidad === 'registro'
          return (
            <Card style={{ marginBottom: 12, border: registro ? '1.5px solid ' + AM : undefined }}>
              <label style={{ fontSize: 13, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={registro} onChange={(e) => setModalidad(e.target.checked)} style={{ marginTop: 3 }} />
                <span>📋 Registro de votación ya realizada (carga manual)
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: GR, marginTop: 2 }}>
                    Para votos ya recibidos por mail o nota firmada (por ejemplo, ausentes de una asamblea sin mayoría, art. 2060). Admite fechas pasadas; no envía notificaciones ni habilita el voto por el portal. Cada voto se carga con su fecha real de recepción y su respaldo.
                  </span>
                </span>
              </label>
              {form.tipo === 'ausentes_2060' && (
                <label style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
                  <input type="checkbox" checked={form.silencio_positivo === false} onChange={(e) => setForm({ ...form, silencio_positivo: !e.target.checked })} style={{ marginTop: 2 }} />
                  <span><strong>Suprime o limita derechos acordados por el RPH (art. 2061 CCyC)</strong>
                    <span style={{ display: 'block', color: GR }}>Exige conformidad expresa: el silencio de los ausentes NO se computa a favor. Sin marcar, rige la regla general: los silencios se suman a la propuesta (art. 263).</span>
                  </span>
                </label>
              )}
              {(form.tipo === 'ausentes_2060' || registro) && (
                <div style={{ marginTop: 12 }}>
                  <label style={LBL}>Asamblea de origen{form.tipo === 'ausentes_2060' && registro ? ' *' : ''}</label>
                  <select style={INP} value={form.asamblea_id} onChange={(e) => setAsamblea(e.target.value)}>
                    <option value="">— Sin vincular —</option>
                    {asambleas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {String(a.fecha || '').split('-').reverse().join('/')} · {a.tipo === 'ordinaria' ? 'Ordinaria' : 'Extraordinaria'} · {(a.unidades_presentes || []).length} presentes{a.estado ? ' · ' + a.estado : ''}
                      </option>
                    ))}
                  </select>
                  {asmSel && (asmSel.orden_del_dia || []).length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>Orden del día — elija el punto que se somete a votación (completa título y propuesta si están vacíos):</div>
                      {asmSel.orden_del_dia.map((pto, i) => (
                        <button key={i} onClick={() => tomarPunto(i)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 12, padding: '6px 8px', marginBottom: 4, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
                          <strong>{i + 1}.</strong> {String(pto)}
                        </button>
                      ))}
                      <div style={{ fontSize: 11, color: GR }}>Cree una votación por cada moción. Redacte en "Propuesta" la decisión concreta que votó la mayoría de los presentes.</div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )
        })()}

        <Card style={{ marginBottom: 12 }}>
          <label style={LBL}>Título / asunto *</label>
          <input style={INP} value={form.titulo} maxLength={200} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ej.: Presupuesto impermeabilización de terraza" />
          <label style={{ ...LBL, marginTop: 10 }}>Propuesta / descripción</label>
          <textarea style={{ ...INP, minHeight: 110, fontFamily: 'inherit' }} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Detalle de la propuesta, montos, plazos, forma de pago…" />
          <label style={{ ...LBL, marginTop: 10 }}>Documentación adjunta (PDF o imagen, máx. 10 MB)</label>
          {form.adjuntos.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
              <a href={a.url} target="_blank" rel="noreferrer" style={{ color: AZ }}>📎 {a.nombre}</a>
              <button onClick={() => setForm({ ...form, adjuntos: form.adjuntos.filter((_, j) => j !== i) })} style={{ border: 'none', background: 'none', color: RJ, cursor: 'pointer' }}>✕</button>
            </div>
          ))}
          <input type="file" accept="application/pdf,image/*" disabled={subiendo} onChange={(e) => { subirAdjunto(e.target.files?.[0]); e.target.value = '' }} style={{ fontSize: 12, marginTop: 4 }} />
          {subiendo && <span style={{ fontSize: 12, color: GR }}> Subiendo…</span>}
          <div style={{ fontSize: 11, color: GR, marginTop: 4 }}>Los adjuntos quedan accesibles para quien tenga el link de la votación.</div>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>Opciones</strong>
            {form.tipo === 'consulta' && (
              <label style={{ fontSize: 12 }}><input type="checkbox" checked={form.multiple} onChange={(e) => setMultiple(e.target.checked)} /> Opciones múltiples (presupuestos A/B/C…)</label>
            )}
          </div>
          {form.opciones.map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <input style={{ ...INP, flex: '0 0 32%' }} value={o.etiqueta} disabled={!form.multiple} onChange={(e) => setOpc(i, 'etiqueta', e.target.value)} />
              <input style={{ ...INP, flex: 1 }} value={o.detalle} placeholder="Detalle (opcional)" onChange={(e) => setOpc(i, 'detalle', e.target.value)} />
              {form.multiple && form.opciones.length > 2 && (
                <button onClick={() => setForm({ ...form, opciones: form.opciones.filter((_, j) => j !== i) })} style={{ border: 'none', background: 'none', color: RJ, cursor: 'pointer' }}>✕</button>
              )}
            </div>
          ))}
          {form.multiple && form.opciones.length < 8 && (
            <BtnSec small onClick={() => setForm({ ...form, opciones: [...form.opciones, { etiqueta: 'Opción ' + String.fromCharCode(65 + form.opciones.length), clave: 'opcion', detalle: '' }] })}>+ Agregar opción</BtnSec>
          )}
          <div style={{ fontSize: 11, color: GR, marginTop: 6 }}>La opción ABSTENCIÓN se agrega siempre automáticamente.</div>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <div>
              <label style={LBL}>Mayoría requerida</label>
              <select style={INP} value={form.mayoria} disabled={form.tipo === 'unanimidad_2059'} onChange={(e) => setForm({ ...form, mayoria: e.target.value })}>
                {Object.entries(MAYORIAS)
                  .filter(([k]) => form.tipo === 'consulta' ? !(form.multiple && k === 'unanimidad') : form.tipo === 'unanimidad_2059' ? k === 'unanimidad' : k !== 'simple_votantes')
                  .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Coeficiente para el cómputo</label>
              <select style={INP} value={form.campo_coef} onChange={(e) => setForm({ ...form, campo_coef: e.target.value })}>
                {CAMPOS_COEF.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ fontSize: 11, color: GR, marginTop: 3 }}>Usar el coeficiente del RPH (en ATICA II es pct_gtos_grales).</div>
            </div>
            <div>
              <label style={LBL}>
                {form.modalidad === 'registro'
                  ? (form.tipo === 'ausentes_2060' ? 'Notificación a los ausentes *' : 'Inicio *')
                  : 'Apertura (vacío = al abrir)'}
              </label>
              <input type="datetime-local" style={INP} value={form.apertura} onChange={(e) => setApertura(e.target.value)} />
              {form.modalidad === 'registro' && form.tipo === 'ausentes_2060' && (
                <div style={{ fontSize: 11, color: GR, marginTop: 3 }}>Fecha en que se comunicó fehacientemente lo propuesto a los ausentes. El plazo de 15 días corre desde aquí.</div>
              )}
            </div>
            <div>
              <label style={LBL}>Cierre *</label>
              <input type="datetime-local" style={INP} value={form.cierre} onChange={(e) => setForm({ ...form, cierre: e.target.value })} />
              {form.tipo === 'ausentes_2060' && <div style={{ fontSize: 11, color: GR, marginTop: 3 }}>Se completa solo: 15 días corridos desde el día siguiente a la notificación, vence a las 23:59 del último día (art. 6 CCyC).</div>}
            </div>
            {form.modalidad !== 'registro' && (
              <div>
                <label style={LBL}>Resultados visibles al propietario</label>
                <select style={INP} value={form.resultados_visibles} onChange={(e) => setForm({ ...form, resultados_visibles: e.target.value })}>
                  <option value="al_cierre">Al cierre</option><option value="siempre">Siempre (parcial en vivo)</option><option value="nunca">Nunca</option>
                </select>
              </div>
            )}
          </div>
          {form.modalidad !== 'registro' && (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 13 }}>
              <label><input type="checkbox" checked={form.permite_cambio} onChange={(e) => setForm({ ...form, permite_cambio: e.target.checked })} /> Permitir cambiar el voto hasta el cierre</label>
              <label><input type="checkbox" checked={form.requiere_otp} onChange={(e) => setForm({ ...form, requiere_otp: e.target.checked })} /> Exigir código por email para votar</label>
            </div>
          )}
          {form.modalidad !== 'registro' && form.requiere_otp && <div style={{ fontSize: 11, color: AM, marginTop: 4 }}>Las UF sin email registrado no podrán votar por el portal (podrá cargar su voto manualmente).</div>}
        </Card>

        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={guardarBorrador} disabled={ocupado || subiendo}>{ocupado ? 'Guardando…' : '💾 Guardar borrador'}</Btn>
          <BtnSec onClick={() => { setVista('lista'); setMsg(null) }}>Cancelar</BtnSec>
        </div>
      </div>
    )
  }

  if (vista === 'detalle' && detalle) {
    const d = detalle
    const ef = d.estado === 'abierta' && new Date(d.cierre) <= new Date() ? 'cerrada' : d.estado
    const registro = d.modalidad === 'registro'
    const asmD = d.asamblea_id ? asambleas.find((a) => a.id === d.asamblea_id) : null
    const nSucias = planilla.filter(filaSucia).length
    const nConVoto = planilla.filter((r) => r.orig.opcion_id).length
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{d.titulo}</h2>
          <BtnSec small onClick={() => { setVista('lista'); setDetalle(null); setMsg(null) }}>← Volver</BtnSec>
        </div>
        <Msg data={msg} />
        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ background: EST_COLOR[ef], color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{ef}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{TIPOS[d.tipo]?.l}</span>
            <span style={{ fontSize: 12, color: GR }}>· {MAYORIAS[d.mayoria]} · coef. {d.campo_coef}</span>
            {registro && <span style={{ background: AM, color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>REGISTRO MANUAL</span>}
          </div>
          {asmD && <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>Asamblea de origen: {String(asmD.fecha).split('-').reverse().join('/')} · {asmD.tipo === 'ordinaria' ? 'Ordinaria' : 'Extraordinaria'} · {(asmD.unidades_presentes || []).length} presentes registrados</div>}
          <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>{registro && d.tipo === 'ausentes_2060' ? 'Notificación a ausentes' : 'Apertura'}: {fF(d.apertura)} · Cierre: {fF(d.cierre)}{d.estado === 'abierta' && ef === 'cerrada' ? (registro ? ' (plazo vencido — cargue los votos recibidos y registre el cierre)' : ' (vencida — registre el cierre)') : ''}</div>
          {d.descripcion && <div style={{ fontSize: 13, marginTop: 8, whiteSpace: 'pre-wrap' }}>{d.descripcion}</div>}
          {(d.adjuntos || []).map((a, i) => <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 12, color: AZ, marginTop: 4 }}>📎 {a.nombre}</a>)}
          <div style={{ fontSize: 12, color: GR, marginTop: 8 }}>Opciones: {opcs.map((o) => o.etiqueta).join(' · ')}{d.permite_cambio ? ' · admite cambio de voto' : ''}{d.requiere_otp ? ' · requiere código por email' : ''}</div>
          {d.estado === 'anulada' && <div style={{ fontSize: 12, color: RJ, marginTop: 6 }}>Anulada: {d.anulada_motivo}</div>}
        </Card>

        {puedeOperar && (
          <Card style={{ marginBottom: 12 }}>
            {d.estado === 'borrador' && (
              <>
                {d.tipo === 'ausentes_2060' && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>UF presentes en la asamblea ({presentesSel.length})</div>
                    {presAviso && (
                      <div style={{ fontSize: 12, marginBottom: 6, color: presAviso.noRec.length || presAviso.ambig.length ? AM : VD }}>
                        Precargadas desde la asistencia de la asamblea: {presAviso.ok} de {presAviso.total} reconocidas.
                        {presAviso.noRec.length > 0 && ` No reconocidas: ${presAviso.noRec.join(', ')}.`}
                        {presAviso.ambig.length > 0 && ` Ambiguas: ${presAviso.ambig.join(', ')}.`}
                        {' '}Verifique y corrija antes de abrir.
                      </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflow: 'auto' }}>
                      {(unidades || []).slice().sort((a, b) => etiquetaUF(a).localeCompare(etiquetaUF(b), 'es', { numeric: true })).map((u) => (
                        <label key={u.id} style={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 8px', background: presentesSel.includes(u.id) ? '#dbeafe' : '#fff' }}>
                          <input type="checkbox" checked={presentesSel.includes(u.id)} onChange={(e) => setPresentesSel((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} /> {etiquetaUF(u)}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Btn color={VD} onClick={abrir} disabled={ocupado}>{registro ? '▶ Abrir registro y cargar votos' : '▶ Abrir votación'}</Btn>
                  <BtnSec onClick={() => editarBorrador(d)}>✏️ Editar</BtnSec>
                  <BtnSec onClick={eliminarBorrador}>🗑 Eliminar borrador</BtnSec>
                </div>
              </>
            )}
            {d.estado === 'abierta' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!registro && ef === 'abierta' && <Btn onClick={() => notificar('convocatoria')} disabled={ocupado}>✉️ Notificar a propietarios</Btn>}
                {!registro && ef === 'abierta' && <BtnSec onClick={() => notificar('recordatorio')}>🔔 Recordatorio a quienes no votaron</BtnSec>}
                {!registro && ef === 'abierta' && <BtnSec onClick={prorrogar}>⏱ Prorrogar cierre</BtnSec>}
                {(d.tipo !== 'ausentes_2060' || ef === 'cerrada') && <Btn color={AZ} onClick={cerrar} disabled={ocupado}>■ {ef === 'cerrada' ? 'Registrar cierre y escrutinio final' : 'Cerrar anticipadamente'}</Btn>}
                {(ef === 'abierta' || registro) && <Btn color={RJ} onClick={anular} disabled={ocupado}>Anular</Btn>}
              </div>
            )}
          </Card>
        )}

        {esc_ && (
          <Card style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 15 }}>{esc_.estado_efectivo === 'cerrada' ? 'Escrutinio final' : 'Escrutinio parcial'}</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <BtnSec small onClick={refrescarDetalle}>↻ Actualizar</BtnSec>
                <Btn small color={GR} onClick={actaPDF}>🖨️ Acta</Btn>
                <Btn small color={VD} onClick={excel}>📊 Excel</Btn>
              </div>
            </div>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              Resultado: <strong>{RESULTADO[esc_.resultado] || esc_.resultado}{esc_.ganador?.etiqueta ? ': ' + esc_.ganador.etiqueta : ''}</strong>
              <span style={{ color: GR }}> · Participación {esc_.votos_emitidos}/{esc_.total_uf} UF ({esc_.participacion_pct_uf}%)</span>
            </div>
            {(esc_.avisos || []).map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: AM, marginTop: 4 }}>⚠ {a.tipo === 'coef_cero' ? 'UF con coeficiente 0: ' + (a.unidades || []).join(', ') : a.detalle}</div>
            ))}
            {esc_.art2060 && (() => {
              const a = esc_.art2060
              const fila = (lbl, x, extra) => (
                <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 5 }}>{lbl}</td>
                  <td style={{ padding: 5, textAlign: 'right' }}>{x.uf}</td>
                  <td style={{ padding: 5, textAlign: 'right' }}>{(100 * x.uf / esc_.total_uf).toFixed(2)}%</td>
                  <td style={{ padding: 5, textAlign: 'right' }}>{esc_.total_coef > 0 ? (100 * Number(x.coef) / Number(esc_.total_coef)).toFixed(4) : '0'}%</td>
                  <td style={{ padding: 5 }}>{extra || ''}</td>
                </tr>
              )
              return (
                <div style={{ marginTop: 10, border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: AZ }}>Cómputo art. 2060 CCyC {a.silencio_positivo ? '— silencios a favor (art. 263)' : '— conformidad expresa (art. 2061)'}</div>
                  <div style={{ fontSize: 11, color: GR, margin: '2px 0 6px' }}>
                    Presentes en la asamblea: {a.presentes.uf} UF ({a.presentes_pct_uf}% / {a.presentes_pct_coef}% coef.) — {a.presentes_pct_uf > 50 && a.presentes_pct_coef > 50 ? 'hubo doble mayoría' : 'sin doble mayoría: lo resuelto es una PROPUESTA'}.
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ background: '#eef4ff' }}><th style={{ textAlign: 'left', padding: 5 }}>Concepto</th><th style={{ padding: 5 }}>UF</th><th style={{ padding: 5 }}>% UF</th><th style={{ padding: 5 }}>% Coef.</th><th /></tr></thead>
                      <tbody>
                        {fila('SÍ presentes', a.presentes.si)}
                        {fila('SÍ ausentes (expreso)', a.ausentes.si)}
                        {fila(a.silencio_positivo ? 'Silencios de ausentes (a favor)' : 'Silencios de ausentes (no computan)', a.ausentes.silencio)}
                        <tr style={{ borderTop: '2px solid #93c5fd', fontWeight: 700 }}>
                          <td style={{ padding: 5 }}>Total a favor de la propuesta</td>
                          <td style={{ padding: 5, textAlign: 'right' }}>{a.favor.uf}</td>
                          <td style={{ padding: 5, textAlign: 'right' }}>{a.favor.pct_uf}%</td>
                          <td style={{ padding: 5, textAlign: 'right' }}>{a.favor.pct_coef}%</td>
                          <td style={{ padding: 5 }}>{a.favor.doble_mayoria ? '✓ doble mayoría' : ''}</td>
                        </tr>
                        {fila('NO presentes', a.presentes.no)}
                        {fila('Oposiciones de ausentes', a.ausentes.no)}
                        <tr style={{ borderTop: '2px solid #fca5a5', fontWeight: 700 }}>
                          <td style={{ padding: 5 }}>Total oposición</td>
                          <td style={{ padding: 5, textAlign: 'right' }}>{a.oposicion.uf}</td>
                          <td style={{ padding: 5, textAlign: 'right' }}>{a.oposicion.pct_uf}%</td>
                          <td style={{ padding: 5, textAlign: 'right' }}>{a.oposicion.pct_coef}%</td>
                          <td style={{ padding: 5, color: a.oposicion.mayoria_suficiente ? RJ : VD }}>{a.oposicion.mayoria_suficiente ? '✗ mayoría suficiente: revierte' : '✓ no alcanza para revertir'}</td>
                        </tr>
                        {fila('Abstenciones (presentes + ausentes)', { uf: a.presentes.abstencion.uf + a.ausentes.abstencion.uf, coef: Number(a.presentes.abstencion.coef) + Number(a.ausentes.abstencion.coef) })}
                        {a.presentes.sin_voto.uf > 0 && fila('Presentes sin voto cargado', a.presentes.sin_voto, <span style={{ color: AM }}>⚠ cargar</span>)}
                      </tbody>
                    </table>
                  </div>
                  {esc_.estado_efectivo !== 'cerrada' && (
                    <div style={{ fontSize: 12, marginTop: 6 }}>Proyección si cerrara hoy: <strong>{RESULTADO[esc_.proyeccion] || esc_.proyeccion}</strong></div>
                  )}
                </div>
              )
            })()}
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: '#f1f5f9' }}>
                  <th style={{ textAlign: 'left', padding: 6 }}>Opción</th><th style={{ padding: 6 }}>UF</th><th style={{ padding: 6 }}>% UF</th><th style={{ padding: 6 }}>% Coef.</th><th style={{ padding: 6 }}>Mayoría</th>
                </tr></thead>
                <tbody>
                  {(esc_.opciones || []).map((o) => (
                    <tr key={o.opcion_id} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: 6, fontWeight: 600 }}>{o.etiqueta}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{o.uf}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{o.pct_uf}%</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{o.pct_coef}%</td>
                      <td style={{ padding: 6, textAlign: 'center' }}>{o.alcanza_mayoria == null ? '—' : o.alcanza_mayoria ? '✓' : '✗'}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid #e5e7eb', color: GR }}>
                    <td style={{ padding: 6 }}>No votaron</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{esc_.no_voto?.uf}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{esc_.no_voto?.pct_uf}%</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{esc_.no_voto?.pct_coef}%</td><td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 12 }}>
              {(esc_.opciones || []).map((o) => (o.unidades || []).length > 0 && (
                <div key={o.opcion_id} style={{ marginBottom: 6 }}>
                  <strong>{o.etiqueta}:</strong> {o.unidades.map((u) => `${u.etiqueta}${u.origen !== 'portal' ? ' (' + (ORIGEN[u.origen] || u.origen) + ')' : ''}`).join(', ')}
                </div>
              ))}
              {(esc_.no_voto?.unidades || []).length > 0 && (
                <div style={{ color: GR }}><strong>No votaron:</strong> {esc_.no_voto.unidades.map((u) => u.etiqueta + (u.presente_asamblea ? ' [presente]' : '') + (u.tiene_email ? '' : ' [sin email]')).join(', ')}</div>
              )}
            </div>
          </Card>
        )}

        {d.tipo === 'ausentes_2060' && esc_ && ef === 'cerrada' && (
          <Card style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>📝 Nota de cierre</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <BtnSec small onClick={() => setNotaTxt(notaGenerada())}>↺ Regenerar texto</BtnSec>
                <BtnSec small onClick={() => copiar(notaTxt || notaGenerada())}>📋 Copiar</BtnSec>
                {puedeOperar && <Btn small onClick={guardarNota}>💾 Guardar</Btn>}
                {d.asamblea_id && <Btn small color={AZ} onClick={generarNotaAsamblea}>🏛 Nota de la asamblea (todos los puntos)</Btn>}
              </div>
            </div>
            {d.estado === 'abierta' && <div style={{ fontSize: 11, color: AM, marginTop: 4 }}>El plazo venció: registre el cierre para que el escrutinio final quede fijo antes de usar la nota.</div>}
            <textarea value={notaTxt || notaGenerada()} onChange={(e) => setNotaTxt(e.target.value)}
              style={{ ...INP, minHeight: 190, fontFamily: 'inherit', marginTop: 8, lineHeight: 1.5 }} />
            <div style={{ fontSize: 11, color: GR, marginTop: 4 }}>Texto para el Libro de Actas, a continuación del acta de la asamblea. Puede editarlo antes de guardar.</div>
          </Card>
        )}

        {notaAsm && (
          <Card style={{ marginBottom: 12, border: '1.5px solid ' + AZ }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>🏛 Nota de cierre — Asamblea del {fDf(notaAsm.asm?.fecha)} ({notaAsm.items.length} punto{notaAsm.items.length > 1 ? 's' : ''})</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <BtnSec small onClick={() => copiar(notaAsm.texto)}>📋 Copiar</BtnSec>
                <Btn small color={GR} onClick={() => imprimirNota('Nota de cierre — Asamblea del ' + fDf(notaAsm.asm?.fecha), notaAsm.texto)}>🖨️ Imprimir</Btn>
                <BtnSec small onClick={() => setNotaAsm(null)}>✕</BtnSec>
              </div>
            </div>
            {notaAsm.abiertas.length > 0 && <div style={{ fontSize: 12, color: AM, marginTop: 4 }}>⚠ Quedan sin cerrar: {notaAsm.abiertas.join(', ')}. No se incluyen.</div>}
            <textarea value={notaAsm.texto} onChange={(e) => setNotaAsm({ ...notaAsm, texto: e.target.value })}
              style={{ ...INP, minHeight: 260, fontFamily: 'inherit', marginTop: 8, lineHeight: 1.5 }} />
          </Card>
        )}

        {puedeOperar && d.estado === 'abierta' && planilla.length > 0 && (
          <Card style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>📋 Planilla de carga de votos ({nConVoto}/{planilla.length} con voto)</strong>
              <Btn onClick={guardarPlanilla} disabled={ocupado || !nSucias}>{ocupado ? 'Guardando…' : `💾 Guardar cambios (${nSucias})`}</Btn>
            </div>
            <div style={{ fontSize: 11, color: GR, margin: '6px 0 8px', lineHeight: 1.5 }}>
              {d.tipo === 'ausentes_2060'
                ? 'UF presentes (fondo azul): su voto se registra como emitido en la asamblea. Ausentes: voto recibido por mail o nota, con fecha de recepción dentro del plazo (notificación → cierre) y respaldo obligatorio.'
                : 'Votos recibidos por mail o nota firmada: fecha de recepción dentro de la ventana de la votación y respaldo obligatorio.'}
              {' '}Corregir un voto deja el anterior en el historial.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
              <span>Fecha/hora de recepción por defecto (se aplica al elegir un voto):</span>
              <input type="datetime-local" value={fechaDef} onChange={(e) => setFechaDef(e.target.value)} style={{ ...INP, width: 200 }} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
                <thead><tr style={{ background: '#f1f5f9' }}>
                  <th style={{ textAlign: 'left', padding: 5 }}>UF</th>
                  <th style={{ textAlign: 'left', padding: 5 }}>Propietario</th>
                  <th style={{ padding: 5 }}>Coef.</th>
                  <th style={{ padding: 5 }}>Voto</th>
                  <th style={{ padding: 5 }}>Recibido</th>
                  <th style={{ padding: 5 }}>Respaldo</th>
                  <th style={{ padding: 5 }} />
                </tr></thead>
                <tbody>
                  {planilla.map((r) => {
                    const pres = d.tipo === 'ausentes_2060' && r.presente
                    const sucia = filaSucia(r)
                    return (
                      <tr key={r.unidad_id} style={{ borderTop: '1px solid #e5e7eb', background: sucia ? '#fef9c3' : pres ? '#eff6ff' : undefined }}>
                        <td style={{ padding: 5, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.etiqueta}{pres && <span style={{ fontSize: 10, color: AZ }}> PRES.</span>}</td>
                        <td style={{ padding: 5 }}>{r.propietario}</td>
                        <td style={{ padding: 5, textAlign: 'right' }}>{r.coef}</td>
                        <td style={{ padding: 5 }}>
                          <select value={r.opcion_id} onChange={(e) => setFila(r.unidad_id, 'opcion_id', e.target.value)} style={{ ...INP, padding: '4px 6px', fontSize: 12, minWidth: 110 }}>
                            <option value="">— sin voto —</option>
                            {opcs.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: 5 }}>
                          {pres
                            ? <span style={{ color: GR }}>En asamblea{asmD ? ' ' + String(asmD.fecha).split('-').reverse().join('/') : ''}</span>
                            : <input type="datetime-local" value={r.emitido} onChange={(e) => setFila(r.unidad_id, 'emitido', e.target.value)} style={{ ...INP, padding: '4px 6px', fontSize: 12, width: 175 }} />}
                        </td>
                        <td style={{ padding: 5 }}>
                          <input value={r.nota} onChange={(e) => setFila(r.unidad_id, 'nota', e.target.value)} placeholder={pres ? 'Opcional' : 'Ej.: mail de x@… 30/09 10:15'}
                            style={{ ...INP, padding: '4px 6px', fontSize: 12, minWidth: 170 }} />
                        </td>
                        <td style={{ padding: 5, textAlign: 'center' }}>
                          {r.orig.opcion_id && (
                            <button title="Quitar voto cargado" onClick={() => quitarVoto(r)} disabled={ocupado}
                              style={{ border: 'none', background: 'none', color: RJ, cursor: 'pointer', fontSize: 14 }}>✕</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Btn onClick={guardarPlanilla} disabled={ocupado || !nSucias}>{ocupado ? 'Guardando…' : `💾 Guardar cambios (${nSucias})`}</Btn>
            </div>
          </Card>
        )}

        {eventos.length > 0 && (
          <Card>
            <strong style={{ fontSize: 14 }}>Registro de eventos</strong>
            <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 6, fontSize: 12 }}>
              {eventos.map((e) => (
                <div key={e.id} style={{ padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ color: GR }}>{fF(e.created_at)}</span> · <strong>{e.tipo}</strong>
                  {e.detalle?.resultado ? ' · ' + (RESULTADO[e.detalle.resultado] || e.detalle.resultado) : ''}
                  {e.detalle?.motivo ? ' · ' + e.detalle.motivo : ''}
                  {e.detalle?.enviados != null ? ` · enviados ${e.detalle.enviados}` : ''}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    )
  }

  // Lista
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🗳️ Votaciones — {consorcioActivo?.nombre}</h2>
        {puedeOperar && <Btn onClick={() => { setForm(formVacio()); setVista('form'); setMsg(null) }}>+ Nueva votación</Btn>}
      </div>
      <Msg data={msg} />
      {!lista.length && <Card><div style={{ color: GR, fontSize: 13 }}>No hay votaciones en este consorcio.</div></Card>}
      {lista.map((v) => {
        const ef = v.estado === 'abierta' && new Date(v.cierre) <= new Date() ? 'cerrada' : v.estado
        return (
          <Card key={v.id} style={{ marginBottom: 8 }} onClick={() => abrirDetalle(v)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{v.titulo}</div>
                <div style={{ fontSize: 12, color: GR, marginTop: 2 }}>{TIPOS[v.tipo]?.l}{v.modalidad === 'registro' ? ' · registro manual' : ''} · cierre {fF(v.cierre)}</div>
                {v.resultado_final?.resultado && <div style={{ fontSize: 12, marginTop: 2 }}>Resultado: <strong>{RESULTADO[v.resultado_final.resultado] || v.resultado_final.resultado}</strong></div>}
              </div>
              <span style={{ background: EST_COLOR[ef], color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{ef}</span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
