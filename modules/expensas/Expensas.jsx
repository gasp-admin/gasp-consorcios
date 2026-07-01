// modules — Expensas.jsx
// Extraído del V59. Refactorizado: props → useApp(). Cero cambios de comportamiento.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Expensas() {
  const { session, consorcioActivo, expensas, setExpensas, copropietarios, adminPerfil, unidades } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [selected, setSelected] = useState(null)
  const [detalles, setDetalles] = useState([])
  const [gastos, setGastos]     = useState([])
  const [form, setForm]         = useState(null)
  const [formGasto, setFormGasto] = useState(null)
  const [msg, setMsg]           = useState(null)
  const [tab, setTab]           = useState('detalle')
  const F = f => setForm(x=>({...x,...f}))

  async function cargar() {
    const { data } = await supabase.from('con_expensas').select('*')
      .eq('admin_id', uid).eq('consorcio_id', consorcioId)
      .order('periodo', { ascending:false })
    setExpensas(data || [])
  }
  async function cargarDetalle(expId) {
    const [d,g] = await Promise.all([
      supabase.from('con_expensas_detalle').select('*').eq('expensa_id', expId).order('created_at'),
      supabase.from('con_gastos').select('*').eq('expensa_id', expId).order('fecha')
    ])
    setDetalles(d.data||[]); setGastos(g.data||[])
  }
  async function calcularYDistribuir(expensa) {
    if (!expensa || unidades.length===0) return
    setMsg({ tipo:'info', texto:'⏳ Calculando distribución...' })
    const totalGastos=gastos.reduce((a,g)=>a+Number(g.monto||0),0)
    const totalAdmin=Number(expensa.total_administracion||0)
    const totalExpensa=totalGastos+totalAdmin
    await supabase.from('con_expensas').update({ total_gastos:totalGastos, total_expensa:totalExpensa }).eq('id', expensa.id)
    const coefTotal=unidades.reduce((a,u)=>a+Number(u.porcentaje_fiscal||0),0)
    if (coefTotal===0) return setMsg({ tipo:'warn', texto:'Las UFs no tienen coeficiente asignado' })
    await supabase.from('con_expensas_detalle').delete().eq('expensa_id', expensa.id)
    const detallesNuevos=unidades.map(u=>{
      const coef=Number(u.porcentaje_fiscal||0)
      const monto=Math.round((totalExpensa*(coef/coefTotal))*100)/100
      return { id:`DET-${expensa.id}-${u.id}`, admin_id:uid, expensa_id:expensa.id, unidad_id:u.id, consorcio_id:consorcioId, monto, estado:'pendiente', saldo_anterior:0, pagos_periodo:0 }
    })
    await supabase.from('con_expensas_detalle').insert(detallesNuevos)
    await cargarDetalle(expensa.id)
    setSelected({...expensa, total_gastos:totalGastos, total_expensa:totalExpensa})
    setMsg({ tipo:'ok', texto:`✓ Distribuido entre ${unidades.length} unidades. Total: ${fmt(totalExpensa)}` })
    cargar()
  }
  async function marcarPagada(det) {
    await supabase.from('con_expensas_detalle').update({ estado:'pagada', fecha_pago:new Date().toISOString().split('T')[0], pagos_periodo:det.monto }).eq('id', det.id)
    cargarDetalle(selected.id); setMsg({ tipo:'ok', texto:'✓ Marcado como pagado' })
  }
  async function guardarExpensa() {
    if (!form.periodo) return setMsg({ tipo:'warn', texto:'El período es obligatorio' })
    const id=form.id||nextId(expensas,'EXP')
    const { error }=await supabase.from('con_expensas').upsert({ ...form, id, admin_id:uid, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Expensa guardada' }); cargar()
  }
  async function guardarGasto() {
    if (!formGasto.concepto||!formGasto.monto) return setMsg({ tipo:'warn', texto:'Concepto y monto obligatorios' })
    const g={...formGasto, admin_id:uid, consorcio_id:consorcioId, expensa_id:selected.id}
    if (formGasto.id) await supabase.from('con_gastos').update(g).eq('id', formGasto.id)
    else await supabase.from('con_gastos').insert([{...g, id:nextId(gastos,'GAS')}])
    setFormGasto(null); cargarDetalle(selected.id); setMsg({ tipo:'ok', texto:'✓ Gasto registrado' })
  }
  async function generarPDF(expensa) {
    const { data:conData } = await supabase.from('con_consorcios').select('*').eq('id', consorcioId).single()
    const { data:expFresca } = await supabase.from('con_expensas').select('*').eq('id', expensa.id).single()
    generarPDFLiquidacion({ consorcioActivo:conData||{nombre:consorcioId}, expensa:expFresca||expensa, gastos, detalles, unidades, copropietarios, adminPerfil })
  }
  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const CATEGORIAS=['limpieza','mantenimiento','seguro','seguros','honorarios','honorarios_admin','servicios_publicos','electricidad','gas','reparaciones','administracion','gastos_bancarios','impuesto_municipal','sueldos','cargas_sociales','otro']

  if (selected) {
    const totalGasDet=gastos.reduce((a,g)=>a+Number(g.monto||0),0)
    const cobradas=detalles.filter(d=>d.estado==='pagada').length
    const pendientes=detalles.filter(d=>d.estado!=='pagada').length
    const morosas=detalles.filter(d=>d.estado==='morosa').length
    const esCerrada = selected.estado === 'cerrada' || selected.tipo === 'migracion'
    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
          <BtnSec onClick={() => { setSelected(null); setDetalles([]); setGastos([]) }}>← Volver</BtnSec>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:16, display:'flex', alignItems:'center', gap:8 }}>
              Expensas {periodoLabel(selected.periodo)}
              {esCerrada && (
                <span style={{ fontSize:11, padding:'2px 10px', background:'#f3f4f6', color:'#374151',
                  borderRadius:4, fontWeight:600 }}>🔒 Solo lectura</span>
              )}
            </div>
            <div style={{ fontSize:12, color:GR }}>{selected.tipo} · Vto: {fmtD(selected.fecha_vencimiento)}</div>
          </div>
          {!esCerrada && (
            <Btn onClick={() => calcularYDistribuir(selected)} color={AM}>⚡ Calcular y distribuir</Btn>
          )}
          <Btn onClick={() => generarPDF(selected)}>🖨 PDF liquidación</Btn>
        </div>
        {esCerrada && (
          <div style={{ marginBottom:16, padding:'10px 16px', background:'#f0f4ff',
            border:'1px solid #bfdbfe', borderRadius:8, fontSize:12, color:'#1e40af' }}>
            📋 Este período está <strong>cerrado</strong>. Puede consultar el detalle e imprimir la liquidación en PDF.
            No se permite modificar gastos ni recalcular distribuciones.
          </div>
        )}
        <Msg data={msg} />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
          {[{l:'Total expensa',v:fmt(selected.total_expensa),c:AZ},{l:'Cobradas',v:cobradas,c:VD},{l:'Pendientes',v:pendientes,c:AM},{l:'Morosas',v:morosas,c:RJ}].map((k,i)=>(
            <Card key={i} style={{ textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:800, color:k.c }}>{k.v}</div>
              <div style={{ fontSize:11, color:GR, marginTop:4 }}>{k.l}</div>
            </Card>
          ))}
        </div>
        <div style={{ display:'flex', gap:4, marginBottom:16 }}>
          {['detalle','gastos'].map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{ padding:'7px 18px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, background:tab===t?AZ:'#f3f4f6', color:tab===t?'#fff':'#555', fontWeight:tab===t?'bold':'normal' }}>
              {t==='detalle'?'🏢 Por unidad':'💸 Gastos'}
            </button>
          ))}
        </div>
        {tab==='detalle' && (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['UF','Copropietario','Coef. %','Saldo ant.','Monto','Pagado','Estado','Acciones'].map((h,i)=>(
                    <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detalles.map(d=>{
                  const u=unidades.find(x=>x.id===d.unidad_id)
                  const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
                  const ec=d.estado==='pagada'?{c:VD,bg:'#dcfce7'}:d.estado==='morosa'?{c:RJ,bg:'#fee2e2'}:{c:AM,bg:'#fef9c3'}
                  return (
                    <tr key={d.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'10px 12px', fontWeight:700, color:AZ }}>{u?.numero||d.unidad_id}</td>
                      <td style={{ padding:'10px 12px' }}>{cp?.apellido_nombre||'—'}</td>
                      <td style={{ padding:'10px 12px' }}>{u?.porcentaje_fiscal?Number(u.porcentaje_fiscal).toFixed(4)+'%':'—'}</td>
                      <td style={{ padding:'10px 12px', color:parseFloat(d.saldo_anterior)>0?RJ:GR }}>{parseFloat(d.saldo_anterior)>0?fmt(d.saldo_anterior):'—'}</td>
                      <td style={{ padding:'10px 12px', fontWeight:700 }}>{fmt(d.monto)}</td>
                      <td style={{ padding:'10px 12px', color:VD }}>{parseFloat(d.pagos_periodo)>0?fmt(d.pagos_periodo):'—'}</td>
                      <td style={{ padding:'10px 12px' }}><Badge text={d.estado} color={ec.c} bg={ec.bg} /></td>
                      <td style={{ padding:'10px 12px' }}>
                        {d.estado!=='pagada' && (
                          <div style={{ display:'flex', gap:6 }}>
                            <Btn small color={VD} onClick={()=>marcarPagada(d)}>✓ Pagada</Btn>
                            <Btn small color={RJ} onClick={async()=>{await supabase.from('con_expensas_detalle').update({estado:'morosa'}).eq('id',d.id);cargarDetalle(selected.id)}}>⚠ Morosa</Btn>
                          </div>
                        )}
                        {d.estado==='pagada' && <Badge text="✓ Cobrada" color={VD} bg='#dcfce7' />}
                      </td>
                    </tr>
                  )
                })}
                {detalles.length===0 && <tr><td colSpan={8} style={{ padding:20, textAlign:'center', color:GR }}>Sin distribución. Hacé clic en "Calcular y distribuir".</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {tab==='gastos' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={{ fontWeight:600 }}>Total gastos: <span style={{ color:AZ, fontSize:16 }}>{fmt(totalGasDet)}</span></div>
              {!esCerrada && (
                <Btn small onClick={()=>setFormGasto({fecha:new Date().toISOString().split('T')[0],categoria:'limpieza'})}>+ Agregar gasto</Btn>
              )}
            </div>
            {formGasto && (
              <Card style={{ marginBottom:14, border:`1px solid ${AZ}` }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
                  <Input label="Fecha" value={formGasto.fecha} onChange={v=>setFormGasto(x=>({...x,fecha:v}))} type="date" required />
                  <Input label="Concepto" value={formGasto.concepto} onChange={v=>setFormGasto(x=>({...x,concepto:v}))} required />
                  <Sel label="Categoría" value={formGasto.categoria} onChange={v=>setFormGasto(x=>({...x,categoria:v}))} opts={CATEGORIAS} />
                  <Input label="Monto $" value={formGasto.monto} onChange={v=>setFormGasto(x=>({...x,monto:v}))} type="number" required />
                  <Input label="Proveedor" value={formGasto.proveedor_nombre} onChange={v=>setFormGasto(x=>({...x,proveedor_nombre:v}))} />
                  <Input label="N° comprobante" value={formGasto.comprobante} onChange={v=>setFormGasto(x=>({...x,comprobante:v}))} />
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <Btn small onClick={guardarGasto}>Guardar</Btn>
                  <BtnSec small onClick={()=>setFormGasto(null)}>Cancelar</BtnSec>
                </div>
              </Card>
            )}
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['Fecha','Concepto','Categoría','Proveedor','Comprobante','Monto',''].map((h,i)=>(
                      <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gastos.map(g=>(
                    <tr key={g.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'9px 12px' }}>{fmtD(g.fecha)}</td>
                      <td style={{ padding:'9px 12px' }}>{g.concepto}</td>
                      <td style={{ padding:'9px 12px', textTransform:'capitalize' }}>{g.categoria||'—'}</td>
                      <td style={{ padding:'9px 12px' }}>{g.proveedor_nombre||'—'}</td>
                      <td style={{ padding:'9px 12px', color:GR }}>{g.comprobante||'—'}</td>
                      <td style={{ padding:'9px 12px', fontWeight:700 }}>{fmt(g.monto)}</td>
                      <td style={{ padding:'9px 12px' }}><Btn small onClick={()=>setFormGasto({...g})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn></td>
                    </tr>
                  ))}
                  {gastos.length===0 && <tr><td colSpan={7} style={{ padding:20, textAlign:'center', color:GR }}>Sin gastos registrados.</td></tr>}
                  {gastos.length>0 && <tr style={{ background:'#f3f4f6', fontWeight:700 }}><td colSpan={5} style={{ padding:'9px 12px' }}>+ Honorarios administración</td><td colSpan={2} style={{ padding:'9px 12px' }}>{fmt(selected.total_administracion)}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Expensas ({expensas.length})</div>
        <Btn onClick={()=>setForm({periodo:periodoActual(),tipo:'ordinaria',total_administracion:0,estado:'abierta'})}>+ Nuevo período</Btn>
      </div>
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>Nuevo período de expensas</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Input label="Período (YYYY-MM)" value={form.periodo} onChange={v=>F({periodo:v})} placeholder="2026-05" required />
            <Sel label="Tipo" value={form.tipo} onChange={v=>F({tipo:v})} opts={['ordinaria','extraordinaria']} />
            <Input label="Vencimiento" value={form.fecha_vencimiento} onChange={v=>F({fecha_vencimiento:v})} type="date" />
            <Input label="Honorarios admin. $" value={form.total_administracion} onChange={v=>F({total_administracion:v})} type="number" />
            <div style={{ gridColumn:'span 4' }}><Input label="Descripción / observaciones" value={form.descripcion} onChange={v=>F({descripcion:v})} /></div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardarExpensa}>💾 Crear período</Btn>
            <BtnSec onClick={()=>setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {expensas.map(exp=>{
          const ec=exp.estado==='cobrada'?{c:VD,bg:'#dcfce7'}:exp.estado==='cerrada'?{c:GR,bg:'#f3f4f6'}:{c:AM,bg:'#fef9c3'}
          const esCerradaItem = exp.estado === 'cerrada' || exp.tipo === 'migracion'
          const abrirDetalle = async (e) => {
            e.stopPropagation()
            setSelected(exp)
            await cargarDetalle(exp.id)
          }
          return (
            <Card key={exp.id} style={{ cursor:'pointer' }}
              onClick={abrirDetalle}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                    <span style={{ fontWeight:700, fontSize:15 }}>{periodoLabel(exp.periodo)}</span>
                    {exp.tipo !== 'migracion' && <Badge text={exp.tipo} color={exp.tipo==='extraordinaria'?RJ:AZ} />}
                    <Badge text={exp.estado} color={ec.c} bg={ec.bg} />
                    {esCerradaItem && <span style={{ fontSize:11, color:'#6b7280' }}>🔒 Solo lectura</span>}
                  </div>
                  <div style={{ fontSize:12, color:GR, display:'flex', gap:16, flexWrap:'wrap' }}>
                    {exp.fecha_vencimiento && <span>📅 Vto: {fmtD(exp.fecha_vencimiento)}</span>}
                    {exp.total_expensa>0 && <span>💰 Total: {fmt(exp.total_expensa)}</span>}
                    {exp.descripcion && <span style={{ maxWidth:340, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{exp.descripcion}</span>}
                  </div>
                </div>
                <button
                  onClick={abrirDetalle}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px',
                    background: esCerradaItem ? '#f0f4ff' : '#1A3FA0',
                    color: esCerradaItem ? '#1A3FA0' : '#fff',
                    border: esCerradaItem ? '1px solid #bfdbfe' : 'none',
                    borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer',
                    whiteSpace:'nowrap', flexShrink:0 }}>
                  {esCerradaItem ? '🔍 Ver liquidación' : '›'}
                </button>
              </div>
            </Card>
          )
        })}
        {expensas.length===0 && <Card style={{ textAlign:'center', color:GR, padding:32 }}><div style={{ fontSize:32, marginBottom:8 }}>📋</div><div>No hay períodos de expensas. Creá el primero.</div></Card>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. COBRANZAS (MÓDULO NUEVO)
// ══════════════════════════════════════════════════════════════════════════════
