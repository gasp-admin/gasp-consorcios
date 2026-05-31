// modules — MovimientosVarios.jsx
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

export default function MovimientosVarios() {
  const { session, expensas } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [movs, setMovs]       = useState([])
  const [form, setForm]       = useState(null)
  const [msg, setMsg]         = useState(null)
  const [guardando, setGuardando] = useState(false)
  const hoy = new Date().toISOString().split('T')[0]

  async function cargar() {
    const { data } = await supabase.from('con_movimientos_varios').select('*')
      .eq('consorcio_id', consorcioId).order('fecha', { ascending:false }).limit(200)
    setMovs(data || [])
  }

  async function guardar() {
    if (!form?.tipo)             return setMsg({ tipo:'warn', texto:'Seleccioná el tipo' })
    if (!form?.concepto?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el concepto' })
    if (!form?.monto || parseFloat(form.monto)<=0) return setMsg({ tipo:'warn', texto:'Ingresá el monto' })
    if (!form?.fecha)            return setMsg({ tipo:'warn', texto:'Ingresá la fecha' })
    setGuardando(true)
    if (form.id) {
      // Edición
      await supabase.from('con_movimientos_varios').update({
        tipo: form.tipo, concepto: form.concepto.trim(),
        categoria: form.categoria||'varios', monto: parseFloat(form.monto),
        fecha: form.fecha, medio_pago: form.medio_pago||'transferencia',
        referencia: form.referencia||null, notas: form.notas||null,
        expensa_id: form.expensa_id||null,
      }).eq('id', form.id)
      setMsg({ tipo:'ok', texto:'✓ Movimiento actualizado' })
    } else {
      const { error } = await supabase.from('con_movimientos_varios').insert([{
        id: `MV-${Date.now()}`,
        admin_id: uid, consorcio_id: consorcioId,
        expensa_id: form.expensa_id || null,
        tipo: form.tipo, concepto: form.concepto.trim(),
        categoria: form.categoria || 'varios', monto: parseFloat(form.monto),
        fecha: form.fecha, medio_pago: form.medio_pago || 'transferencia',
        referencia: form.referencia || null, notas: form.notas || null,
        estado: 'vigente',
      }])
      if (error) { setMsg({ tipo:'error', texto: error.message }); setGuardando(false); return }
      setMsg({ tipo:'ok', texto:'✓ Movimiento registrado' })
    }
    setForm(null); cargar()
    setGuardando(false)
  }

  async function anular(id) {
    if (!confirm('¿Anular este movimiento?')) return
    await supabase.from('con_movimientos_varios').update({ estado:'anulado' }).eq('id', id)
    cargar()
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar definitivamente este movimiento?')) return
    await supabase.from('con_movimientos_varios').delete().eq('id', id)
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const fmt = n => '$' + (Number(n)||0).toLocaleString('es-AR')
  const fmtD = d => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'

  const [busqueda, setBusqueda] = useState('')
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')

  const movsFiltr = movs.filter(m => {
    const q = busqueda.toLowerCase()
    const ok_q = !q || m.concepto?.toLowerCase().includes(q) || m.categoria?.toLowerCase().includes(q)
    const ok_d = !fDesde || m.fecha >= fDesde
    const ok_h = !fHasta || m.fecha <= fHasta
    return ok_q && ok_d && ok_h
  })

  const totalIngresos = movsFiltr.filter(m=>m.tipo==='ingreso'&&m.estado==='vigente').reduce((a,m)=>a+(parseFloat(m.monto)||0),0)
  const totalEgresos  = movsFiltr.filter(m=>m.tipo==='egreso' &&m.estado==='vigente').reduce((a,m)=>a+(parseFloat(m.monto)||0),0)

  const CATEGORIAS_ING = ['alquiler_espacios','reintegro','multa','donacion','varios']
  const CATEGORIAS_EGR = ['reparacion_urgente','honorarios_extra','impuesto','varios']
  const MEDIOS = ['transferencia','efectivo','cheque_propio','cheque_tercero','otro']

  function handlePDF() {
    exportarPDF({titulo:'Movimientos Varios',logoB64:null,
      columnas:[{key:'fecha',label:'Fecha',nowrap:true},{key:'tipo',label:'Tipo'},{key:'concepto',label:'Concepto'},
        {key:'cat',label:'Categoría'},{key:'medio',label:'Medio'},{key:'monto',label:'Monto',align:'right'},{key:'estado',label:'Estado'}],
      filas:movsFiltr.map(m=>({fecha:fmtD(m.fecha),tipo:m.tipo==='ingreso'?'↓ Ingreso':'↑ Egreso',
        concepto:m.concepto,cat:(m.categoria||'').replace(/_/g,' '),medio:(m.medio_pago||'').replace(/_/g,' '),
        monto:'$'+Number(m.monto||0).toLocaleString('es-AR'),estado:m.estado})),
      totales:{fecha:'TOTAL',tipo:'',concepto:'',cat:'',medio:'',monto:'$'+Number(totalIngresos-totalEgresos).toLocaleString('es-AR'),estado:''}
    })
  }
  function handleExcel() {
    exportarExcel({titulo:'Movimientos-Varios',
      columnas:[{key:'fecha',label:'Fecha'},{key:'tipo',label:'Tipo'},{key:'concepto',label:'Concepto'},
        {key:'cat',label:'Categoría'},{key:'medio',label:'Medio Pago'},{key:'monto',label:'Monto'},{key:'estado',label:'Estado'}],
      filas:movsFiltr.map(m=>({fecha:m.fecha,tipo:m.tipo,concepto:m.concepto,
        cat:(m.categoria||'').replace(/_/g,' '),medio:(m.medio_pago||'').replace(/_/g,' '),monto:m.monto,estado:m.estado}))
    })
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>🔄 Movimientos varios</div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn small color={VD} onClick={()=>setForm({ tipo:'ingreso', fecha:hoy, medio_pago:'transferencia' })}>+ Ingreso</Btn>
          <Btn small color={RJ} onClick={()=>setForm({ tipo:'egreso',  fecha:hoy, medio_pago:'transferencia' })}>+ Egreso</Btn>
        </div>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:8 }}>
        Ingresos y egresos extraordinarios — alquileres, multas, reparaciones urgentes, etc.
      </div>
      {/* Filtros */}
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ flex:1, minWidth:180, position:'relative' }}>
          <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:GR }}>🔍</span>
          <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar concepto, categoría..."
            style={{ width:'100%', paddingLeft:34, padding:'8px 10px 8px 34px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
        </div>
        <div style={{ display:'flex', gap:4, alignItems:'center', fontSize:12, color:GR }}>
          <span>Desde</span>
          <input type="date" value={fDesde} onChange={e=>setFDesde(e.target.value)}
            style={{ padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12 }} />
          <span>hasta</span>
          <input type="date" value={fHasta} onChange={e=>setFHasta(e.target.value)}
            style={{ padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12 }} />
          {(fDesde||fHasta) && <Btn small onClick={()=>{setFDesde('');setFHasta('')}} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>}
        </div>
        <Btn small color={GR} onClick={handlePDF}>🖨️ PDF</Btn>
        <Btn small color={VD} onClick={handleExcel}>📊 Excel</Btn>
      </div>
      <Msg data={msg} />

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
        {[
          { l:'Ingresos varios', v:fmt(totalIngresos), c:VD, bg:'#f0fdf4' },
          { l:'Egresos varios',  v:fmt(totalEgresos),  c:RJ, bg:'#fff1f2' },
          { l:'Neto',           v:`${totalIngresos-totalEgresos>=0?'+':''}${fmt(totalIngresos-totalEgresos)}`,
            c:totalIngresos>=totalEgresos?VD:RJ, bg:'#f8fafc' },
        ].map((k,i)=>(
          <div key={i} style={{ background:k.bg, borderRadius:10, padding:'14px 18px', textAlign:'center' }}>
            <div style={{ fontSize:11, fontWeight:600, color:k.c, textTransform:'uppercase', marginBottom:4 }}>{k.l}</div>
            <div style={{ fontSize:22, fontWeight:800, color:k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Formulario */}
      {form && (
        <Card style={{ marginBottom:16,
          border:`1.5px solid ${form.tipo==='ingreso'?'#86efac':'#fca5a5'}`,
          background: form.tipo==='ingreso'?'#f0fdf4':'#fff8f8' }}>
          <div style={{ fontWeight:700, color:form.tipo==='ingreso'?VD:RJ, fontSize:13, marginBottom:14 }}>
            {form.id
              ? (form.tipo==='ingreso'?'✏ Editar ingreso':'✏ Editar egreso')
              : (form.tipo==='ingreso'?'📥 Nuevo ingreso extraordinario':'📤 Nuevo egreso extraordinario')}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Concepto *</div>
              <input value={form.concepto||''} placeholder="Descripción del movimiento"
                onChange={e=>setForm(f=>({...f,concepto:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Monto *</div>
              <input type="number" min="0" step="0.01" value={form.monto||''}
                onChange={e=>setForm(f=>({...f,monto:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontWeight:700, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Fecha *</div>
              <input type="date" value={form.fecha||''} onChange={e=>setForm(f=>({...f,fecha:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Categoría</div>
              <select value={form.categoria||'varios'}
                onChange={e=>setForm(f=>({...f,categoria:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
                {(form.tipo==='ingreso'?CATEGORIAS_ING:CATEGORIAS_EGR).map(c=>(
                  <option key={c} value={c}>{c.replace(/_/g,' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Medio de pago</div>
              <select value={form.medio_pago||'transferencia'}
                onChange={e=>setForm(f=>({...f,medio_pago:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
                {MEDIOS.map(m=><option key={m} value={m}>{m.replace(/_/g,' ')}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Período asociado</div>
              <select value={form.expensa_id||''} onChange={e=>setForm(f=>({...f,expensa_id:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
                <option value="">Sin período</option>
                {expensas.map(e=><option key={e.id} value={e.id}>{e.periodo}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Referencia / Notas</div>
            <input value={form.notas||''} placeholder="Opcional"
              onChange={e=>setForm(f=>({...f,notas:e.target.value}))}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar} disabled={guardando}
              style={{ background:form.tipo==='ingreso'?VD:RJ, color:'#fff' }}>
              {guardando?'⏳':'✓ Guardar'}
            </Btn>
            <BtnSec onClick={()=>{setForm(null);setMsg(null)}}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {/* Tabla */}
      <Card>
        {movs.length === 0 ? (
          <div style={{ textAlign:'center', padding:24, color:GR }}>Sin movimientos registrados</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Fecha','Tipo','Concepto','Categoría','Medio','Monto','Estado',''].map((h,i)=>(
                    <th key={i} style={{ padding:'7px 10px', textAlign:i===5?'right':'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movsFiltr.map(m=>(
                  <tr key={m.id} style={{ borderBottom:'1px solid #f3f4f6', opacity:m.estado==='anulado'?0.45:1 }}>
                    <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>{fmtD(m.fecha)}</td>
                    <td style={{ padding:'7px 10px' }}>
                      <Badge text={m.tipo==='ingreso'?'↓ Ingreso':'↑ Egreso'}
                        color={m.tipo==='ingreso'?VD:RJ}
                        bg={m.tipo==='ingreso'?'#dcfce7':'#fee2e2'} />
                    </td>
                    <td style={{ padding:'7px 10px', fontWeight:500 }}>{m.concepto}</td>
                    <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>{m.categoria?.replace(/_/g,' ')}</td>
                    <td style={{ padding:'7px 10px', color:GR, fontSize:11, textTransform:'capitalize' }}>{m.medio_pago?.replace(/_/g,' ')}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700,
                      color:m.tipo==='ingreso'?VD:RJ }}>{fmt(m.monto)}</td>
                    <td style={{ padding:'7px 10px' }}>
                      <Badge text={m.estado==='vigente'?'Vigente':'Anulado'}
                        color={m.estado==='vigente'?VD:GR}
                        bg={m.estado==='vigente'?'#dcfce7':'#f3f4f6'} />
                    </td>
                    <td style={{ padding:'7px 10px' }}>
                      <div style={{ display:'flex', gap:4 }}>
                        {m.estado==='vigente' && (
                          <Btn small onClick={()=>setForm({...m})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                        )}
                        {m.estado==='vigente' && (
                          <Btn small onClick={()=>anular(m.id)} style={{ background:'#fff3cd', color:AM }} title="Anular">⊘</Btn>
                        )}
                        <Btn small onClick={()=>eliminar(m.id)} style={{ background:'#fee2e2', color:RJ }} title="Eliminar">✕</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
