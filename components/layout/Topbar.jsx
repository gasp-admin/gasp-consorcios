// components/layout/Topbar.jsx — Barra superior de GASP Consorcios.

import { useApp } from '../../context/AppContext'

export default function Topbar() {
  const { isMobile, setMenuAbierto, navActivo, consorcios, consorcioActivo, setConsorcioActivo, cargarConsorcio, session } = useApp()

  return (
    <div style={{ height:52, background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', padding:'0 20px', gap:14, position:'sticky', top:0, zIndex:100 }}>
      {isMobile&&<button onClick={()=>setMenuAbierto(v=>!v)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:22, color:'#374151', padding:'0 6px' }}>☰</button>}
      <div style={{ flex:1, fontWeight:700, color:'#111', fontSize:15 }}>{navActivo?.icon} {navActivo?.label||'Dashboard'}</div>
      {consorcioActivo&&(
        <select value={consorcioActivo?.id||''} onChange={e=>{ const c=consorcios.find(x=>x.id===e.target.value); if(c){setConsorcioActivo(c);cargarConsorcio(c.id,session?.user?.id)} }} style={{ padding:'4px 10px', borderRadius:20, border:'1px solid #e5e7eb', background:'#f3f4f6', fontSize:12, color:'#374151', fontWeight:600, cursor:'pointer', outline:'none', maxWidth:220 }}>
          {consorcios.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      )}
    </div>
  )
}
