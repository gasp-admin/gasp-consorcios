import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function ImportarPDF() {
  const { session, cargando, esSuperAdmin, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, expensas, setExpensas, proveedores, setProveedores, adminPerfil, setAdminPerfil, formCon, setFormCon, msgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio, pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, navItems, secciones, navActivo } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [archivo, setArchivo]       = useState(null)
  const [paso, setPaso]             = useState(1) // 1=subir, 2=revisión, 3=confirmar, 4=listo
  const [extrayendo, setExtrayendo] = useState(false)
  const [importando, setImportando] = useState(false)
  const [msg, setMsg]               = useState(null)
  const [datos, setDatos]           = useState(null)
  const [edits, setEdits]           = useState({})
  const [asignaciones, setAsignaciones] = useState({})
  const [progreso, setProgreso]     = useState('')
  // Consorcio destino — puede ser diferente al activo
  const [consorcios, setConsorcios] = useState([])
  const [conIdDestino, setConIdDestino]   = useState(consorcioId)
  const [conNomDestino, setConNomDestino] = useState(consorcioActivo?.nombre || '')

  // Cargar lista de consorcios al montar
  useEffect(() => {
    supabase.from('con_consorcios').select('id,nombre')
      .eq('admin_id', session.user.id).order('nombre')
      .then(({ data }) => setConsorcios(data || []))
  }, [])

  // Convertir PDF a base64 para enviarlo a Claude
  function pdfABase64(file) {
    return new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result.split(',')[1])
      reader.onerror = () => rej(new Error('Error leyendo archivo'))
      reader.readAsDataURL(file)
    })
  }

  async function extraerConIA() {
    if (!archivo) return setMsg({ tipo:'warn', texto:'Seleccioná un archivo PDF primero' })
    setExtrayendo(true)
    setProgreso('Leyendo PDF...')
    setMsg(null)

    try {
      const base64 = await pdfABase64(archivo)
      setProgreso('Enviando a Claude para análisis...')

      const prompt = `Sos un asistente especializado en liquidaciones de expensas de consorcios en Argentina.
Analizá este PDF de liquidación de expensas y extraé la siguiente información en formato JSON estricto.
El JSON debe tener EXACTAMENTE esta estructura, sin texto adicional antes ni después:

{
  "periodo": "YYYY-MM",
  "consorcio": {
    "nombre": "nombre del consorcio",
    "direccion": "dirección",
    "cuit": "XX-XXXXXXXX-X",
    "cbu": "número CBU si aparece",
    "banco": "nombre del banco si aparece"
  },
  "totales": {
    "total_gastos": 0,
    "total_expensa": 0,
    "saldo_caja_anterior": 0,
    "saldo_caja_actual": 0,
    "total_cobrado": 0,
    "total_deuda": 0
  },
  "gastos": [
    { "concepto": "nombre del gasto", "monto": 0, "categoria": "categoria" }
  ],
  "unidades": [
    {
      "numero": "identificador de unidad ej: 1A, 2B, PB1",
      "propietario": "apellido y nombre",
      "coeficiente": 0.0000,
      "expensa": 0,
      "saldo_anterior": 0,
      "mora": 0,
      "total_deuda": 0,
      "pagado": 0,
      "estado": "pagado|pendiente|moroso"
    }
  ],
  "administrador": {
    "nombre": "nombre del administrador",
    "matricula": "número de matrícula RPAC si aparece"
  }
}

INSTRUCCIONES IMPORTANTES:
- Extraé TODOS los datos numéricos sin signos de peso, solo números con decimales separados por punto.
- Si un dato no aparece en el PDF, usá null.
- Para el período usá formato YYYY-MM (ej: 2026-04 para Abril 2026).
- Las categorías de gastos deben ser una de: sueldos, electricidad, contratos, mantenimiento, seguros, honorarios_admin, gastos_bancarios, impuesto_municipal, varios.
- Para el estado de las unidades: "pagado" si pagó todo, "moroso" si tiene deuda del período anterior, "pendiente" si debe solo el período actual.
- Extraé TODAS las unidades que aparezcan en la liquidación.
- Respondé ÚNICAMENTE con el JSON, sin explicaciones ni markdown.`

      setProgreso('Enviando a Edge Function...')
      const { data: { session: sess } } = await supabase.auth.getSession()
      const response = await fetch(`${SUPA_URL}/functions/v1/extraer-pdf-ia`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess?.access_token}`,
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        },
        body: JSON.stringify({ base64, filename: archivo?.name })
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `Error servidor: ${response.status}`)
      }
      const result = await response.json()
      if (!result.ok) throw new Error(result.error || 'Error desconocido')

      setProgreso('Procesando respuesta...')
      const json = result.datos

      setDatos(json)
      setEdits({})
      // Intentar matchear el consorcio detectado por la IA con la lista
      if (json.consorcio?.nombre) {
        const nombreIA = json.consorcio.nombre.toLowerCase().trim()
        const match = consorcios.find(c =>
          c.nombre.toLowerCase().includes(nombreIA) ||
          nombreIA.includes(c.nombre.toLowerCase().split(' ')[0])
        )
        if (match) {
          setConIdDestino(match.id)
          setConNomDestino(match.nombre)
        }
      }
      setPaso(2)
      setProgreso('')
      setMsg({ tipo:'ok', texto:`✓ Extracción completada — ${json.unidades?.length||0} unidades detectadas` })

    } catch(e) {
      setMsg({ tipo:'error', texto: 'Error: ' + e.message })
      setProgreso('')
    }
    setExtrayendo(false)
  }

  async function confirmarImportacion() {
    if (!datos) return
    if (!consorcioId) return setMsg({ tipo:'warn', texto:'Seleccioná un consorcio primero' })
    if (!confirm(`¿Confirmar importación?

Se crearán:
• ${datos.unidades?.length||0} registros de saldo inicial por unidad
• ${datos.gastos?.length||0} gastos del período anterior

Esta acción no se puede deshacer fácilmente.`)) return

    setImportando(true)
    setMsg(null)
    const uid = session.user.id
    const hoy = new Date().toISOString().split('T')[0]
    const periodo = datos.periodo || new Date().toISOString().slice(0,7)
    const cid = conIdDestino || consorcioId  // usar el consorcio seleccionado en paso 3
    let ok = 0, errs = []

    try {
      // 1. Actualizar datos del consorcio si no tiene
      if (datos.consorcio && consorcioActivo) {
        const upd = {}
        if (!consorcioActivo.cbu && datos.consorcio.cbu) upd.cbu = datos.consorcio.cbu
        if (!consorcioActivo.banco && datos.consorcio.banco) upd.banco = datos.consorcio.banco
        if (Object.keys(upd).length > 0) {
          await supabase.from('con_consorcios').update(upd).eq('id', consorcioId)
        }
      }

      // 2. Usar expensa existente o crear nueva de migración
      let expId
      const { data: expExistente } = await supabase.from('con_expensas')
        .select('id').eq('consorcio_id', cid).eq('periodo', periodo).maybeSingle()
      if (expExistente?.id) {
        expId = expExistente.id
        // Actualizar la existente con los datos del PDF
        await supabase.from('con_expensas').update({
          tipo: 'migracion',
          estado: 'cerrada',
          total_gastos:      datos.totales?.total_gastos       || datos.estado_financiero?.total_egresos    || 0,
          total_expensa:     datos.totales?.total_expensa      || 0,
          saldo_anterior:    datos.totales?.saldo_anterior     || datos.estado_financiero?.saldo_anterior    || 0,
          total_cobrado:     datos.totales?.total_cobrado      || datos.estado_financiero?.ingresos_termino  || 0,
          ingresos_termino:  datos.estado_financiero?.ingresos_termino  || 0,
          ingresos_adeudados:datos.estado_financiero?.ingresos_adeudados|| 0,
          ingresos_intereses:datos.estado_financiero?.ingresos_intereses|| 0,
          saldo_caja_final:  datos.totales?.saldo_caja_final   || datos.estado_financiero?.saldo_final       || 0,
          descripcion: `Período migrado desde liquidación anterior (${archivo?.name})`,
          pdf_procesado: true,
          pdf_procesado_at: new Date().toISOString(),
        }).eq('id', expId)
      } else {
        expId = `EXP-MIG-${cid}-${Date.now()}`
        await supabase.from('con_expensas').insert([{
        id: expId,
        admin_id: uid,
        consorcio_id: cid,
        periodo,
        tipo: 'migracion',
        estado: 'cerrada',
        total_gastos: datos.totales?.total_gastos || 0,
        total_expensa: datos.totales?.total_expensa || 0,
        descripcion: `Período migrado desde liquidación anterior (${archivo?.name})`,
      }])
      }

      // 3. Cargar gastos del período anterior
      for (const g of (datos.gastos||[])) {
        if (!g.concepto || !g.monto) continue
        const { error } = await supabase.from('con_gastos').insert([{
          id: `GAS-MIG-${Date.now()}-${ok}`,
          admin_id: uid,
          consorcio_id: cid,
          expensa_id: expId,
          fecha: hoy,
          concepto: g.concepto,
          categoria: g.categoria || 'varios',
          proveedor_nombre: g.proveedor || null,
          monto: parseFloat(g.monto) || 0,
        }])
        if (error) errs.push(`Gasto "${g.concepto}": ${error.message}`)
        else ok++
      }

      // 4. Registrar saldo inicial por unidad
      // IMPORTANTE: u.pagado = pagos del período ANTERIOR (no de la expensa actual)
      // El saldo_anterior = lo que debían al inicio del período migrado
      // Si u.pagado >= u.saldo_anterior → el copropietario pagó el período anterior en término
      // La deuda real al INICIO de este sistema = u.total_deuda (saldo_anterior + expensa - pagado)
      //   donde pagado son pagos del período anterior YA acreditados
      const { data: ufsExistentes } = await supabase
        .from('con_unidades').select('id,numero').eq('consorcio_id', cid)

      for (const u of (datos.unidades||[])) {
        if (!u.numero) continue

        const saldoAnterior = parseFloat(u.saldo_anterior) || 0
        const expensaActual = parseFloat(u.expensa) || 0
        const pagadoPeriodoAnterior = parseFloat(u.pagado) || 0
        // deudaTotal = lo que debe en total al cierre del período migrado
        const deudaTotal = parseFloat(u.total_deuda) || Math.max(0, saldoAnterior - pagadoPeriodoAnterior + expensaActual)
        const pagado     = 0  // No hay pagos de la expensa actual aún

        // Encontrar la UF por número (aproximado)
        const uf = ufsExistentes?.find(x =>
          x.numero?.toLowerCase().trim() === u.numero?.toLowerCase().trim()
        )

        if (!uf) {
          // Crear copropietario y UF si no existe
          const cpId = `CP-MIG-${Date.now()}-${ok}`
          await supabase.from('con_copropietarios').insert([{
            id: cpId,
            admin_id: uid,
            consorcio_id: cid,
            apellido_nombre: u.propietario || `Propietario UF ${u.numero}`,
          }])

          const ufId = `UF-MIG-${Date.now()}-${ok}`
          await supabase.from('con_unidades').insert([{
            id: ufId,
            admin_id: uid,
            consorcio_id: cid,
            numero: u.numero,
            tipo: 'departamento',
            porcentaje_fiscal: parseFloat(u.coeficiente) || null,
            pct_gtos_grales:   parseFloat(u.coeficiente) || null,
            pct_fdo_obras:     parseFloat(u.coeficiente) || null,
            estado: 'ocupada',
            propietario_id: cpId,
            portal_token: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
          }])

          // Registrar detalle de expensa con saldo
          if (deudaTotal > 0 || saldoAnterior > 0 || expensaActual > 0) {
            await supabase.from('con_expensas_detalle').insert([{
              id: `DET-MIG-${Date.now()}-${ok}`,
              admin_id: uid,
              consorcio_id: cid,
              expensa_id: expId,
              unidad_id: ufId,
              monto: expensaActual,
              saldo_anterior: Math.max(0, saldoAnterior - pagadoPeriodoAnterior), // saldo neto tras pago anterior
              pagos_periodo: 0,  // nadie pagó la expensa actual todavía
              interes_mora: parseFloat(u.mora) || 0,
              estado: 'pendiente', // siempre pendiente al migrar
            }])
          }
          ok++
        } else {
          // UF existente — registrar saldo como nota de débito Y en con_liquidacion_uf
          const saldo = Math.max(0, deudaTotal - pagado)
          if (saldo > 0) {
            await supabase.from('con_movimientos_unidad').insert([{
              id: `MOV-MIG-${Date.now()}-${ok}`,
              admin_id: uid,
              consorcio_id: cid,
              unidad_id: uf.id,
              expensa_id: expId,
              tipo: 'debito',
              concepto: `Saldo inicial migrado — período ${periodo}`,
              categoria: 'ajuste_inicial',
              monto: saldo,
              fecha: hoy,
              notas: `Migrado desde: ${archivo?.name}`,
              estado: 'vigente',
            }])
          }
          // Siempre insertar en con_liquidacion_uf (fuente de la cuenta corriente)
          await supabase.from('con_liquidacion_uf').upsert([{
            id: `LUFF-MIG-${cid}-${periodo}-UF${u.numero}`,
            admin_id: uid,
            consorcio_id: cid,
            expensa_id: expId,
            periodo,
            nro_uf: String(u.numero),
            unidad_id: uf.id,
            propietario_nombre: u.propietario || `UF ${u.numero}`,
            coeficiente: parseFloat(u.coeficiente) || 0,
            saldo_anterior: saldoAnterior,
            pagos: pagadoPeriodoAnterior,
            deuda: 0,
            interes: parseFloat(u.mora) || 0,
            expensa_calculada: expensaActual,
            ajustes: 0,
            total_uf: deudaTotal || expensaActual,
            fuente: 'pdf_importado',
          }], { onConflict: 'id' })
          ok++
        }
      }

      // 5. Registrar saldo de caja como movimiento varios si existe
      if (datos.totales?.saldo_caja_actual && datos.totales.saldo_caja_actual > 0) {
        await supabase.from('con_movimientos_varios').insert([{
          id: `MV-MIG-${Date.now()}`,
          admin_id: uid,
          consorcio_id: cid,
          expensa_id: expId,
          tipo: 'ingreso',
          concepto: `Saldo de caja inicial — migración período ${periodo}`,
          categoria: 'varios',
          monto: datos.totales.saldo_caja_actual,
          fecha: hoy,
          notas: `Migrado desde: ${archivo?.name}`,
          estado: 'vigente',
        }])
      }

      setAsignaciones({})
      setMsg({
        tipo: errs.length === 0 ? 'ok' : 'warn',
        texto: `✓ Migración completada — ${ok} registros importados${errs.length>0?' · '+errs.length+' errores':''}`
      })
      setPaso(4)

    } catch(e) {
      setMsg({ tipo:'error', texto: 'Error en la importación: ' + e.message })
    }
    setImportando(false)
  }

  const fmt = n => n ? '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits:2 }) : '—'

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>🤖 Migrar desde liquidación PDF</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        La IA extrae automáticamente los datos de su última liquidación para armar la base de datos inicial
      </div>
      <Msg data={msg} />

      {/* Indicador de pasos */}
      <div style={{ display:'flex', gap:0, marginBottom:24 }}>
        {[
          { n:1, l:'Subir PDF' },
          { n:2, l:'Revisar datos' },
          { n:3, l:'Confirmar' },
          { n:4, l:'Listo' },
        ].map((p, i) => (
          <div key={p.n} style={{ display:'flex', alignItems:'center', flex:1 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:1 }}>
              <div style={{
                width:32, height:32, borderRadius:'50%', display:'flex',
                alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:13,
                background: paso >= p.n ? AZ : '#f3f4f6',
                color: paso >= p.n ? '#fff' : GR,
              }}>{paso > p.n ? '✓' : p.n}</div>
              <div style={{ fontSize:10, color: paso >= p.n ? AZ : GR,
                marginTop:4, fontWeight: paso === p.n ? 700 : 400 }}>{p.l}</div>
            </div>
            {i < 3 && <div style={{ height:2, flex:1, background: paso > p.n+0.5 ? AZ : '#f3f4f6',
              marginBottom:18, marginTop:16 }} />}
          </div>
        ))}
      </div>

      {/* PASO 1 — Subir PDF */}
      {paso === 1 && (
        <Card>
          <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:16 }}>
            Paso 1 — Seleccioná la liquidación en PDF
          </div>

          <div style={{ background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:8,
            padding:'14px 16px', marginBottom:16, fontSize:12, color:'#0369a1' }}>
            <strong>¿Qué datos extrae la IA?</strong>
            <div style={{ marginTop:6, display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
              {[
                '✓ Período de la liquidación','✓ Datos del consorcio',
                '✓ Saldo de caja','✓ Todos los gastos por rubro',
                '✓ Deuda de cada unidad','✓ Saldo anterior por UF',
                '✓ Interés por mora','✓ Estado de cada copropietario',
              ].map((item,i) => <div key={i}>{item}</div>)}
            </div>
          </div>

          {/* Selector de archivo — un solo input, sin overlays */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, color:GR, marginBottom:6, fontWeight:500 }}>
              Seleccionar archivo PDF
            </div>
            <input
              type="file"
              accept=".pdf"
              onChange={e => {
                const f = e.target.files[0]
                if (f) { setArchivo(f); setMsg(null) }
              }}
              style={{ display:'block', fontSize:13, marginBottom:10 }}
            />
            {archivo && (
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8 }}>
                <span style={{ fontSize:20 }}>📄</span>
                <div>
                  <div style={{ fontWeight:700, color:VD, fontSize:13 }}>{archivo.name}</div>
                  <div style={{ fontSize:11, color:GR }}>{(archivo.size/1024/1024).toFixed(2)} MB — listo para procesar</div>
                </div>
                <BtnSec onClick={()=>{setArchivo(null);setMsg(null)}} style={{ marginLeft:'auto' }}>✕</BtnSec>
              </div>
            )}
          </div>

          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <Btn onClick={extraerConIA} disabled={!archivo || extrayendo}>
              {extrayendo ? `⏳ ${progreso}` : '🤖 Extraer con IA'}
            </Btn>
          </div>

          <div style={{ marginTop:16, fontSize:11, color:GR }}>
            Funciona con liquidaciones de cualquier sistema — Administración Global, Sidelu, Consorcio Abierto, etc.
            El PDF puede tener varias páginas.
          </div>
        </Card>
      )}

      {/* PASO 2 — Revisión de datos extraídos */}
      {paso === 2 && datos && (
        <div>
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>
              Paso 2 — Revisá los datos extraídos
            </div>

            {/* Datos generales */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
              {[
                { l:'Período detectado', v: (() => {
                  if (!datos.periodo) return '—'
                  const [y,m] = datos.periodo.split('-')
                  const mes = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
                    'Agosto','Septiembre','Octubre','Noviembre','Diciembre']
                  return m ? `${mes[parseInt(m)-1]} ${y}` : datos.periodo
                })() },
                { l:'Unidades detectadas', v: datos.unidades?.length || 0 },
                { l:'Gastos detectados', v: datos.gastos?.length || 0 },
              ].map((k,i) => (
                <div key={i} style={{ background:'#f0f4ff', borderRadius:8, padding:'12px 14px', textAlign:'center' }}>
                  <div style={{ fontSize:11, color:GR, fontWeight:600, marginBottom:4 }}>{k.l}</div>
                  <div style={{ fontSize:20, fontWeight:800, color:AZ }}>{k.v}</div>
                </div>
              ))}
            </div>

            {/* Totales */}
            {datos.totales && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontWeight:600, fontSize:12, color:GR, textTransform:'uppercase',
                  letterSpacing:'0.05em', marginBottom:8 }}>Totales del período</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                  {[
                    { l:'Total expensa', v:fmt(datos.totales.total_expensa) },
                    { l:'Total cobrado', v:fmt(datos.totales.total_cobrado), c:VD },
                    { l:'Deuda total',   v:fmt(datos.totales.total_deuda),   c:RJ },
                    { l:'Saldo caja ant.', v:fmt(datos.totales.saldo_caja_anterior) },
                    { l:'Saldo caja act.', v:fmt(datos.totales.saldo_caja_actual), c:VD },
                    { l:'Total gastos',    v:fmt(datos.totales.total_gastos) },
                  ].map((k,i) => (
                    <div key={i} style={{ padding:'8px 12px', background:'#f8fafc',
                      borderRadius:6, fontSize:12 }}>
                      <div style={{ color:GR, marginBottom:2 }}>{k.l}</div>
                      <div style={{ fontWeight:700, color:k.c||'#374151' }}>{k.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Gastos */}
          {datos.gastos?.length > 0 && (
            <Card style={{ marginBottom:16 }}>
              <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>
                Gastos detectados ({datos.gastos.length})
              </div>
              <div style={{ maxHeight:220, overflowY:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead style={{ position:'sticky', top:0, background:'#f3f4f6' }}>
                    <tr>
                      {['Concepto','Categoría','Monto'].map((h,i) => (
                        <th key={i} style={{ padding:'6px 10px', textAlign:i===2?'right':'left',
                          fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datos.gastos.map((g,i) => (
                      <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                        <td style={{ padding:'6px 10px' }}>{g.concepto}</td>
                        <td style={{ padding:'6px 10px', color:GR, fontSize:11 }}>{g.categoria}</td>
                        <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600 }}>{fmt(g.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Unidades */}
          {datos.unidades?.length > 0 && (
            <Card style={{ marginBottom:16 }}>
              <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>
                Unidades detectadas ({datos.unidades.length})
              </div>
              <div style={{ maxHeight:300, overflowY:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead style={{ position:'sticky', top:0, background:'#f3f4f6' }}>
                    <tr>
                      {['UF','Propietario','Coef.','Expensa','Sal.Ant.','Mora','Total','Pagado','Estado'].map((h,i) => (
                        <th key={i} style={{ padding:'6px 8px', textAlign:i<2?'left':'right',
                          fontSize:10, fontWeight:700, color:GR,
                          borderBottom:'1px solid #e5e7eb', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datos.unidades.map((u,i) => {
                      const est = u.estado === 'pagado' ? { c:VD, bg:'#dcfce7', t:'Pagado' }
                        : u.estado === 'moroso' ? { c:RJ, bg:'#fee2e2', t:'Moroso' }
                        : { c:AM, bg:'#fef9c3', t:'Pendiente' }
                      return (
                        <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                          <td style={{ padding:'5px 8px', fontWeight:700 }}>{u.numero}</td>
                          <td style={{ padding:'5px 8px', fontSize:11, maxWidth:120 }}>{u.propietario||'—'}</td>
                          <td style={{ padding:'5px 8px', textAlign:'right', fontSize:10, color:GR }}>{u.coeficiente||'—'}</td>
                          <td style={{ padding:'5px 8px', textAlign:'right' }}>{u.expensa?fmt(u.expensa):'—'}</td>
                          <td style={{ padding:'5px 8px', textAlign:'right', color:RJ }}>{u.saldo_anterior?fmt(u.saldo_anterior):'—'}</td>
                          <td style={{ padding:'5px 8px', textAlign:'right', color:AM }}>{u.mora?fmt(u.mora):'—'}</td>
                          <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:700 }}>{u.total_deuda?fmt(u.total_deuda):'—'}</td>
                          <td style={{ padding:'5px 8px', textAlign:'right', color:VD }}>{u.pagado?fmt(u.pagado):'—'}</td>
                          <td style={{ padding:'5px 8px' }}>
                            <Badge text={est.t} color={est.c} bg={est.bg} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={() => setPaso(3)} style={{ background:VD, color:'#fff' }}>
              ✓ Datos correctos — Continuar
            </Btn>
            <BtnSec onClick={() => { setPaso(1); setDatos(null); setMsg(null) }}>
              ← Volver a subir
            </BtnSec>
          </div>
        </div>
      )}

      {/* PASO 3 — Confirmación */}
      {paso === 3 && datos && (
        <Card>
          <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:16 }}>
            Paso 3 — Confirmar importación
          </div>

          <div style={{ background:'#fef9c3', border:'1px solid #f59e0b', borderRadius:8,
            padding:'14px 16px', marginBottom:16, fontSize:12, color:'#92400e' }}>
            <strong>⚠️ Importante antes de importar:</strong>
            <ul style={{ margin:'8px 0 0 16px', lineHeight:1.8 }}>
              <li>Si las unidades ya existen en el sistema, se registrará su saldo pendiente como nota de débito inicial.</li>
              <li>Si las unidades NO existen, se crearán automáticamente con los datos del propietario detectados.</li>
              <li>Los gastos se registrarán como período migrado (tipo: migración) para historial.</li>
              <li>El saldo de caja se registrará como movimiento de ingreso inicial.</li>
              <li>Puede editar o eliminar cualquier registro importado después.</li>
            </ul>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
            <div style={{ padding:'12px 16px', background:'#f0f4ff', borderRadius:8 }}>
              <div style={{ fontSize:12, color:GR, marginBottom:6, fontWeight:500 }}>
                Consorcio destino
              </div>
              <select
                value={conIdDestino}
                onChange={e => {
                  const c = consorcios.find(x => x.id === e.target.value)
                  setConIdDestino(e.target.value)
                  setConNomDestino(c?.nombre || '')
                }}
                style={{ width:'100%', padding:'8px 10px', border:'2px solid #1A3FA0',
                  borderRadius:7, fontSize:13, fontWeight:700, color:AZ, background:'#fff' }}>
                {consorcios.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
              {conNomDestino && conIdDestino !== consorcioId && (
                <div style={{ fontSize:11, color:AM, marginTop:4 }}>
                  ⚠️ Importando a un consorcio diferente al activo en el Dashboard
                </div>
              )}
            </div>
            <div style={{ padding:'12px 16px', background:'#f0f4ff', borderRadius:8 }}>
              <div style={{ fontSize:12, color:GR, marginBottom:4 }}>Período a migrar</div>
              <div style={{ fontWeight:700, color:AZ }}>{datos.periodo||'—'}</div>
            </div>
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={confirmarImportacion} disabled={importando}
              style={{ background:VD, color:'#fff' }}>
              {importando ? '⏳ Importando...' : '✓ Confirmar e importar'}
            </Btn>
            <BtnSec onClick={() => setPaso(2)}>← Revisar datos</BtnSec>
          </div>
        </Card>
      )}

      {/* PASO 4 — Listo */}
      {paso === 4 && (
        <Card style={{ textAlign:'center', padding:40 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
          <div style={{ fontWeight:700, fontSize:18, color:VD, marginBottom:8 }}>
            Migración completada
          </div>
          <div style={{ fontSize:13, color:GR, marginBottom:24 }}>
            Los datos del período anterior fueron importados exitosamente.
            Ya puede comenzar a operar con GASP Consorcios.
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
            <Btn onClick={() => setPagina?.('dashboard')}>Ir al Dashboard</Btn>
            <BtnSec onClick={() => {
              setPaso(1); setArchivo(null); setDatos(null); setMsg(null)
            }}>Importar otro PDF</BtnSec>
          </div>
        </Card>
      )}
    </div>
  )
}
