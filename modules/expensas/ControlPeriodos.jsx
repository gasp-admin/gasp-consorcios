import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function ControlPeriodos() {
  const { session, consorcioActivo, unidades, copropietarios, expensas, proveedores, adminPerfil } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [periodos, setPeriodos]   = useState([])
  const [msg, setMsg]             = useState(null)
  const [procesando, setProcesando] = useState(false)

  async function cargar() {
    const { data } = await supabase.from('con_periodos').select('*')
      .eq('consorcio_id', consorcioId).order('periodo', { ascending: false })
    setPeriodos(data || [])
  }

  async function abrirPeriodo() {
    const hoy = new Date()
    const mes = String(hoy.getMonth()+1).padStart(2,'0')
    const periodo = `${hoy.getFullYear()}-${mes}`

    // Verificar si ya existe
    const existe = periodos.find(p => p.periodo === periodo)
    if (existe) return setMsg({ tipo:'warn', texto:`El período ${periodo} ya existe` })

    setProcesando(true)
    const { error } = await supabase.from('con_periodos').insert([{
      id: `PER-${consorcioId}-${periodo}`,
      admin_id: session.user.id,
      consorcio_id: consorcioId,
      periodo,
      estado: 'abierto',
      fecha_apertura: hoy.toISOString().split('T')[0],
      expensas_generadas: expensas.some(e => e.periodo === periodo),
    }])
    if (error) setMsg({ tipo:'error', texto: error.message })
    else { setMsg({ tipo:'ok', texto: `✓ Período ${periodo} abierto` }); cargar() }
    setProcesando(false)
  }

  async function cerrarPeriodo(p) {
    // Verificar que tenga expensas generadas
    const tieneExpensa = expensas.some(e => e.periodo === p.periodo)
    if (!tieneExpensa) {
      if (!confirm(`El período ${p.periodo} no tiene expensas generadas. ¿Cerrar de todas formas?`)) return
    }
    if (!confirm(`¿Cerrar definitivamente el período ${p.periodo}? No se podrán registrar movimientos en períodos cerrados.`)) return

    setProcesando(true)
    const { error } = await supabase.from('con_periodos')
      .update({ estado:'cerrado', fecha_cierre: new Date().toISOString().split('T')[0] })
      .eq('id', p.id)
    if (error) setMsg({ tipo:'error', texto: error.message })
    else { setMsg({ tipo:'ok', texto: `✓ Período ${p.periodo} cerrado` }); cargar() }
    setProcesando(false)
  }

  async function reabrirPeriodo(p) {
    if (!confirm(`¿Reabrir el período ${p.periodo}?`)) return
    setProcesando(true)
    await supabase.from('con_periodos')
      .update({ estado:'abierto', fecha_cierre: null })
      .eq('id', p.id)
    setMsg({ tipo:'ok', texto: `✓ Período ${p.periodo} reabierto` })
    cargar()
    setProcesando(false)
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const periodoLabel = periodo => {
    const [y,m] = (periodo||'').split('-')
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    return m ? `${meses[parseInt(m)-1]} ${y}` : periodo
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>🔒 Control de períodos</div>
        <Btn onClick={abrirPeriodo} disabled={procesando}>+ Abrir período actual</Btn>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Gestión del ciclo contable mensual de {consorcioActivo?.nombre}
      </div>
      <Msg data={msg} />

      {/* Info */}
      <Card style={{ marginBottom:16, background:'#eff6ff', border:'1px solid #bae6fd' }}>
        <div style={{ fontSize:13, color:'#1e40af', lineHeight:1.8 }}>
          <strong>Flujo recomendado por período:</strong>
          <div style={{ marginTop:6, display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, fontSize:12 }}>
            {['1. Cargar gastos','2. Generar expensa','3. Calcular mora','4. Registrar cobranzas','5. Cerrar período'].map((s,i) => (
              <div key={i} style={{ background:'#dbeafe', borderRadius:6, padding:'6px 8px',
                textAlign:'center', fontWeight:600, color:'#1e40af' }}>{s}</div>
            ))}
          </div>
        </div>
      </Card>

      {/* Tabla de períodos */}
      {periodos.length === 0 ? (
        <Card>
          <div style={{ textAlign:'center', padding:24, color:GR }}>
            Sin períodos registrados. Haga clic en "Abrir período actual" para comenzar.
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Período','Estado','Apertura','Cierre','Expensas','Acciones'].map((h,i) => (
                    <th key={i} style={{ padding:'8px 12px', textAlign:'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodos.map(p => {
                  const tieneExpensa = expensas.some(e => e.periodo === p.periodo)
                  return (
                    <tr key={p.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'10px 12px', fontWeight:700 }}>{periodoLabel(p.periodo)}</td>
                      <td style={{ padding:'10px 12px' }}>
                        <Badge text={p.estado==='abierto'?'🔓 Abierto':'🔒 Cerrado'}
                          color={p.estado==='abierto'?VD:'#374151'}
                          bg={p.estado==='abierto'?'#dcfce7':'#f3f4f6'} />
                      </td>
                      <td style={{ padding:'10px 12px', color:GR, fontSize:12 }}>
                        {p.fecha_apertura ? new Date(p.fecha_apertura+'T00:00:00').toLocaleDateString('es-AR') : '—'}
                      </td>
                      <td style={{ padding:'10px 12px', color:GR, fontSize:12 }}>
                        {p.fecha_cierre ? new Date(p.fecha_cierre+'T00:00:00').toLocaleDateString('es-AR') : '—'}
                      </td>
                      <td style={{ padding:'10px 12px' }}>
                        <Badge text={tieneExpensa?'✓ Generadas':'Pendiente'}
                          color={tieneExpensa?VD:AM}
                          bg={tieneExpensa?'#dcfce7':'#fef9c3'} />
                      </td>
                      <td style={{ padding:'10px 12px' }}>
                        {p.estado === 'abierto' ? (
                          <Btn small onClick={() => cerrarPeriodo(p)} disabled={procesando}
                            style={{ background:'#374151', color:'#fff' }}>
                            🔒 Cerrar
                          </Btn>
                        ) : (
                          <Btn small onClick={() => reabrirPeriodo(p)} disabled={procesando}
                            style={{ background:'#f3f4f6', color:'#374151' }}>
                            🔓 Reabrir
                          </Btn>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
