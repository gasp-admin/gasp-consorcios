// modules — Morosos.jsx
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

export default function Morosos() {
  const { session, unidades, copropietarios } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [morosos, setMorosos] = useState([])
  const [loading, setLoading] = useState(true)
  const [convenioForm, setConvenioForm] = useState(null) // {det, cuotas, monto_total, detalle}

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('con_expensas_detalle')
      .select('*, con_expensas!inner(periodo,fecha_vencimiento)')
      .eq('admin_id', uid).eq('consorcio_id', consorcioId)
      .in('estado', ['pendiente','morosa']).order('created_at', { ascending:false })
    setMorosos(data||[]); setLoading(false)
  }
  async function enviarWA(det) {
    const u=unidades.find(x=>x.id===det.unidad_id)
    const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
    if (!cp?.telefono) return alert('El copropietario no tiene teléfono registrado')
    const msg=encodeURIComponent(`Estimado/a ${cp.apellido_nombre}, le informamos que tiene pendiente el pago de expensas del período ${periodoLabel(det.con_expensas?.periodo)} por ${fmt(det.monto)}. Por favor regularice su situación. Gracias.`)
    window.open(`https://wa.me/549${(()=>{let n=(cp.telefono||'').replace(/\D/g,'');if(n.startsWith('549'))return n;if(n.startsWith('54'))return '9'+n.slice(2);if(n.startsWith('0'))n=n.slice(1);return n})()}?text=${msg}`,'_blank')
  }

  function generarIntimacion(det) {
    const u=unidades.find(x=>x.id===det.unidad_id)
    const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
    const periodo=periodoLabel(det.con_expensas?.periodo)
    const vto=det.con_expensas?.fecha_vencimiento?new Date(det.con_expensas.fecha_vencimiento+'T00:00:00').toLocaleDateString('es-AR'):'-'
    const hoy=new Date().toLocaleDateString('es-AR')
    const deuda=Number(det.monto||0)+Number(det.interes_mora||0)+Number(det.saldo_anterior||0)
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:40px;font-size:12pt;line-height:1.7}
      h1{font-size:15pt;text-align:center;text-transform:uppercase;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:24px}
      .datos{background:#f5f5f5;padding:14px;border-radius:6px;margin-bottom:20px;font-size:11pt}
      .cuerpo{text-align:justify;margin-bottom:20px}
      .monto{font-size:14pt;font-weight:bold;text-align:center;margin:20px 0;padding:12px;border:2px solid #000;border-radius:6px}
      .firma{margin-top:60px;display:flex;justify-content:space-between}
      .firma-box{text-align:center;border-top:1px solid #000;padding-top:8px;width:220px;font-size:10pt}
      .encabezado{display:flex;justify-content:space-between;margin-bottom:30px;font-size:11pt}
      @media print{body{padding:20px}.no-print{display:none}}
    </style></head><body>
      <div class="encabezado">
        <div><strong>Administración de Consorcios Pinamar</strong><br/>Lenguado 1313, Local 3 — Pinamar, Buenos Aires<br/>Tel: 02267 444034</div>
        <div style="text-align:right">Pinamar, ${hoy}<br/><strong>Ref.:</strong> ${u?.numero||det.unidad_id} — ${periodoLabel(det.con_expensas?.periodo)}</div>
      </div>
      <h1>⚠ Intimación de Pago de Expensas</h1>
      <div class="datos">
        <strong>Destinatario/a:</strong> ${cp?.apellido_nombre||'Copropietario/a'}<br/>
        <strong>Unidad Funcional N°:</strong> ${u?.numero||'—'} ${u?.piso?'— Piso '+u.piso:''}<br/>
        <strong>Consorcio:</strong> ${consorcioId}<br/>
        <strong>Período adeudado:</strong> ${periodo}<br/>
        <strong>Fecha de vencimiento:</strong> ${vto}
      </div>
      <div class="cuerpo">
        <p>Por medio de la presente, en mi carácter de <strong>Administrador del Consorcio</strong>, me dirijo a Ud. a fin de <strong>intimarle fehacientemente</strong> el pago de las expensas comunes adeudadas correspondientes al período indicado, en los términos del <strong>artículo 2046 inciso a) del Código Civil y Comercial de la Nación (Ley 26.994)</strong>.</p>
        <p>El artículo citado establece que el propietario está obligado a <em>"pagar las expensas comunes ordinarias de conservación y de administración del inmueble"</em>, siendo dicha obligación inherente al dominio de la unidad funcional.</p>
        <p>Se hace saber que la <strong>mora es automática</strong> a partir del día del vencimiento de cada período, devengándose los intereses pactados en el Reglamento de Copropiedad, conforme lo establecido por el art. 2048 del mismo cuerpo normativo.</p>
      </div>
      <div class="monto">DEUDA TOTAL: ${fmt(deuda)} (pesos argentinos)</div>
      <div class="cuerpo">
        <p>Se le otorga el plazo improrrogable de <strong>cinco (5) días hábiles</strong> contados desde la recepción del presente para que proceda a regularizar la situación descripta, bajo apercibimiento de iniciar las acciones legales pertinentes para el cobro compulsivo de las sumas adeudadas, con más los intereses, costas y costos del proceso.</p>
        <p>Los pagos deberán realizarse en la Administración sita en Lenguado 1313, Local 3, Pinamar, en días hábiles de 9 a 13 hs, o mediante transferencia bancaria a los datos oportunamente comunicados.</p>
        <p>Sin otro particular, saludo a Ud. atte.</p>
      </div>
      <div class="firma">
        <div class="firma-box">Javier García Pérez<br/>Administrador de Consorcios<br/>R.P.A.C. Mat. N° 83<br/>CUIT: 20-18600680-2</div>
        <div class="firma-box">Notificado/a<br/>Aclaración:<br/><br/>Fecha:</div>
      </div>
      <div style="margin-top:30px;font-size:9pt;color:#666;text-align:center">
        Documento generado el ${hoy} — GASP Consorcios — Administración Pinamar
      </div>
      <script>setTimeout(()=>window.print(),400)</script>
    </body></html>`
    const w=window.open('','_blank'); w.document.write(html); w.document.close()
  }

  async function guardarConvenio() {
    if (!convenioForm?.det || !convenioForm.cuotas || !convenioForm.monto_total) return
    const det=convenioForm.det
    const cuotas=parseInt(convenioForm.cuotas)
    const montoTotal=parseFloat(convenioForm.monto_total)
    const montoCuota=montoTotal/cuotas
    // Marcar UF con convenio de pago
    await supabase.from('con_unidades').update({ convenio_pago:true, convenio_detalle: convenioForm.detalle||'' }).eq('id', det.unidad_id)
    // Registrar en movimientos_unidad
    for (let i=1;i<=cuotas;i++) {
      await supabase.from('con_movimientos_unidad').insert([{
        id:`CONV-${det.id}-${i}-${Date.now()}`,
        admin_id:uid, consorcio_id:consorcioId,
        unidad_id:det.unidad_id, expensa_id:det.expensa_id,
        tipo:'convenio_cuota', concepto:`Convenio de pago — Cuota ${i}/${cuotas}`,
        monto:montoCuota, es_debito:true,
        es_convenio_pago:true, cuotas_total:cuotas, cuota_numero:i, monto_cuota:montoCuota,
        created_at:new Date().toISOString()
      }])
    }
    setConvenioForm(null)
    alert(`✓ Convenio registrado: ${cuotas} cuotas de ${fmt(montoCuota)}`)
    cargar()
  }

  useEffect(()=>{ if (consorcioId) cargar() },[consorcioId])
  const totalDeuda=morosos.reduce((a,d)=>a+Number(d.monto||0),0)

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:RJ }}>⚠ Morosos</div>
          <div style={{ fontSize:12, color:GR }}>{morosos.length} cuotas pendientes · Total: {fmt(totalDeuda)}</div>
        </div>
        <Btn color={RJ} onClick={async()=>{
          for (const d of morosos) {
            const u=unidades.find(x=>x.id===d.unidad_id)
            const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
            if (cp?.telefono) {
              const msg=encodeURIComponent(`Estimado/a ${cp.apellido_nombre}, tiene expensas pendientes por ${fmt(d.monto)} del período ${periodoLabel(d.con_expensas?.periodo)}. Por favor regularice.`)
              window.open(`https://wa.me/549${(()=>{let n=(cp.telefono||'').replace(/\D/g,'');if(n.startsWith('549'))return n;if(n.startsWith('54'))return '9'+n.slice(2);if(n.startsWith('0'))n=n.slice(1);return n})()}?text=${msg}`,'_blank')
              await new Promise(r=>setTimeout(r,500))
            }
          }
        }}>📱 WA masivo ({morosos.filter(d=>{const u=unidades.find(x=>x.id===d.unidad_id);const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null;return !!cp?.telefono}).length})</Btn>
      </div>

      {/* Modal convenio de pago */}
      {convenioForm && (
        <Card style={{ marginBottom:16, border:`1.5px solid ${AM}`, background:'#fffbeb' }}>
          <div style={{ fontWeight:700, color:AM, marginBottom:12 }}>📋 Convenio de pago en cuotas</div>
          <div style={{ fontSize:12, color:GR, marginBottom:12 }}>
            UF {unidades.find(x=>x.id===convenioForm.det?.unidad_id)?.numero||'—'} — {copropietarios.find(c=>c.id===unidades.find(x=>x.id===convenioForm.det?.unidad_id)?.propietario_id)?.apellido_nombre||'—'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Monto total a convenir *</div>
              <input type="number" min="0" step="0.01" value={convenioForm.monto_total||''} onChange={e=>setConvenioForm(f=>({...f,monto_total:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontWeight:700, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Número de cuotas *</div>
              <select value={convenioForm.cuotas||''} onChange={e=>setConvenioForm(f=>({...f,cuotas:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
                <option value="">— Seleccione —</option>
                {[2,3,4,6,8,10,12,18,24].map(n=><option key={n} value={n}>{n} cuotas de {convenioForm.monto_total?fmt(parseFloat(convenioForm.monto_total)/n):'—'}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'span 2' }}>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Detalle del acuerdo</div>
              <textarea value={convenioForm.detalle||''} onChange={e=>setConvenioForm(f=>({...f,detalle:e.target.value}))} rows={2}
                placeholder="Ej: El copropietario se compromete a abonar en cuotas iguales y consecutivas..."
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, fontFamily:'inherit', boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn color={AM} onClick={guardarConvenio}>✓ Confirmar convenio</Btn>
            <BtnSec onClick={()=>setConvenioForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {loading ? <div style={{ textAlign:'center', color:GR, padding:40 }}>Cargando...</div> : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#fef2f2' }}>
                {['UF','Copropietario','Período','Deuda','Mora','Estado','Acciones'].map((h,i)=>(
                  <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:RJ, textTransform:'uppercase', borderBottom:'1px solid #fecaca' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {morosos.map(d=>{
                const u=unidades.find(x=>x.id===d.unidad_id)
                const cp=u?copropietarios.find(c=>c.id===u.propietario_id):null
                return (
                  <tr key={d.id} style={{ borderBottom:'1px solid #fef2f2' }}>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:AZ }}>{u?.numero||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{cp?.apellido_nombre||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{periodoLabel(d.con_expensas?.periodo)}</td>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:RJ }}>{fmt(d.monto)}</td>
                    <td style={{ padding:'10px 12px', color:Number(d.interes_mora)>0?RJ:GR }}>{Number(d.interes_mora)>0?fmt(d.interes_mora):'—'}</td>
                    <td style={{ padding:'10px 12px' }}><Badge text={d.estado} color={d.estado==='morosa'?RJ:AM} /></td>
                    <td style={{ padding:'10px 12px' }}>
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                        {cp?.telefono && <Btn small color='#25d366' onClick={()=>enviarWA(d)}>📱</Btn>}
                        {cp?.email && <Btn small color={AZ} onClick={()=>window.open(`mailto:${cp.email}`)}>✉</Btn>}
                        <Btn small color={RJ} title="Generar intimación formal" onClick={()=>generarIntimacion(d)}>📄 Intimación</Btn>
                        <Btn small color={AM} title="Convenio de pago en cuotas" onClick={()=>setConvenioForm({det:d,cuotas:'',monto_total:Number(d.monto||0)+Number(d.interes_mora||0)+Number(d.saldo_anterior||0),detalle:''})}>📋 Convenio</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {morosos.length===0 && <tr><td colSpan={7} style={{ padding:32, textAlign:'center', color:VD, fontWeight:600 }}>✅ No hay morosos registrados</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
