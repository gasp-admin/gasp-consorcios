// hooks/useAuth.js — Hook de autenticación para GASP Consorcios.
// session, login(), logout() — antes en App(), ahora independiente.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { SUPERADMIN } from '../lib/config'

export function useAuth() {
  const [session, setSession]           = useState(null)
  const [cargando, setCargando]         = useState(true)
  const [esSuperAdmin, setEsSuperAdmin] = useState(false)
  const [email, setEmail]               = useState('')
  const [pass, setPass]                 = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError]     = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const s = data?.session || null
      setSession(s)
      if (s) setEsSuperAdmin(s.user?.email === SUPERADMIN)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setEsSuperAdmin(s?.user?.email === SUPERADMIN)
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
    setLoginLoading(false)
    return true
  }

  async function logout() {
    await supabase.auth.signOut()
    setSession(null)
    setEsSuperAdmin(false)
  }

  return { session, cargando, setCargando, esSuperAdmin, email, setEmail, pass, setPass, loginLoading, loginError, login, logout }
}
