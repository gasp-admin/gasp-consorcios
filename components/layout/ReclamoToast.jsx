// components/layout/ReclamoToast.jsx — Aviso emergente de reclamo nuevo (global).
// Aparece ante un reclamo entrante en CUALQUIER consorcio del administrador.
// Al tocarlo: si el reclamo es de otro consorcio, PRIMERO cambia de consorcio y,
// una vez que el consorcio activo efectivamente cambió (useEffect), recién navega
// a Reclamos — evita el problema de timing que abría el consorcio equivocado.

import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { RJ, VD } from '../../lib/config'

export default function ReclamoToast() {
  const {
    toastReclamo, cerrarToast, setPagina, setMenuAbierto,
    consorcios, consorcioActivo, setConsorcioActivo, cargarConsorcio, session,
  } = useApp()

  // Consorcio al que hay que saltar cuando el usuario tocó el toast (navegación diferida)
  const [pendienteNav, setPendienteNav] = useState(null)

  // Auto-cierre del toast
  useEffect(() => {
    if (!toastReclamo) return
    const t = setTimeout(cerrarToast, 14000)
    return () => clearTimeout(t)
  }, [toastReclamo, cerrarToast])

  // Cuando el consorcio activo ya cambió al pendiente, navegar a Reclamos
  useEffect(() => {
    if (pendienteNav && consorcioActivo?.id === pendienteNav) {
      setPagina('reclamos')
      setMenuAbierto?.(false)
      setPendienteNav(null)
    }
  }, [pendienteNav, consorcioActivo, setPagina, setMenuAbierto])

  if (!toastReclamo) return null
  const r = toastReclamo
  const urgente = !!r.es_emergencia
  const acento = urgente ? RJ : VD

  const consOrigen = consorcios?.find(c => c.id === r.consorcio_id)
  const nombreCons = consOrigen?.nombre || r.consorcio_id
  const esOtroConsorcio = r.consorcio_id && r.consorcio_id !== consorcioActivo?.id

  const irAlReclamo = () => {
    if (esOtroConsorcio && consOrigen) {
      // 1) cambiar de consorcio y cargar sus datos
      setConsorcioActivo(consOrigen)
      cargarConsorcio(consOrigen.id, session?.user?.id)
      // 2) la navegación a Reclamos se dispara en el useEffect cuando el cambio se efectiviza
      setPendienteNav(consOrigen.id)
      cerrarToast()
    } else {
      // mismo consorcio: navegar directo
      setPagina('reclamos')
      setMenuAbierto?.(false)
      cerrarToast()
    }
  }

  return (
    <div
      onClick={irAlReclamo}
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
        width: 330, maxWidth: 'calc(100vw - 40px)',
        background: '#fff', borderRadius: 12, boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
        borderLeft: `5px solid ${acento}`, padding: '14px 16px', cursor: 'pointer',
        fontFamily: 'Segoe UI, Arial, sans-serif', animation: 'gaspToastIn 0.3s ease',
      }}
    >
      <style>{`@keyframes gaspToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: acento, letterSpacing: '0.02em' }}>
          {urgente ? '🚨 RECLAMO URGENTE' : '🎫 Nuevo reclamo'} · Nº {r.nro}
        </span>
        <span
          onClick={(e) => { e.stopPropagation(); cerrarToast() }}
          style={{ cursor: 'pointer', color: '#9ca3af', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
        >×</span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: acento, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        🏢 {nombreCons}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 2 }}>{r.titulo}</div>
      <div style={{ fontSize: 12, color: '#6B7280' }}>
        {r.solicitante || 'Copropietario'}{r.categoria ? ` · ${r.categoria}` : ''}
      </div>
      <div style={{ fontSize: 11, color: acento, marginTop: 8, fontWeight: 600 }}>
        {esOtroConsorcio ? 'Tocá para ir a ese consorcio →' : 'Tocá para ver el reclamo →'}
      </div>
    </div>
  )
}
