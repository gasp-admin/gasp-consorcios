// modules — Sueldos.jsx
// Extraído del V59. Refactorizado: props → useApp(). Cero cambios de comportamiento.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, leerReciboSueldo, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Sueldos() {
  const { session, consorcioActivo, expensas } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [tab, setTab]           = useState('liquidar')
  const [empleados, setEmpleados] = useState([])
  const [sueldos, setSueldos]   = useState([])
  const [expSel, setExpSel]     = useState('')
  const [msg, setMsg]           = useState(null)
  const [procesando, setProcesando] = useState(false)

  // ── Estado formulario empleado ──────────────────────────────────────
  const [formEmp, setFormEmp]   = useState(null)

  // ── Estado liquidación ──────────────────────────────────────────────
  const [filas, setFilas]       = useState([])   // array de liquidaciones del período
  const [fateryh, setFateryh]   = useState('')   // monto total FATERYH
  const [vep931, setVep931]     = useState('')   // monto total VEP 931
  const [filaTipo, setFilaTipo] = useState('mensual')

  // ── Estado IA ───────────────────────────────────────────────────────
  const [leyendoIA, setLeyendoIA] = useState(false)
  const [archivoIA, setArchivoIA] = useState(null)
  // input de archivo — se accede por ID directo sin useRef

  const hoy = new Date().toISOString().split('T')[0]
  // parseMto: soporta tanto formato argentino "1.234,56" como numérico "1234.56"
  // Los inputs type=number del browser envían punto decimal estándar (no formato argentino)
  const parseMto = s => {
    const str = String(s || '0').trim()
    if (!str || str === '') return 0
    // Si tiene coma → formato argentino: quitar puntos de miles, coma → punto decimal
    if (str.includes(',')) return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0
    // Si solo tiene punto → formato numérico estándar (input type=number)
    return parseFloat(str) || 0
  }

  const COLUMNAS = [
    { v:'GENERAL',   l:'General' },
    { v:'LOCALES',   l:'Locales' },
    { v:'DEPTOS',    l:'Deptos' },
    { v:'COCHERAS',  l:'Cocheras' },
    { v:'FDO_OBRAS', l:'Fdo. Obras' },
  ]
  const TIPOS_LIQ = [
    { v:'mensual',    l:'Sueldo mensual' },
    { v:'final',      l:'Liquidación final (alta/baja)' },
    { v:'reemplazo',  l:'Reemplazo / guardia' },
    { v:'adicional',  l:'Pago adicional' },
  ]
  const CATEGORIAS_EMP = [
    { v:'encargado_permanente', l:'Encargado permanente' },
    { v:'encargado_suplente',   l:'Encargado suplente' },
    { v:'auxiliar',             l:'Auxiliar' },
    { v:'otro',                 l:'Otro' },
  ]

    if (!p) return '—'
    const [y,m] = p.split('-')
    const meses=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return m ? `${meses[parseInt(m)-1]} ${y}` : p
  }

  // ── Cargar datos ────────────────────────────────────────────────────
  async function cargarEmpleados() {
    const { data } = await supabase.from('con_empleados').select('*')
      .eq('admin_id', uid).eq('consorcio_id', consorcioId)
      .order('apellido_nombre')
    setEmpleados(data || [])
  }
  async function cargarSueldos() {
    const { data } = await supabase.from('con_sueldos').select('*')
      .eq('admin_id', uid).eq('consorcio_id', consorcioId)
      .order('periodo', { ascending:false }).order('apellido_nombre')
    setSueldos(data || [])
  }
  useEffect(() => {
    if (consorcioId) { cargarEmpleados(); cargarSueldos() }
  }, [consorcioId])

  // ── Inicializar filas del período a liquidar ─────────────────────────
  useEffect(() => {
    if (tab === 'liquidar' && empleados.length > 0) {
      setFilas(empleados.filter(e => e.activo).map(e => ({
        empleado_id:         e.id,
        apellido_nombre:     e.apellido_nombre,
        categoria:           e.categoria,
        tipo_liquidacion:    'mensual',
        es_liquidacion_final: false,
        sueldo_basico:       '',
        adicionales:         '',
        aportes_empleado:    '',
        sueldo_neto:         '',
        columna:             'GENERAL',
        incluir:             true,
      })))
    }
  }, [tab, empleados.length, consorcioId])

  // ── Agregar fila manual (sin empleado registrado) ───────────────────
  function agregarFilaManual() {
    setFilas(prev => [...prev, {
      empleado_id:         null,
      apellido_nombre:     '',
      categoria:           '',
      tipo_liquidacion:    'mensual',
      es_liquidacion_final: false,
      sueldo_basico:       '',
      adicionales:         '',
      aportes_empleado:    '',
      sueldo_neto:         '',
      columna:             'GENERAL',
      incluir:             true,
      _manual:             true,
    }])
  }
  function actualizarFila(idx, campo, valor) {
    setFilas(prev => prev.map((f, i) => {
      if (i !== idx) return f
      const upd = { ...f, [campo]: valor }
      // Calcular neto automático si se cambia básico/adicionales/aportes
      if (['sueldo_basico','adicionales','aportes_empleado'].includes(campo)) {
        const bas = parseMto(campo==='sueldo_basico'?valor:upd.sueldo_basico)
        const adi = parseMto(campo==='adicionales'?valor:upd.adicionales)
        const apo = parseMto(campo==='aportes_empleado'?valor:upd.aportes_empleado)
        upd.sueldo_neto = String((bas + adi - apo || 0).toFixed(2))
      }
      return upd
    }))
  }

  // ── Lectura IA de recibo PDF (via Edge Function — evita CORS) ───────────
  async function leerReciboConIA(file, tipoDoc = 'recibo_sueldo') {
    if (!file) return
    setLeyendoIA(true); setMsg(null)
    try {
      // Convertir PDF a base64
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result.split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })

      // Llamar a la Edge Function (servidor Supabase) — sin problema de CORS
      const { data: { session: sess } } = await supabase.auth.getSession()
      const response = await fetch(`${SUPA_URL}/functions/v1/leer-recibo-sueldo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess?.access_token}`,
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        },
        body: JSON.stringify({
          base64:        b64,
          nombre_archivo: file.name,
          tipo:          tipoDoc,  // 'recibo_sueldo' | 'fateryh' | 'vep931'
        })
      })

      const result = await response.json()
      if (!response.ok || result.error) {
        throw new Error(result.error || `Error del servidor: ${response.status}`)
      }

      const parsed = result.datos || {}

      // Si leyó FATERYH → completar campo fateryh directamente
      if (tipoDoc === 'fateryh') {
        if (parsed.total_a_pagar) setFateryh(String(parsed.total_a_pagar))
        setMsg({ tipo:'ok', texto:`✓ FATERYH leído: Total ${parsed.total_a_pagar ? '$' + Number(parsed.total_a_pagar).toLocaleString('es-AR') : '—'} · Período ${parsed.periodo || '—'} · ${parsed.cantidad_trabajadores || '?'} trabajadores` })
        setLeyendoIA(false)
        return
      }

      // Si leyó VEP 931 → completar campo vep931 directamente
      if (tipoDoc === 'vep931') {
        if (parsed.total_a_pagar) setVep931(String(parsed.total_a_pagar))
        setMsg({ tipo:'ok', texto:`✓ VEP F.931 leído: Total ${parsed.total_a_pagar ? '$' + Number(parsed.total_a_pagar).toLocaleString('es-AR') : '—'} · Período ${parsed.periodo || '—'} · ${parsed.cantidad_empleados || '?'} empleados` })
        setLeyendoIA(false)
        return
      }

      // Recibo de sueldo — crear nueva fila
      const nuevaFila = {
        empleado_id:          null,
        apellido_nombre:      parsed.apellido_nombre || '',
        categoria:            '',
        tipo_liquidacion:     parsed.tipo_liquidacion || 'mensual',
        es_liquidacion_final: parsed.es_liquidacion_final || false,
        sueldo_basico:        parsed.sueldo_basico || '',
        adicionales:          parsed.adicionales || '',
        aportes_empleado:     parsed.aportes_empleado || '',
        sueldo_neto:          parsed.sueldo_neto || '',
        columna:              parsed.columna || 'GENERAL',
        notas:                parsed.notas || '',
        recibo_pdf_nombre:    file.name,
        incluir:              true,
        _ia:                  true,
      }

      // Avisar si el período del recibo difiere del seleccionado
      if (parsed.periodo && expSel) {
        const expPer = expensas.find(e => e.id === expSel)?.periodo
        if (expPer && parsed.periodo !== expPer) {
          nuevaFila.notas = (nuevaFila.notas ? nuevaFila.notas + ' | ' : '') +
            `⚠ Período recibo: ${parsed.periodo}`
        }
      }

      // Buscar empleado coincidente por apellido
      const primerApellido = (parsed.apellido_nombre || '').split(' ')[0]?.toUpperCase()
      if (primerApellido && primerApellido.length > 2) {
        const match = empleados.find(e =>
          e.apellido_nombre.toUpperCase().includes(primerApellido)
        )
        if (match) nuevaFila.empleado_id = match.id
      }

      setFilas(prev => [...prev, nuevaFila])
      setMsg({ tipo:'ok', texto:`✓ IA extrajo datos de "${file.name}" — Verificar y ajustar antes de imputar` })
    } catch(e) {
      setMsg({ tipo:'error', texto:'Error al leer PDF con IA: ' + e.message })
    }
    setLeyendoIA(false)
  }

  // ── Imputar sueldos a con_gastos ─────────────────────────────────────
  async function imputarSueldos() {
    if (!expSel) return setMsg({ tipo:'warn', texto:'Seleccioná el período de expensas primero' })
    const filasActivas = filas.filter(f => f.incluir && parseMto(f.sueldo_neto) > 0)
    if (filasActivas.length === 0) return setMsg({ tipo:'warn', texto:'No hay filas con sueldo neto mayor a cero' })
    setProcesando(true); setMsg(null)
    const exp = expensas.find(e => e.id === expSel)
    const periodo = exp?.periodo || ''
    let ok = 0, errores = []

    for (const fila of filasActivas) {
      const neto = parseMto(fila.sueldo_neto)
      const apellido = fila.apellido_nombre.trim()
      const esLiqFinal = fila.es_liquidacion_final || fila.tipo_liquidacion === 'final'
      const tipoDesc = fila.tipo_liquidacion === 'reemplazo'
        ? 'Reemplazo' + (fila.notas ? ' ' + fila.notas : '')
        : esLiqFinal ? 'Sueldo neto' : 'Sueldo neto'
      const concepto = esLiqFinal
        ? `Sueldos, ${apellido}, ${tipoDesc} - ${periodo} Liquidación final`
        : fila.tipo_liquidacion === 'reemplazo'
          ? `Sueldos, ${apellido}, ${tipoDesc} - ${periodo}`
          : `Sueldos, ${apellido}, Sueldo neto - ${periodo}`

      // La columna de prorrateo se incorpora en las notas del gasto
      // (con_gastos no tiene campos de prorrateo — usa concepto + notas)
      const colLabel = { GENERAL:'General', LOCALES:'Locales', DEPTOS:'Deptos',
        COCHERAS:'Cocheras', FDO_OBRAS:'Fdo. Obras' }[fila.columna] || fila.columna

      const idSueldo = `GAS-SLD-${consorcioId}-${Date.now()}-${ok}`
      const { error } = await supabase.from('con_gastos').insert([{
        id:          idSueldo,
        admin_id:    uid,
        consorcio_id: consorcioId,
        expensa_id:  expSel,
        categoria:   'sueldos',
        concepto,
        monto:       neto,
        fecha:       hoy,
        notas:       [fila.notas, `Col: ${colLabel}`].filter(Boolean).join(' | ') || null,
      }])

      if (!error) {
        // Guardar en con_sueldos para historial
        const sueldoId = `SLD-${consorcioId}-${Date.now()}-${ok}`
        await supabase.from('con_sueldos').insert([{
          id: sueldoId,
          admin_id:    uid,
          consorcio_id: consorcioId,
          expensa_id:  expSel,
          empleado_id: fila.empleado_id,
          periodo,
          fecha_pago:  hoy,
          apellido_nombre: apellido,
          categoria:   fila.categoria || null,
          es_liquidacion_final: esLiqFinal,
          tipo_liquidacion: fila.tipo_liquidacion,
          sueldo_basico:   parseMto(fila.sueldo_basico),
          adicionales:     parseMto(fila.adicionales),
          aportes_empleado: parseMto(fila.aportes_empleado),
          sueldo_neto:     neto,
          columna:         fila.columna,
          imputado:        true,
          gasto_id_sueldo: idSueldo,
          recibo_pdf_nombre: fila.recibo_pdf_nombre || null,
          notas:           fila.notas || null,
        }])
        ok++
      } else {
        errores.push(`${apellido}: ${error.message}`)
      }
    }

    // FATERYH
    const montoFateryh = parseMto(fateryh)
    let fateryh_ok = false
    if (montoFateryh > 0) {
      const idFat = `GAS-FAT-${consorcioId}-${Date.now()}`
      const { error: ef } = await supabase.from('con_gastos').insert([{
        id: idFat, admin_id: uid, consorcio_id: consorcioId, expensa_id: expSel,
        categoria: 'fateryh', concepto: 'F.A.T.E.R.Y.H.',
        monto: montoFateryh, fecha: hoy,
      }])
      if (!ef) { ok++; fateryh_ok = true }
      else errores.push(`FATERYH: ${ef.message}`)
    }

    // VEP 931
    const montoVep = parseMto(vep931)
    let vep_ok = false
    if (montoVep > 0) {
      const idVep = `GAS-VEP-${consorcioId}-${Date.now()}`
      const { error: ev } = await supabase.from('con_gastos').insert([{
        id: idVep, admin_id: uid, consorcio_id: consorcioId, expensa_id: expSel,
        categoria: 'vep_931', concepto: 'VEP F.931 — Cargas sociales AFIP',
        monto: montoVep, fecha: hoy,
        notas: 'Aportes + contribuciones seguridad social y obra social',
      }])
      if (!ev) { ok++; vep_ok = true }
      else errores.push(`VEP 931: ${ev.message}`)
    }

    if (errores.length === 0) {
      setMsg({ tipo:'ok', texto:`✓ ${ok} gastos imputados correctamente en Rubro 2 — Expensas ${periodoLabel(periodo)}` })
      cargarSueldos()
    } else {
      setMsg({ tipo:'warn', texto:`${ok} imputados · Errores: ${errores.join(' | ')}` })
    }
    setProcesando(false)
  }

  // ── Guardar empleado ─────────────────────────────────────────────────
  async function guardarEmpleado() {
    if (!formEmp?.apellido_nombre) return setMsg({ tipo:'warn', texto:'El nombre es requerido' })
    const payload = {
      ...formEmp,
      admin_id:     uid,
      consorcio_id: consorcioId,
      id:           formEmp.id || `EMP-${consorcioId}-${Date.now()}`,
      updated_at:   new Date().toISOString(),
    }
    const { error } = await supabase.from('con_empleados').upsert([payload], { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto: error.message })
    setMsg({ tipo:'ok', texto:'✓ Empleado guardado' })
    setFormEmp(null)
    cargarEmpleados()
  }

  // ── RENDER ───────────────────────────────────────────────────────────
  const totalNeto   = filas.filter(f=>f.incluir).reduce((a,f)=>a+parseMto(f.sueldo_neto),0)
  const totalRubro2 = totalNeto + parseMto(fateryh) + parseMto(vep931)
  const expActual   = expensas.find(e => e.id === expSel)

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>💼 Sueldos y cargas sociales</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Rubro 2 — CCT 589/10 FATERYH · Liquidación de empleados del consorcio
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:'2px solid #e5e7eb' }}>
        {[
          { id:'liquidar',   l:'📝 Liquidar período' },
          { id:'historial',  l:'📋 Historial' },
          { id:'empleados',  l:'👷 Empleados' },
        ].map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{ padding:'8px 16px', border:'none',
              borderBottom:tab===t.id?`2px solid ${AZ}`:'2px solid transparent',
              background:'transparent', color:tab===t.id?AZ:GR,
              fontWeight:tab===t.id?700:400, fontSize:13, cursor:'pointer', marginBottom:-2 }}>
            {t.l}
          </button>
        ))}
      </div>

      <Msg data={msg} />

      {/* ── TAB LIQUIDAR ── */}
      {tab === 'liquidar' && (
        <div>
          {/* Selector período */}
          <Card style={{ marginBottom:16 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, alignItems:'end' }}>
              <Sel label="Período de expensas" value={expSel} onChange={setExpSel}
                opts={[{ v:'', l:'— Seleccioná el período —' },
                  ...expensas.map(e => ({ v:e.id, l:`${periodoLabel(e.periodo)} ${e.estado==='abierta'?'✓':'🔒'} ${e.tipo||''}` }))
                ]} />
              <div style={{ padding:'10px 14px', background:'#eff6ff', borderRadius:8, fontSize:12 }}>
                <div style={{ fontWeight:600, color:AZ, marginBottom:2 }}>💡 Flujo de trabajo</div>
                <div style={{ color:'#374151', lineHeight:1.6 }}>
                  1. Cargar sueldos manualmente o con PDF (IA)<br/>
                  2. Completar FATERYH y VEP 931<br/>
                  3. Imputar → se generan gastos en Rubro 2
                </div>
              </div>
            </div>
          </Card>

          {/* Botones de carga */}
          <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
            <button type="button" onClick={agregarFilaManual} style={{ padding:"6px 14px", background:AZ, color:"#fff", border:"none", borderRadius:7, fontSize:12.5, fontWeight:600, cursor:"pointer" }}>+ Agregar sueldo manual</button>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {/* Input oculto compartido — el tipo se guarda en el atributo data */}
              <input
                type="file" accept=".pdf,application/pdf"
                onChange={e => {
                  const tipo = e.target.dataset.tipo || 'recibo_sueldo'
                  if (e.target.files[0]) leerReciboConIA(e.target.files[0], tipo)
                  e.target.value = ''
                }}
                style={{ display:'none' }} id="ia-recibo-upload" />
              <button type="button" disabled={leyendoIA}
                onClick={() => { document.getElementById('ia-recibo-upload').dataset.tipo='recibo_sueldo'; document.getElementById('ia-recibo-upload').click() }}
                style={{ padding:'6px 12px', background:'#7c3aed', color:'#fff', border:'none',
                  borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', opacity:leyendoIA?0.6:1 }}>
                {leyendoIA ? '⏳ Leyendo...' : '🤖 Recibo sueldo (IA)'}
              </button>
              <button type="button" disabled={leyendoIA}
                onClick={() => { document.getElementById('ia-recibo-upload').dataset.tipo='fateryh'; document.getElementById('ia-recibo-upload').click() }}
                style={{ padding:'6px 12px', background:'#5b21b6', color:'#fff', border:'none',
                  borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', opacity:leyendoIA?0.6:1 }}>
                {leyendoIA ? '⏳ Leyendo...' : '🤖 Boleta FATERYH (IA)'}
              </button>
              <button type="button" disabled={leyendoIA}
                onClick={() => { document.getElementById('ia-recibo-upload').dataset.tipo='vep931'; document.getElementById('ia-recibo-upload').click() }}
                style={{ padding:'6px 12px', background:'#0369a1', color:'#fff', border:'none',
                  borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', opacity:leyendoIA?0.6:1 }}>
                {leyendoIA ? '⏳ Leyendo...' : '🤖 VEP F.931 (IA)'}
              </button>
            </div>
          </div>

          {/* Tabla de sueldos */}
          {filas.length > 0 && (
            <Card style={{ marginBottom:14, padding:0, overflow:'hidden' }}>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f8fafc', borderBottom:'1.5px solid #e5e7eb' }}>
                      <th style={{ padding:'8px 10px', width:30, textAlign:'center' }}>✓</th>
                      <th style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#374151', minWidth:160 }}>Empleado</th>
                      <th style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#374151', minWidth:110 }}>Tipo</th>
                      <th style={{ padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#374151', minWidth:100 }}>Básico</th>
                      <th style={{ padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#374151', minWidth:90 }}>Adicionales</th>
                      <th style={{ padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#374151', minWidth:90 }}>Aportes emp.</th>
                      <th style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, color:AZ, minWidth:105 }}>Neto a imputar</th>
                      <th style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#374151', minWidth:100 }}>Columna</th>
                      <th style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#374151', minWidth:80 }}>Notas</th>
                      <th style={{ padding:'8px 10px', width:30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => (
                      <tr key={i} style={{ borderBottom:'1px solid #f1f5f9',
                        background: f._ia ? '#faf5ff' : f._manual ? '#f0fdf4' : '#fff',
                        opacity: f.incluir ? 1 : 0.45 }}>
                        <td style={{ padding:'6px 10px', textAlign:'center' }}>
                          <input type="checkbox" checked={!!f.incluir}
                            onChange={e => actualizarFila(i,'incluir',e.target.checked)} />
                        </td>
                        <td style={{ padding:'6px 10px' }}>
                          {f._manual || f._ia ? (
                            <input value={f.apellido_nombre}
                              onChange={e => actualizarFila(i,'apellido_nombre',e.target.value)}
                              placeholder="APELLIDO Nombre"
                              style={{ width:'100%', padding:'4px 7px', border:'1px solid #d1d5db',
                                borderRadius:5, fontSize:11.5, boxSizing:'border-box' }} />
                          ) : (
                            <div>
                              <div style={{ fontWeight:600, fontSize:12 }}>{f.apellido_nombre}</div>
                              {f._ia && <span style={{ fontSize:10, color:'#7c3aed', fontWeight:600 }}>IA 🤖</span>}
                            </div>
                          )}
                          {f.es_liquidacion_final && (
                            <div style={{ fontSize:10, color:RJ, fontWeight:600 }}>Liquidación final</div>
                          )}
                        </td>
                        <td style={{ padding:'6px 10px' }}>
                          <select value={f.tipo_liquidacion}
                            onChange={e => {
                              actualizarFila(i,'tipo_liquidacion',e.target.value)
                              if (e.target.value==='final') actualizarFila(i,'es_liquidacion_final',true)
                              else actualizarFila(i,'es_liquidacion_final',false)
                            }}
                            style={{ width:'100%', padding:'4px 5px', border:'1px solid #d1d5db',
                              borderRadius:5, fontSize:11, background:'#fff' }}>
                            {TIPOS_LIQ.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                          </select>
                        </td>
                        {['sueldo_basico','adicionales','aportes_empleado'].map(campo => (
                          <td key={campo} style={{ padding:'6px 8px', textAlign:'right' }}>
                            <input type="number" value={f[campo]}
                              onChange={e => actualizarFila(i, campo, e.target.value)}
                              placeholder="0"
                              style={{ width:'92px', padding:'4px 6px', border:'1px solid #d1d5db',
                                borderRadius:5, fontSize:11.5, textAlign:'right', boxSizing:'border-box' }} />
                          </td>
                        ))}
                        <td style={{ padding:'6px 10px', textAlign:'right' }}>
                          <input type="number" value={f.sueldo_neto}
                            onChange={e => actualizarFila(i,'sueldo_neto',e.target.value)}
                            style={{ width:'105px', padding:'4px 7px', border:`1.5px solid ${AZ}`,
                              borderRadius:5, fontSize:12.5, fontWeight:700, textAlign:'right',
                              color:AZ, boxSizing:'border-box' }} />
                        </td>
                        <td style={{ padding:'6px 8px' }}>
                          <select value={f.columna}
                            onChange={e => actualizarFila(i,'columna',e.target.value)}
                            style={{ padding:'4px 5px', border:'1px solid #d1d5db',
                              borderRadius:5, fontSize:11, background:'#fff', width:'100%' }}>
                            {COLUMNAS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                          </select>
                        </td>
                        <td style={{ padding:'6px 8px' }}>
                          <input value={f.notas||''} onChange={e => actualizarFila(i,'notas',e.target.value)}
                            placeholder="opcional"
                            style={{ width:'100%', padding:'4px 6px', border:'1px solid #d1d5db',
                              borderRadius:5, fontSize:11, boxSizing:'border-box' }} />
                        </td>
                        <td style={{ padding:'6px 8px', textAlign:'center' }}>
                          <button onClick={() => setFilas(prev => prev.filter((_,j)=>j!==i))}
                            style={{ background:'none', border:'none', cursor:'pointer',
                              color:RJ, fontSize:14, fontWeight:700 }}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'#f0f4ff', borderTop:'1.5px solid #1A3FA0' }}>
                      <td colSpan={6} style={{ padding:'8px 10px', fontWeight:700, color:AZ, fontSize:12 }}>
                        Total sueldos netos
                      </td>
                      <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:800, color:AZ, fontSize:13 }}>
                        {fmt(totalNeto)}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}

          {/* FATERYH + VEP 931 */}
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontWeight:600, color:'#374151', fontSize:13, marginBottom:12 }}>
              Cargas adicionales del Rubro 2
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:GR, marginBottom:4 }}>
                  F.A.T.E.R.Y.H. — Boleta sindical
                </div>
                <input type="number" value={fateryh}
                  onChange={e => setFateryh(e.target.value)}
                  placeholder="0.00"
                  style={{ width:'100%', padding:'9px 11px', border:'1px solid #d1d5db',
                    borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                <div style={{ fontSize:10.5, color:GR, marginTop:3 }}>
                  Total boleta FATERYH (FMVDD + CPF + Aporte sindical + ART 27bis)
                </div>
              </div>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:GR, marginBottom:4 }}>
                  VEP F.931 — Cargas sociales ARCA/AFIP
                </div>
                <input type="number" value={vep931}
                  onChange={e => setVep931(e.target.value)}
                  placeholder="0.00"
                  style={{ width:'100%', padding:'9px 11px', border:'1px solid #d1d5db',
                    borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                <div style={{ fontSize:10.5, color:GR, marginTop:3 }}>
                  Total VEP 931 (SS + OS + ART + SCVO)
                </div>
              </div>
            </div>
          </Card>

          {/* Resumen y botón imputar */}
          <Card style={{ background:'#f0f4ff', border:'1px solid #bfdbfe', marginBottom:14 }}>
            <div style={{ fontWeight:700, fontSize:13, color:AZ, marginBottom:10 }}>
              Resumen Rubro 2 — Sueldos y Cargas Sociales
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:14 }}>
              {[
                { l:'Sueldos netos', v:totalNeto, c:'#374151' },
                { l:'F.A.T.E.R.Y.H.', v:parseMto(fateryh), c:'#5b21b6' },
                { l:'VEP F.931', v:parseMto(vep931), c:'#0369a1' },
              ].map(({l,v,c}) => (
                <div key={l} style={{ textAlign:'center', background:'#fff', borderRadius:8, padding:'10px 12px' }}>
                  <div style={{ fontSize:11, color:GR, marginBottom:3 }}>{l}</div>
                  <div style={{ fontSize:16, fontWeight:700, color:c }}>{fmt(v)}</div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'10px 14px', background:'#1A3FA0', borderRadius:8, marginBottom:14 }}>
              <span style={{ color:'#fff', fontWeight:700, fontSize:13 }}>TOTAL RUBRO 2</span>
              <span style={{ color:'#fff', fontWeight:800, fontSize:18 }}>{fmt(totalRubro2)}</span>
            </div>
            <div style={{ fontSize:11.5, color:'#374151', marginBottom:12, lineHeight:1.7 }}>
              <strong>Gastos que se generarán en Rubro 2:</strong><br/>
              {filas.filter(f=>f.incluir&&parseMto(f.sueldo_neto)>0).map((f,i) => (
                <div key={i} style={{ fontSize:11, color:GR, paddingLeft:8 }}>
                  • {f.es_liquidacion_final||f.tipo_liquidacion==='final'
                    ? `Sueldos, ${f.apellido_nombre}, Sueldo neto - ${expActual?.periodo||'?'} Liquidación final`
                    : f.tipo_liquidacion==='reemplazo'
                      ? `Sueldos, ${f.apellido_nombre}, Reemplazo${f.notas?' '+f.notas:''} - ${expActual?.periodo||'?'}`
                      : `Sueldos, ${f.apellido_nombre}, Sueldo neto - ${expActual?.periodo||'?'}`
                  } → {COLUMNAS.find(c=>c.v===f.columna)?.l} {fmt(parseMto(f.sueldo_neto))}
                </div>
              ))}
              {parseMto(fateryh)>0 && <div style={{ fontSize:11, color:GR, paddingLeft:8 }}>• F.A.T.E.R.Y.H. → General {fmt(parseMto(fateryh))}</div>}
              {parseMto(vep931)>0 && <div style={{ fontSize:11, color:GR, paddingLeft:8 }}>• VEP F.931 — Cargas sociales AFIP → General {fmt(parseMto(vep931))}</div>}
            </div>
            <Btn onClick={imputarSueldos} disabled={procesando||!expSel}
              style={{ opacity: (procesando||!expSel)?0.5:1 }}>
              {procesando ? '⏳ Imputando...' : '💸 Imputar en planilla de gastos'}
            </Btn>
            {!expSel && (
              <div style={{ fontSize:11.5, color:AM, marginTop:6 }}>⚠ Seleccioná el período primero</div>
            )}
          </Card>
        </div>
      )}

      {/* ── TAB HISTORIAL ── */}
      {tab === 'historial' && (
        <Card>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>
            Historial de liquidaciones de sueldos ({sueldos.length})
          </div>
          {sueldos.length === 0 ? (
            <div style={{ color:GR, fontSize:13, padding:'16px 0' }}>Sin liquidaciones registradas</div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['Período','Empleado','Tipo','Sueldo neto','FATERYH','Columna','Imputado'].map((h,i) => (
                      <th key={i} style={{ padding:'7px 10px', textAlign:i>=2?'right':'left',
                        fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb',
                        whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sueldos.map(s => (
                    <tr key={s.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'7px 10px' }}>{periodoLabel(s.periodo)}</td>
                      <td style={{ padding:'7px 10px', fontWeight:600 }}>
                        {s.apellido_nombre}
                        {s.es_liquidacion_final && <span style={{ fontSize:10, color:RJ, marginLeft:4 }}>Liq. Final</span>}
                      </td>
                      <td style={{ padding:'7px 10px', textAlign:'right', textTransform:'capitalize' }}>
                        {s.tipo_liquidacion}
                      </td>
                      <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:600, color:AZ }}>
                        {fmt(s.sueldo_neto)}
                      </td>
                      <td style={{ padding:'7px 10px', textAlign:'right', color:'#5b21b6' }}>
                        {s.fateryh_monto > 0 ? fmt(s.fateryh_monto) : '—'}
                      </td>
                      <td style={{ padding:'7px 10px', textAlign:'right', fontSize:11 }}>
                        {COLUMNAS.find(c=>c.v===s.columna)?.l || s.columna}
                      </td>
                      <td style={{ padding:'7px 10px', textAlign:'right' }}>
                        {s.imputado
                          ? <span style={{ color:VD, fontSize:11, fontWeight:600 }}>✓ Imputado</span>
                          : <span style={{ color:AM, fontSize:11 }}>Pendiente</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── TAB EMPLEADOS ── */}
      {tab === 'empleados' && (
        <div>
          {formEmp ? (
            <Card>
              <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>
                {formEmp.id ? '✏ Editar empleado' : '+ Nuevo empleado'}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
                <div style={{ gridColumn:'span 2' }}>
                  <Input label="Apellido y Nombre" value={formEmp.apellido_nombre||''}
                    onChange={v=>setFormEmp(x=>({...x,apellido_nombre:v}))}
                    placeholder="APELLIDO Nombre" required />
                </div>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Categoría</div>
                  <select value={formEmp.categoria||''}
                    onChange={e=>setFormEmp(x=>({...x,categoria:e.target.value}))}
                    style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db',
                      borderRadius:7, fontSize:13, background:'#fff' }}>
                    <option value="">— Categoría —</option>
                    {CATEGORIAS_EMP.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                  </select>
                </div>
                <Input label="CUIL" value={formEmp.cuil||''} onChange={v=>setFormEmp(x=>({...x,cuil:v}))}
                  placeholder="20-12345678-9" />
                <Input label="Fecha ingreso" value={formEmp.fecha_ingreso||''}
                  onChange={v=>setFormEmp(x=>({...x,fecha_ingreso:v}))} type="date" />
                <div>
                  <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginTop:8 }}>
                    <input type="checkbox" checked={!!formEmp.activo}
                      onChange={e=>setFormEmp(x=>({...x,activo:e.target.checked}))} />
                    <span>Activo</span>
                  </label>
                </div>
                <Input label="Banco" value={formEmp.banco||''} onChange={v=>setFormEmp(x=>({...x,banco:v}))}
                  placeholder="Banco Macro" />
                <Input label="CBU" value={formEmp.cbu||''} onChange={v=>setFormEmp(x=>({...x,cbu:v}))}
                  placeholder="22 dígitos" />
                <div style={{ gridColumn:'span 2' }}>
                  <Input label="Notas" value={formEmp.notas||''} onChange={v=>setFormEmp(x=>({...x,notas:v}))}
                    placeholder="Observaciones" />
                </div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn onClick={guardarEmpleado}>💾 Guardar</Btn>
                <BtnSec onClick={()=>setFormEmp(null)}>Cancelar</BtnSec>
              </div>
            </Card>
          ) : (
            <>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div style={{ fontWeight:600, fontSize:13 }}>Empleados del consorcio ({empleados.length})</div>
                <Btn small onClick={()=>setFormEmp({ activo:true })}>+ Agregar empleado</Btn>
              </div>
              {empleados.length === 0 ? (
                <Card>
                  <div style={{ textAlign:'center', padding:'24px 0', color:GR }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>👷</div>
                    <div style={{ fontWeight:600, marginBottom:6 }}>Sin empleados registrados</div>
                    <div style={{ fontSize:12 }}>
                      Registrá los empleados para que aparezcan automáticamente al liquidar.<br/>
                      También podés cargar sueldos manualmente o con PDF sin registro previo.
                    </div>
                  </div>
                </Card>
              ) : (
                <Card style={{ padding:0, overflow:'hidden' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                    <thead>
                      <tr style={{ background:'#f8fafc', borderBottom:'1.5px solid #e5e7eb' }}>
                        {['Empleado','CUIL','Categoría','Ingreso','Banco','Estado',''].map((h,i)=>(
                          <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600,
                            color:'#374151', fontSize:11.5 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {empleados.map(e => (
                        <tr key={e.id} style={{ borderBottom:'1px solid #f3f4f6',
                          opacity: e.activo ? 1 : 0.55 }}>
                          <td style={{ padding:'8px 12px', fontWeight:600 }}>{e.apellido_nombre}</td>
                          <td style={{ padding:'8px 12px', color:GR, fontSize:11 }}>{e.cuil||'—'}</td>
                          <td style={{ padding:'8px 12px', fontSize:11 }}>
                            {CATEGORIAS_EMP.find(c=>c.v===e.categoria)?.l||e.categoria||'—'}
                          </td>
                          <td style={{ padding:'8px 12px', color:GR, fontSize:11 }}>
                            {e.fecha_ingreso ? new Date(e.fecha_ingreso+'T00:00:00').toLocaleDateString('es-AR') : '—'}
                          </td>
                          <td style={{ padding:'8px 12px', color:GR, fontSize:11 }}>{e.banco||'—'}</td>
                          <td style={{ padding:'8px 12px' }}>
                            <Badge text={e.activo?'Activo':'Inactivo'}
                              color={e.activo?VD:'#9ca3af'}
                              bg={e.activo?'#dcfce7':'#f3f4f6'} />
                          </td>
                          <td style={{ padding:'8px 10px', textAlign:'right' }}>
                            <BtnSec small onClick={()=>setFormEmp({...e})}>✏ Editar</BtnSec>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// ANULAR COBRANZAS
// ══════════════════════════════════════════════════════════════════════════════
