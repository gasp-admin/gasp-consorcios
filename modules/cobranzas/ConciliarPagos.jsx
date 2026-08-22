import { useState } from 'react'
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

  const puedeCobrar = puede ? puede('cobrar') : true

  async function onArchivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!banco) { setMsg({ t:'w', m:'Elegí primero el banco de la planilla.' }); e.target.value = ''; return }
    setArchivo(file); setLineas([]); setMsg(null); setCargando(true)
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

  async function cargarUFs() {
    const [{ data: uni }, { data: props }, { data: expR }, { data: consR }] = await Promise.all([
      supabase.from('con_unidades').select('id, nro_uf_pdf, numero, propietario_id').eq('consorcio_id', consorcioActivo.id),
      supabase.from('con_copropietarios').select('id, apellido_nombre').eq('consorcio_id', consorcioActivo.id),
      supabase.from('con_expensas').select('id, periodo').eq('consorcio_id', consorcioActivo.id).order('periodo', { ascending: false }).limit(1),
      supabase.from('con_consorcios').select('fecha_corte_nativo').eq('id', consorcioActivo.id).maybeSingle(),
    ])
    const pm = {}; for (const p of (props || [])) pm[p.id] = p.apellido_nombre
    const tp = {}
    const expId = expR?.[0]?.id
    const ultPeriodo = expR?.[0]?.periodo
    const corte = consR?.fecha_corte_nativo || null
    // Si la última expensa es ANTERIOR al corte nativo, su detalle es historia (puede estar corrupto
    // en consorcios migrados): el total a pagar se toma de la apertura del corte (= cta cte).
    const usarAperturas = !!corte && !!ultPeriodo && ultPeriodo < String(corte).slice(0, 7)
    if (usarAperturas) {
      const { data: aperts } = await supabase.from('con_movimientos_unidad')
        .select('unidad_id, tipo, monto').eq('consorcio_id', consorcioActivo.id).like('id', 'MOV-APERT-%')
      for (const a of (aperts || [])) tp[a.unidad_id] = a.tipo === 'credito' ? -(+a.monto||0) : (+a.monto||0)
    } else if (expId) {
      const { data: dets } = await supabase.from('con_expensas_detalle')
        .select('unidad_id, saldo_anterior, monto, interes_mora, pagos_periodo').eq('expensa_id', expId)
      for (const d of (dets || [])) tp[d.unidad_id] = Math.round(((+d.saldo_anterior||0)+(+d.monto||0)+(+d.interes_mora||0)-(+d.pagos_periodo||0))*100)/100
    }
    const m = {}
    for (const u of (uni || [])) m[u.id] = { nro: u.nro_uf_pdf, dpto: u.numero, ape: pm[u.propietario_id] || '', pagar: tp[u.id] ?? null }
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
        Subí la planilla de movimientos de la cuenta del consorcio <strong>{consorcioActivo?.nombre || '—'}</strong>.
        Cada banco tiene su formato; elegí cuál es. Se leen solo los créditos (ingresos) y se dejan listos para conciliar.
      </p>

      <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:18, margin:'16px 0' }}>
        <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:5 }}>Banco de la planilla</label>
            <select value={banco} onChange={(e) => { setBanco(e.target.value); setLineas([]); setArchivo(null) }}
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
            <span>Con nombre: <strong>{conNombre}</strong></span>
          </div>
          <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8, maxHeight:420, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead style={{ position:'sticky', top:0, background:BG }}>
                <tr><th style={th}>Fecha</th><th style={th}>Importe</th><th style={th}>Nombre ordenante</th><th style={th}>CUIT</th><th style={th}>Concepto</th><th style={th}>Ref.</th></tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i}>
                    <td style={{ ...td, whiteSpace:'nowrap', color: l.fecha?'#111':'#dc2626' }}>{l.fecha || 'sin fecha'}</td>
                    <td style={{ ...td, textAlign:'right', fontWeight:600, whiteSpace:'nowrap' }}>${l.importe.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                    <td style={td}>{l.nombre || <span style={{ color:GR }}>—</span>}</td>
                    <td style={{ ...td, fontFamily:'monospace' }}>{l.cuit || <span style={{ color:GR }}>—</span>}</td>
                    <td style={{ ...td, fontSize:11, color:GR, maxWidth:260 }}>{l.concepto}</td>
                    <td style={{ ...td, fontSize:11, color:GR }}>{l.referencia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop:16 }}>
            <button onClick={importar} disabled={importando || !puedeCobrar}
              style={{ padding:'11px 26px', background:VD, color:'#fff', border:'none', borderRadius:8, fontSize:14, fontWeight:700, cursor: importando?'default':'pointer', opacity: importando?0.7:1 }}>
              {importando ? 'Importando…' : `Importar ${lineas.length} líneas al lote`}
            </button>
            <span style={{ fontSize:12, color:GR, marginLeft:12 }}>Esto solo guarda las líneas; la imputación a cada UF viene en el siguiente paso.</span>
          </div>
        </>
      )}

      {loteId && lineasLote.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:10 }}>
            <h3 style={{ margin:0, color:AZ, fontSize:16 }}>Lote \u2014 {lineasLote.length} pagos</h3>
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
                  <th style={th}>UF imputada</th><th style={th}>A pagar</th><th style={th}>Confianza</th><th style={th}>Motivo</th>
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
                  const coincide = pagar != null && Math.abs(pagar - Number(l.importe)) < 1
                  const rowBg = conf ? '#f0fdf4' : ign ? '#f9fafb' : '#fff'
                  return (
                    <tr key={l.id} style={{ background:rowBg, opacity: ign ? 0.6 : 1 }}>
                      <td style={{ ...td, textAlign:'center' }}>
                        {editable && l.unidad_id ? <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} /> : conf ? '\u2713' : ''}
                      </td>
                      <td style={{ ...td, whiteSpace:'nowrap' }}>{l.fecha_pago}</td>
                      <td style={{ ...td, textAlign:'right', fontWeight:600, whiteSpace:'nowrap' }}>${Number(l.importe).toLocaleString('es-AR',{minimumFractionDigits:2})}</td>
                      <td style={td}>{l.nombre_pagador || '\u2014'}{l.cuit_pagador ? <span style={{ color:GR, fontSize:11 }}> \u00b7 {l.cuit_pagador}</span> : ''}</td>
                      <td style={td}>
                        {ign ? <span style={{ color:GR }}>\u2014 ignorado \u2014</span>
                          : conf ? <span style={{ color:'#15803d', fontWeight:600 }}>UF {uf?.nro} \u2014 {uf?.ape}</span>
                          : <select value={l.unidad_id || ''} onChange={(e) => cambiarUF(l.id, e.target.value)}
                              style={{ padding:'4px 6px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, maxWidth:220, background:'#fff' }}>
                              <option value="">\u2014 sin imputar \u2014</option>
                              {ufOpciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>}
                      </td>
                      <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap', fontSize:11, color: pagar==null ? GR : coincide ? '#15803d' : '#c07d10', fontWeight: coincide ? 700 : 400 }}>{pagar != null ? '$'+pagar.toLocaleString('es-AR',{minimumFractionDigits:2}) : '\u2014'}</td>
                      <td style={{ ...td, color:cColor, fontWeight:600, fontSize:12 }}>{conf ? 'confirmada' : ign ? '\u2014' : (l.confianza_matching || (l.estado==='sin_match' ? 'sin match' : '\u2014'))}</td>
                      <td style={{ ...td, fontSize:11, color: (l.motivo_pendiente||'').includes('distinto') ? '#c2410c' : GR }}>{l.motivo_pendiente}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize:12, color:GR, marginTop:10 }}>
            Ajust\u00e1 la UF donde haga falta. <strong>Confirmar</strong> crea el recibo en cada UF, imputa a la expensa m\u00e1s reciente por el importe completo y aprende la regla por CUIT.
          </p>
        </div>
      )}
    </div>
  )
}
