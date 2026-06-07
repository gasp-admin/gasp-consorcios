// components/ui/index.jsx
// Componentes UI base de GASP Consorcios — sin lógica de negocio.

import { AZ, VD, RJ, GR } from '../../lib/config'

export function BarraListado({ busqueda, onBuscar, onPDF, onExcel, placeholder = 'Buscar...' }) {
  return (
    <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
      <div style={{ flex:1, minWidth:200, position:'relative' }}>
        <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:GR, fontSize:14 }}>🔍</span>
        <input value={busqueda} onChange={e=>onBuscar(e.target.value)} placeholder={placeholder}
          style={{ width:'100%', paddingLeft:34, paddingRight:10, padding:'8px 10px 8px 34px',
            border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
      </div>
      <Btn small color={GR} onClick={onPDF}>🖨️ PDF</Btn>
      <Btn small color={VD} onClick={onExcel}>📊 Excel</Btn>
    </div>
  )
}

export function Card({ children, style, onClick }) {
  return <div style={{ background:'#fff', border:'0.5px solid #ddd', borderRadius:10, padding:16, ...style, cursor:onClick?'pointer':undefined }} onClick={onClick}>{children}</div>
}

export function Btn({ children, onClick, color, small, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding:small?'5px 12px':'8px 18px', borderRadius:7, border:'none',
        background:disabled?'#e5e7eb':(color||AZ), color:disabled?'#9ca3af':'#fff',
        cursor:disabled?'not-allowed':'pointer', fontSize:small?12:13, fontWeight:600, ...style }}>
      {children}
    </button>
  )
}

export function BtnSec({ children, onClick, small, style }) {
  return (
    <button onClick={onClick}
      style={{ padding:small?'5px 12px':'8px 18px', borderRadius:7,
        border:'1px solid #d1d5db', background:'#fff', cursor:'pointer',
        fontSize:small?12:13, color:'#374151', ...style }}>
      {children}
    </button>
  )
}

export function Input({ label, value, onChange, type='text', placeholder, required }) {
  return (
    <div>
      <div style={{ fontSize:12, color:'#6b7280', marginBottom:4, fontWeight:500 }}>
        {label}{required && <span style={{color:RJ}}> *</span>}
      </div>
      <input type={type} value={value||''} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', boxSizing:'border-box', outline:'none' }} />
    </div>
  )
}

export function Sel({ label, value, onChange, opts, required, disabled }) {
  return (
    <div>
      <div style={{ fontSize:12, color:'#6b7280', marginBottom:4, fontWeight:500 }}>
        {label}{required && <span style={{color:RJ}}> *</span>}
      </div>
      <select value={value||''} onChange={e=>onChange&&onChange(e.target.value)} disabled={disabled}
        style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', background:'#fff' }}>
        {(opts||[]).map(o => <option key={o.v||o} value={o.v||o}>{o.l||o}</option>)}
      </select>
    </div>
  )
}

export function Badge({ text, color='#6b7280', bg }) {
  return (
    <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:'bold', background:bg||color+'20', color }}>
      {text}
    </span>
  )
}

export function Msg({ data }) {
  if (!data) return null
  const colors = { ok:{bg:'#dcfce7',c:'#166534'}, error:{bg:'#fee2e2',c:'#991b1b'}, warn:{bg:'#fef9c3',c:'#854d0e'}, info:{bg:'#dbeafe',c:'#1e40af'} }
  const s = colors[data.tipo] || colors.info
  return <div style={{ background:s.bg, color:s.c, borderRadius:8, padding:'10px 14px', fontSize:13, marginBottom:14 }}>{data.texto}</div>
}
