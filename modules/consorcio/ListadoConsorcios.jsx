// modules — ListadoConsorcios.jsx
// Extraído del V59. Props → useApp().
// 2026-09-05: selector de columnas configurable (pantalla + PDF + Excel).
//   - Catálogo único COLS → una sola fuente de verdad para los 3 renders.
//   - Selección persistida en localStorage (módulo ssr:false).
//   - "Nombre" es columna ancla (no desmarcable).
//   - Cero cambios en BarraListado / exportExcel / exportPdf / BD.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { setArchivadoConsorcio } from '../../api/index'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

// ── Formateo de fecha ISO (yyyy-mm-dd) → dd/mm/yyyy sin desfase de timezone ──
function fFecha(v) {
  if (!v) return ''
  const s = String(v).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return s
}

// ── Catálogo único de columnas ──────────────────────────────────────────────
// val(c) → texto plano (usado por Excel y como base de PDF/pantalla).
// Flags de estilo: strong (nombre), mono (CBU), azul (alias), mora (color condicional).
// align: 'left' (def) | 'center' | 'right'. nowrap: no cortar.
const COLS = [
  { key:'nombre',          label:'Nombre',        val:c=>c.nombre||'',                              ancla:true, strong:true },
  { key:'cuit',            label:'CUIT',          val:c=>c.cuit||'—',                               nowrap:true },
  { key:'direccion',       label:'Dirección',     val:c=>c.direccion||'—' },
  { key:'localidad',       label:'Localidad',     val:c=>c.localidad||'—' },
  { key:'provincia',       label:'Provincia',     val:c=>c.provincia||'—' },
  { key:'banco',           label:'Banco',         val:c=>c.banco||'—' },
  { key:'cbu',             label:'CBU',           val:c=>c.cbu||'—',                                mono:true },
  { key:'alias_cbu',       label:'Alias CBU',     val:c=>c.alias_cbu||'—',                          azul:true },
  { key:'nro_cuenta',      label:'N° Cuenta',     val:c=>c.nro_cuenta||'—',                         align:'center' },
  { key:'clave_suterh',    label:'SUTERH',        val:c=>c.clave_suterh||'—',                       align:'center' },
  { key:'interes_mora',    label:'Mora %',        val:c=>c.interes_mora?c.interes_mora+'%':'—',     align:'right', mora:true },
  { key:'email_consorcio', label:'Email',         val:c=>c.email_consorcio||'—' },
  { key:'telefono',        label:'Teléfono',      val:c=>c.telefono||'—',                           nowrap:true },
  { key:'aseguradora',     label:'Aseguradora',   val:c=>c.aseguradora||'—' },
  { key:'poliza_nro',      label:'Póliza N°',     val:c=>c.poliza_nro||'—',                         align:'center' },
  { key:'poliza_vto_hasta',label:'Vto. Póliza',   val:c=>fFecha(c.poliza_vto_hasta)||'—',           align:'center' },
  { key:'matricula_rpi',   label:'Matrícula RPI', val:c=>c.matricula_rpi||'—',                      align:'center' },
]

// Columnas mostradas por defecto (las mismas que traía el listado original).
const DEFAULT_KEYS = ['nombre','cuit','direccion','localidad','banco','cbu','alias_cbu','nro_cuenta','clave_suterh','interes_mora']
const LS_KEY = 'gasp_cols_consorcios'

function cargarPref() {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage.getItem(LS_KEY)
    if (!raw) return null
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || !arr.length) return null
    // filtrar contra el catálogo actual (por si cambió) y garantizar el ancla
    const validas = arr.filter(k => COLS.some(c => c.key === k))
    return validas.includes('nombre') ? validas : ['nombre', ...validas]
  } catch { return null }
}

