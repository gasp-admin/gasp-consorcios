// components/layout/Sidebar.jsx — Sidebar de GASP Consorcios.
// Antes: embebido inline dentro del return() de App().
// Ahora: componente independiente que consume useApp().

import { useApp } from '../../context/AppContext'
import { BtnSec } from '../ui'
import { BG, AZ } from '../../lib/config'

export default function Sidebar() {
  const { session, logout, isMobile, menuAbierto, setMenuAbierto, pagina, setPagina, navItems, secciones, consorcios, consorcioActivo, setConsorcioActivo, cargarConsorcio, unidades, reclamosAbiertos } = useApp()

  return (
    <aside style={{ width:220, background:BG, display:'flex', flexDirection:'column', position:'fixed', top:0, left:0, height:'100vh', zIndex:200, overflowY:'auto', transform:isMobile&&!menuAbierto?'translateX(-100%)':'translateX(0)', transition:'transform 0.25s ease' }}>
      <div style={{ padding:'14px 14px 12px', borderBottom:'1px solid #1a2540' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
          <div style={{ width:38, height:38, background:AZ, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:14, fontWeight:900, flexShrink:0 }}>G</div>
          <div>
            <div style={{ fontSize:18, fontWeight:800, color:'#fff', lineHeight:1 }}>GASP</div>
            <div style={{ fontSize:9, color:'#4a6a8a', letterSpacing:'0.1em' }}>CONSORCIOS</div>
          </div>
        </div>
        <div style={{ marginTop:8 }}>
          <select value={consorcioActivo?.id||''} onChange={e=>{ const c=consorcios.find(x=>x.id===e.target.value); if(c){setConsorcioActivo(c);cargarConsorcio(c.id,session?.user?.id)} }} style={{ width:'100%', padding:'6px 8px', background:'rgba(26,63,160,0.3)', border:'1px solid rgba(122,172,255,0.3)', borderRadius:6, color:'#7ab4ff', fontSize:11, fontWeight:700, cursor:'pointer', outline:'none' }}>
            {consorcios.length===0&&<option value="">Sin consorcios</option>}
            {consorcios.map(c=><option key={c.id} value={c.id} style={{ background:'#0f1f3d', color:'#fff' }}>{c.nombre}</option>)}
          </select>
          {consorcioActivo&&<div style={{ fontSize:9, color:'#4a6a8a', marginTop:3, textAlign:'center' }}>{unidades.length} UFs · {consorcioActivo.banco||'Sin banco'}</div>}
        </div>
      </div>
      <nav style={{ flex:1, padding:'10px 8px' }}>
        {secciones.map(sec=>(
          <div key={sec}>
            <div style={{ fontSize:9, color:'#3a5a7a', fontWeight:'bold', letterSpacing:'0.15em', textTransform:'uppercase', padding:'10px 10px 4px' }}>{sec}</div>
            {navItems.filter(n=>n.sec===sec).map(n=>(
              <div key={n.id} onClick={()=>{setPagina(n.id);setMenuAbierto(false)}} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', cursor:'pointer', borderRadius:7, margin:'1px 0', background:pagina===n.id?'rgba(26,63,160,0.25)':'transparent', color:pagina===n.id?'#7aacff':'#8aaabf', fontWeight:pagina===n.id?'bold':'normal', fontSize:13, transition:'all 0.15s' }}>
                <span style={{ fontSize:15, width:20, textAlign:'center', flexShrink:0 }}>{n.icon}</span>
                <span style={{ flex:1 }}>{n.label}</span>
                {n.id==='reclamos' && reclamosAbiertos>0 && (
                  <span style={{ background:'#B91C1C', color:'#fff', fontSize:10, fontWeight:800, minWidth:18, height:18, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 5px', flexShrink:0 }}>
                    {reclamosAbiertos>99?'99+':reclamosAbiertos}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </nav>
      <div style={{ padding:'12px 14px', borderTop:'1px solid #1a2540' }}>
        <div style={{ fontSize:11, color:'#4a6a8a', marginBottom:8 }}>{session?.user?.email}</div>
        <BtnSec small onClick={logout} style={{ width:'100%', justifyContent:'center', color:'#8aaabf', borderColor:'#1a2540', background:'transparent' }}>Cerrar sesión</BtnSec>
      </div>
    </aside>
  )
}
