import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'
import { useRouter } from 'next/router'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const fmt  = n => n ? '$' + Number(n).toLocaleString('es-AR') : '$0'
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR') : '—'
const periodoLabel = p => {
  if (!p) return '—'
  const [y, m] = p.split('-')
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
    'Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${meses[parseInt(m)-1]} ${y}`
}

export default function Portal() {
  const router = useRouter()
  const { token } = router.query

  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [unidad, setUnidad]       = useState(null)
  const [coprop, setCoprop]       = useState(null)
  const [consorcio, setConsorcio] = useState(null)
  const [detalles, setDetalles]   = useState([])
  const [cobranzas, setCobranzas] = useState([])
  const [adminPerfil, setAdminPerfil] = useState(null)

  useEffect(() => {
    if (!token) return
    cargar(token)
  }, [token])

  async function cargar(tk) {
    setLoading(true)
    try {
      // 1. Buscar la UF por token
      const { data: uf, error: e1 } = await supabase
        .from('con_unidades')
        .select('*')
        .eq('portal_token', tk)
        .single()
      if (e1 || !uf) { setError('Link no válido o expirado.'); setLoading(false); return }
      setUnidad(uf)

      // 2. Copropietario
      const { data: cp } = await supabase
        .from('con_copropietarios')
        .select('*')
        .eq('id', uf.propietario_id)
        .single()
      setCoprop(cp)

      // 3. Consorcio
      const { data: con } = await supabase
        .from('con_consorcios')
        .select('*')
        .eq('id', uf.consorcio_id)
        .single()
      setConsorcio(con)

      // 4. Perfil del administrador
      const { data: adm } = await supabase
        .from('con_admin_perfil')
        .select('*')
        .eq('admin_id', uf.admin_id)
        .single()
      setAdminPerfil(adm)

      // 5. Historial de expensas/detalles de esta UF
      const { data: dets } = await supabase
        .from('con_expensas_detalle')
        .select('*')
        .eq('unidad_id', uf.id)
        .order('created_at', { ascending: false })
        .limit(12)

      // Enriquecer con datos de expensa
      const detsEnriq = await Promise.all((dets || []).map(async d => {
        const { data: exp } = await supabase
          .from('con_expensas')
          .select('periodo, fecha_vencimiento, estado, tipo')
          .eq('id', d.expensa_id)
          .single()
        return { ...d, con_expensas: exp }
      }))
      setDetalles(detsEnriq)

      // 6. Historial de pagos
      const { data: cobs } = await supabase
        .from('con_cobranzas')
        .select('*')
        .eq('unidad_id', uf.id)
        .order('fecha', { ascending: false })
        .limit(20)

      // Enriquecer con período
      const cobsEnriq = await Promise.all((cobs || []).map(async c => {
        const { data: exp } = await supabase
          .from('con_expensas')
          .select('periodo')
          .eq('id', c.expensa_id)
          .single()
        return { ...c, con_expensas: exp }
      }))
      setCobranzas(cobsEnriq)

    } catch (e) {
      setError('Error al cargar los datos. Intente nuevamente.')
    }
    setLoading(false)
  }

  // ── Cálculos ──────────────────────────────────────────────
  const deudaTotal = detalles
    .filter(d => d.estado !== 'pagada')
    .reduce((a, d) => {
      const saldo = (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0)
        + (parseFloat(d.interes_mora)||0) - (parseFloat(d.pagos_periodo)||0)
      return a + Math.max(0, saldo)
    }, 0)

  const ultimoPago = cobranzas[0]
  const periodoActual = detalles[0]

  // ── Colores ───────────────────────────────────────────────
  const AZ = '#1A3FA0'
  const VD = '#1B6B35'
  const RJ = '#B91C1C'
  const AM = '#C07D10'
  const GR = '#6B7280'

  if (!token) return null

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff', display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:'Segoe UI, Arial, sans-serif' }}>
      <div style={{ textAlign:'center', color:AZ }}>
        <div style={{ fontSize:32, marginBottom:12 }}>⏳</div>
        <div style={{ fontSize:15 }}>Cargando su portal...</div>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff', display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:'Segoe UI, Arial, sans-serif' }}>
      <div style={{ textAlign:'center', background:'#fff', borderRadius:14,
        padding:40, maxWidth:380, boxShadow:'0 4px 24px #0001' }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:8, color:'#111' }}>Link no válido</div>
        <div style={{ color:GR, fontSize:14 }}>{error}</div>
        <div style={{ marginTop:20, fontSize:12, color:GR }}>
          Contacte a su administrador para obtener un nuevo link.
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff',
      fontFamily:'Segoe UI, Arial, sans-serif', paddingBottom:40 }}>
      <Head>
        <title>Portal Copropietario — {coprop?.apellido_nombre || 'GASP'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* Header */}
      <div style={{ background:AZ, color:'#fff', padding:'18px 20px' }}>
        <div style={{ maxWidth:640, margin:'0 auto' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:40, height:40, background:'rgba(255,255,255,0.15)',
              borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:18, fontWeight:900 }}>G</div>
            <div>
              <div style={{ fontSize:11, opacity:0.75, letterSpacing:'0.05em',
                textTransform:'uppercase' }}>Administración Pinamar</div>
              <div style={{ fontSize:16, fontWeight:700 }}>Portal del Copropietario</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:640, margin:'0 auto', padding:'20px 16px' }}>

        {/* Tarjeta de identidad */}
        <div style={{ background:'#fff', borderRadius:12, padding:20,
          marginBottom:16, boxShadow:'0 2px 12px #0001' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:13, color:GR, marginBottom:2 }}>Copropietario</div>
              <div style={{ fontWeight:700, fontSize:18, color:'#111' }}>
                {coprop?.apellido_nombre || '—'}
              </div>
              <div style={{ fontSize:13, color:GR, marginTop:4 }}>
                <span style={{ background:'#f0f4ff', color:AZ, borderRadius:6,
                  padding:'2px 10px', fontWeight:600 }}>
                  Unidad {unidad?.numero}
                </span>
                {unidad?.piso && unidad.piso !== 'LOC' && unidad.piso !== 'CO' &&
                  <span style={{ marginLeft:8 }}>Piso {unidad.piso}</span>}
                <span style={{ marginLeft:8, textTransform:'capitalize' }}>{unidad?.tipo}</span>
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:GR }}>Consorcio</div>
              <div style={{ fontWeight:600, fontSize:13, color:'#374151', maxWidth:160,
                textAlign:'right', lineHeight:1.3 }}>
                {consorcio?.nombre}
              </div>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
          {/* Deuda total */}
          <div style={{ background: deudaTotal > 0 ? '#fee2e2' : '#dcfce7',
            borderRadius:12, padding:18, textAlign:'center' }}>
            <div style={{ fontSize:11, color: deudaTotal > 0 ? RJ : VD,
              fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>
              {deudaTotal > 0 ? 'Deuda total' : 'Estado'}
            </div>
            <div style={{ fontSize:24, fontWeight:800, color: deudaTotal > 0 ? RJ : VD }}>
              {deudaTotal > 0 ? fmt(deudaTotal) : '✓ Al día'}
            </div>
          </div>

          {/* Último pago */}
          <div style={{ background:'#fff', borderRadius:12, padding:18,
            textAlign:'center', boxShadow:'0 2px 8px #0001' }}>
            <div style={{ fontSize:11, color:GR, fontWeight:600,
              textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>
              Último pago
            </div>
            {ultimoPago ? (
              <>
                <div style={{ fontSize:20, fontWeight:800, color:VD }}>
                  {fmt(ultimoPago.monto)}
                </div>
                <div style={{ fontSize:11, color:GR, marginTop:3 }}>
                  {fmtD(ultimoPago.fecha)}
                </div>
              </>
            ) : (
              <div style={{ fontSize:14, color:GR }}>Sin pagos</div>
            )}
          </div>
        </div>

        {/* Estado por período */}
        {detalles.length > 0 && (
          <div style={{ background:'#fff', borderRadius:12, padding:20,
            marginBottom:16, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#111', marginBottom:14 }}>
              Estado de cuenta
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {detalles.map(d => {
                const pagado  = parseFloat(d.pagos_periodo) || 0
                const salAnt  = parseFloat(d.saldo_anterior) || 0
                const monto   = parseFloat(d.monto) || 0
                const mora    = parseFloat(d.interes_mora) || 0
                const saldo   = Math.max(0, salAnt + monto + mora - pagado)
                const esPagada = d.estado === 'pagada'
                const esMorosa = d.estado === 'morosa'
                return (
                  <div key={d.id} style={{ border:'1px solid #e5e7eb', borderRadius:10,
                    padding:'12px 14px', background: esMorosa ? '#fff8f8' :
                    esPagada ? '#f0fdf4' : '#fffbeb' }}>
                    <div style={{ display:'flex', justifyContent:'space-between',
                      alignItems:'center', marginBottom:8 }}>
                      <div>
                        <span style={{ fontWeight:700, fontSize:14 }}>
                          {periodoLabel(d.con_expensas?.periodo)}
                        </span>
                        <span style={{ marginLeft:8, fontSize:10, padding:'2px 8px',
                          borderRadius:8, fontWeight:600,
                          background: esPagada ? '#dcfce7' : esMorosa ? '#fee2e2' : '#fef9c3',
                          color: esPagada ? VD : esMorosa ? RJ : AM }}>
                          {esPagada ? '✓ Pagada' : esMorosa ? 'Morosa' : 'Pendiente'}
                        </span>
                      </div>
                      <div style={{ fontWeight:800, fontSize:16,
                        color: esPagada ? VD : saldo > 0 ? RJ : GR }}>
                        {esPagada ? fmt(pagado) : fmt(saldo)}
                      </div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr',
                      gap:6, fontSize:12, color:GR }}>
                      <div>Expensa: <span style={{ color:'#374151', fontWeight:600 }}>{fmt(monto)}</span></div>
                      {salAnt > 0 && <div>Saldo ant.: <span style={{ color:RJ, fontWeight:600 }}>{fmt(salAnt)}</span></div>}
                      {mora > 0 && <div>Interés mora: <span style={{ color:AM, fontWeight:600 }}>{fmt(mora)}</span></div>}
                      {pagado > 0 && <div>Pagado: <span style={{ color:VD, fontWeight:600 }}>{fmt(pagado)}</span></div>}
                      {d.con_expensas?.fecha_vencimiento && (
                        <div>Vto.: <span style={{ color:'#374151' }}>{fmtD(d.con_expensas.fecha_vencimiento)}</span></div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Historial de pagos */}
        {cobranzas.length > 0 && (
          <div style={{ background:'#fff', borderRadius:12, padding:20,
            marginBottom:16, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#111', marginBottom:14 }}>
              Historial de pagos
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {cobranzas.map(c => (
                <div key={c.id} style={{ display:'flex', justifyContent:'space-between',
                  alignItems:'center', padding:'10px 0',
                  borderBottom:'1px solid #f3f4f6' }}>
                  <div>
                    <div style={{ fontWeight:600, fontSize:13 }}>
                      {periodoLabel(c.con_expensas?.periodo)}
                    </div>
                    <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                      {fmtD(c.fecha)}
                      {c.medio_pago && <span style={{ marginLeft:8,
                        textTransform:'capitalize' }}>{c.medio_pago}</span>}
                      {c.recibo_numero && <span style={{ marginLeft:8 }}>
                        Rec. {c.recibo_numero}</span>}
                    </div>
                  </div>
                  <div style={{ fontWeight:700, fontSize:15, color:VD }}>
                    {fmt(c.monto)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Datos de pago */}
        {consorcio?.cbu && (
          <div style={{ background:'#fff', borderRadius:12, padding:20,
            marginBottom:16, boxShadow:'0 2px 12px #0001',
            border:'1.5px solid #dbeafe' }}>
            <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:12 }}>
              💳 Cómo pagar
            </div>
            <div style={{ fontSize:13, color:'#374151', lineHeight:2 }}>
              <div><span style={{ color:GR }}>Titular:</span> <strong>{consorcio.nombre}</strong></div>
              <div><span style={{ color:GR }}>CBU:</span> <strong style={{ letterSpacing:'0.05em' }}>{consorcio.cbu}</strong></div>
              <div><span style={{ color:GR }}>Alias:</span> <strong>{consorcio.alias_cbu}</strong></div>
              <div><span style={{ color:GR }}>Banco:</span> {consorcio.banco} {consorcio.sucursal && `— ${consorcio.sucursal}`}</div>
            </div>
            <div style={{ marginTop:12, padding:'8px 12px', background:'#eff6ff',
              borderRadius:8, fontSize:11, color:'#1e40af' }}>
              ℹ️ Al transferir, incluya el importe exacto con centavos para
              una correcta acreditación.
            </div>
          </div>
        )}

        {/* Contacto administración */}
        {adminPerfil && (
          <div style={{ background:'#fff', borderRadius:12, padding:20,
            boxShadow:'0 2px 12px #0001' }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#111', marginBottom:12 }}>
              📞 Contacto
            </div>
            <div style={{ fontSize:13, color:'#374151', lineHeight:2 }}>
              <div><strong>{adminPerfil.nombre}</strong> — RPAC {adminPerfil.matricula_rpac}</div>
              {adminPerfil.direccion && <div>📍 {adminPerfil.direccion}</div>}
              {adminPerfil.telefono && (
                <div>📱 <a href={`tel:${adminPerfil.telefono}`}
                  style={{ color:AZ }}>{adminPerfil.telefono}</a></div>
              )}
              {adminPerfil.email && (
                <div>✉ <a href={`mailto:${adminPerfil.email}`}
                  style={{ color:AZ }}>{adminPerfil.email}</a></div>
              )}
              {adminPerfil.horario && (
                <div style={{ color:GR, fontSize:12 }}>🕐 {adminPerfil.horario}</div>
              )}
            </div>
          </div>
        )}

        <div style={{ textAlign:'center', marginTop:24, fontSize:11, color:GR }}>
          Portal generado por GASP Consorcios · administracionpinamar.com
        </div>
      </div>
    </div>
  )
}
