import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function EnviarEmails() {
  const { session, cargando, esSuperAdmin, consorcios, setConsorcios, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, proveedores, setProveedores, adminPerfil, setAdminPerfil, formCon, setFormCon, msgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio, pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, navItems, secciones, navActivo, setExpensas } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [expensas, setExpensas]   = useState([])
  const [expSel, setExpSel]       = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [enviando, setEnviando]   = useState(false)
  const [resultado, setResultado] = useState(null)
  const [msg, setMsg]             = useState(null)
  const [emailLog, setEmailLog]   = useState([])
  const [adjunto, setAdjunto]     = useState(null) // { nombre, tipo, base64 }

  async function cargarExpensas() {
    const { data } = await supabase.from('con_expensas').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .order('periodo', { ascending: false })
    setExpensas(data || [])
    if (data?.length > 0) setExpSel(data[0].id)
  }

  async function cargarLog() {
    const { data } = await supabase.from('con_email_log').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .order('created_at', { ascending: false }).limit(30)
    setEmailLog(data || [])
  }

  async function enviar(esTest) {
    if (!expSel) return setMsg({ tipo:'warn', texto:'Seleccioná un período primero' })
    if (esTest && !testEmail) return setMsg({ tipo:'warn', texto:'Ingresá el email de prueba' })
    if (!esTest && !confirm('¿Enviar la liquidación a TODOS los copropietarios con email registrado?')) return

    setEnviando(true); setResultado(null); setMsg(null)
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPA_URL}/functions/v1/enviar-liquidacion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess?.access_token}`,
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        },
        body: JSON.stringify({
          expensa_id: expSel,
          admin_id: session.user.id,
          test_email: esTest ? testEmail : undefined,
          adjunto: adjunto ? { nombre: adjunto.nombre, tipo: adjunto.tipo, base64: adjunto.base64 } : undefined,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error en el servidor')
      setResultado(data)
      setMsg({ tipo:'ok', texto: esTest
        ? `✓ Email de prueba enviado a ${testEmail}`
        : `✓ Enviados: ${data.enviados} | Sin email: ${data.sinEmail} | Errores: ${data.errores}` })
      cargarLog()
    } catch(e) {
      setMsg({ tipo:'error', texto: 'Error: ' + e.message })
    }
    setEnviando(false)
  }

  useEffect(() => { if (consorcioId) { cargarExpensas(); cargarLog() } }, [consorcioId])

  const expActual = expensas.find(e => e.id === expSel)
  const conEmail  = unidades.filter(u => {
    // contar UFs con email — aproximado
    return true
  }).length

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>✉️ Enviar liquidación por email</div>
      <div style={{ fontSize:12, color:GR, marginBottom:20 }}>
        Envía la liquidación individual a cada copropietario con su link de portal
      </div>
      <Msg data={msg} />

      {/* Selector período */}
      <Card style={{ marginBottom:16 }}>
        <div style={{ fontWeight:600, color:AZ, marginBottom:14, fontSize:13 }}>Configuración del envío</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Período</div>
            <select value={expSel} onChange={e => setExpSel(e.target.value)}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                borderRadius:7, fontSize:13, background:'#fff' }}>
              {expensas.map(e => (
                <option key={e.id} value={e.id}>
                  {(() => {
                    const [y,m] = (e.periodo||'').split('-')
                    const mes = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
                    return `${mes[parseInt(m)-1]} ${y} — ${e.tipo}`
                  })()} {e.total_expensa > 0 ? `($${Number(e.total_expensa).toLocaleString('es-AR')})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display:'flex', flexDirection:'column', justifyContent:'flex-end', gap:8 }}>
            {expActual && (
              <div style={{ fontSize:12, color:GR, padding:'8px 12px',
                background:'#f8fafc', borderRadius:8 }}>
                <div>Período: <strong>{expActual.periodo}</strong></div>
                <div>Vto: {expActual.fecha_vencimiento || '—'}</div>
                <div>Total: ${Number(expActual.total_expensa||0).toLocaleString('es-AR')}</div>
              </div>
            )}
          </div>
        </div>

        {/* Adjunto opcional */}
        <div style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'14px 16px', marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:8 }}>
            📎 Adjunto (opcional)
          </div>
          <div style={{ fontSize:12, color:GR, marginBottom:8 }}>
            Podés adjuntar hasta 1 archivo (PDF o imagen, máx. 5 MB) que se enviará junto a la liquidación.
          </div>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg"
            onChange={e => {
              const file = e.target.files?.[0]
              if (!file) return setAdjunto(null)
              if (file.size > 5 * 1024 * 1024) {
                alert('El archivo supera los 5 MB. Seleccioná un archivo más pequeño.')
                e.target.value = ''; return
              }
              const reader = new FileReader()
              reader.onload = ev => setAdjunto({ nombre: file.name, tipo: file.type, base64: ev.target.result.split(',')[1] })
              reader.readAsDataURL(file)
            }}
            style={{ fontSize:12, color:GR }} />
          {adjunto && (
            <div style={{ fontSize:11, color:VD, marginTop:6 }}>
              ✓ {adjunto.nombre} listo para enviar
            </div>
          )}
        </div>

        {/* Test email */}
        <div style={{ background:'#fef9c3', border:'1px solid #f59e0b', borderRadius:8,
          padding:'14px 16px', marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:13, color:'#92400e', marginBottom:8 }}>
            📧 Prueba antes de enviar masivamente
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <input value={testEmail} onChange={e => setTestEmail(e.target.value)}
              placeholder="email@prueba.com"
              style={{ flex:1, padding:'8px 11px', border:'1px solid #d1d5db',
                borderRadius:7, fontSize:13 }} />
            <Btn small color={AM} onClick={() => enviar(true)} disabled={enviando}>
              {enviando ? '⏳' : '📤 Enviar prueba'}
            </Btn>
          </div>
          <div style={{ fontSize:11, color:'#92400e', marginTop:6 }}>
            El email de prueba llega a la dirección ingresada con los datos de la primera UF.
          </div>
        </div>

        {/* Envío masivo */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:13, color:GR }}>
            Enviará a todos los copropietarios con email registrado.
            Los que no tienen email quedarán sin enviar.
          </div>
          <Btn color={AZ} onClick={() => enviar(false)} disabled={enviando}>
            {enviando ? '⏳ Enviando...' : '📨 Enviar a todos'}
          </Btn>
        </div>
      </Card>

      {/* Resultado */}
      {resultado && (
        <Card style={{ marginBottom:16, background:'#f0fdf4', border:'1px solid #86efac' }}>
          <div style={{ fontWeight:600, color:VD, marginBottom:10 }}>Resultado del envío</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
            {[
              { l:'Enviados', v:resultado.enviados, c:VD },
              { l:'Sin email', v:resultado.sinEmail, c:GR },
              { l:'Errores', v:resultado.errores, c:RJ },
              { l:'Total UFs', v:resultado.total, c:AZ },
            ].map((k,i) => (
              <div key={i} style={{ textAlign:'center', padding:'10px',
                background:'#fff', borderRadius:8 }}>
                <div style={{ fontSize:22, fontWeight:800, color:k.c }}>{k.v}</div>
                <div style={{ fontSize:11, color:GR }}>{k.l}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Log de envíos */}
      {emailLog.length > 0 && (
        <Card>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>
            Historial de envíos
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Fecha','Destinatario','Asunto','Estado'].map((h,i) => (
                    <th key={i} style={{ padding:'6px 10px', textAlign:'left',
                      fontSize:11, fontWeight:'bold', color:GR, borderBottom:'1px solid #e5e7eb' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {emailLog.map(log => (
                  <tr key={log.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'7px 10px', whiteSpace:'nowrap' }}>
                      {new Date(log.created_at).toLocaleDateString('es-AR')}
                    </td>
                    <td style={{ padding:'7px 10px' }}>{log.destinatario}</td>
                    <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>
                      {log.asunto?.slice(0,50)}
                    </td>
                    <td style={{ padding:'7px 10px' }}>
                      <Badge
                        text={log.estado}
                        color={log.estado==='enviado'?VD:RJ}
                        bg={log.estado==='enviado'?'#dcfce7':'#fee2e2'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Info configuración */}
      <Card style={{ marginTop:16, background:'#f0f9ff', border:'1px solid #bae6fd' }}>
        <div style={{ fontWeight:600, fontSize:13, color:'#0369a1', marginBottom:8 }}>
          ⚙️ Configuración requerida
        </div>
        <div style={{ fontSize:12, color:'#374151', lineHeight:1.8 }}>
          Para activar el envío de emails, configure en Vercel → Settings → Environment Variables:
          <br/>
          <code style={{ background:'#e0f2fe', padding:'2px 6px', borderRadius:4 }}>RESEND_API_KEY</code> — obtenga su clave en <a href="https://resend.com" target="_blank" style={{ color:'#0369a1' }}>resend.com</a>
          <br/>
          <code style={{ background:'#e0f2fe', padding:'2px 6px', borderRadius:4 }}>SITE_URL</code> — <code>https://consorcios.administracionpinamar.com</code>
          <br/>
          Y despliegue la Edge Function <code>enviar-liquidacion</code> en Supabase.
        </div>
      </Card>
    </div>
  )
}
