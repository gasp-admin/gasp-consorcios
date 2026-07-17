// hooks/useReclamosAlerta.js — Alerta GLOBAL de reclamos para GASP Consorcios.
// Cuenta los reclamos ABIERTOS de TODOS los consorcios del administrador y avisa
// en tiempo real (Supabase Realtime) cuando entra uno nuevo — vía el bot de WhatsApp
// u otro origen — sin importar en qué consorcio esté posicionado el usuario.
//
// IMPORTANTE: con_reclamos tiene RLS. Para que Realtime entregue eventos hay que
// autenticar el canal con el token de la sesión (supabase.realtime.setAuth); de lo
// contrario el servidor trata la conexión como anónima y la RLS bloquea la entrega.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useReclamosAlerta(adminId) {
  const [reclamosAbiertos, setReclamosAbiertos] = useState(0)
  const [toastReclamo, setToastReclamo]         = useState(null)

  const cerrarToast = useCallback(() => setToastReclamo(null), [])

  // Contador global: todos los reclamos 'abierto' del administrador
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

  // Realtime: escucha por admin_id (todos los consorcios del administrador)
  useEffect(() => {
    if (!adminId) return
    let canal

    const suscribir = async () => {
      // Autenticar el canal con el token de sesión (necesario por RLS)
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      if (token) supabase.realtime.setAuth(token)

      canal = supabase
        .channel(`reclamos-admin-${adminId}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'con_reclamos', filter: `admin_id=eq.${adminId}` },
          (payload) => {
            recontar(adminId)
            const r = payload.new
            if (r && r.estado === 'abierto') {
              setToastReclamo({
                nro: r.nro_reclamo,
                titulo: r.titulo,
                consorcio_id: r.consorcio_id,
                unidad_id: r.unidad_id,
                solicitante: r.nombre_solicitante,
                es_emergencia: r.es_emergencia,
                categoria: r.categoria,
              })
            }
          })
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'con_reclamos', filter: `admin_id=eq.${adminId}` },
          () => recontar(adminId))
        .subscribe()
    }

    suscribir()

    return () => { if (canal) supabase.removeChannel(canal) }
  }, [adminId, recontar])

  return { reclamosAbiertos, toastReclamo, cerrarToast, recontarReclamos: () => recontar(adminId) }
}
