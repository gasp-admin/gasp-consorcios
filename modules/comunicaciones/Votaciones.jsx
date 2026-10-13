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
  aprobada_expresa: 'Aprobada (mayoría expresa)', aprobada_tacita: 'Aprobada (sin oposición suficiente)',
  rechazada_por_oposicion: 'Rechazada por oposición', opcion_ganadora: 'Opción ganadora',
  sin_mayoria: 'Sin mayoría', sin_definicion: 'Sin definición (empate)', sin_votos: 'Sin votos', sin_padron: 'Sin padrón',
}
const ORIGEN = { portal: 'Portal', admin: 'Carga admin', asamblea: 'Asamblea' }

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
    multiple: false, presentes: [],
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
  const [manual, setManual]       = useState({ unidad_id: '', opcion_id: '', origen: 'admin', nota: '' })

  const puedeOperar = puede('comunicar') || puede('editar')

  const cargar = useCallback(async () => {
    if (!consorcioId) return
    const [{ data }, { data: asm }] = await Promise.all([
      supabase.from('con_votaciones').select('*').eq('consorcio_id', consorcioId).order('created_at', { ascending: false }),
      supabase.from('con_asambleas').select('id, fecha, tipo').eq('consorcio_id', consorcioId).order('fecha', { ascending: false }).limit(30),
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
    if (v.estado !== 'borrador') {
      const { data, error } = await supabase.rpc('vot_escrutinio', { p_votacion_id: v.id })
      if (error) setMsg({ tipo: 'error', texto: errTxt(error) }); else setEsc(data)
    }
  }, [consorcioId])

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
        n.cierre = isoALocal(new Date(base.getTime() + 15 * 86400000).toISOString())
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

  async function editarBorrador(v) {
    const { data: o } = await supabase.from('con_votacion_opciones').select('*').eq('votacion_id', v.id).order('orden')
    const sinAbs = (o || []).filter((x) => x.clave !== 'abstencion')
    setForm({
      id: v.id, tipo: v.tipo, titulo: v.titulo, descripcion: v.descripcion || '', mayoria: v.mayoria, campo_coef: v.campo_coef,
      apertura: isoALocal(v.apertura), cierre: isoALocal(v.cierre), permite_cambio: v.permite_cambio, requiere_otp: v.requiere_otp,
      resultados_visibles: v.resultados_visibles, asamblea_id: v.asamblea_id || '', adjuntos: v.adjuntos || [],
      opciones: sinAbs.map((x) => ({ etiqueta: x.etiqueta, clave: x.clave, detalle: x.detalle || '' })),
      multiple: sinAbs.some((x) => x.clave === 'opcion'), presentes: [],
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
    const ap = form.apertura ? new Date(localAIso(form.apertura)) : new Date()
    const ci = new Date(localAIso(form.cierre))
    if (ci <= ap) return 'El cierre debe ser posterior a la apertura'
    if (ci <= new Date()) return 'El cierre debe ser futuro'
    if (form.tipo === 'ausentes_2060' && (ci - ap) < 15 * 86400000 - 60000) return 'Art. 2060: el plazo debe ser de al menos 15 días desde la apertura'
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
        requiere_otp: !!form.requiere_otp, resultados_visibles: form.resultados_visibles,
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
  const [presentesSel, setPresentesSel] = useState([])

  async function abrir() {
    if (!puedeOperar) return
    if (detalle.tipo === 'ausentes_2060' && !presentesSel.length) return setMsg({ tipo: 'warn', texto: 'Marque las UF presentes en la asamblea' })
    const n = (unidades || []).length
    if (!window.confirm(`Se congelará el padrón (${n} UF, coeficiente "${detalle.campo_coef}") y la votación quedará ABIERTA. Las condiciones ya no podrán modificarse. ¿Continuar?`)) return
    setOcupado(true)
    const { error } = await supabase.rpc('vot_abrir', { p_votacion_id: detalle.id, p_presentes: detalle.tipo === 'ausentes_2060' ? presentesSel : null })
    setOcupado(false)
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    setMsg({ tipo: 'ok', texto: '✓ Votación abierta. Ahora puede enviar la notificación a los propietarios.' })
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

  async function cargarVotoManual() {
    if (!manual.unidad_id || !manual.opcion_id) return setMsg({ tipo: 'warn', texto: 'Elija UF y opción' })
    if (manual.origen === 'admin' && !manual.nota.trim()) return setMsg({ tipo: 'warn', texto: 'Indique el respaldo del voto (ej.: nota firmada recibida el dd/mm)' })
    setOcupado(true)
    const { error } = await supabase.rpc('vot_emitir', {
      p_votacion_id: detalle.id, p_unidad_id: manual.unidad_id, p_opcion_id: manual.opcion_id,
      p_origen: manual.origen, p_ip: null, p_user_agent: 'GASP admin', p_email_verificado: false, p_nota: manual.nota.trim() || null,
    })
    setOcupado(false)
    if (error) return setMsg({ tipo: 'error', texto: errTxt(error) })
    setMsg({ tipo: 'ok', texto: '✓ Voto registrado' })
    setManual({ unidad_id: '', opcion_id: '', origen: manual.origen, nota: '' }); refrescarDetalle()
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
      filas.push({ uf: u.etiqueta, propietario: u.propietario || '', coef: u.coeficiente, voto: o.etiqueta, origen: ORIGEN[u.origen] || u.origen || '', fecha: fF(u.emitido_at) })
    }
    for (const u of esc_.no_voto?.unidades || []) {
      filas.push({ uf: u.etiqueta, propietario: u.propietario || '', coef: u.coeficiente, voto: u.presente_asamblea ? 'PRESENTE (sin voto cargado)' : 'NO VOTÓ', origen: '', fecha: '' })
    }
    return filas.sort((a, b) => String(a.uf).localeCompare(String(b.uf), 'es', { numeric: true }))
  }

  function excel() {
    exportarExcel({
      titulo: `Escrutinio ${detalle.titulo} - ${consorcioActivo?.nombre || ''}`,
      columnas: [{ key: 'uf', label: 'UF' }, { key: 'propietario', label: 'Propietario' }, { key: 'coef', label: 'Coeficiente' }, { key: 'voto', label: 'Voto' }, { key: 'origen', label: 'Origen' }, { key: 'fecha', label: 'Fecha y hora' }],
      filas: filasDetalle(),
    })
  }

  function actaPDF() {
    if (!esc_) return
    const e = esc_
    const filas = filasDetalle()
    const resLabel = (RESULTADO[e.resultado] || e.resultado) + (e.ganador?.etiqueta ? ': ' + e.ganador.etiqueta : '')
    const estadoTxt = e.estado_efectivo === 'cerrada' ? 'ESCRUTINIO FINAL' : 'ESCRUTINIO PARCIAL (votación en curso)'
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
<tr><th>Tipo</th><td>${esc(TIPOS[detalle.tipo]?.l || detalle.tipo)}</td></tr>
<tr><th>Mayoría requerida</th><td>${esc(MAYORIAS[detalle.mayoria] || detalle.mayoria)} — cómputo doble: unidades y coeficiente (${esc(detalle.campo_coef)})</td></tr>
<tr><th>Apertura / Cierre</th><td>${fF(detalle.apertura)} hs / ${fF(detalle.cierre)} hs</td></tr>
${detalle.descripcion ? `<tr><th>Propuesta</th><td style="white-space:pre-wrap">${esc(detalle.descripcion)}</td></tr>` : ''}
</table>
<h2>Resultado</h2>
<table><tr><th>Opción</th><th>UF</th><th>% UF</th><th>% Coef.</th><th>Alcanza mayoría</th></tr>
${(e.opciones || []).map((o) => `<tr><td>${esc(o.etiqueta)}</td><td class="n">${o.uf}</td><td class="n">${o.pct_uf}%</td><td class="n">${o.pct_coef}%</td><td>${o.alcanza_mayoria == null ? '—' : o.alcanza_mayoria ? 'Sí' : 'No'}</td></tr>`).join('')}
<tr><td>No votaron</td><td class="n">${e.no_voto?.uf ?? 0}</td><td class="n">${e.no_voto?.pct_uf ?? 0}%</td><td class="n">${e.no_voto?.pct_coef ?? 0}%</td><td>—</td></tr>
<tr><th>Total padrón</th><th class="n">${e.total_uf}</th><th class="n">100%</th><th class="n">100%</th><th></th></tr></table>
<div class="box"><strong>Resultado:</strong> ${esc(resLabel)} · Participación ${e.votos_emitidos}/${e.total_uf} UF (${e.participacion_pct_uf}%)</div>
${avisos.length ? `<div class="k" style="margin-top:6px">Observaciones: ${avisos.map(esc).join(' · ')}</div>` : ''}
<h2>Detalle por unidad funcional</h2>
<table><tr><th>UF</th><th>Propietario</th><th>Coef.</th><th>Voto</th><th>Origen</th><th>Fecha y hora</th></tr>
${filas.map((f) => `<tr><td>${esc(f.uf)}</td><td>${esc(f.propietario)}</td><td class="n">${esc(f.coef)}</td><td>${esc(f.voto)}</td><td>${esc(f.origen)}</td><td>${esc(f.fecha)}</td></tr>`).join('')}
</table>
<p class="k" style="margin-top:14px">Cada voto emitido por el portal queda registrado con fecha, hora, IP y un código de verificación (SHA-256). Los cambios de voto se conservan en historial. Documento generado por GASP Consorcios el ${fF(new Date().toISOString())} hs.</p>
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
              <label style={LBL}>Apertura (vacío = al abrir)</label>
              <input type="datetime-local" style={INP} value={form.apertura} onChange={(e) => setForm({ ...form, apertura: e.target.value })} />
            </div>
            <div>
              <label style={LBL}>Cierre *</label>
              <input type="datetime-local" style={INP} value={form.cierre} onChange={(e) => setForm({ ...form, cierre: e.target.value })} />
            </div>
            <div>
              <label style={LBL}>Resultados visibles al propietario</label>
              <select style={INP} value={form.resultados_visibles} onChange={(e) => setForm({ ...form, resultados_visibles: e.target.value })}>
                <option value="al_cierre">Al cierre</option><option value="siempre">Siempre (parcial en vivo)</option><option value="nunca">Nunca</option>
              </select>
            </div>
            {form.tipo === 'ausentes_2060' && (
              <div>
                <label style={LBL}>Asamblea de origen</label>
                <select style={INP} value={form.asamblea_id} onChange={(e) => setForm({ ...form, asamblea_id: e.target.value })}>
                  <option value="">— Sin vincular —</option>
                  {asambleas.map((a) => <option key={a.id} value={a.id}>{a.fecha} · {a.tipo}</option>)}
                </select>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 13 }}>
            <label><input type="checkbox" checked={form.permite_cambio} onChange={(e) => setForm({ ...form, permite_cambio: e.target.checked })} /> Permitir cambiar el voto hasta el cierre</label>
            <label><input type="checkbox" checked={form.requiere_otp} onChange={(e) => setForm({ ...form, requiere_otp: e.target.checked })} /> Exigir código por email para votar</label>
          </div>
          {form.requiere_otp && <div style={{ fontSize: 11, color: AM, marginTop: 4 }}>Las UF sin email registrado no podrán votar por el portal (podrá cargar su voto manualmente).</div>}
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
    const votados = new Set((esc_?.opciones || []).flatMap((o) => (o.unidades || []).map((u) => u.unidad_id)))
    const ufsManual = d.tipo === 'ausentes_2060'
      ? (esc_?.no_voto?.unidades || []).concat((esc_?.opciones || []).flatMap((o) => o.unidades || []))
      : null
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
          </div>
          <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>Apertura: {fF(d.apertura)} · Cierre: {fF(d.cierre)}{d.estado === 'abierta' && ef === 'cerrada' ? ' (vencida — registre el cierre)' : ''}</div>
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
                  <Btn color={VD} onClick={abrir} disabled={ocupado}>▶ Abrir votación</Btn>
                  <BtnSec onClick={() => editarBorrador(d)}>✏️ Editar</BtnSec>
                  <BtnSec onClick={eliminarBorrador}>🗑 Eliminar borrador</BtnSec>
                </div>
              </>
            )}
            {d.estado === 'abierta' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ef === 'abierta' && <Btn onClick={() => notificar('convocatoria')} disabled={ocupado}>✉️ Notificar a propietarios</Btn>}
                {ef === 'abierta' && <BtnSec onClick={() => notificar('recordatorio')}>🔔 Recordatorio a quienes no votaron</BtnSec>}
                {ef === 'abierta' && <BtnSec onClick={prorrogar}>⏱ Prorrogar cierre</BtnSec>}
                {(d.tipo !== 'ausentes_2060' || ef === 'cerrada') && <Btn color={AZ} onClick={cerrar} disabled={ocupado}>■ {ef === 'cerrada' ? 'Registrar cierre y escrutinio final' : 'Cerrar anticipadamente'}</Btn>}
                {ef === 'abierta' && <Btn color={RJ} onClick={anular} disabled={ocupado}>Anular</Btn>}
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
              <div key={i} style={{ fontSize: 12, color: AM, marginTop: 4 }}>⚠ {a.tipo === 'coef_suma' ? a.detalle : 'UF con coeficiente 0: ' + (a.unidades || []).join(', ')}</div>
            ))}
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

        {puedeOperar && d.estado === 'abierta' && (
          <Card style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>Cargar voto manualmente</strong>
            <div style={{ fontSize: 11, color: GR, margin: '4px 0 8px' }}>
              {d.tipo === 'ausentes_2060'
                ? 'Origen "Asamblea": voto de las UF presentes según el acta (también después del cierre). Origen "Carga admin": voto de un ausente recibido por medio fehaciente (dentro del plazo).'
                : 'Para votos recibidos por nota firmada u otro medio fehaciente. Indique el respaldo.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8 }}>
              <select style={INP} value={manual.unidad_id} onChange={(e) => setManual({ ...manual, unidad_id: e.target.value })}>
                <option value="">UF…</option>
                {(ufsManual || (unidades || []).map((u) => ({ unidad_id: u.id, etiqueta: etiquetaUF(u) })))
                  .slice().sort((a, b) => String(a.etiqueta).localeCompare(String(b.etiqueta), 'es', { numeric: true }))
                  .map((u) => <option key={u.unidad_id} value={u.unidad_id}>{u.etiqueta}{votados.has(u.unidad_id) ? ' ✓' : ''}{u.presente_asamblea ? ' (presente)' : ''}</option>)}
              </select>
              <select style={INP} value={manual.opcion_id} onChange={(e) => setManual({ ...manual, opcion_id: e.target.value })}>
                <option value="">Opción…</option>
                {opcs.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
              </select>
              {d.tipo === 'ausentes_2060' && (
                <select style={INP} value={manual.origen} onChange={(e) => setManual({ ...manual, origen: e.target.value })}>
                  <option value="asamblea">Asamblea (presente)</option><option value="admin">Carga admin (ausente)</option>
                </select>
              )}
              <input style={INP} value={manual.nota} placeholder="Respaldo (ej.: nota firmada 12/10)" onChange={(e) => setManual({ ...manual, nota: e.target.value })} />
              <Btn onClick={cargarVotoManual} disabled={ocupado}>Registrar</Btn>
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
                <div style={{ fontSize: 12, color: GR, marginTop: 2 }}>{TIPOS[v.tipo]?.l} · cierre {fF(v.cierre)}</div>
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
