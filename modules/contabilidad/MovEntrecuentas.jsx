// modules — MovEntrecuentas.jsx
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

export default function MovEntrecuentas() {
  const { session } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [cuentas, setCuentas]   = useState([])
  const [movs, setMovs]         = useState([])
  const [form, setForm]         = useState(null)
  const [msg, setMsg]           = useState(null)
  const [guardando, setGuardando] = useState(false)
  const hoy = new Date().toISOString().split('T')[0]

  async function cargar() {
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from('con_cuentas_banco').select('*').eq('consorcio_id', consorcioId).eq('activa', true),
      supabase.from('con_mov_entre_cuentas').select('*').eq('consorcio_id', consorcioId)
        .order('fecha', { ascending: false }).limit(100),
    ])
    setCuentas(c || [])
    setMovs(m || [])
  }

  async function guardar() {
    if (!form?.cuenta_origen) return setMsg({ tipo:'warn', texto:'Seleccioná la cuenta de origen' })
    if (!form?.cuenta_destino) return setMsg({ tipo:'warn', texto:'Seleccioná la cuenta de destino' })
    if (form.cuenta_origen === form.cuenta_destino) return setMsg({ tipo:'warn', texto:'Las cuentas deben ser diferentes' })
    if (!form?.monto || parseFloat(form.monto) <= 0) return setMsg({ tipo:'warn', texto:'Ingresá el monto' })
    if (!form?.fecha) return setMsg({ tipo:'warn', texto:'Ingresá la fecha' })
    setGuardando(true)
    if (form.id) {
      await supabase.from('con_mov_entre_cuentas').update({
        fecha: form.fecha, cuenta_origen: form.cuenta_origen,
        cuenta_destino: form.cuenta_destino, monto: parseFloat(form.monto),
        concepto: form.concepto||null, referencia: form.referencia||null,
      }).eq('id', form.id)
      setMsg({ tipo:'ok', texto:'✓ Movimiento actualizado' })
    } else {
      const { error } = await supabase.from('con_mov_entre_cuentas').insert([{
        id: `MEC-${Date.now()}`,
        admin_id: uid, consorcio_id: consorcioId,
        fecha: form.fecha, cuenta_origen: form.cuenta_origen,
        cuenta_destino: form.cuenta_destino, monto: parseFloat(form.monto),
        concepto: form.concepto || null, referencia: form.referencia || null,
      }])
      if (error) { setMsg({ tipo:'error', texto: error.message }); setGuardando(false); return }
      setMsg({ tipo:'ok', texto:'✓ Movimiento registrado' })
    }
    setForm(null); cargar()
    setGuardando(false)
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este movimiento entre cuentas?')) return
    await supabase.from('con_mov_entre_cuentas').delete().eq('id', id)
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const fmt = n => '$' + Number(n||0).toLocaleString('es-AR', { minimumFractionDigits:2 })
  const fmtD = d => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'
  const nombreCuenta = id => cuentas.find(c=>c.id===id)?.nombre || id
  const [busqueda, setBusqueda] = useState('')
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')
  const movsFiltr = movs.filter(m=>{
    const q=busqueda.toLowerCase()
    return (!q||m.concepto?.toLowerCase().includes(q)||nombreCuenta(m.cuenta_origen).toLowerCase().includes(q))
      && (!fDesde||m.fecha>=fDesde) && (!fHasta||m.fecha<=fHasta)
  })
  function handlePDF(){
    exportarPDF({titulo:'Movimientos entre Cuentas',logoB64:null,
      columnas:[{key:'fecha',label:'Fecha',nowrap:true},{key:'origen',label:'Cuenta Origen'},
        {key:'dest',label:'Cuenta Destino'},{key:'concepto',label:'Concepto'},{key:'monto',label:'Monto',align:'right'}],
      filas:movsFiltr.map(m=>({fecha:fmtD(m.fecha),origen:nombreCuenta(m.cuenta_origen),
        dest:nombreCuenta(m.cuenta_destino),concepto:m.concepto||'',monto:fmt(m.monto)})),
      totales:{fecha:'TOTAL',origen:'',dest:'',concepto:'',monto:fmt(movsFiltr.reduce((a,m)=>a+parseFloat(m.monto||0),0))}
    })
  }
  function handleExcel(){
    exportarExcel({titulo:'Mov-Entre-Cuentas',
      columnas:[{key:'fecha',label:'Fecha'},{key:'origen',label:'Origen'},{key:'dest',label:'Destino'},
        {key:'concepto',label:'Concepto'},{key:'ref',label:'Referencia'},{key:'monto',label:'Monto'}],
      filas:movsFiltr.map(m=>({fecha:m.fecha,origen:nombreCuenta(m.cuenta_origen),dest:nombreCuenta(m.cuenta_destino),
        concepto:m.concepto||'',ref:m.referencia||'',monto:m.monto}))
    })
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>↔️ Movimientos entre cuentas</div>
        <Btn onClick={() => setForm({ fecha: hoy })} disabled={cuentas.length < 2}>
          + Registrar movimiento
        </Btn>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:8 }}>
        Transferencias entre cuentas bancarias del consorcio sin afectar el saldo total
      </div>
      {/* Filtros */}
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ flex:1, minWidth:160, position:'relative' }}>
          <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:GR }}>🔍</span>
          <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar concepto, cuenta..."
            style={{ width:'100%', paddingLeft:34, padding:'8px 10px 8px 34px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
        </div>
        <div style={{ display:'flex', gap:4, alignItems:'center', fontSize:12, color:GR }}>
          <input type="date" value={fDesde} onChange={e=>setFDesde(e.target.value)} style={{ padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12 }} />
          <span>—</span>
          <input type="date" value={fHasta} onChange={e=>setFHasta(e.target.value)} style={{ padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12 }} />
          {(fDesde||fHasta) && <Btn small onClick={()=>{setFDesde('');setFHasta('')}} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>}
        </div>
        <Btn small color={GR} onClick={handlePDF}>🖨️ PDF</Btn>
        <Btn small color={VD} onClick={handleExcel}>📊 Excel</Btn>
      </div>
      <Msg data={msg} />

      {cuentas.length < 2 && (
        <Card style={{ marginBottom:16, background:'#fff8f0', border:'1px solid #fed7aa' }}>
          <div style={{ fontSize:12, color:'#92400e' }}>
            ⚠️ Necesitás al menos dos cuentas bancarias activas para registrar movimientos entre cuentas.
            Configurá las cuentas en <strong>🏛️ Cuentas bancarias</strong>.
          </div>
        </Card>
      )}

      {form && cuentas.length >= 2 && (
        <Card style={{ marginBottom:16, border:'1.5px solid #bae6fd' }}>
          <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>{form.id?'✏ Editar movimiento entre cuentas':'↔️ Nuevo movimiento entre cuentas'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Sel label="Cuenta origen (salida)" value={form.cuenta_origen||''} onChange={v=>setForm(f=>({...f,cuenta_origen:v}))}
              opts={[{v:'',l:'— Seleccione —'},...cuentas.map(c=>({v:c.id,l:c.nombre}))]} />
            <Sel label="Cuenta destino (entrada)" value={form.cuenta_destino||''} onChange={v=>setForm(f=>({...f,cuenta_destino:v}))}
              opts={[{v:'',l:'— Seleccione —'},...cuentas.filter(c=>c.id!==form.cuenta_origen).map(c=>({v:c.id,l:c.nombre}))]} />
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Monto *</div>
              <input type="number" min="0" step="0.01" value={form.monto||''}
                onChange={e=>setForm(f=>({...f,monto:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontWeight:700, boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:14 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Fecha *</div>
              <input type="date" value={form.fecha||hoy} onChange={e=>setForm(f=>({...f,fecha:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Concepto</div>
              <input value={form.concepto||''} placeholder="ej: Depósito cobranzas"
                onChange={e=>setForm(f=>({...f,concepto:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Referencia</div>
              <input value={form.referencia||''} placeholder="N° operación"
                onChange={e=>setForm(f=>({...f,referencia:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar} disabled={guardando}>{guardando?'⏳':'✓ Registrar'}</Btn>
            <BtnSec onClick={()=>{setForm(null);setMsg(null)}}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      <Card>
        <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>
          Historial ({movs.length} movimientos)
        </div>
        {movs.length === 0 ? (
          <div style={{ textAlign:'center', padding:24, color:GR }}>Sin movimientos registrados</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Fecha','De','A','Concepto','Monto',''].map((h,i) => (
                    <th key={i} style={{ padding:'7px 10px', textAlign:i===4?'right':'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movsFiltr.map(m => (
                  <tr key={m.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>{fmtD(m.fecha)}</td>
                    <td style={{ padding:'7px 10px', fontSize:11 }}>
                      <span style={{ color:RJ }}>↑</span> {nombreCuenta(m.cuenta_origen)}
                    </td>
                    <td style={{ padding:'7px 10px', fontSize:11 }}>
                      <span style={{ color:VD }}>↓</span> {nombreCuenta(m.cuenta_destino)}
                    </td>
                    <td style={{ padding:'7px 10px', color:GR }}>{m.concepto || '—'}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700, color:AZ }}>{fmt(m.monto)}</td>
                    <td style={{ padding:'7px 10px' }}>
                      <div style={{ display:'flex', gap:4 }}>
                        <Btn small onClick={()=>setForm({...m})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                        <Btn small onClick={()=>eliminar(m.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
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
