import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'

const fmtN = n => '$' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })
const box = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 16, background: '#fff' }
const h = { fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#111' }
const lbl = { fontSize: 12, color: GR, marginBottom: 4, display: 'block' }
const inp = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }
const btn = (bg, dis) => ({ padding: '8px 14px', border: 'none', borderRadius: 8, background: dis ? '#cbd5e1' : bg, color: '#fff', fontWeight: 600, fontSize: 13, cursor: dis ? 'default' : 'pointer' })

const primerDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

export default function InterfastPanel() {
  const { session, consorcioActivo, expensas, puede } = useApp()
  const consorcioId = consorcioActivo?.id
  const [cfg, setCfg] = useState(null)
  const [ufs, setUfs] = useState([])
  const [expSel, setExpSel] = useState('')
  const [fDesde, setFDesde] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [fHasta, setFHasta] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [pubs, setPubs] = useState([])
  // Conciliación y control
  const [cDesde, setCDesde] = useState(primerDiaMes())
  const [cHasta, setCHasta] = useState(new Date().toISOString().slice(0, 10))
  const [cTodos, setCTodos] = useState(true)
  const [cSoloProb, setCSoloProb] = useState(true)
  const [cVista, setCVista] = useState('pagos')
  const [concil, setConcil] = useState(null)
  const [cCuit, setCCuit] = useState('30716248794')
  const [cArchivos, setCArchivos] = useState([])
  const [cuentasMap, setCuentasMap] = useState(null)

  useEffect(() => { if (consorcioId) { cargarCfg(); cargarUfs(); cargarPubs() } }, [consorcioId])
  useEffect(() => { cargarCuentas() }, [])

  async function cargarCuentas() {
    const [cb, cr] = await Promise.all([
      supabase.from('con_cuentas_banco').select('consorcio_id, nro_cuenta, cbu'),
      supabase.from('con_cuenta_roela').select('consorcio_id, cuenta, ignorar'),
    ])
    const m = new Map()
    const add = (k, cid) => { if (!k || !cid) return; const kk = normCuenta(k); if (!m.has(kk)) m.set(kk, new Set()); m.get(kk).add(cid) }
    for (const r of cb.data || []) { add(r.nro_cuenta, r.consorcio_id); add(r.cbu, r.consorcio_id) }
    for (const r of cr.data || []) { if (!r.ignorar) add(r.cuenta, r.consorcio_id) }
    setCuentasMap(m)
  }

  async function cargarCfg() {
    const { data } = await supabase.from('con_config_cobranza').select('*').eq('consorcio_id', consorcioId).maybeSingle()
    setCfg(data || { consorcio_id: consorcioId, interfast_activo: false, interfast_convenio: '', interfast_codigo_admin: '', interfast_api_usuario: '', interfast_api_password: '' })
  }
  async function cargarUfs() {
    const { data } = await supabase.from('con_interfast_uf').select('*').eq('consorcio_id', consorcioId).order('codigo_cliente')
    setUfs(data || [])
  }
  async function cargarPubs() {
    const { data } = await supabase.from('con_interfast_publicacion').select('*').eq('consorcio_id', consorcioId).order('created_at', { ascending: false })
    setPubs(data || [])
  }
  function set(k, v) { setCfg(c => ({ ...c, [k]: v })) }

  async function guardarCfg() {
    setBusy('cfg'); setMsg(null)
    const payload = { ...cfg, id: `CFG-COB-${consorcioId}`, admin_id: session.user.id, consorcio_id: consorcioId, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('con_config_cobranza').upsert([payload], { onConflict: 'consorcio_id' })
    setBusy(''); setMsg(error ? { t: 'e', x: error.message } : { t: 'ok', x: '✓ Configuración guardada' })
  }

  async function invoke(fn, body, tag) {
    setBusy(tag); setMsg(null); setPreview(null)
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      return data
    } catch (e) { setMsg({ t: 'e', x: e.message }); return null }
    finally { setBusy('') }
  }

  async function publicar(dry) {
    if (!expSel) return setMsg({ t: 'w', x: 'Elegí una liquidación' })
    const d = await invoke('publicar-deuda-interfast', { expensa_id: expSel, dry_run: dry }, dry ? 'pub-dry' : 'pub')
    if (!d) return
    if (dry) { setPreview(d); setMsg({ t: 'ok', x: `Vista previa: ${d.total_registros} UF · 1er vto ${fmtN(d.total_1er_vto)} · 2do ${fmtN(d.total_2do_vto)}` }) }
    else { setMsg({ t: d.ok ? 'ok' : 'e', x: d.ok ? `✓ Publicado. Nº ${d.respuesta?.PublicacionId ?? ''} — ${d.total_registros} UF` : (d.respuesta?.Mensaje || d.mensaje || 'Error al publicar') }); if (d.ok) cargarPubs() }
  }
  async function cvu() {
    const d = await invoke('interfast-medios-pago', { accion: 'cvu_crear', consorcio_id: consorcioId }, 'cvu')
    if (d) { setMsg({ t: 'ok', x: `CVU: ${d.creadas} procesadas · ${d.errores} errores` }); cargarUfs() }
  }
  async function cvuSync() {
    const d = await invoke('interfast-medios-pago', { accion: 'cvu_listar', consorcio_id: consorcioId }, 'cvusync')
    if (d) { setMsg({ t: 'ok', x: `Sincronizadas ${d.con_cvu} CVU · ${d.sin_cvu} sin asignar` }); cargarUfs() }
  }
  async function qr() {
    const d = await invoke('interfast-medios-pago', { accion: 'qr_generar', consorcio_id: consorcioId }, 'qr')
    if (d) { setMsg({ t: d.generados ? 'ok' : 'w', x: `QR: ${d.generados} generados · ${d.errores} errores` }); cargarUfs() }
  }
  async function traerPagos(dry) {
    const d = await invoke('imputar-pagos-interfast', { consorcio_id: consorcioId, fecha_desde: fDesde, fecha_hasta: fHasta, dry_run: dry }, dry ? 'pg-dry' : 'pg')
    if (!d) return
    setPreview(d)
    setMsg({ t: 'ok', x: dry ? `${d.total_pagos} pagos · ${d.detalle?.filter(x => x.estado === 'imputaria').length || 0} a imputar` : `✓ Imputados ${d.imputados} · ${d.ya_imputados} ya estaban · ${d.sin_match} sin UF` })
  }

  // ── Conciliación y control ──────────────────────────────────────────────
  async function conciliar() {
    setConcil(null)
    const body = { fecha_desde: cDesde, fecha_hasta: cHasta }
    if (!cTodos) body.consorcio_id = consorcioId
    const d = await invoke('conciliar-interfast', body, 'conc')
    if (!d) return
    setConcil(d)
    const t = d.totales || {}
    setMsg({ t: (t.no_imputado_cant || t.sin_match_cant || t.sin_rendicion_cant) ? 'w' : 'ok', x: `Conciliado ${t.conciliado_cant}/${t.rendido_cant} · No imputado ${t.no_imputado_cant} (${fmtN(t.no_imputado_total)}) · Sin UF ${t.sin_match_cant} · Huérfanos ${t.sin_rendicion_cant}` })
  }
  async function imputarFaltantes(c) {
    const n = c.no_imputado_cant + c.sin_match_cant
    if (!window.confirm(`Imputar en ${c.nombre} los pagos rendidos por Interfast que faltan (${c.no_imputado_cant} imputables${c.sin_match_cant ? ` · ${c.sin_match_cant} sin match UF se saltarán` : ''})?\nSe crearán las cobranzas en la cta cte. Rango ${cDesde} a ${cHasta}.`)) return
    const d = await invoke('imputar-pagos-interfast', { consorcio_id: c.consorcio_id, fecha_desde: cDesde, fecha_hasta: cHasta, dry_run: false }, 'imp-' + c.consorcio_id)
    if (!d) return
    setMsg({ t: 'ok', x: `✓ ${c.nombre}: imputados ${d.imputados} · ya estaban ${d.ya_imputados} · sin UF ${d.sin_match}` })
    conciliar()
  }
  function descargarCSV(rows, sufijo) {
    const csv = rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${sufijo}_${cDesde}_${cHasta}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  function exportCSV() {
    if (!concil) return
    if (cVista === 'banco') {
      const { filas } = computeBanco()
      const rows = [['Consorcio', 'Fecha acreditación', 'Neto esperado (IF)', 'Real banco (RAPIFAST)', 'Diferencia', 'Estado']]
      for (const f of filas) rows.push([f.nombre, f.fecha, String(f.esp).replace('.', ','), String(f.real).replace('.', ','), String(f.dif).replace('.', ','), f.est])
      descargarCSV(rows, 'conciliacion_deposito_interfast')
      return
    }
    if (cVista === 'depositos') {
      const rows = [['Consorcio', 'Fecha acreditación', 'Pagos', 'Bruto', 'Comisión', 'Neto depositado']]
      for (const c of concil.consorcios || []) for (const d of c.depositos || []) rows.push([c.nombre, d.fecha, d.cant, String(d.bruto).replace('.', ','), String(d.comision).replace('.', ','), String(d.neto).replace('.', ',')])
      descargarCSV(rows, 'depositos_interfast')
      return
    }
    const rows = [['Consorcio', 'Fecha', 'UF', 'CodCliente', 'Canal', 'Monto', 'Estado', 'IdPago']]
    for (const c of concil.consorcios || []) {
      for (const p of c.pagos || []) rows.push([c.nombre, p.fecha, p.uf_label, p.codCliente, p.canal || '', String(p.monto).replace('.', ','), p.estado, p.idPago])
      for (const hg of c.huerfanos_gasp || []) rows.push([c.nombre, hg.fecha, hg.uf_label, '', '', String(hg.monto).replace('.', ','), 'huerfano_gasp', hg.idPago])
    }
    descargarCSV(rows, 'conciliacion_interfast')
  }

  // ── Conciliar banco (depósitos Interfast/RAPIFAST contra el neto) ──
  function normCuenta(k) { return String(k || '').trim().replace(/\s+/g, '').toUpperCase() }
  function parseNum(v) {
    if (typeof v === 'number') return v
    let s = String(v).trim().replace(/[^\d.,-]/g, '')
    if (!s) return 0
    if (s.includes(',') && s.includes('.')) { if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '') }
    else if (s.includes(',')) s = s.replace(',', '.')
    const n = parseFloat(s); return isNaN(n) ? 0 : n
  }
  function parseFecha(v) {
    if (v instanceof Date && !isNaN(v)) { const z = new Date(v.getTime() - v.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10) }
    if (typeof v === 'number' && v > 20000 && v < 90000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return d.toISOString().slice(0, 10) }
    const s = String(v).trim()
    let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
    m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` }
    return ''
  }
  function detectarBanco(aoa) {
    const txt = aoa.slice(0, 5).map(r => r.join(' ')).join(' ').toUpperCase()
    if (txt.includes('TRANSFERENCIAS RECIBIDAS') || txt.includes('CUENTA NRO')) return 'roela'
    if (txt.includes('DESCRIPCIÓN EXTENDIDA') || txt.includes('DESCRIPCION EXTENDIDA') || txt.includes('PROVINCIA')) return 'provincia'
    if (txt.includes('LEYENDAS ADICIONALES') || txt.includes('CRÉDITOS') || txt.includes('CREDITOS')) return 'galicia'
    return 'generico'
  }
  async function loadXLSX() {
    if (window.XLSX) return window.XLSX
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel')); document.head.appendChild(s) })
    return window.XLSX
  }
  async function parseExtracto(file) {
    const XLSX = await loadXLSX()
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
    const cuit = (cCuit || '').replace(/\D/g, '')
    const out = { nombre: file.name, banco: 'desconocido', single: true, consorcio_id: '', lineas: [], total: 0 }
    for (const sh of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, raw: true, defval: '' })
      if (!aoa.length) continue
      out.banco = detectarBanco(aoa)
      out.single = out.banco !== 'roela'
      let hi = aoa.findIndex(r => r.some(c => /importe|cr[eé]ditos/i.test(String(c))))
      if (hi < 0) hi = 0
      const heads = aoa[hi].map(c => String(c).toLowerCase().trim())
      const findCol = (...names) => { for (const n of names) { const i = heads.findIndex(h => h.includes(n)); if (i >= 0) return i } return -1 }
      const iImp = findCol('importe', 'créditos', 'creditos')
      const iFAcr = findCol('fecha acred')
      const iF = iFAcr >= 0 ? iFAcr : findCol('fecha')
      const iCuit = findCol('cuit')
      let seccion = ''
      for (let r = hi + 1; r < aoa.length; r++) {
        const row = aoa[r]; const joined = row.join(' ')
        const ms = /cuenta\s*nro\.?:\s*([0-9]+\/[0-9])/i.exec(joined)
        if (ms) { seccion = ms[1]; continue }
        const digits = joined.replace(/\D/g, '')
        const esIF = (cuit && ((iCuit >= 0 && String(row[iCuit]).replace(/\D/g, '').includes(cuit)) || digits.includes(cuit))) || /rapifast/i.test(joined)
        if (!esIF) continue
        const importe = parseNum(iImp >= 0 ? row[iImp] : '')
        const fecha = parseFecha(iF >= 0 ? row[iF] : '')
        if (!(importe > 0) || !fecha) continue
        out.lineas.push({ cuenta: seccion || null, fecha, importe })
        out.total = Math.round((out.total + importe) * 100) / 100
      }
      if (out.lineas.length) break
    }
    return out
  }
  async function onFiles(files) {
    setBusy('banco'); setMsg(null)
    try {
      const arr = []
      for (const f of Array.from(files)) arr.push(await parseExtracto(f))
      setCArchivos(prev => [...prev, ...arr])
      const sinIF = arr.filter(a => !a.lineas.length).map(a => a.nombre)
      if (sinIF.length) setMsg({ t: 'w', x: `Sin líneas de Interfast (CUIT ${cCuit}) en: ${sinIF.join(', ')}` })
    } catch (e) { setMsg({ t: 'e', x: 'Error leyendo extracto: ' + e.message }) }
    finally { setBusy('') }
  }
  function ruteaLinea(arch, ln) {
    if (arch.single) return arch.consorcio_id || null
    if (!ln.cuenta || !cuentasMap) return null
    const cand = [...(cuentasMap.get(normCuenta(ln.cuenta)) || [])]
    const activos = new Set((concil?.consorcios || []).map(c => c.consorcio_id))
    const f = cand.filter(c => activos.has(c))
    return f.length === 1 ? f[0] : (cand.length === 1 ? cand[0] : null)
  }
  function computeBanco() {
    const nombreCid = new Map(); const espMap = new Map()
    for (const c of (concil?.consorcios || [])) { nombreCid.set(c.consorcio_id, c.nombre); for (const d of c.depositos || []) espMap.set(c.consorcio_id + '|' + d.fecha, d.neto) }
    const realMap = new Map(); let sinRuteo = 0
    for (const arch of cArchivos) for (const ln of arch.lineas) {
      const cid = ruteaLinea(arch, ln); if (!cid) { sinRuteo++; continue }
      const k = cid + '|' + ln.fecha
      realMap.set(k, Math.round(((realMap.get(k) || 0) + ln.importe) * 100) / 100)
    }
    const claves = new Set([...espMap.keys(), ...realMap.keys()])
    const filas = [...claves].map(k => {
      const [cid, fecha] = k.split('|')
      const esp = espMap.get(k) || 0, real = realMap.get(k) || 0
      const dif = Math.round((real - esp) * 100) / 100
      let est = 'conciliado'
      if (esp > 0 && real === 0) est = 'falta_banco'
      else if (esp === 0 && real > 0) est = 'extra_banco'
      else if (Math.abs(dif) > 0.02) est = 'diferencia'
      return { cid, nombre: nombreCid.get(cid) || cid, fecha, esp, real, dif, est }
    }).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.nombre < b.nombre ? -1 : 1)))
    const tot = filas.reduce((s, f) => ({ esp: s.esp + f.esp, real: s.real + f.real, ok: s.ok + (f.est === 'conciliado' ? 1 : 0) }), { esp: 0, real: 0, ok: 0 })
    return { filas, esp: Math.round(tot.esp * 100) / 100, real: Math.round(tot.real * 100) / 100, ok: tot.ok, sinRuteo }
  }

  const card = (label, cant, monto, color) => (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: GR }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{cant}</div>
      <div style={{ fontSize: 12, color: '#374151' }}>{fmtN(monto)}</div>
    </div>
  )
  const estBadge = (est) => {
    const m = ({
      conciliado: { bg: '#dcfce7', c: '#166534', t: 'Conciliado' },
      no_imputado: { bg: '#fee2e2', c: '#991b1b', t: 'No imputado' },
      sin_match_uf: { bg: '#ffedd5', c: '#9a3412', t: 'Sin match UF' },
      monto_cero: { bg: '#f1f5f9', c: '#475569', t: 'Monto 0' },
      huerfano_gasp: { bg: '#fef9c3', c: '#854d0e', t: 'Huérfano GASP' },
      falta_banco: { bg: '#fee2e2', c: '#991b1b', t: 'Falta en banco' },
      extra_banco: { bg: '#fef9c3', c: '#854d0e', t: 'Extra en banco' },
      diferencia: { bg: '#ffedd5', c: '#9a3412', t: 'Diferencia' },
    })[est] || { bg: '#f1f5f9', c: '#475569', t: est }
    return <span style={{ background: m.bg, color: m.c, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{m.t}</span>
  }

  if (!consorcioId) return <div style={{ padding: 20, color: GR }}>Elegí un consorcio.</div>
  if (!cfg) return <div style={{ padding: 20, color: GR }}>Cargando…</div>
  const expOrd = [...(expensas || [])].filter(e => e.consorcio_id === consorcioId).sort((a, b) => (b.periodo || '').localeCompare(a.periodo || ''))
  const B = (busy !== '')
  const puedeCobrar = typeof puede === 'function' ? puede('cobrar') : true
  const consConMov = concil ? (concil.consorcios || []).filter(c => c.rendido_cant > 0 || c.imputado_cant > 0 || c.error) : []
  const detalle = concil ? (concil.consorcios || []).flatMap(c => [
    ...(c.pagos || []).map(p => ({ consorcio: c.nombre, fecha: p.fecha, uf_label: p.uf_label, canal: p.canal, monto: p.monto, estado: p.estado, idPago: p.idPago })),
    ...(c.huerfanos_gasp || []).map(hg => ({ consorcio: c.nombre, fecha: hg.fecha, uf_label: hg.uf_label, canal: '', monto: hg.monto, estado: 'huerfano_gasp', idPago: hg.idPago })),
  ]) : []
  const detalleVis = detalle.filter(d => !cSoloProb || d.estado !== 'conciliado').sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
  const depositos = concil ? (concil.consorcios || []).flatMap(c => (c.depositos || []).map(d => ({ consorcio: c.nombre, ...d }))).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.consorcio < b.consorcio ? -1 : 1))) : []

  return (
    <div style={{ maxWidth: 900 }}>
      {msg && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13, background: msg.t === 'e' ? '#fee2e2' : msg.t === 'w' ? '#fef9c3' : '#dcfce7', color: msg.t === 'e' ? '#991b1b' : msg.t === 'w' ? '#854d0e' : '#166534' }}>{msg.x}</div>}

      {/* Config */}
      <div style={box}>
        <div style={h}>⚙️ Configuración Interfast (Banco Macro)</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13 }}>
          <input type="checkbox" checked={!!cfg.interfast_activo} onChange={e => set('interfast_activo', e.target.checked)} />
          Interfast activo para este consorcio
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={lbl}>Código de convenio</label><input style={inp} value={cfg.interfast_convenio || ''} onChange={e => set('interfast_convenio', e.target.value)} placeholder="ej. 1" /></div>
          <div><label style={lbl}>Código de administrador</label><input style={inp} value={cfg.interfast_codigo_admin || ''} onChange={e => set('interfast_codigo_admin', e.target.value)} placeholder="ej. 903" /></div>
          <div><label style={lbl}>Usuario API</label><input style={inp} value={cfg.interfast_api_usuario || ''} onChange={e => set('interfast_api_usuario', e.target.value)} /></div>
          <div><label style={lbl}>Contraseña API</label><input style={inp} type="password" value={cfg.interfast_api_password || ''} onChange={e => set('interfast_api_password', e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 12 }}><button style={btn(AZ, busy === 'cfg')} disabled={B} onClick={guardarCfg}>{busy === 'cfg' ? 'Guardando…' : 'Guardar configuración'}</button></div>
      </div>

      {/* Publicar */}
      <div style={box}>
        <div style={h}>📤 Publicar deuda</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={lbl}>Liquidación</label>
            <select style={inp} value={expSel} onChange={e => setExpSel(e.target.value)}>
              <option value="">— Elegí —</option>
              {expOrd.map(e => <option key={e.id} value={e.id}>{e.periodo} · {e.estado}</option>)}
            </select>
          </div>
          <button style={btn(GR, busy === 'pub-dry')} disabled={B} onClick={() => publicar(true)}>Vista previa</button>
          <button style={btn(VD, busy === 'pub')} disabled={B} onClick={() => publicar(false)}>Publicar</button>
        </div>
        {preview?.publicacion && (
          <div style={{ marginTop: 12, maxHeight: 220, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f8fafc' }}><th style={{ padding: 6, textAlign: 'left' }}>UF</th><th style={{ padding: 6, textAlign: 'left' }}>Nombre</th><th style={{ padding: 6, textAlign: 'right' }}>1er vto</th><th style={{ padding: 6, textAlign: 'right' }}>2do vto</th></tr></thead>
              <tbody>{preview.publicacion.Items.map((it, i) => <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 6 }}>{it.CodigoCliente}</td><td style={{ padding: 6 }}>{it.NombreCliente}</td><td style={{ padding: 6, textAlign: 'right' }}>{fmtN(it.ImportePrimerVencimiento)}</td><td style={{ padding: 6, textAlign: 'right' }}>{fmtN(it.ImporteSegundoVencimiento)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Publicaciones a Interfast */}
      <div style={box}>
        <div style={h}>🧾 Publicaciones a Interfast</div>
        {pubs.length > 0 ? (
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: 6, textAlign: 'left' }}>Período</th>
                <th style={{ padding: 6, textAlign: 'left' }}>IdDeuda</th>
                <th style={{ padding: 6, textAlign: 'right' }}>1er vto</th>
                <th style={{ padding: 6, textAlign: 'right' }}>2do vto</th>
                <th style={{ padding: 6, textAlign: 'center' }}>UF</th>
                <th style={{ padding: 6, textAlign: 'center' }}>Estado</th>
                <th style={{ padding: 6, textAlign: 'left' }}>Fecha</th>
              </tr></thead>
              <tbody>{pubs.map(p => {
                const ok = p.respuesta?.Exito === true || String(p.respuesta?.Exito) === 'true'
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: 6 }}>{p.periodo}</td>
                    <td style={{ padding: 6, fontFamily: 'monospace' }}>{p.id_deuda ?? '—'}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(p.total_1er_vto)}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(p.total_2do_vto)}</td>
                    <td style={{ padding: 6, textAlign: 'center' }}>{p.registros}</td>
                    <td style={{ padding: 6, textAlign: 'center', color: ok ? '#166534' : '#991b1b', fontWeight: 600 }}>{ok ? '✅ OK' : '❌'}</td>
                    <td style={{ padding: 6 }}>{String(p.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        ) : <div style={{ fontSize: 12, color: GR }}>Sin publicaciones registradas todavía.</div>}
      </div>

      {/* Medios de pago */}
      <div style={box}>
        <div style={h}>💳 Medios de pago (CVU · QR)</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <button style={btn(AZ, busy === 'cvu')} disabled={B} onClick={cvu}>Crear CVU</button>
          <button style={btn(GR, busy === 'cvusync')} disabled={B} onClick={cvuSync}>Sincronizar CVU</button>
          <button style={btn(GR, busy === 'qr')} disabled={B} onClick={qr}>Generar QR</button>
        </div>
        {ufs.length > 0 ? (
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f8fafc' }}><th style={{ padding: 6, textAlign: 'left' }}>UF</th><th style={{ padding: 6, textAlign: 'left' }}>CPE</th><th style={{ padding: 6, textAlign: 'left' }}>CVU</th><th style={{ padding: 6, textAlign: 'center' }}>QR</th></tr></thead>
              <tbody>{ufs.map(u => <tr key={u.id} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 6 }}>{u.codigo_cliente}</td><td style={{ padding: 6, fontFamily: 'monospace' }}>{u.cpe}</td><td style={{ padding: 6, fontFamily: 'monospace' }}>{u.cvu || <span style={{ color: GR }}>—</span>}</td><td style={{ padding: 6, textAlign: 'center' }}>{u.qr ? '✓' : '—'}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <div style={{ fontSize: 12, color: GR }}>Sin CVU generadas todavía.</div>}
      </div>

      {/* Traer pagos */}
      <div style={box}>
        <div style={h}>📥 Traer pagos (rendiciones)</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Desde</label><input style={inp} type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} /></div>
          <div><label style={lbl}>Hasta</label><input style={inp} type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} /></div>
          <button style={btn(GR, busy === 'pg-dry')} disabled={B} onClick={() => traerPagos(true)}>Vista previa</button>
          <button style={btn(VD, busy === 'pg')} disabled={B} onClick={() => traerPagos(false)}>Imputar</button>
        </div>
        {preview?.detalle && Array.isArray(preview.detalle) && (
          <div style={{ marginTop: 12, maxHeight: 220, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f8fafc' }}><th style={{ padding: 6, textAlign: 'left' }}>Pago</th><th style={{ padding: 6, textAlign: 'left' }}>UF</th><th style={{ padding: 6, textAlign: 'right' }}>Monto</th><th style={{ padding: 6, textAlign: 'left' }}>Estado</th></tr></thead>
              <tbody>{preview.detalle.map((d, i) => <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 6 }}>{d.idPago}</td><td style={{ padding: 6 }}>{d.codCliente}</td><td style={{ padding: 6, textAlign: 'right' }}>{fmtN(d.monto)}</td><td style={{ padding: 6 }}>{d.estado}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Conciliación y control */}
      <div style={box}>
        <div style={h}>🔎 Conciliación y control de acreditaciones</div>
        <div style={{ fontSize: 12, color: GR, marginBottom: 12 }}>Cruza lo <b>rendido por Interfast</b> contra lo <b>imputado en GASP</b> (cta cte) en ambos sentidos. No modifica datos: solo el botón “Imputar faltantes” crea cobranzas, con confirmación.</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 6 }}>
          <div><label style={lbl}>Desde</label><input style={inp} type="date" value={cDesde} onChange={e => setCDesde(e.target.value)} /></div>
          <div><label style={lbl}>Hasta</label><input style={inp} type="date" value={cHasta} onChange={e => setCHasta(e.target.value)} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 8 }}>
            <input type="checkbox" checked={cTodos} onChange={e => setCTodos(e.target.checked)} /> Todos los consorcios activos
          </label>
          <button style={btn(AZ, busy === 'conc')} disabled={B} onClick={conciliar}>{busy === 'conc' ? 'Conciliando…' : 'Conciliar'}</button>
          {concil && <button style={btn(GR, false)} disabled={B} onClick={exportCSV}>Exportar CSV</button>}
        </div>

        {concil && (
          <div style={{ display: 'flex', gap: 6, margin: '12px 0 4px' }}>
            <button onClick={() => setCVista('pagos')} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid ' + (cVista === 'pagos' ? AZ : '#d1d5db'), background: cVista === 'pagos' ? AZ : '#fff', color: cVista === 'pagos' ? '#fff' : '#374151', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Pagos (imputación)</button>
            <button onClick={() => setCVista('depositos')} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid ' + (cVista === 'depositos' ? AZ : '#d1d5db'), background: cVista === 'depositos' ? AZ : '#fff', color: cVista === 'depositos' ? '#fff' : '#374151', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Depósitos (neto a cuenta)</button>
            <button onClick={() => setCVista('banco')} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid ' + (cVista === 'banco' ? AZ : '#d1d5db'), background: cVista === 'banco' ? AZ : '#fff', color: cVista === 'banco' ? '#fff' : '#374151', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Conciliar banco</button>
          </div>
        )}

        {concil && cVista === 'depositos' && (
          <div>
            <div style={{ fontSize: 12, color: GR, margin: '8px 0 12px' }}>Neto depositado = importe pagado − comisión Interfast, agrupado por <b>fecha de acreditación al consorcio</b>. Es lo que cae en la cuenta bancaria de cada consorcio; concilia contra el extracto.</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '0 0 14px' }}>
              {card('Bruto cobrado', concil.totales?.rendido_cant || 0, concil.totales?.bruto_total || 0, '#111')}
              {card('Comisión Interfast', (concil.totales?.bruto_total ? ((concil.totales.comision_total / concil.totales.bruto_total) * 100).toFixed(2) + '%' : '—'), concil.totales?.comision_total || 0, RJ)}
              {card('Neto depositado', '', concil.totales?.neto_total || 0, VD)}
            </div>
            <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: 6, textAlign: 'left' }}>Fecha acred.</th>
                  {cTodos && <th style={{ padding: 6, textAlign: 'left' }}>Consorcio</th>}
                  <th style={{ padding: 6, textAlign: 'center' }}>Pagos</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Bruto</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Comisión</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Neto depositado</th>
                </tr></thead>
                <tbody>{depositos.length ? depositos.map((d, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: 6 }}>{d.fecha}</td>
                    {cTodos && <td style={{ padding: 6 }}>{d.consorcio}</td>}
                    <td style={{ padding: 6, textAlign: 'center' }}>{d.cant}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(d.bruto)}</td>
                    <td style={{ padding: 6, textAlign: 'right', color: '#991b1b' }}>{fmtN(d.comision)}</td>
                    <td style={{ padding: 6, textAlign: 'right', color: '#166534', fontWeight: 600 }}>{fmtN(d.neto)}</td>
                  </tr>
                )) : <tr><td colSpan={cTodos ? 6 : 5} style={{ padding: 10, textAlign: 'center', color: GR }}>Sin depósitos en el rango.</td></tr>}</tbody>
              </table>
            </div>
          </div>
        )}

        {concil && cVista === 'banco' && (() => {
          const banco = computeBanco()
          const difTot = Math.round((banco.real - banco.esp) * 100) / 100
          return (
            <div>
              <div style={{ fontSize: 12, color: GR, margin: '8px 0 12px' }}>Cruza el <b>neto que Interfast informa</b> (por día de acreditación) contra los <b>créditos de RAPIFAST</b> (CUIT Interfast) en el extracto de la cuenta de cada consorcio. Subí el/los extractos que bajás del banco. No se imputa nada; es control de tesorería.</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
                <div><label style={lbl}>CUIT Interfast</label><input style={{ ...inp, width: 150 }} value={cCuit} onChange={e => setCCuit(e.target.value)} /></div>
                <label style={{ ...btn(AZ, busy === 'banco'), display: 'inline-block' }}>{busy === 'banco' ? 'Leyendo…' : 'Subir extractos'}
                  <input type="file" accept=".xls,.xlsx" multiple style={{ display: 'none' }} disabled={B} onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
                </label>
                {cArchivos.length > 0 && <button style={btn(GR, false)} disabled={B} onClick={() => setCArchivos([])}>Limpiar</button>}
                {banco.filas.length > 0 && <button style={btn(GR, false)} disabled={B} onClick={exportCSV}>Exportar CSV</button>}
              </div>

              {cArchivos.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, padding: '6px 8px', border: '1px solid #eef2f7', borderRadius: 8, marginBottom: 6 }}>
                  <span>📄 {a.nombre}</span>
                  <span style={{ color: GR }}>· {a.banco} · {a.lineas.length} líneas IF · {fmtN(a.total)}</span>
                  {a.single && (
                    <select style={{ ...inp, width: 'auto', padding: '4px 8px' }} value={a.consorcio_id || ''} onChange={e => setCArchivos(prev => prev.map((x, j) => j === i ? { ...x, consorcio_id: e.target.value } : x))}>
                      <option value="">— Asignar consorcio —</option>
                      {(concil?.consorcios || []).map(c => <option key={c.consorcio_id} value={c.consorcio_id}>{c.nombre}</option>)}
                    </select>
                  )}
                  <button style={{ ...btn(RJ, false), padding: '4px 8px' }} onClick={() => setCArchivos(prev => prev.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}

              {cArchivos.length > 0 && (
                <div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0' }}>
                    {card('Neto esperado (IF)', banco.filas.filter(f => f.esp > 0).length, banco.esp, '#111')}
                    {card('Real en banco', '', banco.real, VD)}
                    {card('Diferencia', '', difTot, Math.abs(difTot) > 0.02 ? RJ : VD)}
                    {card('Días conciliados', banco.ok, 0, VD)}
                  </div>
                  {banco.sinRuteo > 0 && <div style={{ fontSize: 12, color: '#9a3412', marginBottom: 8 }}>⚠ {banco.sinRuteo} línea(s) de Interfast sin poder rutear a un consorcio (asigná el consorcio del archivo, o revisá la cuenta).</div>}
                  <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ background: '#f8fafc' }}>
                        <th style={{ padding: 6, textAlign: 'left' }}>Fecha acred.</th>
                        <th style={{ padding: 6, textAlign: 'left' }}>Consorcio</th>
                        <th style={{ padding: 6, textAlign: 'right' }}>Neto esperado</th>
                        <th style={{ padding: 6, textAlign: 'right' }}>Real banco</th>
                        <th style={{ padding: 6, textAlign: 'right' }}>Diferencia</th>
                        <th style={{ padding: 6, textAlign: 'left' }}>Estado</th>
                      </tr></thead>
                      <tbody>{banco.filas.length ? banco.filas.map((f, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #f1f5f9', background: f.est === 'conciliado' ? '#fff' : '#fffbeb' }}>
                          <td style={{ padding: 6 }}>{f.fecha}</td>
                          <td style={{ padding: 6 }}>{f.nombre}</td>
                          <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(f.esp)}</td>
                          <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(f.real)}</td>
                          <td style={{ padding: 6, textAlign: 'right', color: Math.abs(f.dif) > 0.02 ? '#991b1b' : '#166534', fontWeight: 600 }}>{fmtN(f.dif)}</td>
                          <td style={{ padding: 6 }}>{estBadge(f.est)}</td>
                        </tr>
                      )) : <tr><td colSpan={6} style={{ padding: 10, textAlign: 'center', color: GR }}>Cargá un extracto para ver el cruce.</td></tr>}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {concil && cVista === 'pagos' && (
          <div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '14px 0' }}>
              {card('Rendido IF', concil.totales?.rendido_cant || 0, concil.totales?.rendido_total || 0, '#111')}
              {card('Conciliado', concil.totales?.conciliado_cant || 0, concil.totales?.conciliado_total || 0, VD)}
              {card('No imputado', concil.totales?.no_imputado_cant || 0, concil.totales?.no_imputado_total || 0, RJ)}
              {card('Sin match UF', concil.totales?.sin_match_cant || 0, concil.totales?.sin_match_total || 0, AM)}
              {card('Huérfanos GASP', concil.totales?.sin_rendicion_cant || 0, concil.totales?.sin_rendicion_total || 0, AM)}
            </div>

            {/* Resumen por consorcio */}
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #eee', borderRadius: 8, marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: 6, textAlign: 'left' }}>Consorcio</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>Rend.</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>$ Rendido</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>Concil.</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>No imp.</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>Sin UF</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>Huérf.</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Diferencia</th>
                  <th style={{ padding: 6, textAlign: 'center' }}></th>
                </tr></thead>
                <tbody>{consConMov.length ? consConMov.map(c => {
                  const alerta = (c.no_imputado_cant + c.sin_match_cant + c.sin_rendicion_cant) > 0 || c.error
                  return (
                    <tr key={c.consorcio_id} style={{ borderTop: '1px solid #f1f5f9', background: c.error ? '#fef2f2' : alerta ? '#fffbeb' : '#fff' }}>
                      <td style={{ padding: 6 }}>{c.nombre}{c.error ? <span style={{ color: '#991b1b' }}> — {c.error}</span> : ''}</td>
                      <td style={{ padding: 6, textAlign: 'center' }}>{c.rendido_cant}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(c.rendido_total)}</td>
                      <td style={{ padding: 6, textAlign: 'center', color: '#166534' }}>{c.conciliado_cant}</td>
                      <td style={{ padding: 6, textAlign: 'center', color: c.no_imputado_cant ? '#991b1b' : '#94a3b8', fontWeight: c.no_imputado_cant ? 700 : 400 }}>{c.no_imputado_cant}</td>
                      <td style={{ padding: 6, textAlign: 'center', color: c.sin_match_cant ? '#9a3412' : '#94a3b8' }}>{c.sin_match_cant}</td>
                      <td style={{ padding: 6, textAlign: 'center', color: c.sin_rendicion_cant ? '#854d0e' : '#94a3b8' }}>{c.sin_rendicion_cant}</td>
                      <td style={{ padding: 6, textAlign: 'right', color: Math.abs(c.diferencia) > 0.009 ? '#991b1b' : '#166534', fontWeight: 600 }}>{fmtN(c.diferencia)}</td>
                      <td style={{ padding: 6, textAlign: 'center' }}>{c.no_imputado_cant > 0 && puedeCobrar ? <button style={btn(VD, busy === 'imp-' + c.consorcio_id)} disabled={B} onClick={() => imputarFaltantes(c)}>Imputar</button> : ''}</td>
                    </tr>
                  )
                }) : <tr><td colSpan={9} style={{ padding: 10, textAlign: 'center', color: GR }}>Sin movimientos de Interfast en el rango.</td></tr>}</tbody>
              </table>
            </div>

            {/* Detalle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Detalle ({detalleVis.length})</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: GR }}>
                <input type="checkbox" checked={cSoloProb} onChange={e => setCSoloProb(e.target.checked)} /> Solo con diferencias
              </label>
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: 6, textAlign: 'left' }}>Fecha</th>
                  {cTodos && <th style={{ padding: 6, textAlign: 'left' }}>Consorcio</th>}
                  <th style={{ padding: 6, textAlign: 'left' }}>UF</th>
                  <th style={{ padding: 6, textAlign: 'left' }}>Canal</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Monto</th>
                  <th style={{ padding: 6, textAlign: 'left' }}>Estado</th>
                </tr></thead>
                <tbody>{detalleVis.length ? detalleVis.map((d, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: 6 }}>{d.fecha}</td>
                    {cTodos && <td style={{ padding: 6 }}>{d.consorcio}</td>}
                    <td style={{ padding: 6 }}>{d.uf_label}</td>
                    <td style={{ padding: 6, color: GR }}>{d.canal || '—'}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(d.monto)}</td>
                    <td style={{ padding: 6 }}>{estBadge(d.estado)}</td>
                  </tr>
                )) : <tr><td colSpan={cTodos ? 6 : 5} style={{ padding: 10, textAlign: 'center', color: GR }}>Nada para mostrar.</td></tr>}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
