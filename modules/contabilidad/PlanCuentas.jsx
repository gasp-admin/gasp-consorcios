// modules — PlanCuentas.jsx
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

export default function PlanCuentas() {
  const { session, consorcioActivo} = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [cuentas, setCuentas] = useState([])
  const [form, setForm]       = useState(null)
  const [msg, setMsg]         = useState(null)
  const [guardando, setGuardando] = useState(false)

  const CATS_DEFAULT = [
    { codigo:'1.1', nombre:'Sueldos y cargas sociales',  categoria:'sueldos',          criterio:'prorrateo', orden:1 },
    { codigo:'1.2', nombre:'Servicios públicos',          categoria:'electricidad',     criterio:'prorrateo', orden:2 },
    { codigo:'1.3', nombre:'Seguros',                     categoria:'seguros',          criterio:'prorrateo', orden:3 },
    { codigo:'1.4', nombre:'Mantenimiento y reparaciones',categoria:'mantenimiento',    criterio:'prorrateo', orden:4 },
    { codigo:'1.5', nombre:'Gastos bancarios',            categoria:'gastos_bancarios', criterio:'prorrateo', orden:5 },
    { codigo:'1.6', nombre:'Honorarios administración',   categoria:'honorarios_admin', criterio:'prorrateo', orden:6 },
    { codigo:'1.7', nombre:'Impuesto municipal',          categoria:'impuesto_municipal',criterio:'prorrateo',orden:7 },
    { codigo:'1.8', nombre:'Varios y emergencias',        categoria:'varios',           criterio:'prorrateo', orden:8 },
    { codigo:'2.1', nombre:'Fondo de obras',              categoria:'fondo_obras',      criterio:'prorrateo', orden:9 },
    { codigo:'2.2', nombre:'Fondo de reserva',            categoria:'fondo_reserva',    criterio:'prorrateo', orden:10 },
  ]

  const CRITERIOS = [
    { v:'prorrateo', l:'Prorrateo por coeficiente' },
    { v:'directo',   l:'Cargo directo a unidad' },
    { v:'fijo',      l:'Importe fijo por unidad' },
  ]

  async function cargar() {
    // Cargar cuentas del consorcio + cuentas globales
    const [{ data: propias }, { data: globales }] = await Promise.all([
      supabase.from('con_plan_cuentas').select('*').eq('consorcio_id', consorcioId).order('orden'),
      supabase.from('con_plan_cuentas').select('*').eq('consorcio_id', 'GLOBAL').order('orden'),
    ])
    // Cuentas propias primero, luego globales que no estén solapadas
    const propiasCodigos = new Set((propias||[]).map(c=>c.codigo))
    const globalesFiltradas = (globales||[]).filter(c => !propiasCodigos.has(c.codigo))
      .map(c => ({...c, esGlobal: true}))
    setCuentas([...(propias||[]), ...globalesFiltradas])
  }

  async function cargarDefaults() {
    if (!confirm(`¿Cargar el plan de cuentas estándar? Se agregarán ${CATS_DEFAULT.length} rubros predefinidos.`)) return
    const inserts = CATS_DEFAULT.map(c => ({
      id: `PC-${consorcioId}-${c.codigo.replace('.','')}-${Date.now()}`,
      admin_id: uid,
      consorcio_id: consorcioId,
      ...c,
      activo: true,
    }))
    const { error } = await supabase.from('con_plan_cuentas').upsert(inserts, { onConflict:'consorcio_id,codigo' })
    if (error) setMsg({ tipo:'error', texto: error.message })
    else { setMsg({ tipo:'ok', texto:'✓ Plan de cuentas estándar cargado' }); cargar() }
  }

  async function guardar() {
    if (!form?.codigo?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el código' })
    if (!form?.nombre?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el nombre' })
    setGuardando(true)
    const payload = {
      admin_id: uid,
      consorcio_id: consorcioId,
      codigo: form.codigo.trim(),
      nombre: form.nombre.trim(),
      categoria: form.categoria || 'varios',
      criterio: form.criterio || 'prorrateo',
      orden: parseInt(form.orden)||0,
      activo: true,
    }
    const { error } = form.id
      ? await supabase.from('con_plan_cuentas').update(payload).eq('id', form.id)
      : await supabase.from('con_plan_cuentas').insert([{ id:`PC-${Date.now()}`, ...payload }])
    if (error) setMsg({ tipo:'error', texto: error.message })
    else { setMsg({ tipo:'ok', texto:'✓ Cuenta guardada' }); setForm(null); cargar() }
    setGuardando(false)
  }

  async function toggleActivo(c) {
    await supabase.from('con_plan_cuentas').update({ activo: !c.activo }).eq('id', c.id)
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const CRITERIO_LABEL = { prorrateo:'Prorrateo', directo:'Directo', fijo:'Fijo' }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>📑 Plan de cuentas</div>
        <div style={{ display:'flex', gap:8 }}>
          {cuentas.length === 0 &&
            <BtnSec onClick={cargarDefaults}>⬇ Cargar estándar</BtnSec>}
          <Btn onClick={()=>setForm({ criterio:'prorrateo', orden: cuentas.length+1 })}>+ Nueva cuenta</Btn>
        </div>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Rubros de gastos configurables para este consorcio
      </div>
      <Msg data={msg} />

      {form && (
        <Card style={{ marginBottom:16, border:'1.5px solid #bae6fd' }}>
          <div style={{ fontWeight:700, color:AZ, fontSize:13, marginBottom:14 }}>
            {form.id ? 'Editar cuenta' : 'Nueva cuenta'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Código *</div>
              <input value={form.codigo||''} placeholder="1.1"
                onChange={e=>setForm(f=>({...f,codigo:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Nombre *</div>
              <input value={form.nombre||''} placeholder="Nombre del rubro"
                onChange={e=>setForm(f=>({...f,nombre:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Orden</div>
              <input type="number" value={form.orden||''} min="0"
                onChange={e=>setForm(f=>({...f,orden:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
            <Sel label="Criterio de distribución" value={form.criterio||'prorrateo'}
              onChange={v=>setForm(f=>({...f,criterio:v}))} opts={CRITERIOS} />
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Categoría interna</div>
              <input value={form.categoria||''} placeholder="sueldos, seguros, varios..."
                onChange={e=>setForm(f=>({...f,categoria:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar} disabled={guardando}>{guardando?'⏳':'✓ Guardar'}</Btn>
            <BtnSec onClick={()=>{setForm(null);setMsg(null)}}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {cuentas.length === 0 ? (
        <Card>
          <div style={{ textAlign:'center', padding:32, color:GR }}>
            <div style={{ fontSize:28, marginBottom:8 }}>📑</div>
            <div style={{ fontWeight:600, marginBottom:8 }}>Sin plan de cuentas configurado</div>
            <div style={{ fontSize:12, marginBottom:16 }}>
              Cargue el plan estándar o cree sus propios rubros
            </div>
            <Btn onClick={cargarDefaults}>⬇ Cargar plan estándar</Btn>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['#','Código','Nombre','Criterio','Categoría','Estado',''].map((h,i) => (
                    <th key={i} style={{ padding:'8px 10px', textAlign:'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cuentas.map(c => (
                  <tr key={c.id} style={{ borderBottom:'1px solid #f3f4f6', opacity:c.activo?1:0.45 }}>
                    <td style={{ padding:'8px 10px', color:GR, fontSize:11 }}>{c.orden}</td>
                    <td style={{ padding:'8px 10px', fontWeight:700, color:AZ }}>{c.codigo}</td>
                    <td style={{ padding:'8px 10px', fontWeight:500 }}>{c.nombre}</td>
                    <td style={{ padding:'8px 10px' }}>
                      <Badge text={CRITERIO_LABEL[c.criterio]||c.criterio}
                        color={AZ} bg='#eff6ff' />
                    </td>
                    <td style={{ padding:'8px 10px', color:GR, fontSize:12 }}>{c.categoria}</td>
                    <td style={{ padding:'8px 10px' }}>
                      <Badge text={c.activo?'Activa':'Inactiva'}
                        color={c.activo?VD:GR} bg={c.activo?'#dcfce7':'#f3f4f6'} />
                    </td>
                    <td style={{ padding:'8px 10px' }}>
                      <div style={{ display:'flex', gap:6 }}>
                        <Btn small onClick={()=>setForm({...c})}
                          style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                        <Btn small onClick={()=>toggleActivo(c)}
                          style={{ background: c.activo?'#fee2e2':'#dcfce7',
                            color: c.activo?RJ:VD }}>
                          {c.activo?'✕':'✓'}
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
