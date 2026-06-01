// modules — Proveedores.jsx
// Extraído del V59. Props → useApp().

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Proveedores() {
  const { session, consorcioActivo, consorcios, proveedores } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [lista, setLista] = useState([])
  const [form, setForm]   = useState(null)
  const [msg, setMsg]     = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const F = f => setForm(x=>({...x,...f}))

  async function cargar() {
    const { data } = await supabase.from('con_proveedores').select('*').eq('admin_id',uid).or(`consorcio_id.eq.${consorcioId},consorcio_id.is.null`).order('razon_social')
    setLista(data||[])
  }
  async function guardar() {
    if (!form.razon_social) return setMsg({ tipo:'warn', texto:'Razón social obligatoria' })
    const esNuevo = !form.id
    const id = form.id || nextId(lista,'PRV')
    // Nuevo proveedor → global (null). Edición → conserva el consorcio_id que tenía.
    const consorcio_id_guardar = esNuevo ? null : (form.consorcio_id ?? null)
    const { error }=await supabase.from('con_proveedores').upsert(
      { ...form, id, admin_id:uid, consorcio_id: consorcio_id_guardar },
      { onConflict:'id' }
    )
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null)
    setMsg({ tipo:'ok', texto: esNuevo ? '✓ Proveedor guardado — disponible en todos los consorcios' : '✓ Actualizado' })
    cargar()
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar?')) return
    await supabase.from('con_proveedores').delete().eq('id',id); cargar()
  }
  useEffect(()=>{ if (consorcioId) cargar() },[consorcioId])
  const RUBROS=['limpieza','plomería','electricidad','gas','pintura','jardinería','ascensores','seguros','administración','otros']
  const filtrados = lista.filter(p => {
    const q = busqueda.toLowerCase()
    return !q || p.razon_social?.toLowerCase().includes(q) || p.cuit?.toLowerCase().includes(q)
      || p.rubro?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
  })
  function handlePDF() {
    exportarPDF({titulo:'Listado de Proveedores',logoB64:null,
      columnas:[{key:'razon',label:'Razón Social'},{key:'cuit',label:'CUIT'},
        {key:'rubro',label:'Rubro'},{key:'tel',label:'Teléfono'},{key:'email',label:'Email'},
        {key:'cbu',label:'CBU'},{key:'ambito',label:'Ámbito'}],
      filas:filtrados.map(p=>({razon:p.razon_social||'',cuit:p.cuit||'',rubro:p.rubro||'',
        tel:p.telefono||'',email:p.email||'',cbu:p.cbu||'',ambito:p.consorcio_id?'Este consorcio':'Global'}))
    })
  }
  function handleExcel() {
    exportarExcel({titulo:'Proveedores',
      columnas:[{key:'razon',label:'Razón Social'},{key:'cuit',label:'CUIT'},{key:'rubro',label:'Rubro'},
        {key:'tel',label:'Teléfono'},{key:'email',label:'Email'},{key:'cbu',label:'CBU'},{key:'alias',label:'Alias CBU'},
        {key:'fiscal',label:'Situación Fiscal'},{key:'ambito',label:'Ámbito'}],
      filas:filtrados.map(p=>({razon:p.razon_social||'',cuit:p.cuit||'',rubro:p.rubro||'',
        tel:p.telefono||'',email:p.email||'',cbu:p.cbu||'',alias:p.alias_cbu||'',
        fiscal:p.tipo_fiscal||'',ambito:p.consorcio_id?'Este consorcio':'Global'}))
    })
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15 }}>Proveedores ({lista.length})</div>
          <div style={{ fontSize:11, color:GR, marginTop:2 }}>Los nuevos proveedores quedan disponibles en todos los consorcios</div>
        </div>
        <Btn onClick={()=>setForm({activo:true})}>+ Agregar</Btn>
      </div>
      <BarraListado busqueda={busqueda} onBuscar={setBusqueda} onPDF={handlePDF} onExcel={handleExcel} placeholder="Buscar por razón social, CUIT, rubro..." />
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:6 }}>{form.id?'Editar proveedor':'Nuevo proveedor'}</div>
          {!form.id && (
            <div style={{ fontSize:11, color:'#6b7280', marginBottom:14, background:'#f0f9ff', padding:'6px 10px', borderRadius:6 }}>
              🌐 El proveedor quedará disponible en <strong>todos sus consorcios</strong>
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Input label="Razón social" value={form.razon_social||''} onChange={v=>F({razon_social:v})} required />
            <Input label="CUIT" value={form.cuit||''} onChange={v=>F({cuit:v})} />
            <Sel label="Rubro" value={form.rubro||''} onChange={v=>F({rubro:v})} opts={[{v:'',l:'Seleccionar...'},...RUBROS]} />
            <Input label="Teléfono" value={form.telefono||''} onChange={v=>F({telefono:v})} />
            <Input label="Email" value={form.email||''} onChange={v=>F({email:v})} />
            <Input label="Dirección" value={form.direccion||''} onChange={v=>F({direccion:v})} />
            <Input label="CBU" value={form.cbu||''} onChange={v=>F({cbu:v})} />
            <Input label="Alias CBU" value={form.alias_cbu||''} onChange={v=>F({alias_cbu:v})} />
            <Sel label="Situación fiscal" value={form.tipo_fiscal||'monotributo'} onChange={v=>F({tipo_fiscal:v})} opts={[{v:'monotributo',l:'Monotributo'},{v:'responsable_inscripto',l:'Resp. Inscripto'},{v:'exento',l:'Exento'},{v:'consumidor_final',l:'Consumidor Final'}]} />
            <div style={{ gridColumn:'span 3' }}><Input label="Notas" value={form.notas||''} onChange={v=>F({notas:v})} /></div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar</Btn>
            <BtnSec onClick={()=>setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {filtrados.map(p=>(
          <Card key={p.id}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <span style={{ fontWeight:700, fontSize:14 }}>{p.razon_social}</span>
                  {!p.consorcio_id
                    ? <span style={{ fontSize:9, background:'#dbeafe', color:'#1e40af', borderRadius:4, padding:'1px 6px', fontWeight:600 }}>🌐 GLOBAL</span>
                    : <span style={{ fontSize:9, background:'#fef9c3', color:'#854d0e', borderRadius:4, padding:'1px 6px', fontWeight:600 }}>📌 ESTE CONSORCIO</span>
                  }
                </div>
                <div style={{ fontSize:11, color:GR, marginTop:3 }}>
                  {p.rubro && <Badge text={p.rubro} color={AZ} style={{ marginRight:6 }} />}
                  {p.cuit && `CUIT: ${p.cuit}`}
                </div>
                <div style={{ fontSize:12, color:GR, marginTop:4, display:'flex', gap:10, flexWrap:'wrap' }}>
                  {p.telefono && <span>📱 {p.telefono}</span>}
                  {p.email && <span>✉ {p.email}</span>}
                  {p.cbu && <span>🏦 {p.cbu}</span>}
                </div>
              </div>
              <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                <Btn small onClick={()=>setForm({...p})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                <Btn small onClick={()=>eliminar(p.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
              </div>
            </div>
          </Card>
        ))}
        {lista.length===0 && <Card style={{ textAlign:'center', color:GR, padding:32, gridColumn:'span 2' }}>Sin proveedores.</Card>}
      </div>
    </div>
  )
}
