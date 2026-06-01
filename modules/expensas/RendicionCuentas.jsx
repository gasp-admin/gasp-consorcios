import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function RendicionCuentas() {
  const { session, consorcioActivo, expensas, copropietarios, unidades } = useApp()
  const uid = session?.user?.id session, consorcioId, consorcioActivo, expensas, copropietarios, unidades }
  const [rendiciones, setRendiciones] = useState([])
  const [tab, setTab]                 = useState('generar')
  const [expSel, setExpSel]           = useState('')
  const [notas, setNotas]             = useState('')
  const [generando, setGenerando]     = useState(false)
  const [htmlVista, setHtmlVista]     = useState('')
  const [msg, setMsg]                 = useState(null)

  const periodoLabel = p => {
    if (!p) return '—'
    const [y,m] = p.split('-')
    const ms=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    return m ? `${ms[parseInt(m)-1]} ${y}` : p
  }
  const fmt = n => '$' + (Number(n)||0).toLocaleString('es-AR',{minimumFractionDigits:2})

  async function cargar() {
    const { data } = await supabase.from('con_rendicion_cuentas').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .order('periodo', { ascending:false }).limit(24)
    setRendiciones(data || [])
  }
  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  async function generar() {
    if (!expSel) return setMsg({ tipo:'warn', texto:'Seleccioná el período' })
    setGenerando(true); setMsg(null)
    const expObj = expensas.find(e=>e.id===expSel)

    // Cargar datos reales desde BD
    const [{ data: gastos }, { data: cobranzas }, { data: sueldos }] = await Promise.all([
      supabase.from('con_gastos').select('*').eq('consorcio_id', consorcioId).eq('expensa_id', expSel).eq('admin_id', session.user.id),
      supabase.from('con_cobranzas').select('*').eq('consorcio_id', consorcioId).eq('expensa_id', expSel).eq('admin_id', session.user.id).in('estado',['acreditado','cobrado']),
      supabase.from('con_sueldos').select('*').eq('consorcio_id', consorcioId).eq('expensa_id', expSel).eq('admin_id', session.user.id),
    ])

    const totalIngresos  = (cobranzas||[]).reduce((a,c)=>a+(Number(c.monto)||0),0)
    const totalGastos    = (gastos||[]).filter(g=>!['sueldos','fateryh','vep_931'].includes(g.categoria)).reduce((a,g)=>a+(Number(g.monto)||0),0)
    const totalSueldos   = (sueldos||[]).reduce((a,s)=>a+(Number(s.sueldo_neto)||0),0)
    const totalFateryh   = (gastos||[]).filter(g=>g.categoria==='fateryh').reduce((a,g)=>a+(Number(g.monto)||0),0)
    const totalVep       = (gastos||[]).filter(g=>g.categoria==='vep_931').reduce((a,g)=>a+(Number(g.monto)||0),0)
    const totalEgresos   = totalGastos + totalSueldos + totalFateryh + totalVep
    const saldoFinal     = totalIngresos - totalEgresos
    const totalExpensa   = expObj?.total_expensa || 0
    const totalDeudores  = totalExpensa - totalIngresos

    // Agrupar gastos por categoría
    const gastosPorCat = {}
    ;(gastos||[]).forEach(g => {
      const cat = g.categoria || 'otros'
      gastosPorCat[cat] = (gastosPorCat[cat]||0) + Number(g.monto||0)
    })

    const hoy = new Date()
    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;color:#111;margin:0;padding:0;background:#f0f4ff}
  .wrap{max-width:760px;margin:20px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px #0002}
  .hdr{background:linear-gradient(135deg,#1A3FA0,#2563eb);padding:28px 32px;color:#fff}
  .hdr h1{margin:0 0 6px;font-size:22px;font-weight:800}
  .hdr p{margin:0;font-size:13px;opacity:.8}
  .sec{padding:20px 32px;border-bottom:1px solid #f1f5f9}
  .sec h2{font-size:14px;font-weight:700;color:#1A3FA0;margin:0 0 14px;text-transform:uppercase;letter-spacing:.5px}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .kpi{background:#f8fafc;border-radius:10px;padding:14px;text-align:center}
  .kpi .v{font-size:22px;font-weight:800;color:#1A3FA0}
  .kpi .l{font-size:11px;color:#6b7280;margin-top:4px}
  .kpi.verde .v{color:#16a34a}
  .kpi.rojo .v{color:#dc2626}
  .kpi.naranja .v{color:#d97706}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{padding:8px 12px;text-align:left;background:#f8fafc;color:#374151;font-weight:600;border-bottom:1px solid #e5e7eb}
  td{padding:8px 12px;border-bottom:1px solid #f9fafb}
  .txt-right{text-align:right}
  .bold{font-weight:700}
  .muted{color:#6b7280}
  .total-row td{background:#f0f4ff;font-weight:700;color:#1A3FA0}
  .footer{background:#f8fafc;padding:20px 32px;font-size:11px;color:#9ca3af;text-align:center}
</style></head><body>
<div class="wrap">
  <div class="hdr">
    <h1>Rendición de Cuentas — ${periodoLabel(expObj?.periodo||'')}</h1>
    <p>${consorcioActivo?.nombre||''} · Emitida el ${hoy.toLocaleDateString('es-AR')}</p>
  </div>

  <div class="sec">
    <h2>Resumen financiero del período</h2>
    <div class="kpis">
      <div class="kpi verde"><div class="v">${fmt(totalIngresos)}</div><div class="l">Total cobrado</div></div>
      <div class="kpi rojo"><div class="v">${fmt(totalEgresos)}</div><div class="l">Total egresos</div></div>
      <div class="kpi ${saldoFinal>=0?'verde':'rojo'}"><div class="v">${fmt(saldoFinal)}</div><div class="l">Resultado neto</div></div>
      <div class="kpi"><div class="v">${cobranzas?.length||0}</div><div class="l">Pagos recibidos</div></div>
      <div class="kpi naranja"><div class="v">${fmt(totalDeudores)}</div><div class="l">Pendiente de cobro</div></div>
      <div class="kpi"><div class="v">${fmt(totalExpensa)}</div><div class="l">Total liquidado</div></div>
    </div>
  </div>

  <div class="sec">
    <h2>Detalle de ingresos</h2>
    <table>
      <thead><tr><th>Concepto</th><th class="txt-right">Importe</th></tr></thead>
      <tbody>
        <tr><td>Cobranzas del período (${cobranzas?.length||0} pagos)</td><td class="txt-right">${fmt(totalIngresos)}</td></tr>
        ${totalDeudores > 0 ? `<tr><td class="muted">Expensas pendientes de cobro</td><td class="txt-right muted">(${fmt(totalDeudores)})</td></tr>` : ''}
      </tbody>
      <tfoot><tr class="total-row"><td>Total ingresos</td><td class="txt-right">${fmt(totalIngresos)}</td></tr></tfoot>
    </table>
  </div>

  <div class="sec">
    <h2>Detalle de egresos</h2>
    <table>
      <thead><tr><th>Categoría</th><th class="txt-right">Importe</th></tr></thead>
      <tbody>
        ${Object.entries(gastosPorCat).map(([cat,monto]) =>
          `<tr><td style="text-transform:capitalize">${cat}</td><td class="txt-right">${fmt(Number(monto))}</td></tr>`
        ).join('')}
        ${totalSueldos > 0 ? `<tr><td>Sueldos netos</td><td class="txt-right">${fmt(totalSueldos)}</td></tr>` : ''}
        ${totalFateryh > 0 ? `<tr><td>F.A.T.E.R.Y.H.</td><td class="txt-right">${fmt(totalFateryh)}</td></tr>` : ''}
        ${totalVep > 0     ? `<tr><td>VEP F.931 — Cargas sociales</td><td class="txt-right">${fmt(totalVep)}</td></tr>` : ''}
      </tbody>
      <tfoot><tr class="total-row"><td>Total egresos</td><td class="txt-right">${fmt(totalEgresos)}</td></tr></tfoot>
    </table>
  </div>

  ${notas ? `<div class="sec"><h2>Notas del administrador</h2><p style="font-size:13px;line-height:1.7">${notas}</p></div>` : ''}

  <div class="footer">
    ${consorcioActivo?.nombre||''} · Administrador: Javier García Pérez · RPAC N° 83 · Pinamar, Buenos Aires<br>
    Documento generado automáticamente por GASP Consorcios · ${new Date().toLocaleString('es-AR')}
  </div>
</div></body></html>`

    // Guardar en BD
    const rendId = `REND-${consorcioId}-${Date.now()}`
    await supabase.from('con_rendicion_cuentas').insert([{
      id: rendId, admin_id: session.user.id, consorcio_id: consorcioId,
      expensa_id: expSel, periodo: expObj?.periodo||'',
      total_ingresos: totalIngresos, total_egresos: totalEgresos, saldo_final: saldoFinal,
      total_expensas_cobradas: totalIngresos, total_gastos_pagados: totalGastos,
      total_sueldos: totalSueldos + totalFateryh + totalVep,
      html_generado: html, notas, estado: 'borrador'
    }])

    setHtmlVista(html)
    setMsg({ tipo:'ok', texto:'✓ Rendición generada — Revisá y enviá por email' })
    cargar(); setGenerando(false)
  }

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>📊 Rendición de cuentas</div>
      <div style={{ fontSize:12, color:GR, marginBottom:20 }}>Informe mensual automático de ingresos y egresos del consorcio</div>
      <Msg data={msg} />
      <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:'2px solid #e5e7eb' }}>
        {[{id:'generar',l:'📝 Generar'},{id:'historial',l:'📋 Historial'}].map(t=>(
          <button key={t.id} type="button" onClick={()=>{setTab(t.id);if(t.id==='historial')cargar()}}
            style={{ padding:'8px 18px', border:'none', borderBottom:tab===t.id?`2px solid ${AZ}`:'2px solid transparent',
              background:'transparent', color:tab===t.id?AZ:GR, fontWeight:tab===t.id?700:400, fontSize:13, cursor:'pointer', marginBottom:-2 }}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === 'generar' && (
        <div>
          <Card style={{ marginBottom:14 }}>
            <Sel label="Período a rendir" value={expSel} onChange={setExpSel}
              opts={[{v:'',l:'— Seleccioná el período —'},
                ...expensas.map(e=>({v:e.id,l:`${periodoLabel(e.periodo)} ${e.estado==='cerrada'?'🔒':'✓'} ${e.tipo||''}`}))
              ]} />
          </Card>
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Notas del administrador (opcional)</div>
            <textarea value={notas} onChange={e=>setNotas(e.target.value)} rows={4}
              placeholder="Obras realizadas, novedades del período, próximos vencimientos..."
              style={{ width:'100%', padding:'10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
          </Card>
          <Btn onClick={generar} disabled={generando||!expSel} style={{ opacity:generando||!expSel?0.5:1, width:'100%', padding:'12px', fontSize:14, marginBottom:16 }}>
            {generando ? '⏳ Generando...' : '📊 Generar rendición de cuentas'}
          </Btn>
          {htmlVista && (
            <Card style={{ padding:0, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', background:'#f8fafc', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontWeight:600, color:AZ }}>Vista previa</span>
              </div>
              <iframe srcDoc={htmlVista} style={{ width:'100%', height:600, border:'none' }} sandbox="allow-same-origin" />
            </Card>
          )}
        </div>
      )}

      {tab === 'historial' && (
        <Card>
          {rendiciones.length === 0 ? (
            <div style={{ textAlign:'center', padding:'24px 0', color:GR }}>Sin rendiciones generadas</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f8fafc' }}>
                  {['Período','Ingresos','Egresos','Resultado','Estado'].map((h,i)=>(
                    <th key={i} style={{ padding:'8px 12px', textAlign:i>0&&i<4?'right':'left', fontWeight:600, color:'#374151' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rendiciones.map(r=>(
                  <tr key={r.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'8px 12px', fontWeight:600 }}>{periodoLabel(r.periodo)}</td>
                    <td style={{ padding:'8px 12px', textAlign:'right', color:VD }}>{fmt(r.total_ingresos)}</td>
                    <td style={{ padding:'8px 12px', textAlign:'right', color:RJ }}>{fmt(r.total_egresos)}</td>
                    <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:700, color: Number(r.saldo_final)>=0?VD:RJ }}>{fmt(r.saldo_final)}</td>
                    <td style={{ padding:'8px 12px' }}>
                      <Badge text={r.estado} color={r.estado==='enviada'?VD:r.estado==='aprobada'?AZ:GR} bg={r.estado==='enviada'?'#dcfce7':r.estado==='aprobada'?'#eff6ff':'#f3f4f6'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  )
}
