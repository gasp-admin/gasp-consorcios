// modules — MovimientosUnidad.jsx
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

export default function MovimientosUnidad() {
  const { session, consorcioId, unidades, copropietarios, expensas } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [form, setForm]       = useState(null)
  const [movs, setMovs]       = useState([])
  const [filtroUF, setFiltroUF] = useState('')
  const [msg, setMsg]         = useState(null)
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    const q = supabase.from('con_movimientos_unidad').select('*')
      .eq('consorcio_id', consorcioId).order('created_at', { ascending: false }).limit(100)
    if (filtroUF) q.eq('unidad_id', filtroUF)
    const { data } = await q
    setMovs(data || [])
  }

  async function guardar() {
    if (!form?.unidad_id)  return setMsg({ tipo:'warn', texto:'Seleccioná una unidad' })
    if (!form?.tipo)        return setMsg({ tipo:'warn', texto:'Seleccioná el tipo' })
    if (!form?.concepto?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el concepto' })
    if (!form?.monto || parseFloat(form.monto) <= 0) return setMsg({ tipo:'warn', texto:'Ingresá un monto válido' })
    if (!form?.fecha)       return setMsg({ tipo:'warn', texto:'Ingresá la fecha' })

    setGuardando(true)
    const { error } = await supabase.from('con_movimientos_unidad').insert([{
      id: `MOV-${Date.now()}`,
      admin_id: uid,
      consorcio_id: consorcioId,
      unidad_id: form.unidad_id,
      expensa_id: form.expensa_id || null,
      tipo: form.tipo,
      concepto: form.concepto.trim(),
      categoria: form.categoria || 'varios',
      monto: parseFloat(form.monto),
      fecha: form.fecha,
      fecha_vencimiento: form.fecha_vencimiento || null,
      numero_comprobante: form.numero_comprobante || null,
      notas: form.notas || null,
      estado: 'vigente',
    }])

    if (error) {
      setMsg({ tipo:'error', texto: 'Error: ' + error.message })
    } else {
      setMsg({ tipo:'ok', texto: `✓ ${form.tipo === 'debito' ? 'Nota de débito' : 'Nota de crédito'} registrada` })
      setForm(null)
      cargar()
    }
    setGuardando(false)
  }

  async function anular(id) {
    if (!confirm('¿Anular este movimiento?')) return
    await supabase.from('con_movimientos_unidad')
      .update({ estado:'anulado', anulado_por: uid })
      .eq('id', id)
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId, filtroUF])

  const fmt = n => '$' + (Number(n)||0).toLocaleString('es-AR')
  const hoy = new Date().toISOString().split('T')[0]

  const CATEGORIAS = [
    { v:'ajuste_inicial',  l:'Ajuste inicial / saldo anterior' },
    { v:'gasto_directo',   l:'Gasto directo a unidad' },
    { v:'interes',         l:'Quita / ajuste de interés' },
    { v:'convenio_pago',   l:'Convenio de pago' },
    { v:'reintegro',       l:'Reintegro de gasto' },
    { v:'varios',          l:'Varios' },
  ]

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>↕️ Notas de débito / crédito</div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn small color={RJ} onClick={() => setForm({ tipo:'debito',  fecha: hoy })}>+ Débito</Btn>
          <Btn small color={VD} onClick={() => setForm({ tipo:'credito', fecha: hoy })}>+ Crédito</Btn>
        </div>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Ajustes directos en la cuenta corriente de una unidad funcional
      </div>
      <Msg data={msg} />

      {/* Formulario */}
      {form && (
        <Card style={{ marginBottom:16, border:`1.5px solid ${form.tipo==='debito'?'#fca5a5':'#86efac'}`,
          background: form.tipo==='debito' ? '#fff8f8' : '#f0fdf4' }}>
          <div style={{ fontWeight:700, color: form.tipo==='debito'?RJ:VD, fontSize:13, marginBottom:14 }}>
            {form.tipo === 'debito' ? '📤 Nueva nota de débito' : '📥 Nueva nota de crédito'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <Sel label="Unidad" value={form.unidad_id||''} onChange={v => setForm(f => ({...f, unidad_id:v}))}
              opts={[{ v:'', l:'— Seleccione UF —' },
                ...unidades.map(u => {
                  const cp2 = copropietarios.find(c => c.id === u.propietario_id)
                  return { v:u.id, l:`${u.numero} — ${cp2?.apellido_nombre||'Sin prop.'}` }
                })
              ]} />
            <Sel label="Categoría" value={form.categoria||'varios'} onChange={v => setForm(f => ({...f, categoria:v}))}
              opts={CATEGORIAS} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Concepto *</div>
              <input value={form.concepto||''} onChange={e => setForm(f => ({...f, concepto:e.target.value}))}
                placeholder="Descripción del movimiento"
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                  borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Monto *</div>
              <input type="number" min="0" step="0.01" value={form.monto||''}
                onChange={e => setForm(f => ({...f, monto:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                  borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Fecha *</div>
              <input type="date" value={form.fecha||''} onChange={e => setForm(f => ({...f, fecha:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                  borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:14 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>N° comprobante</div>
              <input value={form.numero_comprobante||''} placeholder="Opcional"
                onChange={e => setForm(f => ({...f, numero_comprobante:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                  borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Vencimiento</div>
              <input type="date" value={form.fecha_vencimiento||''}
                onChange={e => setForm(f => ({...f, fecha_vencimiento:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                  borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Período asociado</div>
              <select value={form.expensa_id||''} onChange={e => setForm(f => ({...f, expensa_id:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                  borderRadius:7, fontSize:13, background:'#fff' }}>
                <option value="">Sin período</option>
                {expensas.map(e => <option key={e.id} value={e.id}>{e.periodo}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Notas internas</div>
            <input value={form.notas||''} placeholder="Opcional"
              onChange={e => setForm(f => ({...f, notas:e.target.value}))}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar} disabled={guardando}
              style={{ background: form.tipo==='debito'?RJ:VD, color:'#fff' }}>
              {guardando ? '⏳' : '✓ Guardar'}
            </Btn>
            <BtnSec onClick={() => { setForm(null); setMsg(null) }}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {/* Filtro */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ flex:1 }}>
            <Sel label="Filtrar por unidad" value={filtroUF} onChange={setFiltroUF}
              opts={[{ v:'', l:'Todas las unidades' },
                ...unidades.map(u => {
                  const cp2 = copropietarios.find(c => c.id === u.propietario_id)
                  return { v:u.id, l:`${u.numero} — ${cp2?.apellido_nombre||''}` }
                })
              ]} />
          </div>
          <div style={{ fontSize:13, color:GR, marginTop:18 }}>
            {movs.filter(m=>m.estado==='vigente').length} movimientos
          </div>
        </div>
      </Card>

      {/* Listado */}
      <Card>
        {movs.length === 0 ? (
          <div style={{ textAlign:'center', padding:24, color:GR }}>Sin movimientos registrados</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Fecha','Unidad','Tipo','Concepto','Monto','Estado',''].map((h,i) => (
                    <th key={i} style={{ padding:'7px 10px', textAlign: i===4?'right':'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movs.map(m => {
                  const uf  = unidades.find(u => u.id === m.unidad_id)
                  return (
                    <tr key={m.id} style={{ borderBottom:'1px solid #f3f4f6',
                      opacity: m.estado==='anulado' ? 0.45 : 1,
                      background: m.estado==='anulado' ? '#f9fafb' : 'transparent' }}>
                      <td style={{ padding:'7px 10px', whiteSpace:'nowrap', color:GR, fontSize:11 }}>
                        {m.fecha ? new Date(m.fecha+'T00:00:00').toLocaleDateString('es-AR') : '—'}
                      </td>
                      <td style={{ padding:'7px 10px', fontWeight:600 }}>UF {uf?.numero||'?'}</td>
                      <td style={{ padding:'7px 10px' }}>
                        <Badge text={m.tipo==='debito'?'Débito':'Crédito'}
                          color={m.tipo==='debito'?RJ:VD}
                          bg={m.tipo==='debito'?'#fee2e2':'#dcfce7'} />
                      </td>
                      <td style={{ padding:'7px 10px' }}>
                        <div>{m.concepto}</div>
                        {m.numero_comprobante && <div style={{ fontSize:10, color:GR }}>N° {m.numero_comprobante}</div>}
                      </td>
                      <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700,
                        color: m.tipo==='debito'?RJ:VD }}>{fmt(m.monto)}</td>
                      <td style={{ padding:'7px 10px' }}>
                        <Badge text={m.estado==='vigente'?'Vigente':'Anulado'}
                          color={m.estado==='vigente'?VD:GR}
                          bg={m.estado==='vigente'?'#dcfce7':'#f3f4f6'} />
                      </td>
                      <td style={{ padding:'7px 10px' }}>
                        {m.estado === 'vigente' && (
                          <Btn small onClick={() => anular(m.id)}
                            style={{ background:'#fee2e2', color:RJ }}>✕ Anular</Btn>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
