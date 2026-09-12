import { useState, Fragment } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, GR, BG, VD } from '../../lib/config'

// ─────────────────────────────────────────────────────────────────────────
// Perfiles de columnas por banco. Cada banco informa distinto; todos se
// normalizan al mismo destino (con_cobranza_lote_linea). Para agregar un
// banco nuevo: sumar un perfil acá, sin tocar la lógica.
// ─────────────────────────────────────────────────────────────────────────
const PERFILES = {
  galicia: {
    label: 'Banco Galicia', headerRow: 0,
    cols: { fecha:'Fecha', importe:'Créditos', nombre:'Leyendas Adicionales 1',
            cuit:'Leyendas Adicionales 2', concepto:'Descripción', referencia:'Número de Comprobante' },
  },
  roela: {
    label: 'Banco Roela', headerRow: 0, csvSep: ';', csvEnc: 'ISO-8859-1',
    cols: { fecha:'Fecha', importe:'Monto', concepto:'Descripción', referencia:'N° de Comprobante' },
    extraer: (c) => {
      const s = String(c || '')
      const m = s.match(/(\d{11})[-\s]+(.+)$/)
      if (m) return { cuit: m[1], nombre: m[2].trim() }
      const only = s.match(/(\d{11})/)
      return { cuit: only ? only[1] : null, nombre: null }
    },
  },
  roela_transf: {
    // Reporte "Listado de Transferencias Recibidas" (.xls binario). Header en
    // fila 1 (fila 0 = título; fila 2 = "Convenio: …", se saltea sola porque
    // no trae importe). Cliente y CUIT vienen en columnas propias → cascada
    // por CUIT (confianza alta), sin extractor. Fecha = fecha de acreditación.
    label: 'Banco Roela — Transferencias (.xls)', headerRow: 1,
    cols: { fecha:'Fecha Acred.', importe:'Importe', nombre:'Cliente',
            cuit:'CUIT', referencia:'Referencia' },
  },
  macro: {
    label: 'Banco Macro', headerRow: 7,
    cols: { fecha:'Fecha', importe:'Importe', concepto:'Concepto', referencia:'Nro. de Referencia' },
    extraer: (c) => {
      const s = String(c || '')
      const cu = s.match(/(\d{11})/)
      let nombre = null
      const m = s.match(/TRANSF[:\s]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ,\.\/\s]+?)(?:\s+\d{11}|$)/i)
      if (m) nombre = m[1].trim()
      return { cuit: cu ? cu[1] : null, nombre }
    },
  },
  bapro: {
    label: 'Banco Provincia', headerRow: 1,
    cols: { fecha:'Fecha', importe:'Importe', concepto:'Descripción Extendida', referencia:'Número Secuencia' },
    extraer: (c) => {
      const s = String(c || '')
      const cu = s.match(/\((\d{11})\)/) || s.match(/(\d{11})/)
      const m = s.match(/TRANSF\s+DE\s+(.+?)(?:\s*\(|\s+\d{11}|$)/i)
      return { cuit: cu ? cu[1] : null, nombre: m ? m[1].trim() : null }
    },
  },
}

// Carga SheetJS desde CDN (GASP no lo trae como dependencia del build).
async function cargarXLSX() {
  if (window.XLSX) return window.XLSX
  await new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de planillas'))
    document.head.appendChild(s)
  })
  return window.XLSX
}

function normFecha(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const n = parseFloat(s)
  if (!isNaN(n) && n > 30000 && n < 60000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10)
  return null
}

function normImporte(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  let s = String(v).trim()
  if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
  return parseFloat(s.replace(/[^\d.\-]/g, '')) || 0
}

// Parser del listado Roela "Transferencias Recibidas" SECCIONADO (multi-cuenta).
// Cada bloque abre con "Convenio: … - Cuenta Nro.: NN/N"; las filas siguientes
// heredan esa cuenta. Funciona igual para 1 sola cuenta (single) que para N.
const RE_CONVENIO = /Cuenta Nro\.?:\s*([0-9]+\/[0-9])/i
function parseSeccionesRoela(rows, perfil) {
  const hdr = (rows[perfil.headerRow] || []).map((c) => String(c || '').trim().toLowerCase())
  const idxDe = (nombre) => hdr.findIndex((h) => h === String(nombre).trim().toLowerCase())
  const cIdx = {}; for (const [k, nom] of Object.entries(perfil.cols)) cIdx[k] = idxDe(nom)
  const out = []
  let cuentaActual = null
  for (let i = perfil.headerRow + 1; i < rows.length; i++) {
    const row = rows[i]; if (!row) continue
    const c0 = String(row[0] == null ? '' : row[0])
    const mc = c0.match(RE_CONVENIO)
    if (mc) { cuentaActual = mc[1]; continue }          // línea de convenio → fija la cuenta
    const get = (k) => (cIdx[k] >= 0 ? row[cIdx[k]] : null)
    const importe = normImporte(get('importe'))
    if (!(importe > 0)) continue                        // solo créditos; saltea subtotales/vacías
    let cuit = get('cuit') ? String(get('cuit')).replace(/\D/g, '') : null
    if (cuit && cuit.length !== 11) cuit = null
    out.push({
      fecha: normFecha(get('fecha')), importe,
      nombre: get('nombre') ? String(get('nombre')).trim() : null,
      cuit, concepto: null,
      referencia: get('referencia') != null ? String(get('referencia')).trim() : null,
      cuenta: cuentaActual,
    })
  }
  return out
}

