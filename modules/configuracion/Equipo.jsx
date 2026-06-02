import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabaseClient'

const ROLES_DISP = [
  { v:'administrativo', l:'Administrativo', desc:'Ver, editar, liquidar, cobrar' },
  { v:'contador',       l:'Contador/Auditor', desc:'Solo lectura y auditoria' },
  { v:'asistente',      l:'Asistente', desc:'Solo visualizacion' },
]
const ROL_LABEL = {
  admin_principal:'Admin Principal',
  administrativo:'Administrativo',
  contador:'Contador/Auditor',
  asistente:'Asistente'
}
const ROL_EMOJI = {
  admin_principal:'crown',
  administrativo:'briefcase',
  contador:'abacus',
  asistente:'hand'
}
const ROL_PERMISOS = {
  admin_principal:['Acceso completo sin restricciones'],
  administrativo: ['Ver todos los modulos','Editar datos','Emitir liquidaciones','Cobros','X Gestion equipo','X Configuracion'],
  contador:       ['Ver todos los modulos','Auditoria y exportacion','X Editar datos','X Liquidaciones'],
  asistente:      ['Ver todos los modulos','X Editar','X Exportar','X Liquidaciones'],
}
const BC = {
  admin_principal:{bg:'#eff6ff',c:'#1d4ed8',b:'#bfdbfe'},
  administrativo: {bg:'#f0fdf4',c:'#15803d',b:'#bbf7d0'},
  contador:       {bg:'#fefce8',c:'#a16207',b:'#fde68a'},
  asistente:      {bg:'#fdf4ff',c:'#7e22ce',b:'#e9d5ff'},
}

