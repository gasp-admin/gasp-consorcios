// modules — CertificadoLibreDeuda.jsx
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

export default function CertificadoLibreDeuda() {
  const { session, consorcioActivo, unidades, copropietarios, expensas, adminPerfil } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [tab, setTab]             = useState('nuevo')
  const [certificados, setCertificados] = useState([])

  // ── Formulario ────────────────────────────────────────────────────────────
  const [ufSel, setUfSel]         = useState('')
  const [solicitante, setSolicitante] = useState('')
  const [tipoSol, setTipoSol]     = useState('escribano')
  const [estadoDeuda, setEstadoDeuda] = useState('NO')
  const [montoDeuda, setMontoDeuda]   = useState('')
  const [expSel, setExpSel]       = useState('')   // expensa actual (para monto)
  const [montoProxima, setMontoProxima] = useState('')
  // Datos editables (pre-cargados del consorcio)
  const [escrituraNro, setEscrituraNro]   = useState('')
  const [escrituraFecha, setEscrituraFecha] = useState('')
  const [escribanoReg, setEscribanoReg]   = useState('')
  const [matriculaRPI, setMatriculaRPI]   = useState('')
  const [polizaNro, setPolizaNro]         = useState('')
  const [polizaComp, setPolizaComp]       = useState('')
  const [polizaDesde, setPolizaDesde]     = useState('')
  const [polizaHasta, setPolizaHasta]     = useState('')
  const [polizaSuma, setPolizaSuma]       = useState('')
  const [tieneCocheras, setTieneCocheras] = useState(true)
  const [tieneFondo, setTieneFondo]       = useState(false)
  // Resultado
  const [textoGenerado, setTextoGenerado] = useState('')
  const [generando, setGenerando]         = useState(false)
  const [msg, setMsg]                     = useState(null)
  const [certIdGenerado, setCertIdGenerado] = useState(null)
  const [leyendoDrive, setLeyendoDrive] = useState(false)
  const [resultadoDrive, setResultadoDrive] = useState(null)

  const fmt = n => '$' + (Number(n)||0).toLocaleString('es-AR',{minimumFractionDigits:2})
  const hoy = new Date().toISOString().split('T')[0]

  const periodoLabel = p => {
    if (!p) return '—'
    const [y,m] = p.split('-')
    const ms=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    return m ? `${ms[parseInt(m)-1].toUpperCase()} ${y}` : p
  }

  // Pre-cargar datos del consorcio al montar o al cambiar consorcio
  useEffect(() => {
    if (consorcioActivo) {
      setEscrituraNro(consorcioActivo.escritura_nro || '')
      setEscrituraFecha(consorcioActivo.escritura_fecha || '')
      if (consorcioActivo.escritura_escribano) setEscribanoReg(consorcioActivo.escritura_escribano)
      setMatriculaRPI(consorcioActivo.matricula_rpi || '')
      setPolizaNro(consorcioActivo.poliza_nro || '')
      setPolizaComp(consorcioActivo.poliza_compania || '')
      setPolizaDesde(consorcioActivo.poliza_vto_desde || '')
      setPolizaHasta(consorcioActivo.poliza_vto_hasta || '')
      setPolizaSuma(consorcioActivo.poliza_suma ? String(consorcioActivo.poliza_suma) : '')
      setTieneCocheras(consorcioActivo.tiene_cocheras_tasas !== false)
      setTieneFondo(consorcioActivo.tiene_fondo_reserva === true)
    }
  }, [consorcioId, consorcioActivo?.id])

  // Cargar historial
  async function cargarCertificados() {
    const { data } = await supabase.from('con_certificados').select('*')
      .eq('admin_id', session.user.id).eq('consorcio_id', consorcioId)
      .order('created_at', { ascending:false }).limit(50)
    setCertificados(data || [])
  }
  useEffect(() => { if (consorcioId) cargarCertificados() }, [consorcioId])

  // UF seleccionada
  const ufObj  = unidades.find(u => u.id === ufSel)
  const cpObj  = copropietarios.find(c => c.id === ufObj?.propietario_id)
  const expObj = expensas.find(e => e.id === expSel)

  // Pre-completar solicitante con el propietario al seleccionar UF
  useEffect(() => {
    if (cpObj && !solicitante) setSolicitante(cpObj.apellido_nombre || '')
  }, [ufSel])

  // Pre-seleccionar la última expensa cerrada al montar
  useEffect(() => {
    const cerrada = expensas.find(e => e.estado === 'cerrada')
    if (cerrada && !expSel) setExpSel(cerrada.id)
  }, [expensas.length])

  // Recargar datos guardados de BD (póliza ya cargada por el administrador)
  async function leerDesdeDrive() {
    if (!consorcioId) return
    setLeyendoDrive(true); setMsg(null)
    try {
      const { data, error } = await supabase.from('con_consorcios').select(
        'matricula_rpi, escritura_nro, escritura_fecha, escritura_escribano, poliza_nro, poliza_compania, poliza_vto_desde, poliza_vto_hasta, poliza_suma, tiene_cocheras_tasas, tiene_fondo_reserva'
      ).eq('id', consorcioId).single()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Consorcio no encontrado')

      let campos = 0
      if (data.matricula_rpi)       { setMatriculaRPI(data.matricula_rpi);         campos++ }
      if (data.escritura_nro)       { setEscrituraNro(data.escritura_nro);          campos++ }
      if (data.escritura_fecha)     { setEscrituraFecha(data.escritura_fecha);       campos++ }
      if (data.escritura_escribano) { setEscribanoReg(data.escritura_escribano);    campos++ }
      if (data.poliza_nro)       { setPolizaNro(data.poliza_nro);                          campos++ }
      if (data.poliza_compania)  { setPolizaComp(data.poliza_compania);                    campos++ }
      if (data.poliza_vto_desde) { setPolizaDesde(data.poliza_vto_desde);                  campos++ }
      if (data.poliza_vto_hasta) { setPolizaHasta(data.poliza_vto_hasta);                  campos++ }
      if (data.poliza_suma)      { setPolizaSuma(String(data.poliza_suma));                 campos++ }
      setTieneCocheras(data.tiene_cocheras_tasas !== false)
      setTieneFondo(data.tiene_fondo_reserva === true)

      const faltantes = []
      if (!data.poliza_nro)       faltantes.push('N° póliza')
      if (!data.poliza_compania)  faltantes.push('Compañía')
      if (!data.poliza_vto_hasta) faltantes.push('Vto. póliza')
      if (!data.matricula_rpi)         faltantes.push('Matrícula RPI')
      if (!data.escritura_nro)         faltantes.push('N° escritura')
      if (!data.escritura_escribano)   faltantes.push('Escribano/a')

      if (campos > 0) {
        setMsg({ tipo:'ok', texto: faltantes.length > 0
          ? `✓ ${campos} campos cargados desde BD · Completar manualmente: ${faltantes.join(', ')}`
          : `✓ Todos los campos precargados desde la ficha del consorcio` })
      } else {
        setMsg({ tipo:'warn', texto:'Los datos de póliza y reglamento no están cargados en la ficha del consorcio. Completar en Mis Consorcios → Editar.' })
      }
      setResultadoDrive({ campos, faltantes })
    } catch(e) {
      setMsg({ tipo:'error', texto:'Error al cargar datos: ' + e.message })
    }
    setLeyendoDrive(false)
  }

  async function generar() {
    if (!ufSel) return setMsg({ tipo:'warn', texto:'Seleccioná la unidad funcional' })
    if (!solicitante.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el nombre del solicitante' })
    if (!expSel) return setMsg({ tipo:'warn', texto:'Seleccioná la expensa para tomar el monto' })

    setGenerando(true); setMsg(null); setTextoGenerado('')
    try {
      const { data:{ session: sess } } = await supabase.auth.getSession()
      const payload = {
        admin_id: session.user.id, consorcio_id: consorcioId,
        unidad_id: ufSel,
        numero_uf: ufObj?.numero || '',
        solicitante: solicitante.trim(),
        tipo_solicitante: tipoSol,
        estado_deuda: estadoDeuda,
        monto_deuda: estadoDeuda === 'SI' ? parseFloat(montoDeuda)||0 : 0,
        periodo_actual: expObj?.periodo || '',
        monto_expensa_actual: expObj?.total_expensa || 0,
        periodo_proximo: '',
        monto_expensa_proxima: parseFloat(montoProxima)||0,
        // Reglamento
        escritura_nro: escrituraNro, escritura_fecha: escrituraFecha,
        escribano_reglamento: escribanoReg, matricula_rpi: matriculaRPI,
        // Póliza
        poliza_nro: polizaNro, poliza_compania: polizaComp,
        poliza_vto_desde: polizaDesde, poliza_vto_hasta: polizaHasta,
        poliza_suma: parseFloat(polizaSuma)||0,
        // Cuenta
        banco: consorcioActivo?.banco || '',
        nro_cuenta: consorcioActivo?.nro_cuenta || '',
        cbu: consorcioActivo?.cbu || '',
        // Consorcio
        consorcio_nombre: consorcioActivo?.nombre || '',
        consorcio_cuit: consorcioActivo?.cuit || '',
        consorcio_direccion: consorcioActivo?.direccion || '',
        drive_folder_id: consorcioActivo?.drive_folder_id || '',
        tiene_cocheras_tasas: tieneCocheras,
        tiene_fondo_reserva: tieneFondo,
      }

      const res  = await fetch(`${SUPA_URL}/functions/v1/generar-certificado-libre-deuda`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess?.access_token}`,
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Error del servidor')

      setTextoGenerado(data.texto)
      setCertIdGenerado(data.cert_id)
      setMsg({ tipo:'ok', texto:'✓ Certificado generado — Revisá el texto y copialo o abrí el modelo en Drive' })
      cargarCertificados()
    } catch(e) {
      setMsg({ tipo:'error', texto:'Error: ' + e.message })
    }
    setGenerando(false)
  }

  function copiarTexto() {
    navigator.clipboard.writeText(textoGenerado)
      .then(() => setMsg({ tipo:'ok', texto:'✓ Texto copiado al portapapeles' }))
      .catch(() => setMsg({ tipo:'warn', texto:'No se pudo copiar — seleccioná el texto manualmente' }))
  }

  const MODELO_URL = 'https://docs.google.com/document/d/1FnxVVMssA6bjeNEPEP1WTpvq_9halFJPOW5yP81NZgI/edit'
  const CARPETA_URL = consorcioActivo?.drive_folder_url

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>📜 Certificado Libre Deuda y Créditos</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Art. 2067 inc. l) CCCN — Para escribanías y propietarios en operaciones de compraventa
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:'2px solid #e5e7eb' }}>
        {[
          { id:'nuevo',     l:'📜 Nuevo certificado' },
          { id:'historial', l:'📋 Historial' },
        ].map(t => (
          <button key={t.id} type="button" onClick={()=>setTab(t.id)}
            style={{ padding:'8px 18px', border:'none',
              borderBottom:tab===t.id?`2px solid ${AZ}`:'2px solid transparent',
              background:'transparent', color:tab===t.id?AZ:GR,
              fontWeight:tab===t.id?700:400, fontSize:13, cursor:'pointer', marginBottom:-2 }}>
            {t.l}
          </button>
        ))}
      </div>

      <Msg data={msg} />

      {/* ── TAB NUEVO CERTIFICADO ── */}
      {tab === 'nuevo' && (
        <div>
          {/* Links rápidos Drive */}
          <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
            <a href={MODELO_URL} target="_blank" rel="noreferrer"
              style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px',
                background:'#eff6ff', color:AZ, borderRadius:7, fontSize:12, fontWeight:600,
                textDecoration:'none', border:'1px solid #bfdbfe' }}>
              📄 Abrir modelo en Drive
            </a>
            {CARPETA_URL && (
              <a href={CARPETA_URL} target="_blank" rel="noreferrer"
                style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px',
                  background:'#f0fdf4', color:'#16a34a', borderRadius:7, fontSize:12, fontWeight:600,
                  textDecoration:'none', border:'1px solid #bbf7d0' }}>
                📁 Carpeta Drive del consorcio
              </a>
            )}
            {consorcioActivo?.drive_folder_id && (
              <button type="button" disabled={leyendoDrive}
                onClick={() => leerDesdeDrive('ambos')}
                style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px',
                  background: leyendoDrive ? '#f3f4f6' : '#7c3aed', color: leyendoDrive ? GR : '#fff',
                  border:'none', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                {leyendoDrive ? '⏳ Cargando...' : '🔄 Precargar datos de BD'}
              </button>
            )}
          </div>

          {/* Panel resultado Drive */}
          {resultadoDrive && (
            <div style={{ background:'#f5f3ff', border:'1px solid #ddd6fe', borderRadius:10, padding:'12px 16px', marginBottom:14, fontSize:12 }}>
              <div style={{ fontWeight:700, color:'#5b21b6', marginBottom:8 }}>🤖 Resultado lectura desde Drive</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div style={{ fontSize:12, color:'#374151' }}>
                  ✓ <strong>{resultadoDrive.campos}</strong> campos cargados desde ficha del consorcio
                </div>
                {resultadoDrive.faltantes?.length > 0 && (
                  <div style={{ fontSize:11, color:AM, marginTop:4 }}>
                    Completar manualmente: {resultadoDrive.faltantes.join(', ')}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* SECCIÓN 1: UF y solicitante */}
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>📋 Datos de la solicitud</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
              <Sel label="Unidad Funcional" value={ufSel} onChange={setUfSel}
                opts={[{ v:'', l:'— Seleccioná la UF —' },
                  ...unidades.map(u => {
                    const cp = copropietarios.find(c=>c.id===u.propietario_id)
                    return { v:u.id, l:`UF ${u.numero}${u.piso?` P${u.piso}`:''} — ${cp?.apellido_nombre||'Sin prop.'}` }
                  })
                ]} />
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Tipo de solicitante</div>
                <select value={tipoSol} onChange={e=>setTipoSol(e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
                  {[['escribano','Escribano/a'],['propietario','Propietario/a'],['banco','Banco / Entidad financiera'],['otro','Otro']].map(([v,l])=>
                    <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <Input label="Nombre del solicitante" value={solicitante} onChange={setSolicitante}
                placeholder="Apellido, Nombre del escribano / propietario" />
            </div>
            {ufObj && (
              <div style={{ marginTop:10, padding:'8px 12px', background:'#f0f4ff', borderRadius:8, fontSize:12 }}>
                <strong>UF {ufObj.numero}</strong> — {cpObj?.apellido_nombre||'Sin propietario'} · {ufObj.tipo||''} {ufObj.piso?`Piso ${ufObj.piso}`:''}
                {cpObj?.email && ` · ${cpObj.email}`}
              </div>
            )}
          </Card>

          {/* SECCIÓN 2: Estado de deuda y expensas */}
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>💰 Deuda y expensas</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Estado de deuda</div>
                <div style={{ display:'flex', gap:10 }}>
                  {[['NO','🟢 Sin deuda'],['SI','🔴 Con deuda']].map(([v,l])=>(
                    <label key={v} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13 }}>
                      <input type="radio" value={v} checked={estadoDeuda===v} onChange={()=>setEstadoDeuda(v)} />
                      <span style={{ fontWeight:estadoDeuda===v?700:400 }}>{l}</span>
                    </label>
                  ))}
                </div>
              </div>
              {estadoDeuda === 'SI' && (
                <Input label="Monto de deuda ($)" value={montoDeuda} onChange={setMontoDeuda}
                  type="number" placeholder="0.00" />
              )}
              <Sel label="Período expensa actual (monto)" value={expSel} onChange={setExpSel}
                opts={[{ v:'', l:'— Seleccioná el período —' },
                  ...expensas.map(e => ({ v:e.id, l:`${periodoLabel(e.periodo)} ${e.estado==='abierta'?'✓':'🔒'} — ${fmt(e.total_expensa||0)}` }))
                ]} />
              <Input label="Monto aprox. expensa próxima ($)" value={montoProxima} onChange={setMontoProxima}
                type="number" placeholder="0.00" />
            </div>
            {expObj && (
              <div style={{ padding:'8px 12px', background:'#f0fdf4', borderRadius:8, fontSize:12 }}>
                Período actual: <strong>{periodoLabel(expObj.periodo)}</strong> · Total: <strong>{fmt(expObj.total_expensa||0)}</strong>
              </div>
            )}
          </Card>

          {/* SECCIÓN 3: Reglamento de propiedad */}
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>📖 Reglamento de propiedad horizontal</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 }}>
              <Input label="Matrícula RPI" value={matriculaRPI} onChange={setMatriculaRPI} placeholder="21.525" />
              <Input label="Escritura N°" value={escrituraNro} onChange={setEscrituraNro} placeholder="248" />
              <Input label="Fecha escritura" value={escrituraFecha} onChange={setEscrituraFecha}
                placeholder="18 de septiembre de 2025" />
              <Input label="Escribano/a" value={escribanoReg} onChange={setEscribanoReg}
                placeholder="María Luciana Villate" />
            </div>
          </Card>

          {/* SECCIÓN 4: Póliza de seguro */}
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>🛡️ Póliza de seguro integral</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr', gap:12 }}>
              <Input label="N° de póliza" value={polizaNro} onChange={setPolizaNro} placeholder="250230763671" />
              <div style={{ gridColumn:'span 2' }}>
                <Input label="Compañía aseguradora" value={polizaComp} onChange={setPolizaComp}
                  placeholder="Allianz Argentina Compañía de Seguros S.A." />
              </div>
              <Input label="Vigencia desde" value={polizaDesde} onChange={setPolizaDesde} type="date" />
              <Input label="Vigencia hasta" value={polizaHasta} onChange={setPolizaHasta} type="date" />
              <div style={{ gridColumn:'span 2' }}>
                <Input label="Suma asegurada ($)" value={polizaSuma} onChange={setPolizaSuma}
                  type="number" placeholder="720000000" />
              </div>
            </div>
          </Card>

          {/* SECCIÓN 5: Otras constancias */}
          <Card style={{ marginBottom:14 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:10 }}>📝 Otras constancias</div>
            <div style={{ display:'flex', gap:24, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13 }}>
                <input type="checkbox" checked={tieneCocheras} onChange={e=>setTieneCocheras(e.target.checked)} />
                <span>El consorcio abona tasas/impuestos por cocheras</span>
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13 }}>
                <input type="checkbox" checked={tieneFondo} onChange={e=>setTieneFondo(e.target.checked)} />
                <span>El consorcio posee Fondo de Reserva</span>
              </label>
            </div>
          </Card>

          {/* Botón generar */}
          <Btn onClick={generar} disabled={generando||!ufSel||!solicitante||!expSel}
            style={{ width:'100%', padding:'13px', fontSize:14, marginBottom:16,
              opacity:(generando||!ufSel||!solicitante||!expSel)?0.5:1 }}>
            {generando ? '⏳ Generando...' : '📜 Generar certificado'}
          </Btn>

          {/* Texto generado */}
          {textoGenerado && (
            <Card style={{ border:'1.5px solid #1A3FA0' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div style={{ fontWeight:700, color:AZ, fontSize:13 }}>✓ Certificado generado</div>
                <div style={{ display:'flex', gap:8 }}>
                  <Btn small onClick={copiarTexto}>📋 Copiar texto</Btn>
                  <a href={MODELO_URL} target="_blank" rel="noreferrer">
                    <Btn small style={{ background:'#16a34a' }}>📄 Abrir modelo en Drive</Btn>
                  </a>
                </div>
              </div>
              <div style={{ fontSize:11, color:AM, background:'#fffbeb', border:'1px solid #fde68a',
                borderRadius:7, padding:'8px 12px', marginBottom:12 }}>
                ⚠️ Copiar el texto y pegarlo en el modelo de Drive (reemplazando los campos con puntos suspensivos).
                El modelo se abre con el botón verde. Guardarlo en la carpeta Drive del consorcio.
              </div>
              <textarea
                readOnly value={textoGenerado}
                style={{ width:'100%', height:480, padding:'12px', border:'1px solid #e5e7eb',
                  borderRadius:8, fontSize:12.5, fontFamily:'Georgia, serif', lineHeight:1.8,
                  background:'#fafafa', resize:'vertical', boxSizing:'border-box' }} />
            </Card>
          )}
        </div>
      )}

      {/* ── TAB HISTORIAL ── */}
      {tab === 'historial' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ fontWeight:600, fontSize:13 }}>Certificados emitidos ({certificados.length})</div>
            <Btn small onClick={cargarCertificados}>↺ Actualizar</Btn>
          </div>
          {certificados.length === 0 ? (
            <Card>
              <div style={{ textAlign:'center', padding:'24px 0', color:GR }}>Sin certificados emitidos para este consorcio</div>
            </Card>
          ) : (
            <Card style={{ padding:0, overflow:'hidden' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#f8fafc', borderBottom:'1.5px solid #e5e7eb' }}>
                    {['Fecha','UF','Solicitante','Tipo','Estado deuda','Período','Monto exp.'].map((h,i)=>(
                      <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, color:'#374151', fontSize:11.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {certificados.map(c => (
                    <tr key={c.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'8px 12px', fontSize:11, color:GR, whiteSpace:'nowrap' }}>
                        {c.fecha_emision ? new Date(c.fecha_emision+'T12:00:00').toLocaleDateString('es-AR') : '—'}
                      </td>
                      <td style={{ padding:'8px 12px', fontWeight:700 }}>UF {c.numero_uf}</td>
                      <td style={{ padding:'8px 12px' }}>{c.solicitante}</td>
                      <td style={{ padding:'8px 12px', fontSize:11, color:GR, textTransform:'capitalize' }}>{c.tipo_solicitante}</td>
                      <td style={{ padding:'8px 12px' }}>
                        <span style={{ fontWeight:700,
                          color: c.estado_deuda==='SI' ? RJ : VD }}>
                          {c.estado_deuda==='SI' ? `🔴 Con deuda $${(c.monto_deuda||0).toLocaleString('es-AR')}` : '🟢 Sin deuda'}
                        </span>
                      </td>
                      <td style={{ padding:'8px 12px', fontSize:11, color:GR }}>
                        {periodoLabel(c.periodo_actual||'')}
                      </td>
                      <td style={{ padding:'8px 12px', fontWeight:600, color:AZ }}>
                        {c.monto_expensa_actual ? fmt(c.monto_expensa_actual) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// ASAMBLEAS — Convocatorias, Actas PDF, Mandatos, Calendario (v6 — tabs en vista lista)
// ══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// HISTORIAL DE LIQUIDACIONES — Importador masivo desde Drive
// ═══════════════════════════════════════════════════════════════════