const th = { padding: '7px 10px', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' }
const td = { padding: '6px 10px', fontSize: 12, verticalAlign: 'top', borderTop: '1px solid #f3f4f6' }

export default function ConciliarPagos() {
  const { consorcioActivo, session, puede } = useApp()
  const [banco, setBanco]       = useState('')
  const [lineas, setLineas]     = useState([])
  const [archivo, setArchivo]   = useState(null)
  const [cargando, setCargando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [msg, setMsg]           = useState(null)
  const [loteId, setLoteId]     = useState(null)
  const [lineasLote, setLineasLote] = useState([])
  const [ufMap, setUfMap]       = useState({})
  const [conciliando, setConciliando] = useState(false)
  const [sel, setSel] = useState(() => new Set())
  const [confirmando, setConfirmando] = useState(false)
  // Modo multi-consorcio (solo perfil roela_transf): ruteo por cuenta→consorcio.
  const [lotes, setLotes] = useState([])               // lotes creados (uno por consorcio)
  const [loteConsorcioId, setLoteConsorcioId] = useState(null)
  const [consorciosById, setConsorciosById] = useState({})
  // Desglose de una línea en varias UF (un pago que cubre 2+ unidades)
  const [desgLine, setDesgLine] = useState(null)      // { id, importe, nombre }
  const [desgRows, setDesgRows] = useState([])        // [{ unidad_id, monto }]
  const [desglosando, setDesglosando] = useState(false)

  const esMulti = banco === 'roela_transf'
  const puedeCobrar = puede ? puede('cobrar') : true

  async function onArchivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!banco) { setMsg({ t:'w', m:'Elegí primero el banco de la planilla.' }); e.target.value = ''; return }
    setArchivo(file); setLineas([]); setMsg(null); setCargando(true)
    setLotes([]); setLoteId(null); setLineasLote([])
    try {
      const perfil = PERFILES[banco]
      const XLSX = await cargarXLSX()
      const esCSV = file.name.toLowerCase().endsWith('.csv')
      let wb
      if (esCSV) {
        const text = await file.text().catch(() => null) ??
          await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsText(file, perfil.csvEnc || 'ISO-8859-1') })
        wb = XLSX.read(text, { type: 'string', FS: perfil.csvSep || ';', raw: true })
      } else {
        const buf = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsArrayBuffer(file) })
        wb = XLSX.read(buf, { type: 'array', raw: true, cellDates: true })
      }
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })

      // Perfil roela_transf → camino multi-consorcio (ruteo por cuenta). Sale acá.
      if (esMulti) { await computeRuteoRoela(rows, perfil); setCargando(false); return }

      const hdr = (rows[perfil.headerRow] || []).map((c) => String(c || '').trim().toLowerCase())
      const idxDe = (nombre) => hdr.findIndex((h) => h === String(nombre).trim().toLowerCase())
      const cIdx = {}; for (const [k, nom] of Object.entries(perfil.cols)) cIdx[k] = idxDe(nom)

      const faltantes = Object.entries(cIdx).filter(([, i]) => i < 0).map(([k]) => k)
      if (cIdx.fecha < 0 || cIdx.importe < 0) {
        setMsg({ t:'e', m:`No encontré las columnas esperadas para ${perfil.label}. ¿Es la planilla correcta? Faltan: ${faltantes.join(', ')}` })
        setCargando(false); return
      }

      const out = []
      for (let i = perfil.headerRow + 1; i < rows.length; i++) {
        const row = rows[i]
        if (!row || row.every((c) => c === '' || c == null)) continue
        const get = (k) => (cIdx[k] >= 0 ? row[cIdx[k]] : null)
        const importe = normImporte(get('importe'))
        if (!(importe > 0)) continue // solo créditos (ingresos)
        let ln = {
          fecha: normFecha(get('fecha')),
          importe,
          nombre: get('nombre') ? String(get('nombre')).trim() : null,
          cuit: get('cuit') ? String(get('cuit')).replace(/\D/g, '') : null,
          concepto: get('concepto') ? String(get('concepto')).trim() : null,
          referencia: get('referencia') != null ? String(get('referencia')).trim() : null,
        }
        if (perfil.extraer) { const ex = perfil.extraer(ln.concepto || ''); ln.cuit = ln.cuit || ex.cuit; ln.nombre = ln.nombre || ex.nombre }
        if (ln.cuit && ln.cuit.length !== 11) ln.cuit = null
        out.push(ln)
      }
      setLineas(out)
      setMsg(out.length ? { t:'ok', m:`Leídas ${out.length} líneas de crédito. Revisá el detalle y confirmá la importación.` }
                        : { t:'w', m:'No se detectaron movimientos de crédito en la planilla.' })
    } catch (err) {
      setMsg({ t:'e', m:'Error al leer la planilla: ' + err.message })
    }
    setCargando(false)
  }

  // Rutea cada fila del listado multi-cuenta a su(s) consorcio(s) vía con_cuenta_roela.
  async function computeRuteoRoela(rows, perfil) {
    const crudas = parseSeccionesRoela(rows, perfil)
    if (!crudas.length) { setLineas([]); setMsg({ t:'w', m:'No se detectaron créditos en el listado.' }); return }
    const { data: mapRows } = await supabase.from('con_cuenta_roela').select('cuenta, consorcio_id, ignorar')
    const mapa = {}
    for (const r of (mapRows || [])) {
      const k = r.cuenta; if (!mapa[k]) mapa[k] = { consorcios: [], ignorar: false }
      if (r.ignorar) mapa[k].ignorar = true
      if (r.consorcio_id) mapa[k].consorcios.push(r.consorcio_id)
    }
    const ids = [...new Set(Object.values(mapa).flatMap((m) => m.consorcios))]
    const { data: cons } = await supabase.from('con_consorcios').select('id, nombre').in('id', ids.length ? ids : ['__none__'])
    const byId = {}; for (const c of (cons || [])) byId[c.id] = c.nombre
    setConsorciosById(byId)
    const anotadas = crudas.map((l) => {
      const m = mapa[l.cuenta]
      let ruteo = 'ignorada', candidatos = [], consorcioAsignado = null
      if (m && m.consorcios.length === 1) { ruteo = 'auto'; candidatos = m.consorcios; consorcioAsignado = m.consorcios[0] }
      else if (m && m.consorcios.length >= 2) { ruteo = 'compartida'; candidatos = m.consorcios }
      return { ...l, ruteo, candidatos, consorcioAsignado }
    })
    setLineas(anotadas)
    const nAuto = anotadas.filter((l) => l.ruteo === 'auto').length
    const nComp = anotadas.filter((l) => l.ruteo === 'compartida').length
    const nIgn  = anotadas.filter((l) => l.ruteo === 'ignorada').length
    setMsg({ t: nComp ? 'w' : 'ok', m:
      `Leídas ${anotadas.length} transferencias — ${nAuto} ruteadas a consorcio único` +
      (nComp ? `, ${nComp} en cuenta compartida (elegí consorcio)` : '') +
      (nIgn ? `, ${nIgn} en cuenta ignorada/no mapeada` : '') + '.' })
  }

  function setLineaConsorcio(idx, cid) {
    setLineas((prev) => prev.map((l, i) => (i === idx ? { ...l, consorcioAsignado: cid || null } : l)))
  }

  // Crea un lote por consorcio con las líneas asignadas. Ignoradas y compartidas
  // sin resolver quedan afuera (nunca se imputan sin consorcio).
  async function importarMulti() {
    if (!puedeCobrar) return setMsg({ t:'w', m:'Tu rol no permite importar cobranzas.' })
    const asignables = lineas.filter((l) => l.ruteo !== 'ignorada' && l.consorcioAsignado)
    const compSinResolver = lineas.filter((l) => l.ruteo === 'compartida' && !l.consorcioAsignado)
    if (!asignables.length) return setMsg({ t:'w', m:'No hay líneas con consorcio asignado para importar.' })
    setImportando(true); setMsg(null)
    try {
      const uid = session.user.id
      const grupos = {}
      for (const l of asignables) { (grupos[l.consorcioAsignado] = grupos[l.consorcioAsignado] || []).push(l) }
      const creados = []
      for (const [cid, ls] of Object.entries(grupos)) {
        const totalImporte = ls.reduce((a, l) => a + l.importe, 0)
        const loteId = 'LOTE-' + cid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        const { error: eLote } = await supabase.from('con_cobranza_lote').insert({
          id: loteId, admin_id: uid, consorcio_id: cid, sistema: banco,
          archivo_nombre: archivo?.name || 'planilla', fecha_archivo: new Date().toISOString().slice(0, 10),
          estado: 'importado', total_registros: ls.length, registros_pendientes: ls.length,
          total_importe: totalImporte, importe_pendiente: totalImporte,
        })
        if (eLote) throw eLote
        const filas = ls.map((l, i) => ({
          id: loteId + '-L' + String(i + 1).padStart(3, '0'),
          admin_id: uid, lote_id: loteId, consorcio_id: cid,
          fecha_pago: l.fecha, importe: l.importe, concepto_original: l.concepto,
          cuit_pagador: l.cuit, nombre_pagador: l.nombre, referencia_bancaria: l.referencia, estado: 'pendiente',
        }))
        const { error: eLin } = await supabase.from('con_cobranza_lote_linea').insert(filas)
        if (eLin) throw eLin
        creados.push({ id: loteId, consorcioId: cid, nombre: consorciosById[cid] || cid, n: ls.length, total: totalImporte })
      }
      setLotes(creados); setLineas([])
      const aviso = compSinResolver.length ? ` (${compSinResolver.length} compartidas sin asignar quedaron afuera)` : ''
      setMsg({ t:'ok', m:`✓ ${creados.length} lote(s) creado(s) con ${asignables.length} líneas${aviso}. Elegí un consorcio abajo para conciliar.` })
    } catch (err) { setMsg({ t:'e', m:'No se pudo importar: ' + err.message }) }
    setImportando(false)
  }

  async function abrirLote(l) {
    setLoteId(l.id); setLoteConsorcioId(l.consorcioId); setSel(new Set())
    await cargarUFs(l.consorcioId)
    await cargarLineasLote(l.id)
  }

  async function importar() {
    if (!puedeCobrar) return setMsg({ t:'w', m:'Tu rol no permite importar cobranzas.' })
    if (!consorcioActivo?.id) return setMsg({ t:'w', m:'Seleccioná un consorcio.' })
    if (!lineas.length) return
    setImportando(true); setMsg(null)
    try {
      const uid = session.user.id
      const totalImporte = lineas.reduce((a, l) => a + l.importe, 0)
      const loteId = 'LOTE-' + consorcioActivo.id + '-' + Date.now()
      const { data: lote, error: eLote } = await supabase.from('con_cobranza_lote').insert({
        id: loteId,
        admin_id: uid, consorcio_id: consorcioActivo.id, sistema: banco,
        archivo_nombre: archivo?.name || 'planilla', fecha_archivo: new Date().toISOString().slice(0, 10),
        estado: 'importado', total_registros: lineas.length,
        registros_pendientes: lineas.length, total_importe: totalImporte, importe_pendiente: totalImporte,
      }).select('id').single()
      if (eLote) throw eLote

      const filas = lineas.map((l, i) => ({
        id: loteId + '-L' + String(i + 1).padStart(3, '0'),
        admin_id: uid, lote_id: lote.id, consorcio_id: consorcioActivo.id,
        fecha_pago: l.fecha, importe: l.importe,
        concepto_original: l.concepto, cuit_pagador: l.cuit, nombre_pagador: l.nombre,
        referencia_bancaria: l.referencia, estado: 'pendiente',
      }))
      const { error: eLin } = await supabase.from('con_cobranza_lote_linea').insert(filas)
      if (eLin) throw eLin

      setMsg({ t:'ok', m:`✓ Importadas ${lineas.length} líneas. Ahora conciliá para proponer la UF de cada pago.` })
      setLineas([]); setArchivo(null)
      setLoteId(lote.id)
      await cargarUFs()
      await cargarLineasLote(lote.id)
    } catch (err) {
      setMsg({ t:'e', m:'No se pudo importar: ' + err.message })
    }
    setImportando(false)
  }

  async function cargarUFs(cid) {
    const consId = cid || consorcioActivo?.id
    if (!consId) { setUfMap({}); return }
    // Expensa de referencia para el "a pagar": la última CERRADA (donde vive la deuda),
    // NO la más reciente (que suele ser el período ABIERTO sin detalle → daría "—").
    // Consistente con la EF confirmar-cobranza (imputa a la última cerrada).
    let { data: expCerr } = await supabase.from('con_expensas')
      .select('id, periodo').eq('consorcio_id', consId).eq('estado', 'cerrada')
      .order('periodo', { ascending: false }).limit(1)
    let expRow = expCerr?.[0] || null
    if (!expRow) {
      const { data: expAny } = await supabase.from('con_expensas')
        .select('id, periodo').eq('consorcio_id', consId).order('periodo', { ascending: false }).limit(1)
      expRow = expAny?.[0] || null
    }
    const [{ data: uni }, { data: props }, { data: consR }] = await Promise.all([
      supabase.from('con_unidades').select('id, nro_uf_pdf, numero, propietario_id').eq('consorcio_id', consId),
      supabase.from('con_copropietarios').select('id, apellido_nombre').eq('consorcio_id', consId),
      supabase.from('con_consorcios').select('fecha_corte_nativo, interes_mora_2').eq('id', consId).maybeSingle(),
    ])
    const pm = {}; for (const p of (props || [])) pm[p.id] = p.apellido_nombre
    const tp = {}
    const expId = expRow?.id
    const ultPeriodo = expRow?.periodo
    const corte = consR?.fecha_corte_nativo || null
    // Si la última expensa es ANTERIOR al corte nativo, su detalle es historia (puede estar corrupto
    // en consorcios migrados): el total a pagar se toma de la apertura del corte (= cta cte).
    const usarAperturas = !!corte && !!ultPeriodo && ultPeriodo < String(corte).slice(0, 7)
    if (usarAperturas) {
      const { data: aperts } = await supabase.from('con_movimientos_unidad')
        .select('unidad_id, tipo, monto').eq('consorcio_id', consId).like('id', 'MOV-APERT-%')
      for (const a of (aperts || [])) tp[a.unidad_id] = a.tipo === 'credito' ? -(+a.monto||0) : (+a.monto||0)
    } else if (expId) {
      const { data: dets } = await supabase.from('con_expensas_detalle')
        .select('unidad_id, saldo_anterior, monto, interes_mora, pagos_periodo').eq('expensa_id', expId)
      for (const d of (dets || [])) tp[d.unidad_id] = Math.round(((+d.saldo_anterior||0)+(+d.monto||0)+(+d.interes_mora||0)-(+d.pagos_periodo||0))*100)/100
    }
    const im2 = parseFloat(consR?.interes_mora_2) || 0
    const m = {}
    for (const u of (uni || [])) {
      const p1 = tp[u.id] ?? null
      // 2do venc = 1er venc + recargo (interes_mora_2 %). Solo sobre saldos deudores (>0).
      const p2 = (p1 != null && p1 > 0) ? Math.round(p1 * (1 + im2/100) * 100) / 100 : p1
      m[u.id] = { nro: u.nro_uf_pdf, dpto: u.numero, ape: pm[u.propietario_id] || '', pagar: p1, pagar2: p2 }
    }
    setUfMap(m)
  }
  async function cargarLineasLote(id) {
    const { data } = await supabase.from('con_cobranza_lote_linea').select('*').eq('lote_id', id).order('fecha_pago')
    setLineasLote(data || [])
  }
  async function conciliar() {
    if (!loteId) return
    setConciliando(true); setMsg(null)
    try {
      // Reintentar: volver a 'pendiente' las líneas aún no confirmadas
      await supabase.from('con_cobranza_lote_linea').update({ estado: 'pendiente' })
        .eq('lote_id', loteId).neq('estado', 'confirmada')
      const { data: { session: sess } } = await supabase.auth.getSession()
      const r = await fetch(`${SUPA_URL}/functions/v1/conciliar-cobranzas`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${sess?.access_token}` },
        body: JSON.stringify({ lote_id: loteId }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) { setMsg({ t:'e', m:'Error al conciliar: ' + (d.error || '') }); setConciliando(false); return }
      setMsg({ t:'ok', m:`Conciliado: ${d.procesadas} sugeridas${d.por_ia?` (${d.por_ia} por IA)`:''}, ${d.sin_match||0} sin coincidencia.` })
      await cargarLineasLote(loteId)
    } catch (e) { setMsg({ t:'e', m:'Error: ' + e.message }) }
    setConciliando(false)
  }

  function toggleSel(id) {
    setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  async function cambiarUF(lineId, unidadId) {
    await supabase.from('con_cobranza_lote_linea')
      .update({ unidad_id: unidadId || null, estado: unidadId ? 'sugerida' : 'sin_match', confianza_matching: unidadId ? 'manual' : '', motivo_pendiente: unidadId ? 'Asignada a mano' : 'Sin imputar' })
      .eq('id', lineId)
    await cargarLineasLote(loteId)
  }
  async function confirmar(payload) {
    setConfirmando(true); setMsg(null)
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      const r = await fetch(`${SUPA_URL}/functions/v1/confirmar-cobranza`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${sess?.access_token}` },
        body: JSON.stringify({ lote_id: loteId, ...payload }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) { setMsg({ t:'e', m:'Error al confirmar: ' + (d.error || '') }); setConfirmando(false); return }
      setMsg({ t:'ok', m:`✓ ${d.confirmadas} cobranzas imputadas${d.aprendidas?` · ${d.aprendidas} reglas aprendidas (CUIT→UF)`:''}.` })
      setSel(new Set())
      await cargarLineasLote(loteId)
    } catch (e) { setMsg({ t:'e', m:'Error: ' + e.message }) }
    setConfirmando(false)
  }

  // ---- Desglose: partir una línea en varias UF ----
  function abrirDesglose(l) {
    setDesgLine({ id: l.id, importe: Number(l.importe), nombre: l.nombre_pagador })
    setDesgRows([{ unidad_id: l.unidad_id || '', monto: '' }, { unidad_id: '', monto: '' }])
    setMsg(null)
  }
  function cerrarDesglose() { setDesgLine(null); setDesgRows([]) }
  function setDesgRow(i, campo, val) { setDesgRows((p) => p.map((r, idx) => (idx === i ? { ...r, [campo]: val } : r))) }
  function addDesgRow() { setDesgRows((p) => [...p, { unidad_id: '', monto: '' }]) }
  function delDesgRow(i) { setDesgRows((p) => p.filter((_, idx) => idx !== i)) }

  async function confirmarDesglose() {
    if (!desgLine) return
    const imps = desgRows.filter((r) => r.unidad_id && Number(r.monto) > 0)
      .map((r) => ({ unidad_id: r.unidad_id, monto: Math.round(Number(r.monto) * 100) / 100 }))
    if (imps.length < 2) return setMsg({ t:'w', m:'El desglose necesita al menos 2 UF con importe.' })
    const us = imps.map((r) => r.unidad_id)
    if (new Set(us).size !== us.length) return setMsg({ t:'w', m:'Hay UF repetidas en el desglose.' })
    const suma = Math.round(imps.reduce((a, r) => a + r.monto, 0) * 100)
    const total = Math.round(desgLine.importe * 100)
    if (suma !== total) return setMsg({ t:'w', m:`La suma ($${(suma / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}) no coincide con el importe de la línea ($${(total / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}).` })
    setDesglosando(true); setMsg(null)
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      const r = await fetch(`${SUPA_URL}/functions/v1/confirmar-cobranza`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${sess?.access_token}` },
        body: JSON.stringify({ lote_id: loteId, modo: 'desglose', line_id: desgLine.id, imputaciones: imps }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) { setMsg({ t:'e', m:'Error al desglosar: ' + (d.error || '') }); setDesglosando(false); return }
      setMsg({ t:'ok', m:`✓ Línea desglosada en ${d.cobranzas} UF.` })
      cerrarDesglose()
      await cargarLineasLote(loteId)
    } catch (e) { setMsg({ t:'e', m:'Error: ' + e.message }) }
    setDesglosando(false)
  }
  const ufOpciones = Object.entries(ufMap)
    .map(([id, u]) => ({ id, nro: u.nro, label: `UF ${u.nro} — ${u.ape || 's/prop'}` }))
    .sort((a, b) => ((parseInt(a.nro,10)||999) - (parseInt(b.nro,10)||999)))

  const totImp = lineas.reduce((a, l) => a + l.importe, 0)
  const conCuit = lineas.filter((l) => l.cuit).length
  const conNombre = lineas.filter((l) => l.nombre).length

  return (
    <div style={{ padding: 20, maxWidth: 1050, margin: '0 auto' }}>
      <h2 style={{ margin: 0, color: AZ, fontSize: 20 }}>🏦 Importar pagos del banco</h2>
      <p style={{ color: GR, fontSize: 13, marginTop: 4 }}>
        {esMulti
          ? <>Listado de <strong>Transferencias Recibidas de Roela (multi-cuenta)</strong>. Cada transferencia se rutea al consorcio por su número de cuenta. Se crea un lote por consorcio.</>
          : <>Subí la planilla de movimientos de la cuenta del consorcio <strong>{consorcioActivo?.nombre || '—'}</strong>. Cada banco tiene su formato; elegí cuál es. Se leen solo los créditos (ingresos) y se dejan listos para conciliar.</>}
      </p>

      <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:18, margin:'16px 0' }}>
        <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:5 }}>Banco de la planilla</label>
            <select value={banco} onChange={(e) => { setBanco(e.target.value); setLineas([]); setArchivo(null); setLotes([]); setLoteId(null); setLineasLote([]) }}
              style={{ padding:'9px 12px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14, minWidth:200, background:'#fff' }}>
              <option value="">— Elegir banco —</option>
              {Object.entries(PERFILES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:5 }}>Planilla (.xlsx, .xls, .csv)</label>
            <input type="file" accept=".xlsx,.xls,.csv" disabled={!banco || cargando} onChange={onArchivo}
              style={{ fontSize:13, padding:'8px 0' }} />
          </div>
          {cargando && <span style={{ fontSize:13, color:GR }}>Leyendo planilla…</span>}
        </div>
      </div>

      {msg && (
        <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:14, fontSize:13, fontWeight:500,
          background: msg.t==='ok'?'#dcfce7':msg.t==='e'?'#fee2e2':'#fef9c3',
          color: msg.t==='ok'?'#15803d':msg.t==='e'?'#b91c1c':'#92400e' }}>{msg.m}</div>
      )}

      {lineas.length > 0 && (
        <>
          <div style={{ display:'flex', gap:20, margin:'8px 2px 12px', fontSize:13, color:'#374151', flexWrap:'wrap' }}>
            <span><strong>{lineas.length}</strong> líneas</span>
            <span>Total: <strong>${totImp.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></span>
            <span>Con CUIT: <strong>{conCuit}</strong></span>
            {esMulti
              ? <>
                  <span>Ruteadas: <strong>{lineas.filter((l)=>l.ruteo==='auto'||(l.ruteo==='compartida'&&l.consorcioAsignado)).length}</strong></span>
                  <span style={{ color: lineas.some((l)=>l.ruteo==='compartida'&&!l.consorcioAsignado)?'#c07d10':GR }}>Compartidas s/asignar: <strong>{lineas.filter((l)=>l.ruteo==='compartida'&&!l.consorcioAsignado).length}</strong></span>
                  <span>Ignoradas: <strong>{lineas.filter((l)=>l.ruteo==='ignorada').length}</strong></span>
                </>
              : <span>Con nombre: <strong>{conNombre}</strong></span>}
          </div>
          <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8, maxHeight:420, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead style={{ position:'sticky', top:0, background:BG }}>
                <tr><th style={th}>Fecha</th><th style={th}>Importe</th><th style={th}>Nombre ordenante</th><th style={th}>CUIT</th>
                  {esMulti ? <th style={th}>Cuenta</th> : null}
                  {esMulti ? <th style={th}>Consorcio</th> : <><th style={th}>Concepto</th><th style={th}>Ref.</th></>}
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i} style={{ background: esMulti && l.ruteo==='ignorada' ? '#f9fafb' : '#fff', opacity: esMulti && l.ruteo==='ignorada' ? 0.6 : 1 }}>
                    <td style={{ ...td, whiteSpace:'nowrap', color: l.fecha?'#111':'#dc2626' }}>{l.fecha || 'sin fecha'}</td>
                    <td style={{ ...td, textAlign:'right', fontWeight:600, whiteSpace:'nowrap' }}>${l.importe.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                    <td style={td}>{l.nombre || <span style={{ color:GR }}>—</span>}</td>
                    <td style={{ ...td, fontFamily:'monospace' }}>{l.cuit || <span style={{ color:GR }}>—</span>}</td>
                    {esMulti ? <td style={{ ...td, fontFamily:'monospace', fontSize:12 }}>{l.cuenta || <span style={{ color:GR }}>—</span>}</td> : null}
                    {esMulti
                      ? <td style={td}>
                          {l.ruteo === 'auto'
                            ? <span style={{ fontSize:12, color:'#15803d', fontWeight:600 }}>{consorciosById[l.consorcioAsignado] || l.consorcioAsignado}</span>
                            : l.ruteo === 'compartida'
                              ? <select value={l.consorcioAsignado || ''} onChange={(e) => setLineaConsorcio(i, e.target.value)}
                                  style={{ padding:'4px 6px', border:'1px solid '+(l.consorcioAsignado?'#d1d5db':'#c07d10'), borderRadius:6, fontSize:12, background:'#fff' }}>
                                  <option value="">— elegí consorcio —</option>
                                  {l.candidatos.map((cid) => <option key={cid} value={cid}>{consorciosById[cid] || cid}</option>)}
                                </select>
                              : <span style={{ fontSize:12, color:GR }}>— ignorada —</span>}
                        </td>
                      : <><td style={{ ...td, fontSize:11, color:GR, maxWidth:260 }}>{l.concepto}</td><td style={{ ...td, fontSize:11, color:GR }}>{l.referencia}</td></>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop:16 }}>
            {esMulti
              ? <button onClick={importarMulti} disabled={importando || !puedeCobrar || !lineas.some((l)=>l.ruteo!=='ignorada'&&l.consorcioAsignado)}
                  style={{ padding:'11px 26px', background:VD, color:'#fff', border:'none', borderRadius:8, fontSize:14, fontWeight:700, cursor: importando?'default':'pointer', opacity: importando?0.7:1 }}>
                  {importando ? 'Importando…' : `Crear lotes e importar ${lineas.filter((l)=>l.ruteo!=='ignorada'&&l.consorcioAsignado).length} líneas`}
                </button>
              : <button onClick={importar} disabled={importando || !puedeCobrar}
                  style={{ padding:'11px 26px', background:VD, color:'#fff', border:'none', borderRadius:8, fontSize:14, fontWeight:700, cursor: importando?'default':'pointer', opacity: importando?0.7:1 }}>
                  {importando ? 'Importando…' : `Importar ${lineas.length} líneas al lote`}
                </button>}
            <span style={{ fontSize:12, color:GR, marginLeft:12 }}>Esto solo guarda las líneas; la imputación a cada UF viene en el siguiente paso.</span>
          </div>
        </>
      )}

      {lotes.length > 0 && (
        <div style={{ marginTop: 22, background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:14 }}>
          <h3 style={{ margin:'0 0 10px', color:AZ, fontSize:15 }}>Lotes creados \u2014 elegí uno para conciliar</h3>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {lotes.map((lt) => (
              <button key={lt.id} onClick={() => abrirLote(lt)}
                style={{ padding:'8px 14px', border:'1px solid '+(loteId===lt.id?AZ:'#d1d5db'), background: loteId===lt.id?BG:'#fff',
                  borderRadius:8, fontSize:13, cursor:'pointer', textAlign:'left' }}>
                <div style={{ fontWeight:700, color:AZ }}>{lt.nombre}</div>
                <div style={{ fontSize:11, color:GR }}>{lt.n} pagos \u00b7 ${lt.total.toLocaleString('es-AR',{minimumFractionDigits:2})}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {loteId && lineasLote.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:10 }}>
            <h3 style={{ margin:0, color:AZ, fontSize:16 }}>{loteConsorcioId ? (consorciosById[loteConsorcioId] || loteConsorcioId) + ' \u2014 ' : 'Lote \u2014 '}{lineasLote.length} pagos</h3>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={conciliar} disabled={conciliando || confirmando}
                style={{ padding:'9px 16px', background:AZ, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer' }}>
                {conciliando ? 'Conciliando\u2026' : '\ud83d\udd0e Conciliar'}
              </button>
              {lineasLote.some((l) => l.estado === 'sugerida') && (
                <>
                  <button onClick={() => confirmar({ modo:'alta' })} disabled={confirmando}
                    style={{ padding:'9px 16px', background:VD, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer' }}>
                    \u2713 Confirmar confianza alta
                  </button>
                  <button onClick={() => confirmar({ line_ids:[...sel] })} disabled={confirmando || !sel.size}
                    style={{ padding:'9px 16px', background: sel.size ? '#1d4ed8' : '#cbd5e1', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor: sel.size ? 'pointer':'default' }}>
                    Confirmar {sel.size} sel.
                  </button>
                </>
              )}
            </div>
          </div>
          <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8, maxHeight:520, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead style={{ position:'sticky', top:0, background:BG, zIndex:1 }}>
                <tr>
                  <th style={{ ...th, width:26 }}></th>
                  <th style={th}>Fecha</th><th style={th}>Importe</th><th style={th}>Ordenante</th>
                  <th style={th}>UF imputada</th><th style={th}>1er venc</th><th style={th}>2º venc</th><th style={th}>Confianza</th><th style={th}>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {lineasLote.map((l) => {
                  const uf = l.unidad_id ? ufMap[l.unidad_id] : null
                  const ign = l.estado === 'ignorada'
                  const conf = l.estado === 'confirmada'
                  const editable = !ign && !conf
                  const cColor = l.confianza_matching==='alta' ? '#15803d' : l.confianza_matching==='media' ? '#c07d10' : l.confianza_matching==='manual' ? '#1d4ed8' : l.confianza_matching==='baja' ? '#6b7280' : '#dc2626'
                  const pagar = uf && uf.pagar != null ? uf.pagar : null
                  const pagar2 = uf && uf.pagar2 != null ? uf.pagar2 : null
                  const coincide = pagar != null && Math.abs(pagar - Number(l.importe)) < 1
                  const coincide2 = pagar2 != null && Math.abs(pagar2 - Number(l.importe)) < 1
                  const rowBg = conf ? '#f0fdf4' : ign ? '#f9fafb' : '#fff'
                  return (
                    <Fragment key={l.id}>
                    <tr style={{ background:rowBg, opacity: ign ? 0.6 : 1 }}>
                      <td style={{ ...td, textAlign:'center' }}>
                        {editable && l.unidad_id ? <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} /> : conf ? '\u2713' : ''}
                      </td>
                      <td style={{ ...td, whiteSpace:'nowrap' }}>{l.fecha_pago}</td>
                      <td style={{ ...td, textAlign:'right', fontWeight:600, whiteSpace:'nowrap' }}>${Number(l.importe).toLocaleString('es-AR',{minimumFractionDigits:2})}</td>
                      <td style={td}>{l.nombre_pagador || '\u2014'}{l.cuit_pagador ? <span style={{ color:GR, fontSize:11 }}> \u00b7 {l.cuit_pagador}</span> : ''}</td>
                      <td style={td}>
                        {ign ? <span style={{ color:GR }}>\u2014 ignorado \u2014</span>
                          : conf ? <span style={{ color:'#15803d', fontWeight:600 }}>UF {uf?.nro} \u2014 {uf?.ape}</span>
                          : <>
                              <select value={l.unidad_id || ''} onChange={(e) => cambiarUF(l.id, e.target.value)}
                                style={{ padding:'4px 6px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, maxWidth:220, background:'#fff' }}>
                                <option value="">\u2014 sin imputar \u2014</option>
                                {ufOpciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                              </select>
                              <div><button onClick={() => abrirDesglose(l)}
                                style={{ background:'none', border:'none', color:AZ, fontSize:11, cursor:'pointer', padding:'2px 0 0', textDecoration:'underline' }}>
                                \u21c4 Desglosar en varias UF</button></div>
                            </>}
                      </td>
                      <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap', fontSize:11, color: pagar==null ? GR : coincide ? '#15803d' : '#c07d10', fontWeight: coincide ? 700 : 400 }}>{pagar != null ? '$'+pagar.toLocaleString('es-AR',{minimumFractionDigits:2}) : '\u2014'}</td>
                      <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap', fontSize:11, color: pagar2==null ? GR : coincide2 ? '#15803d' : '#c07d10', fontWeight: coincide2 ? 700 : 400 }}>{pagar2 != null ? '$'+pagar2.toLocaleString('es-AR',{minimumFractionDigits:2}) : '\u2014'}</td>
                      <td style={{ ...td, color:cColor, fontWeight:600, fontSize:12 }}>{conf ? 'confirmada' : ign ? '\u2014' : (l.confianza_matching || (l.estado==='sin_match' ? 'sin match' : '\u2014'))}</td>
                      <td style={{ ...td, fontSize:11, color: (l.motivo_pendiente||'').includes('distinto') ? '#c2410c' : GR }}>{l.motivo_pendiente}</td>
                    </tr>
                    {desgLine && desgLine.id === l.id && (() => {
                      const suma = desgRows.reduce((a, r) => a + (Number(r.monto) || 0), 0)
                      const dif = Math.round((desgLine.importe - suma) * 100) / 100
                      const ok = Math.abs(dif) < 0.005 && desgRows.filter((r) => r.unidad_id && Number(r.monto) > 0).length >= 2
                      return (
                        <tr>
                          <td colSpan={9} style={{ background:'#f8fafc', padding:'12px 16px', borderBottom:'2px solid '+AZ }}>
                            <div style={{ fontSize:13, fontWeight:700, color:AZ, marginBottom:8 }}>
                              Desglosar ${desgLine.importe.toLocaleString('es-AR', { minimumFractionDigits: 2 })}{desgLine.nombre ? ' \u00b7 ' + desgLine.nombre : ''} en varias UF
                            </div>
                            {desgRows.map((r, ri) => (
                              <div key={ri} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6, flexWrap:'wrap' }}>
                                <select value={r.unidad_id} onChange={(e) => setDesgRow(ri, 'unidad_id', e.target.value)}
                                  style={{ padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, minWidth:240, background:'#fff' }}>
                                  <option value="">\u2014 UF \u2014</option>
                                  {ufOpciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                                </select>
                                <input type="number" step="0.01" value={r.monto} placeholder="importe"
                                  onChange={(e) => setDesgRow(ri, 'monto', e.target.value)}
                                  style={{ padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, width:130, textAlign:'right' }} />
                                {(() => {
                                  const u = r.unidad_id ? ufMap[r.unidad_id] : null
                                  if (!u) return null
                                  const p1 = u.pagar, p2 = u.pagar2
                                  if (p1 == null && p2 == null) return <span style={{ fontSize:11, color:GR }}>sin deuda registrada</span>
                                  return (
                                    <span style={{ fontSize:11, color:GR, display:'inline-flex', gap:10, alignItems:'center' }}>
                                      a pagar:
                                      {p1 != null && <button type="button" onClick={() => setDesgRow(ri, 'monto', String(p1))} title="Usar este importe"
                                        style={{ border:'none', background:'none', color:AZ, cursor:'pointer', fontSize:11, textDecoration:'underline', padding:0 }}>
                                        1er venc ${p1.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</button>}
                                      {p2 != null && <button type="button" onClick={() => setDesgRow(ri, 'monto', String(p2))} title="Usar este importe"
                                        style={{ border:'none', background:'none', color:'#c07d10', cursor:'pointer', fontSize:11, textDecoration:'underline', padding:0 }}>
                                        2\u00ba ${p2.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</button>}
                                    </span>
                                  )
                                })()}
                                {desgRows.length > 2 && <button onClick={() => delDesgRow(ri)} style={{ border:'none', background:'none', color:'#dc2626', cursor:'pointer', fontSize:15 }}>\u2715</button>}
                              </div>
                            ))}
                            <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:8, flexWrap:'wrap' }}>
                              <button onClick={addDesgRow} style={{ border:'1px dashed #94a3b8', background:'#fff', color:AZ, borderRadius:6, padding:'4px 10px', fontSize:12, cursor:'pointer' }}>+ Agregar UF</button>
                              <span style={{ fontSize:12, color: ok ? '#15803d' : '#c07d10', fontWeight:600 }}>
                                Suma: ${suma.toLocaleString('es-AR', { minimumFractionDigits: 2 })} {Math.abs(dif) < 0.005 ? '\u2713 coincide' : `\u00b7 falta $${dif.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`}
                              </span>
                              <button onClick={confirmarDesglose} disabled={desglosando || !ok}
                                style={{ padding:'7px 16px', background: ok ? VD : '#cbd5e1', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor: ok ? 'pointer' : 'default' }}>
                                {desglosando ? 'Confirmando\u2026' : 'Confirmar desglose'}
                              </button>
                              <button onClick={cerrarDesglose} style={{ padding:'7px 14px', background:'none', border:'1px solid #d1d5db', borderRadius:8, fontSize:13, cursor:'pointer' }}>Cancelar</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })()}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize:12, color:GR, marginTop:10 }}>
            Ajust\u00e1 la UF donde haga falta. <strong>Confirmar</strong> crea el recibo en cada UF, imputa a la expensa m\u00e1s reciente por el importe completo y aprende la regla por CUIT. Si un pago cubre 2+ unidades, us\u00e1 <strong>Desglosar</strong> para repartirlo (la suma debe dar el importe exacto).
          </p>
        </div>
      )}
    </div>
  )
}
