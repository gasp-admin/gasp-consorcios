// modules/consorcio/Dashboard.jsx
// Dashboard GASP Consorcios — KPIs reales desde el context.

import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { fmt, fmtN, periodoLabel } from '../../lib/formatters'

export default function Dashboard() {
  const {
    consorcios, consorcioActivo, unidades, copropietarios,
    expensas, proveedores, setPagina, session
  } = useApp()
  const uid  = session?.user?.id
  const cid  = consorcioActivo?.id

  // KPIs extras que no están en el context global
  const [kpis, setKpis]   = useState(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!cid || !uid) return
    async function cargarKpis() {
      setCargando(true)
      try {
        // Cobranzas del mes actual
        const mesActual = new Date().toISOString().slice(0, 7) // YYYY-MM
        const fechaDesde = `${mesActual}-01`

        const [cobRes, recRes, compRes, gasRes] = await Promise.all([
          supabase.from('con_cobranzas')
            .select('monto, unidad_id')
            .eq('admin_id', uid).eq('consorcio_id', cid)
            .eq('estado', 'vigente')
            .gte('fecha', fechaDesde),
          supabase.from('con_reclamos')
            .select('id, estado, prioridad')
            .eq('admin_id', uid).eq('consorcio_id', cid)
            .neq('estado', 'cerrado'),
          supabase.from('con_comprobantes_proveedor')
            .select('monto_total, estado, saldo_pendiente')
            .eq('admin_id', uid).eq('consorcio_id', cid)
            .neq('estado', 'anulado'),
          supabase.from('con_gastos')
            .select('monto')
            .eq('admin_id', uid).eq('consorcio_id', cid)
            .gte('fecha', fechaDesde),
        ])

        const cobranzasMes  = cobRes.data  || []
        const reclamosAbiertos = recRes.data || []
        const comprobantes  = compRes.data  || []
        const gastosMes     = gasRes.data   || []

        setKpis({
          cobradoMes:      cobranzasMes.reduce((a, c) => a + parseFloat(c.monto||0), 0),
          pagadorasMes:    new Set(cobranzasMes.map(c => c.unidad_id)).size,
          reclamosTotal:   reclamosAbiertos.length,
          reclamosUrgentes: reclamosAbiertos.filter(r => r.prioridad === 'alta').length,
          deudasPendientes: comprobantes.filter(c => c.estado === 'pendiente')
                              .reduce((a, c) => a + parseFloat(c.saldo_pendiente||0), 0),
          gastosMes:       gastosMes.reduce((a, g) => a + parseFloat(g.monto||0), 0),
        })
      } catch(e) { console.error('[Dashboard]', e) }
      setCargando(false)
    }
    cargarKpis()
  }, [cid, uid])

  // KPIs del context
  const expActiva   = expensas.find(e => e.estado === 'abierta') || expensas[0]
  const totalUFs    = unidades.length
  const pctCobranza = expActiva?.total_expensa > 0
    ? Math.round((expActiva.total_cobrado / expActiva.total_expensa) * 100)
    : (kpis && expActiva?.total_expensa === 0 && kpis.cobradoMes > 0 ? '—' : 0)

  // Morosos = UFs que NO pagaron este mes (del context, sin query extra)
  const morosos = expActiva
    ? totalUFs - (kpis?.pagadorasMes || 0)
    : 0

  if (!consorcioActivo) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏛️</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: AZ, marginBottom: 8 }}>
          Bienvenido a GASP Consorcios
        </div>
        <div style={{ fontSize: 14, color: GR, marginBottom: 24 }}>
          Administrás <strong>{consorcios.length}</strong> consorcio{consorcios.length !== 1 ? 's' : ''}.
          Seleccioná uno desde el menú lateral para ver el dashboard.
        </div>
        {consorcios.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: 600, margin: '0 auto' }}>
            {consorcios.slice(0, 8).map(c => (
              <div key={c.id} style={{ background: '#f0f4ff', borderRadius: 8, padding: '8px 14px',
                fontSize: 13, color: AZ, fontWeight: 600 }}>
                {c.nombre}
              </div>
            ))}
            {consorcios.length > 8 && (
              <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: GR }}>
                +{consorcios.length - 8} más
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: AZ }}>
            {consorcioActivo.nombre}
          </div>
          <div style={{ fontSize: 12, color: GR, marginTop: 2, display: 'flex', gap: 16 }}>
            <span>📍 {consorcioActivo.localidad || 'Pinamar'}</span>
            {expActiva && <span>📅 Período: <strong>{periodoLabel(expActiva.periodo)}</strong></span>}
            {consorcioActivo.cbu && <span>🏦 CBU registrado</span>}
          </div>
        </div>
        <button
          onClick={() => setPagina('ficha_consorcio')}
          style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: '#f0f4ff',
            color: AZ, border: '1px solid #c0cfe8', borderRadius: 7, cursor: 'pointer',
            whiteSpace: 'nowrap', marginTop: 2 }}>
          ✏️ Editar consorcio
        </button>
      </div>

      {/* KPIs fila 1: estructura */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <KPI icon="🏢" label="Unidades" value={totalUFs}
          sub={`${proveedores?.length || 0} proveedores`}
          color={AZ} onClick={() => setPagina('unidades')} />
        <KPI icon="👤" label="Copropietarios" value={copropietarios.length}
          sub="registrados"
          color={VD} onClick={() => setPagina('copropietarios')} />
        <KPI icon="📂" label="Expensas" value={expensas.length}
          sub={expActiva ? `Activo: ${periodoLabel(expActiva.periodo)}` : 'Sin período activo'}
          color={AM} onClick={() => setPagina('expensas')} />
        <KPI icon="🔧" label="Proveedores" value={proveedores?.length || 0}
          sub="activos"
          color="#6d28d9" onClick={() => setPagina('proveedores')} />
      </div>

      {/* KPIs fila 2: operativos (requieren query) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KPI icon="💰" label="Cobrado (mes)" 
          value={cargando ? '...' : fmt(kpis?.cobradoMes || 0)}
          sub={cargando ? '' : `${kpis?.pagadorasMes || 0} de ${totalUFs} UFs`}
          color={VD} onClick={() => setPagina('cobranzas')} />
        <KPI icon="⚠️" label="Sin pagar"
          value={cargando ? '...' : Math.max(0, morosos)}
          sub={cargando ? '' : `UFs pendientes este mes`}
          color={morosos > 0 ? RJ : VD} onClick={() => setPagina('morosos')} />
        <KPI icon="🧾" label="Deudas proveed."
          value={cargando ? '...' : fmt(kpis?.deudasPendientes || 0)}
          sub="saldo pendiente"
          color={kpis?.deudasPendientes > 0 ? AM : GR} onClick={() => setPagina('comprobantes')} />
        <KPI icon="🎫" label="Reclamos"
          value={cargando ? '...' : (kpis?.reclamosTotal || 0)}
          sub={cargando ? '' : kpis?.reclamosUrgentes > 0 ? `⚠️ ${kpis.reclamosUrgentes} urgentes` : 'sin urgentes'}
          color={kpis?.reclamosUrgentes > 0 ? RJ : GR} onClick={() => setPagina('reclamos')} />
      </div>

      {/* Barra de cobranza del período */}
      {expActiva && expActiva.total_expensa > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>
              Recaudación — {periodoLabel(expActiva.periodo)}
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: pctCobranza >= 80 ? VD : pctCobranza >= 50 ? AM : RJ }}>
              {pctCobranza}%
            </div>
          </div>
          <div style={{ background: '#f3f4f6', borderRadius: 99, height: 10, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99, transition: 'width 0.5s',
              width: `${Math.min(100, pctCobranza)}%`,
              background: pctCobranza >= 80 ? VD : pctCobranza >= 50 ? AM : RJ,
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: GR }}>
            <span>Cobrado: <strong style={{ color: '#374151' }}>{fmt(expActiva.total_cobrado || 0)}</strong></span>
            <span>Total emitido: <strong style={{ color: '#374151' }}>{fmt(expActiva.total_expensa)}</strong></span>
          </div>
        </div>
      )}

      {/* Accesos rápidos */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: GR, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Accesos rápidos
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {[
            { id: 'liquidacion',     icon: '📝', label: 'Liquidar' },
            { id: 'cobranzas',       icon: '💳', label: 'Cobranzas' },
            { id: 'cobranzas_auto',  icon: '🏦', label: 'Importar cobr.' },
            { id: 'morosos',         icon: '⚠️', label: 'Morosos' },
            { id: 'comprobantes',    icon: '🧾', label: 'Comprobantes' },
            { id: 'cta_corriente',   icon: '📋', label: 'Cta. Cte.' },
            { id: 'emails',          icon: '✉️', label: 'Enviar liquid.' },
            { id: 'reclamos',        icon: '🎫', label: 'Reclamos' },
          ].map(a => (
            <button key={a.id} onClick={() => setPagina(a.id)} style={{
              padding: '10px 6px', borderRadius: 8, border: '1px solid #e5e7eb',
              background: '#f9fafb', cursor: 'pointer', fontSize: 11, color: '#374151',
              fontWeight: 600, textAlign: 'center',
            }}>
              <div style={{ fontSize: 18, marginBottom: 3 }}>{a.icon}</div>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>

      {/* ── Agenda de Vencimientos ──────────────────────────── */}
      <AgendaVencimientos consorcioId={cid} uid={uid} setPagina={setPagina} />
  )
}

// ── AgendaVencimientos ──────────────────────────────────────────────────────
function AgendaVencimientos({ consorcioId, uid, setPagina }) {
  const { supabase: sb } = useApp ? {} : {}
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(false)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [form, setForm] = useState({ tipo:'poliza', descripcion:'', fecha_vencimiento:'', monto:'', notas:'', recurrente:false, frecuencia_dias:'' })
  const [guardando, setGuardando] = useState(false)
  const { supabase: _sb } = { supabase: null }

  const supa = typeof window !== 'undefined' ? window._supa || null : null

  useEffect(() => { if (consorcioId && uid) cargar() }, [consorcioId])

  async function cargar() {
    setCargando(true)
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      )
      // Agenda manual
      const { data: agenda } = await supabase
        .from('con_agenda_vencimientos')
        .select('*, con_consorcios(nombre)')
        .eq('consorcio_id', consorcioId)
        .neq('estado','vencido_archivado')
        .order('fecha_vencimiento', { ascending: true })
        .limit(20)

      // Póliza del consorcio
      const { data: cons } = await supabase
        .from('con_consorcios').select('nombre,poliza_vto_hasta,poliza_nro,aseguradora,poliza_suma').eq('id', consorcioId).single()

      // Vencimientos de proveedores (ART, seguro)
      const { data: provs } = await supabase
        .from('con_proveedores')
        .select('id,razon_social,art_vencimiento,seguro_vencimiento')
        .eq('consorcio_id', consorcioId)
        .or('art_vencimiento.not.is.null,seguro_vencimiento.not.is.null')

      // Construir lista unificada
      const hoy = new Date(); hoy.setHours(0,0,0,0)
      const list = []

      // De la tabla agenda
      for (const a of (agenda||[])) {
        const fv = new Date(a.fecha_vencimiento + 'T00:00:00')
        const dias = Math.round((fv - hoy) / 86400000)
        list.push({ id:a.id, tipo:a.tipo, desc:a.descripcion, fecha:a.fecha_vencimiento, dias, monto:a.monto, estado:a.estado, notas:a.notas, fuente:'agenda', recurrente:a.recurrente })
      }

      // Póliza del consorcio
      if (cons?.poliza_vto_hasta) {
        const fv = new Date(cons.poliza_vto_hasta + 'T00:00:00')
        const dias = Math.round((fv - hoy) / 86400000)
        list.push({ id:'poliza-'+consorcioId, tipo:'poliza', desc:`Póliza ${cons.aseguradora||''} N° ${cons.poliza_nro||''}`.trim(), fecha:cons.poliza_vto_hasta, dias, monto:cons.poliza_suma, estado: dias<0?'vencido': dias<=30?'proximo':'vigente', fuente:'consorcio', recurrente:false })
      }

      // ART / Seguro proveedores
      for (const p of (provs||[])) {
        if (p.art_vencimiento) {
          const fv = new Date(p.art_vencimiento + 'T00:00:00')
          const dias = Math.round((fv - hoy) / 86400000)
          list.push({ id:'art-'+p.id, tipo:'art', desc:`ART — ${p.razon_social}`, fecha:p.art_vencimiento, dias, estado: dias<0?'vencido': dias<=30?'proximo':'vigente', fuente:'proveedor', recurrente:false })
        }
        if (p.seguro_vencimiento) {
          const fv = new Date(p.seguro_vencimiento + 'T00:00:00')
          const dias = Math.round((fv - hoy) / 86400000)
          list.push({ id:'seg-'+p.id, tipo:'seguro', desc:`Seguro — ${p.razon_social}`, fecha:p.seguro_vencimiento, dias, estado: dias<0?'vencido': dias<=30?'proximo':'vigente', fuente:'proveedor', recurrente:false })
        }
      }

      // Ordenar por fecha
      list.sort((a,b) => new Date(a.fecha) - new Date(b.fecha))
      setItems(list)
    } catch(e) { console.error('Agenda:', e) }
    finally { setCargando(false) }
  }

  async function guardarItem() {
    if (!form.descripcion || !form.fecha_vencimiento) return
    setGuardando(true)
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      const { data: { session } } = await supabase.auth.getSession()
      await supabase.from('con_agenda_vencimientos').insert([{
        id: 'AV-'+Date.now(),
        admin_id: session?.user?.id || uid,
        consorcio_id: consorcioId,
        tipo: form.tipo,
        descripcion: form.descripcion,
        fecha_vencimiento: form.fecha_vencimiento,
        monto: form.monto ? parseFloat(form.monto) : null,
        notas: form.notas || null,
        recurrente: form.recurrente,
        frecuencia_dias: form.recurrente && form.frecuencia_dias ? parseInt(form.frecuencia_dias) : null,
        estado: 'pendiente',
      }])
      setMostrarForm(false)
      setForm({ tipo:'poliza', descripcion:'', fecha_vencimiento:'', monto:'', notas:'', recurrente:false, frecuencia_dias:'' })
      cargar()
    } catch(e){ console.error(e) }
    finally{ setGuardando(false) }
  }

  async function marcarCumplido(id) {
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      await supabase.from('con_agenda_vencimientos').update({ estado:'cumplido' }).eq('id', id)
      cargar()
    } catch(e){}
  }

  const TIPO_ICON = { poliza:'🛡️', art:'🦺', seguro:'🔒', impuesto:'🏛️', asamblea:'👥', mantenimiento:'🔧', certificado:'📄', otro:'📌' }
  const TIPO_LABEL = { poliza:'Póliza', art:'ART', seguro:'Seguro', impuesto:'Impuesto', asamblea:'Asamblea', mantenimiento:'Mantenim.', certificado:'Certificado', otro:'Otro' }

  function colorDias(dias) {
    if (dias < 0) return '#B91C1C'
    if (dias <= 7) return '#B91C1C'
    if (dias <= 30) return '#C07D10'
    return '#1B6B35'
  }

  function bgDias(dias) {
    if (dias < 0) return '#fff1f1'
    if (dias <= 7) return '#fff1f1'
    if (dias <= 30) return '#fffbea'
    return '#f0fdf4'
  }

  function labelDias(dias) {
    if (dias < 0) return `Vencido hace ${Math.abs(dias)}d`
    if (dias === 0) return 'Vence HOY'
    if (dias === 1) return 'Vence mañana'
    return `${dias} días`
  }

  const FLD = { fontSize:12, padding:'6px 9px', border:'1px solid #d0d9e8', borderRadius:6, width:'100%', boxSizing:'border-box' }

  if (!consorcioId) return null

  return (
    <div style={{ marginTop: 24 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 12 }}>
        <div style={{ fontSize:15, fontWeight:700, color:'#1A3FA0' }}>
          📅 Agenda de Vencimientos
        </div>
        <button
          onClick={() => setMostrarForm(f => !f)}
          style={{ padding:'5px 12px', fontSize:11, fontWeight:600, background:'#1A3FA0', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>
          {mostrarForm ? '✕ Cancelar' : '＋ Agregar'}
        </button>
      </div>

      {/* Formulario nuevo vencimiento */}
      {mostrarForm && (
        <div style={{ background:'#f8faff', border:'1px solid #c0cfe8', borderRadius:8, padding:'12px 14px', marginBottom:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 12px', marginBottom:8 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'#5a6a8a', display:'block', marginBottom:2 }}>Tipo</label>
              <select style={FLD} value={form.tipo} onChange={e => setForm(f=>({...f, tipo:e.target.value}))}>
                {Object.entries(TIPO_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'#5a6a8a', display:'block', marginBottom:2 }}>Fecha de vencimiento</label>
              <input style={FLD} type="date" value={form.fecha_vencimiento} onChange={e => setForm(f=>({...f, fecha_vencimiento:e.target.value}))} />
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label style={{ fontSize:11, fontWeight:600, color:'#5a6a8a', display:'block', marginBottom:2 }}>Descripción *</label>
              <input style={FLD} placeholder="Ej: Póliza Edificio - La Segunda" value={form.descripcion} onChange={e => setForm(f=>({...f, descripcion:e.target.value}))} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'#5a6a8a', display:'block', marginBottom:2 }}>Monto ($) opcional</label>
              <input style={FLD} type="number" placeholder="0.00" value={form.monto} onChange={e => setForm(f=>({...f, monto:e.target.value}))} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'#5a6a8a', display:'block', marginBottom:2 }}>Notas</label>
              <input style={FLD} placeholder="Observaciones..." value={form.notas} onChange={e => setForm(f=>({...f, notas:e.target.value}))} />
            </div>
            <div style={{ gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:8 }}>
              <input type="checkbox" id="recurrente" checked={form.recurrente} onChange={e => setForm(f=>({...f, recurrente:e.target.checked}))} />
              <label htmlFor="recurrente" style={{ fontSize:12, color:'#374151' }}>Recurrente</label>
              {form.recurrente && (
                <input style={{ ...FLD, width:100 }} type="number" placeholder="días" value={form.frecuencia_dias} onChange={e => setForm(f=>({...f, frecuencia_dias:e.target.value}))} />
              )}
            </div>
          </div>
          <button
            onClick={guardarItem} disabled={guardando || !form.descripcion || !form.fecha_vencimiento}
            style={{ padding:'7px 18px', fontSize:12, fontWeight:700, background:'#1B6B35', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', opacity: (!form.descripcion||!form.fecha_vencimiento)?0.5:1 }}>
            {guardando ? 'Guardando...' : '💾 Guardar'}
          </button>
        </div>
      )}

      {/* Lista de vencimientos */}
      {cargando ? (
        <div style={{ color:'#6B7280', fontSize:12, padding:'10px 0' }}>Cargando agenda...</div>
      ) : items.length === 0 ? (
        <div style={{ color:'#6B7280', fontSize:12, padding:'10px 0', fontStyle:'italic' }}>
          Sin vencimientos registrados. Use ＋ Agregar para incorporar pólizas, ART, impuestos, etc.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {items.map(item => (
            <div key={item.id} style={{
              display:'flex', alignItems:'center', gap:10,
              background: bgDias(item.dias), border:`1px solid ${item.dias < 0 ? '#fca5a5' : item.dias<=30 ? '#fcd34d' : '#bbf7d0'}`,
              borderRadius:8, padding:'8px 12px'
            }}>
              <span style={{ fontSize:18 }}>{TIPO_ICON[item.tipo] || '📌'}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#111827', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {item.desc}
                </div>
                <div style={{ fontSize:11, color:'#6B7280', marginTop:1 }}>
                  {new Date(item.fecha + 'T00:00:00').toLocaleDateString('es-AR')}
                  {item.monto ? ` · $${Number(item.monto).toLocaleString('es-AR')}` : ''}
                  {item.recurrente ? ' · 🔁 Recurrente' : ''}
                  {item.notas ? ` · ${item.notas}` : ''}
                </div>
              </div>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontSize:11, fontWeight:700, color: colorDias(item.dias), background:'rgba(255,255,255,0.7)', borderRadius:5, padding:'2px 7px' }}>
                  {labelDias(item.dias)}
                </div>
                {item.fuente === 'agenda' && item.estado !== 'cumplido' && (
                  <button onClick={() => marcarCumplido(item.id)}
                    style={{ marginTop:3, fontSize:9, padding:'1px 6px', background:'#e5e7eb', border:'none', borderRadius:4, cursor:'pointer', color:'#374151' }}>
                    ✓ Cumplido
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


function KPI({ icon, label, value, sub, color, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', border: `1.5px solid ${color}25`, borderRadius: 10,
      padding: '12px', cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 11, color: GR, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: GR, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}