export default function Equipo() {
  const { session } = useApp()
  const uid = session?.user?.id
  const [equipo, setEquipo]   = useState([])
  const [invit, setInvit]     = useState([])
  const [form, setForm]       = useState(null)
  const [msg, setMsg]         = useState(null)
  const [tab, setTab]         = useState('equipo')
  const [rolYo, setRolYo]     = useState('admin_principal')
  const [loading, setLoading] = useState(false)

  async function cargar() {
    const { data: eq  } = await supabase.from('con_equipo').select('*').eq('admin_id', uid).order('created_at')
    const { data: inv } = await supabase.from('con_invitaciones').select('*').eq('admin_id', uid).eq('estado','pendiente').order('created_at',{ascending:false})
    setEquipo(eq || [])
    setInvit(inv || [])
    const yo = (eq || []).find(e => e.usuario_id === uid)
    setRolYo(yo?.rol || 'admin_principal')
  }
  useEffect(() => { if (uid) cargar() }, [uid])

  async function invitar() {
    if (!form?.email) return setMsg({ t:'w', m:'Ingresa el email del colaborador' })
    if (!form?.rol)   return setMsg({ t:'w', m:'Selecciona un rol' })
    setLoading(true); setMsg(null)
    const { error } = await supabase.from('con_invitaciones').insert({ admin_id: uid, email: form.email, rol: form.rol })
    if (error) setMsg({ t:'e', m: error.message })
    else {
      setMsg({ t:'ok', m: 'Invitacion registrada para ' + form.email + '. Compartile el link de acceso al sistema.' })
      setForm(null)
      cargar()
    }
    setLoading(false)
  }

  async function cambiarRol(id, rol) {
    await supabase.from('con_equipo').update({ rol }).eq('id', id)
    setMsg({ t:'ok', m:'Rol actualizado correctamente' })
    cargar()
  }

  async function toggleActivo(id, activo) {
    if (!activo && !confirm('Desactivar este miembro? Perdera el acceso al sistema.')) return
    await supabase.from('con_equipo').update({ activo }).eq('id', id)
    cargar()
  }

  async function cancelarInv(id) {
    await supabase.from('con_invitaciones').update({ estado:'cancelada' }).eq('id', id)
    cargar()
  }

  const soyAdmin = rolYo === 'admin_principal'
  const BG = { ok:'#f0fdf4', w:'#fffbe6', e:'#fef2f2' }
  const TC = { ok:'#15803d', w:'#a16207', e:'#dc2626' }
  const BD = { ok:'#bbf7d0', w:'#fde68a', e:'#fecaca' }

  if (!soyAdmin) return (
    <div style={{ padding:32, textAlign:'center', color:'#6b7280' }}>
      <div style={{ fontWeight:700, fontSize:15, color:'#374151', marginBottom:8 }}>Solo el Administrador Principal puede gestionar el equipo</div>
      <div style={{ marginTop:12, padding:'8px 16px', background:'#f0f9ff', borderRadius:8, display:'inline-block', fontSize:12 }}>
        Tu rol actual: <strong>{ROL_LABEL[rolYo] || rolYo}</strong>
      </div>
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15 }}>Gestion de Equipo</div>
          <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>
            {equipo.filter(e=>e.activo).length} miembro(s) activo(s) — acceden desde su propia PC
          </div>
        </div>
        <button onClick={() => setForm({})}
          style={{ background:'#1d4ed8', color:'#fff', border:'none', borderRadius:8, padding:'9px 18px', fontWeight:600, cursor:'pointer', fontSize:13 }}>
          + Invitar miembro
        </button>
      </div>

      <div style={{ display:'flex', gap:4, borderBottom:'2px solid #e5e7eb', marginBottom:16 }}>
        {[
          ['equipo','Equipo activo'],
          ['invitaciones', 'Invitaciones' + (invit.length ? ' (' + invit.length + ')' : '')],
          ['roles','Guia de roles']
        ].map(([t,l]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding:'8px 14px', border:'none', background:'none', cursor:'pointer',
              fontWeight:tab===t?700:400, color:tab===t?'#1d4ed8':'#6b7280',
              borderBottom:tab===t?'2px solid #1d4ed8':'2px solid transparent', marginBottom:-2, fontSize:13 }}>
            {l}
          </button>
        ))}
      </div>

      {msg && (
        <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:12, fontSize:13, fontWeight:500,
          background:BG[msg.t], color:TC[msg.t], border:'1px solid ' + BD[msg.t] }}>
          {msg.m}
          <button onClick={() => setMsg(null)}
            style={{ float:'right', background:'none', border:'none', cursor:'pointer', color:'inherit' }}>
            cerrar
          </button>
        </div>
      )}

      {form && (
        <div style={{ background:'#f0f9ff', border:'1.5px solid #bfdbfe', borderRadius:10, padding:16, marginBottom:16 }}>
          <div style={{ fontWeight:700, color:'#1d4ed8', marginBottom:12 }}>Invitar nuevo miembro al equipo</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:3 }}>Email *</label>
              <input type="email" value={form.email || ''}
                onChange={e => setForm(f => ({ ...f, email:e.target.value }))}
                placeholder="email@ejemplo.com"
                style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:3 }}>Nombre (opcional)</label>
              <input value={form.nombre || ''}
                onChange={e => setForm(f => ({ ...f, nombre:e.target.value }))}
                placeholder="Nombre completo"
                style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:6 }}>Rol *</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {ROLES_DISP.map(r => (
                <div key={r.v} onClick={() => setForm(f => ({ ...f, rol:r.v }))}
                  style={{ padding:'10px 12px',
                    border:'2px solid ' + (form.rol===r.v?'#1d4ed8':'#e5e7eb'),
                    borderRadius:8, cursor:'pointer',
                    background:form.rol===r.v?'#eff6ff':'#fff' }}>
                  <div style={{ fontWeight:600, fontSize:13 }}>{r.l}</div>
                  <div style={{ fontSize:11, color:'#6b7280', marginTop:2 }}>{r.desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={invitar} disabled={loading}
              style={{ background:'#1d4ed8', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontWeight:600, cursor:'pointer', fontSize:13 }}>
              {loading ? 'Guardando...' : 'Registrar invitacion'}
            </button>
            <button onClick={() => setForm(null)}
              style={{ background:'#f3f4f6', color:'#374151', border:'none', borderRadius:7, padding:'9px 20px', cursor:'pointer', fontSize:13 }}>
              Cancelar
            </button>
          </div>
          <div style={{ marginTop:10, fontSize:11, color:'#6b7280' }}>
            Compartile el enlace de acceso al sistema. Una vez registrado con ese email, tendra acceso automatico segun su rol.
          </div>
        </div>
      )}

      {tab === 'equipo' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {equipo.length === 0 ? (
            <div style={{ textAlign:'center', padding:40, color:'#9ca3af' }}>
              <div style={{ fontSize:13, marginBottom:4 }}>No hay miembros en el equipo todavia.</div>
              <div style={{ fontSize:12 }}>Invita colaboradores para que accedan al sistema desde su propia PC.</div>
            </div>
          ) : equipo.map(m => {
            const bc = BC[m.rol] || BC.asistente
            return (
              <div key={m.id} style={{
                background:m.activo?'#fff':'#f9fafb',
                border:'1px solid ' + (m.activo?'#e5e7eb':'#d1d5db'),
                borderRadius:10, padding:'12px 16px',
                display:'flex', alignItems:'center', gap:12,
                opacity:m.activo?1:0.6
              }}>
                <div style={{
                  width:40, height:40, borderRadius:'50%',
                  background:bc.bg, border:'2px solid ' + bc.b,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontWeight:800, fontSize:14, color:bc.c, flexShrink:0
                }}>
                  {m.nombre ? m.nombre.charAt(0).toUpperCase() : m.email.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:2 }}>
                    <span style={{ fontWeight:700, fontSize:13 }}>{m.nombre || m.email}</span>
                    <span style={{
                      padding:'2px 8px', borderRadius:12, fontSize:11, fontWeight:600,
                      background:bc.bg, color:bc.c, border:'1px solid ' + bc.b
                    }}>
                      {ROL_LABEL[m.rol] || m.rol}
                    </span>
                    {!m.activo && (
                      <span style={{ padding:'2px 8px', borderRadius:12, fontSize:11, background:'#f3f4f6', color:'#9ca3af' }}>
                        Inactivo
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:12, color:'#6b7280' }}>{m.email}</div>
                  <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>
                    {(ROL_PERMISOS[m.rol] || []).filter(p => !p.startsWith('X')).slice(0,2).join(' · ')}
                  </div>
                </div>
                {m.rol !== 'admin_principal' && (
                  <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                    {m.activo ? (
                      <>
                        <select value={m.rol} onChange={e => cambiarRol(m.id, e.target.value)}
                          style={{ padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, cursor:'pointer' }}>
                          {ROLES_DISP.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                        </select>
                        <button onClick={() => toggleActivo(m.id, false)}
                          style={{ padding:'5px 12px', background:'#fee2e2', color:'#dc2626', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 }}>
                          Desactivar
                        </button>
                      </>
                    ) : (
                      <button onClick={() => toggleActivo(m.id, true)}
                        style={{ padding:'5px 12px', background:'#f0fdf4', color:'#15803d', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 }}>
                        Reactivar
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'invitaciones' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {invit.length === 0 ? (
            <div style={{ textAlign:'center', padding:40, color:'#9ca3af' }}>
              <div style={{ fontSize:13 }}>No hay invitaciones pendientes.</div>
            </div>
          ) : invit.map(i => (
            <div key={i.id} style={{
              background:'#fffbe6', border:'1px solid #fde68a',
              borderRadius:10, padding:'12px 16px',
              display:'flex', alignItems:'center', gap:12
            }}>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600, fontSize:13 }}>{i.email}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>
                  Rol: {ROL_LABEL[i.rol]} — Vence: {new Date(i.expires_at).toLocaleDateString('es-AR')}
                </div>
              </div>
              <button onClick={() => cancelarInv(i.id)}
                style={{ padding:'5px 12px', background:'#fee2e2', color:'#dc2626', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 }}>
                Cancelar
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'roles' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {Object.entries(ROL_PERMISOS).map(([rol, perms]) => {
            const bc = BC[rol] || BC.asistente
            return (
              <div key={rol} style={{ background:bc.bg, border:'1.5px solid ' + bc.b, borderRadius:10, padding:16 }}>
                <div style={{ fontWeight:700, color:bc.c, fontSize:14, marginBottom:10 }}>
                  {ROL_LABEL[rol]}
                </div>
                <ul style={{ margin:0, paddingLeft:16 }}>
                  {perms.map((p, i) => (
                    <li key={i} style={{ fontSize:12, marginBottom:4, color:p.startsWith('X ')?'#9ca3af':'#374151' }}>
                      {p.startsWith('X ') ? '❌ ' + p.slice(2) : '✅ ' + p}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
