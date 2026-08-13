// context/AppContext.jsx — Context global de GASP Consorcios.
// Elimina el prop drilling de 40+ módulos (session, consorcioId,
// unidades, copropietarios, expensas, adminPerfil).
//
// Uso en cualquier módulo:
//   import { useApp } from '../../context/AppContext'
//   function MiModulo() {
//     const { session, consorcioActivo, unidades } = useApp()
//   }

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { useAuth }      from '../hooks/useAuth'
import { useConsorcio } from '../hooks/useConsorcio'
import { usePagina, puedeRol } from '../hooks/usePagina'
import { useReclamosAlerta } from '../hooks/useReclamosAlerta'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const auth = useAuth()
  const cons = useConsorcio(auth.session, auth.adminId)
  const nav  = usePagina(auth.esSuperAdmin, auth.rol)
  const alerta = useReclamosAlerta(auth.session?.user?.id)

  // Navegación diferida a "Reclamos" tras cambiar de consorcio (desde el toast).
  // Vive en el provider (no se desmonta), así el salto se completa aunque el toast se cierre.
  const [saltoReclamos, setSaltoReclamos] = useState(null)

  const irAReclamoConsorcio = useCallback((consorcioId) => {
    if (!consorcioId) return
    if (consorcioId === cons.consorcioActivo?.id) {
      nav.setPagina('reclamos'); nav.setMenuAbierto?.(false); return
    }
    const c = cons.consorcios.find(x => x.id === consorcioId)
    if (!c) return
    cons.setConsorcioActivo(c)
    cons.cargarConsorcio(c.id, auth.session?.user?.id)
    setSaltoReclamos(consorcioId)
  }, [cons.consorcioActivo?.id, cons.consorcios, cons.setConsorcioActivo, cons.cargarConsorcio, nav, auth.session?.user?.id])

  useEffect(() => {
    if (saltoReclamos && cons.consorcioActivo?.id === saltoReclamos) {
      nav.setPagina('reclamos')
      nav.setMenuAbierto?.(false)
      setSaltoReclamos(null)
    }
  }, [saltoReclamos, cons.consorcioActivo?.id]) // eslint-disable-line

  useEffect(() => {
    if (auth.adminId) {
      cons.cargarConsorcios(auth.adminId, auth.setCargando)
    } else if (auth.session === null) {
      auth.setCargando(false)
    }
  }, [auth.adminId, auth.session]) // eslint-disable-line

  useEffect(() => {
    const check = () => nav.setIsMobile(window.innerWidth < 769)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, []) // eslint-disable-line

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  // Sesión EFECTIVA: user.id es el admin_id efectivo (propio, o el del dueño si es miembro del
  // equipo). Así todos los módulos que usan session.user.id como admin_id operan sobre los datos
  // correctos sin necesidad de modificarlos uno por uno. El uid real queda en `usuarioId`.
  const sessionEfectiva = useMemo(() => (
    (auth.session && auth.adminId && auth.adminId !== auth.session.user.id)
      ? { ...auth.session, user: { ...auth.session.user, id: auth.adminId } }
      : auth.session
  ), [auth.session, auth.adminId])

  const rolEfectivo = auth.rol || 'admin'
  const puede = (accion) => puedeRol(rolEfectivo, accion)

  const value = {
    // Auth
    session: sessionEfectiva, usuarioId: auth.session?.user?.id, adminId: auth.adminId, rol: rolEfectivo, puede, cargando: auth.cargando, esSuperAdmin: auth.esSuperAdmin,
    email: auth.email, setEmail: auth.setEmail, pass: auth.pass, setPass: auth.setPass,
    loginLoading: auth.loginLoading, loginError: auth.loginError, login: auth.login, logout: auth.logout,
    // Consorcio
    consorcios: cons.consorcios, setConsorcios: cons.setConsorcios,
    consorcioActivo: cons.consorcioActivo, setConsorcioActivo: cons.setConsorcioActivo,
    unidades: cons.unidades, setUnidades: cons.setUnidades,
    copropietarios: cons.copropietarios, setCopropietarios: cons.setCopropietarios,
    expensas: cons.expensas, setExpensas: cons.setExpensas,
    proveedores: cons.proveedores, adminPerfil: cons.adminPerfil, setAdminPerfil: cons.setAdminPerfil,
    formCon: cons.formCon, setFormCon: cons.setFormCon, msgCon: cons.msgCon,
    cargarConsorcio: cons.cargarConsorcio, cargarConsorcios: cons.cargarConsorcios, guardarConsorcio: cons.guardarConsorcio,
    // Navegación
    pagina: nav.pagina, setPagina: nav.setPagina,
    menuAbierto: nav.menuAbierto, setMenuAbierto: nav.setMenuAbierto,
    isMobile: nav.isMobile, navItems: nav.navItems, secciones: nav.secciones, navActivo: nav.navActivo,
    // Alerta de reclamos (badge + toast en tiempo real)
    reclamosAbiertos: alerta.reclamosAbiertos, toastReclamo: alerta.toastReclamo,
    cerrarToast: alerta.cerrarToast, recontarReclamos: alerta.recontarReclamos,
    irAReclamoConsorcio,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp debe usarse dentro de <AppProvider>')
  return ctx
}
