// portal.jsx v5 — Portal del Copropietario GASP Consorcios
// NUEVO v5: Sección "📁 Documentación del consorcio" con link a carpeta Drive
// + Tab "Documentos" con acceso directo y descripción de contenidos disponibles
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { generarPDFLiquidacion } from '../lib/exportPdf'

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


function Reclamo({ unidadId, copropietarioId, consorcioId, adminEmail }) {
  const [asunto, setAsunto]   = useState('')
  const [detalle, setDetalle] = useState('')
  const [tipo, setTipo]       = useState('reclamo')
  const [enviado, setEnviado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg]         = useState(null)

  const TIPOS = [
    ['reclamo',    '🔧 Reclamo técnico'],
    ['consulta',   '❓ Consulta administrativa'],
    ['expensa',    '💳 Consulta sobre expensas'],
    ['ruido',      '🔊 Ruidos/molestias'],
    ['otro',       '📝 Otro'],
  ]

  const enviar = async () => {
    if (!asunto.trim() || !detalle.trim()) return setMsg('Completá el asunto y el detalle')
    setEnviando(true)
    try {
      const { error } = await supabase.from('con_reclamos').insert([{
        consorcio_id: consorcioId,
        copropietario_id: copropietarioId,
        unidad_id: unidadId,
        tipo, asunto, descripcion: detalle,
        estado: 'abierto',
        created_at: new Date().toISOString(),
      }])
      if (error) throw error
      setEnviado(true)
      setAsunto(''); setDetalle(''); setMsg(null)
    } catch (e) {
      setMsg('Error al enviar. Intentá de nuevo.')
    }
    setEnviando(false)
  }

  if (enviado) return (
    <div style={{ textAlign:'center', padding:'24px 0' }}>
      <div style={{ fontSize:36, marginBottom:8 }}>✅</div>
      <div style={{ fontWeight:700, marginBottom:6 }}>Reclamo enviado</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>El administrador recibirá tu reclamo y te contactará a la brevedad.</div>
      <button onClick={() => setEnviado(false)}
        style={{ padding:'8px 20px', background:AZ, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600 }}>
        Enviar otro
      </button>
    </div>
  )

  return (
    <div>
      {msg && <div style={{ padding:'8px 12px', background:'#fef2f2', borderRadius:8, fontSize:12, color:RJ, marginBottom:12 }}>{msg}</div>}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Tipo de consulta</div>
        <select value={tipo} onChange={e => setTipo(e.target.value)}
          style={{ width:'100%', padding:'10px', border:'1px solid #d1d5db', borderRadius:8, fontSize:13 }}>
          {TIPOS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Asunto</div>
        <input value={asunto} onChange={e => setAsunto(e.target.value)}
          placeholder="Describí brevemente el problema"
          style={{ width:'100%', padding:'10px', border:'1px solid #d1d5db', borderRadius:8, fontSize:13, boxSizing:'border-box' }}/>
      </div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Detalle</div>
        <textarea value={detalle} onChange={e => setDetalle(e.target.value)} rows={4}
          placeholder="Describí el problema con el mayor detalle posible..."
          style={{ width:'100%', padding:'10px', border:'1px solid #d1d5db', borderRadius:8, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }}/>
      </div>
      <button onClick={enviar} disabled={enviando || !asunto.trim() || !detalle.trim()}
        style={{ width:'100%', padding:'12px', background:AZ, color:'#fff', border:'none', borderRadius:8,
          cursor: enviando||!asunto.trim()||!detalle.trim() ? 'not-allowed' : 'pointer',
          opacity: enviando||!asunto.trim()||!detalle.trim() ? 0.5 : 1,
          fontWeight:700, fontSize:14 }}>
        {enviando ? '⏳ Enviando...' : '📤 Enviar reclamo'}
      </button>
    </div>
  )
}


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
  const [periodoExpandido, setPeriodoExpandido] = useState(null)
  const [gastosPeriodo, setGastosPeriodo]       = useState([])
  const [loadingGastos, setLoadingGastos]       = useState(false)
  // Cta cte y pago
  const [movsCta, setMovsCta]             = useState([])
  const [loadingCta, setLoadingCta]       = useState(false)
  const [formPago, setFormPago]           = useState(null)
  const [msgPago, setMsgPago]             = useState(null)
  const [enviandoPago, setEnviandoPago]   = useState(false)

  useEffect(() => { if (token) cargar(token) }, [token])

  useEffect(() => {
    if (loading || !token) return
    const hash = window.location.hash
    if (!hash) return
    if (hash === '#cuenta-corriente') { setTab('cuenta'); return }
    if (hash === '#pagos') { setTab('pagos'); return }
    if (hash === '#documentos') { setTab('documentos'); return }
    if (hash.startsWith('#recibo-')) { setTab('pagos'); return }
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
        `).eq('unidad_id', uf.id).in('estado',['vigente','acreditado','cobrado']).order('fecha', { ascending: false }).limit(30),
      ])

      setCoprop(cp); setConsorcio(con); setAdminPerfil(adm)
      setCuentaBanco(cuentas?.[0] || null)
      setDetalles((dets||[]).filter(d =>
        (parseFloat(d.monto)||0) > 0 || (parseFloat(d.saldo_anterior)||0) > 0
      ))
      setCobranzas(cobs||[])
    } catch(e) { setError('Error al cargar. Intente nuevamente.') }
    setLoading(false)
  }

  const [todosDetalles, setTodosDetalles]   = useState([])
  const [todasUnidades, setTodasUnidades]   = useState([])
  const [todosCoprop, setTodosCoprop]       = useState([])
  const [generandoPDF, setGenerandoPDF]     = useState(false)
  const [expensaActual, setExpensaActual]   = useState(null)

  async function expandirPeriodo(per) {
    setPeriodoExpandido(per)
    setLoadingGastos(true)
    const det = detalles.find(d => d.con_expensas?.periodo === per)
    const expId = det?.expensa_id
    if (!expId) { setLoadingGastos(false); return }
    const [
      { data: gastos }, { data: todsDets }, { data: todsUfs },
      { data: todsCps }, { data: expData }
    ] = await Promise.all([
      supabase.from('con_gastos')
        .select('categoria, concepto, monto, proveedor_nombre, comprobante')
        .eq('expensa_id', expId).order('categoria'),
      supabase.from('con_expensas_detalle').select('*').eq('expensa_id', expId),
      supabase.from('con_unidades').select('*').eq('consorcio_id', unidad.consorcio_id),
      supabase.from('con_copropietarios').select('*').eq('consorcio_id', unidad.consorcio_id),
      supabase.from('con_expensas').select('*').eq('id', expId).single(),
    ])
    setGastosPeriodo(gastos||[])
    setTodosDetalles(todsDets||[])
    setTodasUnidades(todsUfs||[])
    setTodosCoprop(todsCps||[])
    setExpensaActual(expData||null)
    setLoadingGastos(false)
    setTimeout(() => {
      const el = document.getElementById('planilla-liq')
      if (el) el.scrollIntoView({ behavior:'smooth', block:'start' })
    }, 100)
  }

  async function abrirPDFCompleto() {
    if (!expensaActual || !consorcio) return
    setGenerandoPDF(true)
    try {
      // Para consorcios históricos, cargar todos los lufs del período para el PDF
      let lufsHist = []
      if (consorcio.modelo_cc === 'historico' && expensaActual?.periodo) {
        const { data: lufsData } = await supabase
          .from('con_liquidacion_uf')
          .select('unidad_id, total_uf, saldo_anterior, pagos, deuda, interes, expensa_calculada, ajustes')
          .eq('consorcio_id', consorcio.id)
          .eq('periodo', expensaActual.periodo)
        lufsHist = lufsData || []
      }
      generarPDFLiquidacion({
        consorcioActivo: consorcio,
        expensa: expensaActual,
        gastos: gastosPeriodo,
        detalles: todosDetalles,
        unidades: todasUnidades,
        copropietarios: todosCoprop,
        adminPerfil: adminPerfil || {},
        lufsHist,
      })
    } catch(e) { alert('Error al generar PDF: ' + e.message) }
    setGenerandoPDF(false)
  }

  // Recibo de pago con el formato del sistema (Ley 14.701), accesible desde el portal.
  function generarReciboCob(cob) {
    if (!cob) return
    const uf = unidad, cp = coprop, con = consorcio || {}, adm = adminPerfil || {}
    const fecha = cob.fecha ? new Date(cob.fecha+'T00:00:00').toLocaleDateString('es-AR') : '\u2014'
    const monto = '$' + Number(cob.monto||0).toLocaleString('es-AR', { minimumFractionDigits:2 })
    const periodo = periodoLabel(cob.con_expensas?.periodo)
    const nroRecibo = cob.recibo_numero || String(cob.id).slice(-8).toUpperCase()
    const logoTag = adm.sello_url ? `<img src="${adm.sello_url}" style="max-height:44px;max-width:92px;object-fit:contain;background:#fff;border-radius:4px;padding:2px" />` : ''
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Recibo ${nroRecibo}</title><style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;color:#111}
.recibo{width:180mm;margin:8mm auto;padding:8mm;border:2px solid #1A3FA0;border-radius:6px}
.header{background:#1A3FA0;color:#fff;padding:10px 14px;border-radius:4px 4px 0 0;margin:-8mm -8mm 12px -8mm;display:flex;justify-content:space-between;align-items:center;gap:12px}
.header h1{font-size:16px;font-weight:700}.header p{font-size:11px;opacity:.85;margin-top:2px}
.nro{text-align:right}.nro span{font-size:22px;font-weight:800;display:block}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb}
.label{color:#6B7280;font-size:11px}.value{font-weight:600}
.monto-box{background:#f0fdf4;border:2px solid #86efac;border-radius:8px;padding:14px;text-align:center;margin:16px 0}
.monto-box .monto{font-size:28px;font-weight:800;color:#1B6B35}
.badge{display:inline-block;background:#dcfce7;color:#166534;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600}
.firma{margin-top:24px;border-top:1px solid #374151;padding-top:8px;text-align:center;font-size:11px;color:#374151}
@media print{body{-webkit-print-color-adjust:exact}}
</style></head><body><div class="recibo">
<div class="header"><div style="display:flex;align-items:center;gap:12px">${logoTag}<div><h1>RECIBO DE PAGO DE EXPENSAS</h1><p>Ley Provincial 14.701 \u2014 Provincia de Buenos Aires</p></div></div><div class="nro"><span>N\u00b0 ${nroRecibo}</span><div style="font-size:11px;opacity:.8">Comprobante</div></div></div>
<div class="row"><span class="label">Consorcio</span><span class="value">${con.nombre || '\u2014'}</span></div>
<div class="row"><span class="label">Unidad Funcional</span><span class="value">UF ${uf?.numero || '?'} \u2014 ${uf?.tipo || ''}</span></div>
<div class="row"><span class="label">Copropietario</span><span class="value">${cp?.apellido_nombre || '\u2014'}</span></div>
<div class="row"><span class="label">Per\u00edodo</span><span class="value">${periodo}</span></div>
<div class="row"><span class="label">Fecha de pago</span><span class="value">${fecha}</span></div>
<div class="row"><span class="label">Medio de pago</span><span class="value">${(cob.medio_pago || 'transferencia').replace(/_/g,' ')}</span></div>
<div class="monto-box"><div class="monto">${monto}</div><div class="label" style="color:#166534;font-size:12px;margin-top:4px">Importe recibido \u2014 <span class="badge">\u2713 Pago registrado</span></div>
<div style="margin-top:10px;display:flex;align-items:center;justify-content:center;gap:12px"><img src="https://api.qrserver.com/v1/create-qr-code/?size=70x70&data=GASP-REC-${nroRecibo}-${encodeURIComponent(con.nombre||'')}-${encodeURIComponent(periodo)}" alt="QR" style="width:70px;height:70px" /><div style="text-align:left;font-size:9px;color:#374151"><div style="font-weight:600;margin-bottom:2px">C\u00f3digo de verificaci\u00f3n</div><div>${nroRecibo}</div></div></div></div>
<div class="row"><span class="label">Registrado por</span><span class="value">Administraci\u00f3n de Consorcios Pinamar</span></div>
<div class="firma"><strong>${adm.nombre || 'Javier Garc\u00eda P\u00e9rez'}</strong> \u2014 Administrador de Consorcios \u2014 RPAC Mat. N\u00b0 ${adm.matricula_rpac || '83'}<br/>Pinamar, Provincia de Buenos Aires<br/><span style="font-size:10px;color:#9ca3af">Comprobante emitido por GASP Consorcios \u2014 ${new Date().toLocaleString('es-AR')}</span></div>
</div></body></html>`
    const win = window.open('', '_blank', 'width=820,height=720')
    if (!win) { alert('Habilite las ventanas emergentes para descargar el recibo.'); return }
    win.document.write(html); win.document.close()
    win.onload = () => { win.focus(); win.print() }
  }

  async function cargarCtaCte(ufId, consorcioId) {
    setLoadingCta(true)
    const [{ data: dets2 }, { data: cobs2 }, { data: lufs }] = await Promise.all([
      supabase.from('con_expensas_detalle').select('*,con_expensas:expensa_id(periodo,fecha_vencimiento)')
        .eq('unidad_id', ufId).order('created_at', { ascending: true }),
      supabase.from('con_cobranzas').select('*,con_expensas:expensa_id(periodo)')
        .eq('unidad_id', ufId).in('estado',['vigente','acreditado','cobrado']).order('fecha', { ascending: true }),
      supabase.from('con_liquidacion_uf').select('*')
        .eq('unidad_id', ufId).order('periodo', { ascending: true }),
    ])
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    const pl = (per) => { if(!per) return ''; const [y,m]=per.split('-'); return `${meses[parseInt(m)-1]} ${y}` }
    const lineas = []

    const lufsOrd = [...(lufs||[])].sort((a,b)=>(a.periodo||'').localeCompare(b.periodo||''))
    const tieneHistoricos = (consorcio?.modelo_cc === 'historico' || consorcio?.modelo_cc === 'mixto') && lufsOrd.length > 0

    if (tieneHistoricos && lufsOrd.length > 0) {
      // Modelo histórico: ajuste de convergencia para que el saldo coincida
      // exactamente con total_uf del PDF en cada período
      const primerLuf = lufsOrd[0]
      const primerSA = parseFloat(primerLuf.saldo_anterior)||0
      if (primerSA > 0) {
        lineas.push({ fecha: primerLuf.periodo+'-01', tipo:'debito',
          concepto:`Deuda anterior al ${pl(primerLuf.periodo)}`,
          monto: primerSA })
      } else if (primerSA < 0) {
        lineas.push({ fecha: primerLuf.periodo+'-01', tipo:'credito',
          concepto:`Saldo a favor al ${pl(primerLuf.periodo)}`,
          monto: Math.abs(primerSA) })
      }
      let accHist = primerSA
      for (const luf of lufsOrd) {
        const per    = luf.periodo||''
        const exp    = parseFloat(luf.expensa_calculada)||0
        const intM   = parseFloat(luf.interes)||0
        const pagos  = parseFloat(luf.pagos)||0
        const tuf    = parseFloat(luf.total_uf)
        const fDeb   = per ? per+'-10' : ''
        const fCob   = per ? per+'-28' : ''
        if (exp > 0)  { lineas.push({fecha:fDeb,tipo:'debito', concepto:`Expensa ${pl(per)}`,monto:exp}); accHist+=exp }
        if (intM > 0) { lineas.push({fecha:fDeb,tipo:'debito', concepto:`Interés mora — ${pl(per)}`,monto:intM}); accHist+=intM }
        if (pagos > 0){ lineas.push({fecha:fCob,tipo:'credito',concepto:`Pago ${pl(per)}`,monto:pagos}); accHist-=pagos }
        // Ajuste de convergencia: forzar saldo = total_uf del PDF
        const conv = tuf - accHist
        if (Math.abs(conv) > 0.04) {
          lineas.push({ fecha:fDeb, tipo: conv>0?'debito':'credito',
            concepto:`Ajuste liquidación ${pl(per)}`, monto:Math.abs(conv) })
          accHist = tuf
        }
      }
      // Cobranzas no-históricas (período abierto)
      for (const c of (cobs2||[])) {
        if (!c.id?.startsWith('COB-HIST-')) {
          lineas.push({fecha:c.fecha,tipo:'credito',
            concepto:`Pago ${pl(c.con_expensas?.periodo)}${c.medio_pago?' ('+c.medio_pago+')':''}`,
            monto:parseFloat(c.monto)||0,nro:c.recibo_numero})
        }
      }
      // Expensas del período abierto (DET no históricos)
      const detsOrd2 = [...(dets2||[])].sort((a,b)=>(a.con_expensas?.periodo||'').localeCompare(b.con_expensas?.periodo||''))
      for (const d of detsOrd2) {
        if (d.id?.startsWith('DET-HIST-') || d.id?.includes('-HIST-')) continue
        const per   = d.con_expensas?.periodo||''
        const monto = parseFloat(d.monto)||0
        const intM2 = parseFloat(d.interes_mora)||0
        const fDeb2 = d.con_expensas?.fecha_vencimiento||(per?per+'-10':d.created_at?.split('T')[0])
        if (monto > 0)  lineas.push({fecha:fDeb2,tipo:'debito',concepto:`Expensa ${pl(per)}`,monto})
        if (intM2 > 0)  lineas.push({fecha:fDeb2,tipo:'debito',concepto:`Interés mora — ${pl(per)}`,monto:intM2})
      }
    } else {
      // Modelo normal (sin históricos)
      const detsOrd = [...(dets2||[])].sort((a,b)=>(a.con_expensas?.periodo||'').localeCompare(b.con_expensas?.periodo||''))
      const primerHistId = detsOrd.find(d=>d.id?.startsWith('DET-HIST-'))?.id
      for (const d of detsOrd) {
        const per=d.con_expensas?.periodo||''; const saldoAnt=parseFloat(d.saldo_anterior)||0
        const monto=parseFloat(d.monto)||0; const intMora=parseFloat(d.interes_mora)||0
        const esHist=d.id?.startsWith('DET-HIST-')
        const fechaDeb=d.con_expensas?.fecha_vencimiento||(per?per+'-10':d.created_at?.split('T')[0])
        const mostrarAnt=saldoAnt>0&&(!esHist||d.id===primerHistId)
        if(mostrarAnt) lineas.push({fecha:per?per+'-01':fechaDeb,tipo:'debito',concepto:esHist?'Saldo al inicio del período histórico':`Saldo anterior ${pl(per)}`,monto:saldoAnt})
        if(monto>0) lineas.push({fecha:fechaDeb,tipo:'debito',concepto:`Expensa ${pl(per)}`,monto,vto:d.con_expensas?.fecha_vencimiento})
        if(intMora>0) lineas.push({fecha:fechaDeb,tipo:'debito',concepto:`Interés mora ${pl(per)}`,monto:intMora})
      }
      for (const c of (cobs2||[])) {
        lineas.push({fecha:c.fecha,tipo:'credito',concepto:`Pago ${pl(c.con_expensas?.periodo)}${c.medio_pago?' ('+c.medio_pago+')':''}`,monto:parseFloat(c.monto)||0,nro:c.recibo_numero})
      }
    }

    lineas.sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||''))
    let acc=0
    const conSaldo=lineas.map(l=>{ if(l.tipo==='debito') acc+=l.monto; else acc-=l.monto; return{...l,saldo:acc}})
    setMovsCta(conSaldo)
    setLoadingCta(false)
  }

  async function enviarNotificacionPago() {
    if (!formPago || !formPago.monto || !formPago.fecha) {
      return setMsgPago({ tipo:'warn', texto:'Complete monto y fecha del pago.' })
    }
    setEnviandoPago(true)
    try {
      // Insertar aviso en con_reclamos (con tipo especial de pago)
      const { error } = await supabase.from('con_reclamos').insert([{
        id: 'PAY-' + Date.now(),
        admin_id: unidad?.admin_id,
        consorcio_id: unidad?.consorcio_id,
        unidad_id: unidad?.id,
        copropietario_id: coprop?.id,
        tipo: 'pago_informado',
        asunto: `Aviso de pago — ${coprop?.apellido_nombre}`,
        descripcion: `PAGO INFORMADO POR PROPIETARIO:\nMonto: $${formPago.monto}\nFecha: ${formPago.fecha}\nMedio: ${formPago.medio||'No especificado'}\nComprobante: ${formPago.comprobante||'Sin comprobante adjunto'}\nObservaciones: ${formPago.obs||'—'}`,
        estado: 'abierto',
        prioridad: 'normal',
      }])
      if (error) throw error
      setMsgPago({ tipo:'ok', texto:'✓ Aviso enviado al administrador. Se verificará su pago a la brevedad.' })
      setFormPago(null)
    } catch(e) {
      setMsgPago({ tipo:'error', texto:'Error al enviar: ' + e.message })
    }
    setEnviandoPago(false)
  }

  const fmtD2 = d => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'

  const detOrdenados = [...detalles].sort((a,b) =>
    (b.con_expensas?.periodo||'').localeCompare(a.con_expensas?.periodo||'')
  )
  const deudaReal = detOrdenados[0] ? saldoDet(detOrdenados[0]) : 0
  const estaAlDia = deudaReal === 0
  const ultimoPago = cobranzas[0] || null
  const cbu    = cuentaBanco?.cbu   || consorcio?.cbu   || null
  const alias  = cuentaBanco?.alias || consorcio?.alias_cbu || '—'
  const banco  = cuentaBanco?.banco || consorcio?.banco  || '—'

  // ── Drive ──────────────────────────────────────────────────────────────────
  const driveFolderUrl = consorcio?.drive_folder_url || null

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
                <div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase' }}>Liquidación</div>
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

          <div style={{ background:'#fff', borderRadius:14, overflow:'hidden',
            marginBottom:14, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ background:AZ, color:'#fff', padding:'10px 18px', fontWeight:700, fontSize:13 }}>
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

          <div style={{ background:'#fff', borderRadius:14, overflow:'hidden',
            marginBottom:14, boxShadow:'0 2px 12px #0001' }}>
            <div style={{ background:'#374151', color:'#fff', padding:'10px 18px', fontWeight:700, fontSize:13 }}>
              Gastos del consorcio — {periodoLabel(periodoExpandido)}
              {totalGastos > 0 && (
                <span style={{ float:'right', fontWeight:400, fontSize:12 }}>Total: {fmt(totalGastos)}</span>
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
                        fontSize:11, fontWeight:700, color:AZ, textTransform:'uppercase',
                        letterSpacing:'0.04em', display:'flex', justifyContent:'space-between' }}>
                        <span>{cat}</span><span>{fmt(subtotal)}</span>
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

          {cbu && (
            <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
              marginBottom:14, border:`1.5px solid #dbeafe`, boxShadow:'0 2px 8px #0001' }}>
              <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:12 }}>💳 Cómo pagar</div>
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

          <button onClick={abrirPDFCompleto} disabled={generandoPDF || loadingGastos}
            style={{ width:'100%', padding:'13px', background:'#374151', color:'#fff',
              border:'none', borderRadius:12, fontWeight:700, fontSize:14,
              cursor:'pointer', marginBottom:10 }}>
            {generandoPDF ? '⏳ Generando...' : '📄 Ver planilla completa PDF (imprimible)'}
          </button>

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

        {/* ── ACCESO RÁPIDO DRIVE (si existe) ── */}
        {driveFolderUrl && (
          <a href={driveFolderUrl} target="_blank" rel="noreferrer"
            style={{ display:'flex', alignItems:'center', gap:14, padding:'16px 20px',
              background:'linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)',
              border:'1.5px solid #86efac', borderRadius:14, marginBottom:14,
              textDecoration:'none', boxShadow:'0 2px 8px #0001' }}>
            <div style={{ width:44, height:44, background:'#16a34a', borderRadius:10,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:22, flexShrink:0 }}>
              📁
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:14, color:'#14532d' }}>
                Documentación del consorcio
              </div>
              <div style={{ fontSize:12, color:'#166534', marginTop:2, lineHeight:1.4 }}>
                Acceda al reglamento de propiedad, planos, actas de asamblea y liquidaciones históricas
              </div>
            </div>
            <div style={{ color:'#16a34a', fontSize:20, fontWeight:700 }}>›</div>
          </a>
        )}

        {/* Tabs — incluye "Documentos" si hay Drive */}
        <div style={{ display:'flex', gap:4, marginBottom:14,
          background:'#fff', borderRadius:12, padding:4, boxShadow:'0 2px 8px #0001',
          overflowX:'auto' }}>
          {[
            { id:'cuenta',    label:'📋 Expensas' },
            { id:'ctacte',    label:'📊 Cta. corriente' },
            { id:'pagos',     label:'💳 Pagos' },
            { id:'informar',  label:'📤 Informar pago' },
            ...(driveFolderUrl ? [{ id:'documentos', label:'📁 Documentos' }] : []),
            { id:'reclamos',  label:'🎫 Reclamos' },
            { id:'contacto',  label:'📞 Contacto' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ flex:'1 0 auto', padding:'9px 8px', border:'none', cursor:'pointer',
                borderRadius:9, fontSize:12, fontWeight: tab===t.id ? 700 : 500,
                background: tab===t.id ? AZ : 'transparent',
                color: tab===t.id ? '#fff' : GR, whiteSpace:'nowrap' }}>
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

            {cbu && (
              <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px',
                marginTop:14, border:`1.5px solid #dbeafe`, boxShadow:'0 2px 8px #0001' }}>
                <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:12 }}>💳 Cómo pagar</div>
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

        {/* TAB: CUENTA CORRIENTE */}
        {tab === 'ctacte' && (
          <div id="cta-corriente">
            {loadingCta ? (
              <div style={{ textAlign:'center', padding:32, color:GR }}>⏳ Cargando...</div>
            ) : movsCta.length === 0 ? (
              <div style={{ background:'#fff', borderRadius:14, padding:32, textAlign:'center', color:GR }}>
                <div style={{ fontSize:28, marginBottom:8 }}>📊</div>
                <button onClick={() => cargarCtaCte(unidad.id, unidad.consorcio_id)}
                  style={{ background:AZ, color:'#fff', border:'none', borderRadius:9,
                    padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Cargar cuenta corriente
                </button>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:'18px 20px', boxShadow:'0 2px 12px #0001' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                  <div style={{ fontWeight:700, fontSize:14 }}>📊 Cuenta corriente</div>
                  <div style={{ fontWeight:800, fontSize:15,
                    color: movsCta[movsCta.length-1]?.saldo > 0 ? RJ : VD }}>
                    Saldo: {movsCta[movsCta.length-1]?.saldo > 0
                      ? `Debe ${fmt(movsCta[movsCta.length-1].saldo)}`
                      : movsCta[movsCta.length-1]?.saldo < 0
                        ? `A favor ${fmt(Math.abs(movsCta[movsCta.length-1].saldo))}`
                        : 'Al día ✓'}
                  </div>
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ background:'#f3f4f6', textAlign:'left' }}>
                        <th style={{ padding:'7px 10px', fontWeight:600 }}>Fecha</th>
                        <th style={{ padding:'7px 10px', fontWeight:600 }}>Concepto</th>
                        <th style={{ padding:'7px 10px', textAlign:'right', fontWeight:600 }}>Débito</th>
                        <th style={{ padding:'7px 10px', textAlign:'right', fontWeight:600 }}>Crédito</th>
                        <th style={{ padding:'7px 10px', textAlign:'right', fontWeight:600 }}>Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movsCta.map((m,i) => (
                        <tr key={i} style={{ borderBottom:'1px solid #f3f4f6',
                          background: m.tipo==='credito' ? '#f0fdf4' : '#fff' }}>
                          <td style={{ padding:'7px 10px', whiteSpace:'nowrap' }}>{fmtD2(m.fecha)}</td>
                          <td style={{ padding:'7px 10px' }}>{m.concepto}{m.nro ? ` — N° ${m.nro}` : ''}</td>
                          <td style={{ padding:'7px 10px', textAlign:'right', color:RJ, fontWeight:600 }}>
                            {m.tipo==='debito' ? fmt(m.monto) : ''}
                          </td>
                          <td style={{ padding:'7px 10px', textAlign:'right', color:VD, fontWeight:600 }}>
                            {m.tipo==='credito' ? fmt(m.monto) : ''}
                          </td>
                          <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700,
                            color: m.saldo > 0 ? RJ : m.saldo < 0 ? VD : GR }}>
                            {fmt(Math.abs(m.saldo))}{m.saldo < 0 ? ' CR' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {movsCta.length === 0 && !loadingCta && unidad && (
              <div style={{ marginTop:10 }}>
                <button onClick={() => cargarCtaCte(unidad.id, unidad.consorcio_id)}
                  style={{ width:'100%', background:AZ, color:'#fff', border:'none',
                    borderRadius:10, padding:'12px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Cargar cuenta corriente
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB: INFORMAR PAGO */}
        {tab === 'informar' && (
          <div id="informar-pago">
            <div style={{ background:'#fff', borderRadius:14, padding:'20px', boxShadow:'0 2px 12px #0001' }}>
              <div style={{ fontWeight:700, fontSize:14, color:AZ, marginBottom:4 }}>📤 Informar pago de expensas</div>
              <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
                Complete el formulario para notificar al administrador sobre un pago realizado.
                El administrador verificará y acreditará el pago en su cuenta.
              </div>
              {msgPago && (
                <div style={{ padding:'12px', borderRadius:9, marginBottom:14, fontSize:13,
                  background: msgPago.tipo==='ok' ? '#f0fdf4' : msgPago.tipo==='warn' ? '#fffbeb' : '#fff1f2',
                  color: msgPago.tipo==='ok' ? VD : msgPago.tipo==='warn' ? AM : RJ,
                  border: '1px solid ' + (msgPago.tipo==='ok' ? '#86efac' : msgPago.tipo==='warn' ? '#fde68a' : '#fca5a5') }}>
                  {msgPago.texto}
                </div>
              )}
              {!msgPago && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Monto pagado *</div>
                    <input type="number" placeholder="Ej: 150000.00"
                      value={formPago?.monto||''} onChange={e=>setFormPago(f=>({...f,monto:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Fecha del pago *</div>
                    <input type="date" value={formPago?.fecha||''}
                      onChange={e=>setFormPago(f=>({...f,fecha:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Medio de pago</div>
                    <select value={formPago?.medio||'transferencia'}
                      onChange={e=>setFormPago(f=>({...f,medio:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box', background:'#fff' }}>
                      <option value="transferencia">Transferencia bancaria</option>
                      <option value="efectivo">Efectivo</option>
                      <option value="cheque_propio">Cheque propio</option>
                      <option value="plataforma">Plataforma de pagos (EP / SIRO)</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>N° de comprobante / referencia</div>
                    <input type="text" placeholder="Número de transferencia, recibo, etc."
                      value={formPago?.comprobante||''}
                      onChange={e=>setFormPago(f=>({...f,comprobante:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Observaciones</div>
                    <textarea placeholder="Aclaraciones adicionales..." rows={3}
                      value={formPago?.obs||''}
                      onChange={e=>setFormPago(f=>({...f,obs:e.target.value}))}
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                        borderRadius:9, fontSize:13, boxSizing:'border-box', resize:'vertical' }} />
                  </div>
                  <div style={{ padding:'10px 12px', background:'#eff6ff', borderRadius:8, fontSize:11, color:'#1e40af' }}>
                    ℹ️ Los pagos realizados por Expensas Pagas o SIRO se acreditan automáticamente y no requieren aviso.
                  </div>
                  <button onClick={enviarNotificacionPago} disabled={enviandoPago}
                    style={{ background: enviandoPago ? GR : AZ, color:'#fff', border:'none',
                      borderRadius:10, padding:'13px', fontSize:14, fontWeight:700,
                      cursor: enviandoPago ? 'default' : 'pointer' }}>
                    {enviandoPago ? '⏳ Enviando...' : '📤 Enviar aviso de pago'}
                  </button>
                </div>
              )}
              {msgPago?.tipo === 'ok' && (
                <button onClick={() => { setMsgPago(null); setFormPago({}) }}
                  style={{ width:'100%', marginTop:12, background:'#f3f4f6', color:'#374151',
                    border:'none', borderRadius:10, padding:'12px', fontSize:13, cursor:'pointer' }}>
                  Informar otro pago
                </button>
              )}
            </div>
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
                <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Historial de pagos</div>
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
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontWeight:800, fontSize:16, color:VD }}>{fmt(c.monto)}</div>
                      <button onClick={() => generarReciboCob(c)} style={{ marginTop:5, background:'#1A3FA0', color:'#fff', border:'none', borderRadius:6, padding:'5px 11px', fontSize:11, fontWeight:600, cursor:'pointer' }}>🧾 Recibo</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: DOCUMENTOS (NUEVO v5) */}
        {tab === 'documentos' && (
          <div id="documentos">
            {driveFolderUrl ? (
              <div>
                {/* Botón principal */}
                <a href={driveFolderUrl} target="_blank" rel="noreferrer"
                  style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                    padding:'18px 20px', background:'#16a34a', color:'#fff',
                    textDecoration:'none', borderRadius:14, fontWeight:700, fontSize:16,
                    marginBottom:16, boxShadow:'0 4px 16px #16a34a33' }}>
                  <span style={{ fontSize:24 }}>📁</span>
                  Abrir carpeta de documentos del consorcio
                  <span style={{ fontSize:16, opacity:0.7 }}>↗</span>
                </a>

                {/* Descripción de contenidos */}
                <div style={{ background:'#fff', borderRadius:14, padding:'20px',
                  boxShadow:'0 2px 12px #0001', marginBottom:14 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:'#14532d', marginBottom:14 }}>
                    📂 Documentos disponibles en la carpeta
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {[
                      { icon:'📜', title:'Reglamento de propiedad horizontal',
                        desc:'Documento constitutivo del consorcio. Establece los derechos y obligaciones de cada propietario.' },
                      { icon:'🗓️', title:'Actas de asambleas',
                        desc:'Registro de todas las reuniones de propietarios, decisiones tomadas y votaciones.' },
                      { icon:'📐', title:'Planos del edificio',
                        desc:'Planos originales y actualizaciones de la propiedad.' },
                      { icon:'📊', title:'Liquidaciones históricas',
                        desc:'Liquidaciones de expensas de períodos anteriores en formato PDF.' },
                      { icon:'📋', title:'Contratos y pólizas',
                        desc:'Seguros vigentes, contratos de mantenimiento y otros documentos operativos.' },
                    ].map(({ icon, title, desc }) => (
                      <div key={title} style={{ display:'flex', gap:12, padding:'12px',
                        background:'#f9fafb', borderRadius:10, border:'1px solid #e5e7eb' }}>
                        <div style={{ fontSize:24, flexShrink:0 }}>{icon}</div>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13, color:'#111', marginBottom:3 }}>{title}</div>
                          <div style={{ fontSize:12, color:GR, lineHeight:1.5 }}>{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Nota acceso */}
                <div style={{ padding:'12px 16px', background:'#fffbeb', border:'1px solid #fde68a',
                  borderRadius:10, fontSize:12, color:'#92400e' }}>
                  ℹ️ Para acceder necesita una cuenta Google. Si no tiene acceso a algún documento,
                  contacte a su administrador.
                </div>
              </div>
            ) : (
              <div style={{ background:'#fff', borderRadius:14, padding:32,
                textAlign:'center', color:GR }}>
                <div style={{ fontSize:36, marginBottom:12 }}>📁</div>
                <div style={{ fontWeight:600, marginBottom:8 }}>Documentación no disponible</div>
                <div style={{ fontSize:13 }}>
                  La administración aún no ha configurado la carpeta de documentos para este consorcio.
                  Contacte al administrador.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab Reclamos */}
        {tab === 'reclamos' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ background:'#fff', borderRadius:14, padding:20, boxShadow:'0 2px 12px #0001' }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>🎫 Reclamos y Consultas</div>
              <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
                Enviá un reclamo o consulta al administrador. Te responderemos a la brevedad.
              </div>
              <Reclamo
                unidadId={unidad?.id}
                copropietarioId={coprop?.id}
                consorcioId={unidad?.consorcio_id}
                adminEmail={adminPerfil?.email}
              />
            </div>
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
