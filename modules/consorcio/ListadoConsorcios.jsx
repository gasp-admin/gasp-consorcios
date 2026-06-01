// modules — ListadoConsorcios.jsx
// Extraído del V59. Props → useApp().

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function ListadoConsorcios() {
  const { session, consorcioActivo, consorcios } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [busqueda, setBusqueda] = useState('')

  const filtrados = (consorcios||[]).filter(c => {
    const q = busqueda.toLowerCase()
    return !q || c.nombre?.toLowerCase().includes(q) || c.cuit?.toLowerCase().includes(q)
      || c.direccion?.toLowerCase().includes(q) || c.localidad?.toLowerCase().includes(q)
      || c.banco?.toLowerCase().includes(q) || c.clave_suterh?.toLowerCase().includes(q)
  })

  function handlePDF() {
    // PDF en landscape para tener más espacio horizontal
    const fmtN = n => (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2 })
    const logo = null ? `<img src="${null}" style="height:44px;width:auto;object-fit:contain"/>` : ''

    const filasHTML = filtrados.map((c,i) => {
      const bg = i%2===0 ? '#fff' : '#f4f8fc'
      const dir = [c.direccion, c.localidad].filter(Boolean).join(' — ') || '—'
      return `<tr style="background:${bg};border-bottom:1px solid #e0e8f0">
        <td style="padding:3px 6px;font-size:7.5pt;font-weight:600;color:#1A3FA0">${(c.nombre||'').replace(/</g,'&lt;')}</td>
        <td style="padding:3px 6px;font-size:7pt;white-space:nowrap">${(c.cuit||'—').replace(/</g,'&lt;')}</td>
        <td style="padding:3px 6px;font-size:7pt">${dir.replace(/</g,'&lt;')}</td>
        <td style="padding:3px 6px;font-size:7pt">${(c.banco||'—').replace(/</g,'&lt;')}</td>
        <td style="padding:3px 6px;font-size:6.5pt;font-family:monospace">${(c.cbu||'—')}</td>
        <td style="padding:3px 6px;font-size:7pt;color:#1A3FA0">${(c.alias_cbu||'—').replace(/</g,'&lt;')}</td>
        <td style="padding:3px 6px;font-size:7pt;text-align:center">${(c.nro_cuenta||'—').replace(/</g,'&lt;')}</td>
        <td style="padding:3px 6px;font-size:7pt;text-align:center">${c.clave_suterh||'—'}</td>
        <td style="padding:3px 6px;font-size:7pt;text-align:center;color:${parseFloat(c.interes_mora||0)>0?'#92400e':'#6b7280'};font-weight:${parseFloat(c.interes_mora||0)>0?700:400}">${c.interes_mora ? c.interes_mora+'%' : '—'}</td>
      </tr>`
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
      <tr>
        <th style="min-width:120px">Nombre</th>
        <th style="width:105px">CUIT</th>
        <th style="min-width:100px">Dirección / Localidad</th>
        <th style="width:80px">Banco</th>
        <th style="width:155px">CBU</th>
        <th style="width:90px">Alias</th>
        <th style="width:70px">N° Cuenta</th>
        <th style="width:70px;text-align:center">SUTERH</th>
        <th style="width:52px;text-align:center">Mora %</th>
      </tr>
    </thead>
    <tbody>${filasHTML}</tbody>
    <tfoot>
      <tr style="background:#0d2b3e;color:#fff;font-weight:700">
        <td colspan="9" style="padding:4px 6px;font-size:8pt">
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
      columnas: [
        { key:'nombre',   label:'Nombre' },
        { key:'cuit',     label:'CUIT' },
        { key:'direccion',label:'Dirección' },
        { key:'localidad',label:'Localidad' },
        { key:'banco',    label:'Banco' },
        { key:'cbu',      label:'CBU' },
        { key:'alias',    label:'Alias CBU' },
        { key:'nro_cta',  label:'N° Cuenta' },
        { key:'suterh',   label:'Clave SUTERH' },
        { key:'mora',     label:'Interés Mora %' },
      ],
      filas: filtrados.map(c => ({
        nombre: c.nombre||'', cuit: c.cuit||'',
        direccion: c.direccion||'', localidad: c.localidad||'',
        banco: c.banco||'', cbu: c.cbu||'', alias: c.alias_cbu||'',
        nro_cta: c.nro_cuenta||'', suterh: c.clave_suterh||'',
        mora: c.interes_mora||'',
      }))
    })
  }

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>🏛️ Mis Consorcios</div>
      <div style={{ fontSize:12, color:GR, marginBottom:12 }}>
        {consorcios.length} consorcio{consorcios.length!==1?'s':''} administrado{consorcios.length!==1?'s':''}
      </div>

      <BarraListado
        busqueda={busqueda} onBuscar={setBusqueda}
        onPDF={handlePDF} onExcel={handleExcel}
        placeholder="Buscar por nombre, CUIT, dirección, banco, SUTERH..." />

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
                {['Nombre','CUIT','Dirección','Banco','CBU','Alias','N° Cuenta','SUTERH','Mora%'].map((h,i) => (
                  <th key={i} style={{ padding:'8px 10px', textAlign:'left', fontSize:11,
                    fontWeight:700, color:'#fff', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c,i) => (
                <tr key={c.id} style={{ borderBottom:'1px solid #e5e7eb', background: i%2===0?'#fff':'#f4f8fc' }}>
                  <td style={{ padding:'9px 10px', fontWeight:700, color:AZ }}>{c.nombre}</td>
                  <td style={{ padding:'9px 10px', fontSize:11, color:GR, whiteSpace:'nowrap' }}>{c.cuit||'—'}</td>
                  <td style={{ padding:'9px 10px', fontSize:11 }}>
                    {c.direccion && <div>{c.direccion}</div>}
                    {c.localidad && <div style={{ color:GR, fontSize:10 }}>{c.localidad}</div>}
                    {!c.direccion && !c.localidad && '—'}
                  </td>
                  <td style={{ padding:'9px 10px', fontSize:11 }}>{c.banco||'—'}</td>
                  <td style={{ padding:'9px 10px', fontSize:10, fontFamily:'monospace' }}>{c.cbu||'—'}</td>
                  <td style={{ padding:'9px 10px', fontSize:11, color:AZ }}>{c.alias_cbu||'—'}</td>
                  <td style={{ padding:'9px 10px', fontSize:11 }}>{c.nro_cuenta||'—'}</td>
                  <td style={{ padding:'9px 10px', fontSize:11, fontWeight:c.clave_suterh?600:400 }}>
                    {c.clave_suterh||'—'}
                  </td>
                  <td style={{ padding:'9px 10px', fontSize:12, textAlign:'right',
                    fontWeight: parseFloat(c.interes_mora||0) > 0 ? 700 : 400,
                    color: parseFloat(c.interes_mora||0) > 0 ? AM : GR }}>
                    {c.interes_mora ? c.interes_mora + '%' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background:'#f0f4ff', borderTop:'2px solid '+AZ }}>
                <td colSpan={9} style={{ padding:'8px 10px', fontWeight:700, color:AZ, fontSize:12 }}>
                  Total: {filtrados.length} consorcio{filtrados.length!==1?'s':''} administrado{filtrados.length!==1?'s':''}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
