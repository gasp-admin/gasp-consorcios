import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function ConsultarEnviados() {
  const { session, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, expensas, setExpensas, proveedores, setProveedores, adminPerfil, setAdminPerfil, esSuperAdmin, consorcios, setConsorcios, pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, navItems, secciones, navActivo, formCon, setFormCon, msgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [logs, setLogs]           = useState([])
  const [cargando, setCargando]   = useState(true)
  const [filtroTipo, setFiltroTipo] = useState('')   // '' | 'notificacion' | 'liquidacion'
  const [filtroEstado, setFiltroEstado] = useState('')
  const [busqueda, setBusqueda]   = useState('')
  const [emailAbierto, setEmailAbierto] = useState(null) // log completo con HTML

  async function cargar() {
    setCargando(true)
    let q = supabase.from('con_email_log').select('*')
      .eq('admin_id', session.user.id)
      .eq('consorcio_id', consorcioId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (filtroTipo)   q = q.eq('tipo', filtroTipo)
    if (filtroEstado) q = q.eq('estado', filtroEstado)
    const { data } = await q
    setLogs(data || [])
    setCargando(false)
  }
  useEffect(() => {
    if (consorcioId) {
      cargar()
      // Auto-verificar en segundo plano los emails enviados sin apertura registrada
      autoVerificar()
    }
  }, [consorcioId, filtroTipo, filtroEstado])

  async function autoVerificar() {
    // Buscar emails recientes (últimos 7 días) enviados sin apertura registrada
    const hace7dias = new Date(Date.now() - 7*24*60*60*1000).toISOString()
    const { data: pendientes } = await supabase.from('con_email_log').select('id, resend_id')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .eq('estado', 'enviado').eq('abierto', false)
      .not('resend_id', 'is', null)
      .gte('created_at', hace7dias)
      .limit(15)
    if (!pendientes?.length) return
    const { data: { session: sess } } = await supabase.auth.getSession()
    for (const log of pendientes) {
      try {
        await fetch(`\${SUPA_URL}/functions/v1/verificar-email-estado`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer \${sess?.access_token}`,
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
          },
          body: JSON.stringify({ resend_id: log.resend_id, log_id: log.id })
        })
      } catch(e) {}
    }
    // Recargar después de verificar
    cargar()
  }

  const fmtFecha = d => d ? new Date(d).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'

  const logsFiltrados = logs.filter(l => {
    if (!busqueda) return true
    const b = busqueda.toLowerCase()
    return (l.destinatario||'').toLowerCase().includes(b) ||
           (l.asunto||'').toLowerCase().includes(b) ||
           (l.unidad_id||'').toLowerCase().includes(b)
  })

  const estadoColor = e => e==='enviado'?VD:e==='error'?RJ:GR
  const estadoBg    = e => e==='enviado'?'#dcfce7':e==='error'?'#fee2e2':'#f3f4f6'
  const tipoLabel   = t => t==='notificacion'?'📣 Notificación':t==='liquidacion'?'📄 Liquidación':'📧 Email'

  // Vista del email completo
  if (emailAbierto) {
    const log = emailAbierto
    const uf  = unidades.find(u => u.id === log.unidad_id)
    const cp  = copropietarios.find(c => c.id === uf?.propietario_id)
    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
          <BtnSec onClick={()=>setEmailAbierto(null)}>← Volver</BtnSec>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:15 }}>{log.asunto}</div>
            <div style={{ fontSize:12, color:GR, marginTop:2 }}>
              {fmtFecha(log.created_at)} · Para: {log.destinatario} · UF {uf?.numero||log.unidad_id}
            </div>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <span style={{ fontSize:11, padding:'3px 10px', borderRadius:6,
              background: estadoBg(log.estado), color: estadoColor(log.estado), fontWeight:600 }}>
              {log.estado}
            </span>
            <span style={{ fontSize:11, padding:'3px 10px', borderRadius:6,
              background:'#f0f4ff', color:AZ, fontWeight:600 }}>
              {tipoLabel(log.tipo)}
            </span>
          </div>
        </div>

        {/* Datos del email */}
        <Card style={{ marginBottom:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, fontSize:12 }}>
            <div><span style={{ color:GR }}>Destinatario:</span> {log.destinatario}</div>
            <div><span style={{ color:GR }}>UF:</span> {uf ? `${uf.numero} — ${cp?.apellido_nombre||'—'}` : log.unidad_id}</div>
            <div><span style={{ color:GR }}>Enviado:</span> {fmtFecha(log.created_at)}</div>
            <div><span style={{ color:GR }}>Adjunto:</span> {log.tiene_adjunto ? '✓ Sí' : '—'}</div>
            <div><span style={{ color:GR }}>Link Drive:</span> {log.tiene_drive_link ? '✓ Sí' : '—'}</div>
            <div><span style={{ color:GR }}>Apertura:</span> {log.abierto ? `✓ ${fmtFecha(log.fecha_apertura)}` : 'No registrado'}</div>
            {log.error_msg && (
              <div style={{ gridColumn:'span 3', color:RJ, fontSize:11 }}>
                Error: {log.error_msg}
              </div>
            )}
          </div>
        </Card>

        {/* Texto del mensaje (si es notificación) */}
        {log.cuerpo_texto && (
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>Texto del mensaje</div>
            <div style={{ fontSize:13, lineHeight:1.8, color:'#111', whiteSpace:'pre-wrap' }}>
              {log.cuerpo_texto}
            </div>
          </Card>
        )}

        {/* Vista previa HTML */}
        {log.cuerpo_html && (
          <Card style={{ padding:0, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', background:'#f8fafc', borderBottom:'1px solid #e5e7eb',
              fontWeight:600, fontSize:13, color:AZ }}>
              Vista previa del email enviado
            </div>
            <iframe
              srcDoc={log.cuerpo_html}
              style={{ width:'100%', height:600, border:'none', display:'block' }}
              title="Vista previa email"
              sandbox="allow-same-origin" />
          </Card>
        )}
        {!log.cuerpo_html && !log.cuerpo_texto && (
          <Card>
            <div style={{ color:GR, fontSize:13, padding:'16px 0', textAlign:'center' }}>
              El cuerpo de este email no fue guardado (enviado antes de la versión actual).
            </div>
          </Card>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>📬 Consultar enviados</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Historial completo de emails enviados — Notificaciones y liquidaciones
      </div>

      {/* Filtros */}
      <Card style={{ marginBottom:14 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:10, alignItems:'end' }}>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Buscar</div>
            <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
              placeholder="Email, asunto, UF..."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db',
                borderRadius:7, fontSize:12.5, boxSizing:'border-box' }} />
          </div>
          <Sel label="Tipo" value={filtroTipo} onChange={setFiltroTipo}
            opts={[{ v:'', l:'Todos los tipos' },{ v:'notificacion', l:'📣 Notificaciones' },{ v:'liquidacion', l:'📄 Liquidaciones' }]} />
          <Sel label="Estado" value={filtroEstado} onChange={setFiltroEstado}
            opts={[{ v:'', l:'Todos los estados' },{ v:'enviado', l:'✓ Enviado' },{ v:'error', l:'✗ Error' }]} />
          <Btn small onClick={cargar}>↺ Actualizar</Btn>
        </div>
      </Card>

      {/* KPIs rápidos */}
      {logs.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:14 }}>
          {[
            { l:'Total emails', v:logs.length, c:AZ },
            { l:'Enviados', v:logs.filter(l=>l.estado==='enviado').length, c:VD },
            { l:'Notificaciones', v:logs.filter(l=>l.tipo==='notificacion').length, c:'#7c3aed' },
            { l:'Liquidaciones', v:logs.filter(l=>l.tipo==='liquidacion').length, c:'#0369a1' },
          ].map(({l,v,c}) => (
            <div key={l} style={{ background:'#fff', borderRadius:10, padding:'12px', textAlign:'center',
              boxShadow:'0 1px 4px #0001' }}>
              <div style={{ fontSize:22, fontWeight:800, color:c }}>{v}</div>
              <div style={{ fontSize:11, color:GR, marginTop:2 }}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabla */}
      {cargando ? (
        <div style={{ textAlign:'center', padding:32, color:GR }}>⏳ Cargando...</div>
      ) : logsFiltrados.length === 0 ? (
        <Card>
          <div style={{ textAlign:'center', padding:'24px 0', color:GR }}>
            {logs.length === 0 ? 'Sin emails enviados para este consorcio' : 'Sin resultados para el filtro aplicado'}
          </div>
        </Card>
      ) : (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f8fafc', borderBottom:'1.5px solid #e5e7eb' }}>
                  {['Fecha','Tipo','UF — Destinatario','Asunto','Opciones','Estado',''].map((h,i) => (
                    <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600,
                      color:'#374151', fontSize:11.5, whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logsFiltrados.map(log => {
                  const uf = unidades.find(u => u.id === log.unidad_id)
                  const cp = copropietarios.find(c => c.id === uf?.propietario_id)
                  return (
                    <tr key={log.id} style={{ borderBottom:'1px solid #f3f4f6',
                      cursor:'pointer', background:'#fff' }}
                      onClick={() => setEmailAbierto(log)}>
                      <td style={{ padding:'8px 12px', whiteSpace:'nowrap', color:GR, fontSize:11 }}>
                        {fmtFecha(log.created_at)}
                      </td>
                      <td style={{ padding:'8px 12px' }}>
                        <span style={{ fontSize:11 }}>{tipoLabel(log.tipo)}</span>
                      </td>
                      <td style={{ padding:'8px 12px' }}>
                        {uf && <div style={{ fontWeight:600, fontSize:12 }}>UF {uf.numero}</div>}
                        <div style={{ fontSize:11, color:GR }}>{log.destinatario}</div>
                        {cp && <div style={{ fontSize:11, color:GR }}>{cp.apellido_nombre}</div>}
                      </td>
                      <td style={{ padding:'8px 12px', maxWidth:220 }}>
                        <div style={{ fontWeight:500, fontSize:12, overflow:'hidden',
                          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {log.asunto}
                        </div>
                        <div style={{ fontSize:10, color:GR, marginTop:2, display:'flex', gap:6 }}>
                          {log.tiene_adjunto && <span>📎</span>}
                          {log.tiene_drive_link && <span>📁</span>}
                          {log.envio_masivo && <span>📢 Masivo</span>}
                        </div>
                      </td>
                      <td style={{ padding:'8px 12px' }}>
                        <div style={{ display:'flex', gap:4, fontSize:10 }}>
                          {log.abierto && <span style={{ color:VD, fontWeight:600 }}>👁 Leído</span>}
                          {log.entregado && <span style={{ color:AZ }}>✓ Entregado</span>}
                          {log.rebotado && <span style={{ color:RJ }}>⚠ Rebotado</span>}
                        </div>
                      </td>
                      <td style={{ padding:'8px 12px' }}>
                        <span style={{ fontSize:11, padding:'2px 9px', borderRadius:6, fontWeight:600,
                          background: estadoBg(log.estado), color: estadoColor(log.estado) }}>
                          {log.estado}
                        </span>
                      </td>
                      <td style={{ padding:'8px 10px', textAlign:'right' }}>
                        <span style={{ fontSize:11, color:AZ, fontWeight:600 }}>Ver →</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding:'8px 14px', background:'#f8fafc', fontSize:11, color:GR,
            borderTop:'1px solid #e5e7eb' }}>
            {logsFiltrados.length} emails · Haga clic en una fila para ver el contenido completo
          </div>
        </Card>
      )}
    </div>
  )
}
