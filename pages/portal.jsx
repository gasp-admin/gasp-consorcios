// portal.jsx v3 — Portal del Copropietario GASP Consorcios
// Muestra planilla de liquidación completa al navegar a #liquidacion-YYYY-MM
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'
import { useRouter } from 'next/router'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const fmt  = n => '$' + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR') : '—'
const periodoLabel = p => {
  if (!p) return '—'
  const [y, m] = p.split('-')
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${meses[parseInt(m)-1]} ${y}`
}
const saldoDet = d => Math.max(0,
  (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0)
  + (parseFloat(d.interes_mora)||0) - (parseFloat(d.pagos_periodo)||0)
)

const AZ = '#1A3FA0', VD = '#1B6B35', RJ = '#B91C1C', AM = '#C07D10', GR = '#6B7280'

export default function Portal() {
  const router = useRouter()
  const { token } = router.query

  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [unidad, setUnidad]           = useState(null)
  const [coprop, setCoprop]           = useState(null)
  const [consorcio, setConsorcio]     = useState(null)
  const [detalles, setDetalles]       = useState([])
  const [cobranzas, setCobranzas]     = useState([])
  const [adminPerfil, setAdminPerfil] = useState(null)
  const [cuentaBanco, setCuentaBanco] = useState(null)
  const [tab, setTab]                 = useState('cuenta')
  // Planilla de liquidación expandida
  const [periodoExpandido, setPeriodoExpandido] = useState(null) // 'YYYY-MM' | null
  const [gastosPeriodo, setGastosPeriodo]       = useState([])
  const [loadingGastos, setLoadingGastos]       = useState(false)

  useEffect(() => { if (token) cargar(token) }, [token])

  // Leer hash al montar y cuando cambia loading
  useEffect(() => {
    if (loading || !token) return
    const hash = window.location.hash
    if (!hash) return
    if (hash === '#cuenta-corriente') { setTab('cuenta'); return }
    if (hash === '#pagos') { setTab('pagos'); return }
    if (hash.startsWith('#liquidacion-')) {
      const per = hash.replace('#liquidacion-', '')
      setTab('cuenta')
      expandirPeriodo(per)
    }
  }, [loading])

  async function cargar(tk) {
    setLoading(true)
    try {
      const { data: uf, error: e1 } = await supabase
        .from('con_unidades').select('*').eq('portal_token', tk).single()
      if (e1 || !uf) { setError('Link no válido o expirado.'); setLoading(false); return }
      setUnidad(uf)

      const [
        { data: cp }, { data: con }, { data: adm },
        { data: cuentas }, { data: dets }, { data: cobs }
      ] = await Promise.all([
        supabase.from('con_copropietarios').select('*').eq('id', uf.propietario_id).single(),
        supabase.from('con_consorcios').select('*').eq('id', uf.consorcio_id).single(),
        supabase.from('con_admin_perfil').select('*').eq('admin_id', uf.admin_id).single(),
        supabase.from('con_cuentas_banco').select('*')
          .eq('consorcio_id', uf.consorcio_id).eq('activa', true).limit(1),
        supabase.from('con_expensas_detalle').select(`
          id, expensa_id, monto, saldo_anterior, pagos_periodo, interes_mora, estado,
          con_expensas:expensa_id (id, periodo, fecha_vencimiento, estado, tipo, total_expensa, total_gastos)
        `).eq('unidad_id', uf.id).order('created_at', { ascending: false }).limit(24),
        supabase.from('con_cobranzas').select(`
          id, monto, fecha, medio_pago, recibo_numero, observaciones,
          con_expensas:expensa_id (periodo)
        `).eq('unidad_id', uf.id).order('fecha', { ascending: false }).limit(30),
      ])

      setCoprop(cp); setConsorcio(con); setAdminPerfil(adm)
      setCuentaBanco(cuentas?.[0] || null)
      // Filtrar detalles válidos
      setDetalles((dets||[]).filter(d =>
        (parseFloat(d.monto)||0) > 0 || (parseFloat(d.saldo_anterior)||0) > 0
      ))
      setCobranzas(cobs||[])
    } catch(e) { setError('Error al cargar. Intente nuevamente.') }
    setLoading(false)
  }

  // Cargar y expandir la planilla de un período específico
  async function expandirPeriodo(per) {
    setPeriodoExpandido(per)
    setLoadingGastos(true)
    // Buscar la expensa_id del período
    const det = detalles.find(d => d.con_expensas?.periodo === per)
    if (!det?.expensa_id) { setLoadingGastos(false); return }
    const { data: gastos } = await supabase.from('con_gastos')
      .select('categoria, concepto, monto, proveedor_nombre, comprobante')
      .eq('expensa_id', det.expensa_id)
      .order('categoria')
    setGastosPeriodo(gastos||[])
    setLoadingGastos(false)
    // Scroll al inicio de la planilla
    setTimeout(() => {
      const el = document.getElementById('planilla-liq')
      if (el) el.scrollIntoView({ behavior:'smooth', block:'start' })
    }, 100)
  }

  const detOrdenados = [...detalles].sort((a,b) =>
    (b.con_expensas?.periodo||'').localeCompare(a.con_expensas?.periodo||'')
  )
  const deudaReal = detOrdenados[0] ? saldoDet(detOrdenados[0]) : 0
  const estaAlDia = deudaReal === 0
  const ultimoPago = cobranzas[0] || null
  const cbu    = cuentaBanco?.cbu   || consorcio?.cbu   || null
  const alias  = cuentaBanco?.alias || consorcio?.alias_cbu || '—'
  const banco  = cuentaBanco?.banco || consorcio?.banco  || '—'

  if (!token) return null
  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff', display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:'Segoe UI,Arial,sans-serif' }}>
      <div style={{ textAlign:'center', color:AZ }}>
        <div style={{ fontSize:36, marginBottom:12 }}>⏳</div>
        <div>Cargando su portal...</div>
      </div>
    </div>
  )
  if (error) return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff', display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:'Segoe UI,Arial,sans-serif' }}>
      <div style={{ textAlign:'center', background:'#fff', borderRadius:14,
        padding:40, maxWidth:380, boxShadow:'0 4px 24px #0001' }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>Link no válido</div>
        <div style={{ color:GR, fontSize:14 }}>{error}</div>
        <div style={{ marginTop:20, fontSize:12, color:GR }}>
          Contacte a su administrador para obtener un nuevo link.
        </div>
      </div>
    </div>
  )

  // ── Planilla de liquidación expandida ──────────────────────────────────────
  const detExpandido = detOrdenados.find(d => d.con_expensas?.periodo === periodoExpandido)
  if (periodoExpandido && detExpandido) {
    const exp     = detExpandido.con_expensas || {}
    const salAnt  = parseFloat(detExpandido.saldo_anterior)||0
    const monto   = parseFloat(detExpandido.monto)||0
    const mora    = parseFloat(detExpandido.interes_mora)||0
    const pagado  = parseFloat(detExpandido.pagos_periodo)||0
    const saldo   = saldoDet(detExpandido)
    const esPag   = detExpandido.estado === 'pagada'
    const totalGastos = gastosPeriodo.reduce((a,g) => a + (parseFloat(g.monto)||0), 0)
    // Agrupar gastos por categoría
    const gastosPorCat = {}
    for (const g of gastosPeriodo) {
      const cat = g.categoria || 'varios'
      if (!gastosPorCat[cat]) gastosPorCat[cat] = []
      gastosPorCat[cat].push(g)
    }
    return (
      <div style={{ minHeight:'100vh', background:'#f0f4ff',
        fontFamily:'Segoe UI,Arial,sans-serif', paddingBottom:48 }}>
        <Head>
          <title>Liquidación {periodoLabel(periodoExpandido)} — {consorcio?.nombre}</title>
          <meta name="viewport" content="width=device-width,initial-scale=1" />
        </Head>
        {/* Header */}
        <div style={{ background:AZ, color:'#fff', padding:'14px 18px',
          position:'sticky', top:0, zIndex:10, boxShadow:'0 2px 8px #0003' }}>
          <div style={{ maxWidth:680, margin:'0 auto', display:'flex',
            alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <button onClick={() => setPeriodoExpandido(null)}
                style={{ background:'rgba(255,255,255,0.2)', border:'none', color:'#fff',
                  borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:13 }}>
                ← Volver
              </button>
              <div>
                <div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase' }}>
                  Liquidación
                </div>
                <div style={{ fontSize:15, fontWeight:700 }}>
                  {periodoLabel(periodoExpandido)} — {consorcio?.nombre}
                </div>
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, opacity:0.7 }}>Unidad</div>
              <div style={{ fontSize:20, fontWeight:800 }}>{unidad?.numero}</div>
            </div>
          </div>
        </div>

        <div id="planilla-liq" style={{ maxWidth:680, margin:'0 auto', padding:'16px 14px' }}>

          {/* Encabezado planilla */}
          <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
            marginBottom:14, boxShadow:'0 2px 12px #0001', borderLeft:`4px solid ${AZ}` }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:17, color:AZ }}>
                  📋 Liquidación {periodoLabel(periodoExpandido)}
                </div>
                <div style={{ fontSize:12, color:GR, marginTop:4 }}>
                  {consorcio?.nombre} · Unidad {unidad?.numero} · {coprop?.apellido_nombre}
                </div>
                {exp.fecha_vencimiento && (
                  <div style={{ fontSize:12, color:GR, marginTop:2 }}>
                    Vencimiento: <strong>{fmtD(exp.fecha_vencimiento)}</strong>
                  </div>
                )}
              </div>
              <div style={{ background: esPag ? '#dcfce7' : saldo > 0 ? '#fee2e2' : '#fef9c3',
                color: esPag ? VD : saldo > 0 ? RJ : AM,
                borderRadius:10, padding:'10px 18px', textAlign:'center', fontWeight:700 }}>
                <div style={{ fontSize:11, marginBottom:2 }}>
                  {esPag ? '✓ Pagada' : saldo > 0 ? 'Total a pagar' : 'Pendiente'}
                </div>
                <div style={{ fontSize:20 }}>{esPag ? '✓' : fmt(saldo)}</div>
              </div>
            </div>
          </div>

          {/* Tabla de composición de la expensa */}
          <div style={{ background:'#fff', borderRadius:14, overflow:'hidden',
            marginBottom:14, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ background:AZ, color:'#fff', padding:'10px 18px',
              fontWeight:700, fontSize:13 }}>
              Composición de su expensa
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <tbody>
                {salAnt > 0 && (
                  <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'11px 18px', color:GR }}>Saldo anterior</td>
                    <td style={{ padding:'11px 18px', textAlign:'right', color:RJ, fontWeight:600 }}>{fmt(salAnt)}</td>
                  </tr>
                )}
                <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                  <td style={{ padding:'11px 18px' }}>
                    Expensa {periodoLabel(periodoExpandido)}
                    <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                      Coef. fiscal: {Number(unidad?.porcentaje_fiscal||0).toFixed(4)}%
                    </div>
                  </td>
                  <td style={{ padding:'11px 18px', textAlign:'right', fontWeight:600 }}>{fmt(monto)}</td>
                </tr>
                {mora > 0 && (
                  <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'11px 18px', color:AM }}>Interés por mora</td>
                    <td style={{ padding:'11px 18px', textAlign:'right', color:AM, fontWeight:600 }}>{fmt(mora)}</td>
                  </tr>
                )}
                {pagado > 0 && (
                  <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'11px 18px', color:VD }}>Pagado</td>
                    <td style={{ padding:'11px 18px', textAlign:'right', color:VD, fontWeight:600 }}>− {fmt(pagado)}</td>
                  </tr>
                )}
                <tr style={{ background:'#f0f4ff', borderTop:`2px solid ${AZ}` }}>
                  <td style={{ padding:'13px 18px', fontWeight:700, color:AZ }}>Total</td>
                  <td style={{ padding:'13px 18px', textAlign:'right', fontWeight:800,
                    fontSize:17, color: esPag ? VD : saldo > 0 ? RJ : GR }}>
                    {esPag ? '✓ Pagada' : fmt(saldo)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Detalle de gastos del consorcio */}
          <div style={{ background:'#fff', borderRadius:14, overflow:'hidden',
            marginBottom:14, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ background:'#374151', color:'#fff', padding:'10px 18px',
              fontWeight:700, fontSize:13 }}>
              Gastos del consorcio — {periodoLabel(periodoExpandido)}
              {totalGastos > 0 && (
                <span style={{ float:'right', fontWeight:400, fontSize:12 }}>
                  Total: {fmt(totalGastos)}
                </span>
              )}
            </div>
            {loadingGastos ? (
              <div style={{ padding:24, textAlign:'center', color:GR }}>Cargando gastos...</div>
            ) : gastosPeriodo.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:GR, fontSize:13 }}>
                Sin gastos detallados para este período
              </div>
            ) : (
              <div>
                {Object.entries(gastosPorCat).map(([cat, gs]) => {
                  const subtotal = gs.reduce((a,g) => a + (parseFloat(g.monto)||0), 0)
                  return (
                    <div key={cat}>
                      <div style={{ background:'#eff6ff', padding:'7px 18px',
                        fontSize:11, fontWeight:700, color:AZ,
                        textTransform:'uppercase', letterSpacing:'0.04em',
                        display:'flex', justifyContent:'space-between' }}>
                        <span>{cat}</span>
                        <span>{fmt(subtotal)}</span>
                      </div>
                      {gs.map((g, i) => (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between',
                          alignItems:'center', padding:'9px 18px',
                          borderBottom:'1px solid #f3f4f6', fontSize:12 }}>
                          <div>
                            <div>{g.concepto}</div>
                            {g.proveedor_nombre && (
                              <div style={{ fontSize:11, color:GR }}>{g.proveedor_nombre}
                                {g.comprobante && ` · ${g.comprobante}`}
                              </div>
                            )}
                          </div>
                          <div style={{ fontWeight:600, whiteSpace:'nowrap', marginLeft:12 }}>
                            {fmt(parseFloat(g.monto)||0)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
                <div style={{ display:'flex', justifyContent:'space-between',
                  padding:'12px 18px', background:'#374151', color:'#fff', fontWeight:700 }}>
                  <span>TOTAL GASTOS CONSORCIO</span>
                  <span>{fmt(totalGastos)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Datos de pago */}
          {cbu && (
            <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
              marginBottom:14, border:`1.5px solid #dbeafe`, boxShadow:'0 2px 8px #0001' }}>
              <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:12 }}>
                💳 Cómo pagar
              </div>
              <div style={{ fontSize:13, color:'#374151', lineHeight:2 }}>
                <div><span style={{ color:GR }}>Titular:</span> <strong>{consorcio?.nombre}</strong></div>
                <div><span style={{ color:GR }}>CBU:</span>{' '}
                  <strong style={{ fontFamily:'monospace' }}>{cbu}</strong>
                </div>
                <div><span style={{ color:GR }}>Alias:</span> <strong>{alias}</strong></div>
                <div><span style={{ color:GR }}>Banco:</span> {banco}</div>
              </div>
              <div style={{ marginTop:10, padding:'8px 12px', background:'#eff6ff',
                borderRadius:8, fontSize:11, color:'#1e40af' }}>
                ℹ️ Incluya el importe exacto con centavos al transferir.
              </div>
            </div>
          )}

          {/* Botón volver */}
          <button onClick={() => { setPeriodoExpandido(null); setGastosPeriodo([]) }}
            style={{ width:'100%', padding:'13px', background:AZ, color:'#fff',
              border:'none', borderRadius:12, fontWeight:700, fontSize:14, cursor:'pointer' }}>
            ← Volver al portal
          </button>
        </div>
      </div>
    )
  }

  // ── Vista principal del portal ─────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#f0f4ff',
      fontFamily:'Segoe UI,Arial,sans-serif', paddingBottom:48 }}>
      <Head>
        <title>Portal — {coprop?.apellido_nombre || 'Copropietario'} · GASP</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>

      {/* Header */}
      <div style={{ background:AZ, color:'#fff', padding:'16px 18px',
        position:'sticky', top:0, zIndex:10, boxShadow:'0 2px 8px #0003' }}>
        <div style={{ maxWidth:680, margin:'0 auto', display:'flex',
          alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:36, height:36, background:'rgba(255,255,255,0.15)',
              borderRadius:8, display:'flex', alignItems:'center',
              justifyContent:'center', fontSize:16, fontWeight:900 }}>G</div>
            <div>
              <div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Administración Pinamar
              </div>
              <div style={{ fontSize:15, fontWeight:700 }}>Portal del Copropietario</div>
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:10, opacity:0.7 }}>Unidad</div>
            <div style={{ fontSize:20, fontWeight:800 }}>{unidad?.numero}</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:680, margin:'0 auto', padding:'16px 14px' }}>

        {/* Tarjeta identidad */}
        <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
          marginBottom:14, boxShadow:'0 2px 12px #0001', borderLeft:`4px solid ${AZ}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:2 }}>Copropietario</div>
              <div style={{ fontWeight:700, fontSize:17 }}>{coprop?.apellido_nombre || '—'}</div>
              <div style={{ fontSize:12, color:GR, marginTop:5, display:'flex', gap:8, flexWrap:'wrap' }}>
                <span style={{ background:'#f0f4ff', color:AZ, borderRadius:6,
                  padding:'2px 10px', fontWeight:600 }}>
                  Unidad {unidad?.numero}
                </span>
                <span style={{ textTransform:'capitalize' }}>{unidad?.tipo}</span>
                {unidad?.piso && <span>Piso {unidad.piso}</span>}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:GR }}>Consorcio</div>
              <div style={{ fontWeight:600, fontSize:12, color:'#374151', lineHeight:1.4, maxWidth:170 }}>
                {consorcio?.nombre}
              </div>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
          <div style={{ background: estaAlDia ? '#dcfce7' : '#fee2e2',
            borderRadius:14, padding:'16px 18px', textAlign:'center' }}>
            <div style={{ fontSize:10, color: estaAlDia ? VD : RJ, fontWeight:700,
              textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
              {estaAlDia ? 'Estado' : 'Saldo pendiente'}
            </div>
            <div style={{ fontSize:22, fontWeight:800, color: estaAlDia ? VD : RJ }}>
              {estaAlDia ? '✓ Al día' : fmt(deudaReal)}
            </div>
          </div>
          <div style={{ background:'#fff', borderRadius:14, padding:'16px 18px',
            textAlign:'center', boxShadow:'0 2px 8px #0001' }}>
            <div style={{ fontSize:10, color:GR, fontWeight:700,
              textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
              Último pago
            </div>
            {ultimoPago ? (
              <>
                <div style={{ fontSize:20, fontWeight:800, color:VD }}>{fmt(ultimoPago.monto)}</div>
                <div style={{ fontSize:11, color:GR, marginTop:2 }}>{fmtD(ultimoPago.fecha)}</div>
              </>
            ) : (
              <div style={{ fontSize:13, color:GR, marginTop:4 }}>Sin pagos</div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:14,
          background:'#fff', borderRadius:12, padding:4, boxShadow:'0 2px 8px #0001' }}>
          {[
            { id:'cuenta', label:'📋 Cuenta corriente' },
            { id:'pagos',  label:'💳 Pagos' },
            { id:'contacto', label:'📞 Contacto' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ flex:1, padding:'9px 6px', border:'none', cursor:'pointer',
                borderRadius:9, fontSize:12, fontWeight: tab===t.id ? 700 : 500,
                background: tab===t.id ? AZ : 'transparent',
                color: tab===t.id ? '#fff' : GR }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB: CUENTA CORRIENTE */}
        {tab === 'cuenta' && (
          <div id="cuenta-corriente">
            {detOrdenados.length === 0 ? (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>Sin movimientos registrados</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {detOrdenados.map((d, idx) => {
                  const s      = saldoDet(d)
                  const monto  = parseFloat(d.monto)||0
                  const salAnt = parseFloat(d.saldo_anterior)||0
                  const mora   = parseFloat(d.interes_mora)||0
                  const pagado = parseFloat(d.pagos_periodo)||0
                  const esPag  = d.estado === 'pagada'
                  const esMor  = d.estado === 'morosa'
                  const per    = d.con_expensas?.periodo || ''
                  return (
                    <div key={d.id} id={`liquidacion-${per}`}
                      style={{ background:'#fff', borderRadius:12,
                        border:`1.5px solid ${esPag ? '#86efac' : esMor ? '#fca5a5' : '#fde68a'}`,
                        overflow:'hidden', boxShadow:'0 1px 6px #0001' }}>
                      <div style={{ display:'flex', justifyContent:'space-between',
                        alignItems:'center', padding:'12px 16px',
                        background: esPag ? '#f0fdf4' : esMor ? '#fff5f5' : '#fffbeb' }}>
                        <div>
                          <span style={{ fontWeight:700, fontSize:15 }}>
                            {periodoLabel(per)}
                          </span>
                          <span style={{ marginLeft:8, fontSize:10, padding:'2px 9px',
                            borderRadius:8, fontWeight:700,
                            background: esPag ? '#dcfce7' : esMor ? '#fee2e2' : '#fef9c3',
                            color: esPag ? VD : esMor ? RJ : AM }}>
                            {esPag ? '✓ Pagada' : esMor ? 'Morosa' : 'Pendiente'}
                          </span>
                          {idx === 0 && (
                            <span style={{ marginLeft:6, fontSize:9, padding:'1px 7px',
                              borderRadius:6, background:AZ, color:'#fff', fontWeight:600 }}>
                              ACTUAL
                            </span>
                          )}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ fontWeight:800, fontSize:16,
                            color: esPag ? VD : s > 0 ? RJ : GR }}>
                            {esPag ? '✓' : fmt(s)}
                          </div>
                          {/* Botón ver liquidación completa */}
                          <button onClick={() => expandirPeriodo(per)}
                            style={{ background:AZ, color:'#fff', border:'none',
                              borderRadius:7, padding:'5px 11px', fontSize:11,
                              fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                            📋 Ver
                          </button>
                        </div>
                      </div>
                      <div style={{ padding:'10px 16px 14px',
                        display:'grid', gridTemplateColumns:'1fr 1fr',
                        gap:'6px 16px', fontSize:12, color:GR }}>
                        {monto > 0 && <div>Expensa: <strong style={{ color:'#374151' }}>{fmt(monto)}</strong></div>}
                        {salAnt > 0 && <div>Saldo ant.: <strong style={{ color:RJ }}>{fmt(salAnt)}</strong></div>}
                        {mora > 0 && <div>Interés mora: <strong style={{ color:AM }}>{fmt(mora)}</strong></div>}
                        {pagado > 0 && <div>Pagado: <strong style={{ color:VD }}>{fmt(pagado)}</strong></div>}
                        {d.con_expensas?.fecha_vencimiento && (
                          <div>Vto.: <strong style={{ color:'#374151' }}>{fmtD(d.con_expensas.fecha_vencimiento)}</strong></div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Datos de pago en cuenta corriente */}
            {cbu && (
              <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
                marginTop:14, border:`1.5px solid #dbeafe`, boxShadow:'0 2px 8px #0001' }}>
                <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:12 }}>
                  💳 Cómo pagar
                </div>
                <div style={{ fontSize:13, color:'#374151', lineHeight:2 }}>
                  <div><span style={{ color:GR }}>Titular:</span> <strong>{consorcio?.nombre}</strong></div>
                  <div><span style={{ color:GR }}>CBU:</span>{' '}
                    <strong style={{ fontFamily:'monospace' }}>{cbu}</strong>
                  </div>
                  <div><span style={{ color:GR }}>Alias:</span> <strong>{alias}</strong></div>
                  <div><span style={{ color:GR }}>Banco:</span> {banco}</div>
                </div>
                <div style={{ marginTop:10, padding:'8px 12px', background:'#eff6ff',
                  borderRadius:8, fontSize:11, color:'#1e40af' }}>
                  ℹ️ Incluya el importe exacto con centavos al transferir.
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: PAGOS */}
        {tab === 'pagos' && (
          <div id="pagos">
            {cobranzas.length === 0 ? (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>
                <div style={{ fontSize:28, marginBottom:8 }}>💳</div>
                <div>Sin pagos registrados</div>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
                boxShadow:'0 2px 12px #0001' }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>
                  Historial de pagos
                </div>
                {cobranzas.map((c, i) => (
                  <div key={c.id} style={{ display:'flex', justifyContent:'space-between',
                    alignItems:'center', padding:'11px 0',
                    borderBottom: i < cobranzas.length-1 ? '1px solid #f3f4f6' : 'none' }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:13 }}>
                        {periodoLabel(c.con_expensas?.periodo)}
                      </div>
                      <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                        {fmtD(c.fecha)}
                        {c.medio_pago && <span style={{ marginLeft:8, textTransform:'capitalize' }}>· {c.medio_pago}</span>}
                        {c.recibo_numero && <span style={{ marginLeft:6 }}>· Rec. {c.recibo_numero}</span>}
                      </div>
                      {c.observaciones && <div style={{ fontSize:11, color:GR }}>{c.observaciones}</div>}
                    </div>
                    <div style={{ fontWeight:800, fontSize:16, color:VD }}>{fmt(c.monto)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: CONTACTO */}
        {tab === 'contacto' && (
          <div>
            {adminPerfil ? (
              <div style={{ background:'#fff', borderRadius:14, padding:20,
                boxShadow:'0 2px 12px #0001' }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>📞 Administración</div>
                <div style={{ display:'flex', flexDirection:'column', gap:12, fontSize:14 }}>
                  <div style={{ fontWeight:700, fontSize:15 }}>
                    {adminPerfil.nombre}
                    {adminPerfil.matricula_rpac && (
                      <span style={{ marginLeft:8, fontSize:12, color:GR, fontWeight:400 }}>
                        RPAC N° {adminPerfil.matricula_rpac}
                      </span>
                    )}
                  </div>
                  {adminPerfil.direccion && <div style={{ color:GR }}>📍 {adminPerfil.direccion}</div>}
                  {adminPerfil.telefono && (
                    <a href={`tel:${adminPerfil.telefono}`}
                      style={{ color:AZ, textDecoration:'none', fontWeight:600, display:'block',
                        background:'#eff6ff', padding:'10px 14px', borderRadius:8 }}>
                      📱 {adminPerfil.telefono}
                    </a>
                  )}
                  {adminPerfil.telefono && (
                    <a href={`https://wa.me/${adminPerfil.telefono?.replace(/\D/g,'')}`}
                      target="_blank" rel="noopener"
                      style={{ color:'#fff', textDecoration:'none', display:'block',
                        background:'#25D366', padding:'10px 16px', borderRadius:8,
                        fontWeight:700, textAlign:'center' }}>
                      💬 Contactar por WhatsApp
                    </a>
                  )}
                  {adminPerfil.email && (
                    <a href={`mailto:${adminPerfil.email}`}
                      style={{ color:AZ, textDecoration:'none', fontWeight:600 }}>
                      ✉ {adminPerfil.email}
                    </a>
                  )}
                  {adminPerfil.horario && (
                    <div style={{ fontSize:12, color:GR, background:'#f9fafb',
                      padding:'8px 12px', borderRadius:8 }}>
                      🕐 {adminPerfil.horario}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>Sin datos de contacto</div>
            )}
          </div>
        )}

        <div style={{ textAlign:'center', marginTop:28, fontSize:10, color:GR }}>
          Portal del copropietario · GASP Consorcios · administracionpinamar.com
        </div>
      </div>
    </div>
  )
}
