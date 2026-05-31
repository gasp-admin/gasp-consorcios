// pages/index.jsx — App shell de GASP Consorcios.
// ANTES:  17.543 líneas — 55 componentes + lógica + SQL inline
// DESPUÉS: 171 líneas — solo la estructura de la app.

import Head from 'next/head'
import { AppProvider, useApp } from '../context/AppContext'
import { MODULE_ROUTES } from '../lib/nav'
import { BG, AZ } from '../lib/config'
import { Btn } from '../components/ui'
import Sidebar         from '../components/layout/Sidebar'
import Topbar          from '../components/layout/Topbar'
import MobileNavBottom from '../components/layout/MobileNavBottom'
import Dashboard       from '../modules/consorcio/Dashboard'

function LoadingScreen() {
  return (
    <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', color:'#4a7abf', fontFamily:'Arial', fontSize:14 }}>
      Cargando GASP Consorcios...
    </div>
  )
}

function LoginForm() {
  const { email, setEmail, pass, setPass, loginLoading, loginError, login } = useApp()
  return (
    <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Arial' }}>
      <Head><title>GASP Consorcios</title></Head>
      <div style={{ background:'#fff', borderRadius:14, padding:36, width:340, boxShadow:'0 8px 40px #0006' }}>
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <div style={{ fontSize:20, fontWeight:800, color:AZ }}>GASP Consorcios</div>
          <div style={{ fontSize:12, color:'#6B7280' }}>Sistema de Administración</div>
        </div>
        {loginError && <div style={{ background:'#fee2e2', color:'#B91C1C', borderRadius:7, padding:'9px 12px', fontSize:13, marginBottom:14 }}>{loginError}</div>}
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8, marginBottom:10, fontSize:14, boxSizing:'border-box' }} />
        <input value={pass} onChange={e=>setPass(e.target.value)} placeholder="Contraseña" type="password" onKeyDown={e=>e.key==='Enter'&&login()} style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db', borderRadius:8, marginBottom:16, fontSize:14, boxSizing:'border-box' }} />
        <Btn onClick={login} disabled={loginLoading} style={{ width:'100%', justifyContent:'center' }}>{loginLoading?'Ingresando...':'Ingresar'}</Btn>
      </div>
    </div>
  )
}

function RouterPaginas() {
  const { pagina, consorcioActivo } = useApp()
  const cid = consorcioActivo?.id
  if (!cid && pagina !== 'dashboard') return <div style={{ textAlign:'center', padding:40, color:'#6B7280' }}>Seleccioná un consorcio primero.</div>
  if (pagina === 'dashboard') return <Dashboard />
  const Modulo = MODULE_ROUTES[pagina]
  if (!Modulo) return <div>Módulo no encontrado: {pagina}</div>
  return <Modulo />
}

function AppLayout() {
  const { isMobile, menuAbierto, setMenuAbierto } = useApp()
  return (
    <div style={{ minHeight:'100vh', fontFamily:'Segoe UI, Arial, sans-serif', background:'#f8fafc', position:'relative' }}>
      <Head><title>GASP Consorcios</title></Head>
      {menuAbierto && isMobile && <div onClick={()=>setMenuAbierto(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:199 }} />}
      <Sidebar />
      <div style={{ marginLeft:isMobile?0:220, minHeight:'100vh' }}>
        <Topbar />
        <div style={{ padding:isMobile?14:24, maxWidth:1100, margin:'0 auto' }}>
          <RouterPaginas />
        </div>
      </div>
      {isMobile && <MobileNavBottom />}
    </div>
  )
}

function AppContent() {
  const { session, cargando } = useApp()
  if (cargando) return <LoadingScreen />
  if (!session)  return <LoginForm />
  return <AppLayout />
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}
