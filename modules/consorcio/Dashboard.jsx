// modules/consorcio/Dashboard.jsx
// Dashboard principal de GASP Consorcios.
// Muestra KPIs del consorcio activo.

import { useApp } from '../../context/AppContext'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'

export default function Dashboard() {
  const { consorcios, consorcioActivo, unidades, copropietarios, expensas, setPagina } = useApp()

  const expActiva = expensas.find(e => e.estado === 'abierta') || expensas[0]
  const morosos = copropietarios.filter(c => c.saldo_deudor > 0).length

  return (
    <div style={{ fontFamily: 'Segoe UI, Arial, sans-serif' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: AZ }}>
          {consorcioActivo ? consorcioActivo.nombre : 'GASP Consorcios'}
        </div>
        <div style={{ fontSize: 13, color: GR, marginTop: 2 }}>
          {consorcios.length} consorcio{consorcios.length !== 1 ? 's' : ''} administrado{consorcios.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
        <KPICard label="Unidades" value={unidades.length} icon="🏢" color={AZ} onClick={() => setPagina('unidades')} />
        <KPICard label="Copropietarios" value={copropietarios.length} icon="👤" color={VD} onClick={() => setPagina('copropietarios')} />
        <KPICard label="Período activo" value={expActiva?.periodo || '—'} icon="📅" color={AM} onClick={() => setPagina('expensas')} />
        <KPICard label="Morosos" value={morosos} icon="⚠️" color={morosos > 0 ? RJ : VD} onClick={() => setPagina('morosos')} />
      </div>

      {/* Accesos rápidos */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 14 }}>Accesos rápidos</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {[
            { id: 'liquidacion',   icon: '📝', label: 'Liquidar período' },
            { id: 'cobranzas',     icon: '💳', label: 'Cobranzas' },
            { id: 'morosos',       icon: '⚠️', label: 'Morosos' },
            { id: 'cta_corriente', icon: '📋', label: 'Cta. Corriente' },
            { id: 'proveedores',   icon: '🔧', label: 'Proveedores' },
            { id: 'emails',        icon: '✉️', label: 'Enviar liquid.' },
          ].map(a => (
            <button key={a.id} onClick={() => setPagina(a.id)}
              style={{ padding: '12px 8px', borderRadius: 8, border: '1px solid #e5e7eb',
                background: '#f9fafb', cursor: 'pointer', fontSize: 12, color: '#374151',
                fontWeight: 600, textAlign: 'center', transition: 'background 0.15s' }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{a.icon}</div>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {!consorcioActivo && (
        <div style={{ marginTop: 20, padding: 20, background: '#dbeafe', borderRadius: 10, color: '#1e40af', fontSize: 14 }}>
          Seleccioná un consorcio desde el menú lateral para comenzar.
        </div>
      )}
    </div>
  )
}

function KPICard({ label, value, icon, color, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', border: `1.5px solid ${color}20`, borderRadius: 10,
      padding: '16px 14px', cursor: 'pointer', transition: 'box-shadow 0.15s',
    }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, color: GR, marginTop: 2 }}>{label}</div>
    </div>
  )
}
