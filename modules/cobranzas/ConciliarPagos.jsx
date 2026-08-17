import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, GR, BG, VD } from '../../lib/config'

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
      const { data: lote, error: eLote } = await supabase.from('con_cobranza_lote').insert({
        admin_id: uid, consorcio_id: consorcioActivo.id, sistema: banco,
        archivo_nombre: archivo?.name || null, fecha_archivo: new Date().toISOString().slice(0, 10),
        estado: 'importado', total_registros: lineas.length,
        registros_pendientes: lineas.length, total_importe: totalImporte, importe_pendiente: totalImporte,
      }).select('id').single()
      if (eLote) throw eLote

      const filas = lineas.map((l) => ({
        admin_id: uid, lote_id: lote.id, consorcio_id: consorcioActivo.id,
        fecha_pago: l.fecha, importe: l.importe,
        concepto_original: l.concepto, cuit_pagador: l.cuit, nombre_pagador: l.nombre,
        referencia_bancaria: l.referencia, estado: 'pendiente',
      }))
      const { error: eLin } = await supabase.from('con_cobranza_lote_linea').insert(filas)
      if (eLin) throw eLin

      setMsg({ t:'ok', m:`✓ Importadas ${lineas.length} líneas al lote. Próximo paso: conciliar (imputar a cada UF).` })
      setLineas([]); setArchivo(null); setBanco('')
    } catch (err) {
      setMsg({ t:'e', m:'No se pudo importar: ' + err.message })
    }
    setImportando(false)
  }

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
    </div>
  )
}