export default function ListadoConsorcios() {
  const { session, consorcioActivo, consorcios, setConsorcios, cargando, setPagina } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [busqueda, setBusqueda] = useState('')
  const [colsKeys, setColsKeys] = useState(() => cargarPref() || DEFAULT_KEYS)
  const [panelCols, setPanelCols] = useState(false)
  const [verArchivados, setVerArchivados] = useState(false)
  const [procId, setProcId] = useState(null)   // id en proceso de archivar/reactivar
  const [msgArch, setMsgArch] = useState(null)

  // Persistir selección (módulo ssr:false → window disponible)
  useEffect(() => {
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(colsKeys)) } catch {}
  }, [colsKeys])

  // Columnas seleccionadas, respetando el orden del catálogo
  const colsSel = COLS.filter(c => colsKeys.includes(c.key))

  function toggleCol(key) {
    if (key === 'nombre') return // ancla: no se desmarca
    setColsKeys(prev => prev.includes(key)
      ? prev.filter(k => k !== key)
      : COLS.filter(c => prev.includes(c.key) || c.key === key).map(c => c.key))
  }
  const seleccionarTodas = () => setColsKeys(COLS.map(c => c.key))
  const seleccionarMin    = () => setColsKeys(DEFAULT_KEYS)

  const archivadosCount = (consorcios||[]).filter(c => c.archivado).length

  async function handleArchivar(c) {
    const archivar = !c.archivado
    const txt = archivar
      ? `¿Archivar "${c.nombre}"?\n\nQuedará oculto de los listados pero seguirá accesible desde el selector de consorcio para consultar cta cte, liquidaciones, pagos, etc.`
      : `¿Reactivar "${c.nombre}"? Volverá a aparecer en los listados como consorcio vigente.`
    if (!window.confirm(txt)) return
    setProcId(c.id); setMsgArch(null)
    try {
      await setArchivadoConsorcio(c.id, archivar)
      // Actualización en memoria (evita recarga completa)
      setConsorcios(prev => (prev||[]).map(x => x.id === c.id
        ? { ...x, archivado: archivar, archivado_at: archivar ? new Date().toISOString() : null }
        : x))
      setMsgArch({ tipo:'ok', txt: archivar ? `✓ "${c.nombre}" archivado` : `✓ "${c.nombre}" reactivado` })
    } catch (e) {
      setMsgArch({ tipo:'err', txt: 'Error al actualizar: ' + (e.message || e) })
    } finally {
      setProcId(null)
    }
  }

  const filtrados = (consorcios||[]).filter(c => {
    if (!verArchivados && c.archivado) return false        // ocultar archivados salvo toggle
    const q = busqueda.toLowerCase()
    return !q || c.nombre?.toLowerCase().includes(q) || c.cuit?.toLowerCase().includes(q)
      || c.direccion?.toLowerCase().includes(q) || c.localidad?.toLowerCase().includes(q)
      || c.banco?.toLowerCase().includes(q) || c.clave_suterh?.toLowerCase().includes(q)
  })

  // ── Estilo de celda de PDF según flags de la columna ──
  function pdfTd(col, c) {
    const raw = col.val(c)
    const txt = String(raw).replace(/</g, '&lt;')
    let style = `padding:3px 6px;font-size:7pt`
    if (col.strong) style = `padding:3px 6px;font-size:7.5pt;font-weight:600;color:#1A3FA0`
    else if (col.mono) style = `padding:3px 6px;font-size:6.5pt;font-family:monospace`
    else if (col.azul) style = `padding:3px 6px;font-size:7pt;color:#1A3FA0`
    if (col.nowrap) style += `;white-space:nowrap`
    if (col.align === 'center') style += `;text-align:center`
    if (col.align === 'right')  style += `;text-align:right`
    if (col.mora) {
      const v = parseFloat(c.interes_mora || 0)
      style += `;text-align:center;color:${v>0?'#92400e':'#6b7280'};font-weight:${v>0?700:400}`
    }
    return `<td style="${style}">${txt}</td>`
  }

  function handlePDF() {
    const logo = null ? `<img src="${null}" style="height:44px;width:auto;object-fit:contain"/>` : ''

    const thHTML = colsSel.map(col => {
      const al = col.align === 'center' ? ';text-align:center' : col.align === 'right' ? ';text-align:right' : ''
      const mw = col.key === 'nombre' ? 'min-width:120px' : col.key === 'cbu' ? 'width:150px' : ''
      return `<th style="${mw}${al}">${col.label}</th>`
    }).join('')

    const filasHTML = filtrados.map((c,i) => {
      const bg = i%2===0 ? '#fff' : '#f4f8fc'
      return `<tr style="background:${bg};border-bottom:1px solid #e0e8f0">${
        colsSel.map(col => pdfTd(col, c)).join('')
      }</tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Listado de Consorcios</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#111;background:#fff}
  .page{width:297mm;min-height:210mm;padding:9mm 11mm 8mm;position:relative}
  @page{size:A4 landscape;margin:0}
  @media print{body{margin:0}.no-print{display:none!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
  .hdr{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1A3FA0;padding-bottom:7px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse}
  th{background:#2e4057;color:#fff;padding:4px 6px;font-size:7.5pt;text-align:left;white-space:nowrap}
  .footer{position:absolute;bottom:6mm;left:11mm;right:11mm;display:flex;justify-content:space-between;border-top:1px solid #ccc;padding-top:3px;font-size:6pt;color:#888}
  .btn-imp{display:block;margin:12px auto;padding:9px 24px;background:#1A3FA0;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-family:Arial}
</style></head><body>
<button class="btn-imp no-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
<div class="page">
  <div class="hdr">
    ${logo}
    <div style="flex:1">
      <div style="font-size:14pt;font-weight:800;color:#1A3FA0">Listado de Consorcios</div>
      <div style="font-size:8.5pt;color:#374151">Generado: ${new Date().toLocaleDateString('es-AR')} — Administración de Consorcios Pinamar — R.P.A.C. N° 83</div>
    </div>
    <div style="font-size:22pt;font-weight:800;color:#1A3FA0">${filtrados.length}</div>
    <div style="font-size:8pt;color:#6b7280">consorcio${filtrados.length!==1?'s':''}</div>
  </div>

  <table>
    <thead>
      <tr>${thHTML}</tr>
    </thead>
    <tbody>${filasHTML}</tbody>
    <tfoot>
      <tr style="background:#0d2b3e;color:#fff;font-weight:700">
        <td colspan="${colsSel.length}" style="padding:4px 6px;font-size:8pt">
          Total: ${filtrados.length} consorcio${filtrados.length!==1?'s':''} administrado${filtrados.length!==1?'s':''}
        </td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    <span>Listado de Consorcios — Administración de Consorcios Pinamar</span>
    <span>R.P.A.C. N°83 | CUIT Administración: 20186006802</span>
    <span>${new Date().toLocaleDateString('es-AR')}</span>
  </div>
</div>
</body></html>`

    const blob = new Blob([html], { type:'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    window.open(url, '_blank', 'width=1050,height=750')
    setTimeout(()=>URL.revokeObjectURL(url), 60000)
  }

  function handleExcel() {
    exportarExcel({
      titulo: 'Consorcios',
      columnas: colsSel.map(col => ({ key: col.key, label: col.label })),
      filas: filtrados.map(c => {
        const o = {}
        colsSel.forEach(col => {
          const v = col.val(c)
          o[col.key] = v === '—' ? '' : v   // en Excel, vacío en vez de guión
        })
        return o
      })
    })
  }

  if (cargando) return <div style={{ padding:32, textAlign:'center', color:'#6b7280' }}>Cargando consorcios...</div>

  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>🏛️ Mis Consorcios</div>
          <div style={{ fontSize:12, color:GR }}>
            {consorcios.length} consorcio{consorcios.length!==1?'s':''} administrado{consorcios.length!==1?'s':''}
          </div>
        </div>
        <button onClick={() => setPagina('nuevo_consorcio')}
          style={{ padding:'8px 16px', fontSize:13, fontWeight:700, background:VD, color:'#fff',
            border:'none', borderRadius:8, cursor:'pointer', whiteSpace:'nowrap' }}>
          ➕ Nuevo consorcio
        </button>
      </div>

      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:200 }}>
          <BarraListado
            busqueda={busqueda} onBuscar={setBusqueda}
            onPDF={handlePDF} onExcel={handleExcel}
            placeholder="Buscar por nombre, CUIT, dirección, banco, SUTERH..." />
        </div>
        <button onClick={() => setPanelCols(v => !v)}
          style={{ padding:'8px 12px', fontSize:13, fontWeight:600, background: panelCols?AZ:'#fff',
            color: panelCols?'#fff':AZ, border:`1px solid ${AZ}`, borderRadius:7, cursor:'pointer',
            whiteSpace:'nowrap', marginBottom:12 }}>
          ⚙️ Columnas ({colsSel.length})
        </button>
        {archivadosCount > 0 && (
          <button onClick={() => setVerArchivados(v => !v)}
            title={verArchivados ? 'Ocultar los consorcios archivados' : 'Mostrar los consorcios archivados'}
            style={{ padding:'8px 12px', fontSize:13, fontWeight:600, background: verArchivados?AM:'#fff',
              color: verArchivados?'#fff':AM, border:`1px solid ${AM}`, borderRadius:7, cursor:'pointer',
              whiteSpace:'nowrap', marginBottom:12 }}>
            📦 Archivados ({archivadosCount})
          </button>
        )}
      </div>

      {msgArch && (
        <div style={{ marginBottom:12, padding:'8px 12px', borderRadius:7, fontSize:13,
          background: msgArch.tipo==='ok' ? '#ecfdf5' : '#fef2f2',
          color: msgArch.tipo==='ok' ? '#065f46' : '#991b1b',
          border: `1px solid ${msgArch.tipo==='ok' ? '#a7f3d0' : '#fecaca'}` }}>
          {msgArch.txt}
        </div>
      )}

      {panelCols && (
        <Card style={{ padding:14, marginBottom:12, background:'#f8fafc' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, flexWrap:'wrap', gap:8 }}>
            <div style={{ fontWeight:700, fontSize:13, color:AZ }}>Columnas a incluir (pantalla, PDF y Excel)</div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={seleccionarTodas}
                style={{ padding:'4px 10px', fontSize:12, background:'#fff', color:AZ, border:`1px solid ${AZ}`, borderRadius:6, cursor:'pointer' }}>
                Seleccionar todas
              </button>
              <button onClick={seleccionarMin}
                style={{ padding:'4px 10px', fontSize:12, background:'#fff', color:GR, border:'1px solid #d1d5db', borderRadius:6, cursor:'pointer' }}>
                Restablecer
              </button>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:'6px 14px' }}>
            {COLS.map(col => (
              <label key={col.key}
                style={{ display:'flex', alignItems:'center', gap:7, fontSize:13,
                  cursor: col.ancla?'default':'pointer', color: col.ancla?GR:'#111', userSelect:'none' }}>
                <input type="checkbox"
                  checked={colsKeys.includes(col.key)}
                  disabled={col.ancla}
                  onChange={() => toggleCol(col.key)}
                  style={{ cursor: col.ancla?'default':'pointer' }} />
                {col.label}{col.ancla && <span style={{ fontSize:10, color:GR }}>(fija)</span>}
              </label>
            ))}
          </div>
        </Card>
      )}

      {filtrados.length === 0 ? (
        <Card style={{ textAlign:'center', padding:32, color:GR }}>
          <div style={{ fontSize:28, marginBottom:8 }}>🏛️</div>
          <div>No hay consorcios que coincidan con la búsqueda.</div>
        </Card>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'#2e4057' }}>
                {colsSel.map(col => (
                  <th key={col.key} style={{ padding:'8px 10px', fontSize:11, fontWeight:700, color:'#fff',
                    whiteSpace:'nowrap',
                    textAlign: col.align==='right'?'right':col.align==='center'?'center':'left' }}>
                    {col.label}
                  </th>
                ))}
                <th style={{ padding:'8px 10px', fontSize:11, fontWeight:700, color:'#fff',
                  whiteSpace:'nowrap', textAlign:'center', width:110 }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c,i) => (
                <tr key={c.id} style={{ borderBottom:'1px solid #e5e7eb',
                  background: c.archivado ? '#fff7ed' : (i%2===0?'#fff':'#f4f8fc'),
                  opacity: c.archivado ? 0.72 : 1 }}>
                  {colsSel.map(col => {
                    const base = {
                      padding:'9px 10px', fontSize:11,
                      whiteSpace: col.nowrap?'nowrap':undefined,
                      textAlign: col.align==='right'?'right':col.align==='center'?'center':'left',
                    }
                    if (col.strong) return <td key={col.key} style={{ ...base, fontWeight:700, color:AZ, fontSize:12 }}>{c.nombre||'—'}</td>
                    if (col.mono)   return <td key={col.key} style={{ ...base, fontSize:10, fontFamily:'monospace' }}>{c.cbu||'—'}</td>
                    if (col.azul)   return <td key={col.key} style={{ ...base, color:AZ }}>{c.alias_cbu||'—'}</td>
                    if (col.mora) {
                      const v = parseFloat(c.interes_mora||0)
                      return <td key={col.key} style={{ ...base, fontSize:12, fontWeight:v>0?700:400, color:v>0?AM:GR }}>
                        {c.interes_mora ? c.interes_mora + '%' : '—'}
                      </td>
                    }
                    if (col.key === 'clave_suterh')
                      return <td key={col.key} style={{ ...base, fontWeight:c.clave_suterh?600:400 }}>{c.clave_suterh||'—'}</td>
                    return <td key={col.key} style={{ ...base, color: col.key==='cuit'?GR:undefined }}>{col.val(c)}</td>
                  })}
                  <td style={{ padding:'9px 10px', textAlign:'center', whiteSpace:'nowrap' }}>
                    {c.archivado && (
                      <span style={{ display:'inline-block', fontSize:9, fontWeight:800, color:'#fff',
                        background:AM, borderRadius:4, padding:'1px 5px', marginRight:6, verticalAlign:'middle' }}>
                        ARCHIVADO
                      </span>
                    )}
                    <button onClick={() => handleArchivar(c)} disabled={procId===c.id}
                      title={c.archivado ? 'Reactivar consorcio' : 'Archivar (ocultar de listados, conserva el acceso)'}
                      style={{ padding:'4px 9px', fontSize:11, fontWeight:600, cursor: procId===c.id?'default':'pointer',
                        borderRadius:6, border:`1px solid ${c.archivado?VD:'#d1d5db'}`,
                        background: c.archivado?'#fff':'#fff', color: c.archivado?VD:GR,
                        opacity: procId===c.id?0.5:1 }}>
                      {procId===c.id ? '…' : (c.archivado ? '♻️ Reactivar' : '📦 Archivar')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background:'#f0f4ff', borderTop:'2px solid '+AZ }}>
                <td colSpan={colsSel.length + 1} style={{ padding:'8px 10px', fontWeight:700, color:AZ, fontSize:12 }}>
                  Total: {filtrados.length} consorcio{filtrados.length!==1?'s':''}{verArchivados ? ' (incluye archivados)' : ' vigente'+(filtrados.length!==1?'s':'')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
