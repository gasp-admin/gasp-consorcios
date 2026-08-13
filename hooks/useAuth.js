// hooks/useAuth.js — Hook de autenticación para GASP Consorcios.
// session, login(), logout() — antes en App(), ahora independiente.

import { useState, useEffect } from 'react'
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
      setSession(s)
      if (s) { setEsSuperAdmin(s.user?.email === SUPERADMIN); resolverAdminId(s) }
      else setAdminId(null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
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
    setSession(data?.session || null)
    await resolverAdminId(data?.session)
    setLoginLoading(false)
    return true
  }

  async function logout() {
    await supabase.auth.signOut()
    setSession(null)
    setAdminId(null)
    setRol(null)
    setEsSuperAdmin(false)
  }

  return { session, adminId, rol, cargando, setCargando, esSuperAdmin, email, setEmail, pass, setPass, loginLoading, loginError, login, logout }
}
