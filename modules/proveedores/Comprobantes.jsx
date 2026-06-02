// modules — Comprobantes.jsx — hooks fixed v2 1780275587 1780275360
// Extraído del V59. Refactorizado: props → useApp(). Cero cambios de comportamiento.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, extraerFacturaIA, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Comprobantes() {
  const { session, consorcioActivo, unidades, copropietarios, expensas, proveedores, adminPerfil } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [comprobantes, setComprobantes] = useState([])
  const [form, setForm]   = useState(null)
  const [formPago, setFormPago] = useState(null) // pago rápido inline
  const [filtro, setFiltro] = useState('')
  const [msg, setMsg]     = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [extrayendoIA, setExtrayendoIA] = useState(false)
  const [archivoFactura, setArchivoFactura] = useState(null)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [busquedaComp, setBusquedaComp] = useState('')
  const [tabComp, setTabComp]         = useState('proveedores')
  const [gastosSueldos, setGastosSueldos] = useState([])
  const [cargandoSueldos, setCargandoSueldos] = useState(false)
  const hoy = new Date().toISOString().split('T')[0]

  // ── Extraer datos de factura PDF con IA ───────────────────────────────────
  async function extraerFacturaConIA(file) {
    if (!file) return
    setArchivoFactura(file)
    setExtrayendoIA(true)
    setMsg({ tipo:'info', texto:'🤖 Analizando factura con IA...' })
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result.split(',')[1])
        r.onerror = () => rej(new Error('Error leyendo archivo'))
        r.readAsDataURL(file)
      })
      const { data: { session: sess } } = await supabase.auth.getSession()
      const response = await fetch(`${SUPA_URL}/functions/v1/extraer-factura-ia`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess?.access_token}`,
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        },
        body: JSON.stringify({ base64, filename: file.name })
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || `Error ${response.status}`)
      }
      const result = await response.json()
      if (!result.ok) throw new Error(result.error || 'Error desconocido')
      const d = result.datos
      let provId = ''
      if (d.proveedor_nombre) {
        const nombreLower = d.proveedor_nombre.toLowerCase()
        const match = proveedores.find(p =>
          p.razon_social?.toLowerCase().includes(nombreLower) ||
          nombreLower.includes(p.razon_social?.toLowerCase())
        )
        if (match) provId = match.id
      }
      const tipoMap = { 'A':'factura', 'B':'factura', 'C':'factura',
        'FACTURA':'factura', 'REMITO':'remito', 'TICKET':'ticket',
        'NOTA DE DEBITO':'nota_debito', 'NOTA DE CREDITO':'nota_credito' }
      const tipoDetectado = tipoMap[(d.tipo || '').toUpperCase()] || 'factura'
      setForm(f => ({
        ...(f || {}),
        proveedor_id:     provId || f?.proveedor_id || '',
        tipo:             tipoDetectado,
        numero:           d.numero || f?.numero || '',
        fecha:            d.fecha || f?.fecha || hoy,
        fecha_vencimiento: d.fecha_vencimiento || f?.fecha_vencimiento || '',
        concepto:         d.concepto || f?.concepto || '',
        monto_neto:       d.monto_neto != null ? String(d.monto_neto) : f?.monto_neto || '',
        iva:              d.iva != null ? String(d.iva) : f?.iva || '',
        otros_impuestos:  d.otros_impuestos != null ? String(d.otros_impuestos) : f?.otros_impuestos || '',
        monto_total:      d.monto_total != null ? String(d.monto_total) : f?.monto_total || '',
        notas:            d.notas || f?.notas || '',
      }))
      const avisoProveedor = provId ? '' : (d.proveedor_nombre ? ` — Proveedor "${d.proveedor_nombre}" no encontrado, seleccionarlo manualmente.` : '')
      setMsg({ tipo:'ok', texto:`✓ Datos extraídos de la factura${avisoProveedor}` })
    } catch(e) {
      setMsg({ tipo:'error', texto: 'Error IA: ' + e.message })
    }
    setExtrayendoIA(false)
  }

  async function cargar() {
    const q = supabase.from('con_comprobantes_proveedor').select('*')
      .eq('consorcio_id', consorcioId).order('fecha', { ascending:false }).limit(200)
    if (filtro) q.eq('proveedor_id', filtro)
    const { data } = await q
    setComprobantes(data || [])
  }

  async function guardar() {
    if (!form?.proveedor_id) return setMsg({ tipo:'warn', texto:'Seleccioná un proveedor' })
    if (!form?.concepto?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el concepto' })
    if (!form?.monto_total || parseFloat(form.monto_total) <= 0) return setMsg({ tipo:'warn', texto:'Ingresá el monto' })
    if (!form?.fecha) return setMsg({ tipo:'warn', texto:'Ingresá la fecha' })
    setGuardando(true)
    const total = parseFloat(form.monto_total)
    const esEdicion = !!form.id
    if (esEdicion) {
      // Edición: actualizar campos editables (no el saldo ni estado si ya tiene pagos)
      const { error } = await supabase.from('con_comprobantes_proveedor').update({
        proveedor_id: form.proveedor_id,
        expensa_id: form.expensa_id || null,
        tipo: form.tipo || 'factura',
        numero: form.numero || null,
        fecha: form.fecha,
        fecha_vencimiento: form.fecha_vencimiento || null,
        concepto: form.concepto.trim(),
        monto_neto: parseFloat(form.monto_neto||0),
        iva: parseFloat(form.iva||0),
        otros_impuestos: parseFloat(form.otros_impuestos||0),
        monto_total: total,
        notas: form.notas || null,
      }).eq('id', form.id)
      if (error) setMsg({ tipo:'error', texto: error.message })
      else { setMsg({ tipo:'ok', texto:'✓ Comprobante actualizado' }); setForm(null); cargar() }
    } else {
      // Alta nueva
      const { error } = await supabase.from('con_comprobantes_proveedor').insert([{
        id: `COMP-${Date.now()}`,
        admin_id: uid,
        consorcio_id: consorcioId,
        proveedor_id: form.proveedor_id,
        expensa_id: form.expensa_id || null,
        tipo: form.tipo || 'factura',
        numero: form.numero || null,
        fecha: form.fecha,
        fecha_vencimiento: form.fecha_vencimiento || null,
        concepto: form.concepto.trim(),
        monto_neto: parseFloat(form.monto_neto||0),
        iva: parseFloat(form.iva||0),
        otros_impuestos: parseFloat(form.otros_impuestos||0),
        monto_total: total,
        saldo_pendiente: total,
        estado: 'pendiente',
        notas: form.notas || null,
      }])
      if (error) setMsg({ tipo:'error', texto: error.message })
      else {
        setMsg({ tipo:'ok', texto:'✓ Comprobante registrado' })
        setForm(null)
        // Si el usuario quiere pagar en el momento, no hace nada más
        cargar()
      }
    }
    setGuardando(false)
  }

  // Pago rápido directo desde el comprobante
  async function pagarComprobante() {
    if (!formPago?.monto || parseFloat(formPago.monto)<=0) return setMsg({ tipo:'warn', texto:'Ingresá el monto a pagar' })
    if (!formPago?.fecha) return setMsg({ tipo:'warn', texto:'Ingresá la fecha' })
    const comp = formPago.comp
    const monto = parseFloat(formPago.monto)
    const retIIBB = parseFloat(formPago.retencion_iibb)||0
    const retGan  = parseFloat(formPago.retencion_ganancias)||0
    const retIVA  = parseFloat(formPago.retencion_iva)||0
    const neto    = monto - retIIBB - retGan - retIVA

    // Registrar pago
    const { error } = await supabase.from('con_pagos_proveedor').insert([{
      id: `PAG-${Date.now()}`,
      admin_id: uid,
      consorcio_id: consorcioId,
      proveedor_id: comp.proveedor_id,
      comprobante_id: comp.id,
      fecha: formPago.fecha,
      monto,
      retencion_iibb: retIIBB||null,
      retencion_ganancias: retGan||null,
      retencion_iva: retIVA||null,
      monto_neto_pagado: neto,
      nro_orden_pago: formPago.nro_orden_pago||null,
      medio_pago: formPago.medio_pago||'transferencia',
      referencia: formPago.referencia||null,
      notas: formPago.notas||null,
    }])
    if (error) return setMsg({ tipo:'error', texto: error.message })

    // Actualizar saldo del comprobante
    const nuevoSaldo = Math.max(0, (parseFloat(comp.saldo_pendiente)||0) - monto)
    const nuevoEstado = nuevoSaldo <= 0 ? 'pagado' : 'pagado_parcial'
    await supabase.from('con_comprobantes_proveedor')
      .update({ saldo_pendiente: nuevoSaldo, estado: nuevoEstado })
      .eq('id', comp.id)

    setFormPago(null)
    setMsg({ tipo:'ok', texto:`✓ Pago de ${fmt(monto)} registrado — Saldo restante: ${fmt(nuevoSaldo)}` })
    cargar()
  }

  async function anular(id) {
    if (!confirm('¿Anular este comprobante?')) return
    await supabase.from('con_comprobantes_proveedor').update({ estado:'anulado' }).eq('id', id)
    cargar()
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar definitivamente este comprobante? Esta acción no se puede deshacer.')) return
    await supabase.from('con_comprobantes_proveedor').delete().eq('id', id)
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId, filtro])


  const totalPendiente = comprobantes.filter(c=>c.estado==='pendiente'||c.estado==='pagado_parcial')
    .reduce((a,c) => a + (parseFloat(c.saldo_pendiente)||0), 0)

  const compsFiltrados = comprobantes.filter(c => {
    const prov = proveedores.find(p=>p.id===c.proveedor_id)
    const q = busquedaComp.toLowerCase()
    return (!filtro || c.proveedor_id === filtro)
      && (!filtroEstado || c.estado === filtroEstado)
      && (!q || c.concepto?.toLowerCase().includes(q) || c.numero?.toLowerCase().includes(q)
           || prov?.razon_social?.toLowerCase().includes(q))
  })

  const fmtD2 = d => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'
  function handlePDFComp(){
    exportarPDF({titulo:'Comprobantes de Proveedores',logoB64:null,
      columnas:[{key:'fecha',label:'Fecha',nowrap:true},{key:'vto',label:'Vto.',nowrap:true},
        {key:'prov',label:'Proveedor'},{key:'tipo',label:'Tipo'},{key:'nro',label:'N°'},
        {key:'concepto',label:'Concepto'},{key:'total',label:'Total',align:'right'},
        {key:'saldo',label:'Saldo',align:'right'},{key:'estado',label:'Estado'}],
      filas:compsFiltrados.map(c=>{
        const prov=proveedores.find(p=>p.id===c.proveedor_id)
        return {fecha:fmtD2(c.fecha),vto:fmtD2(c.fecha_vencimiento),prov:prov?.razon_social||'',
          tipo:c.tipo,nro:c.numero||'',concepto:c.concepto,
          total:'$'+Number(c.monto_total||0).toLocaleString('es-AR'),
          saldo:c.estado==='pagado'?'✓':'$'+Number(c.saldo_pendiente||0).toLocaleString('es-AR'),
          estado:c.estado}
      }),
      totales:{fecha:'',vto:'',prov:'TOTAL',tipo:'',nro:'',concepto:'',
        total:'$'+compsFiltrados.reduce((a,c)=>a+parseFloat(c.monto_total||0),0).toLocaleString('es-AR'),
        saldo:'$'+compsFiltrados.filter(c=>c.estado!=='pagado'&&c.estado!=='anulado').reduce((a,c)=>a+parseFloat(c.saldo_pendiente||0),0).toLocaleString('es-AR'),
        estado:''}
    })
  }
  function handleExcelComp(){
    exportarExcel({titulo:'Comprobantes-Proveedores',
      columnas:[{key:'fecha',label:'Fecha'},{key:'prov',label:'Proveedor'},{key:'tipo',label:'Tipo'},
        {key:'nro',label:'N° Comp.'},{key:'concepto',label:'Concepto'},{key:'total',label:'Monto Total'},
        {key:'saldo',label:'Saldo Pendiente'},{key:'estado',label:'Estado'},{key:'vto',label:'Vencimiento'}],
      filas:compsFiltrados.map(c=>{
        const prov=proveedores.find(p=>p.id===c.proveedor_id)
        return {fecha:c.fecha,prov:prov?.razon_social||'',tipo:c.tipo,nro:c.numero||'',
          concepto:c.concepto,total:c.monto_total,saldo:c.saldo_pendiente,estado:c.estado,vto:c.fecha_vencimiento||''}
      })
    })
  }

  const TIPOS = [
    {v:'factura',l:'Factura'},{v:'remito',l:'Remito'},{v:'ticket',l:'Ticket'},
    {v:'nota_debito',l:'Nota de débito'},{v:'nota_credito',l:'Nota de crédito'}
  ]
  const ESTADOS_COLOR = {
    pendiente:    { c:AM,  bg:'#fef9c3', t:'Pendiente' },
    pagado_parcial:{ c:'#7c3aed', bg:'#ede9fe', t:'Pago parcial' },
    pagado:       { c:VD,  bg:'#dcfce7', t:'Pagado' },
    anulado:      { c:GR,  bg:'#f3f4f6', t:'Anulado' },
  }
  const MEDIOS_PAGO = [
    {v:'transferencia',l:'Transferencia'},{v:'cheque_propio',l:'Cheque propio'},
    {v:'cheque_tercero',l:'Cheque de tercero'},{v:'efectivo',l:'Efectivo'},{v:'otro',l:'Otro'}
  ]




  // ── Tab sueldos ──

  async function cargarGastosSueldos() {
    setCargandoSueldos(true)
    const { data } = await supabase.from('con_gastos').select('*')
      .eq('admin_id', uid).eq('consorcio_id', consorcioId)
      .in('categoria', ['sueldos','fateryh','vep_931','cargas_sociales'])
      .order('fecha', { ascending:false }).limit(200)
    setGastosSueldos(data || [])
    setCargandoSueldos(false)
  }

  useEffect(() => {
    if (consorcioId && tabComp === 'sueldos') cargarGastosSueldos()
  }, [consorcioId, tabComp])

  async function anularGasto(id) {
    if (!confirm('¿Eliminar este gasto de sueldo/CCSS? Se borrará de la planilla de gastos de la expensa.')) return
    const { error } = await supabase.from('con_gastos').delete().eq('id', id)
    if (error) setMsg({ tipo:'error', texto: error.message })
    else { setMsg({ tipo:'ok', texto:'✓ Gasto eliminado de la planilla' }); cargarGastosSueldos() }
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>🧾 Comprobantes</div>
        {tabComp === 'proveedores' && (
          <Btn onClick={() => { setForm({ tipo:'factura', fecha:hoy }); setFormPago(null) }}>+ Nuevo comprobante</Btn>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:16, borderBottom:'2px solid #e5e7eb' }}>
        {[
          { id:'proveedores', l:'🧾 Proveedores' },
          { id:'sueldos',     l:'💼 Sueldos y CCSS' },
        ].map(t => (
          <button key={t.id} type="button" onClick={()=>setTabComp(t.id)}
            style={{ padding:'8px 18px', border:'none',
              borderBottom:tabComp===t.id?`2px solid ${AZ}`:'2px solid transparent',
              background:'transparent', color:tabComp===t.id?AZ:GR,
              fontWeight:tabComp===t.id?700:400, fontSize:13, cursor:'pointer', marginBottom:-2 }}>
            {t.l}
          </button>
        ))}
      </div>

      <Msg data={msg} />

      {/* ── TAB SUELDOS Y CCSS ── */}
      {tabComp === 'sueldos' && (
        <div>
          <div style={{ fontSize:12, color:GR, marginBottom:12 }}>
            Gastos de Rubro 2 — Sueldos, FATERYH y VEP F.931 imputados en las expensas
          </div>
          <div style={{ display:'flex', gap:8, marginBottom:12 }}>
            <Btn small onClick={cargarGastosSueldos}>↺ Actualizar</Btn>
          </div>
          {cargandoSueldos ? (
            <div style={{ textAlign:'center', padding:32, color:GR }}>⏳ Cargando...</div>
          ) : gastosSueldos.length === 0 ? (
            <Card>
              <div style={{ textAlign:'center', padding:'24px 0', color:GR }}>
                <div style={{ fontSize:28, marginBottom:8 }}>💼</div>
                Sin gastos de sueldos o CCSS registrados en expensas
              </div>
            </Card>
          ) : (
            <Card style={{ padding:0, overflow:'hidden' }}>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f8fafc', borderBottom:'1.5px solid #e5e7eb' }}>
                      {['Fecha','Expensa','Concepto','Categoría','Monto','Notas',''].map((h,i) => (
                        <th key={i} style={{ padding:'8px 12px', textAlign:i===4?'right':'left',
                          fontWeight:600, color:'#374151', fontSize:11.5, whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gastosSueldos.map(g => {
                      const exp = expensas.find(e => e.id === g.expensa_id)
                      const catLabel = g.categoria === 'sueldos' ? '💼 Sueldo' :
                        g.categoria === 'fateryh' ? '🟣 FATERYH' :
                        g.categoria === 'vep_931' ? '🔵 VEP F.931' : g.categoria
                      const catColor = g.categoria === 'sueldos' ? AZ :
                        g.categoria === 'fateryh' ? '#5b21b6' :
                        g.categoria === 'vep_931' ? '#0369a1' : GR
                      return (
                        <tr key={g.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                          <td style={{ padding:'8px 12px', whiteSpace:'nowrap', color:GR, fontSize:11 }}>
                            {g.fecha ? new Date(g.fecha+'T00:00:00').toLocaleDateString('es-AR') : '—'}
                          </td>
                          <td style={{ padding:'8px 12px', fontSize:11, color:GR }}>
                            {exp ? (() => {
                              const [y,m] = (exp.periodo||'').split('-')
                              const ms=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                              return m ? `${ms[parseInt(m)-1]} ${y}` : exp.periodo
                            })() : '—'}
                          </td>
                          <td style={{ padding:'8px 12px', fontWeight:500, maxWidth:260 }}>
                            {g.concepto}
                          </td>
                          <td style={{ padding:'8px 12px' }}>
                            <span style={{ fontSize:11, padding:'2px 8px', borderRadius:6, fontWeight:600,
                              background: g.categoria==='sueldos'?'#eff6ff':g.categoria==='fateryh'?'#f5f3ff':'#eff6ff',
                              color: catColor }}>
                              {catLabel}
                            </span>
                          </td>
                          <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:700, color:AZ }}>
                            ${(Number(g.monto)||0).toLocaleString('es-AR',{minimumFractionDigits:2})}
                          </td>
                          <td style={{ padding:'8px 12px', fontSize:11, color:GR, maxWidth:160,
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {g.notas||'—'}
                          </td>
                          <td style={{ padding:'8px 10px', textAlign:'right' }}>
                            <button type="button"
                              onClick={() => anularGasto(g.id)}
                              title="Eliminar este gasto de la planilla de expensas"
                              style={{ padding:'4px 10px', background:'#fff', color:RJ,
                                border:`1px solid ${RJ}`, borderRadius:6, fontSize:11,
                                fontWeight:600, cursor:'pointer' }}>
                              🗑 Anular
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'#f0f4ff', borderTop:'2px solid #1A3FA0' }}>
                      <td colSpan={4} style={{ padding:'8px 12px', fontWeight:700, color:AZ }}>Total Rubro 2</td>
                      <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:800, fontSize:14, color:AZ }}>
                        ${gastosSueldos.reduce((a,g)=>a+(Number(g.monto)||0),0)
                          .toLocaleString('es-AR',{minimumFractionDigits:2})}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── TAB PROVEEDORES (contenido original) ── */}
      {tabComp === 'proveedores' && (
        <div>

      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Facturas, remitos y notas de proveedores con seguimiento de saldo
      </div>

      {/* KPI pendiente */}
      {totalPendiente > 0 && !form && !formPago && (
        <div style={{ background:'#fff8f0', border:'1px solid #fed7aa', borderRadius:8, padding:'10px 16px', marginBottom:14, fontSize:13 }}>
          ⚠️ Saldo total pendiente de pago: <strong style={{ color:RJ }}>{fmt(totalPendiente)}</strong>
        </div>
      )}

      <Msg data={msg} />

      {form && (
        <FormComp
          form={form} setForm={setForm}
          guardar={guardar} guardando={guardando}
          proveedores={proveedores} expensas={expensas}
          extraerFacturaConIA={extraerFacturaConIA}
          extrayendoIA={extrayendoIA} archivoFactura={archivoFactura}
        />
      )}
      {formPago && (
        <FormPago
          formPago={formPago} setFormPago={setFormPago}
          pagarComprobante={pagarComprobante}
          proveedores={proveedores}
        />
      )}

      {/* Filtros */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:8 }}>
          <Sel label="Filtrar por proveedor" value={filtro} onChange={setFiltro}
            opts={[{v:'',l:'Todos los proveedores'},...proveedores.map(p=>({v:p.id,l:p.razon_social}))]} />
          <Sel label="Estado" value={filtroEstado} onChange={setFiltroEstado}
            opts={[{v:'',l:'Todos los estados'},{v:'pendiente',l:'Pendiente'},{v:'pagado_parcial',l:'Pago parcial'},{v:'pagado',l:'Pagado'},{v:'anulado',l:'Anulado'}]} />
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Buscar</div>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:GR, fontSize:13 }}>🔍</span>
              <input value={busquedaComp} onChange={e=>setBusquedaComp(e.target.value)} placeholder="Concepto, N° comprobante..."
                style={{ width:'100%', paddingLeft:30, padding:'7px 10px 7px 30px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <Btn small color={GR} onClick={handlePDFComp}>🖨️ PDF</Btn>
          <Btn small color={VD} onClick={handleExcelComp}>📊 Excel</Btn>
          {(filtro||filtroEstado||busquedaComp) && (
            <Btn small onClick={()=>{setFiltro('');setFiltroEstado('');setBusquedaComp('')}} style={{ background:'#fee2e2', color:RJ }}>✕ Limpiar filtros</Btn>
          )}
          <span style={{ fontSize:11, color:GR, marginLeft:4 }}>
            {compsFiltrados.length} comprobante{compsFiltrados.length!==1?'s':''}
            {totalPendiente > 0 && <span style={{ color:RJ, marginLeft:8 }}>· Saldo pendiente: {fmt(totalPendiente)}</span>}
          </span>
        </div>
      </Card>

      {/* Tabla */}
      <Card>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'#f3f4f6' }}>
                {['Fecha','Vto.','Proveedor','Tipo','N°','Concepto','Total','Saldo','Estado','Acciones'].map((h,i) => (
                  <th key={i} style={{ padding:'7px 10px', textAlign:i>=6&&i<=7?'right':'left',
                    fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compsFiltrados.length === 0 ? (
                <tr><td colSpan={10} style={{ padding:24, textAlign:'center', color:GR }}>Sin comprobantes{(filtro||filtroEstado||busquedaComp)?' que coincidan con los filtros':' registrados'}</td></tr>
              ) : compsFiltrados.map(c => {
                const prov = proveedores.find(p=>p.id===c.proveedor_id)
                const est  = ESTADOS_COLOR[c.estado] || ESTADOS_COLOR.pendiente
                const vencido = c.fecha_vencimiento && c.fecha_vencimiento < hoy && c.estado !== 'pagado' && c.estado !== 'anulado'
                return (
                  <tr key={c.id} style={{ borderBottom:'1px solid #f3f4f6', opacity:c.estado==='anulado'?0.45:1,
                    background: formPago?.comp?.id===c.id ? '#f0fdf4' : 'transparent' }}>
                    <td style={{ padding:'7px 10px', whiteSpace:'nowrap', color:GR, fontSize:11 }}>{fmtD(c.fecha)}</td>
                    <td style={{ padding:'7px 10px', whiteSpace:'nowrap', fontSize:11,
                      color:vencido?RJ:GR, fontWeight:vencido?700:400 }}>
                      {c.fecha_vencimiento ? fmtD(c.fecha_vencimiento) : '—'}
                      {vencido && <span style={{ fontSize:9, display:'block' }}>⚠ VENCIDO</span>}
                    </td>
                    <td style={{ padding:'7px 10px', fontWeight:600, maxWidth:130 }}>{prov?.razon_social||'—'}</td>
                    <td style={{ padding:'7px 10px', textTransform:'capitalize', color:GR }}>{c.tipo}</td>
                    <td style={{ padding:'7px 10px', fontSize:11, color:GR }}>{c.numero||'—'}</td>
                    <td style={{ padding:'7px 10px', maxWidth:150 }}>{c.concepto}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:600 }}>{fmt(c.monto_total)}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700,
                      color: parseFloat(c.saldo_pendiente)>0 ? RJ : VD }}>
                      {c.estado==='pagado' ? '✓ Pagado' : fmt(c.saldo_pendiente)}
                    </td>
                    <td style={{ padding:'7px 10px' }}>
                      <Badge text={est.t} color={est.c} bg={est.bg} />
                    </td>
                    <td style={{ padding:'7px 10px' }}>
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        {/* Pagar aquí */}
                        {(c.estado==='pendiente'||c.estado==='pagado_parcial') && (
                          <Btn small color={VD} title="Registrar pago" onClick={()=>{
                            setFormPago({ comp:c, monto:c.saldo_pendiente, fecha:hoy, medio_pago:'transferencia' })
                            setForm(null)
                            setTimeout(()=>document.querySelector('[data-formPago]')?.scrollIntoView({behavior:'smooth'}),100)
                          }}>💸 Pagar</Btn>
                        )}
                        {/* Editar */}
                        {c.estado !== 'anulado' && (
                          <Btn small title="Editar" onClick={()=>{ setForm({...c}); setFormPago(null) }}
                            style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                        )}
                        {/* Anular */}
                        {c.estado !== 'anulado' && c.estado !== 'pagado' && (
                          <Btn small title="Anular" onClick={()=>anular(c.id)} style={{ background:'#fff3cd', color:AM }}>⊘</Btn>
                        )}
                        {/* Eliminar */}
                        <Btn small title="Eliminar" onClick={()=>eliminar(c.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGOS A PROVEEDORES
// ══════════════════════════════════════════════════════════════════════════════

function FormComp({ form, setForm, guardar, guardando, proveedores, expensas,
  extraerFacturaConIA, extrayendoIA, archivoFactura }) {
  const TIPOS = [
    {v:'factura',l:'Factura'},{v:'remito',l:'Remito'},{v:'ticket',l:'Ticket'},
    {v:'nota_debito',l:'Nota de débito'},{v:'nota_credito',l:'Nota de crédito'}
  ]
  return (
    <Card style={{ marginBottom:16, border:`1.5px solid ${form.id?AM:AZ}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <div style={{ fontWeight:700, color:form.id?AM:AZ, fontSize:13 }}>
          {form.id ? '✏ Editar comprobante' : '🧾 Nuevo comprobante'}
        </div>
      </div>

      {/* IA solo en alta nueva */}
      {!form.id && (
        <div style={{ background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#0369a1', marginBottom:6 }}>🤖 Extracción automática con IA (opcional)</div>
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <input type="file" accept=".pdf,image/*"
              onChange={e => e.target.files[0] && extraerFacturaConIA(e.target.files[0])}
              style={{ fontSize:12, flex:1 }} disabled={extrayendoIA} />
            {extrayendoIA && <span style={{ fontSize:12, color:'#0369a1', whiteSpace:'nowrap' }}>⏳ Analizando...</span>}
            {archivoFactura && !extrayendoIA && <span style={{ fontSize:11, color:VD, whiteSpace:'nowrap' }}>✓ {archivoFactura.name.slice(0,20)}</span>}
          </div>
          <div style={{ fontSize:10, color:'#6b7280', marginTop:4 }}>Suba la factura y la IA completará los campos automáticamente.</div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:12, marginBottom:12 }}>
        <Sel label="Proveedor *" value={form.proveedor_id||''} onChange={v=>setForm(f=>({...f,proveedor_id:v}))}
          opts={[{v:'',l:'— Seleccione —'},...proveedores.map(p=>({v:p.id,l:p.razon_social}))]} />
        <Sel label="Tipo" value={form.tipo||'factura'} onChange={v=>setForm(f=>({...f,tipo:v}))} opts={TIPOS} />
        <div>
          <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>N° comprobante</div>
          <input value={form.numero||''} placeholder="0001-00012345"
            onChange={e=>setForm(f=>({...f,numero:e.target.value}))}
            style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:12, marginBottom:12 }}>
        <div>
          <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Concepto *</div>
          <input value={form.concepto||''} placeholder="Descripción del servicio/producto"
            onChange={e=>setForm(f=>({...f,concepto:e.target.value}))}
            style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
        </div>
        <div>
          <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Fecha *</div>
          <input type="date" value={form.fecha||''} onChange={e=>setForm(f=>({...f,fecha:e.target.value}))}
            style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
        </div>
        <div>
          <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Vencimiento</div>
          <input type="date" value={form.fecha_vencimiento||''} onChange={e=>setForm(f=>({...f,fecha_vencimiento:e.target.value}))}
            style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:12 }}>
        {[
          { k:'monto_neto', l:'Monto neto' },
          { k:'iva', l:'IVA' },
          { k:'otros_impuestos', l:'Otros imp.' },
          { k:'monto_total', l:'Total *' },
        ].map(f2 => (
          <div key={f2.k}>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>{f2.l}</div>
            <input type="number" min="0" step="0.01" value={form[f2.k]||''}
              onChange={e => {
                const val = e.target.value
                setForm(f => {
                  const upd = {...f, [f2.k]: val}
                  if (f2.k !== 'monto_total') {
                    upd.monto_total = (
                      (parseFloat(upd.monto_neto)||0) +
                      (parseFloat(upd.iva)||0) +
                      (parseFloat(upd.otros_impuestos)||0)
                    ).toFixed(2)
                  }
                  return upd
                })
              }}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7,
                fontSize:13, boxSizing:'border-box',
                fontWeight: f2.k==='monto_total'?700:400,
                background: f2.k==='monto_total'?'#f0f4ff':'#fff' }} />
          </div>
        ))}
      </div>
      {/* ── Retenciones (Auditoría M-3) ── */}
      <div style={{background:'#fffbe6', border:'1px solid #ffe58f', borderRadius:8, padding:'10px 14px', marginBottom:12}}>
        <div style={{fontWeight:700, fontSize:12, color:'#854d0e', marginBottom:8}}>🏛️ Retenciones impositivas</div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10}}>
          {[
            { k:'retencion_iibb', l:'Ret. Ing. Brutos' },
            { k:'retencion_ganancias', l:'Ret. Ganancias' },
            { k:'retencion_suss', l:'Ret. SUSS/Seg. Social' },
          ].map(f2 => (
            <div key={f2.k}>
              <div style={{fontSize:11, color:GR, marginBottom:3, fontWeight:500}}>{f2.l}</div>
              <input type="number" min="0" step="0.01" value={form[f2.k]||''}
                onChange={e => setForm(f => ({...f, [f2.k]: e.target.value}))}
                placeholder="0.00"
                style={{width:'100%', padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:13, boxSizing:'border-box'}} />
            </div>
          ))}
          <div>
            <div style={{fontSize:11, color:'#854d0e', marginBottom:3, fontWeight:700}}>Monto a pagar</div>
            <div style={{padding:'7px 10px', background:'#fef9c3', border:'1px solid #fde047', borderRadius:6, fontWeight:700, fontSize:14, color:'#854d0e'}}>
              ${(((parseFloat(form.monto_total)||0) - (parseFloat(form.retencion_iibb)||0) - (parseFloat(form.retencion_ganancias)||0) - (parseFloat(form.retencion_suss)||0))).toLocaleString('es-AR', {minimumFractionDigits:2})}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
        <div>
          <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Período asociado</div>
          <select value={form.expensa_id||''} onChange={e=>setForm(f=>({...f,expensa_id:e.target.value}))}
            style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
            <option value="">Sin período</option>
            {expensas.map(e=><option key={e.id} value={e.id}>{e.periodo}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Notas</div>
          <input value={form.notas||''} placeholder="Opcional"
            onChange={e=>setForm(f=>({...f,notas:e.target.value}))}
            style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
        </div>
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <Btn onClick={guardar} disabled={guardando}>{guardando?'⏳':form.id?'💾 Actualizar':'✓ Guardar'}</Btn>
        <BtnSec onClick={()=>{setForm(null);setMsg(null)}}>Cancelar</BtnSec>
      </div>
    </Card>
  )
}

