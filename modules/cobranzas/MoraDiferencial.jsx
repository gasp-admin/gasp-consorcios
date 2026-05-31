// modules — MoraDiferencial.jsx
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

export default function MoraDiferencial() {
  const { session, unidades, copropietarios } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [editId, setEditId]   = useState(null)
  const [form, setForm]       = useState({})
  const [msg, setMsg]         = useState(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar(ufId) {
    setGuardando(true)
    const { error } = await supabase.from('con_unidades').update({
      tasa_mora_diferencial: form.tasa ? parseFloat(form.tasa) : null,
      convenio_pago: form.convenio_pago || false,
      convenio_detalle: form.convenio_detalle || null,
    }).eq('id', ufId)
    if (error) setMsg({ tipo:'error', texto: error.message })
    else { setMsg({ tipo:'ok', texto:'✓ Configuración guardada' }); setEditId(null); setForm({}) }
    setGuardando(false)
  }

  const ufsConConfig = unidades.filter(u => u.tasa_mora_diferencial || u.convenio_pago)

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>⚖️ Interés diferencial por unidad</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Configure tasa de mora personalizada o convenio de pago para unidades específicas
      </div>
      <Msg data={msg} />

      <Card style={{ marginBottom:16, background:'#eff6ff', border:'1px solid #bfdbfe' }}>
        <div style={{ fontSize:12, color:'#1e40af', lineHeight:1.8 }}>
          <strong>Funcionamiento:</strong> Si una UF tiene tasa diferencial, el cálculo de mora
          usa esa tasa en lugar de la tasa global del consorcio. Si tiene convenio de pago activo,
          se suspende el cálculo de mora automático para esa unidad.
        </div>
      </Card>

      {/* UFs con config especial */}
      {ufsConConfig.length > 0 && (
        <Card style={{ marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>
            Unidades con configuración especial ({ufsConConfig.length})
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {ufsConConfig.map(u => {
              const cp = copropietarios.find(c=>c.id===u.propietario_id)
              return (
                <div key={u.id} style={{ display:'flex', justifyContent:'space-between',
                  alignItems:'center', padding:'10px 12px', background:'#f8fafc',
                  borderRadius:8, border:'1px solid #e5e7eb' }}>
                  <div>
                    <span style={{ fontWeight:700 }}>UF {u.numero}</span>
                    <span style={{ color:GR, fontSize:12, marginLeft:8 }}>{cp?.apellido_nombre}</span>
                    {u.tasa_mora_diferencial &&
                      <Badge text={`Mora: ${u.tasa_mora_diferencial}%`} color={AM} bg='#fef9c3'
                        style={{ marginLeft:8 }} />}
                    {u.convenio_pago &&
                      <Badge text="Convenio activo" color='#7c3aed' bg='#ede9fe'
                        style={{ marginLeft:8 }} />}
                  </div>
                  <Btn small onClick={()=>{
                    setEditId(u.id)
                    setForm({ tasa: u.tasa_mora_diferencial||'', convenio_pago: u.convenio_pago, convenio_detalle: u.convenio_detalle||'' })
                  }} style={{ background:'#f3f4f6', color:'#374151' }}>✏ Editar</Btn>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Tabla todas las UFs */}
      <Card>
        <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>Configurar por unidad</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#f3f4f6' }}>
                {['UF','Propietario','Tasa mora','Convenio','Detalle convenio',''].map((h,i)=>(
                  <th key={i} style={{ padding:'8px 10px', textAlign:'left', fontSize:11,
                    fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unidades.map(u => {
                const cp = copropietarios.find(c=>c.id===u.propietario_id)
                const esEditando = editId === u.id
                return (
                  <tr key={u.id} style={{ borderBottom:'1px solid #f3f4f6',
                    background: esEditando?'#f0f9ff':'transparent' }}>
                    <td style={{ padding:'8px 10px', fontWeight:700 }}>UF {u.numero}</td>
                    <td style={{ padding:'8px 10px', fontSize:12, color:GR }}>{cp?.apellido_nombre||'—'}</td>
                    {esEditando ? (
                      <>
                        <td style={{ padding:'6px 10px' }}>
                          <input type="number" min="0" step="0.01" placeholder="% mora"
                            value={form.tasa||''} onChange={e=>setForm(f=>({...f,tasa:e.target.value}))}
                            style={{ width:80, padding:'5px 8px', border:'1px solid #93c5fd',
                              borderRadius:6, fontSize:12 }} />
                        </td>
                        <td style={{ padding:'6px 10px' }}>
                          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                            <input type="checkbox" checked={form.convenio_pago||false}
                              onChange={e=>setForm(f=>({...f,convenio_pago:e.target.checked}))} />
                            Activo
                          </label>
                        </td>
                        <td style={{ padding:'6px 10px' }}>
                          <input placeholder="Descripción del convenio"
                            value={form.convenio_detalle||''} onChange={e=>setForm(f=>({...f,convenio_detalle:e.target.value}))}
                            style={{ width:'100%', padding:'5px 8px', border:'1px solid #93c5fd',
                              borderRadius:6, fontSize:12, boxSizing:'border-box' }} />
                        </td>
                        <td style={{ padding:'6px 10px' }}>
                          <div style={{ display:'flex', gap:6 }}>
                            <Btn small onClick={()=>guardar(u.id)} disabled={guardando}
                              style={{ background:VD, color:'#fff' }}>{guardando?'⏳':'✓'}</Btn>
                            <Btn small onClick={()=>{setEditId(null);setForm({})}}
                              style={{ background:'#f3f4f6', color:GR }}>✕</Btn>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding:'8px 10px' }}>
                          {u.tasa_mora_diferencial
                            ? <Badge text={`${u.tasa_mora_diferencial}%`} color={AM} bg='#fef9c3' />
                            : <span style={{ color:GR, fontSize:12 }}>Global</span>}
                        </td>
                        <td style={{ padding:'8px 10px' }}>
                          {u.convenio_pago
                            ? <Badge text="Sí" color='#7c3aed' bg='#ede9fe' />
                            : <span style={{ color:GR, fontSize:12 }}>No</span>}
                        </td>
                        <td style={{ padding:'8px 10px', fontSize:11, color:GR }}>
                          {u.convenio_detalle||'—'}
                        </td>
                        <td style={{ padding:'8px 10px' }}>
                          <Btn small onClick={()=>{
                            setEditId(u.id)
                            setForm({ tasa:u.tasa_mora_diferencial||'', convenio_pago:u.convenio_pago, convenio_detalle:u.convenio_detalle||'' })
                          }} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
