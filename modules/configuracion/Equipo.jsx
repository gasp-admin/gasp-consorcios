import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Equipo() {
  const { session, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, expensas, setExpensas, proveedores, setProveedores, adminPerfil, setAdminPerfil, esSuperAdmin, consorcios, setConsorcios, pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, navItems, secciones, navActivo, formCon, setFormCon, msgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [miembros, setMiembros] = useState([])
  const [form, setForm]         = useState(null)
  const [msg, setMsg]           = useState(null)
  const [cargando, setCargando] = useState(false)
  const ROLES=[['admin','👑 Admin Principal','Acceso total'],['administrativo','💼 Administrativo','Liquidaciones, cobranzas, comunicaciones'],['contador','🧮 Contador/Auditor','Solo lectura: reportes y balances'],['asistente','🙋 Asistente','Copropietarios, reclamos, comunicaciones']]
  const rolInfo = r => ROLES.find(([v])=>v===r)||['','—','']
  const cargar = async () => {
    setCargando(true)
    const {data:{session:sess}}=await supabase.auth.getSession()
    const res=await fetch(SUPA_URL+'/functions/v1/gestionar-usuarios-empresa',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+sess?.access_token,'apikey':process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||''},body:JSON.stringify({action:'list_team',admin_id:session.user.id})})
    const data=await res.json(); setMiembros(data.members||[]); setCargando(false)
  }
  useEffect(()=>{ cargar() },[])
  const invitar = async () => {
    if (!form?.email?.trim()) return setMsg({tipo:'warn',texto:'El email es requerido'})
    setCargando(true)
    const {data:{session:sess}}=await supabase.auth.getSession()
    const res=await fetch(SUPA_URL+'/functions/v1/gestionar-usuarios-empresa',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+sess?.access_token,'apikey':process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||''},body:JSON.stringify({action:'invite',admin_id:session.user.id,email:form.email.trim(),rol:form.rol,nombre:form.nombre||''})})
    const data=await res.json()
    if (data.error) setMsg({tipo:'error',texto:data.error})
    else {setMsg({tipo:'ok',texto:'✓ Invitación enviada a '+form.email});setForm(null);cargar()}
    setCargando(false)
  }
  const revocar = async (id,email) => {
    if (!confirm('¿Revocar acceso de '+email+'?')) return
    const {data:{session:sess}}=await supabase.auth.getSession()
    await fetch(SUPA_URL+'/functions/v1/gestionar-usuarios-empresa',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+sess?.access_token,'apikey':process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||''},body:JSON.stringify({action:'revoke',admin_id:session.user.id,member_id:id})})
    setMsg({tipo:'ok',texto:'✓ Acceso revocado'}); cargar()
  }
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <div style={{fontWeight:700,fontSize:15}}>👥 Equipo</div>
        <Btn small onClick={()=>setForm({rol:'administrativo'})}>+ Invitar miembro</Btn>
      </div>
      <div style={{fontSize:12,color:GR,marginBottom:16}}>Usuarios con acceso a GASP Consorcios para esta administración</div>
      <Msg data={msg}/>
      {form&&(
        <Card style={{marginBottom:14,border:'1.5px solid '+AZ}}>
          <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:12}}>+ Invitar nuevo miembro</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
            <Input label="Email" value={form.email||''} onChange={v=>setForm(x=>({...x,email:v}))} type="email" placeholder="usuario@email.com"/>
            <Input label="Nombre" value={form.nombre||''} onChange={v=>setForm(x=>({...x,nombre:v}))} placeholder="Apellido, Nombre"/>
            <div>
              <div style={{fontSize:12,color:GR,marginBottom:4}}>Rol</div>
              <select value={form.rol||'administrativo'} onChange={e=>setForm(x=>({...x,rol:e.target.value}))} style={{width:'100%',padding:'8px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13}}>{ROLES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
            </div>
          </div>
          <div style={{background:'#f0f4ff',borderRadius:8,padding:'10px 14px',fontSize:12,color:GR,marginBottom:12}}><strong>{rolInfo(form.rol)[1]}:</strong> {rolInfo(form.rol)[2]}</div>
          <div style={{display:'flex',gap:8}}><Btn onClick={invitar} disabled={cargando}>✉ Enviar invitación</Btn><BtnSec onClick={()=>setForm(null)}>Cancelar</BtnSec></div>
        </Card>
      )}
      {cargando?(<Card><div style={{textAlign:'center',padding:'24px 0',color:GR}}>⏳ Cargando...</div></Card>):(
        <Card style={{padding:0,overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
            <thead><tr style={{background:'#f8fafc',borderBottom:'1.5px solid #e5e7eb'}}>{['Miembro','Rol','Estado','Desde',''].map((h,i)=><th key={i} style={{padding:'9px 14px',textAlign:'left',fontWeight:600,color:'#374151',fontSize:12}}>{h}</th>)}</tr></thead>
            <tbody>
              <tr style={{borderBottom:'1px solid #f3f4f6',background:'#f0f8ff'}}>
                <td style={{padding:'9px 14px'}}><div style={{fontWeight:700}}>{session.user.email}</div><div style={{fontSize:11,color:GR}}>Administrador Principal</div></td>
                <td style={{padding:'9px 14px'}}><span style={{fontSize:11,padding:'2px 8px',borderRadius:6,background:'#fef3c7',color:'#92400e',fontWeight:700}}>👑 Admin principal</span></td>
                <td style={{padding:'9px 14px'}}><span style={{color:VD,fontWeight:600,fontSize:11}}>● Activo</span></td>
                <td style={{padding:'9px 14px',color:GR,fontSize:11}}>Siempre</td><td></td>
              </tr>
              {miembros.map(m=>(
                <tr key={m.id} style={{borderBottom:'1px solid #f3f4f6'}}>
                  <td style={{padding:'9px 14px'}}><div style={{fontWeight:600}}>{m.email}</div>{m.nombre&&<div style={{fontSize:11,color:GR}}>{m.nombre}</div>}</td>
                  <td style={{padding:'9px 14px'}}><span style={{fontSize:11,padding:'2px 8px',borderRadius:6,background:'#eff6ff',color:AZ,fontWeight:600}}>{rolInfo(m.rol)[1]}</span></td>
                  <td style={{padding:'9px 14px'}}><span style={{color:m.estado==='activo'?VD:AM,fontWeight:600,fontSize:11}}>{m.estado==='activo'?'● Activo':m.estado==='pendiente'?'◐ Pendiente':'○ Inactivo'}</span></td>
                  <td style={{padding:'9px 14px',color:GR,fontSize:11}}>{m.created_at?new Date(m.created_at).toLocaleDateString('es-AR'):'—'}</td>
                  <td style={{padding:'9px 14px'}}><button type="button" onClick={()=>revocar(m.id,m.email)} style={{padding:'4px 10px',background:'#fff',color:RJ,border:'1px solid '+RJ,borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer'}}>Revocar</button></td>
                </tr>
              ))}
              {miembros.length===0&&<tr><td colSpan={5} style={{padding:'24px',textAlign:'center',color:GR,fontSize:12}}>Solo vos tenés acceso. Invitá miembros con el botón de arriba.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
