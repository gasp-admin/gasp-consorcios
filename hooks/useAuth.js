// hooks/useAuth.js — Hook de autenticación para GASP Consorcios.
// session, login(), logout() — antes en App(), ahora independiente.

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { SUPERADMIN } from '../lib/config'

export function useAuth() {
  const [session, setSession]           = useState(null)
  const [adminId, setAdminId]           = useState(null)  // admin_id EFECTIVO (propio, o del dueño si es miembro del equipo)
  const [rol, setRol]                   = useState(null)  // 'admin' (principal) | 'administrativo' | 'contador' | 'asistente'
  const [cargando, setCargando]         = useState(true)
  const [esSuperAdmin, setEsSuperAdmin] = useState(false)
  const [email, setEmail]               = useState('')
  const [pass, setPass]                 = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError]     = useState('')
  // Ultimo user.id procesado. Sirve para IGNORAR los eventos de onAuthStateChange que NO cambian de
  // usuario (TOKEN_REFRESHED / re-foco de la pestana), que si no re-disparan recargas y el
  // LoadingScreen, desmontando la vista en curso y perdiendo el formulario que se estaba cargando.
  const lastUserIdRef = useRef(undefined)

  async function resolverAdminId(s) {
    if (!s?.user?.id) { setAdminId(null); setRol(null); return }
    try {
      const { data, error } = await supabase.rpc('get_admin_id_efectivo', { user_id: s.user.id })
      setAdminId(error ? s.user.id : (data || s.user.id))
      // El rol sale de con_equipo (igual que get_mi_rol en la base). Si no está en ningún
      // equipo, es un admin principal independiente => 'admin' (todos los permisos).
      const { data: eq } = await supabase.from('con_equipo')
        .select('rol').eq('usuario_id', s.user.id).eq('activo', true).maybeSingle()
      setRol(eq?.rol || 'admin')
    } catch { setAdminId(s.user.id); setRol('admin') }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const s = data?.session || null
      lastUserIdRef.current = s?.user?.id || null
      setSession(s)
      if (s) { setEsSuperAdmin(s.user?.email === SUPERADMIN); resolverAdminId(s) }
      else setAdminId(null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      const newId = s?.user?.id || null
      // Mismo usuario (refresh de token / re-foco de pestana): NO re-procesar. Evita la recarga de
      // consorcios + LoadingScreen que desmonta la vista y borra el formulario en curso.
      if (lastUserIdRef.current === newId) return
      lastUserIdRef.current = newId
      setSession(s)
      setEsSuperAdmin(s?.user?.email === SUPERADMIN)
      resolverAdminId(s)
    })
    return () => subscription?.unsubscribe()
  }, [])

  async function login() {
    setLoginLoading(true)
    setLoginError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (error) {
      setLoginError('Email o contraseña incorrectos')
      setLoginLoading(false)
      return false
    }
    const { data } = await supabase.auth.getSession()
    lastUserIdRef.current = data?.session?.user?.id || null
    setSession(data?.session || null)
    await resolverAdminId(data?.session)
    setLoginLoading(false)
    return true
  }

  async function logout() {
    await supabase.auth.signOut()
    lastUserIdRef.current = null
    setSession(null)
    setAdminId(null)
    setRol(null)
    setEsSuperAdmin(false)
  }

  return { session, adminId, rol, cargando, setCargando, esSuperAdmin, email, setEmail, pass, setPass, loginLoading, loginError, login, logout }
}
