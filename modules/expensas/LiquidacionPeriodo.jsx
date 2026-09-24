import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { construirHTMLLiquidacionNativa, escribirLiquidacionNativa, resolverCodigosColumna, prepararDatosPDF } from '../../lib/pdfLiquidacionNativa'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

// resolverCodigosColumna: movido a lib/pdfLiquidacionNativa.js (U1) — misma implementación.

export default function LiquidacionPeriodo() {
  const { session, cargando, esSuperAdmin, consorcios, setConsorcios, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, expensas, setExpensas, proveedores, setProveedores, adminPerfil, setAdminPerfil, formCon, setFormCon, msgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio, puede, pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, navItems, secciones, navActivo } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [paso, setPaso]           = useState(1) // 1=período, 2=gastos, 3=distribución, 4=cierre
  const [expSel, setExpSel]       = useState(null)  // expensa en edición
  const [gastos, setGastos]       = useState([])
  const [config, setConfig]       = useState({
    total_a_cobrar: '',        // puede ser distinto al total de gastos
    usar_total_gastos: true,   // si true, usa suma de gastos; si false, manual
    vto1_dia: 10,              // primer vencimiento
    vto2_dia: 20,              // segundo vencimiento (con mora)
    pct_mora_vto2: 3,          // % adicional por segundo vencimiento
    ajuste_centavos: true,     // distribuir los centavos sobrantes a UF1
  })
  // Importes por columna: { [codigo_columna]: { monto: number, editable: bool } }
  // Se inicializa al llegar al paso 3 desde los gastos de cada columna
  const [importesPorColumna, setImportesPorColumna] = useState({})
  const [distribucion, setDistribucion] = useState([])
  const [procesando, setProcesando]     = useState(false)
  const [msg, setMsg]                   = useState(null)
  const [planCuentas, setPlanCuentas]   = useState([])
  const [formGasto, setFormGasto]       = useState(null)
  const [compImportables, setCompImportables] = useState([])
  const [compSeleccionados, setCompSeleccionados] = useState({})
  const [cargandoComps, setCargandoComps] = useState(false)
  // Saldo de caja del período anterior (para el Estado Financiero de la liquidación)
  const [saldoCajaAnterior, setSaldoCajaAnterior] = useState(0)
  // Cobranzas del período anterior (pagos recibidos en la liquidación anterior)
  const [cobradoPeriodoAnt, setCobradoPeriodoAnt] = useState(0)
  const [cobradoActual, setCobradoActual]         = useState(0) // ingresos en término
  const [cobradoAdeudado, setCobradoAdeudado]     = useState(0) // ingresos por deuda
  const [cobradoInteres, setCobradoInteres]       = useState(0) // ingresos por intereses
  // Grupos y columnas de liquidación del consorcio activo
  const [gruposLiq, setGruposLiq]     = useState([])
  const [columnasLiq, setColumnasLiq] = useState([])
  const hoy = new Date().toISOString().split('T')[0]

  // Cargar grupos y columnas cuando cambia el consorcio
  useEffect(() => {
    if (!consorcioId) return
    Promise.all([
      supabase.from('con_grupos_liquidacion').select('*')
        .eq('consorcio_id', consorcioId).eq('activo', true).order('numero'),
      supabase.from('con_columnas_liquidacion').select('*')
        .eq('consorcio_id', consorcioId).eq('activo', true).order('orden'),
    ]).then(([{ data: grps }, { data: cols }]) => {
      setGruposLiq(grps || [])
      setColumnasLiq(cols || [])
    })
  }, [consorcioId])

  // ── Columnas monto_fijo (gastos particulares) ───────────────────────────────
  // Una columna monto_fijo NO se prorratea: cada gasto con unidad_id va 100% a esa UF.
  // El gasto llega a la columna por su categoría (mapeada vía grupo, D1=C).
  const columnasMF = columnasLiq.filter(c => c.activo && c.tipo === 'monto_fijo')
  // Categorías que caen (vía grupo) en alguna columna monto_fijo activa
  const categoriasMF = (() => {
    const codigosMF = new Set(columnasMF.map(c => String(c.codigo).toLowerCase()))
    const set = new Set()
    gruposLiq.forEach(gr => {
      if ((gr.columnas_coef || []).some(cc => codigosMF.has(String(cc).toLowerCase()))) {
        (gr.categorias || []).forEach(cat => set.add(cat))
      }
    })
    return set
  })()
  const esCategoriaMF = (cat) => categoriasMF.has(cat)
  const hayColumnaMF = columnasMF.length > 0
  // Categoría a asignar a un gasto marcado como "particular" (primera categoría del
  // grupo que mapea a la primera columna monto_fijo activa del consorcio).
  const categoriaParticularPorDefecto = (() => {
    if (columnasMF.length === 0) return null
    const cod = String(columnasMF[0].codigo).toLowerCase()
    const grp = gruposLiq.find(gr => (gr.columnas_coef || []).some(cc => String(cc).toLowerCase() === cod))
    return grp?.categorias?.[0] || null
  })()

  // ── Cargar datos ───────────────────────────────────────────────────────────
  // Recarga la lista de expensas (períodos) del consorcio activo en el contexto.
  // La llaman nuevaExpensa, confirmarYCerrar y las acciones de reapertura/borrado.
  async function cargar() {
    if (!consorcioId) return
    const { data } = await supabase.from('con_expensas')
      .select('*').eq('consorcio_id', consorcioId)
      .order('periodo', { ascending: false })
    setExpensas(data || [])
  }

  async function cargarGastos(eid) {
    const { data } = await supabase.from('con_gastos').select('*')
      .eq('expensa_id', eid).order('categoria')
    setGastos(data || [])
  }

  // Cargar comprobantes del consorcio que NO están ya importados a esta expensa
  async function cargarComprobantesImportables(eid) {
    setCargandoComps(true)
    try {
      // 1. Obtener IDs de comprobantes ya importados como gastos en CUALQUIER expensa del consorcio
      //    (no sólo la actual), para no ofrecer comprobantes ya liquidados en meses anteriores.
      const { data: gastosExist } = await supabase.from('con_gastos')
        .select('comprobante_id').eq('consorcio_id', consorcioId).not('comprobante_id','is',null)
      const idsYaImportados = new Set((gastosExist||[]).map(g=>g.comprobante_id))

      // 2. Traer TODOS los comprobantes del consorcio (sin join para evitar problemas RLS)
      const { data: comps, error } = await supabase
        .from('con_comprobantes_proveedor')
        .select('id, proveedor_id, tipo, numero, concepto, monto_total, saldo_pendiente, estado, fecha, fecha_vencimiento, notas, unidad_id, categoria')
        .eq('consorcio_id', consorcioId)
        .neq('estado', 'anulado')
        .order('fecha', { ascending:false })
        .limit(200)

      if (error) { console.error('Error cargando comprobantes:', error); setCargandoComps(false); return }

      // 3. Filtrar los no importados
      const disponibles = (comps||[]).filter(c => !idsYaImportados.has(c.id))

      // 4. Resolver nombres de proveedores en batch
      const provIds = [...new Set(disponibles.map(c=>c.proveedor_id).filter(Boolean))]
      let provMap = {}
      if (provIds.length > 0) {
        const { data: provs } = await supabase.from('con_proveedores')
          .select('id, razon_social, rubro').in('id', provIds)
        ;(provs||[]).forEach(p => { provMap[p.id] = p })
      }
      const enriquecidos = disponibles.map(c => ({
        ...c,
        proveedor_nombre_resuelto: provMap[c.proveedor_id]?.razon_social || null,
        proveedor_rubro: provMap[c.proveedor_id]?.rubro || null,
      }))
      setCompImportables(enriquecidos)

      // 5. Pre-seleccionar pendientes y parciales automáticamente
      const presel = {}
      enriquecidos.forEach(c => {
        if (c.estado === 'pendiente' || c.estado === 'pagado_parcial') presel[c.id] = true
      })
      setCompSeleccionados(presel)
    } catch(e) {
      console.error('cargarComprobantesImportables:', e)
    }
    setCargandoComps(false)
  }

  // Importar comprobantes seleccionados como gastos del período
  async function importarComprobantes() {
    if (!puede('liquidar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite liquidar ni modificar expensas.' })
    const seleccionados = compImportables.filter(c => compSeleccionados[c.id])
    if (seleccionados.length === 0) return setMsg({ tipo:'warn', texto:'Seleccioná al menos un comprobante para importar' })

    // D1=C: un comprobante marcado como particular (unidad_id) requiere una columna
    // monto_fijo activa a la cual mapear su categoría. Si no existe, no se puede imputar.
    const particularesSinCol = seleccionados.filter(c => c.unidad_id) 
    if (particularesSinCol.length > 0 && !categoriaParticularPorDefecto) {
      return setMsg({ tipo:'error', texto:'Hay comprobantes marcados como gasto particular pero el consorcio no tiene una columna de "Monto fijo" configurada. Configurala en Columnas y coeficientes antes de importar.' })
    }

    // Mapa rubro → categoría del plan de cuentas de GASP
    const CAT_MAP = {
      'limpieza': 'gastos_comunes', 'electricidad': 'electricidad',
      'gas': 'gas', 'ascensores': 'mantenimiento', 'seguros': 'seguros',
      'administración': 'honorarios_admin', 'plomería': 'mantenimiento',
      'jardinería': 'gastos_comunes', 'pintura': 'mantenimiento',
      'otros': 'varios', 'servicios_publicos': 'servicios_publicos',
    }

    // Resolver nombres de proveedores en batch (sin join para evitar RLS)
    const provIds = [...new Set(seleccionados.map(c=>c.proveedor_id).filter(Boolean))]
    let provMap = {}
    if (provIds.length > 0) {
      const { data: provs } = await supabase.from('con_proveedores')
        .select('id, razon_social, rubro').in('id', provIds)
      ;(provs||[]).forEach(p => { provMap[p.id] = p })
    }

    const inserts = seleccionados.map(c => {
      const prov = provMap[c.proveedor_id]
      const esParticular = !!c.unidad_id
      return {
        id: `GAS-IMP-${c.id}`,
        admin_id: session.user.id,
        consorcio_id: consorcioId,
        expensa_id: expSel.id,
        comprobante_id: c.id,
        proveedor_id: c.proveedor_id || null,
        fecha: c.fecha || hoy,
        comprobante: c.numero || null,
        concepto: c.concepto || `${c.tipo||''} ${c.numero||''}`.trim() || 'Sin concepto',
        // Gasto particular: categoría de la columna monto_fijo + UF destino (100% a esa UF).
        // Gasto común: categoría derivada del rubro del proveedor.
        categoria: esParticular
          ? categoriaParticularPorDefecto
          : (c.categoria || CAT_MAP[prov?.rubro || c.proveedor_rubro] || 'varios'),
        unidad_id: esParticular ? c.unidad_id : null,
        proveedor_nombre: prov?.razon_social || c.proveedor_nombre_resuelto || null,
        monto: parseFloat(c.monto_total) || 0,
      }
    })

    const { error } = await supabase.from('con_gastos').upsert(inserts, { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto: 'Error al importar: ' + error.message })

    await cargarGastos(expSel.id)
    await cargarComprobantesImportables(expSel.id)
    const tot = seleccionados.reduce((a,c)=>a+parseFloat(c.monto_total||0),0)
    setMsg({ tipo:'ok', texto:`✓ ${seleccionados.length} comprobante${seleccionados.length>1?'s':''} importado${seleccionados.length>1?'s':''} — Total: ${fmt(tot)}` })
  }

  async function cargarPlan() {
    const { data } = await supabase.from('con_plan_cuentas').select('*')
      .or(`consorcio_id.eq.${consorcioId},consorcio_id.eq.GLOBAL`)
      .eq('activo', true).order('orden')
    setPlanCuentas(data || [])
  }

  useEffect(() => { cargarPlan() }, [consorcioId])
  useEffect(() => { if (expSel) cargarGastos(expSel.id) }, [expSel])

  // ── PASO 1: Seleccionar período ────────────────────────────────────────────
  async function seleccionarExpensa(exp) {
    setExpSel(exp)
    await cargarGastos(exp.id)
    await cargarComprobantesImportables(exp.id)
    setPaso(2)
  }

  async function nuevaExpensa() {
    if (!puede('liquidar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite liquidar ni modificar expensas.' })
    // Consorcios históricos: las liquidaciones se cargan por Importar PDF/Excel (id HIST), NO por "Nuevo período".
    // Crear acá una expensa nativa (id EXP-<con>-<timestamp>) deja una cáscara vacía que luego colisiona con la
    // importación por el unique(consorcio_id, periodo) y la deja a medias (luf sin header). Ver §19 anomalía CON153.
    if (consorcioActivo?.modelo_cc === 'historico') {
      return setMsg({ tipo:'warn', texto:'Este consorcio está en modo histórico: cargá la liquidación desde Importar PDF/Excel, no desde “Nuevo período”.' })
    }
    // Calcular próximo período = mes siguiente al ÚLTIMO período existente (NO el mes calendario
    // actual). Las expensas se liquidan vencidas: abrir en septiembre corresponde al período de
    // agosto. Usar new Date() acá creaba el período del mes en curso (bug: septiembre en vez de agosto).
    const periodosPrevios = (expensas || [])
      .filter(e => e.tipo !== 'migracion' && /^\d{4}-\d{2}$/.test(e.periodo || ''))
      .map(e => e.periodo).sort()
    let periodo
    if (periodosPrevios.length > 0) {
      const [py, pm] = periodosPrevios[periodosPrevios.length - 1].split('-').map(Number)
      const d = new Date(py, pm, 1)   // pm es 1-based → new Date(y, pm, 1) apunta al mes siguiente
      periodo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
    } else {
      const hoyDate = new Date()
      periodo = `${hoyDate.getFullYear()}-${String(hoyDate.getMonth() + 1).padStart(2,'0')}`
    }

    // Verificar que no exista
    const existe = expensas.find(e => e.periodo === periodo && e.tipo !== 'migracion')
    if (existe) {
      setMsg({ tipo:'warn', texto:`Ya existe una expensa para ${periodo}` })
      return
    }

    setProcesando(true)
    const expId = `EXP-${consorcioId}-${Date.now()}`
    const { data, error } = await supabase.from('con_expensas').insert([{
      id: expId,
      admin_id: session.user.id,
      consorcio_id: consorcioId,
      periodo,
      tipo: 'ordinaria',
      estado: 'abierta',
      total_gastos: 0,
      total_expensa: 0,
    }]).select().single()

    if (error) { setMsg({ tipo:'error', texto: error.message }); setProcesando(false); return }

    const expData = data || { id: expId, periodo, estado:'abierta', tipo:'ordinaria' }
    await cargar()
    setExpSel(expData)
    await cargarComprobantesImportables(expId)
    setPaso(2)
    setProcesando(false)
    setMsg({ tipo:'ok', texto:`✓ Período ${periodo} creado` })
  }

  // ── PASO 2: Gastos ─────────────────────────────────────────────────────────
  async function guardarGasto() {
    if (!puede('liquidar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite liquidar ni modificar expensas.' })
    if (!formGasto?.concepto?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el concepto' })
    if (!formGasto?.monto || parseFloat(formGasto.monto) <= 0) return setMsg({ tipo:'warn', texto:'Ingresá el monto' })

    // D5: un gasto en categoría de columna monto_fijo (particular) exige UF destino.
    const catEsMF = esCategoriaMF(formGasto.categoria)
    if (catEsMF && !formGasto.unidad_id) {
      return setMsg({ tipo:'warn', texto:'Es un gasto particular: seleccioná la UF a la que se le carga.' })
    }

    const payload = {
      admin_id: session.user.id,
      consorcio_id: consorcioId,
      expensa_id: expSel.id,
      fecha: formGasto.fecha || hoy,
      concepto: formGasto.concepto.trim(),
      categoria: formGasto.categoria || 'varios',
      unidad_id: catEsMF ? (formGasto.unidad_id || null) : null,  // UF solo si es gasto particular
      proveedor_nombre: formGasto.proveedor_nombre || null,
      monto: parseFloat(formGasto.monto),
    }

    const { error } = formGasto.id
      ? await supabase.from('con_gastos').update(payload).eq('id', formGasto.id)
      : await supabase.from('con_gastos').insert([{ id: `GAS-${Date.now()}`, ...payload }])

    if (error) setMsg({ tipo:'error', texto: error.message })
    else {
      setFormGasto(null)
      setMsg(null)
      await cargarGastos(expSel.id)
      // Actualizar total en expensa
      const nuevoTotal = gastos.reduce((a,g) => a + (parseFloat(g.monto)||0), 0)
        + (formGasto.id ? 0 : parseFloat(formGasto.monto))
      await supabase.from('con_expensas').update({ total_gastos: nuevoTotal }).eq('id', expSel.id)
    }
  }

  async function eliminarGasto(id) {
    if (!puede('liquidar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite liquidar ni modificar expensas.' })
    if (!confirm('¿Eliminar este gasto?')) return
    await supabase.from('con_gastos').delete().eq('id', id)
    await cargarGastos(expSel.id)
  }

  const totalGastos = gastos.reduce((a,g) => a + (parseFloat(g.monto)||0), 0)

  // ── PASO 3: Distribución ───────────────────────────────────────────────────
  // Inicializar importes por columna a partir de los gastos cargados
  // Se llama al hacer clic en "Continuar → Distribución"
  function inicializarImportesPorColumna() {
    const colsActivas = columnasLiq.filter(c => c.activo)
    if (colsActivas.length === 0) return  // sin columnas → usa lógica global

    const gruposOrdenados = [...gruposLiq].sort((a,b) => a.numero - b.numero)

    // Tipo de cada columna (prorrateo | monto_fijo)
    const tipoPorCod = {}
    colsActivas.forEach(col => { tipoPorCod[col.codigo] = col.tipo || 'prorrateo' })

    // Calcular total de gastos por columna según grupos de liquidación
    const totalesPorCol = {}
    const porUfPorCol = {}   // solo columnas monto_fijo: { codigo: { unidad_id: monto } }
    colsActivas.forEach(col => { totalesPorCol[col.codigo] = 0 })

    gastos.forEach(g => {
      // Buscar a qué columnas pertenece este gasto según los grupos de liquidación
      const grp = gruposOrdenados.find(gr => gr.categorias?.includes(g.categoria))
      const colsCodigos = resolverCodigosColumna(grp?.columnas_coef?.length > 0
        ? grp.columnas_coef
        : [colsActivas[0]?.codigo], colsActivas)   // fallback: 1ª columna activa (case-insensitive)
      const monto = parseFloat(g.monto) || 0
      // IMPORTANTE: el gasto va completo a CADA columna indicada.
      // Si un gasto de electricidad figura en [EXPENSAS_A, SUB_2DO], significa
      // que AMBAS columnas lo incluyen para el prorrateo por su coeficiente.
      // No se divide el monto; cada columna lo prorratea independientemente.
      colsCodigos.forEach(cc => {
        if (totalesPorCol[cc] === undefined) return
        totalesPorCol[cc] += monto
        // Columna monto_fijo: acumular el gasto por UF destino (no se prorratea).
        if (tipoPorCod[cc] === 'monto_fijo' && g.unidad_id) {
          porUfPorCol[cc] = porUfPorCol[cc] || {}
          porUfPorCol[cc][g.unidad_id] = (porUfPorCol[cc][g.unidad_id] || 0) + monto
        }
      })
    })

    // Construir estado: { [codigo]: { monto, tipo, por_uf, usar_total } }
    const nuevoEstado = {}
    colsActivas.forEach(col => {
      nuevoEstado[col.codigo] = {
        nombre: col.nombre,
        campo_coef: col.campo_coef || 'porcentaje_fiscal',
        tipo: col.tipo || 'prorrateo',
        monto: Math.round(totalesPorCol[col.codigo] || 0),
        por_uf: porUfPorCol[col.codigo] || {},   // desglose por UF (solo monto_fijo)
        usar_total: true,   // si true: usa el total calculado; si false: editable manualmente
      }
    })
    setImportesPorColumna(nuevoEstado)
  }

  async function calcularDistribucion() {
    if (!puede('liquidar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite liquidar ni modificar expensas.' })
    // Resetear valores financieros al inicio del cálculo
    setCobradoActual(0)
    setSaldoCajaAnterior(0)
    setCobradoPeriodoAnt(0)

    const colsActivas = columnasLiq.filter(c => c.activo)
    const tieneMultiCol = colsActivas.length > 1

    // D5: bloquear si hay gastos en columna monto_fijo (particulares) sin UF destino.
    // No se inventa destino ni se prorratea: se avisa para que se corrija.
    const gastosMFSinUF = gastos.filter(g => esCategoriaMF(g.categoria) && !g.unidad_id)
    if (gastosMFSinUF.length > 0) {
      const lista = gastosMFSinUF
        .map(g => `«${g.concepto || 'sin concepto'}» ($${(parseFloat(g.monto) || 0).toLocaleString('es-AR')})`)
        .join(', ')
      return setMsg({ tipo:'error', texto:`Hay ${gastosMFSinUF.length} gasto(s) particular(es) sin UF asignada: ${lista}. Asigná la UF destino (editá el gasto) antes de calcular la distribución.` })
    }

    // Determinar el total a cobrar
    // — Multicol: suma de los importes de todas las columnas (cada una editable)
    // — Unicol / sin columnas: lógica global existente
    let totalACobrar
    if (tieneMultiCol && Object.keys(importesPorColumna).length > 0) {
      totalACobrar = Object.values(importesPorColumna).reduce((a,c) => a + (parseFloat(c.monto)||0), 0)
    } else {
      totalACobrar = config.usar_total_gastos
        ? totalGastos
        : parseFloat(config.total_a_cobrar) || totalGastos
    }

    if (totalACobrar <= 0) return setMsg({ tipo:'warn', texto:'El total a cobrar debe ser mayor a cero' })
    if (unidades.length === 0) return setMsg({ tipo:'warn', texto:'No hay unidades cargadas en este consorcio' })

    const coefTotal = unidades.reduce((a,u) => a + (parseFloat(u.porcentaje_fiscal)||0), 0)
    if (coefTotal === 0) return setMsg({ tipo:'warn', texto:'Las unidades no tienen coeficientes cargados' })

    // Cargar saldos anteriores de la última expensa cerrada
    let saldosAnt = {}
    const { data: expAnterior } = await supabase.from('con_expensas')
      .select('id, saldo_caja_final, total_cobrado, fuente, periodo').eq('consorcio_id', consorcioId)
      .neq('id', expSel?.id || '').eq('estado','cerrada')
      .order('periodo', { ascending: false }).limit(1)

    // Saldo de caja anterior = saldo_caja_final de la última liquidación cerrada
    if (expAnterior?.[0]) {
      const saldoCaja = parseFloat(expAnterior[0].saldo_caja_final) || 0
      setSaldoCajaAnterior(saldoCaja)

      // Cobrado anterior: preferir total_cobrado de la expensa (disponible en liquidaciones migradas)
      // Si hay detalles cargados manualmente, sumarlos; sino usar total_cobrado directamente
      const totalCobradoDirecto = parseFloat(expAnterior[0].total_cobrado) || 0

      const { data: detsAnt } = await supabase.from('con_expensas_detalle')
        .select('unidad_id, monto, saldo_anterior, pagos_periodo, interes_mora')
        .eq('expensa_id', expAnterior[0].id)

      // FUENTE DE VERDAD para consorcios con historia importada: con_liquidacion_uf.total_uf del
      // período anterior = saldo real al cierre (puede ser negativo = saldo a favor). Se prioriza
      // sobre reconstruir desde el detalle, cuyos pagos/saldos pueden venir raros de la migración.
      const { data: lufAnt } = await supabase.from('con_liquidacion_uf')
        .select('unidad_id, total_uf, pagos').eq('expensa_id', expAnterior[0].id)

      // También buscar cobranzas registradas en la expensa anterior (por UF)
      const { data: cobranzasAnt } = await supabase.from('con_cobranzas')
        .select('unidad_id, monto').eq('expensa_id', expAnterior[0].id)
      const cobranzasPorUF = {}
      for (const co of (cobranzasAnt||[])) {
        cobranzasPorUF[co.unidad_id] = (cobranzasPorUF[co.unidad_id]||0) + (parseFloat(co.monto)||0)
      }

      let totalCobradoAnt = 0
      // Si el período anterior es NATIVO (fuente='gasp'), la fuente de verdad del saldo al cierre es
      // con_expensas_detalle (saldo_anterior+monto+interes-pagos). con_liquidacion_uf puede tener un
      // espejo residual de un import previo (total_uf sin netear los pagos) que arrastraría el monto
      // completo como deuda. Solo se prioriza con_liquidacion_uf para períodos históricos importados.
      const esAnteriorNativo = (expAnterior[0].fuente === 'gasp')
      // Consorcio MIGRADO a nativo cuyo período anterior es PRE-corte: el total_uf del luf es la
      // apertura y NO refleja los pagos/recargos post-corte (que están en la cta cte). El saldo real
      // al inicio del período nativo = apertura (MOV-APERT) − pagos post-corte + recargos post-corte.
      // Se usa el modelo nativo (resta pagos) con interés = recargos post-corte (MOV-RECV2).
      const corteNat = consorcioActivo?.fecha_corte_nativo || null
      const expAntPreCorte = !!corteNat && (expAnterior[0].periodo || '') < String(corteNat).slice(0, 7)
      if (expAntPreCorte) {
        const [{ data: aperts }, { data: pagosPost }, { data: recPost }, { data: ncPost }] = await Promise.all([
          supabase.from('con_movimientos_unidad').select('unidad_id, tipo, monto').eq('consorcio_id', consorcioId).like('id', 'MOV-APERT-%'),
          supabase.from('con_cobranzas').select('unidad_id, monto').eq('consorcio_id', consorcioId).gte('fecha', corteNat),
          supabase.from('con_movimientos_unidad').select('unidad_id, monto').eq('consorcio_id', consorcioId).like('id', 'MOV-RECV2-%').gte('fecha', corteNat).neq('estado', 'anulado'),
          // Créditos de ajuste post-corte (NC, cancelación de intereses, pagos no registrados):
          // vigentes, tipo crédito, que NO son apertura ni pago (MOV-COB / con_cobranzas). La cta cte
          // los netea; sin esto la liquidación los ignora y sobre-factura la UF. Se acreditan como "pagos".
          supabase.from('con_movimientos_unidad').select('unidad_id, monto').eq('consorcio_id', consorcioId).eq('tipo', 'credito').gte('fecha', corteNat).neq('estado', 'anulado').not('id', 'like', 'MOV-APERT-%').not('id', 'like', 'MOV-COB-%'),
        ])
        const pagoUF = {}, recUF = {}
        for (const p of (pagosPost || [])) pagoUF[p.unidad_id] = (pagoUF[p.unidad_id] || 0) + (parseFloat(p.monto) || 0)
        for (const nc of (ncPost || [])) pagoUF[nc.unidad_id] = (pagoUF[nc.unidad_id] || 0) + (parseFloat(nc.monto) || 0)
        for (const rc of (recPost || [])) recUF[rc.unidad_id] = (recUF[rc.unidad_id] || 0) + (parseFloat(rc.monto) || 0)
        for (const a of (aperts || [])) {
          const saldoAp = a.tipo === 'credito' ? -(parseFloat(a.monto) || 0) : (parseFloat(a.monto) || 0)
          const pagosUF = pagoUF[a.unidad_id] || 0
          // saldo anterior = apertura; pagos post-corte (incluye NC/ajustes); interes = MOV-RECV2 vigentes.
          // El prorrateo (rama corteMes) resta pagos, conserva saldo a favor y calcula mora sobre la deuda.
          saldosAnt[a.unidad_id] = { saldo: saldoAp, pagos: pagosUF, interes: recUF[a.unidad_id] || 0, corteMes: true }
          totalCobradoAnt += pagosUF
        }
      } else if (!esAnteriorNativo && (lufAnt||[]).length > 0) {
        // Período anterior histórico (importado): el saldo al cierre es total_uf (conserva saldo a favor)
        for (const l of lufAnt) {
          const pagosUF = cobranzasPorUF[l.unidad_id] || (parseFloat(l.pagos)||0)
          saldosAnt[l.unidad_id] = { saldo: parseFloat(l.total_uf)||0, pagos: pagosUF }
          totalCobradoAnt += pagosUF
        }
      } else if ((detsAnt||[]).length > 0) {
        // Período anterior nativo. Modelo concordante con Administración Global:
        //   saldo   = expensa del mes anterior (deuda previa + expensa, SIN interés) → col "saldo anterior"
        //   interes = interés/recargo del mes anterior (d.interes_mora)              → col "interés"
        //   pagos   = pagos del mes anterior                                         → col "pagos"
        // La deuda (saldo − pagos, con signo) y el interés se compensan en el total (ver prorrateo).
        for (const d of detsAnt) {
          const pagosUF = cobranzasPorUF[d.unidad_id] || (parseFloat(d.pagos_periodo)||0)
          const expensaAnt = (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0)
          saldosAnt[d.unidad_id] = {
            saldo: expensaAnt, interes: parseFloat(d.interes_mora)||0, pagos: pagosUF, nativo: true
          }
          totalCobradoAnt += pagosUF
        }
      } else if ((lufAnt||[]).length > 0) {
        // Fallback defensivo: período sin detalle por UF pero con espejo en con_liquidacion_uf
        for (const l of lufAnt) {
          const pagosUF = cobranzasPorUF[l.unidad_id] || (parseFloat(l.pagos)||0)
          saldosAnt[l.unidad_id] = { saldo: parseFloat(l.total_uf)||0, pagos: pagosUF }
          totalCobradoAnt += pagosUF
        }
      } else {
        // Caso fallback: no hay detalles por UF (liquidación anterior cerrada sin detalles)
        // Reconstruir montos por UF prorrateando total_expensa según coeficientes
        const totalExpAnt = parseFloat(expAnterior[0].total_expensa) || 0
        const totalCobAnt = parseFloat(expAnterior[0].total_cobrado) || totalCobradoDirecto
        const coefTotalAnt = unidades.reduce((a,u) => a + (parseFloat(u.porcentaje_fiscal)||0), 0)

        if (totalExpAnt > 0 && coefTotalAnt > 0) {
          for (const u of unidades) {
            const coefUF = parseFloat(u.porcentaje_fiscal) || 0
            if (coefUF === 0) continue
            // Monto proporcional de la UF en la expensa anterior
            const montoUFAnt = Math.round(totalExpAnt * (coefUF / coefTotalAnt))
            // Pago registrado para esta UF (de cobranzas si existe)
            const pagosUF = cobranzasPorUF[u.id] || 0
            // Pago proporcional estimado si no hay cobranzas individuales
            const pagosEstimados = pagosUF > 0
              ? pagosUF
              : (totalCobAnt > 0 ? Math.round(totalCobAnt * (coefUF / coefTotalAnt)) : 0)
            const saldo = Math.max(0, montoUFAnt - pagosEstimados)
            if (saldo > 0 || pagosEstimados > 0) {
              saldosAnt[u.id] = { saldo, pagos: pagosEstimados }
              totalCobradoAnt += pagosEstimados
            }
          }
        }
      }
      // NC / reintegros / ajustes del período para NATIVOS que NO pasaron por la rama corteMes (nativos
      // puros y meses nativos posteriores al corte): la cta cte los netea, pero el prorrateo los ignoraba
      // y sobre-facturaba la UF. Se aplican como CRÉDITO A FAVOR (reducen la deuda), FUERA de la columna
      // PAGOS (que queda solo con cobranzas reales y reconcilia con el Estado Financiero).
      // CLAVE: solo créditos con expensa_id NULL = ajuste/NC standalone NO imputado a una expensa (y por
      // ende NO contado en cobranzas/detalle). Los pagos-espejo (categoria 'pago') tienen expensa_id y
      // quedan afuera → sin doble conteo. Ventana = mes calendario del período liquidado.
      if (!expAntPreCorte && consorcioActivo?.modelo_cc == null && expSel?.periodo) {
        const [cy, cm] = expSel.periodo.split('-').map(Number)
        const desdeCred = `${expSel.periodo}-01`
        const nextM = new Date(cy, cm, 1)
        const hastaCred = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, '0')}-01`
        const { data: ncPeriodo } = await supabase.from('con_movimientos_unidad')
          .select('unidad_id, monto').eq('consorcio_id', consorcioId).eq('tipo', 'credito')
          .is('expensa_id', null)
          .gte('fecha', desdeCred).lt('fecha', hastaCred).neq('estado', 'anulado')
          .not('id', 'like', 'MOV-APERT-%').not('id', 'like', 'MOV-COB-%')
        for (const nc of (ncPeriodo || [])) {
          const monto = parseFloat(nc.monto) || 0
          if (!monto) continue
          const prev = saldosAnt[nc.unidad_id]
          if (prev) {
            prev.creditoAjuste = (prev.creditoAjuste || 0) + monto
            if (prev.corteMes === undefined && prev.nativo === undefined) prev.nativo = true
          } else {
            saldosAnt[nc.unidad_id] = { saldo: 0, pagos: 0, interes: 0, creditoAjuste: monto, nativo: true }
          }
        }
      }
      // cobradoPeriodoAnt = pagos del período anterior (para el EF)
      // se usa solo para mostrar el Estado Financiero del período que se está liquidando
      // Se guarda el total cobrado del período anterior como referencia histórica
      setCobradoPeriodoAnt(totalCobradoAnt > 0 ? totalCobradoAnt : totalCobradoDirecto)
    } else {
      setSaldoCajaAnterior(0)
      setCobradoPeriodoAnt(0)
    }

    // Ingresos del período por CRITERIO CAJA (fecha de acreditación + estado='acreditado').
    // Se calculan en el servidor con la RPC con_estado_financiero para NO depender del
    // expensa_id de la cobranza (apunta a la deuda que cancela, no al período de caja).
    const { data: efRows, error: efErr } = await supabase
      .rpc('con_estado_financiero', { p_consorcio_id: consorcioId, p_periodo: expSel?.periodo || '' })
    if (efErr) console.error('con_estado_financiero:', efErr)
    const ef = Array.isArray(efRows) ? efRows[0] : efRows
    setCobradoActual(parseFloat(ef?.ingresos_termino)   || 0)
    setCobradoAdeudado(parseFloat(ef?.ingresos_adeudados) || 0)
    setCobradoInteres(parseFloat(ef?.ingresos_intereses)  || 0)

    // Calcular fechas de vencimiento
    const exp_periodo = expSel?.periodo || ''
    const [y, m] = exp_periodo.split('-')
    const mesNum  = parseInt(m) || new Date().getMonth() + 1
    const anioNum = parseInt(y) || new Date().getFullYear()
    const mesVto  = mesNum === 12 ? 1 : mesNum + 1
    const anioVto = mesNum === 12 ? anioNum + 1 : anioNum
    const vto1 = `${anioVto}-${String(mesVto).padStart(2,'0')}-${String(config.vto1_dia||10).padStart(2,'0')}`
    const vto2 = `${anioVto}-${String(mesVto).padStart(2,'0')}-${String(config.vto2_dia||20).padStart(2,'0')}`

    // ── Distribución por columnas ────────────────────────────────────────────
    // Para consorcios con múltiples columnas (ej: Mejillón con EXPENSAS A + B):
    //   - Cada columna tiene su propio coeficiente (campo_coef) y monto
    //   - La expensa de cada UF = suma de (monto_col * coef_UF / coef_total_col) por columna
    // Para consorcios sin columnas configuradas: usa porcentaje_fiscal global (comportamiento anterior)

    const items = unidades.map((u, idx) => {
      const ufNum = idx + 1
      const cp    = copropietarios.find(c => c.id === u.propietario_id)
      const coef  = parseFloat(u.porcentaje_fiscal) || 0
      const pct   = coefTotal > 0 ? coef / coefTotal * 100 : 0

      let expensaBase = 0

      if (tieneMultiCol && Object.keys(importesPorColumna).length > 0) {
        // Multicol: calcular aporte de cada columna para esta UF
        // Para cada columna: intentar usar su campo_coef propio;
        // si ese campo es 0 en TODAS las UFs (no configurado), hacer fallback a porcentaje_fiscal
        Object.entries(importesPorColumna).forEach(([codigo, col]) => {
          // Columna monto_fijo: el gasto particular va 100% a la UF destino (no se prorratea).
          if (col.tipo === 'monto_fijo') {
            expensaBase += Math.round(col.por_uf?.[u.id] || 0)
            return
          }
          const montoCol = parseFloat(col.monto) || 0
          if (montoCol === 0) return  // columna sin importe → no aporta
          const campoCf = col.campo_coef || 'porcentaje_fiscal'
          // Calcular el total del coeficiente de esta columna entre todas las UFs
          const coefTotalCol = unidades.reduce((a, uu) => a + (parseFloat(uu[campoCf])||0), 0)
          // Fallback: si el campo alternativo tiene todos cero, usar porcentaje_fiscal
          const campoEfectivo = coefTotalCol > 0 ? campoCf : 'porcentaje_fiscal'
          const coefTotalEfectivo = coefTotalCol > 0
            ? coefTotalCol
            : unidades.reduce((a, uu) => a + (parseFloat(uu['porcentaje_fiscal'])||0), 0)
          const coefUFEfectivo = parseFloat(u[campoEfectivo]) || 0
          if (coefTotalEfectivo > 0) {
            expensaBase += Math.round(montoCol * (coefUFEfectivo / coefTotalEfectivo))
          }
        })
      } else {
        // Unicol: comportamiento original
        expensaBase = Math.round(totalACobrar * (coef / coefTotal))
      }

      // Redondeo: centavos = número de UF (identifica el pago en el banco)
      const centavosUF = ufNum / 100

      // Datos de la liq anterior para esta UF
      const antUF = saldosAnt[u.id] || { saldo: 0, pagos: 0 }
      const saldo_anterior = antUF.saldo
      const pagos_anterior = antUF.pagos
      const creditoAjuste = antUF.creditoAjuste || 0
      const tasaMora = parseFloat(consorcioActivo?.interes_mora || 0) / 100

      let deuda, ajusteSaldoAnt, interes_mora, saldo_arrastre
      if (antUF.corteMes) {
        // Primer mes nativo (consorcio migrado): deuda = apertura − pagos post-corte (CON signo:
        // conserva saldo a favor). El interés = recargos 2º venc legítimos (MOV-RECV2, ya devengados)
        // MÁS el interés de mora del período sobre la deuda que quede pendiente (> 0).
        deuda = Math.round((saldo_anterior - pagos_anterior) * 100) / 100
        const moraDeuda = deuda > 0 ? Math.round(deuda * tasaMora * 100) / 100 : 0
        interes_mora = Math.round(((antUF.interes || 0) + moraDeuda) * 100) / 100
        ajusteSaldoAnt = deuda
        saldo_arrastre = deuda + interes_mora
      } else if (antUF.nativo) {
        // Modelo Administración Global (período anterior nativo):
        //   deuda = saldo anterior − pagos (CON signo; si pagó el interés en 2º vto queda negativa).
        //   interés = el del mes anterior (ya devengado); deuda e interés se compensan en el total.
        //   saldo_arrastre = deuda + interés = lo que realmente queda debiendo (se persiste al cerrar).
        interes_mora = antUF.interes || 0
        deuda = saldo_anterior - pagos_anterior
        ajusteSaldoAnt = deuda
        saldo_arrastre = deuda + interes_mora
      } else {
        // Modelo histórico: total_uf ya es saldo neto acumulado; se cobra interés (mensual directo)
        // sobre la deuda arrastrada, sumado aparte al total.
        deuda = Math.max(0, saldo_anterior)
        ajusteSaldoAnt = saldo_anterior
        interes_mora = deuda > 0 ? Math.round(deuda * tasaMora * 100) / 100 : 0
        saldo_arrastre = ajusteSaldoAnt + interes_mora
      }

      // Crédito de ajuste del período (NC/reintegro, expensa_id NULL): reduce la deuda como saldo a
      // favor y se arrastra al mes siguiente. Va FUERA de PAGOS (que queda solo con cobranzas reales).
      if (creditoAjuste) {
        deuda = Math.round((deuda - creditoAjuste) * 100) / 100
        ajusteSaldoAnt = deuda
        saldo_arrastre = Math.round((saldo_arrastre - creditoAjuste) * 100) / 100
      }

      // TOTAL a pagar: se fuerza a terminar en los centavos = número de UF (identifica el pago en
      // el banco) sobre el TOTAL, no sobre la expensa. Así, aunque el saldo anterior arrastre sus
      // propios centavos, el total SIEMPRE termina en ,0N (N = número de UF).
      const baseTotal = expensaBase + ajusteSaldoAnt + interes_mora
      const monto_total = Math.trunc(baseTotal + 1e-9) + centavosUF
      // redondeo real aplicado: se registra en la cta cte y define la expensa del período CON centavos
      const redondeoTotal = Math.round((monto_total - baseTotal) * 100) / 100
      // 2do vencimiento: recargo sobre la expensa del período; también se ajusta a centavos de UF
      const baseVto2 = Math.round(expensaBase * (1 + (config.pct_mora_vto2 || 0) / 100) * 100) / 100 + ajusteSaldoAnt + interes_mora
      const monto_vto2 = Math.trunc(baseVto2 + 1e-9) + centavosUF

      // Calcular aporte desagregado por columna (para la planilla PDF)
      // Misma lógica de fallback que expensaBase
      const aporte_por_columna = {}
      if (tieneMultiCol && Object.keys(importesPorColumna).length > 0) {
        Object.entries(importesPorColumna).forEach(([codigo, col]) => {
          // Columna monto_fijo: el aporte de la UF es el gasto particular directo (o 0).
          if (col.tipo === 'monto_fijo') {
            aporte_por_columna[codigo] = Math.round(col.por_uf?.[u.id] || 0)
            return
          }
          const montoCol = parseFloat(col.monto) || 0
          const campoCf = col.campo_coef || 'porcentaje_fiscal'
          const coefTotalCol = unidades.reduce((a, uu) => a + (parseFloat(uu[campoCf])||0), 0)
          const campoEfectivo = coefTotalCol > 0 ? campoCf : 'porcentaje_fiscal'
          const coefTotalEfectivo = coefTotalCol > 0
            ? coefTotalCol
            : unidades.reduce((a, uu) => a + (parseFloat(uu['porcentaje_fiscal'])||0), 0)
          const coefUFEfectivo = parseFloat(u[campoEfectivo]) || 0
          aporte_por_columna[codigo] = (montoCol > 0 && coefTotalEfectivo > 0)
            ? Math.round(montoCol * (coefUFEfectivo / coefTotalEfectivo))
            : 0
        })
      }

      return {
        unidad_id: u.id,
        numero: u.numero_interno || u.numero,
        numero_uf: ufNum,
        tipo: u.tipo,
        propietario: cp?.apellido_nombre || '—',
        coef, pct: pct.toFixed(4),
        expensa_base: expensaBase,
        aporte_por_columna,   // desglose por columna para el PDF
        redondeo: redondeoTotal,
        monto: monto_total,
        monto_vto2,
        vto1, vto2,
        saldo_anterior,
        pagos_anterior,
        deuda,
        interes_mora,
        saldo_arrastre,
      }
    })

    // Verificar que la suma total es correcta (informativo)
    const sumaTotal = items.reduce((a,d) => a + d.expensa_base, 0)

    setDistribucion(items)
    setMsg({ tipo:'ok', texto:`✓ Distribución calculada — ${items.length} UFs — Total expensas: $${totalACobrar.toLocaleString('es-AR')}` })
    setPaso(3)
  }

  const [notasPeriodo, setNotasPeriodo] = useState('')
  const [cargandoNotas, setCargandoNotas] = useState(false)

  // Cargar notas del período cuando se selecciona la expensa
  useEffect(() => {
    if (expSel?.notas_periodo !== undefined) {
      setNotasPeriodo(expSel.notas_periodo || consorcioActivo?.notas_liquidacion_default || '')
    }
  }, [expSel])

  async function guardarNotas() {
    if (!puede('liquidar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite liquidar ni modificar expensas.' })
    if (!expSel?.id) return
    setCargandoNotas(true)
    await supabase.from('con_expensas').update({ notas_periodo: notasPeriodo }).eq('id', expSel.id)
    setCargandoNotas(false)
  }

  // ── Vista previa imprimible de la liquidación ─────────────────────────────
  function vistaPrevia() {
    if (!distribucion || distribucion.length === 0) return setMsg({ tipo:'warn', texto:'Calculá la distribución antes de ver la vista previa' })

    // Abrir ventana al inicio del evento click para que el browser no la bloquee
    const printWin = window.open('', '_blank', 'width=1100,height=800,scrollbars=yes,resizable=yes')
    if (!printWin) {
      setMsg({ tipo:'warn', texto:'⚠️ El navegador bloqueó la ventana emergente. Habilitá los popups para este sitio.' })
      return
    }

    escribirLiquidacionNativa(printWin, construirHTMLLiquidacionNativa(datosPDFNativo()))
  }

  // U1: datos de la plantilla nativa (serializables; U2 los guarda al cierre)
  function datosPDFNativo() {
    return { consorcioActivo, expSel, gastos, distribucion, columnasLiq, gruposLiq, config, importesPorColumna,
      saldoCajaAnterior, cobradoActual, cobradoAdeudado, cobradoInteres, notasPeriodo,
      adminPerfil: adminPerfil || {}, esPreliquidacion: expSel?.estado !== 'cerrada' }
  }


  // ── PASO 4: Confirmar y cerrar ─────────────────────────────────────────────
  async function confirmarYCerrar() {
    if (!puede('liquidar')) return setMsg({ tipo:'warn', texto:'Tu rol no permite liquidar ni modificar expensas.' })
    // U2: aviso previo si faltan datos que la Ley 14.701 exige en la liquidación (no bloquea)
    const faltantes = []
    if (!gastos.some(g => g.categoria === 'honorarios_admin')) faltantes.push('• Honorarios de administración (art. 11 inc. e)')
    if (!(consorcioActivo?.poliza_nro || consorcioActivo?.poliza_compania || consorcioActivo?.aseguradora)) faltantes.push('• Datos de la póliza del consorcio (art. 11 inc. j)')
    if (faltantes.length && !confirm(`Faltan datos que la Ley 14.701 exige en la liquidación:\n\n${faltantes.join('\n')}\n\n¿Cerrar el período igual?`)) return
    if (!confirm(`¿Confirmar y cerrar el período ${expSel?.periodo}?\n\nSe generarán ${distribucion.length} comprobantes individuales y el período quedará cerrado.`)) return

    // U2: datos exactos del PDF (los mismos de la Vista previa), tomados antes de recargar el estado.
    const snapBase = datosPDFNativo()
    // Abrir la ventana del PDF en el gesto del usuario (evita el bloqueo de pop-ups)
    const pdfWin = window.open('', '_blank', 'width=1100,height=800,scrollbars=yes,resizable=yes')
    if (pdfWin) pdfWin.document.write('<p style="font-family:Arial;padding:24px;color:#555">Cerrando el período y generando la liquidación…</p>')

    setProcesando(true)
    setMsg(null)

    try {
      const totalACobrar = distribucion.reduce((a,d) => a + d.monto, 0)

      // 1. Actualizar la expensa con los totales definitivos
      // totalCobrado = cobranzas REALES registradas en este período (con_cobranzas)
      // NO usar pagos_anterior (eso es la deuda que viene de períodos anteriores)
      // Ingresos y saldo por CRITERIO CAJA vía RPC — mismo cálculo que la vista previa.
      // Evita el bug de filtrar cobranzas por expensa_id (devolvía 0 y persistía saldo mal).
      const { data: efRows, error: efErr } = await supabase
        .rpc('con_estado_financiero', { p_consorcio_id: consorcioId, p_periodo: expSel.periodo })
      if (efErr) throw new Error('Estado financiero: ' + efErr.message)
      const efC = Array.isArray(efRows) ? efRows[0] : efRows
      const totalCobrado   = parseFloat(efC?.total_ingresos) || 0
      const saldoCajaFinal = parseFloat(efC?.saldo_final)    || 0
      await supabase.from('con_expensas').update({
        total_gastos: totalGastos,
        total_expensa: totalACobrar,
        total_administracion: gastos.filter(g=>g.categoria==='honorarios_admin').reduce((a,g)=>a+(parseFloat(g.monto)||0),0),
        fecha_vencimiento: distribucion[0]?.vto1 || null,
        estado: 'cerrada',
        saldo_caja_final: saldoCajaFinal,
        total_cobrado: totalCobrado,
        // Persistir el estado financiero completo (lo lee el PDF del propietario e historial)
        saldo_anterior:     parseFloat(efC?.saldo_anterior)     || 0,
        ingresos_termino:   parseFloat(efC?.ingresos_termino)   || 0,
        ingresos_adeudados: parseFloat(efC?.ingresos_adeudados) || 0,
        ingresos_intereses: parseFloat(efC?.ingresos_intereses) || 0,
        total_egresos:      parseFloat(efC?.total_egresos)      || 0,
      }).eq('id', expSel.id)

      // 2. Eliminar detalles anteriores si existen (recalculo)
      await supabase.from('con_expensas_detalle').delete().eq('expensa_id', expSel.id)

      // 3. Buscar saldos anteriores de cada UF (de períodos previos)
      const { data: expAnterior } = await supabase.from('con_expensas')
        .select('id, periodo').eq('consorcio_id', consorcioId)
        .neq('id', expSel.id).eq('estado','cerrada')
        .order('periodo', { ascending: false }).limit(1)

      let saldosAnt = {}
      if (expAnterior?.[0]) {
        const { data: detsAnt } = await supabase.from('con_expensas_detalle')
          .select('unidad_id, monto, saldo_anterior, pagos_periodo, interes_mora')
          .eq('expensa_id', expAnterior[0].id)
        // Fuente de verdad para históricos importados: con_liquidacion_uf.total_uf (saldo al cierre)
        const { data: lufAnt2 } = await supabase.from('con_liquidacion_uf')
          .select('unidad_id, total_uf').eq('expensa_id', expAnterior[0].id)
        // Cobranzas individuales de la expensa anterior
        const { data: cobranzasAnt2 } = await supabase.from('con_cobranzas')
          .select('unidad_id, monto').eq('expensa_id', expAnterior[0].id)
        const cobPorUF2 = {}
        for (const co of (cobranzasAnt2||[])) {
          cobPorUF2[co.unidad_id] = (cobPorUF2[co.unidad_id]||0) + (parseFloat(co.monto)||0)
        }
        // Consorcio migrado con período anterior PRE-corte: saldo neto = apertura − pagos + recargos
        // post-corte (cta cte). El total_uf del luf es sólo la apertura (no netea los pagos).
        const corteNat2 = consorcioActivo?.fecha_corte_nativo || null
        const expAntPreCorte2 = !!corteNat2 && (expAnterior[0].periodo || '') < String(corteNat2).slice(0, 7)
        if (expAntPreCorte2) {
          const [{ data: aperts2 }, { data: pagosPost2 }, { data: recPost2 }, { data: ncPost2 }] = await Promise.all([
            supabase.from('con_movimientos_unidad').select('unidad_id, tipo, monto').eq('consorcio_id', consorcioId).like('id', 'MOV-APERT-%'),
            supabase.from('con_cobranzas').select('unidad_id, monto').eq('consorcio_id', consorcioId).gte('fecha', corteNat2),
            supabase.from('con_movimientos_unidad').select('unidad_id, monto').eq('consorcio_id', consorcioId).like('id', 'MOV-RECV2-%').gte('fecha', corteNat2).neq('estado', 'anulado'),
            // Créditos de ajuste post-corte (NC, cancelación intereses, pagos no registrados): vigentes,
            // crédito, no apertura ni pago. La cta cte los netea; se acreditan como pago (reducen el arrastre).
            supabase.from('con_movimientos_unidad').select('unidad_id, monto').eq('consorcio_id', consorcioId).eq('tipo', 'credito').gte('fecha', corteNat2).neq('estado', 'anulado').not('id', 'like', 'MOV-APERT-%').not('id', 'like', 'MOV-COB-%'),
          ])
          const pagoU2 = {}, recU2 = {}
          for (const p of (pagosPost2 || [])) pagoU2[p.unidad_id] = (pagoU2[p.unidad_id] || 0) + (parseFloat(p.monto) || 0)
          for (const nc of (ncPost2 || [])) pagoU2[nc.unidad_id] = (pagoU2[nc.unidad_id] || 0) + (parseFloat(nc.monto) || 0)
          for (const rc of (recPost2 || [])) recU2[rc.unidad_id] = (recU2[rc.unidad_id] || 0) + (parseFloat(rc.monto) || 0)
          const tasaMora2 = parseFloat(consorcioActivo?.interes_mora || 0) / 100
          for (const a of (aperts2 || [])) {
            const saldoAp = a.tipo === 'credito' ? -(parseFloat(a.monto) || 0) : (parseFloat(a.monto) || 0)
            // deuda = apertura + recargos legítimos − pagos post-corte (con signo, conserva a favor)
            const deudaN = Math.round((saldoAp + (recU2[a.unidad_id] || 0) - (pagoU2[a.unidad_id] || 0)) * 100) / 100
            // arrastre = deuda + mora del período sobre la deuda pendiente
            const moraN = deudaN > 0 ? Math.round(deudaN * tasaMora2 * 100) / 100 : 0
            const arrastre = Math.round((deudaN + moraN) * 100) / 100
            if (arrastre !== 0) saldosAnt[a.unidad_id] = arrastre
          }
        } else if ((lufAnt2||[]).length > 0) {
          // Período anterior histórico: saldo al cierre = total_uf (conserva saldo a favor negativo)
          for (const l of lufAnt2) {
            const saldo = parseFloat(l.total_uf) || 0
            if (saldo !== 0) saldosAnt[l.unidad_id] = saldo
          }
        } else if ((detsAnt||[]).length > 0) {
          // Período anterior nativo: reconstruir desde el detalle (SIN Math.max → conserva saldo a favor)
          for (const d of detsAnt) {
            const pagos = cobPorUF2[d.unidad_id] || (parseFloat(d.pagos_periodo)||0)
            const saldo =
              (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0) +
              (parseFloat(d.interes_mora)||0) - pagos
            if (saldo !== 0) saldosAnt[d.unidad_id] = saldo
          }
        } else {
          // Fallback: reconstruir desde total_expensa y coeficientes
          const totalExpAnt2 = parseFloat(expAnterior[0].total_expensa) || 0
          const totalCobAnt2 = parseFloat(expAnterior[0].total_cobrado) || 0
          const coefTot2 = unidades.reduce((a,u) => a + (parseFloat(u.porcentaje_fiscal)||0), 0)
          if (totalExpAnt2 > 0 && coefTot2 > 0) {
            for (const u of unidades) {
              const cf = parseFloat(u.porcentaje_fiscal) || 0
              if (cf === 0) continue
              const montoUF = Math.round(totalExpAnt2 * (cf / coefTot2))
              const pagoUF = cobPorUF2[u.id] || (totalCobAnt2 > 0 ? Math.round(totalCobAnt2 * (cf/coefTot2)) : 0)
              const saldo = Math.max(0, montoUF - pagoUF)
              if (saldo > 0) saldosAnt[u.id] = saldo
            }
          }
        }
      }

      // 4. Insertar detalles por UF
      const detalles = distribucion.map(d => ({
        id: `DET-${expSel.id}-${d.unidad_id}`,
        admin_id: session.user.id,
        consorcio_id: consorcioId,
        expensa_id: expSel.id,
        unidad_id: d.unidad_id,
        monto: (parseFloat(d.expensa_base)||0) + (parseFloat(d.redondeo)||0),  // expensa del período CON centavos (base del arrastre)
        redondeo: d.redondeo,        // centavos del número de UF (ej: 0.03 para UF 3)
        // saldo_anterior = deuda del período SIN mora (= arrastre − interés); la mora se persiste
        // aparte en interes_mora para que PDF/email/portal la itemicen (antes se plegaba todo acá y
        // se guardaba interes_mora:0, invisibilizando el interés en el PDF). El arrastre al mes
        // siguiente es invariante: se reconstruye como saldo_anterior + monto + interes_mora − pagos.
        saldo_anterior: (d.saldo_arrastre !== undefined ? Math.round((((d.saldo_arrastre)||0) - ((d.interes_mora)||0)) * 100) / 100 : (d.saldo_anterior || saldosAnt[d.unidad_id] || 0)),
        pagos_periodo: 0,
        interes_mora: (parseFloat(d.interes_mora) || 0),
        estado: ((d.saldo_arrastre !== undefined ? d.saldo_arrastre : (d.saldo_anterior || saldosAnt[d.unidad_id] || 0)) > 0.005) ? 'morosa' : 'pendiente',
      }))

      const { error } = await supabase.from('con_expensas_detalle').insert(detalles)
      if (error) throw new Error(error.message)

      // P1-B: Asignar número correlativo de liquidación por consorcio
      try {
        await supabase.rpc('asignar_numero_liquidacion', { p_consorcio_id: consorcioId, p_expensa_id: expSel.id })
      } catch(e) { /* no crítico */ }

      // U2: guardar los datos exactos del PDF nativo. Períodos y Portal regeneran este MISMO PDF.
      const pdfDatos = prepararDatosPDF({ ...snapBase, expSel: { ...(snapBase.expSel || {}), estado: 'cerrada' }, esPreliquidacion: false })
      const { error: eSnap } = await supabase.from('con_expensas')
        .update({ pdf_datos: pdfDatos, pdf_datos_at: new Date().toISOString(), pdf_plantilla: 'nativa-ley14701-v1' })
        .eq('id', expSel.id)

      setMsg(eSnap
        ? { tipo:'warn', texto:`✓ Período ${expSel.periodo} cerrado, pero no se pudo guardar el PDF para Períodos/Portal: ${eSnap.message}` }
        : { tipo:'ok', texto:`✓ Período ${expSel.periodo} cerrado — ${distribucion.length} unidades — Total $${totalACobrar.toLocaleString('es-AR')}` })
      setPaso(4)

      // PDF de la liquidación: plantilla nativa Ley 14.701 (U2), con los datos guardados
      try {
        if (pdfWin) escribirLiquidacionNativa(pdfWin, construirHTMLLiquidacionNativa(pdfDatos))
      } catch (pdfErr) {
        console.warn('PDF generación error:', pdfErr)
        try { pdfWin?.close() } catch (_) {}
      }

      await cargar()

      // (U2) El PDF MIS EXPENSAS del cierre fue reemplazado por la plantilla nativa (arriba).

    } catch(e) {
      try { pdfWin?.close() } catch (_) {}
      setMsg({ tipo:'error', texto: 'Error: ' + e.message })
    }
    setProcesando(false)
  }

  const fmt  = (n) => '$' + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2 })
  const fmtD = (d) => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'
  const periodoLabel = (p) => {
    if (!p) return '—'
    const [y,m] = p.split('-')
    const mes = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    return m ? `${mes[parseInt(m)-1]} ${y}` : p
  }

  const CATEGORIAS_GASTO = [
    'sueldos','cargas_sociales','electricidad','agua','gas','contratos',
    'mantenimiento','seguros','honorarios_admin','gastos_bancarios',
    'impuesto_municipal','impuesto_provincial','varios','reintegros',
    'viaticos','peaje','estacionamiento',
  ]

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>📝 Liquidación de período</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Crear y cerrar la liquidación mensual de {consorcioActivo?.nombre}
      </div>

      {/* Indicador de pasos */}
      <div style={{ display:'flex', gap:0, marginBottom:24 }}>
        {[
          { n:1, l:'Período' },
          { n:2, l:'Gastos' },
          { n:3, l:'Distribución' },
          { n:4, l:'Cierre' },
        ].map((p, i) => (
          <div key={p.n} style={{ display:'flex', alignItems:'center', flex:1 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:1 }}>
              <div onClick={() => paso > p.n && setPaso(p.n)}
                style={{ width:32, height:32, borderRadius:'50%', display:'flex',
                  alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:13,
                  background: paso >= p.n ? AZ : '#f3f4f6',
                  color: paso >= p.n ? '#fff' : GR,
                  cursor: paso > p.n ? 'pointer' : 'default' }}>
                {paso > p.n ? '✓' : p.n}
              </div>
              <div style={{ fontSize:10, color: paso >= p.n ? AZ : GR,
                marginTop:4, fontWeight: paso === p.n ? 700 : 400 }}>{p.l}</div>
            </div>
            {i < 3 && <div style={{ height:2, flex:1, background: paso > p.n ? AZ : '#f3f4f6',
              marginBottom:18, marginTop:16 }} />}
          </div>
        ))}
      </div>

      <Msg data={msg} />

      {/* ── PASO 1: Seleccionar período ── */}
      {paso === 1 && (
        <div>
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>
              Seleccioná un período existente o creá uno nuevo
            </div>

            {/* Períodos abiertos */}
            {expensas.filter(e => e.estado === 'abierta' && e.tipo !== 'migracion').length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:12, color:GR, fontWeight:600, marginBottom:8,
                  textTransform:'uppercase', letterSpacing:'0.05em' }}>Períodos abiertos</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {expensas.filter(e => e.estado === 'abierta' && e.tipo !== 'migracion').map(exp => (
                    <div key={exp.id} onClick={() => seleccionarExpensa(exp)}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                        padding:'12px 16px', background:'#f0fdf4', border:'1px solid #86efac',
                        borderRadius:8, cursor:'pointer' }}>
                      <div>
                        <span style={{ fontWeight:700, fontSize:14 }}>{periodoLabel(exp.periodo)}</span>
                        <Badge text="Abierta" color={VD} bg='#dcfce7' style={{ marginLeft:8 }} />
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        {exp.total_gastos > 0 && (
                          <span style={{ fontSize:12, color:GR }}>Gastos: {fmt(exp.total_gastos)}</span>
                        )}
                        <Btn small style={{ background:VD, color:'#fff' }}>Continuar →</Btn>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Períodos cerrados recientes + migraciones */}
            {expensas.filter(e => e.estado === 'cerrada').length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:12, color:GR, fontWeight:600, marginBottom:8,
                  textTransform:'uppercase', letterSpacing:'0.05em' }}>Últimos períodos cerrados</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {expensas.filter(e => e.estado === 'cerrada').slice(0,5).map(exp => (
                    <div key={exp.id}
                      style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                        padding:'10px 14px', background:'#f8fafc', border:'1px solid #e5e7eb',
                        borderRadius:8 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2, flexWrap:'wrap' }}>
                          <span style={{ fontWeight:600, fontSize:13 }}>{periodoLabel(exp.periodo)}</span>
                          <Badge text={exp.tipo === 'migracion' ? 'migración' : 'Cerrada'} color={GR} bg='#f3f4f6' />
                          {exp.tipo === 'migracion' && <span style={{ fontSize:10, color:'#9ca3af' }}>🔒</span>}
                        </div>
                        <span style={{ fontSize:12,
                          color: parseFloat(exp.saldo_caja_final||0) >= 0 ? '#16a34a' : '#dc2626',
                          fontWeight:600 }}>
                          {parseFloat(exp.saldo_caja_final||0) !== 0
                            ? 'Saldo: ' + (parseFloat(exp.saldo_caja_final) > 0 ? '+' : '') + fmt(exp.saldo_caja_final)
                            : (exp.total_expensa > 0 ? 'Total: ' + fmt(exp.total_expensa) : '')}
                        </span>
                        <Btn small
                          onClick={(ev) => { ev.stopPropagation(); seleccionarExpensa(exp) }}
                          style={{ background:'#eff6ff', color:'#1A3FA0', border:'1px solid #bfdbfe', fontSize:11 }}>
                          🔍 Ver
                        </Btn>
                        {exp.tipo !== 'migracion' && <Btn small color="#dc2626" style={{ background:'#fff', color:'#dc2626', border:'1px solid #dc2626', fontSize:11 }}
                          title="Anular esta liquidación y dejar el período abierto para reliquidar"
                          onClick={async () => {
                            if (!window.confirm(
                              `¿Anular la liquidación de ${periodoLabel(exp.periodo)}?\n\n` +
                              `Se eliminarán los detalles por UF y los movimientos generados.\n` +
                              `El período quedará ABIERTO para una nueva liquidación.\n\n` +
                              `Los pagos ya registrados en Cobranzas NO se ven afectados.`
                            )) return
                            try {
                              await supabase.from('con_expensas_detalle').delete().eq('expensa_id', exp.id)
                              await supabase.from('con_movimientos_unidad').delete().eq('expensa_id', exp.id)
                              await supabase.from('con_expensas').update({
                                estado: 'abierta',
                                total_cobrado: 0,
                                saldo_caja_final: 0,
                              }).eq('id', exp.id)
                              await cargar()
                              setMsg({ tipo:'ok', texto:`✓ Liquidación de ${periodoLabel(exp.periodo)} anulada. El período quedó abierto.` })
                            } catch (err) {
                              setMsg({ tipo:'error', texto:'Error al anular: ' + err.message })
                            }
                          }}>🔄 Anular</Btn>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {consorcioActivo?.modelo_cc === 'historico' ? (
              <Msg data={{ tipo:'info', texto:'Consorcio en modo histórico: las liquidaciones se cargan desde Importar PDF/Excel, no desde aquí.' }} />
            ) : (
              <Btn onClick={nuevaExpensa} disabled={procesando}>
                {procesando ? '⏳' : '+ Crear nuevo período'}
              </Btn>
            )}
          </Card>
        </div>
      )}

      {/* ── PASO 2: Gastos ── */}
      {paso === 2 && expSel && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div>
              <span style={{ fontWeight:700, fontSize:14 }}>{periodoLabel(expSel.periodo)}</span>
              <span style={{ marginLeft:8, fontSize:12, color:GR }}>Gastos del período</span>
            </div>
            <Btn small onClick={() => setFormGasto({ fecha: hoy, categoria: planCuentas[0]?.categoria || 'varios' })}>
              + Gasto manual
            </Btn>
          </div>

          {/* ═══ PANEL: Importar desde Comprobantes ═══ */}
          <Card style={{ marginBottom:14, border:'1.5px solid #bae6fd', background:'#f0f9ff' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <div>
                <div style={{ fontWeight:700, color:AZ, fontSize:13 }}>📥 Importar desde Comprobantes de proveedores</div>
                <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                  Seleccioná los comprobantes del consorcio para incluirlos como gastos de este período
                </div>
              </div>
              <Btn small color={AZ} onClick={()=>cargarComprobantesImportables(expSel.id)} disabled={cargandoComps}>
                {cargandoComps ? '⏳' : '🔄 Actualizar'}
              </Btn>
            </div>

            {cargandoComps ? (
              <div style={{ textAlign:'center', padding:16, color:GR, fontSize:12 }}>Cargando comprobantes...</div>
            ) : compImportables.length === 0 ? (
              <div style={{ padding:'10px 12px', background:'#fff', borderRadius:8, fontSize:12, color:GR, textAlign:'center' }}>
                ✅ Todos los comprobantes del consorcio ya fueron importados a este período.
                <br/><span style={{ fontSize:11, marginTop:4, display:'block' }}>
                  Para agregar gastos sin comprobante use <strong>+ Gasto manual</strong>.
                </span>
              </div>
            ) : (
              <>
                {/* Leyenda estados */}
                <div style={{ display:'flex', gap:12, marginBottom:8, fontSize:11, flexWrap:'wrap' }}>
                  <label style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
                    <input type="checkbox"
                      checked={compImportables.length > 0 && compImportables.every(c=>compSeleccionados[c.id])}
                      onChange={e=>{
                        if(e.target.checked){const s={};compImportables.forEach(c=>s[c.id]=true);setCompSeleccionados(s)}
                        else setCompSeleccionados({})
                      }} />
                    <span style={{ fontWeight:600 }}>Seleccionar todos</span>
                  </label>
                  <span style={{ color:AM }}>🟡 Pre-seleccionados = pendientes de pago</span>
                  <span style={{ color:VD }}>🟢 Pagados = se incluyen como gasto del período igual</span>
                </div>
                <div style={{ maxHeight:260, overflowY:'auto', display:'flex', flexDirection:'column', gap:4, marginBottom:10 }}>
                  {compImportables.map(c=>{
                    // Resolver nombre del proveedor desde la prop proveedores que ya tiene el componente
                    // (proveedores no se pasa como prop acá, usamos consorcioId directamente)
                    const selec = !!compSeleccionados[c.id]
                    const vencido = c.fecha_vencimiento && c.fecha_vencimiento < hoy && c.estado !== 'pagado'
                    const estadoColor = {
                      pendiente: { c:AM, bg:'#fef9c3' },
                      pagado_parcial: { c:'#7c3aed', bg:'#ede9fe' },
                      pagado: { c:VD, bg:'#dcfce7' },
                    }[c.estado] || { c:GR, bg:'#f3f4f6' }
                    return (
                      <div key={c.id} onClick={()=>setCompSeleccionados(s=>({...s,[c.id]:!s[c.id]}))}
                        style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px',
                          background: selec?'#dbeafe':'#fff', borderRadius:7, cursor:'pointer',
                          border: selec?'1.5px solid #93c5fd':'1px solid #e5e7eb',
                          transition:'background 0.1s, border 0.1s' }}>
                        <input type="checkbox" checked={selec} readOnly style={{ flexShrink:0, cursor:'pointer' }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                            <span style={{ fontWeight:700, fontSize:12 }}>{c.proveedor_nombre_resuelto || c.proveedor_id}</span>
                            <span style={{ fontSize:10, color:GR, textTransform:'capitalize', background:'#f3f4f6', borderRadius:3, padding:'1px 5px' }}>
                              {c.tipo} {c.numero||''}
                            </span>
                            {vencido && <span style={{ fontSize:10, color:RJ, fontWeight:700 }}>⚠ VENCIDO</span>}
                          </div>
                          <div style={{ fontSize:12, color:'#374151', marginTop:1 }}>{c.concepto}</div>
                          {c.fecha && <div style={{ fontSize:10, color:GR }}>
                            {new Date(c.fecha+'T00:00:00').toLocaleDateString('es-AR')}
                            {c.fecha_vencimiento ? ` · Vto: ${new Date(c.fecha_vencimiento+'T00:00:00').toLocaleDateString('es-AR')}` : ''}
                          </div>}
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <div style={{ fontWeight:800, fontSize:13, color:selec?AZ:'#374151' }}>
                            {fmt(c.monto_total)}
                          </div>
                          <div style={{ fontSize:9, color:estadoColor.c, fontWeight:700,
                            background:estadoColor.bg, borderRadius:4, padding:'1px 5px', marginTop:2 }}>
                            {c.estado==='pagado_parcial'?'PARCIAL':c.estado.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Botón importar con total */}
                {Object.values(compSeleccionados).filter(Boolean).length > 0 && (
                  <div style={{ display:'flex', gap:8, alignItems:'center', padding:'8px 0', borderTop:'1px solid #bae6fd' }}>
                    <Btn color={AZ} onClick={importarComprobantes}>
                      📥 Importar {Object.values(compSeleccionados).filter(Boolean).length} comprobante{Object.values(compSeleccionados).filter(Boolean).length!==1?'s':''}
                      {' · '}{fmt(compImportables.filter(c=>compSeleccionados[c.id]).reduce((a,c)=>a+parseFloat(c.monto_total||0),0))}
                    </Btn>
                    <span style={{ fontSize:11, color:GR }}>
                      {Object.values(compSeleccionados).filter(Boolean).length} de {compImportables.length} seleccionado{Object.values(compSeleccionados).filter(Boolean).length!==1?'s':''}
                    </span>
                  </div>
                )}
                {Object.values(compSeleccionados).filter(Boolean).length === 0 && (
                  <div style={{ fontSize:11, color:GR, padding:'6px 0' }}>
                    Hacé clic en un comprobante para seleccionarlo · {compImportables.length} comprobante{compImportables.length!==1?'s':''} disponible{compImportables.length!==1?'s':''}
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Formulario gasto manual */}
          {formGasto && (
            <Card style={{ marginBottom:12, border:'1.5px solid #bae6fd' }}>
              <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>
                {formGasto.id ? 'Editar gasto' : '✏ Gasto manual (sin comprobante)'}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:10, marginBottom:10 }}>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:3, fontWeight:500 }}>Concepto *</div>
                  <input value={formGasto.concepto||''} placeholder="Descripción del gasto"
                    onChange={e=>setFormGasto(f=>({...f,concepto:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', border:'1px solid #d1d5db',
                      borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:3, fontWeight:500 }}>Monto *</div>
                  <input type="number" min="0" step="0.01" value={formGasto.monto||''}
                    onChange={e=>setFormGasto(f=>({...f,monto:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', border:'1px solid #d1d5db',
                      borderRadius:7, fontSize:13, fontWeight:700, boxSizing:'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:3, fontWeight:500 }}>Fecha</div>
                  <input type="date" value={formGasto.fecha||hoy}
                    onChange={e=>setFormGasto(f=>({...f,fecha:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', border:'1px solid #d1d5db',
                      borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:3, fontWeight:500 }}>Rubro</div>
                  <select value={formGasto.categoria||'varios'}
                    onChange={e=>setFormGasto(f=>({...f,categoria:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', border:'1px solid #d1d5db',
                      borderRadius:7, fontSize:13, background:'#fff' }}>
                    {planCuentas.length > 0 ? (
                      [...new Set(planCuentas.map(c=>c.categoria))].map(cat => (
                        <option key={cat} value={cat}>{cat.replace(/_/g,' ')}</option>
                      ))
                    ) : CATEGORIAS_GASTO.map(c => (
                      <option key={c} value={c}>{c.replace(/_/g,' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:3, fontWeight:500 }}>Proveedor</div>
                  <input value={formGasto.proveedor_nombre||''} placeholder="Opcional"
                    onChange={e=>setFormGasto(f=>({...f,proveedor_nombre:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', border:'1px solid #d1d5db',
                      borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                </div>
              </div>
              {esCategoriaMF(formGasto.categoria) && (
                <div style={{ background:'#faf5ff', border:'1px solid #e9d5ff', borderRadius:7, padding:'10px 12px', marginBottom:12 }}>
                  <div style={{ fontSize:12, color:'#7c3aed', fontWeight:600, marginBottom:4 }}>Gasto particular — UF destino *</div>
                  <select value={formGasto.unidad_id||''}
                    onChange={e=>setFormGasto(f=>({...f,unidad_id:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', border:'1px solid #d8b4fe', borderRadius:7, fontSize:13, background:'#fff' }}>
                    <option value="">— Seleccioná la UF —</option>
                    {[...unidades].sort((a,b)=>{
                      const na = parseInt(String(a.nro_uf_pdf ?? a.numero ?? '').replace(/\D/g,''))||0
                      const nb = parseInt(String(b.nro_uf_pdf ?? b.numero ?? '').replace(/\D/g,''))||0
                      return na - nb
                    }).map(u=>(
                      <option key={u.id} value={u.id}>{(u.nro_uf_pdf||u.numero_interno||u.numero||u.id)}{u.numero?` — ${u.numero}`:''}</option>
                    ))}
                  </select>
                  <div style={{ fontSize:10, color:'#9333ea', marginTop:4 }}>Se carga 100% a la UF elegida (no se prorratea).</div>
                </div>
              )}
              <div style={{ display:'flex', gap:8 }}>
                <Btn onClick={guardarGasto}>✓ Guardar</Btn>
                <BtnSec onClick={()=>{setFormGasto(null);setMsg(null)}}>Cancelar</BtnSec>
              </div>
            </Card>
          )}

          {/* Resumen gastos por rubro */}
          {gastos.length > 0 && (() => {
            const porRubro = {}
            for (const g of gastos) {
              porRubro[g.categoria||'varios'] = (porRubro[g.categoria||'varios']||0) + (parseFloat(g.monto)||0)
            }
            return (
              <Card style={{ marginBottom:12, background:'#f8fafc' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <div style={{ fontWeight:600, fontSize:13 }}>Resumen por rubro</div>
                  <div style={{ fontWeight:800, fontSize:16, color:AZ }}>Total: {fmt(totalGastos)}</div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                  {Object.entries(porRubro).sort((a,b)=>b[1]-a[1]).map(([cat,monto]) => (
                    <div key={cat} style={{ display:'flex', justifyContent:'space-between',
                      padding:'5px 8px', background:'#fff', borderRadius:6 }}>
                      <span style={{ fontSize:12, color:GR, textTransform:'capitalize' }}>
                        {cat.replace(/_/g,' ')}
                      </span>
                      <span style={{ fontSize:12, fontWeight:600 }}>{fmt(monto)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )
          })()}

          {/* Tabla de gastos */}
          <Card style={{ marginBottom:12 }}>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['Fecha','Rubro','Concepto','Proveedor','Origen','Monto',''].map((h,i) => (
                      <th key={i} style={{ padding:'6px 10px', textAlign:i===5?'right':'left',
                        fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gastos.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding:20, textAlign:'center', color:GR }}>
                      Sin gastos cargados. Importá comprobantes arriba o agregá un gasto manual.
                    </td></tr>
                  ) : gastos.map(g => (
                    <tr key={g.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'6px 10px', color:GR, fontSize:11 }}>
                        {g.fecha ? new Date(g.fecha+'T00:00:00').toLocaleDateString('es-AR') : '—'}
                      </td>
                      <td style={{ padding:'6px 10px' }}>
                        <Badge text={g.categoria?.replace(/_/g,' ')||'varios'}
                          color={AZ} bg='#eff6ff' />
                      </td>
                      <td style={{ padding:'6px 10px' }}>{g.concepto}</td>
                      <td style={{ padding:'6px 10px', color:GR, fontSize:11 }}>{g.proveedor_nombre||'—'}</td>
                      <td style={{ padding:'6px 10px' }}>
                        {g.comprobante_id
                          ? <span style={{ fontSize:10, background:'#dbeafe', color:'#1e40af', borderRadius:4, padding:'1px 6px', fontWeight:600 }}>📄 Comprobante</span>
                          : <span style={{ fontSize:10, background:'#f3f4f6', color:GR, borderRadius:4, padding:'1px 6px' }}>✏ Manual</span>
                        }
                      </td>
                      <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:700 }}>{fmt(g.monto)}</td>
                      <td style={{ padding:'6px 10px' }}>
                        <div style={{ display:'flex', gap:4 }}>
                          {!g.comprobante_id && (
                            <Btn small onClick={()=>setFormGasto({...g})}
                              style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                          )}
                          <Btn small onClick={()=>eliminarGasto(g.id)}
                            style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {gastos.length > 0 && (
                  <tfoot>
                    <tr style={{ background:'#f0f4ff', borderTop:'2px solid #1A3FA0' }}>
                      <td colSpan={5} style={{ padding:'8px 10px', fontWeight:700, color:AZ }}>
                        Total gastos del período
                      </td>
                      <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:800, fontSize:15, color:AZ }}>
                        {fmt(totalGastos)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          {gastos.length > 0 && (
            <div style={{ display:'flex', gap:8 }}>
              <Btn onClick={() => { inicializarImportesPorColumna(); setPaso(3) }}>Continuar → Distribución</Btn>
              <BtnSec onClick={() => setPaso(1)}>← Volver</BtnSec>
            </div>
          )}
        </div>
      )}

      {/* ── PASO 3: Distribución ── */}
      {paso === 3 && (
        <div>
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>
              Configurar distribución — {periodoLabel(expSel?.periodo)}
            </div>

            {/* Monto a cobrar — por columna si hay múltiples columnas configuradas */}
            {(() => {
              const colsActivas = columnasLiq.filter(c => c.activo)
              const tieneMultiCol = colsActivas.length > 1

              if (tieneMultiCol && Object.keys(importesPorColumna).length > 0) {
                // ── UI MULTICOL: una fila por columna ──────────────────────────────
                const totalColumnas = Object.values(importesPorColumna).reduce((a,c) => a + (parseFloat(c.monto)||0), 0)
                return (
                  <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'14px 16px', marginBottom:14 }}>
                    <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>
                      Importes a distribuir por columna
                    </div>
                    <div style={{ fontSize:11, color:'#1e40af', marginBottom:10 }}>
                      Cada columna tiene su propio coeficiente. El importe es el total de gastos asignados a esa columna —
                      podés modificarlo (ej: para incluir fondo de reserva o ajuste).
                    </div>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, marginBottom:8 }}>
                      <thead>
                        <tr style={{ background:'#dbeafe' }}>
                          <th style={{ padding:'7px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:AZ }}>Columna</th>
                          <th style={{ padding:'7px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:AZ }}>Coeficiente</th>
                          <th style={{ padding:'7px 10px', textAlign:'right', fontSize:11, fontWeight:700, color:AZ }}>Gastos calculados</th>
                          <th style={{ padding:'7px 10px', textAlign:'right', fontSize:11, fontWeight:700, color:AZ }}>Importe a distribuir</th>
                          <th style={{ padding:'7px 10px', textAlign:'center', fontSize:11, fontWeight:700, color:AZ }}>Usar calculado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {colsActivas.map(col => {
                          const estado = importesPorColumna[col.codigo] || { monto:0, usar_total:true }
                          const gastosCol = (() => {
                            const gruposOrd = [...gruposLiq].sort((a,b) => a.numero - b.numero)
                            return gastos.reduce((acc, g) => {
                              const grp = gruposOrd.find(gr => gr.categorias?.includes(g.categoria))
                              const cols = resolverCodigosColumna(grp?.columnas_coef?.length > 0 ? grp.columnas_coef : [colsActivas[0]?.codigo], colsActivas)
                              if (cols.includes(col.codigo)) acc += (parseFloat(g.monto)||0) / cols.length
                              return acc
                            }, 0)
                          })()
                          const esMF = (col.tipo || estado.tipo) === 'monto_fijo'
                          if (esMF) {
                            // Columna monto_fijo: el importe = suma de gastos particulares (no editable,
                            // no se prorratea). Se asigna 100% a la UF destino de cada gasto.
                            const nUf = Object.keys(estado.por_uf || {}).length
                            return (
                              <tr key={col.codigo} style={{ borderBottom:'1px solid #e5e7eb', background:'#faf5ff' }}>
                                <td style={{ padding:'8px 10px', fontWeight:700, color:'#7c3aed' }}>{col.nombre}</td>
                                <td style={{ padding:'8px 10px', fontSize:11, color:'#7c3aed', fontWeight:600 }}>Monto fijo · por UF</td>
                                <td style={{ padding:'8px 10px', textAlign:'right', color:GR }}>{fmt(Math.round(estado.monto||0))}</td>
                                <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, color:'#7c3aed' }}>{fmt(Math.round(estado.monto||0))}</td>
                                <td style={{ padding:'8px 10px', textAlign:'center', fontSize:11, color:GR }}>{nUf} UF</td>
                              </tr>
                            )
                          }
                          return (
                            <tr key={col.codigo} style={{ borderBottom:'1px solid #e5e7eb' }}>
                              <td style={{ padding:'8px 10px', fontWeight:700, color:AZ }}>{col.nombre}</td>
                              <td style={{ padding:'8px 10px', fontSize:11, color:GR }}>{(col.campo_coef||'porcentaje_fiscal').replace('porcentaje_fiscal','Coef. fiscal').replace('pct_gtos_grales','Gtos. grales').replace('pct_fdo_obras','Fdo. obras').replace('pct_cochera','Cochera')}</td>
                              <td style={{ padding:'8px 10px', textAlign:'right', color:GR }}>{fmt(Math.round(gastosCol))}</td>
                              <td style={{ padding:'8px 10px', textAlign:'right' }}>
                                <input
                                  type="number" min="0" step="1"
                                  value={estado.monto || ''}
                                  onChange={e => setImportesPorColumna(prev => ({
                                    ...prev,
                                    [col.codigo]: { ...prev[col.codigo], monto: parseFloat(e.target.value)||0, usar_total: false }
                                  }))}
                                  style={{ width:140, padding:'6px 10px', border:'1px solid #93c5fd',
                                    borderRadius:7, fontSize:13, fontWeight:700, textAlign:'right' }}
                                />
                              </td>
                              <td style={{ padding:'8px 10px', textAlign:'center' }}>
                                <input type="checkbox" checked={!!estado.usar_total}
                                  onChange={e => setImportesPorColumna(prev => ({
                                    ...prev,
                                    [col.codigo]: {
                                      ...prev[col.codigo],
                                      monto: e.target.checked ? Math.round(gastosCol) : prev[col.codigo]?.monto,
                                      usar_total: e.target.checked
                                    }
                                  }))} />
                              </td>
                            </tr>
                          )
                        })}
                        <tr style={{ background:'#f0f4ff', borderTop:'2px solid '+AZ }}>
                          <td colSpan={3} style={{ padding:'8px 10px', fontWeight:700, color:AZ }}>Total a distribuir</td>
                          <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:800, fontSize:15, color:AZ }}>{fmt(totalColumnas)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )
              }

              // ── UI UNICOL: comportamiento original ─────────────────────────────
              return (
                <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8,
                  padding:'14px 16px', marginBottom:14 }}>
                  <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>
                    Importe a distribuir
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
                      <input type="radio" checked={config.usar_total_gastos}
                        onChange={()=>setConfig(c=>({...c,usar_total_gastos:true}))} />
                      Igual a total de gastos <strong style={{marginLeft:4}}>{fmt(totalGastos)}</strong>
                    </label>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
                      <input type="radio" checked={!config.usar_total_gastos}
                        onChange={()=>setConfig(c=>({...c,usar_total_gastos:false}))} />
                      Importe personalizado:
                    </label>
                    {!config.usar_total_gastos && (
                      <input type="number" min="0" step="0.01"
                        value={config.total_a_cobrar}
                        onChange={e=>setConfig(c=>({...c,total_a_cobrar:e.target.value}))}
                        placeholder="ej: 800000"
                        style={{ width:160, padding:'6px 10px', border:'1px solid #93c5fd',
                          borderRadius:7, fontSize:13, fontWeight:700 }} />
                    )}
                  </div>
                  <div style={{ fontSize:11, color:'#1e40af', marginTop:8 }}>
                    Puede ser mayor a los gastos para incluir fondo de reserva o redondeo.
                  </div>
                </div>
              )
            })()}

            {/* Vencimientos */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:14 }}>
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>
                  Día 1er vencimiento
                </div>
                <input type="number" min="1" max="31" value={config.vto1_dia}
                  onChange={e=>setConfig(c=>({...c,vto1_dia:parseInt(e.target.value)||10}))}
                  style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                    borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>
                  Día 2do vencimiento
                </div>
                <input type="number" min="1" max="31" value={config.vto2_dia}
                  onChange={e=>setConfig(c=>({...c,vto2_dia:parseInt(e.target.value)||20}))}
                  style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                    borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>
                  % recargo 2do vto
                </div>
                <input type="number" min="0" step="0.1" value={config.pct_mora_vto2}
                  onChange={e=>setConfig(c=>({...c,pct_mora_vto2:parseFloat(e.target.value)||0}))}
                  style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db',
                    borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
              </div>
            </div>

            <div style={{ marginBottom:14, background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:7, padding:'8px 12px', fontSize:12, color:'#0369a1' }}>
              💡 <strong>Redondeo automático:</strong> Cada UF lleva en los centavos su número de identificación (UF 1 → ,01 — UF 25 → ,25). Esto permite identificar automáticamente los pagos bancarios. La diferencia se registra como redondeo en la cuenta corriente de cada UF.
            </div>
            {parseFloat(consorcioActivo?.interes_mora || 0) > 0 && (
              <div style={{ marginBottom:14, background:'#fff8f0', border:'1px solid #fed7aa', borderRadius:7, padding:'8px 12px', fontSize:12, color:'#92400e' }}>
                🏦 <strong>Interés por mora:</strong> Se aplicará <strong>{consorcioActivo.interes_mora}% mensual</strong> sobre el saldo deudor de la liquidación anterior. UFs sin deuda: sin interés.
              </div>
            )}

            <Btn onClick={calcularDistribucion}>⚡ Calcular distribución</Btn>
          </Card>

          {/* ═══ PANEL: Notas del período ═══ */}
          <Card style={{ marginBottom:16, border:'1px solid #e5e7eb' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:13, color:'#374151' }}>📋 Notas del período</div>
                <div style={{ fontSize:11, color:GR, marginTop:2 }}>
                  Texto que aparece en la página de notas del PDF. Editá o personalizá para esta liquidación.
                </div>
              </div>
              <Btn small color={VD} onClick={guardarNotas} disabled={cargandoNotas}>
                {cargandoNotas ? '⏳' : '💾 Guardar notas'}
              </Btn>
            </div>
            <textarea
              value={notasPeriodo}
              onChange={e => setNotasPeriodo(e.target.value)}
              rows={8}
              placeholder={`COMUNICAMOS A LOS SRES PROPIETARIOS/INQUILINOS QUE LOS PAGOS QUE NO SE REALICEN ANTES DE LOS DIAS 28 DE CADA MES, NO PODRAN SER ACREDITADOS EN TIEMPO Y FORMA POR CUESTIONES OPERATIVAS.

SOLICITAMOS CANCELAR LAS EXPENSAS ANTES DE LA MENCIONADA FECHA, EVITANDO RECARGOS O INCONVENIENTES FUTUROS.

ATENCION OFICINA
UBICACION: LENGUADO N° 1313 LOCAL 3 (ENTRE SHAW Y ENEAS)
HORARIO: LUNES A SABADOS DE 9:00 A 13:00 HORAS
TELEFONOS: 02267-516386 / 2267444034

RECOMENDAMOS HACER USO DE TRANSFERENCIAS BANCARIAS...`}
              style={{ width:'100%', padding:'10px 12px', border:'1px solid #d1d5db',
                borderRadius:7, fontSize:12, fontFamily:'inherit', resize:'vertical',
                boxSizing:'border-box', lineHeight:1.6, color:'#374151' }} />
            <div style={{ fontSize:11, color:GR, marginTop:6 }}>
              Si está vacío, se usará el texto predeterminado de comunicación a propietarios. Podés agregar información especial del período (obras, cambios de cuenta, anuncios, etc.)
            </div>
          </Card>
          {distribucion.length > 0 && (
            <>
              <Card style={{ marginBottom:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <div style={{ fontWeight:600, fontSize:13 }}>
                    Estado de cuentas y prorrateo — {distribucion.length} UFs
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <Btn small color='#6b7280' onClick={vistaPrevia}>🖨️ Vista previa</Btn>
                  </div>
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                    <thead>
                      <tr style={{ background:'#2e4057' }}>
                        {['UF','Propietario','Sal. Ant.','Pagos Ant.','Deuda','Interés','%','1er Vto',
                            ...(columnasLiq.filter(c=>c.activo).length > 1
                              ? columnasLiq.filter(c=>c.activo).map(c=>c.nombre)
                              : ['Expensa']),
                            'Redondeo','Total','2do Vto','Con Recargo'].map((h,i) => (
                          <th key={i} style={{ padding:'5px 8px', textAlign:i>=2&&i!==7?'right':'left',
                            fontSize:10, fontWeight:700, color:'#fff', whiteSpace:'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {distribucion.map((d,i) => (
                        <tr key={d.unidad_id} style={{ borderBottom:'1px solid #e5e7eb',
                          background: i%2===0 ? 'transparent' : '#f8fafc' }}>
                          <td style={{ padding:'5px 8px', fontWeight:700, color:AZ }}>{d.numero_uf}</td>
                          <td style={{ padding:'5px 8px', fontSize:11 }}>{d.propietario}</td>
                          <td style={{ padding:'5px 8px', textAlign:'right', color:d.saldo_anterior>0?RJ:GR, fontSize:10 }}>
                            {d.saldo_anterior!==0 ? fmt(d.saldo_anterior) : '—'}
                          </td>
                          <td style={{ padding:'5px 8px', textAlign:'right', color:GR, fontSize:10 }}>
                            {d.pagos_anterior>0 ? fmt(d.pagos_anterior) : '—'}
                          </td>
                          <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:d.deuda>0?700:400, color:d.deuda>0?RJ:GR, fontSize:10 }}>
                            {(d.deuda>0.005 || Math.abs(d.deuda-(d.saldo_anterior||0))>0.005) ? fmt(d.deuda) : '—'}
                          </td>
                          <td style={{ padding:'5px 8px', textAlign:'right',
                            fontWeight: d.interes_mora>0?700:400,
                            color: d.interes_mora>0?AM:GR, fontSize:10 }}>
                            {d.interes_mora>0 ? fmt(d.interes_mora) : '—'}
                          </td>
                          <td style={{ padding:'5px 8px', textAlign:'right', color:GR, fontSize:10 }}>{d.pct}%</td>
                          <td style={{ padding:'5px 8px', fontSize:10, color:GR, whiteSpace:'nowrap' }}>{fmtD(d.vto1)}</td>
                          {columnasLiq.filter(c=>c.activo).length > 1
                            ? columnasLiq.filter(c=>c.activo).map(col => (
                                <td key={col.codigo} style={{ padding:'5px 8px', textAlign:'right', fontWeight:600,
                                  color:d.aporte_por_columna?.[col.codigo]>0?AZ:GR }}>
                                  {d.aporte_por_columna?.[col.codigo] > 0 ? fmt(d.aporte_por_columna[col.codigo]) : '—'}
                                </td>
                              ))
                            : <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:700, color:AZ }}>
                                {fmt(d.expensa_base)}
                              </td>
                          }
                          <td style={{ padding:'5px 8px', textAlign:'right', fontSize:10, color:'#9ca3af' }}>
                            {fmt(d.redondeo)}
                          </td>
                          <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:800, color:AZ, fontSize:12 }}>
                            {fmt(d.monto)}
                          </td>
                          <td style={{ padding:'5px 8px', fontSize:10, color:GR, whiteSpace:'nowrap' }}>{fmtD(d.vto2)}</td>
                          <td style={{ padding:'5px 8px', textAlign:'right', color:AM, fontWeight:600 }}>
                            {fmt(d.monto_vto2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background:'#0d2b3e', color:'#fff' }}>
                        <td colSpan={2} style={{ padding:'6px 8px', fontWeight:700, fontSize:11 }}>TOTAL</td>
                        <td style={{ padding:'6px 8px', textAlign:'right', fontSize:10 }}>{fmt(distribucion.reduce((a,d)=>a+d.saldo_anterior,0))}</td>
                        <td style={{ padding:'6px 8px', textAlign:'right', fontSize:10 }}>{fmt(distribucion.reduce((a,d)=>a+d.pagos_anterior,0))}</td>
                        <td style={{ padding:'6px 8px', textAlign:'right', fontSize:10 }}>{fmt(distribucion.reduce((a,d)=>a+d.deuda,0))}</td>
                        <td style={{ padding:'6px 8px', textAlign:'right', fontSize:10, color:'#fed7aa' }}>
                          {fmt(distribucion.reduce((a,d)=>a+(d.interes_mora||0),0))}
                        </td>
                        <td style={{ padding:'6px 8px', textAlign:'right', fontSize:10 }}>100%</td>
                        <td />
                        {columnasLiq.filter(c=>c.activo).length > 1
                          ? columnasLiq.filter(c=>c.activo).map(col => (
                              <td key={col.codigo} style={{ padding:'6px 8px', textAlign:'right', fontWeight:700, fontSize:12 }}>
                                {fmt(distribucion.reduce((a,d)=>a+(d.aporte_por_columna?.[col.codigo]||0),0))}
                              </td>
                            ))
                          : <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:800, fontSize:13 }}>
                              {fmt(distribucion.reduce((a,d)=>a+d.expensa_base,0))}
                            </td>
                        }
                        <td style={{ padding:'6px 8px', textAlign:'right', fontSize:10 }}>{fmt(distribucion.reduce((a,d)=>a+d.redondeo,0))}</td>
                        <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:800, fontSize:14 }}>{fmt(distribucion.reduce((a,d)=>a+d.monto,0))}</td>
                        <td />
                        <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:700 }}>{fmt(distribucion.reduce((a,d)=>a+d.monto_vto2,0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Nota sobre el redondeo */}
                <div style={{ marginTop:10, fontSize:11, color:'#6b7280', background:'#f9fafb', padding:'8px 12px', borderRadius:6 }}>
                  💡 <strong>Redondeo con identificación de UF:</strong> El total incluye centavos que identifican cada unidad (UF 1 → ,01 · UF 2 → ,02 · etc.). Esto facilita la imputación automática de pagos bancarios.
                </div>
              </Card>

              <div style={{ display:'flex', gap:8 }}>
                <Btn onClick={vistaPrevia} color='#6b7280'>🖨️ Vista previa completa</Btn>
                <Btn onClick={confirmarYCerrar} disabled={procesando}
                  style={{ background:VD, color:'#fff' }}>
                  {procesando ? '⏳ Cerrando período...' : '🔒 Confirmar y cerrar período'}
                </Btn>
                <BtnSec onClick={() => setPaso(2)}>← Revisar gastos</BtnSec>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── PASO 4: Listo ── */}
      {paso === 4 && (
        <Card style={{ textAlign:'center', padding:48 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
          <div style={{ fontWeight:700, fontSize:20, color:VD, marginBottom:8 }}>
            Período {periodoLabel(expSel?.periodo)} cerrado
          </div>
          <div style={{ fontSize:13, color:GR, marginBottom:24 }}>
            Se generaron {distribucion.length} comprobantes individuales.
            Ya puede registrar cobranzas y enviar las liquidaciones por email.
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap', marginBottom:24 }}>
            <Btn onClick={() => setPagina('cobranzas')}>💳 Ir a Cobranzas</Btn>
            <Btn onClick={() => setPagina('emails')}
              style={{ background:'#7c3aed', color:'#fff' }}>✉️ Enviar liquidaciones</Btn>
            <BtnSec onClick={() => { setPaso(1); setExpSel(null); setGastos([]); setDistribucion([]); setMsg(null) }}>
              + Nuevo período
            </BtnSec>
          </div>
          {/* Anular liquidación */}
          <div style={{ borderTop:'1px solid #fee2e2', paddingTop:20 }}>
            <div style={{ fontSize:12, color:'#b91c1c', fontWeight:600, marginBottom:6 }}>
              ¿Hay un error? Puede anular esta liquidación y practicar una nueva.
            </div>
            <div style={{ fontSize:11, color:GR, marginBottom:12 }}>
              La anulación elimina los detalles por UF y los movimientos generados, y devuelve el período al estado <em>abierto</em>.
              Los pagos ya registrados en Cobranzas no se ven afectados.
            </div>
            <Btn color="#dc2626" style={{ background:'#dc2626', color:'#fff' }} onClick={async () => {
              if (!window.confirm('¿Confirma la anulación de la liquidación del período ' + expSel?.periodo + '?\nEsta acción no se puede deshacer.')) return
              try {
                setProcesando(true)
                // 1. Borrar detalles UF
                await supabase.from('con_expensas_detalle').delete().eq('expensa_id', expSel?.id)
                // 2. Borrar movimientos generados en este período
                await supabase.from('con_movimientos_unidad').delete().eq('expensa_id', expSel?.id)
                // 3. Revertir expensa a abierta
                await supabase.from('con_expensas').update({
                  estado: 'abierta',
                  total_cobrado: 0,
                  saldo_caja_final: 0
                }).eq('id', expSel?.id)
                // 4. Reset UI
                await cargar()
                setPaso(1)
                setDistribucion([])
                setMsg({ tipo:'ok', texto:'✓ Liquidación anulada. El período quedó en estado abierto para una nueva liquidación.' })
              } catch(err) {
                setMsg({ tipo:'error', texto:'Error al anular: ' + err.message })
              } finally {
                setProcesando(false)
              }
            }}>🔄 Anular liquidación y volver a empezar</Btn>
          </div>
        </Card>
      )}
    </div>
  )
}