function FormPago({ formPago, setFormPago, pagarComprobante, proveedores }) {
  const MEDIOS_PAGO = [
    {v:'transferencia',l:'Transferencia'},{v:'cheque_propio',l:'Cheque propio'},
    {v:'cheque_tercero',l:'Cheque de tercero'},{v:'efectivo',l:'Efectivo'},{v:'otro',l:'Otro'}
  ]
  const hoy = new Date().toISOString().split('T')[0]
    const comp = formPago.comp
    const prov = proveedores.find(p=>p.id===comp.proveedor_id)
    return (
      <Card style={{ marginBottom:16, border:'2px solid #86efac', background:'#f0fdf4' }}>
        <div style={{ fontWeight:700, color:VD, fontSize:13, marginBottom:4 }}>💸 Registrar pago</div>
        <div style={{ fontSize:12, color:GR, marginBottom:12 }}>
          {prov?.razon_social} — {comp.tipo} {comp.numero||''} — {comp.concepto} — Saldo: <strong style={{ color:RJ }}>{fmt(comp.saldo_pendiente)}</strong>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Monto a pagar *</div>
            <input type="number" min="0" step="0.01" value={formPago.monto||''}
              onChange={e=>setFormPago(f=>({...f,monto:e.target.value}))}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #86efac', borderRadius:7, fontSize:14, fontWeight:700, boxSizing:'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Fecha *</div>
            <input type="date" value={formPago.fecha||hoy} onChange={e=>setFormPago(f=>({...f,fecha:e.target.value}))}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Medio de pago</div>
            <select value={formPago.medio_pago||'transferencia'} onChange={e=>setFormPago(f=>({...f,medio_pago:e.target.value}))}
              style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
              {MEDIOS_PAGO.map(m=><option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11, color:GR, marginBottom:3 }}>Ret. IIBB $</div>
            <input type="number" min="0" step="0.01" value={formPago.retencion_iibb||''}
              onChange={e=>setFormPago(f=>({...f,retencion_iibb:e.target.value}))}
              style={{ width:'100%', padding:'7px 9px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, boxSizing:'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:GR, marginBottom:3 }}>Ret. Ganancias $</div>
            <input type="number" min="0" step="0.01" value={formPago.retencion_ganancias||''}
              onChange={e=>setFormPago(f=>({...f,retencion_ganancias:e.target.value}))}
              style={{ width:'100%', padding:'7px 9px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, boxSizing:'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:GR, marginBottom:3 }}>N° Orden de pago</div>
            <input value={formPago.nro_orden_pago||''} onChange={e=>setFormPago(f=>({...f,nro_orden_pago:e.target.value}))}
              style={{ width:'100%', padding:'7px 9px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, boxSizing:'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:GR, marginBottom:3 }}>Referencia</div>
            <input value={formPago.referencia||''} onChange={e=>setFormPago(f=>({...f,referencia:e.target.value}))}
              style={{ width:'100%', padding:'7px 9px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, boxSizing:'border-box' }} />
          </div>
        </div>
        {formPago.monto && (formPago.retencion_iibb||formPago.retencion_ganancias||formPago.retencion_iva) && (
          <div style={{ fontSize:13, fontWeight:700, color:VD, marginBottom:10 }}>
            Neto a transferir: {fmt((parseFloat(formPago.monto)||0)-(parseFloat(formPago.retencion_iibb)||0)-(parseFloat(formPago.retencion_ganancias)||0)-(parseFloat(formPago.retencion_iva)||0))}
          </div>
        )}
        <div style={{ display:'flex', gap:8 }}>
          <Btn color={VD} onClick={pagarComprobante}>✓ Confirmar pago</Btn>
          <BtnSec onClick={()=>setFormPago(null)}>Cancelar</BtnSec>
        </div>
      </Card>
    )
}
