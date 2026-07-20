import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function LiquidacionPeriodo() {
  const { session, cargando, esSuperAdmin, consorcios, setConsorcios, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, expensas, setExpensas, proveedores, setProveedores, adminPerfil, setAdminPerfil, formCon, setFormCon, msgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio, pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, navItems, secciones, navActivo } = useApp()
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
      // 1. Obtener IDs ya importados como gastos en esta expensa
      const { data: gastosExist } = await supabase.from('con_gastos')
        .select('comprobante_id').eq('expensa_id', eid).not('comprobante_id','is',null)
      const idsYaImportados = new Set((gastosExist||[]).map(g=>g.comprobante_id))

      // 2. Traer TODOS los comprobantes del consorcio (sin join para evitar problemas RLS)
      const { data: comps, error } = await supabase
        .from('con_comprobantes_proveedor')
        .select('id, proveedor_id, tipo, numero, concepto, monto_total, saldo_pendiente, estado, fecha, fecha_vencimiento, notas')
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
    const seleccionados = compImportables.filter(c => compSeleccionados[c.id])
    if (seleccionados.length === 0) return setMsg({ tipo:'warn', texto:'Seleccioná al menos un comprobante para importar' })

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
      return {
        id: `GAS-IMP-${c.id}`,
        admin_id: session.user.id,
        consorcio_id: consorcioId,
        expensa_id: expSel.id,
        comprobante_id: c.id,
        proveedor_id: c.proveedor_id || null,
        fecha: c.fecha || hoy,
        concepto: c.concepto || `${c.tipo||''} ${c.numero||''}`.trim() || 'Sin concepto',
        categoria: CAT_MAP[prov?.rubro || c.proveedor_rubro] || 'varios',
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
    // Calcular próximo período
    const hoyDate = new Date()
    const mes     = String(hoyDate.getMonth() + 1).padStart(2,'0')
    const periodo = `${hoyDate.getFullYear()}-${mes}`

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
    if (!formGasto?.concepto?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el concepto' })
    if (!formGasto?.monto || parseFloat(formGasto.monto) <= 0) return setMsg({ tipo:'warn', texto:'Ingresá el monto' })

    const payload = {
      admin_id: session.user.id,
      consorcio_id: consorcioId,
      expensa_id: expSel.id,
      fecha: formGasto.fecha || hoy,
      concepto: formGasto.concepto.trim(),
      categoria: formGasto.categoria || 'varios',
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

    // Calcular total de gastos por columna según grupos de liquidación
    const totalesPorCol = {}
    colsActivas.forEach(col => { totalesPorCol[col.codigo] = 0 })

    gastos.forEach(g => {
      // Buscar a qué columnas pertenece este gasto según los grupos de liquidación
      const grp = gruposOrdenados.find(gr => gr.categorias?.includes(g.categoria))
      const colsCodigos = grp?.columnas_coef?.length > 0
        ? grp.columnas_coef
        : [colsActivas[0]?.codigo]   // fallback: primera columna activa
      const monto = parseFloat(g.monto) || 0
      // IMPORTANTE: el gasto va completo a CADA columna indicada.
      // Si un gasto de electricidad figura en [EXPENSAS_A, SUB_2DO], significa
      // que AMBAS columnas lo incluyen para el prorrateo por su coeficiente.
      // No se divide el monto; cada columna lo prorratea independientemente.
      colsCodigos.forEach(cc => {
        if (totalesPorCol[cc] !== undefined) totalesPorCol[cc] += monto
      })
    })

    // Construir estado: { [codigo]: { monto: number, usar_total: true } }
    const nuevoEstado = {}
    colsActivas.forEach(col => {
      nuevoEstado[col.codigo] = {
        nombre: col.nombre,
        campo_coef: col.campo_coef || 'porcentaje_fiscal',
        monto: Math.round(totalesPorCol[col.codigo] || 0),
        usar_total: true,   // si true: usa el total calculado; si false: editable manualmente
      }
    })
    setImportesPorColumna(nuevoEstado)
  }

  async function calcularDistribucion() {
    // Resetear valores financieros al inicio del cálculo
    setCobradoActual(0)
    setSaldoCajaAnterior(0)
    setCobradoPeriodoAnt(0)

    const colsActivas = columnasLiq.filter(c => c.activo)
    const tieneMultiCol = colsActivas.length > 1

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
      .select('id, saldo_caja_final, total_cobrado').eq('consorcio_id', consorcioId)
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
      if ((lufAnt||[]).length > 0) {
        // Período anterior histórico (importado): el saldo al cierre es total_uf (conserva saldo a favor)
        for (const l of lufAnt) {
          const pagosUF = cobranzasPorUF[l.unidad_id] || (parseFloat(l.pagos)||0)
          saldosAnt[l.unidad_id] = { saldo: parseFloat(l.total_uf)||0, pagos: pagosUF }
          totalCobradoAnt += pagosUF
        }
      } else if ((detsAnt||[]).length > 0) {
        // Período anterior nativo: reconstruir desde el detalle (SIN Math.max → conserva saldo a favor)
        for (const d of detsAnt) {
          const pagosUF = cobranzasPorUF[d.unidad_id] || (parseFloat(d.pagos_periodo)||0)
          const saldo =
            (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0) +
            (parseFloat(d.interes_mora)||0) - pagosUF
          saldosAnt[d.unidad_id] = { saldo, pagos: pagosUF }
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
      const deuda = Math.max(0, saldo_anterior) // deuda pendiente (>0) → interés y estado morosa
      // Ajuste por saldo del período anterior CON signo: si es negativo (saldo a favor) se
      // descuenta del total a pagar; si es deuda, coincide con `deuda`.
      const ajusteSaldoAnt = saldo_anterior

      // Interés sobre saldo deudor: usa interes_mora del consorcio (% mensual sobre la deuda)
      // consorcioActivo.interes_mora = 5 → 5% mensual sobre la deuda
      const tasaMora = parseFloat(consorcioActivo?.interes_mora || 0) / 100
      const interes_mora = deuda > 0 ? Math.round(deuda * tasaMora * 100) / 100 : 0

      // TOTAL a pagar = expensa + redondeo (centavos UF) + saldo anterior (con signo) + intereses
      const monto_total = expensaBase + centavosUF + ajusteSaldoAnt + interes_mora
      // 2do vencimiento: recargo solo sobre la expensa del período, saldo anterior e interés sin recargo
      const monto_vto2 = Math.round((expensaBase + centavosUF) * (1 + (config.pct_mora_vto2 || 0) / 100) * 100) / 100 + ajusteSaldoAnt + interes_mora

      // Calcular aporte desagregado por columna (para la planilla PDF)
      // Misma lógica de fallback que expensaBase
      const aporte_por_columna = {}
      if (tieneMultiCol && Object.keys(importesPorColumna).length > 0) {
        Object.entries(importesPorColumna).forEach(([codigo, col]) => {
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
        redondeo: centavosUF,
        monto: monto_total,
        monto_vto2,
        vto1, vto2,
        saldo_anterior,
        pagos_anterior,
        deuda,
        interes_mora,
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

    // ── Datos base ──────────────────────────────────────────────────────────
    const totalGastosTotal = gastos.reduce((a,g)=>a+parseFloat(g.monto||0),0)
    const per = periodoLabel(expSel?.periodo)
    const fmtN = n => (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2 })

    // Fechas correctas
    const [yy, mm] = (expSel?.periodo || '').split('-')
    const mesActual  = parseInt(mm) || new Date().getMonth() + 1
    const anioActual = parseInt(yy) || new Date().getFullYear()
    const mesVto     = mesActual === 12 ? 1 : mesActual + 1
    const anioVto    = mesActual === 12 ? anioActual + 1 : anioActual
    const mesAnt     = mesActual === 1  ? 12 : mesActual - 1
    const anioAnt    = mesActual === 1  ? anioActual - 1 : anioActual
    const fechaVto1  = `${String(config.vto1_dia||10).padStart(2,'0')}/${String(mesVto).padStart(2,'0')}/${anioVto}`

    // ── Gastos agrupados por rubro ────────────────────────────────────────────
    // Usar grupos dinámicos del consorcio si existen, sino fallback hardcodeado
    const RUBRO_LABELS_FALLBACK = {
      sueldos:'1 SUELDOS Y CARGAS SOCIALES', cargas_sociales:'1 SUELDOS Y CARGAS SOCIALES',
      fateryh:'1 SUELDOS Y CARGAS SOCIALES', cargas_sociales_arca:'1 SUELDOS Y CARGAS SOCIALES',
      vep931:'1 SUELDOS Y CARGAS SOCIALES', sueldos_detalle:'1 SUELDOS Y CARGAS SOCIALES',
      electricidad:'2 SERVICIOS PÚBLICOS', agua:'2 SERVICIOS PÚBLICOS', gas:'2 SERVICIOS PÚBLICOS',
      servicios_publicos:'2 SERVICIOS PÚBLICOS',
      contratos_abonos:'3 CONTRATOS Y ABONOS', telefonia:'3 CONTRATOS Y ABONOS',
      limpieza:'3 CONTRATOS Y ABONOS', piscina:'3 CONTRATOS Y ABONOS',
      honorarios_admin:'4 GASTOS DE ADMINISTRACIÓN', honorarios_contable:'4 GASTOS DE ADMINISTRACIÓN',
      contratos:'4 GASTOS DE ADMINISTRACIÓN',
      seguros:'5 SEGUROS',
      mantenimiento_general:'6 MANTENIMIENTO GENERAL', mantenimiento_parques:'6 MANTENIMIENTO GENERAL',
      ascensores:'6 MANTENIMIENTO GENERAL', pintura:'6 MANTENIMIENTO GENERAL',
      materiales_construccion:'6 MANTENIMIENTO GENERAL', vidrieria:'6 MANTENIMIENTO GENERAL',
      varios:'7 VARIOS', articulos_limpieza:'7 VARIOS',
      gastos_bancarios:'8 GASTOS BANCARIOS',
      impuesto_municipal:'9 IMPUESTOS Y TASAS', impuesto_provincial:'9 IMPUESTOS Y TASAS',
      arba:'9 IMPUESTOS Y TASAS', viaticos:'9 IMPUESTOS Y TASAS',
      otros_egresos:'10 OTROS EGRESOS', fondo_inversion:'10 OTROS EGRESOS',
      reintegros:'11 REINTEGROS',
    }

    // Construir mapa categoria → label desde grupos de BD (si existen)
    const catToLabel = {}
    const gruposOrdenados = [...gruposLiq].sort((a,b)=>a.numero-b.numero)
    if (gruposOrdenados.length > 0) {
      for (const grp of gruposOrdenados) {
        const label = `${grp.numero} ${grp.nombre.replace(/^\d+\s+/,'')}`
        for (const cat of (grp.categorias||[])) catToLabel[cat] = label
      }
    }
    // Si no hay grupos en BD, usar el fallback
    const resolverLabel = cat =>
      catToLabel[cat] || RUBRO_LABELS_FALLBACK[cat] || '7 VARIOS'

    // Columnas activas del consorcio (para encabezados del PDF)
    const colsActivas = columnasLiq.filter(c=>c.activo)
    const tieneMulticol = colsActivas.length > 1

    const rubrosAgrup = {}
    for (const g of gastos) {
      const label = resolverLabel(g.categoria||'varios')
      if (!rubrosAgrup[label]) rubrosAgrup[label] = { gastos:[], total:0, porCol:{} }
      rubrosAgrup[label].gastos.push(g)
      rubrosAgrup[label].total += parseFloat(g.monto)||0
      // En multi-columna: asignar gasto a cada columna según el grupo (por categoría)
      // Un gasto puede aparecer en MÚLTIPLES columnas si el grupo así lo indica
      if (tieneMulticol) {
        const grp = gruposOrdenados.find(gr => gr.categorias?.includes(g.categoria))
        const colsCodigos = grp?.columnas_coef?.length > 0
          ? grp.columnas_coef
          : [colsActivas[0]?.codigo]
        const monto = parseFloat(g.monto) || 0
        colsCodigos.forEach(cc => {
          rubrosAgrup[label].porCol[cc] = (rubrosAgrup[label].porCol[cc]||0) + monto
        })
      }
    }

    // Encabezados de columnas para el PDF de gastos
    const encabezadosCol = tieneMulticol
      ? colsActivas.map(c=>`<th class="r">${c.nombre}</th>`).join('') + '<th class="r">Total</th>'
      : '<th class="r">EXPENSAS A</th><th class="r">Total</th>'

    const rubrosHTML = Object.entries(rubrosAgrup)
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([label, data]) => {
        const pct = totalGastosTotal > 0 ? (data.total/totalGastosTotal*100).toFixed(2) : '0.00'
        const filas = data.gastos.map(g => {
          const montoG = parseFloat(g.monto)||0
          if (tieneMulticol) {
            // Determinar en qué columnas aparece este gasto (por categoría del grupo)
            const grp = gruposOrdenados.find(gr => gr.categorias?.includes(g.categoria))
            const colsCod = grp?.columnas_coef?.length > 0
              ? grp.columnas_coef
              : [colsActivas[0]?.codigo]
            const celdas = colsActivas.map(c =>
              `<td style="text-align:right;padding:2px 4px;font-size:7pt;white-space:nowrap">${colsCod.includes(c.codigo)?fmtN(montoG):'—'}</td>`
            ).join('') + `<td style="text-align:right;padding:2px 4px;font-size:7pt;white-space:nowrap">${fmtN(montoG)}</td>`
            return `<tr style="border-bottom:1px solid #eee"><td style="padding:2px 5px;font-size:7pt">${(g.concepto||'').replace(/</g,'&lt;')}${g.proveedor_nombre?', '+g.proveedor_nombre.replace(/</g,'&lt;'):''}${g.comprobante?', '+g.comprobante:''}</td>${celdas}</tr>`
          } else {
            return `<tr style="border-bottom:1px solid #eee">
              <td style="padding:2px 6px;font-size:7.5pt">${(g.concepto||'').replace(/</g,'&lt;')}${g.proveedor_nombre?', '+g.proveedor_nombre.replace(/</g,'&lt;'):''}${g.comprobante?', '+g.comprobante:''}</td>
              <td style="text-align:right;padding:2px 6px;font-size:7.5pt;white-space:nowrap">${fmtN(montoG)}</td>
              <td style="text-align:right;padding:2px 6px;font-size:7.5pt;white-space:nowrap">${fmtN(montoG)}</td>
            </tr>`
          }
        }).join('')

        if (tieneMulticol) {
          const totCeldas = colsActivas.map(c =>
            `<td style="text-align:right;padding:3px 5px;font-weight:700;font-size:7.5pt;white-space:nowrap">${fmtN(data.porCol[c.codigo]||0)}</td>`
          ).join('') + `<td style="text-align:right;padding:3px 5px;font-weight:700;font-size:7.5pt;white-space:nowrap">${fmtN(data.total)}</td>`
          const encRubro = colsActivas.map(c=>`<td style="text-align:right;padding:3px 5px;font-weight:700;font-size:7.5pt">${c.nombre}</td>`).join('') + `<td style="text-align:right;padding:3px 5px;font-weight:700;font-size:7.5pt">Total</td>`
          return `<tr style="background:#dce8f5"><td style="padding:3px 6px;font-weight:700;font-size:7.5pt;text-transform:uppercase">${label}</td>${encRubro}</tr>${filas}<tr style="background:#1A3FA0;color:#fff"><td style="padding:3px 6px;font-weight:700;font-size:7.5pt">TOTAL RUBRO ${pct}%</td>${totCeldas}</tr>`
        } else {
          return `<tr style="background:#dce8f5"><td style="padding:3px 6px;font-weight:700;font-size:8pt;text-transform:uppercase">${label}</td><td style="text-align:right;padding:3px 6px;font-weight:700;font-size:8pt">EXPENSAS A</td><td style="text-align:right;padding:3px 6px;font-weight:700;font-size:8pt">Total</td></tr>${filas}<tr style="background:#1A3FA0;color:#fff"><td style="padding:3px 6px;font-weight:700;font-size:8pt">TOTAL RUBRO ${pct}%</td><td style="text-align:right;padding:3px 6px;font-weight:700;font-size:7.5pt;white-space:nowrap">${fmtN(data.total)}</td><td style="text-align:right;padding:3px 6px;font-weight:700;font-size:7.5pt;white-space:nowrap">${fmtN(data.total)}</td></tr>`
        }
      }).join('')

    // ── Estado financiero ─────────────────────────────────────────────────────
    // LÓGICA CONTABLE CORRECTA:
    //   saldoAntEF    = saldo_caja_final del período anterior (lo que quedó en caja)
    //   cobradoTermEF = cobranzas registradas en el PERÍODO ACTUAL (con_cobranzas de mayo)
    //                   NO los cobros de abril (ya están incluidos en saldoAntEF)
    //   egresos       = gastos del período actual pagados a proveedores
    //   saldoFinalEF  = saldoAnt + ingresos - egresos
    const saldoAntEF       = saldoCajaAnterior   // saldo_caja_final del período anterior
    const cobradoTermEF    = cobradoActual        // ingresos por expensas en término (RPC)
    const cobradoAdeudEF   = cobradoAdeudado      // ingresos por expensas adeudadas (RPC)
    const cobradoInteresEF = cobradoInteres       // ingresos por intereses (RPC)
    const saldoFinalEF     = saldoAntEF + cobradoTermEF + cobradoAdeudEF + cobradoInteresEF - totalGastosTotal

    // ── Prorrateo — tabla portrait con columnas compactas ────────────────────
    // TOTAL por UF = EXPENSA + REDONDEO + DEUDA + INTERÉS
    // ── Prorrateo: columnas dinámicas (una columna por columna activa) ──────────
    const filasProrrateoPrev = distribucion.map((d,idx) => {
      const bgRow = idx % 2 === 0 ? '#fff' : '#f0f6fb'
      const totalUF = (parseFloat(d.expensa_base)||0) + (parseFloat(d.redondeo)||0) + (parseFloat(d.deuda)||0) + (parseFloat(d.interes_mora)||0)

      // Celdas de columnas: si hay multicol, mostrar cada columna; sino la única
      let celdasColumnas
      if (tieneMulticol && d.aporte_por_columna && Object.keys(d.aporte_por_columna).length > 0) {
        celdasColumnas = colsActivas.map(col => {
          const val = d.aporte_por_columna[col.codigo] || 0
          return `<td style="text-align:right;padding:2px 4px;font-size:7pt;white-space:nowrap">${val > 0 ? fmtN(val) : '—'}</td>`
        }).join('')
      } else {
        celdasColumnas = `<td style="text-align:right;padding:2px 4px;font-size:7.5pt;white-space:nowrap;font-weight:600">${fmtN(d.expensa_base)}</td>`
      }

      return `<tr style="border-bottom:1px solid #d8e8f0;background:${bgRow}">
        <td style="padding:2px 4px;text-align:center;font-weight:700;font-size:7pt">${d.numero_uf}</td>
        <td style="padding:2px 4px;font-size:7pt">${String(d.numero||'').replace(/</g,'&lt;')}</td>
        <td style="padding:2px 4px;font-size:7pt;max-width:90px;overflow:hidden">${String(d.propietario||'').replace(/</g,'&lt;')}</td>
        <td style="text-align:right;padding:2px 4px;font-size:7pt;white-space:nowrap;color:${d.saldo_anterior>0?'#b91c1c':'#374151'}">${fmtN(d.saldo_anterior)}</td>
        <td style="text-align:right;padding:2px 4px;font-size:7pt;white-space:nowrap">${fmtN(d.pagos_anterior)}</td>
        <td style="text-align:right;padding:2px 4px;font-size:7pt;white-space:nowrap;font-weight:${d.deuda>0?700:400};color:${d.deuda>0?'#b91c1c':'#374151'}">${fmtN(d.deuda)}</td>
        <td style="text-align:right;padding:2px 4px;font-size:7pt">${fmtN(d.interes_mora||0)}</td>
        <td style="text-align:right;padding:2px 4px;font-size:7pt">${d.pct}%</td>
        ${celdasColumnas}
        <td style="text-align:right;padding:2px 4px;font-size:6.5pt;color:#9ca3af">${fmtN(d.redondeo)}</td>
        <td style="text-align:right;padding:2px 4px;font-size:8pt;font-weight:800;color:#1A3FA0;white-space:nowrap">${fmtN(totalUF)}</td>
        <td style="text-align:center;padding:2px 4px;font-size:7pt">${d.numero_uf}</td>
      </tr>`
    }).join('')

    // Totales del prorrateo
    const totSaldoAnt = distribucion.reduce((a,d)=>a+d.saldo_anterior,0)
    const totPagosAnt = distribucion.reduce((a,d)=>a+d.pagos_anterior,0)
    const totDeuda    = distribucion.reduce((a,d)=>a+d.deuda,0)
    const totInteres  = distribucion.reduce((a,d)=>a+(d.interes_mora||0),0)
    const totExpensa  = distribucion.reduce((a,d)=>a+d.expensa_base,0)
    const totRedondeo = distribucion.reduce((a,d)=>a+d.redondeo,0)
    const totTotal    = distribucion.reduce((a,d)=>a+d.expensa_base+d.redondeo+d.deuda+(d.interes_mora||0),0)
    // Totales por columna (para fila de totales en pie de tabla)
    const totPorColumna = {}
    if (tieneMulticol) {
      colsActivas.forEach(col => {
        totPorColumna[col.codigo] = distribucion.reduce((a,d) => a + (d.aporte_por_columna?.[col.codigo]||0), 0)
      })
    }

    // ── Notas del período ────────────────────────────────────────────────────
    const notasText = (notasPeriodo || '').replace(/</g,'&lt;').replace(/\n/g,'<br/>')
    const notasDefecto = `COMUNICAMOS A LOS SRES PROPIETARIOS/INQUILINOS QUE LOS PAGOS QUE NO SE REALICEN ANTES DE LOS DIAS 28 DE CADA MES, NO PODRAN SER ACREDITADOS EN TIEMPO Y FORMA POR CUESTIONES OPERATIVAS.<br/><br/>SOLICITAMOS CANCELAR LAS EXPENSAS ANTES DE LA MENCIONADA FECHA, EVITANDO RECARGOS O INCONVENIENTES FUTUROS.<br/><br/><strong>ATENCION OFICINA</strong><br/>UBICACION: LENGUADO N&deg; 1313 LOCAL 3 (ENTRE SHAW Y ENEAS) &nbsp;&nbsp; HORARIO: LUNES A SABADOS DE 9:00 A 13:00 HORAS<br/>TELEFONOS: FIJO 02267-516386 / CELULAR 2267444034<br/><br/>RECOMENDAMOS HACER USO DE TRANSFERENCIAS BANCARIAS EN LAS CUENTAS CORRIENTES INFORMADAS RESPETANDO LOS IMPORTES CON CENTAVOS, PARA UNA CORRECTA IDENTIFICACION Y EVITAR ERRORES EN LAS IMPUTACIONES.<br/>TAMBIEN PUEDEN REALIZAR DEPOSITOS EN EFECTIVO EN LA CUENTA BANCARIA DEL CONSORCIO.<br/><br/>EN CASO DE TRANSFERIR O DEPOSITAR IMPORTES DISTINTOS A LOS INFORMADOS EN LA LIQUIDACION, DEBERAN ENVIAR AVISO CON EL COMPROBANTE PARA UNA CORRECTA IDENTIFICACION Y ACREDITACION A LA UNIDAD CORRESPONDIENTE.<br/><br/>LOS PAGOS QUE SE EFECTUEN UTILIZANDO EL SISTEMA DE LA PLATAFORMA DE PAGOS, SE IMPUTAN AUTOMATICAMENTE EN LA CUENTA CORRIENTE DEL CONSORCIO EN EL BANCO Y A LAS UNIDADES, POR LO QUE NO TIENE QUE COMUNICAR EL PAGO.`
    const notasContenido = notasText || notasDefecto

    // ── CBU datos de pago ────────────────────────────────────────────────────
    const cbuHTML = (consorcioActivo?.cbu) ? `
      <div style="border:1.5px solid #1A3FA0;border-radius:5px;padding:8px 12px;margin-top:8px">
        <div style="color:#1A3FA0;font-weight:700;font-size:9pt;margin-bottom:5px">FORMAS DE PAGO</div>
        <div style="font-size:8pt"><strong>DEPÓSITO O TRANSFERENCIA</strong></div>
        <div style="font-size:8.5pt;margin-top:3px">
          <strong>Titular:</strong> ${(consorcioActivo.nombre||'').replace(/</g,'&lt;')}<br/>
          <strong>CBU:</strong> ${consorcioActivo.cbu}<br/>
          <strong>Nº de cuenta:</strong> ${consorcioActivo.nro_cuenta||'—'}<br/>
          <strong>Alias:</strong> ${consorcioActivo.alias_cbu||'—'} &nbsp;&nbsp; <strong>Banco:</strong> ${consorcioActivo.banco||'—'} &nbsp;&nbsp; <strong>Sucursal:</strong> ${consorcioActivo.sucursal||'—'}
        </div>
      </div>` : ''

    // ── Deuda por UF ─────────────────────────────────────────────────────────
    const deudaUFs = distribucion.filter(d=>d.deuda>0)
    const deudaHTML = deudaUFs.length > 0
      ? deudaUFs.map(d=>`<tr style="border-bottom:1px solid #fecaca"><td style="padding:3px 8px;text-align:center">${d.numero_uf}</td><td style="padding:3px 8px">${String(d.numero||'').replace(/</g,'&lt;')}</td><td style="padding:3px 8px">${String(d.propietario||'').replace(/</g,'&lt;')}</td><td style="text-align:right;padding:3px 8px;font-weight:700">${fmtN(d.deuda)}</td><td style="text-align:right;padding:3px 8px;font-weight:700">${fmtN(d.deuda)}</td></tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;padding:6px;color:#6b7280">Sin unidades con deuda</td></tr>'

    // ── Logo real de la administración ───────────────────────────────────────
    // ↓↓↓ PEGAR ACÁ el logo real: "data:image/png;base64,AAAA...". Vacío = solo texto (sin img roto).
    const LOGO_ADM_B64 = 'data:image/png;base64,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'
    const logoImg = LOGO_ADM_B64 ? `<img src="${LOGO_ADM_B64}" alt="Administración de Consorcios Pinamar" style="width:72px;height:auto;object-fit:contain"/>` : ''
    const logoHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:100px;padding:4px 6px;text-align:center">
      ${logoImg}
      <div style="font-size:6.5pt;color:#1A3FA0;font-weight:700;margin-top:3px;line-height:1.3">Administración de<br/>Consorcios Pinamar</div>
    </div>`

    // ── HTML COMPLETO — todo portrait ─────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Liquidación ${per} — ${(consorcioActivo?.nombre||'').replace(/</g,'&lt;')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#111;background:#fff}
  .page{width:210mm;min-height:297mm;padding:10mm 11mm 8mm;page-break-after:always;position:relative}
  .page:last-child{page-break-after:auto}
  @page{size:A4 portrait;margin:0}
  @media print{
    body{margin:0}
    .no-print{display:none!important}
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
  }
  /* Header */
  .hdr{display:flex;align-items:flex-start;gap:10px;border-bottom:3px solid #1A3FA0;padding-bottom:6px;margin-bottom:6px}
  .hdr-right{flex:1}
  /* Título */
  .titulo-liq{background:#1A3FA0;color:#fff;font-weight:700;font-size:9pt;text-align:center;padding:4px 8px;margin-bottom:5px}
  .subtitulo-liq{background:#2563eb;color:#fff;font-weight:700;font-size:8pt;text-align:center;padding:2px 8px;margin-bottom:6px}
  /* Datos col */
  .datos-row{display:flex;gap:8px;margin-bottom:6px}
  .datos-col{flex:1;border:1px solid #ccc;border-radius:3px;padding:4px 7px}
  .datos-col h4{color:#1A3FA0;font-size:7pt;text-transform:uppercase;border-bottom:1px solid #1A3FA0;margin-bottom:3px;padding-bottom:1px;font-weight:700}
  .datos-col p{font-size:7.5pt;line-height:1.5}
  /* Secciones */
  .sec-title{background:#1A3FA0;color:#fff;font-weight:700;font-size:7.5pt;padding:3px 7px;text-transform:uppercase;margin:6px 0 0}
  /* Tablas */
  table{width:100%;border-collapse:collapse}
  th{background:#2e4057;color:#fff;padding:3px 5px;font-size:7pt;white-space:nowrap}
  th.r{text-align:right}
  td{font-size:7.5pt}
  /* Estado financiero */
  .ef-body td{padding:2px 7px;border-bottom:1px solid #eee}
  .ef-final td{padding:4px 7px;background:#1A3FA0;color:#fff;font-weight:700;font-size:8.5pt}
  .indent{padding-left:14px!important;font-style:italic}
  /* Footer */
  .footer{position:absolute;bottom:6mm;left:11mm;right:11mm;border-top:1px solid #ccc;padding-top:2px;font-size:6pt;color:#666;display:flex;justify-content:space-between}
  /* Botón imprimir */
  .btn-imp{display:block;margin:12px auto;padding:9px 24px;background:#1A3FA0;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-family:Arial}
</style>
</head>
<body>

<button class="btn-imp no-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>

<!-- ══ PÁGINA 1: GASTOS + ESTADO FINANCIERO ══ -->
<div class="page">
  <div class="hdr">
    ${logoHTML}
    <div class="hdr-right">
      <div class="titulo-liq">EXPENSAS PROVINCIA DE BUENOS AIRES Ley 14.701</div>
      <div class="subtitulo-liq">EXPENSAS - Liquidaci&oacute;n de mes: ${expSel?.periodo||''}</div>
      <div class="datos-row">
        <div class="datos-col">
          <h4>Administración</h4>
          <p><strong>Javier Garcia Perez</strong><br/>
          Domicilio: Lenguado 1313 - Loc 3<br/>
          administracion@administracionpinamar.com<br/>
          CUIT: 20186006802 &nbsp; Inscripci&oacute;n RPAC: 83<br/>
          Te: 02267 444034 / 2267 444034</p>
        </div>
        <div class="datos-col">
          <h4>Consorcio</h4>
          <p><strong>${(consorcioActivo?.nombre||'').replace(/</g,'&lt;')}</strong><br/>
          CUIT: ${consorcioActivo?.cuit||''}<br/>
          Clave SUTERH: ${consorcioActivo?.clave_suterh||''}<br/>
          <strong>Javier Garcia Perez</strong></p>
        </div>
      </div>
    </div>
  </div>

  <div class="sec-title">PAGOS DEL PERÍODO POR SUMINISTROS, SERVICIOS, ABONOS Y SEGUROS</div>
  <table>
    <thead><tr><th style="text-align:left">Concepto</th>${encabezadosCol}</tr></thead>
    <tbody>${rubrosHTML}</tbody>
    <tfoot>
      ${tieneMulticol ? (() => {
        // Fila 1: Total gastos brutos por columna (suma de gastos asignados)
        const totBrutosPorCol = {}
        colsActivas.forEach(c => { totBrutosPorCol[c.codigo] = 0 })
        gastos.forEach(g => {
          const grp = gruposOrdenados.find(gr => gr.categorias?.includes(g.categoria))
          const cols = grp?.columnas_coef?.length > 0 ? grp.columnas_coef : [colsActivas[0]?.codigo]
          cols.forEach(cc => { if (totBrutosPorCol[cc] !== undefined) totBrutosPorCol[cc] += parseFloat(g.monto)||0 })
        })
        // Fila 2: Importes a prorratear configurados en el paso 3
        const impProrr = importesPorColumna || {}
        const celdasBrutos = colsActivas.map(c =>
          `<td style="text-align:right;padding:3px 7px;font-size:7.5pt;white-space:nowrap">${fmtN(totBrutosPorCol[c.codigo]||0)}</td>`
        ).join('') + `<td style="text-align:right;padding:3px 7px;font-size:7.5pt;white-space:nowrap">${fmtN(totalGastosTotal)}</td>`
        const celdasProrr = colsActivas.map(c => {
          const imp = impProrr[c.codigo]
          const val = imp ? parseFloat(imp.monto)||0 : totBrutosPorCol[c.codigo]||0
          return `<td style="text-align:right;padding:3px 7px;font-size:8pt;font-weight:800;white-space:nowrap">${fmtN(val)}</td>`
        }).join('') + `<td style="text-align:right;padding:3px 7px;font-size:8pt;font-weight:800;white-space:nowrap">${fmtN(Object.values(impProrr).reduce((a,c)=>a+(parseFloat(c.monto)||0),0)||totalGastosTotal)}</td>`
        return `<tr style="background:#475569;color:#fff">
          <td style="padding:3px 7px;font-size:7.5pt">Total gastos brutos</td>
          ${celdasBrutos}
        </tr>
        <tr style="background:#0d2b3e;color:#fff;font-weight:700">
          <td style="padding:3px 7px;font-size:8pt">IMPORTE A PRORRATEAR</td>
          ${celdasProrr}
        </tr>`
      })() : `<tr style="background:#0d2b3e;color:#fff;font-weight:700">
        <td style="padding:3px 7px;font-size:8pt">TOTAL &nbsp; 100,00%</td>
        <td style="text-align:right;padding:3px 7px;font-size:8pt;white-space:nowrap">${fmtN(totalGastosTotal)}</td>
        <td style="text-align:right;padding:3px 7px;font-size:8pt;white-space:nowrap">${fmtN(totalGastosTotal)}</td>
      </tr>`}
    </tfoot>
  </table>

  <div class="sec-title">ESTADO FINANCIERO</div>
  <table>
    <thead><tr><th style="text-align:left">CONCEPTO</th>${tieneMulticol ? colsActivas.map(c=>`<th class="r">${c.nombre}</th>`).join('')+'<th class="r">Total</th>' : '<th class="r">EXPENSAS A</th><th class="r">Total</th>'}</tr></thead>
    <tbody class="ef-body">
      <tr><td style="padding:2px 7px">Saldo anterior al 01/${String(mesActual).padStart(2,'0')}/${anioActual}</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;padding:2px 7px">—</td>`).join('')+'<td style="text-align:right;padding:2px 7px;white-space:nowrap">'+fmtN(saldoAntEF)+'</td>' : `<td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(saldoAntEF)}</td><td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(saldoAntEF)}</td>`}</tr>
      <tr><td class="indent" style="padding:2px 7px 2px 18px;font-style:italic">Ingresos por pago de expensas en t&eacute;rmino</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;padding:2px 7px">—</td>`).join('')+'<td style="text-align:right;padding:2px 7px;white-space:nowrap">'+fmtN(cobradoTermEF)+'</td>' : `<td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(cobradoTermEF)}</td><td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(cobradoTermEF)}</td>`}</tr>
      <tr><td class="indent" style="padding:2px 7px 2px 18px;font-style:italic">Ingresos por pago de expensas adeudadas</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;padding:2px 7px">—</td>`).join('')+'<td style="text-align:right;padding:2px 7px;white-space:nowrap">'+fmtN(cobradoAdeudEF)+'</td>' : `<td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(cobradoAdeudEF)}</td><td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(cobradoAdeudEF)}</td>`}</tr>
      <tr><td class="indent" style="padding:2px 7px 2px 18px;font-style:italic">Ingresos por pago de intereses</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;padding:2px 7px">—</td>`).join('')+'<td style="text-align:right;padding:2px 7px;white-space:nowrap">'+fmtN(cobradoInteresEF)+'</td>' : `<td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(cobradoInteresEF)}</td><td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(cobradoInteresEF)}</td>`}</tr>
      <tr><td class="indent" style="padding:2px 7px 2px 18px;font-style:italic">Egresos por pagos</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;padding:2px 7px">—</td>`).join('')+'<td style="text-align:right;padding:2px 7px;white-space:nowrap">-'+fmtN(totalGastosTotal)+'</td>' : `<td style="text-align:right;padding:2px 7px;white-space:nowrap">-${fmtN(totalGastosTotal)}</td><td style="text-align:right;padding:2px 7px;white-space:nowrap">-${fmtN(totalGastosTotal)}</td>`}</tr>
    </tbody>
    <tfoot><tr class="ef-final"><td>Saldo final al ${fechaVto1}</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;white-space:nowrap">—</td>`).join('')+'<td style="text-align:right;white-space:nowrap">'+fmtN(saldoFinalEF)+'</td>' : `<td style="text-align:right;white-space:nowrap">${fmtN(saldoFinalEF)}</td><td style="text-align:right;white-space:nowrap">${fmtN(saldoFinalEF)}</td>`}</tr></tfoot>
  </table>
  <div class="footer">
    <span>${(consorcioActivo?.nombre||'').replace(/</g,'&lt;')} &mdash; Liquidaci&oacute;n ${per}</span>
    <span>R.P.A.C.: 83 | CUIT: ${consorcioActivo?.cuit||''} | Vto: ${fechaVto1}</span>
    <span>P&aacute;g. 1</span>
  </div>
</div>

<!-- ══ PÁGINA 2: NOTAS ══ -->
<div class="page">
  <div class="hdr">
    ${logoHTML}
    <div class="hdr-right">
      <div class="titulo-liq">NOTAS</div>
      <div class="subtitulo-liq">${(consorcioActivo?.nombre||'').replace(/</g,'&lt;')} &mdash; Liquidaci&oacute;n: ${per}</div>
    </div>
  </div>

  <div style="background:#00796b;color:#fff;font-weight:700;font-size:8pt;padding:4px 8px;display:inline-block;border-radius:3px;margin-bottom:8px">NOTAS</div>
  <div style="border:1px solid #ccc;border-radius:4px;padding:10px 12px;font-size:8pt;line-height:1.95">
    <p style="font-weight:700;text-align:center;margin-bottom:8px;font-size:8.5pt">Nota del per&iacute;odo</p>
    <p style="font-weight:700;font-style:italic;margin-bottom:6px">INFORMACION IMPORTANTE</p>
    <div>${notasContenido}</div>
  </div>

  ${cbuHTML}

  <div class="sec-title" style="margin-top:10px">UNIDADES CON DEUDA DE EXPENSAS</div>
  <table>
    <thead><tr>
      <th style="text-align:center;width:40px">U.F.</th>
      <th style="width:60px">Dpto.</th>
      <th>PROPIETARIO</th>
      <th class="r">DEUDA</th>
      <th class="r">TOTAL</th>
    </tr></thead>
    <tbody>${deudaHTML}</tbody>
    <tfoot><tr style="background:#1A3FA0;color:#fff;font-weight:700">
      <td colspan="3" style="padding:3px 7px;text-align:right">TOTAL</td>
      <td style="text-align:right;padding:3px 7px;white-space:nowrap">${fmtN(totDeuda)}</td>
      <td style="text-align:right;padding:3px 7px;white-space:nowrap">${fmtN(totDeuda)}</td>
    </tr></tfoot>
  </table>
  <div class="footer">
    <span>${(consorcioActivo?.nombre||'').replace(/</g,'&lt;')} &mdash; Liquidaci&oacute;n ${per}</span>
    <span>R.P.A.C.: 83</span>
    <span>P&aacute;g. 2</span>
  </div>
</div>

<!-- ══ PÁGINA 3: ESTADO DE CUENTAS Y PRORRATEO (portrait, fuente compacta) ══ -->
<div class="page">
  <div style="display:flex;justify-content:space-between;font-size:7pt;margin-bottom:4px">
    <div><strong>Administraci&oacute;n:</strong> Javier Garcia Perez &nbsp; <strong>Consorcio:</strong> ${(consorcioActivo?.nombre||'').replace(/</g,'&lt;')} &nbsp; <strong>Per&iacute;odo:</strong> ${expSel?.periodo||''}</div>
    <div style="text-align:right"><strong>N&deg; RPA: 83</strong> &nbsp; <strong>CUIT:</strong> ${consorcioActivo?.cuit||''} &nbsp; <strong>Vencimiento:</strong> ${fechaVto1}</div>
  </div>

  <div class="sec-title">ESTADO DE CUENTAS Y PRORRATEO</div>
  <table style="font-size:7pt">
    <thead>
      <tr style="background:#2e4057;color:#fff">
        <th style="text-align:center;padding:3px 4px;width:22px">U.F.</th>
        <th style="padding:3px 4px;width:32px">Dpto.</th>
        <th style="padding:3px 4px;min-width:80px">PROP.</th>
        <th style="text-align:right;padding:3px 4px;width:68px">SALDO ANTERIOR</th>
        <th style="text-align:right;padding:3px 4px;width:60px">PAGOS</th>
        <th style="text-align:right;padding:3px 4px;width:56px">DEUDA</th>
        <th style="text-align:right;padding:3px 4px;width:46px">INTERES</th>
        <th style="text-align:right;padding:3px 4px;width:38px">%</th>
        ${tieneMulticol
          ? colsActivas.map(col => `<th style="text-align:right;padding:3px 4px;min-width:52px">${col.nombre}</th>`).join('')
          : `<th style="text-align:right;padding:3px 4px;width:66px">${colsActivas[0]?.nombre || 'EXPENSAS A'}</th>`}
        <th style="text-align:right;padding:3px 4px;width:50px">RED./AJUST.</th>
        <th style="text-align:right;padding:3px 4px;width:70px;background:#1A3FA0">TOTAL</th>
        <th style="text-align:center;padding:3px 4px;width:22px">U.F.</th>
      </tr>
    </thead>
    <tbody>${filasProrrateoPrev}</tbody>
    <tfoot>
      <tr style="background:#0d2b3e;color:#fff;font-weight:700">
        <td colspan="3" style="padding:3px 5px;text-align:right;font-size:7.5pt">TOTAL</td>
        <td style="text-align:right;padding:3px 5px;font-size:7pt;white-space:nowrap">${fmtN(totSaldoAnt)}</td>
        <td style="text-align:right;padding:3px 5px;font-size:7pt;white-space:nowrap">${fmtN(totPagosAnt)}</td>
        <td style="text-align:right;padding:3px 5px;font-size:7pt;white-space:nowrap">${fmtN(totDeuda)}</td>
        <td style="text-align:right;padding:3px 5px;font-size:7pt">${fmtN(totInteres)}</td>
        <td style="text-align:right;padding:3px 5px;font-size:7pt">100%</td>
        ${tieneMulticol
          ? colsActivas.map(col => `<td style="text-align:right;padding:3px 5px;font-size:7pt;white-space:nowrap">${fmtN(totPorColumna[col.codigo]||0)}</td>`).join('')
          : `<td style="text-align:right;padding:3px 5px;font-size:7.5pt;white-space:nowrap">${fmtN(totExpensa)}</td>`}
        <td style="text-align:right;padding:3px 5px;font-size:7pt;white-space:nowrap">${fmtN(totRedondeo)}</td>
        <td style="text-align:right;padding:3px 5px;font-size:8.5pt;white-space:nowrap">${fmtN(totTotal)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  ${consorcioActivo?.cbu ? `
  <div style="margin-top:10px;border:1.5px solid #1A3FA0;border-radius:5px;padding:7px 10px">
    <div style="color:#1A3FA0;font-weight:700;font-size:8pt;margin-bottom:4px">FORMAS DE PAGO</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:7.5pt">
      <div><strong>DEP&Oacute;SITO O TRANSFERENCIA</strong><br/><strong>Titular:</strong> ${(consorcioActivo.nombre||'').replace(/</g,'&lt;')}<br/><strong>CBU:</strong> ${consorcioActivo.cbu}<br/><strong>N&deg; de cuenta:</strong> ${consorcioActivo.nro_cuenta||'—'}</div>
      <div style="padding-top:14px"><strong>Alias:</strong> ${consorcioActivo.alias_cbu||'—'}<br/><strong>Banco:</strong> ${consorcioActivo.banco||'—'}<br/><strong>Sucursal:</strong> ${consorcioActivo.sucursal||'—'}</div>
    </div>
  </div>` : ''}

  <div class="footer">
    <span>${(consorcioActivo?.nombre||'').replace(/</g,'&lt;')} &mdash; Liquidaci&oacute;n ${per}</span>
    <span>R.P.A.C. N&deg;83 | CUIT: ${consorcioActivo?.cuit||''}</span>
    <span>P&aacute;g. 3</span>
  </div>
</div>

</body>
</html>`

    // Escribir el HTML final — usando blob URL en un link temporal para máxima compatibilidad
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const blobUrl = URL.createObjectURL(blob)
      printWin.location.href = blobUrl
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000)
    } catch(e) {
      // Fallback: document.write directo
      printWin.document.open()
      printWin.document.write(html)
      printWin.document.close()
    }
  }


  // ── PASO 4: Confirmar y cerrar ─────────────────────────────────────────────
  async function confirmarYCerrar() {
    if (!confirm(`¿Confirmar y cerrar el período ${expSel?.periodo}?\n\nSe generarán ${distribucion.length} comprobantes individuales y el período quedará cerrado.`)) return

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
        .select('id').eq('consorcio_id', consorcioId)
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
        if ((lufAnt2||[]).length > 0) {
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
        monto: d.monto,              // monto CON centavos de identificación de UF
        redondeo: d.redondeo,        // centavos del número de UF (ej: 0.03 para UF 3)
        saldo_anterior: d.saldo_anterior || saldosAnt[d.unidad_id] || 0,
        pagos_periodo: 0,
        interes_mora: 0,
        estado: (d.saldo_anterior || saldosAnt[d.unidad_id] || 0) > 0 ? 'morosa' : 'pendiente',
      }))

      const { error } = await supabase.from('con_expensas_detalle').insert(detalles)
      if (error) throw new Error(error.message)

      // P1-B: Asignar número correlativo de liquidación por consorcio
      try {
        await supabase.rpc('asignar_numero_liquidacion', { p_consorcio_id: consorcioId, p_expensa_id: expSel.id })
      } catch(e) { /* no crítico */ }

      setMsg({ tipo:'ok', texto:`✓ Período ${expSel.periodo} cerrado — ${distribucion.length} unidades — Total $${totalACobrar.toLocaleString('es-AR')}` })
      setPaso(4)
      await cargar()

      // Generar PDF de liquidación automáticamente al cerrar el período
      // Usar timeout para que el DOM se actualice primero
      setTimeout(async () => {
        try {
          // Traer la expensa recién cerrada CON los campos de estado financiero persistidos,
          // para que el PDF (y el que se envía al propietario) tome saldo y cobranzas reales.
          const { data: expFresca } = await supabase.from('con_expensas').select('*').eq('id', expSel.id).single()
          const expActualizado = expFresca || { ...expSel,
            total_gastos: totalGastos,
            total_expensa: totalACobrar,
            estado: 'cerrada',
          }
          generarPDFLiquidacion({
            consorcioActivo,
            expensa: expActualizado,
            gastos,
            detalles: distribucion.map(d => ({
              unidad_id: d.unidad_id,
              monto: d.monto,
              saldo_anterior: d.saldo_anterior || 0,
              pagos_periodo: 0,
              interes_mora: 0,
              redondeo: d.redondeo || 0,
            })),
            unidades,
            copropietarios,
            adminPerfil: adminPerfil || {},
          })
        } catch(pdfErr) {
          console.warn('PDF generación error:', pdfErr)
        }
      }, 800)

    } catch(e) {
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

            <Btn onClick={nuevaExpensa} disabled={procesando}>
              {procesando ? '⏳' : '+ Crear nuevo período'}
            </Btn>
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
                              const cols = grp?.columnas_coef?.length > 0 ? grp.columnas_coef : [colsActivas[0]?.codigo]
                              if (cols.includes(col.codigo)) acc += (parseFloat(g.monto)||0) / cols.length
                              return acc
                            }, 0)
                          })()
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
                            {d.saldo_anterior>0 ? fmt(d.saldo_anterior) : '—'}
                          </td>
                          <td style={{ padding:'5px 8px', textAlign:'right', color:GR, fontSize:10 }}>
                            {d.pagos_anterior>0 ? fmt(d.pagos_anterior) : '—'}
                          </td>
                          <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:d.deuda>0?700:400, color:d.deuda>0?RJ:GR, fontSize:10 }}>
                            {d.deuda>0 ? fmt(d.deuda) : '—'}
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
                setProcessando && setProcessando(true)
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
              }
            }}>🔄 Anular liquidación y volver a empezar</Btn>
          </div>
        </Card>
      )}
    </div>
  )
}
