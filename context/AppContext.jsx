// context/AppContext.jsx — Context global de GASP Consorcios.
// Elimina el prop drilling de 40+ módulos (session, consorcioId,
// unidades, copropietarios, expensas, adminPerfil).
//
// Uso en cualquier módulo:
//   import { useApp } from '../../context/AppContext'
//   function MiModulo() {
//     const { session, consorcioActivo, unidades } = useApp()
//   }

import { createContext, useContext, useEffect } from 'react'
import { useAuth }      from '../hooks/useAuth'
import { useConsorcio } from '../hooks/useConsorcio'
import { usePagina }    from '../hooks/usePagina'
import { useReclamosAlerta } from '../hooks/useReclamosAlerta'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const auth = useAuth()
  const cons = useConsorcio(auth.session)
  const nav  = usePagina(auth.esSuperAdmin)
  const alerta = useReclamosAlerta(cons.consorcioActivo?.id)

  useEffect(() => {
    if (auth.session?.user?.id) {
      cons.cargarConsorcios(auth.session.user.id, auth.setCargando)
    } else {
      auth.setCargando(false)
    }
  }, [auth.session?.user?.id]) // eslint-disable-line

  useEffect(() => {
    const check = () => nav.setIsMobile(window.innerWidth < 769)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, []) // eslint-disable-line

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  const value = {
    // Auth
    session: auth.session, cargando: auth.cargando, esSuperAdmin: auth.esSuperAdmin,
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
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp debe usarse dentro de <AppProvider>')
  return ctx
}
