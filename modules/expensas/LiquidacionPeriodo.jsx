// modules — LiquidacionPeriodo.jsx
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

export default function LiquidacionPeriodo() {
  const { session, consorcioActivo, unidades, copropietarios, expensas, setExpensas, adminPerfil } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

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
  const [cobradoActual, setCobradoActual]         = useState(0) // cobranzas del período en curso
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

      // También buscar cobranzas registradas en la expensa anterior (por UF)
      const { data: cobranzasAnt } = await supabase.from('con_cobranzas')
        .select('unidad_id, monto').eq('expensa_id', expAnterior[0].id)
      const cobranzasPorUF = {}
      for (const co of (cobranzasAnt||[])) {
        cobranzasPorUF[co.unidad_id] = (cobranzasPorUF[co.unidad_id]||0) + (parseFloat(co.monto)||0)
      }

      let totalCobradoAnt = 0
      if ((detsAnt||[]).length > 0) {
        // Caso normal: hay detalles guardados por UF
        for (const d of detsAnt) {
          const pagosUF = cobranzasPorUF[d.unidad_id] || (parseFloat(d.pagos_periodo)||0)
          const saldo = Math.max(0,
            (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0) +
            (parseFloat(d.interes_mora)||0) - pagosUF
          )
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

    // Cargar cobranzas del período ACTUAL — siempre, independiente de si hay expensa anterior
    // Son las que aparecen como "Ingresos del período" en el Estado Financiero
    const { data: cobranzasActuales } = await supabase.from('con_cobranzas')
      .select('monto').eq('expensa_id', expSel?.id || '')
    const totalCobradoActual = (cobranzasActuales||[]).reduce((a,c) => a + (parseFloat(c.monto)||0), 0)
    setCobradoActual(totalCobradoActual)

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
      const deuda = Math.max(0, saldo_anterior) // deuda pendiente del período anterior

      // Interés sobre saldo deudor: usa interes_mora del consorcio (% mensual sobre la deuda)
      // consorcioActivo.interes_mora = 5 → 5% mensual sobre la deuda
      const tasaMora = parseFloat(consorcioActivo?.interes_mora || 0) / 100
      const interes_mora = deuda > 0 ? Math.round(deuda * tasaMora * 100) / 100 : 0

      // TOTAL a pagar = expensa + redondeo (centavos UF) + deuda anterior + intereses
      const monto_total = expensaBase + centavosUF + deuda + interes_mora
      // 2do vencimiento: recargo solo sobre la expensa del período, deuda e interés sin recargo
      const monto_vto2 = Math.round((expensaBase + centavosUF) * (1 + (config.pct_mora_vto2 || 0) / 100) * 100) / 100 + deuda + interes_mora

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
    const saldoAntEF    = saldoCajaAnterior   // saldo_caja_final del período anterior
    const cobradoTermEF = cobradoActual        // cobranzas del período en curso (mayo)
    const saldoFinalEF  = saldoAntEF + cobradoTermEF - totalGastosTotal

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
    const logoHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:100px;padding:4px 6px;text-align:center">
      <img src="${LOGO_ADM_B64}" alt="Administración de Consorcios Pinamar" style="width:72px;height:auto;object-fit:contain"/>
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
      <tr><td style="padding:2px 7px">Saldo anterior al 01/${String(mesAnt).padStart(2,'0')}/${anioAnt}</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;padding:2px 7px">—</td>`).join('')+'<td style="text-align:right;padding:2px 7px;white-space:nowrap">'+fmtN(saldoAntEF)+'</td>' : `<td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(saldoAntEF)}</td><td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(saldoAntEF)}</td>`}</tr>
      <tr><td class="indent" style="padding:2px 7px 2px 18px;font-style:italic">Ingresos por pago de expensas en t&eacute;rmino</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;padding:2px 7px">—</td>`).join('')+'<td style="text-align:right;padding:2px 7px;white-space:nowrap">'+fmtN(cobradoTermEF)+'</td>' : `<td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(cobradoTermEF)}</td><td style="text-align:right;padding:2px 7px;white-space:nowrap">${fmtN(cobradoTermEF)}</td>`}</tr>
      <tr><td class="indent" style="padding:2px 7px 2px 18px;font-style:italic">Ingresos por pago de expensas adeudadas</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;padding:2px 7px">0,00</td>`).join('')+'<td style="text-align:right;padding:2px 7px">0,00</td>' : '<td style="text-align:right;padding:2px 7px">0,00</td><td style="text-align:right;padding:2px 7px">0,00</td>'}</tr>
      <tr><td class="indent" style="padding:2px 7px 2px 18px;font-style:italic">Ingresos por pago de intereses</td>${tieneMulticol ? colsActivas.map(()=>`<td style="text-align:right;padding:2px 7px">0,00</td>`).join('')+'<td style="text-align:right;padding:2px 7px">0,00</td>' : '<td style="text-align:right;padding:2px 7px">0,00</td><td style="text-align:right;padding:2px 7px">0,00</td>'}</tr>
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

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    window.open(url, '_blank', 'width=1000,height=750')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
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
      const { data: cobsMayo } = await supabase.from('con_cobranzas')
        .select('monto').eq('expensa_id', expSel.id)
      const totalCobrado = (cobsMayo||[]).reduce((a,c) => a + (parseFloat(c.monto)||0), 0)
      // saldoCajaFinal = saldo anterior + lo cobrado en mayo - lo gastado en mayo
      const saldoCajaFinal = saldoCajaAnterior + totalCobrado - totalGastos
      await supabase.from('con_expensas').update({
        total_gastos: totalGastos,
        total_expensa: totalACobrar,
        total_administracion: gastos.filter(g=>g.categoria==='honorarios_admin').reduce((a,g)=>a+(parseFloat(g.monto)||0),0),
        fecha_vencimiento: distribucion[0]?.vto1 || null,
        estado: 'cerrada',
        saldo_caja_final: saldoCajaFinal,
        total_cobrado: totalCobrado,
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
        // Cobranzas individuales de la expensa anterior
        const { data: cobranzasAnt2 } = await supabase.from('con_cobranzas')
          .select('unidad_id, monto').eq('expensa_id', expAnterior[0].id)
        const cobPorUF2 = {}
        for (const co of (cobranzasAnt2||[])) {
          cobPorUF2[co.unidad_id] = (cobPorUF2[co.unidad_id]||0) + (parseFloat(co.monto)||0)
        }
        if ((detsAnt||[]).length > 0) {
          // Hay detalles guardados
          for (const d of detsAnt) {
            const pagos = cobPorUF2[d.unidad_id] || (parseFloat(d.pagos_periodo)||0)
            const saldo = Math.max(0,
              (parseFloat(d.saldo_anterior)||0) + (parseFloat(d.monto)||0) +
              (parseFloat(d.interes_mora)||0) - pagos
            )
            if (saldo > 0) saldosAnt[d.unidad_id] = saldo
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
      setTimeout(() => {
        try {
          const expActualizado = { ...expSel,
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

