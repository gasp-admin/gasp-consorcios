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
