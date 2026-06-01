import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Unidades() {
  const { session, consorcioActivo, unidades, copropietarios, expensas, proveedores, adminPerfil } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [unidades, setUnidades] = useState([])
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const F = f => setForm(x => ({ ...x, ...f }))

  async function cargar() {
    const { data } = await supabase.from('con_unidades').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId).order('numero')
    setUnidades(data || [])
  }
  async function guardar() {
    if (!form.numero) return setMsg({ tipo:'warn', texto:'El número de UF es obligatorio' })
    const id = form.id || nextId(unidades, 'UF')
    const { error } = await supabase.from('con_unidades').upsert(
      { ...form, id, admin_id:session.user.id, consorcio_id:consorcioId }, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:'Error: '+error.message })
    setForm(null); setMsg({ tipo:'ok', texto:'✓ Unidad guardada' }); cargar()
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar esta UF?')) return
    await supabase.from('con_unidades').delete().eq('id', id); cargar()
  }
  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  const [busqueda, setBusqueda] = useState('')
  const TIPOS=['departamento','local','cochera','baulera','oficina','otro']
  const ESTADOS=['ocupada','desocupada','en_venta']
  const totalCoef=unidades.reduce((a,u)=>a+(Number(u.porcentaje_fiscal)||0),0)
  const filtradas = unidades.filter(u => {
    const q = busqueda.toLowerCase()
    const cp = copropietarios.find(c=>c.id===u.propietario_id)
    return !q || u.numero?.toLowerCase().includes(q) || u.tipo?.toLowerCase().includes(q)
      || cp?.apellido_nombre?.toLowerCase().includes(q) || u.piso?.toLowerCase().includes(q)
  })

  function handlePDF() {
    const cols = [
      {key:'uf',label:'UF'},{key:'tipo',label:'Tipo'},{key:'piso',label:'Piso'},
      {key:'sup',label:'Sup.',align:'right'},{key:'coef',label:'Coef.%',align:'right'},
      {key:'propietario',label:'Propietario'},{key:'estado',label:'Estado'},
    ]
    const rows = filtradas.map(u=>{
      const cp=copropietarios.find(c=>c.id===u.propietario_id)
      return {uf:u.numero,tipo:u.tipo,piso:u.piso||'—',sup:u.superficie_cubierta?u.superficie_cubierta+' m²':'—',
        coef:u.porcentaje_fiscal?Number(u.porcentaje_fiscal).toFixed(4)+'%':'—',
        propietario:cp?.apellido_nombre||'—',estado:u.estado||'—'}
    })
    exportarPDF({titulo:'Listado de Unidades Funcionales',columnas:cols,filas:rows,logoB64:LOGO_ADM_B64,
      totales:{uf:'TOTAL',tipo:'',piso:'',sup:'',coef:totalCoef.toFixed(4)+'%',propietario:`${filtradas.length} UFs`,estado:''}})
  }
  function handleExcel() {
    const cols = [{key:'uf',label:'UF'},{key:'tipo',label:'Tipo'},{key:'piso',label:'Piso'},
      {key:'sup',label:'Sup.'},{key:'coef',label:'Coef.%'},{key:'propietario',label:'Propietario'},
      {key:'nro_ep',label:'N° EP'},{key:'nro_siro',label:'N° SIRO'},{key:'estado',label:'Estado'}]
    const rows = filtradas.map(u=>{
      const cp=copropietarios.find(c=>c.id===u.propietario_id)
      return {uf:u.numero,tipo:u.tipo,piso:u.piso||'',sup:u.superficie_cubierta||'',
        coef:u.porcentaje_fiscal||'',propietario:cp?.apellido_nombre||'',
        nro_ep:u.nro_ep||'',nro_siro:u.nro_siro||'',estado:u.estado||''}
    })
    exportarExcel({titulo:'Unidades-Funcionales',columnas:cols,filas:rows})
  }

  // ── Reajuste de coeficientes ──────────────────────────────────────────────
  // Ajusta cada columna de coeficientes para que sume exactamente 100%.
  // Calcula el delta (100 - suma_actual) y lo distribuye proporcionalmente
  // entre todas las UFs que tienen coeficiente > 0 en esa columna.
  // Aplica a todas las columnas configuradas: porcentaje_fiscal + las multicol.
  async function reajustarCoeficientes() {
    if (unidades.length === 0) return
    if (!confirm(
      '¿Reajustar coeficientes para que cada columna sume exactamente 100%?\n\n' +
      'Se distribuirá el decimal faltante/sobrante proporcionalmente entre todas las UFs.\n\n' +
      'Esta operación modifica los coeficientes en la base de datos.'
    )) return

    setMsg({ tipo:'ok', texto:'⏳ Reajustando coeficientes...' })

    // Detectar todas las columnas de coeficiente disponibles en este consorcio
    const COLUMNAS_COEF = [
      'porcentaje_fiscal',
      'pct_gtos_grales',
      'pct_fdo_obras',
      'pct_cochera',
      'pct_gtos_part',
    ]

    // Solo procesar columnas que tienen al menos 1 valor > 0
    const columnasActivas = COLUMNAS_COEF.filter(col =>
      unidades.some(u => parseFloat(u[col]) > 0)
    )

    if (columnasActivas.length === 0) {
      return setMsg({ tipo:'warn', texto:'No hay columnas de coeficiente con valores cargados.' })
    }

    const resultados = []
    let totalErrores = 0

    for (const col of columnasActivas) {
      // UFs con valor positivo en esta columna
      const ufsConCoef = unidades.filter(u => parseFloat(u[col]) > 0)
      if (ufsConCoef.length === 0) continue

      const sumaActual = ufsConCoef.reduce((a, u) => a + parseFloat(u[col]), 0)
      const delta = 100 - sumaActual  // puede ser positivo (falta) o negativo (sobra)

      // Si ya suma 100 con tolerancia de 0.01%, saltar
      if (Math.abs(delta) < 0.01) {
        resultados.push(`✅ ${col}: ya suma ${sumaActual.toFixed(4)}%`)
        continue
      }

      // Distribuir delta proporcionalmente entre las UFs con coef > 0
      // Ajuste de cada UF = delta × (coef_UF / suma_actual)
      const ajustes = ufsConCoef.map(u => {
        const coefActual = parseFloat(u[col])
        const ajuste    = delta * (coefActual / sumaActual)
        const nuevoCoef = Math.round((coefActual + ajuste) * 10000) / 10000 // 4 decimales
        return { id: u.id, nuevoCoef }
      })

      // Verificar que los ajustes suman exactamente 100
      const sumaAjustada = ajustes.reduce((a, x) => a + x.nuevoCoef, 0)
      const residuo = 100 - sumaAjustada

      // Si hay residuo por redondeo, sumarlo a la UF de mayor coeficiente
      if (Math.abs(residuo) > 0.00001) {
        const maxIdx = ajustes.reduce((mi, x, i, arr) => x.nuevoCoef > arr[mi].nuevoCoef ? i : mi, 0)
        ajustes[maxIdx].nuevoCoef = Math.round((ajustes[maxIdx].nuevoCoef + residuo) * 10000) / 10000
      }

      // Actualizar en Supabase
      let errores = 0
      for (const { id, nuevoCoef } of ajustes) {
        const { error } = await supabase.from('con_unidades')
          .update({ [col]: nuevoCoef })
          .eq('id', id)
        if (error) errores++
      }

      const sumaFinal = ajustes.reduce((a, x) => a + x.nuevoCoef, 0)
      if (errores === 0) {
        resultados.push(`✅ ${col}: ${sumaActual.toFixed(4)}% → ${sumaFinal.toFixed(4)}% (Δ${delta>0?'+':''}${Math.abs(delta).toFixed(4)})%`)
      } else {
        resultados.push(`⚠️ ${col}: ${errores} errores al actualizar`)
        totalErrores += errores
      }
    }

    await cargar()
    setMsg({
      tipo: totalErrores === 0 ? 'ok' : 'warn',
      texto: resultados.join(' | ')
    })
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:'#111' }}>Unidades Funcionales</div>
          <div style={{ fontSize:12, color:GR }}>{unidades.length} unidades · Coef. fiscal: <span style={{ fontWeight:700, color: Math.abs(totalCoef - 100) < 0.1 ? VD : RJ }}>{totalCoef.toFixed(4)}%</span>
            {['pct_gtos_grales','pct_fdo_obras','pct_cochera','pct_gtos_part'].filter(col => unidades.some(u => parseFloat(u[col]) > 0)).map(col => {
              const suma = unidades.reduce((a,u) => a + (parseFloat(u[col])||0), 0)
              const ok   = Math.abs(suma - 100) < 0.1
              const label = col.replace('pct_gtos_grales','Gtos.grales').replace('pct_fdo_obras','Fdo.obras').replace('pct_cochera','Cochera').replace('pct_gtos_part','Gtos.part')
              return <span key={col}> · {label}: <span style={{ fontWeight:700, color: ok ? VD : RJ }}>{suma.toFixed(4)}%</span></span>
            })}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <Btn onClick={() => setForm({ tipo:'departamento', estado:'ocupada' })}>+ Nueva UF</Btn>
        <Btn small color={AM} title="Reajustar coeficientes para que cada columna sume exactamente 100%" onClick={reajustarCoeficientes}>⚖️ Reajustar coeficientes</Btn>
      </div>
      </div>
      <BarraListado busqueda={busqueda} onBuscar={setBusqueda} onPDF={handlePDF} onExcel={handleExcel} placeholder="Buscar por UF, tipo, propietario..." />
      <Msg data={msg} />
      {form && (
        <Card style={{ marginBottom:16, border:`1px solid ${AZ}` }}>
          <div style={{ fontWeight:700, color:AZ, marginBottom:14 }}>{form.id ? 'Editar UF' : 'Nueva Unidad Funcional'}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Input label="Número / Código" value={form.numero} onChange={v=>F({numero:v})} placeholder="1A, 2B, PB-1..." required />
            <Sel label="Tipo" value={form.tipo} onChange={v=>F({tipo:v})} opts={TIPOS} />
            <Input label="Piso" value={form.piso} onChange={v=>F({piso:v})} placeholder="PB, 1°, 2°..." />
            <Input label="Sup. cubierta (m²)" value={form.superficie_cubierta} onChange={v=>F({superficie_cubierta:v})} type="number" />
            <Input label="Coeficiente fiscal %" value={form.porcentaje_fiscal} onChange={v=>F({porcentaje_fiscal:v})} type="number" placeholder="8.333..." required />
            <Sel label="Estado" value={form.estado} onChange={v=>F({estado:v})} opts={ESTADOS} />
          </div>
          {/* Coeficientes adicionales — aparecen si el consorcio tiene columnas de prorrateo configuradas */}
          {(() => {
            const camposExtra = [
              { campo:'pct_fdo_obras',    label:'Coef. Fdo. Obras %' },
              { campo:'pct_cochera',      label:'Coef. Cochera %' },
              { campo:'pct_gtos_grales',  label:'Coef. Gtos. Grales %' },
              { campo:'pct_gtos_part',    label:'Coef. Gtos. Part. %' },
            ].filter(cf =>
              // Mostrar el campo si: (a) el consorcio ya tiene UFs con ese coef > 0,
              // o (b) el consorcio tiene una columna de liquidación con ese campo
              unidades.some(u => parseFloat(u[cf.campo]) > 0) ||
              columnasLiq.some(c => c.campo_coef === cf.campo)
            )
            if (!camposExtra.length) return null
            return (
              <div style={{ background:'#f8faff', border:'1px solid #dbeafe', borderRadius:8, padding:'12px 14px', marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:600, color:AZ, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:10 }}>
                  Coeficientes de prorrateo adicionales
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:10 }}>
                  {camposExtra.map(cf => (
                    <Input key={cf.campo} label={cf.label}
                      value={form[cf.campo]||''}
                      onChange={v=>F({[cf.campo]:v})}
                      type="number" placeholder="0.0000..." />
                  ))}
                </div>
              </div>
            )
          })()}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <Sel label="Copropietario" value={form.propietario_id} onChange={v=>F({propietario_id:v})}
              opts={[{v:'',l:'— Sin asignar —'}, ...copropietarios.map(c=>({v:c.id,l:c.apellido_nombre}))]} />
            <Input label="Descripción" value={form.descripcion} onChange={v=>F({descripcion:v})} placeholder="Observaciones..." />
          </div>
          {/* Sección cobranzas automáticas */}
          <div style={{ borderTop:'1px solid #e5e7eb', paddingTop:12, marginTop:4, marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:GR, textTransform:'uppercase',
              letterSpacing:'0.05em', marginBottom:10 }}>
              Cobranzas automáticas
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>
                  Nro. Expensas Pagas
                </div>
                <input value={form.nro_ep||''}
                  onChange={e=>F({nro_ep:e.target.value})}
                  placeholder="ej: 1, 2, 3..."
                  style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                    borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                <div style={{ fontSize:10, color:GR, marginTop:3 }}>
                  Número interno asignado por Expensas Pagas a esta UF
                </div>
              </div>
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>
                  Nro. referencia SIRO
                </div>
                <input value={form.nro_siro||''}
                  onChange={e=>F({nro_siro:e.target.value})}
                  placeholder="ej: 00001"
                  style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                    borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                <div style={{ fontSize:10, color:GR, marginTop:3 }}>
                  Código de referencia usado en SIRO Banco Roela
                </div>
              </div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar}>💾 Guardar</Btn>
            <BtnSec onClick={() => setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}
      {unidades.length === 0 ? (
        <Card style={{ textAlign:'center', color:GR, padding:32 }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🏢</div>
          <div>No hay unidades registradas. Agregá la primera UF.</div>
        </Card>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#f3f4f6' }}>
                {['UF','Tipo','Piso','Sup.','Coef. %','Copropietario','Cob. Auto','Estado',''].map((h,i) => (
                  <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:'bold', color:GR, textTransform:'uppercase', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.map(u => {
                const cp=copropietarios.find(c=>c.id===u.propietario_id)
                const ec={ocupada:{c:VD,bg:'#dcfce7'},desocupada:{c:AM,bg:'#fef9c3'},en_venta:{c:AZ,bg:'#dbeafe'}}[u.estado]||{c:GR,bg:'#f3f4f6'}
                return (
                  <tr key={u.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:AZ }}>{u.numero}</td>
                    <td style={{ padding:'10px 12px', textTransform:'capitalize' }}>{u.tipo}</td>
                    <td style={{ padding:'10px 12px' }}>{u.piso||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{u.superficie_cubierta?u.superficie_cubierta+' m²':'—'}</td>
                    <td style={{ padding:'10px 12px', fontWeight:600 }}>{u.porcentaje_fiscal?Number(u.porcentaje_fiscal).toFixed(4)+'%':'—'}</td>
                    <td style={{ padding:'10px 12px' }}>{cp?.apellido_nombre||'—'}</td>
                    <td style={{ padding:'10px 12px' }}>
                      {u.nro_ep && <span style={{ fontSize:10, background:'#eff6ff', color:AZ, borderRadius:4, padding:'1px 5px', marginRight:4 }}>EP:{u.nro_ep}</span>}
                      {u.nro_siro && <span style={{ fontSize:10, background:'#faf5ff', color:'#7c3aed', borderRadius:4, padding:'1px 5px' }}>SIRO:{u.nro_siro}</span>}
                      {!u.nro_ep && !u.nro_siro && <span style={{ color:GR }}>—</span>}
                    </td>
                    <td style={{ padding:'10px 12px' }}><Badge text={u.estado} color={ec.c} bg={ec.bg} /></td>
                    <td style={{ padding:'10px 12px' }}>
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                        {u.portal_token && (
                          <Btn small title="Abrir y copiar link del portal" onClick={() => {
                            const url = 'https://consorcios.administracionpinamar.com/portal?token=' + u.portal_token
                            // Abrir en nueva pestaña
                            window.open(url, '_blank')
                            // Intentar copiar al clipboard
                            if (navigator.clipboard) {
                              navigator.clipboard.writeText(url)
                                .then(() => setMsg({ tipo:'ok', texto:'✓ Link copiado y abierto — UF ' + u.numero }))
                                .catch(() => setMsg({ tipo:'ok', texto:'✓ Portal abierto — UF ' + u.numero }))
                            } else {
                              setMsg({ tipo:'ok', texto:'✓ Portal abierto — UF ' + u.numero })
                            }
                          }} style={{ background:'#dbeafe', color:'#1e40af' }}>🔗</Btn>
                        )}
                        {u.portal_token && (() => {
                          const cp2 = copropietarios.find(c => c.id === u.propietario_id)
                          return cp2?.telefono ? (
                            <Btn small title="Enviar link por WhatsApp" onClick={() => {
                              const url = 'https://consorcios.administracionpinamar.com/portal?token=' + u.portal_token
                              const txt = encodeURIComponent('Estimado/a ' + cp2.apellido_nombre + ', le enviamos el link a su portal de expensas donde puede consultar su estado de cuenta:\n' + url)
                              window.open(`https://wa.me/549${(()=>{let n=(cp2.telefono||'').replace(/\D/g,'');if(n.startsWith('549'))return n;if(n.startsWith('54'))return '9'+n.slice(2);if(n.startsWith('0'))n=n.slice(1);return n})()}?text=${txt}`, '_blank')
                            }} style={{ background:'#dcfce7', color:'#166534' }}>📱</Btn>
                          ) : null
                        })()}
                        <Btn small onClick={() => setForm({...u})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                        <Btn small onClick={() => eliminar(u.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
