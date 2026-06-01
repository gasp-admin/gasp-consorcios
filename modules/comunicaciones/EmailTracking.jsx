import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function EmailTracking() {
  const { session, consorcioActivo, unidades, copropietarios, expensas, adminPerfil } = useApp()
  const uid = session?.user?.id session, consorcioId } session, consorcioId }
  const [logs, setLogs]           = useState([])
  const [cargando, setCargando]   = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroExp, setFiltroExp] = useState('')
  const [expensas, setExpensas2]  = useState([])
  const [stats, setStats]         = useState(null)

  const cargar = async () => {
    setCargando(true)
    const [{ data: logsData }, { data: exps }] = await Promise.all([
      supabase.from('con_email_log').select('*')
        .eq('consorcio_id', consorcioId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('con_expensas').select('id,periodo')
        .eq('consorcio_id', consorcioId)
        .order('periodo', { ascending: false }),
    ])
    const data = logsData || []
    setLogs(data)
    setExpensas2(exps || [])

    // Calcular stats
    const total    = data.length
    const enviados = data.filter(l => l.estado === 'enviado').length
    const errores  = data.filter(l => l.estado === 'error').length
    const abiertos = data.filter(l => l.abierto).length
    setStats({ total, enviados, errores, abiertos,
      tasa_entrega: total > 0 ? Math.round(enviados/total*100) : 0,
      tasa_apertura: enviados > 0 ? Math.round(abiertos/enviados*100) : 0,
    })
    setCargando(false)
  }

  const verificarEstado = async (log) => {
    if (!log.resend_id) return
    setMsg({ tipo:'info', texto:'⏳ Verificando estado en Resend...' })
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPA_URL}/functions/v1/verificar-email-estado`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess?.access_token}`,
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        },
        body: JSON.stringify({ resend_id: log.resend_id, log_id: log.id })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      const eventos = data.eventos || []
      const resumen = eventos.length > 0
        ? eventos.map(e => e.name).join(', ')
        : 'Sin eventos registrados'
      setMsg({ tipo:'ok', texto:`✓ ${data.abierto ? '👁 Abierto' : data.entregado ? '✓ Entregado' : '📤 Enviado'} — Eventos: ${resumen}` })
      cargar()
    } catch(e) {
      setMsg({ tipo:'error', texto: 'Error: ' + e.message })
    }
  }

  const reenviar = async (log) => {
    if (!confirm(`¿Reenviar el email a ${log.destinatario}?`)) return
    // Marcar como pendiente y disparar reenvío
    await supabase.from('con_email_log').update({ estado:'pendiente_reenvio' }).eq('id', log.id)
    cargar()
  }

  const verificarTodos = async () => {
    const conResendId = logs.filter(l => l.resend_id && !l.abierto)
    if (conResendId.length === 0) { setMsg({ tipo:'info', texto:'Todos los emails ya están verificados' }); return }
    setMsg({ tipo:'info', texto:`⏳ Verificando ${conResendId.length} emails...` })
    let actualizados = 0
    for (const log of conResendId.slice(0, 20)) {  // máximo 20 a la vez
      try {
        const { data: { session: sess } } = await supabase.auth.getSession()
        const res = await fetch(`${SUPA_URL}/functions/v1/verificar-email-estado`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sess?.access_token}`,
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
          },
          body: JSON.stringify({ resend_id: log.resend_id, log_id: log.id })
        })
        if (res.ok) actualizados++
      } catch(e) {}
    }
    setMsg({ tipo:'ok', texto:`✓ ${actualizados} emails verificados` })
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const fmtD = d => d ? new Date(d).toLocaleString('es-AR', {
    day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
  }) : '—'

  const periodoLabel = pid => {
    const exp = expensas.find(e=>e.id===pid)
    if (!exp) return '—'
    const [y,m] = (exp.periodo||'').split('-')
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return m ? `${meses[parseInt(m)-1]} ${y}` : exp.periodo
  }

  const ESTADOS = {
    enviado:          { label:'Enviado',    color:VD,  bg:'#dcfce7', icon:'✓' },
    error:            { label:'Error',      color:RJ,  bg:'#fee2e2', icon:'✕' },
    rebotado:         { label:'Rebotado',   color:RJ,  bg:'#fee2e2', icon:'↩' },
    pendiente_reenvio:{ label:'Reenviando', color:AM,  bg:'#fef9c3', icon:'⟳' },
  }

  const logsFiltrados = logs.filter(l => {
    if (filtroEstado && l.estado !== filtroEstado) return false
    if (filtroExp && l.expensa_id !== filtroExp) return false
    return true
  })

  // Agrupar por período para vista resumida
  const porPeriodo = {}
  for (const l of logs) {
    const k = l.expensa_id || 'sin_periodo'
    if (!porPeriodo[k]) porPeriodo[k] = { enviados:0, errores:0, abiertos:0, total:0 }
    porPeriodo[k].total++
    if (l.estado === 'enviado') porPeriodo[k].enviados++
    if (l.estado === 'error')   porPeriodo[k].errores++
    if (l.abierto)              porPeriodo[k].abiertos++
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>📬 Seguimiento de emails</div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn small onClick={verificarTodos} style={{ background:'#eff6ff', color:AZ }}>⟳ Verificar todos</Btn>
          <Btn small onClick={cargar} style={{ background:'#f3f4f6', color:'#374151' }}>↺ Recargar</Btn>
        </div>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Estado de entrega y apertura de liquidaciones enviadas por email
      </div>

      {/* KPIs */}
      {stats && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:16 }}>
          {[
            { l:'Total enviados', v:stats.total,         c:AZ, bg:'#eff6ff' },
            { l:'Entregados',     v:stats.enviados,       c:VD, bg:'#f0fdf4' },
            { l:'Con error',      v:stats.errores,        c:RJ, bg:'#fff1f2' },
            { l:'Tasa entrega',   v:stats.tasa_entrega+'%', c:AZ, bg:'#f8fafc' },
            { l:'Aperturas',      v:stats.abiertos,       c:'#7c3aed', bg:'#faf5ff' },
          ].map((k,i) => (
            <div key={i} style={{ background:k.bg, borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
              <div style={{ fontSize:11, color:k.c, fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>{k.l}</div>
              <div style={{ fontSize:20, fontWeight:800, color:k.c }}>{k.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Resumen por período */}
      {Object.keys(porPeriodo).length > 0 && (
        <Card style={{ marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:12 }}>Resumen por período</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'#f3f4f6' }}>
                {['Período','Enviados','Errores','Aperturas','Progreso'].map((h,i) => (
                  <th key={i} style={{ padding:'6px 10px', textAlign:i===0?'left':'center',
                    fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(porPeriodo).map(([pid, s]) => {
                const pct = s.total > 0 ? Math.round(s.enviados/s.total*100) : 0
                return (
                  <tr key={pid} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'8px 10px', fontWeight:600 }}>{periodoLabel(pid)}</td>
                    <td style={{ padding:'8px 10px', textAlign:'center' }}>
                      <span style={{ color:VD, fontWeight:700 }}>{s.enviados}</span>
                      <span style={{ color:GR }}> / {s.total}</span>
                    </td>
                    <td style={{ padding:'8px 10px', textAlign:'center' }}>
                      {s.errores > 0
                        ? <span style={{ color:RJ, fontWeight:700 }}>{s.errores}</span>
                        : <span style={{ color:VD }}>✓</span>}
                    </td>
                    <td style={{ padding:'8px 10px', textAlign:'center', color:'#7c3aed', fontWeight:600 }}>
                      {s.abiertos || '—'}
                    </td>
                    <td style={{ padding:'8px 10px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <div style={{ flex:1, background:'#f3f4f6', borderRadius:4, height:6 }}>
                          <div style={{ width:`${pct}%`, background: pct===100?VD:AZ,
                            height:6, borderRadius:4 }} />
                        </div>
                        <span style={{ fontSize:10, color:GR, whiteSpace:'nowrap' }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Filtros */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Estado</div>
            <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
              <option value="">Todos</option>
              <option value="enviado">Enviados</option>
              <option value="error">Con error</option>
              <option value="rebotado">Rebotados</option>
            </select>
          </div>
          <Sel label="Período" value={filtroExp} onChange={setFiltroExp}
            opts={[{v:'',l:'Todos los períodos'},
              ...expensas.map(e => {
                const [y,m] = (e.periodo||'').split('-')
                const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                return { v:e.id, l:m?`${meses[parseInt(m)-1]} ${y}`:e.periodo }
              })
            ]} />
        </div>
      </Card>

      {/* Tabla detalle */}
      <Card>
        <div style={{ fontWeight:600, fontSize:13, marginBottom:10 }}>
          Detalle ({logsFiltrados.length} registros)
        </div>
        {cargando ? (
          <div style={{ textAlign:'center', padding:24, color:GR }}>⏳ Cargando...</div>
        ) : logsFiltrados.length === 0 ? (
          <div style={{ textAlign:'center', padding:24, color:GR }}>
            <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
            <div>Sin emails registrados</div>
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Fecha/Hora','Destinatario','Asunto','Estado','Abierto','Resend ID',''].map((h,i) => (
                    <th key={i} style={{ padding:'7px 10px', textAlign:'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb',
                      whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logsFiltrados.map(log => {
                  const est = ESTADOS[log.estado] || { label:log.estado, color:GR, bg:'#f3f4f6', icon:'?' }
                  return (
                    <tr key={log.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'7px 10px', color:GR, fontSize:11, whiteSpace:'nowrap' }}>
                        {fmtD(log.created_at)}
                      </td>
                      <td style={{ padding:'7px 10px', maxWidth:160 }}>
                        <div style={{ fontWeight:500 }}>{log.destinatario}</div>
                      </td>
                      <td style={{ padding:'7px 10px', color:GR, fontSize:11, maxWidth:200 }}>
                        {log.asunto?.replace('Expensas ','').slice(0,50)}
                      </td>
                      <td style={{ padding:'7px 10px', whiteSpace:'nowrap' }}>
                        <Badge text={`${est.icon} ${est.label}`} color={est.color} bg={est.bg} />
                        {log.estado === 'error' && log.error_msg && (
                          <div style={{ fontSize:9, color:RJ, marginTop:2, maxWidth:120 }}>
                            {(() => { try { return JSON.parse(log.error_msg).message } catch { return log.error_msg?.slice(0,40) } })()}
                          </div>
                        )}
                      </td>
                      <td style={{ padding:'7px 10px', textAlign:'center' }}>
                        {log.abierto
                          ? <div>
                              <span style={{ color:'#7c3aed', fontWeight:700, fontSize:12 }}>👁 Sí</span>
                              {log.fecha_apertura && <div style={{ fontSize:10, color:GR }}>
                                {new Date(log.fecha_apertura).toLocaleDateString('es-AR')}
                              </div>}
                            </div>
                          : log.entregado
                            ? <span style={{ color:VD, fontSize:11 }}>✓ Entregado</span>
                            : log.rebotado
                              ? <span style={{ color:RJ, fontSize:11 }}>↩ Rebotado</span>
                              : <span style={{ color:GR, fontSize:11 }}>— Pendiente</span>
                        }
                      </td>
                      <td style={{ padding:'7px 10px', fontSize:10, color:GR, fontFamily:'monospace' }}>
                        {log.resend_id ? log.resend_id.slice(0,20)+'…' : '—'}
                      </td>
                      <td style={{ padding:'7px 10px' }}>
                        <div style={{ display:'flex', gap:4 }}>
                          {log.resend_id && (
                            <Btn small onClick={()=>verificarEstado(log)}
                              style={{ background:'#eff6ff', color:AZ }} title="Verificar estado en Resend">
                              ⟳
                            </Btn>
                          )}
                          {log.estado === 'error' && (
                            <Btn small onClick={()=>reenviar(log)}
                              style={{ background:'#fef9c3', color:AM }} title="Reenviar">
                              ↩
                            </Btn>
                          )}
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

      {/* Nota sobre tracking de aperturas */}
      <div style={{ marginTop:12, padding:'12px 14px', background:'#eff6ff',
        borderRadius:8, fontSize:11, color:'#1e40af', border:'1px solid #bfdbfe' }}>
        <strong>ℹ️ Sobre el tracking de aperturas:</strong>
        <div style={{ marginTop:4, lineHeight:1.7 }}>
          • El tracking de entrega funciona automáticamente con Resend.<br/>
          • El tracking de <strong>apertura</strong> requiere que el copropietario permita la carga de imágenes en su cliente de email (Gmail, Outlook, etc.).<br/>
          • Para activar el tracking completo, verificar el dominio <strong>administracionpinamar.com</strong> en resend.com → Domains.<br/>
          • Presionar <strong>"⟳ Verificar todos"</strong> para actualizar el estado de todos los emails desde Resend.
        </div>
      </div>
    </div>
  )
}
