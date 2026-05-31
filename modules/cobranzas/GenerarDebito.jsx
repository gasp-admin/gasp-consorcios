// modules — GenerarDebito.jsx
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

export default function GenerarDebito() {
  const { session, consorcioActivo, unidades, copropietarios, expensas } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [expSel, setExpSel]   = useState('')
  const [sistema, setSistema] = useState('expensas_pagas')
  const [config, setConfig]   = useState(null)
  const [detalles, setDetalles] = useState([])
  const [msg, setMsg]         = useState(null)
  const [generando, setGenerando] = useState(false)

  async function cargarConfig() {
    const { data } = await supabase.from('con_config_cobranza').select('*')
      .eq('consorcio_id', consorcioId).single()
    setConfig(data || {})
  }

  async function cargarDetalles(eid) {
    const { data } = await supabase.from('con_expensas_detalle').select('*')
      .eq('expensa_id', eid)
    setDetalles(data || [])
  }

  useEffect(() => { if (consorcioId) cargarConfig() }, [consorcioId])
  useEffect(() => { if (expSel) cargarDetalles(expSel) }, [expSel])

  function generarArchivoEP() {
    // Formato DI Expensas Pagas (233 chars por registro)
    const exp     = expensas.find(e => e.id === expSel)
    const periodo = exp?.periodo || ''
    const [y, m]  = periodo.split('-')

    const convenio = (config?.ep_convenio_id || '0000').padStart(4,'0')
    const consId   = (config?.ep_consorcio_id || '0000').padStart(4,'0')
    const ahora    = new Date()
    const fecha    = `${ahora.getFullYear()}${String(ahora.getMonth()+1).padStart(2,'0')}${String(ahora.getDate()).padStart(2,'0')}`
    const hora     = `${String(ahora.getHours()).padStart(2,'0')}${String(ahora.getMinutes()).padStart(2,'0')}${String(ahora.getSeconds()).padStart(2,'0')}`

    // Header
    let contenido = `1${consId}${fecha}${hora}\r\n`

    let totalImporte = 0
    let nroReg = 0

    for (const det of detalles) {
      const uf = unidades.find(u => u.id === det.unidad_id)
      const cp = copropietarios.find(c => c.id === uf?.propietario_id)
      if (!uf) continue

      const nroEP = String(uf.nro_ep || detalles.indexOf(det) + 1).padStart(5, '0')
      const nombre = (cp?.apellido_nombre || '').padEnd(60, ' ').slice(0,60)
      const periodoStr = `${y}-${m}`.padEnd(7,' ')
      const impMin = Math.round((parseFloat(det.monto)||0) * 100)
      const impMax = Math.round((parseFloat(det.monto)||0) * 1.03 * 100) // +3% por mora

      // Fecha vto 1: día 10 del mes siguiente
      const vto1 = `${y}${m}10`
      // Fecha vto 2: día 20 del mes siguiente
      const vto2 = `${y}${m}20`

      const impMin10 = String(impMin).padStart(10,'0')
      const impMax10 = String(impMax).padStart(10,'0')
      const nroUFConv = `${convenio}${nroEP}`.padStart(9,'0')

      // Construcción del registro (233 chars)
      // Usamos el formato exacto del archivo DI de ejemplo
      let reg = `5${convenio}${nroEP}${periodoStr}${nombre}` +
        `${' '.repeat(48)}${fecha}${impMin10}1${vto2}${String(impMax).padStart(10,'0')}` +
        `5${consId}${convenio}${nroEP}${String(parseInt(m)+1>12?1:parseInt(m)+1).padStart(2,'0').padEnd(4,'0')}` +
        `10${impMin10}1${impMax10}5${consId}${String(ahora.getMonth()).padStart(2,'0')}`

      // Asegurar largo 233
      reg = reg.slice(0, 233).padEnd(233, '0')
      contenido += reg + '\r\n'
      totalImporte += impMin
      nroReg++
    }

    // Total
    const totStr = String(totalImporte).padStart(15,'0')
    const regStr = String(nroReg).padStart(6,'0')
    contenido += `9${consId}${fecha}${hora}${regStr}${totStr}...\r\n`

    // Descargar
    const blob = new Blob([contenido], { type:'text/plain;charset=latin-1' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `DI_${consId}_${fecha}${hora}.txt`
    a.click()
    URL.revokeObjectURL(url)
    setMsg({ tipo:'ok', texto:`✓ Archivo DI generado — ${nroReg} unidades — Total: $${(totalImporte/100).toLocaleString('es-AR')}` })
  }

  function generarArchivoSIRO() {
    // Formato TXT para subir a onlinesiro.com.ar
    // Columnas: nro_referencia | nombre | importe_minimo | fecha_vto1 | importe_maximo | fecha_vto2
    // (formato CSV/TXT que acepta la web de SIRO para carga masiva de deuda)
    const exp = expensas.find(e => e.id === expSel)
    const periodo = exp?.periodo || ''
    const [y, m] = periodo.split('-')

    let contenido = `NRO_REFERENCIA;NOMBRE;IMPORTE_1;FECHA_VTO_1;IMPORTE_2;FECHA_VTO_2\r\n`
    let nroReg = 0

    for (const det of detalles) {
      const uf = unidades.find(u => u.id === det.unidad_id)
      const cp = copropietarios.find(c => c.id === uf?.propietario_id)
      if (!uf) continue

      const nroSiro = uf.nro_siro || String(detalles.indexOf(det)+1).padStart(5,'0')
      const nombre  = (cp?.apellido_nombre || '').replace(/;/g,'')
      const imp1    = (parseFloat(det.monto)||0).toFixed(2)
      const imp2    = ((parseFloat(det.monto)||0) * 1.03).toFixed(2)
      const vto1    = `${String(parseInt(m)>9?parseInt(m):m).padStart(2,'0')}/${y}`  // MM/YYYY
      const vto2    = `${String(parseInt(m)>9?parseInt(m):m).padStart(2,'0')}/${y}`

      contenido += `${nroSiro};${nombre};${imp1};10/${vto1};${imp2};20/${vto1}\r\n`
      nroReg++
    }

    const blob = new Blob([contenido], { type:'text/plain;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    const ahora = new Date()
    a.download = `SIRO_Deuda_${consorcioId}_${ahora.getFullYear()}${String(ahora.getMonth()+1).padStart(2,'0')}${String(ahora.getDate()).padStart(2,'0')}.txt`
    a.click()
    URL.revokeObjectURL(url)
    setMsg({ tipo:'ok', texto:`✓ Archivo SIRO generado — ${nroReg} unidades` })
  }

  const fmt = n => '$' + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2 })
  const periodoLabel = p => {
    if (!p) return '—'
    const [y,m] = p.split('-')
    const mes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return m ? `${mes[parseInt(m)-1]} ${y}` : p
  }

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>📤 Generar archivo de débito</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Genera el archivo para informar la deuda a los sistemas de cobranza
      </div>
      <Msg data={msg} />

      <Card style={{ marginBottom:16 }}>
        <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>Configuración</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Sistema destino</div>
            <select value={sistema} onChange={e=>setSistema(e.target.value)}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
              <option value="expensas_pagas">Expensas Pagas (archivo DI)</option>
              <option value="siro">SIRO Banco Roela (CSV para carga web)</option>
            </select>
          </div>
          <Sel label="Período" value={expSel} onChange={setExpSel}
            opts={[{v:'',l:'— Seleccione período —'},
              ...expensas.map(e => ({ v:e.id, l:`${periodoLabel(e.periodo)} — ${e.tipo||''}` }))
            ]} />
        </div>

        {expSel && detalles.length > 0 && (
          <>
            {/* Resumen */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
              {[
                { l:'Unidades', v:detalles.length },
                { l:'Total a cobrar', v:fmt(detalles.reduce((a,d)=>a+(parseFloat(d.monto)||0),0)) },
                { l:'Sin Nro EP', v:unidades.filter(u=>!u.nro_ep&&detalles.some(d=>d.unidad_id===u.id)).length },
                { l:'Sin Nro SIRO', v:unidades.filter(u=>!u.nro_siro&&detalles.some(d=>d.unidad_id===u.id)).length },
              ].map((k,i) => (
                <div key={i} style={{ background:'#f8fafc', borderRadius:8, padding:'10px 12px', textAlign:'center' }}>
                  <div style={{ fontSize:11, color:GR, fontWeight:600, marginBottom:4 }}>{k.l}</div>
                  <div style={{ fontSize:17, fontWeight:800, color:i===2&&k.v>0?AM:i===3&&k.v>0?AM:AZ }}>{k.v}</div>
                </div>
              ))}
            </div>

            {sistema === 'expensas_pagas' && !config?.ep_convenio_id && (
              <div style={{ background:'#fef9c3', border:'1px solid #f59e0b', borderRadius:8,
                padding:'10px 14px', marginBottom:12, fontSize:12, color:'#92400e' }}>
                ⚠️ Configurar ID Convenio EP en Cobranzas automáticas → ⚙️ Configuración
              </div>
            )}

            <Btn onClick={sistema === 'expensas_pagas' ? generarArchivoEP : generarArchivoSIRO}
              disabled={!expSel}>
              📥 Descargar archivo {sistema === 'expensas_pagas' ? 'DI (Expensas Pagas)' : 'SIRO'}
            </Btn>

            {/* Tabla previa */}
            <div style={{ marginTop:16, overflowX:'auto' }}>
              <div style={{ fontWeight:600, fontSize:12, color:GR, marginBottom:8 }}>
                Detalle de UFs a incluir
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['UF','Propietario','Importe','Nro EP','Nro SIRO'].map((h,i) => (
                      <th key={i} style={{ padding:'5px 8px', textAlign:i>=2?'right':'left',
                        fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detalles.map(det => {
                    const uf = unidades.find(u=>u.id===det.unidad_id)
                    const cp = copropietarios.find(c=>c.id===uf?.propietario_id)
                    return (
                      <tr key={det.id} style={{ borderBottom:'1px solid #f9fafb' }}>
                        <td style={{ padding:'5px 8px', fontWeight:600 }}>UF {uf?.numero}</td>
                        <td style={{ padding:'5px 8px' }}>{cp?.apellido_nombre||'—'}</td>
                        <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:600 }}>{fmt(det.monto)}</td>
                        <td style={{ padding:'5px 8px', textAlign:'right' }}>
                          {uf?.nro_ep || <span style={{color:AM}}>—</span>}
                        </td>
                        <td style={{ padding:'5px 8px', textAlign:'right' }}>
                          {uf?.nro_siro || <span style={{color:AM}}>—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
