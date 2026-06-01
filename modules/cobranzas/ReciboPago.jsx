import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function ReciboPago() {
  const { session, unidades, copropietarios, expensas, consorcioActivo } = useApp()
  const uid = session?.user?.id session, consorcioId, unidades, copropietarios, expensas, consorcioActivo } session, consorcioId, unidades, copropietarios, expensas, consorcioActivo }
  const [cobranzas, setCobranzas] = useState([])
  const [filtroExp, setFiltroExp] = useState('')
  const [filtroUF, setFiltroUF]   = useState('')
  const [msg, setMsg]             = useState(null)

  async function cargar() {
    const q = supabase.from('con_cobranzas').select('*')
      .eq('consorcio_id', consorcioId).eq('estado','vigente')
      .order('fecha', { ascending:false }).limit(200)
    if (filtroExp) q.eq('expensa_id', filtroExp)
    if (filtroUF)  q.eq('unidad_id', filtroUF)
    const { data } = await q
    setCobranzas(data || [])
  }

  function generarReciboHTML(cob) {
    const uf   = unidades.find(u => u.id === cob.unidad_id)
    const cp   = copropietarios.find(c => c.id === uf?.propietario_id)
    const exp  = expensas.find(e => e.id === cob.expensa_id)
    const con  = consorcioActivo || {}
    const adm  = {}

    const fecha = cob.fecha ? new Date(cob.fecha+'T00:00:00').toLocaleDateString('es-AR') : '—'
    const monto = '$' + Number(cob.monto).toLocaleString('es-AR', { minimumFractionDigits:2 })
    const periodo = exp?.periodo ? (() => {
      const [y,m] = exp.periodo.split('-')
      const mes = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
      return `${mes[parseInt(m)-1]} ${y}`
    })() : '—'
    const nroRecibo = cob.nro_recibo || cob.recibo_numero || cob.id.slice(-8).toUpperCase()

    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }
  .recibo { width: 180mm; margin: 8mm auto; padding: 8mm; border: 2px solid #1A3FA0; border-radius: 6px; }
  .header { background: #1A3FA0; color: white; padding: 10px 14px; border-radius: 4px 4px 0 0; margin: -8mm -8mm 12px -8mm; }
  .header h1 { font-size: 16px; font-weight: 700; }
  .header p { font-size: 11px; opacity: 0.85; margin-top: 2px; }
  .nro { float: right; text-align: right; }
  .nro span { font-size: 22px; font-weight: 800; display: block; }
  .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e5e7eb; }
  .row:last-child { border-bottom: none; }
  .label { color: #6B7280; font-size: 11px; }
  .value { font-weight: 600; }
  .monto-box { background: #f0fdf4; border: 2px solid #86efac; border-radius: 8px; padding: 14px; text-align: center; margin: 16px 0; }
  .monto-box .monto { font-size: 28px; font-weight: 800; color: #1B6B35; }
  .monto-box .label { color: #166534; font-size: 12px; margin-top: 4px; }
  .firma { margin-top: 24px; border-top: 1px solid #374151; padding-top: 8px; text-align: center; font-size: 11px; color: #374151; }
  .badge { display: inline-block; background: #dcfce7; color: #166534; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style></head><body>
<div class="recibo">
  <div class="header">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <h1>RECIBO DE PAGO DE EXPENSAS</h1>
        <p>Ley Provincial 14.701 — Provincia de Buenos Aires</p>
      </div>
      <div class="nro">
        <span>N° ${nroRecibo}</span>
        <div style="font-size:11px;opacity:0.8">Comprobante</div>
      </div>
    </div>
  </div>

  <div class="row">
    <span class="label">Consorcio</span>
    <span class="value">${con.nombre || '—'}</span>
  </div>
  <div class="row">
    <span class="label">Unidad Funcional</span>
    <span class="value">UF ${uf?.numero || '?'} — ${uf?.tipo || ''}</span>
  </div>
  <div class="row">
    <span class="label">Copropietario</span>
    <span class="value">${cp?.apellido_nombre || '—'}</span>
  </div>
  <div class="row">
    <span class="label">Período</span>
    <span class="value">${periodo}</span>
  </div>
  <div class="row">
    <span class="label">Fecha de pago</span>
    <span class="value">${fecha}</span>
  </div>
  <div class="row">
    <span class="label">Medio de pago</span>
    <span class="value">${(cob.medio_pago || 'efectivo').replace(/_/g,' ')}</span>
  </div>
  ' + (cob.canal_cobro ? '<div class="row"><span class="label">Canal</span><span class="value">' + cob.canal_cobro + '</span></div>' : '') + '

  <div class="monto-box">
    <div class="monto">${monto}</div>
    <div class="label">Importe recibido — <span class="badge">✓ Pago registrado</span></div>
    <div style="margin-top:10px;display:flex;align-items:center;justify-content:center;gap:12px">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=70x70&data=GASP-REC-${nroRecibo}-${con.nombre||''}-${periodo}" alt="QR" style="width:70px;height:70px" />
      <div style="text-align:left;font-size:9px;color:#374151"><div style="font-weight:600;margin-bottom:2px">Código de verificación</div><div>${nroRecibo}</div></div>
    </div>
  </div>

  <div class="row">
    <span class="label">Registrado por</span>
    <span class="value">Administración de Consorcios Pinamar</span>
  </div>

  <div class="firma">
    <strong>Javier García Pérez</strong> — Administrador de Consorcios — RPAC Mat. N° 83<br>
    Pinamar, Provincia de Buenos Aires<br>
    <span style="font-size:10px;color:#9ca3af">Comprobante emitido por GASP Consorcios — ${new Date().toLocaleString('es-AR')}</span>
  </div>
</div>
</body></html>`
  }

  function imprimirRecibo(cob) {
    const html = generarReciboHTML(cob)
    const win = window.open('', '_blank', 'width=800,height=600')
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 500)
  }

  function descargarRecibo(cob) {
    const html = generarReciboHTML(cob)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    const nro = cob.nro_recibo || cob.id.slice(-8).toUpperCase()
    a.download = `Recibo_${nro}_UF${unidades.find(u=>u.id===cob.unidad_id)?.numero||'?'}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId, filtroExp, filtroUF])

  const fmt = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits:2 })
  const fmtD = d => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'
  const periodoLabel = pid => {
    const exp = expensas.find(e=>e.id===pid)
    if (!exp) return '—'
    const [y,m] = (exp.periodo||'').split('-')
    const mes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return m ? `${mes[parseInt(m)-1]} ${y}` : exp.periodo
  }

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>🧾 Recibos de pago</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Genere e imprima recibos individuales de pago para cada copropietario
      </div>
      <Msg data={msg} />

      <Card style={{ marginBottom:16, background:'#eff6ff', border:'1px solid #bfdbfe' }}>
        <div style={{ fontSize:12, color:'#1e40af' }}>
          ℹ️ Los recibos se generan como página HTML lista para imprimir o guardar como PDF desde el navegador.
          Incluyen: N° de recibo, consorcio, UF, copropietario, período, fecha de pago, monto y firma del administrador.
          Cumplen con las exigencias del RPAC Provincia de Buenos Aires (Ley 14.701).
        </div>
      </Card>

      {/* Filtros */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Sel label="Filtrar por período" value={filtroExp} onChange={setFiltroExp}
            opts={[{v:'',l:'Todos los períodos'},
              ...expensas.map(e => {
                const [y,m] = (e.periodo||'').split('-')
                const mes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                return { v:e.id, l:m?`${mes[parseInt(m)-1]} ${y}`:e.periodo }
              })
            ]} />
          <Sel label="Filtrar por unidad" value={filtroUF} onChange={setFiltroUF}
            opts={[{v:'',l:'Todas las unidades'},
              ...unidades.map(u => ({ v:u.id, l:`UF ${u.numero}` }))
            ]} />
        </div>
      </Card>

      {/* Tabla de cobranzas */}
      <Card>
        <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>
          Cobranzas registradas ({cobranzas.length})
        </div>
        {cobranzas.length === 0 ? (
          <div style={{ textAlign:'center', padding:24, color:GR }}>
            Sin cobranzas en el filtro seleccionado
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Fecha','UF','Propietario','Período','Monto','Medio','N° Recibo','Acciones'].map((h,i) => (
                    <th key={i} style={{ padding:'7px 10px', textAlign:i===4?'right':'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb',
                      whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cobranzas.map(cob => {
                  const uf  = unidades.find(u=>u.id===cob.unidad_id)
                  const cp  = copropietarios.find(c=>c.id===uf?.propietario_id)
                  const nro = cob.nro_recibo || cob.recibo_numero || cob.id.slice(-8).toUpperCase()
                  return (
                    <tr key={cob.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>{fmtD(cob.fecha)}</td>
                      <td style={{ padding:'7px 10px', fontWeight:700 }}>UF {uf?.numero||'?'}</td>
                      <td style={{ padding:'7px 10px', fontSize:11 }}>{cp?.apellido_nombre||'—'}</td>
                      <td style={{ padding:'7px 10px', fontSize:11, color:GR }}>{periodoLabel(cob.expensa_id)}</td>
                      <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700, color:VD }}>{fmt(cob.monto)}</td>
                      <td style={{ padding:'7px 10px', fontSize:11, color:GR, textTransform:'capitalize' }}>
                        {(cob.medio_pago||'efectivo').replace(/_/g,' ')}
                      </td>
                      <td style={{ padding:'7px 10px', fontFamily:'monospace', fontSize:11 }}>{nro}</td>
                      <td style={{ padding:'7px 10px' }}>
                        <div style={{ display:'flex', gap:4 }}>
                          <Btn small onClick={() => imprimirRecibo(cob)}
                            style={{ background:'#eff6ff', color:AZ }}>
                            🖨️ Imprimir
                          </Btn>
                          <Btn small onClick={() => descargarRecibo(cob)}
                            style={{ background:'#f3f4f6', color:'#374151' }}>
                            ⬇
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
