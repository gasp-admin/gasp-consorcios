// modules — Actas.jsx
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

export default function Actas() {
  const { session, copropietarios } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [actas, setActas]     = useState([])
  const [form, setForm]       = useState(null)
  const [msg, setMsg]         = useState(null)
  const F = f => setForm(x=>({...x,...f}))

  async function cargar() {
    const { data } = await supabase.from('con_actas').select('*').eq('admin_id',uid).eq('consorcio_id',consorcioId).order('fecha',{ascending:false})
    setActas(data||[])
  }
  async function guardar() {
    if (!form.fecha) return setMsg({ tipo:'warn', texto:'Fecha obligatoria' })
    const id=form.id||nextId(actas,'ACT')
    const numero=form.numero||(actas.length>0?Math.max(...actas.map(a=>a.numero||0))+1:1)
    const { error }=await supabase.from('con_actas').upsert({ ...form, id, numero, admin_id:uid, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Acta guardada' }); cargar()
  }
  function imprimirActa(acta) {
    const presentes=(acta.presentes||[]).map(id=>copropietarios.find(c=>c.id===id)?.apellido_nombre||id).join(', ')
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px}h1{font-size:18px;text-align:center;text-transform:uppercase;border-bottom:2px solid #000;padding-bottom:10px}h2{font-size:14px;text-transform:uppercase;margin-top:24px}.field{margin:10px 0;font-size:13px;line-height:1.8}.label{font-weight:bold}.firma{margin-top:60px;display:flex;justify-content:space-between}.firma-box{text-align:center;border-top:1px solid #000;padding-top:8px;width:200px;font-size:11px}</style></head><body><h1>Libro de Actas — Acta N° ${acta.numero}</h1><div class="field"><span class="label">Tipo:</span> ${acta.tipo?.replace(/_/g,' ')}</div><div class="field"><span class="label">Fecha:</span> ${fmtD(acta.fecha)} · Hora: ${acta.hora||'—'}</div><div class="field"><span class="label">Lugar:</span> ${acta.lugar||'—'}</div><div class="field"><span class="label">Quórum:</span> ${acta.quorum?acta.quorum+'%':'—'}</div><div class="field"><span class="label">Presentes:</span> ${presentes||'—'}</div><h2>Orden del día</h2><div style="white-space:pre-line;font-size:13px">${acta.orden_del_dia||'—'}</div><h2>Resoluciones adoptadas</h2><div style="white-space:pre-line;font-size:13px">${acta.resoluciones||'—'}</div>${acta.observaciones?`<h2>Observaciones</h2><div style="white-space:pre-line;font-size:13px">${acta.observaciones}</div>`:''}<div class="firma"><div class="firma-box">Presidente de la asamblea</div><div class="firma-box">Secretario</div><div class="firma-box">Administrador</div></div></body></html>`
    const win=window.open('','_blank'); win.document.write(html); win.document.close(); setTimeout(()=>win.print(),500)
  }
  useEffect(()=>{ if (consorcioId) cargar() },[consorcioId])
  const TIPOS=['asamblea_ordinaria','asamblea_extraordinaria','reunion_consejo']

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Libro de Actas ({actas.length})</div>
        <Btn onClick={()=>setForm({tipo:'asamblea_ordinaria',fecha:new Date().toISOString().split('T')[0],presentes:[]})}>+ Nueva acta</Btn>
      </div>
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{form.id?'Editar acta':'Nueva acta'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Sel label="Tipo" value={form.tipo} onChange={v=>F({tipo:v})} opts={TIPOS} />
            <Input label="Fecha" value={form.fecha} onChange={v=>F({fecha:v})} type="date" required />
            <Input label="Hora" value={form.hora} onChange={v=>F({hora:v})} placeholder="10:00" />
            <Input label="Lugar" value={form.lugar} onChange={v=>F({lugar:v})} placeholder="Salón, domicilio..." />
            <Input label="Quórum %" value={form.quorum} onChange={v=>F({quorum:v})} type="number" placeholder="67" />
            <div />
            <div style={{ gridColumn:'span 3' }}>
              <div style={{ fontSize:12, color:'#6b7280', marginBottom:6, fontWeight:500 }}>Presentes</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {copropietarios.map(cp=>(
                  <label key={cp.id} style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', fontSize:13 }}>
                    <input type="checkbox" checked={(form.presentes||[]).includes(cp.id)}
                      onChange={e=>F({presentes:e.target.checked?[...(form.presentes||[]),cp.id]:(form.presentes||[]).filter(x=>x!==cp.id)})} />
                    {cp.apellido_nombre}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ gridColumn:'span 3' }}>
              <div style={{ fontSize:12, color:'#6b7280', marginBottom:4, fontWeight:500 }}>Orden del día</div>
              <textarea value={form.orden_del_dia||''} onChange={e=>F({orden_del_dia:e.target.value})} rows={4}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
            </div>
            <div style={{ gridColumn:'span 3' }}>
              <div style={{ fontSize:12, color:'#6b7280', marginBottom:4, fontWeight:500 }}>Resoluciones adoptadas</div>
              <textarea value={form.resoluciones||''} onChange={e=>F({resoluciones:e.target.value})} rows={4}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
            </div>
            <div style={{ gridColumn:'span 3' }}><Input label="Observaciones" value={form.observaciones} onChange={v=>F({observaciones:v})} /></div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar acta</Btn>
            <BtnSec onClick={()=>setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {actas.map(a=>(
          <Card key={a.id}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontWeight:700 }}>Acta N° {a.numero}</span>
                  <Badge text={a.tipo?.replace(/_/g,' ')} color={AZ} />
                  {a.firmada && <Badge text="✓ Firmada" color={VD} bg='#dcfce7' />}
                </div>
                <div style={{ fontSize:12, color:GR, display:'flex', gap:14 }}>
                  <span>📅 {fmtD(a.fecha)}{a.hora?` · ${a.hora}`:''}</span>
                  {a.lugar && <span>📍 {a.lugar}</span>}
                  {a.presentes?.length>0 && <span>👥 {a.presentes.length} presentes</span>}
                </div>
                {a.resoluciones && <div style={{ fontSize:12, color:'#374151', marginTop:4, fontStyle:'italic' }}>{a.resoluciones.slice(0,120)}{a.resoluciones.length>120?'...':''}</div>}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <Btn small onClick={()=>imprimirActa(a)}>🖨 Imprimir</Btn>
                <Btn small onClick={()=>setForm({...a})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                <Btn small onClick={async()=>{await supabase.from('con_actas').update({firmada:!a.firmada}).eq('id',a.id);cargar()}} color={a.firmada?GR:VD}>{a.firmada?'Desfirmar':'✓ Firmar'}</Btn>
              </div>
            </div>
          </Card>
        ))}
        {actas.length===0 && <Card style={{ textAlign:'center', color:GR, padding:32 }}>Sin actas registradas.</Card>}
      </div>
    </div>
  )
}
