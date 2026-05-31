// components/layout/MobileNavBottom.jsx — Barra navegación mobile.

import { useApp } from '../../context/AppContext'
import { BG, AZ } from '../../lib/config'

const MOBILE_NAV = [
  { id: 'dashboard', icon: '📊' },
  { id: 'expensas',  icon: '💰' },
  { id: 'cobranzas', icon: '💳' },
  { id: 'morosos',   icon: '⚠️' },
  { id: 'actas',     icon: '📖' },
]

export default function MobileNavBottom() {
  const { pagina, setPagina } = useApp()
  return (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, height:54, background:BG, borderTop:'1px solid #1a2540', display:'flex', zIndex:100 }}>
      {MOBILE_NAV.map(n=>(
        <button key={n.id} onClick={()=>setPagina(n.id)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:1, background:'none', border:'none', cursor:'pointer', padding:'6px 0', color:pagina===n.id?'#7aacff':'#4a6a8a', borderTop:pagina===n.id?`2px solid ${AZ}`:'2px solid transparent' }}>
          <span style={{ fontSize:18 }}>{n.icon}</span>
          <span style={{ fontSize:8, fontWeight:pagina===n.id?'bold':'normal' }}>{n.id}</span>
        </button>
      ))}
    </div>
  )
}
