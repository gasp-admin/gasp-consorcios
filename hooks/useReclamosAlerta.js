// hooks/useReclamosAlerta.js — Alerta GLOBAL de reclamos para GASP Consorcios.
// Cuenta reclamos ABIERTOS de TODOS los consorcios del admin y avisa en tiempo real.
// RLS: se autentica el canal Realtime con el token de sesión (setAuth), si no el
// servidor trata la conexión como anónima y RLS bloquea la entrega de eventos.
// [DIAGNÓSTICO] Incluye console.log temporales para verificar la cadena Realtime.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useReclamosAlerta(adminId) {
  const [reclamosAbiertos, setReclamosAbiertos] = useState(0)
  const [toastReclamo, setToastReclamo]         = useState(null)

  const cerrarToast = useCallback(() => setToastReclamo(null), [])

  const recontar = useCallback(async (aid) => {
    if (!aid) { setReclamosAbiertos(0); return }
    const { count } = await supabase
      .from('con_reclamos')
      .select('id', { count: 'exact', head: true })
      .eq('admin_id', aid)
      .eq('estado', 'abierto')
    setReclamosAbiertos(count || 0)
  }, [])

  useEffect(() => { recontar(adminId) }, [adminId, recontar])

  useEffect(() => {
    if (!adminId) { console.log('[ALERTA] sin adminId, no suscribo'); return }
    let canal

    const suscribir = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      console.log('[ALERTA] token de sesión presente:', !!token)
      if (token) supabase.realtime.setAuth(token)

      canal = supabase
        .channel(`reclamos-admin-${adminId}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'con_reclamos', filter: `admin_id=eq.${adminId}` },
          (payload) => {
            console.log('[ALERTA] ✅ evento INSERT recibido:', payload.new)
            recontar(adminId)
            const r = payload.new
            if (r && r.estado === 'abierto') {
              setToastReclamo({
                nro: r.nro_reclamo, titulo: r.titulo, consorcio_id: r.consorcio_id,
                unidad_id: r.unidad_id, solicitante: r.nombre_solicitante,
                es_emergencia: r.es_emergencia, categoria: r.categoria,
              })
            }
          })
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'con_reclamos', filter: `admin_id=eq.${adminId}` },
          () => recontar(adminId))
        .subscribe((status) => { console.log('[ALERTA] estado del canal Realtime:', status) })
    }

    suscribir()

    return () => { if (canal) supabase.removeChannel(canal) }
  }, [adminId, recontar])

  return { reclamosAbiertos, toastReclamo, cerrarToast, recontarReclamos: () => recontar(adminId) }
}
