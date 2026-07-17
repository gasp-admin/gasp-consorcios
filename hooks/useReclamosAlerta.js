// hooks/useReclamosAlerta.js — Alerta de reclamos para GASP Consorcios.
// Cuenta los reclamos ABIERTOS del consorcio activo y avisa en tiempo real
// (Supabase Realtime) cuando entra uno nuevo — típicamente vía el bot de WhatsApp.
//
// Expone: { reclamosAbiertos, toastReclamo, cerrarToast }
//   - reclamosAbiertos: nro de reclamos en estado 'abierto' del consorcio activo (para el badge)
//   - toastReclamo: objeto del último reclamo entrante para mostrar el aviso, o null
//   - cerrarToast: cierra el aviso manualmente

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useReclamosAlerta(consorcioId) {
  const [reclamosAbiertos, setReclamosAbiertos] = useState(0)
  const [toastReclamo, setToastReclamo]         = useState(null)

  const cerrarToast = useCallback(() => setToastReclamo(null), [])

  // Contador inicial (y recarga al cambiar de consorcio)
  const recontar = useCallback(async (cid) => {
    if (!cid) { setReclamosAbiertos(0); return }
    const { count } = await supabase
      .from('con_reclamos')
      .select('id', { count: 'exact', head: true })
      .eq('consorcio_id', cid)
      .eq('estado', 'abierto')
    setReclamosAbiertos(count || 0)
  }, [])

  useEffect(() => { recontar(consorcioId) }, [consorcioId, recontar])

  // Realtime: escucha INSERT/UPDATE en con_reclamos del consorcio activo
  useEffect(() => {
    if (!consorcioId) return
    const canal = supabase
      .channel(`reclamos-${consorcioId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'con_reclamos', filter: `consorcio_id=eq.${consorcioId}` },
        (payload) => {
          recontar(consorcioId)
          const r = payload.new
          if (r && r.estado === 'abierto') {
            setToastReclamo({
              nro: r.nro_reclamo,
              titulo: r.titulo,
              unidad_id: r.unidad_id,
              solicitante: r.nombre_solicitante,
              es_emergencia: r.es_emergencia,
              categoria: r.categoria,
            })
          }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'con_reclamos', filter: `consorcio_id=eq.${consorcioId}` },
        () => recontar(consorcioId))
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [consorcioId, recontar])

  return { reclamosAbiertos, toastReclamo, cerrarToast, recontarReclamos: () => recontar(consorcioId) }
}
