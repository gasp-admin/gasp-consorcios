import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function CobranzasAutomaticas() {
  const { session, cargando, esSuperAdmin, consorcios, setConsorcios, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, expensas, setExpensas, proveedores, setProveedores, adminPerfil, setAdminPerfil, formCon, setFormCon, msgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio, pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, navItems, secciones, navActivo } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [tab, setTab]             = useState('importar')
  const [archivo, setArchivo]     = useState(null)
  const [sistema, setSistema]     = useState('siro_multi')  // siro_multi | siro | expensas_pagas | banco_csv
  const [expSel, setExpSel]       = useState('')
  const [procesando, setProcesando] = useState(false)
  const [msg, setMsg]             = useState(null)
  const [config, setConfig]       = useState(null)
  const [historial, setHistorial] = useState([])
  const [siroConectado, setSiroConectado] = useState(false)
  const [cargandoSiro, setCargandoSiro]   = useState(false)
  // ── NUEVO: estado de la pantalla de revisión ──
  const [paso, setPaso]           = useState(1)  // 1=carga, 2=revisión, 3=confirmado
  const [registros, setRegistros] = useState([])
  const [archNom, setArchNom]     = useState('')
  const [confirmResult, setConfirmResult] = useState(null)
  const [todosConsorcios, setTodosConsorcios] = useState([])

  const hoy = new Date().toISOString().split('T')[0]
  const fmtN = n => '$' + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits:2 })

  async function cargarConfig() {
    const { data } = await supabase.from('con_config_cobranza').select('*')
      .eq('consorcio_id', consorcioId).single()
    setConfig(data || {})
  }

  async function cargarHistorial() {
    const { data } = await supabase.from('con_cobranzas_automaticas_log').select('*')
      .eq('consorcio_id', consorcioId).order('created_at', { ascending: false }).limit(20)
    setHistorial(data || [])
  }

  async function guardarConfig() {
    if (!config) return
    const payload = { ...config, admin_id: session.user.id, consorcio_id: consorcioId,
      id: `CFG-${consorcioId}`, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('con_config_cobranza').upsert([payload], { onConflict:'consorcio_id' })
    if (error) setMsg({ tipo:'error', texto: error.message })
    else setMsg({ tipo:'ok', texto:'✓ Configuración guardada' })
  }

  // ── PARSERS ──────────────────────────────────────────────────────────────

  // SIRO multi-consorcio — posicional 125 chars
  function parsearSIROMulti(texto, todosConsorcios) {
    const mapaConv = { '1139':'CON1139','0024':'CON024','0005':'CON005','0006':'CON006','0022':'CON022' }
    return texto.split(/\r?\n/).flatMap((line, i) => {
      const l = line.trim()
      if (l.length < 110) return []
      try {
        const conv    = l.slice(35,39)
        const cId     = mapaConv[conv] || null
        const nroUF   = parseInt(l.slice(39,43)) || 0
        const imp     = parseInt(l.slice(24,35)) / 100
        const medio   = l.slice(123,125).trim()
        const canal   = medio==='PP'?'Plataforma Pagos':medio==='PF'?'Pago Fácil':medio==='RP'?'Rapipago':medio
        const cNom    = cId ? (todosConsorcios.find(c=>c.id===cId)?.nombre || cId) : `Conv.${conv}`
        if (!imp || imp <= 0) return []
        return [{
          _id:`S-${i}`, tipo:'SIRO', canal,
          fechaPago: `${l.slice(6,8)}/${l.slice(4,6)}/${l.slice(0,4)}`,
          fechaAcred:`${l.slice(14,16)}/${l.slice(12,14)}/${l.slice(8,12)}`,
          importe:imp, consorcioId:cId, consorcioNombre:cNom,
          nroUF, ufLabel:`${String(nroUF).padStart(4,'0')}`,
          unidadId:null, propietario:null,
          confianza:cId?'alta':'baja',
          saldo1er:null, saldo2do:null, venc1:null, venc2:null,
          eliminado:false, sel:false,
        }]
      } catch(e) { return [] }
    })
  }

  // SIRO mono-consorcio (mismo formato, filtrado por consorcio activo)
  function parsearSIROmono(texto) {
    return parsearSIROMulti(texto, todosConsorcios)
      .filter(r => !r.consorcioId || r.consorcioId === consorcioId)
  }

  // Expensas Pagas — posicional
  function parsearEP(texto) {
    return texto.split(/\r?\n/).flatMap((line, i) => {
      const t = line.trim()
      if (t.length < 40 || /^[19]187/.test(t)) return []
      let fp = -1
      for (let k=2;k<10;k++) if (t.slice(k,k+4)==='2026'){fp=k;break;}
      if (fp<0) return []
      const imp = parseInt(t.slice(fp+8, fp+19)) / 100
      if (!imp || imp<=0) return []
      const canal = t.slice(fp+30).trim().replace(/\s+/,' ') || 'EP'
      return [{
        _id:`E-${i}`, tipo:'EP', canal,
        fechaPago:`${t.slice(fp+6,fp+8)}/${t.slice(fp+4,fp+6)}/${t.slice(fp,fp+4)}`,
        fechaAcred:null, importe:imp,
        consorcioId:consorcioId, consorcioNombre:consorcioActivo?.nombre||'',
        nroUF:null, ufLabel:'—', unidadId:null, propietario:null,
        confianza:'baja', saldo1er:null, saldo2do:null, venc1:null, venc2:null,
        eliminado:false, sel:false,
      }]
    })
  }

  // CSV bancario — detecta formato por contenido
  function parsearBancoCsv(texto) {
    const es_galicia = /Leyendas Adicionales/i.test(texto)
    const es_provA   = /Número Secuencia/i.test(texto)
    const lineas = texto.split(/\r?\n/)
    const result = []
    let enc = false, idx = 0
    for (const l of lineas) {
      const t = l.trim()
      if (!t) continue
      if (/^Fecha[,\t](Descripci|Nro\.?|Número|Importe)/i.test(t)) { enc=true; continue }
      if (!enc) continue
      if (/^Fecha de descarga|^Empresa|^Operador/i.test(t)) break
      const cols = t.split(',')
      if (cols.length < 3) continue
      try {
        let fecha='', importe=0, concepto='', titular='', cuit=null, canal='Transferencia'
        if (es_galicia) {
          fecha = cols[0]?.trim(); importe = parseMtoLocal(cols[3]?.trim()); titular = cols[4]?.trim(); canal = cols[1]?.trim()
        } else if (es_provA) {
          fecha = cols[1]?.trim(); importe = parseMtoLocal(cols[2]?.trim()); concepto = cols[5]?.trim()
          const cm = concepto.match(/\(([0-9-]{11,13})\)/); cuit = cm?.[1]?.replace(/-/g,'') || null
          const nm = concepto.match(/(?:TRANSF\s+DE\s+)?([A-ZÁÉÍÓÚÑ,\/\.\s]+)\s*\(/i)
          titular = nm?.[1]?.trim() || ''
        } else {
          // Macro/Roela/Provincia-B
          fecha = cols[0]?.trim(); importe = parseMtoLocal(cols[4]?.trim()||cols[1]?.trim())
          concepto = cols[3]?.trim() || cols.slice(2).join(',').trim()
          const cm = concepto.match(/\b(\d{11})\b/); cuit = cm?.[1] || null
          const am = concepto.match(/TRANSF\s+([A-ZÁÉÍÓÚÑ\/,\.]+)\s+\d/i)
          titular = am?.[1]?.replace(/\/.*/,'').trim() || ''
          canal = cols[2]?.trim()||'Transferencia'
        }
        if (!importe || importe<=0) continue
        result.push({
          _id:`B-${idx++}`, tipo:'BANCO', canal,
          fechaPago:fecha, fechaAcred:fecha, importe,
          consorcioId:consorcioId, consorcioNombre:consorcioActivo?.nombre||'',
          nroUF:null, ufLabel:'—', unidadId:null, propietario:titular||null,
          cuit, confianza:cuit?'media':'baja',
          saldo1er:null, saldo2do:null, venc1:null, venc2:null,
          eliminado:false, sel:false,
        })
      } catch(e) {}
    }
    return result
  }

  function parseMtoLocal(s) {
    if (!s) return 0
    const str = s.toString().replace(/\$/g,'').replace(/\s/g,'').trim()
    if (!str) return 0
    // Si tiene coma → formato argentino: quitar puntos de miles, coma → punto decimal
    if (str.includes(',')) return parseFloat(str.replace(/\./g,'').replace(',','.')) || 0
    // Si solo tiene punto → número estándar (CSV bancarios usan punto decimal)
    return parseFloat(str) || 0
  }

  // Enriquecer con datos de BD — cruza UFs y obtiene saldos/vencimientos
  async function enriquecerConBD(regs) {
    // Para transferencia_siro, el consorcioId viene del consorcio activo
    const cIds = [...new Set([
      ...regs.filter(r=>r.consorcioId).map(r=>r.consorcioId),
      ...(sistema==='transferencia_siro' && consorcioId ? [consorcioId] : [])
    ])]
    if (!cIds.length) return regs
    const { data: exps } = await supabase.from('con_expensas')
      .select('id,consorcio_id,periodo,fecha_vencimiento,dias_gracia')
      .in('consorcio_id', cIds).eq('periodo','2026-05')
    const { data: dets } = await supabase.from('con_expensas_detalle')
      .select('id,unidad_id,consorcio_id,expensa_id,monto,saldo_anterior,pagos_periodo,estado,fecha_pago')
      .in('consorcio_id', cIds)
    const { data: ufs } = await supabase.from('con_unidades')
      .select('id,numero,descripcion,consorcio_id,propietario_id')
      .in('consorcio_id', cIds)
    if (!dets || !ufs) return regs
    // Construir mapa consorcio+nroUF → datos
    const mapaUF = {}
    for (const d of dets) {
      const uf = ufs.find(u => u.id === d.unidad_id)
      if (!uf) continue
      const numN = parseInt((uf.numero||'').replace(/\D/g,'')) || 0
      const exp  = exps?.find(e => e.id === d.expensa_id)
      const fv1  = exp?.fecha_vencimiento
      const dias = exp?.dias_gracia || 5
      let fv2 = null
      if (fv1) { const d2=new Date(fv1); d2.setDate(d2.getDate()+dias); fv2=d2.toISOString().slice(0,10) }
      const s1 = parseFloat(d.saldo_anterior||0) + parseFloat(d.monto||0)
      const s2 = parseFloat((s1*1.03).toFixed(2))
      const key = `${d.consorcio_id}__${numN}`
      if (!mapaUF[key]) mapaUF[key] = {
        unidadId:uf.id, ufLabel:uf.numero||String(numN),
        s1, s2, fv1, fv2,
        pagoPrevio:parseFloat(d.pagos_periodo||0),
        estadoUF:d.estado,
      }
    }
    // Mapa de copropietarios por apellido para fallback por nombre pagador
    const { data: copros } = await supabase.from('con_copropietarios')
      .select('id,apellido_nombre')
    const mapaCopro = {}
    if (copros) for (const cp of copros) {
      const key = cp.apellido_nombre?.toUpperCase().replace(/[^A-Z]/g,' ').trim().split(/\s+/).slice(0,2).join(' ')
      if (key) mapaCopro[key] = cp.id
    }
    // Mapa unidadId → coproId para buscar por nombre
    const mapaUFpropietario = {}
    for (const uf of (ufs||[])) {
      if (uf.propietario_id) mapaUFpropietario[uf.propietario_id] = uf
    }

    return regs.map(r => {
      const cid = r.consorcioId || (sistema==='transferencia_siro' ? consorcioId : null)
      if (!cid) return r
      let found = r.nroUF ? mapaUF[`${cid}__${r.nroUF}`] : null
      // Fallback: buscar por nombre del pagador si no hay nroUF o no se encontró
      if (!found && r.nombrePagador) {
        const nomKey = r.nombrePagador.toUpperCase().replace(/[^A-Z]/g,' ').trim().split(/\s+/).slice(0,2).join(' ')
        const coproId = mapaCopro[nomKey]
        if (coproId) {
          const ufMatch = Object.values(mapaUFpropietario).find(u => u.propietario_id===coproId && u.consorcio_id===cid)
          if (ufMatch) {
            const numN = parseInt((ufMatch.numero||'').replace(/\D/g,'')) || 0
            found = mapaUF[`${cid}__${numN}`]
          }
        }
      }
      if (!found) return { ...r, consorcioId: cid }
      return { ...r,
        consorcioId: cid,
        unidadId:found.unidadId, ufLabel:found.ufLabel,
        saldo1er:found.s1, saldo2do:found.s2,
        venc1:found.fv1, venc2:found.fv2,
        estadoUF:found.estadoUF,
        confianza: (r.tipo==='SIRO'||r.tipo==='transferencia_siro') ? (found.unidadId?'alta':'media') : r.confianza,
      }
    })
  }

  async function procesarArchivo(file) {
    setMsg(null); setArchivo(file); setArchNom(file.name)
    const texto = await file.text()
    setProcesando(true)
    try {
      let regs = []
      if (sistema==='siro_multi')        regs = parsearSIROMulti(texto, todosConsorcios)
      else if (sistema==='siro')         regs = parsearSIROmono(texto)
      else if (sistema==='expensas_pagas') regs = parsearEP(texto)
      else                               regs = parsearBancoCsv(texto)
      const enr = await enriquecerConBD(regs)
      setRegistros(enr)
      setPaso(2)
      setMsg({ tipo:'info', texto:`✓ ${enr.length} registros detectados — Total: ${fmtN(enr.reduce((a,r)=>a+r.importe,0))}` })
    } catch(e) {
      setMsg({ tipo:'error', texto:'Error procesando: '+e.message })
    }
    setProcesando(false)
  }

  // ── MUTACIONES DE REGISTROS ──────────────────────────────────────────────
  const eliminar  = id => setRegistros(p=>p.map(r=>r._id===id?{...r,eliminado:true,sel:false}:r))
  const restaurar = id => setRegistros(p=>p.map(r=>r._id===id?{...r,eliminado:false}:r))
  const toggleSel = id => setRegistros(p=>p.map(r=>r._id===id?{...r,sel:!r.sel}:r))
  const eliminarSel = () => setRegistros(p=>p.map(r=>r.sel?{...r,eliminado:true,sel:false}:r))
  const toggleTodos = (ids) => {
    const todosOn = ids.every(id=>registros.find(r=>r._id===id)?.sel)
    setRegistros(p=>p.map(r=>ids.includes(r._id)?{...r,sel:!todosOn}:r))
  }

  // ── CONFIRMAR PROCESO ────────────────────────────────────────────────────
  async function confirmarProceso() {
    if (!expSel) { setMsg({ tipo:'warn', texto:'Seleccioná el período antes de confirmar' }); return }
    setProcesando(true); setMsg(null)
    const activos  = registros.filter(r=>!r.eliminado)
    const paraImputar = activos.filter(r=>r.confianza==='alta'&&r.unidadId&&r.estadoUF!=='pagada')
    let ok=0, errores=[], sinMatch=[]

    for (const r of paraImputar) {
      const { data:existe } = await supabase.from('con_cobranzas').select('id')
        .eq('unidad_id',r.unidadId).eq('expensa_id',expSel)
        .eq('monto',r.importe).limit(1)
      if (existe?.length>0) { sinMatch.push(`UF ${r.ufLabel}: duplicado`); continue }

      const { error } = await supabase.from('con_cobranzas').insert([{
        id:`COB-AUTO2-${r.unidadId}-${Date.now()}-${ok}`,
        admin_id:session.user.id, consorcio_id:r.consorcioId,
        expensa_id:expSel, unidad_id:r.unidadId,
        fecha:r.fechaAcred||r.fechaPago||hoy,
        monto:r.importe, medio_pago:'transferencia',
        canal_cobro:r.canal, estado:'vigente',
        notas:`Auto importado ${r.tipo} — ${archNom}`,
      }])
      if (!error) {
        const { data:det } = await supabase.from('con_expensas_detalle').select('pagos_periodo,monto')
          .eq('expensa_id',expSel).eq('unidad_id',r.unidadId).single()
        if (det) {
          const np = (parseFloat(det.pagos_periodo)||0)+r.importe
          await supabase.from('con_expensas_detalle').update({
            pagos_periodo:np, estado:np>=(det.monto||0)?'pagada':'pendiente'
          }).eq('expensa_id',expSel).eq('unidad_id',r.unidadId)
        }
        ok++
      } else errores.push(error.message)
    }

    const pending = activos.filter(r=>r.confianza!=='alta'||!r.unidadId)
    await supabase.from('con_cobranzas_automaticas_log').insert([{
      id:`LOG2-${Date.now()}`, admin_id:session.user.id,
      consorcio_id:consorcioId, expensa_id:expSel, sistema,
      archivo_nombre:archNom, fecha_proceso:hoy,
      total_registros:activos.length, registros_ok:ok,
      registros_error:errores.length+sinMatch.length+registros.filter(r=>r.eliminado).length,
      total_importe:paraImputar.reduce((a,r)=>a+r.importe,0),
      detalle_errores:[...errores,...sinMatch].join('\n')||null,
    }])

    setConfirmResult({
      imputados:ok, pendientes:pending.length,
      eliminados:registros.filter(r=>r.eliminado).length,
      importeImp:paraImputar.slice(0,ok).reduce((a,r)=>a+r.importe,0),
    })
    setPaso(3)
    cargarHistorial()
    setProcesando(false)
  }

  useEffect(() => { if (consorcioId) { cargarConfig(); cargarHistorial() } }, [consorcioId])
  useEffect(() => {
    supabase.from('con_consorcios').select('id,nombre')
      .eq('admin_id', session.user.id).order('nombre')
      .then(({ data }) => setTodosConsorcios(data || []))
  }, [])

  // ── API SIRO ROELA ───────────────────────────────────────────────────────
  async function consultarAPIRoela() {
    if (!config?.siro_api_usuario || !config?.siro_api_password)
      return setMsg({ tipo:'warn', texto:'Configurá usuario y contraseña API de SIRO primero' })
    if (!expSel) return setMsg({ tipo:'warn', texto:'Seleccioná el período primero' })
    setCargandoSiro(true); setMsg(null)
    try {
      const tokenRes = await fetch('https://apisiro.bancoroela.com.ar:49220/auth/singin', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ Usuario:config.siro_api_usuario, Password:config.siro_api_password })
      })
      if (!tokenRes.ok) throw new Error(`Error autenticación SIRO: ${tokenRes.status}`)
      const { access_token } = await tokenRes.json()
      const exp = expensas.find(e=>e.id===expSel)
      const [y,m] = (exp?.periodo||'').split('-')
      const fd = `${y}${m}01`, fh = `${y}${m}${new Date(parseInt(y),parseInt(m),0).getDate()}`
      const listadoRes = await fetch('https://apisiro.bancoroela.com.ar:49220/siro/Listados/Proceso', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`bearer ${access_token}`},
        body: JSON.stringify({ cuit_administrador:config.siro_cuit_admin||config.siro_api_usuario,
          fecha_desde:fd, fecha_hasta:fh, nro_convenio:config.siro_convenio_id })
      })
      if (!listadoRes.ok) throw new Error(`Error SIRO API: ${listadoRes.status}`)
      const listado = await listadoRes.json()
      const registrosApi = listado.data || listado || []
      let ok=0, sinMatch=[]
      for (const pago of registrosApi) {
        const nroRef = String(pago.nro_referencia||pago.cliente||'')
        const uf = unidades.find(u=>u.nro_siro===nroRef||u.numero===nroRef)
        if (!uf) { sinMatch.push(nroRef); continue }
        const monto = parseFloat(pago.importe_pagado||pago.importe||0)
        const fecha = pago.fecha_pago||hoy
        const { error } = await supabase.from('con_cobranzas').insert([{
          id:`COB-SIRO-API-${uf.id}-${Date.now()}-${ok}`,
          admin_id:session.user.id, consorcio_id:consorcioId, expensa_id:expSel,
          unidad_id:uf.id, fecha, monto, medio_pago:'siro',
          canal_cobro:pago.canal||'SIRO API', estado:'vigente',
          notas:`SIRO API — ${pago.nro_comprobante||''}`,
        }])
        if (!error) {
          ok++
          const { data:det } = await supabase.from('con_expensas_detalle').select('pagos_periodo,monto')
            .eq('expensa_id',expSel).eq('unidad_id',uf.id).single()
          if (det) {
            const np=(parseFloat(det.pagos_periodo)||0)+monto
            await supabase.from('con_expensas_detalle').update({
              pagos_periodo:np, estado:np>=(det.monto||0)?'pagada':'pendiente'
            }).eq('expensa_id',expSel).eq('unidad_id',uf.id)
          }
        }
      }
      setMsg({ tipo:'ok', texto:`✓ API SIRO: ${ok} pagos importados · ${sinMatch.length} sin coincidencia` })
      setSiroConectado(true); cargarHistorial()
    } catch(e) { setMsg({ tipo:'error', texto:'Error API SIRO: '+e.message }) }
    setCargandoSiro(false)
  }

  // ── HELPERS DE RENDER ────────────────────────────────────────────────────
  const activos  = registros.filter(r=>!r.eliminado)
  const nAlta  = activos.filter(r=>r.confianza==='alta').length
  const nMed   = activos.filter(r=>r.confianza==='media').length
  const nBaja  = activos.filter(r=>r.confianza==='baja').length
  const nElim  = registros.filter(r=>r.eliminado).length
  const nSel   = activos.filter(r=>r.sel).length
  const totalImp = activos.reduce((a,r)=>a+r.importe,0)
  const selIds   = activos.map(r=>r._id)

  const periodoLabel = p => {
    if (!p) return '—'
    const [y,m] = p.split('-')
    const mes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return m ? `${mes[parseInt(m)-1]} ${y}` : p
  }

  const badgeTipo = t => {
    const m = {SIRO:['#dbeafe','#1d4ed8'],EP:['#ede9fe','#5b21b6'],BANCO:['#d1fae5','#065f46']}
    const [bg,c] = m[t]||['#f3f4f6','#374151']
    return <span style={{ padding:'2px 8px',borderRadius:4,fontSize:10.5,fontWeight:700,background:bg,color:c }}>{t}</span>
  }
  const badgeConf = c => {
    const m = {alta:['#dcfce7','#14532d'],media:['#fef9c3','#854d0e'],baja:['#fee2e2','#991b1b']}
    const [bg,col] = m[c]||m.baja
    return <span style={{ padding:'2px 8px',borderRadius:4,fontSize:10.5,fontWeight:700,background:bg,color:col }}>{c==='alta'?'Alta':c==='media'?'Media':'Baja'}</span>
  }

  // ── RENDER PASO 3: RESULTADO ─────────────────────────────────────────────
  if (tab==='importar' && paso===3 && confirmResult) return (
    <div>
      <div style={{ fontWeight:700,fontSize:15,marginBottom:4 }}>🏦 Cobranzas automáticas</div>
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:18,padding:'12px 16px',
        background:'#f0fdf4',borderRadius:10,border:'1px solid #86efac' }}>
        <span style={{ fontSize:22 }}>✓</span>
        <div style={{ fontWeight:700,fontSize:15,color:'#15803d' }}>Proceso completado — {archNom}</div>
      </div>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12,marginBottom:18 }}>
        {[
          { l:'Imputados automáticamente',v:confirmResult.imputados,imp:fmtN(confirmResult.importeImp),bg:'#f0fdf4',c:'#15803d' },
          { l:'Pendientes manuales',v:confirmResult.pendientes,imp:'',bg:'#fefce8',c:'#a16207' },
          { l:'Registros eliminados',v:confirmResult.eliminados,imp:'',bg:'#f9fafb',c:'#9ca3af' },
        ].map(({l,v,imp,bg,c})=>(
          <div key={l} style={{ background:bg,borderRadius:10,padding:'14px 16px' }}>
            <div style={{ fontSize:22,fontWeight:800,color:c,lineHeight:1 }}>{v}</div>
            <div style={{ fontSize:13,fontWeight:600,color:c,marginTop:3 }}>{l}</div>
            {imp && <div style={{ fontSize:12,color:c,opacity:.8,marginTop:2 }}>{imp}</div>}
          </div>
        ))}
      </div>
      <div style={{ background:'#f8fafc',borderRadius:8,padding:'12px 14px',fontSize:12.5,color:'#374151',lineHeight:1.8,marginBottom:14 }}>
        <strong>Próximos pasos:</strong><br/>
        • Los pagos imputados están disponibles en <strong>Cobranzas</strong> del consorcio correspondiente.<br/>
        • Los {confirmResult.pendientes} registros pendientes deben asignarse desde <strong>Cobranzas → pendientes manuales</strong>.<br/>
        • Los registros eliminados no generaron cobranza.
      </div>
      <Btn onClick={()=>{setPaso(1);setRegistros([]);setArchivo(null);setArchNom('');setConfirmResult(null)}}>
        ← Cargar nuevo archivo
      </Btn>
    </div>
  )

  // ── RENDER PASO 2: REVISIÓN ──────────────────────────────────────────────
  if (tab==='importar' && paso===2) return (
    <div style={{ fontFamily:'system-ui,sans-serif',fontSize:13 }}>
      <div style={{ fontWeight:700,fontSize:15,marginBottom:4 }}>🏦 Cobranzas automáticas</div>

      {/* Selector de período */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:12,padding:'10px 14px',background:'#f8fafc',borderRadius:8 }}>
        <div style={{ fontSize:12.5,fontWeight:600,color:GR,whiteSpace:'nowrap' }}>Período a imputar:</div>
        <select value={expSel} onChange={e=>setExpSel(e.target.value)}
          style={{ padding:'6px 10px',border:'1px solid #d1d5db',borderRadius:7,fontSize:12.5,flex:1 }}>
          <option value="">— Seleccione período —</option>
          {expensas.map(e=>(<option key={e.id} value={e.id}>{periodoLabel(e.periodo)}</option>))}
        </select>
        {!expSel && <span style={{ fontSize:11.5,color:AM }}>⚠️ Requerido para confirmar</span>}
      </div>

      {/* Encabezado tabla */}
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',
        marginBottom:10,paddingBottom:10,borderBottom:'1.5px solid #e5e7eb' }}>
        <div>
          <div style={{ fontWeight:700,fontSize:14,color:AZ }}>Cobranza simplificada — Revisión</div>
          <div style={{ fontSize:11.5,color:GR,marginTop:2 }}>
            {archNom} · {activos.length} registros · Total: <strong>{fmtN(totalImp)}</strong>
          </div>
        </div>
        <div style={{ display:'flex',gap:8 }}>
          <BtnSec onClick={()=>{setPaso(1);setRegistros([]);setArchivo(null)}}>← Cerrar</BtnSec>
          <Btn disabled={procesando||nAlta===0||!expSel} onClick={confirmarProceso}
            style={{ opacity:(procesando||nAlta===0||!expSel)?0.5:1 }}>
            {procesando?'⏳ Procesando...':'✓ Guardar'}
          </Btn>
        </div>
      </div>

      {/* Métricas */}
      <div style={{ display:'flex',gap:8,marginBottom:10,flexWrap:'wrap' }}>
        {[
          {l:'Total',v:activos.length,bg:'#f1f5f9',c:'#475569'},
          {l:'Alta confianza',v:nAlta,bg:'#f0fdf4',c:'#15803d'},
          {l:'Media',v:nMed,bg:'#fefce8',c:'#a16207'},
          {l:'Baja / pendiente',v:nBaja,bg:'#fef2f2',c:'#b91c1c'},
          {l:'Eliminados',v:nElim,bg:'#f9fafb',c:'#9ca3af'},
        ].map(({l,v,bg,c})=>(
          <div key={l} style={{ background:bg,borderRadius:8,padding:'8px 12px',flex:1,minWidth:70 }}>
            <div style={{ fontSize:18,fontWeight:800,color:c,lineHeight:1 }}>{v}</div>
            <div style={{ fontSize:10.5,color:c,marginTop:2,opacity:.85 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display:'flex',gap:7,marginBottom:10,alignItems:'center',flexWrap:'wrap' }}>
        <button style={{ padding:'6px 12px',border:`1px solid #e5e7eb`,borderRadius:7,background:'#fff',
          color:'#374151',fontSize:12.5,cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}>
          ＋ Agregar línea
        </button>
        <select style={{ padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:7,fontSize:12.5,background:'#fff' }}>
          <option>Medio de pago</option>
          <option>Transferencia</option>
          <option>Efectivo</option>
        </select>
        <div style={{ flex:1 }}/>
        <button disabled={nSel===0}
          onClick={eliminarSel}
          style={{ padding:'6px 14px',background:nSel>0?'#fef2f2':'#f9fafb',color:nSel>0?'#dc2626':'#9ca3af',
            border:`1px solid ${nSel>0?'#fca5a5':'#e5e7eb'}`,borderRadius:7,fontSize:12.5,cursor:nSel>0?'pointer':'not-allowed',fontWeight:600 }}>
          ✕ Eliminar{nSel>0?` (${nSel})`:''} línea
        </button>
      </div>

      {/* Tabla */}
      <div style={{ border:'1px solid #e5e7eb',borderRadius:10,overflow:'hidden',background:'#fff',marginBottom:10 }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%',borderCollapse:'collapse',fontSize:12 }}>
            <thead>
              <tr style={{ background:'#f8fafc',borderBottom:'1.5px solid #e5e7eb' }}>
                <th style={{ width:30,padding:'8px 10px',textAlign:'center' }}>
                  <input type="checkbox"
                    checked={selIds.length>0&&selIds.every(id=>registros.find(r=>r._id===id)?.sel)}
                    onChange={()=>toggleTodos(selIds)}/>
                </th>
                {['Fecha','Tipo','Consorcio','Unidad','Propietario / Canal',
                  'Saldo\n1er Venc.','Saldo calc.\n2do Venc.','Pago','Cuenta / Conf.','Acción'
                ].map((h,i)=>(
                  <th key={i} style={{ padding:'8px 10px',textAlign:i>=5&&i<=7?'right':'left',
                    fontWeight:600,color:'#374151',whiteSpace:'pre',fontSize:11.5,
                    ...(i===7?{color:AZ}:{}) }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registros.length===0 && (
                <tr><td colSpan={10} style={{ padding:36,textAlign:'center',color:GR }}>Sin registros</td></tr>
              )}
              {registros.map(r => {
                const st = r.eliminado?{ opacity:.35,textDecoration:'line-through' }:{}
                return (
                  <tr key={r._id} style={{
                    borderBottom:'1px solid #f1f5f9',
                    background: r.eliminado?'#f9fafb': r.sel?'#eff6ff': r.estadoUF==='pagada'?'#fffbeb':'#fff'
                  }}>
                    <td style={{ padding:'6px 10px',textAlign:'center' }}>
                      {!r.eliminado&&<input type="checkbox" checked={!!r.sel} onChange={()=>toggleSel(r._id)}/>}
                    </td>
                    <td style={{ padding:'6px 10px',...st }}>{r.fechaPago||'—'}</td>
                    <td style={{ padding:'6px 10px' }}>{badgeTipo(r.tipo)}</td>
                    <td style={{ padding:'6px 10px',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',...st }}>
                      {r.consorcioId
                        ? <span><span style={{ color:GR,fontSize:10 }}>{r.consorcioId}-</span>
                            {(r.consorcioNombre||'').replace(/CONSORCIO\s*/gi,'').replace(/EDIF\.\s*/gi,'').trim().slice(0,20)}
                          </span>
                        : <span style={{ color:RJ,fontSize:10.5 }}>⚠ Sin identificar</span>
                      }
                    </td>
                    <td style={{ padding:'6px 10px',whiteSpace:'nowrap',...st }}>
                      {r.ufLabel!=='—'
                        ? <span><span style={{ color:GR,fontSize:10 }}>{r.ufLabel}-</span>{(r.propietario||'').slice(0,14)}</span>
                        : <span style={{ color:'#d1d5db' }}>—</span>
                      }
                    </td>
                    <td style={{ padding:'6px 10px',color:GR,maxWidth:110,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',...st }}>
                      {r.canal}
                    </td>
                    <td style={{ padding:'6px 12px',textAlign:'right',whiteSpace:'nowrap',...st }}>
                      <span style={{ color:r.saldo1er?'#374151':'#d1d5db' }}>
                        {r.saldo1er?fmtN(r.saldo1er):'0.00'}
                      </span>
                      {r.venc1&&<div style={{ fontSize:9.5,color:GR }}>{r.venc1}</div>}
                    </td>
                    <td style={{ padding:'6px 12px',textAlign:'right',whiteSpace:'nowrap',...st }}>
                      <span style={{ color:r.saldo2do?RJ:'#d1d5db' }}>
                        {r.saldo2do?fmtN(r.saldo2do):'0.00'}
                      </span>
                      {r.venc2&&<div style={{ fontSize:9.5,color:GR }}>{r.venc2}</div>}
                    </td>
                    <td style={{ padding:'6px 12px',textAlign:'right',whiteSpace:'nowrap' }}>
                      <span style={{ fontWeight:700,fontSize:13,color:r.eliminado?GR:AZ,...st }}>
                        {fmtN(r.importe)}
                      </span>
                      {r.estadoUF==='pagada'&&<div style={{ fontSize:9.5,color:AM,fontWeight:600 }}>⚠ Ya pagado</div>}
                    </td>
                    <td style={{ padding:'6px 10px' }}>
                      {r.eliminado
                        ? <span style={{ fontSize:11,color:GR,fontStyle:'italic' }}>eliminado</span>
                        : <div>
                            <div style={{ color:'#374151',fontSize:11,...st }}>{(r.consorcioNombre||'').slice(0,16)}</div>
                            {badgeConf(r.confianza)}
                          </div>
                      }
                    </td>
                    <td style={{ padding:'6px 10px',textAlign:'center' }}>
                      {r.eliminado
                        ? <button onClick={()=>restaurar(r._id)}
                            style={{ padding:'3px 8px',background:'#f1f5f9',border:'1px solid #e5e7eb',
                              borderRadius:5,fontSize:11,cursor:'pointer',color:'#475569' }}>↩</button>
                        : <button onClick={()=>eliminar(r._id)}
                            style={{ padding:'3px 8px',background:'#fef2f2',border:'1px solid #fca5a5',
                              borderRadius:5,fontSize:11,cursor:'pointer',color:RJ,fontWeight:700 }}>✕</button>
                      }
                    </td>
                  </tr>
                )
              })}
              {/* Fila de totales */}
              {activos.length>0 && (
                <tr style={{ background:'#f1f5f9',borderTop:'1.5px solid #e5e7eb',fontWeight:700 }}>
                  <td colSpan={6} style={{ padding:'8px 12px',color:'#374151',fontSize:12 }}>
                    Total ({activos.length} activos)
                  </td>
                  <td style={{ padding:'8px 12px',textAlign:'right',color:'#374151',fontSize:12 }}>
                    {fmtN(activos.reduce((a,r)=>a+(r.saldo1er||0),0))}
                  </td>
                  <td style={{ padding:'8px 12px',textAlign:'right',color:RJ,fontSize:12 }}>
                    {fmtN(activos.reduce((a,r)=>a+(r.saldo2do||0),0))}
                  </td>
                  <td style={{ padding:'8px 12px',textAlign:'right',color:AZ,fontSize:12 }}>
                    {fmtN(totalImp)}
                  </td>
                  <td colSpan={2}/>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pie */}
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:7 }}>
        <div style={{ fontSize:11.5,color:GR }}>{registros.length} registros · {nElim} eliminados{nSel>0?` · ${nSel} seleccionados`:''}</div>
        <div style={{ display:'flex',gap:7,flexWrap:'wrap' }}>
          <span style={{ padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,background:'#f0fdf4',color:'#15803d' }}>
            {nAlta} se imputarán automáticamente
          </span>
          <span style={{ padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,background:'#fef9c3',color:'#a16207' }}>
            {nMed} con CUIT (media)
          </span>
          <span style={{ padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,background:'#fee2e2',color:'#b91c1c' }}>
            {nBaja} pendientes manuales
          </span>
        </div>
      </div>
      {msg && <Msg data={msg}/>}
    </div>
  )

  // ── RENDER PASO 1: CARGA + RESTO DE TABS ────────────────────────────────
  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>🏦 Cobranzas automáticas</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Importar pagos desde sistemas de cobranza y registrarlos automáticamente
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:'2px solid #e5e7eb' }}>
        {[
          { id:'importar', l:'📥 Importar archivo' },
          { id:'api',      l:'🔌 API SIRO Roela' },
          { id:'config',   l:'⚙️ Configuración' },
          { id:'historial',l:'📋 Historial' },
        ].map(t => (
          <button key={t.id} onClick={()=>{ setTab(t.id); if(t.id==='importar') setPaso(1) }}
            style={{ padding:'8px 16px', border:'none', borderBottom: tab===t.id ?`2px solid ${AZ}`:'2px solid transparent',
              background:'transparent', color: tab===t.id ? AZ : GR, fontWeight: tab===t.id ? 700 : 400,
              fontSize:13, cursor:'pointer', marginBottom:-2 }}>
            {t.l}
          </button>
        ))}
      </div>

      <Msg data={msg} />

      {/* ── TAB: IMPORTAR ARCHIVO ── */}
      {tab === 'importar' && (
        <div>
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>
              Seleccionar sistema y archivo
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Sistema de cobranza</div>
                <select value={sistema} onChange={e=>setSistema(e.target.value)}
                  style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
                  <option value="transferencia_siro">SIRO — Transferencias bancarias (TransferenciasSiro)</option>
                  <option value="siro_multi">SIRO Roela — Multi-consorcio (recomendado)</option>
                  <option value="siro">SIRO Roela — Un consorcio</option>
                  <option value="expensas_pagas">Expensas Pagas (archivo RD)</option>
                  <option value="banco_csv">Banco — CSV (Macro / Galicia / Provincia)</option>
                </select>
              </div>
              <Sel label="Período a imputar" value={expSel} onChange={setExpSel}
                opts={[{v:'',l:'— Seleccione período —'},
                  ...expensas.map(e => ({ v:e.id, l:`${periodoLabel(e.periodo)} — ${e.tipo||''}` }))
                ]} />
            </div>

            {/* Drop zone */}
            <div style={{ border:'2px dashed #bfdbfe',borderRadius:12,padding:'36px 24px',textAlign:'center',
              cursor:'pointer',background:'#f8fbff' }}
              onDragOver={e=>e.preventDefault()}
              onDrop={e=>{e.preventDefault();const f=e.dataTransfer?.files?.[0];if(f)procesarArchivo(f)}}
              onClick={()=>document.getElementById('cb-file-input').click()}>
              <div style={{ fontSize:32,marginBottom:8 }}>📂</div>
              <div style={{ fontWeight:700,fontSize:14,color:AZ,marginBottom:4 }}>
                Arrastrá el archivo o hacé clic para seleccionar
              </div>
              <div style={{ fontSize:12,color:GR }}>TXT · CSV · Archivos de texto (SIRO, Expensas Pagas, bancos)</div>
              <input id="cb-file-input" type="file" accept=".txt,.csv,.text,text/*"
                onChange={e=>e.target.files[0]&&procesarArchivo(e.target.files[0])}
                style={{ display:'none' }}/>
            </div>

            {procesando && (
              <div style={{ marginTop:12,textAlign:'center',color:GR,fontSize:13 }}>⏳ Procesando archivo...</div>
            )}

            {/* Guía de formatos */}
            <div style={{ marginTop:14,padding:'10px 14px',background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:8,fontSize:11,color:'#0369a1' }}>
              <strong>Formatos:</strong>&nbsp;
              <span style={{ marginRight:12 }}>● SIRO TXT 125 chars/línea → Alta confianza (consorcio + UF exacto)</span>
              <span style={{ marginRight:12 }}>● EP RD → Solo totales (sin UF) → Baja confianza</span>
              <span style={{ marginRight:12 }}>● CSV con CUIT → Media confianza</span>
              <span>● CSV solo apellido → Baja confianza</span>
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB: API SIRO ── */}
      {tab === 'api' && (
        <div>
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>
              🔌 Integración directa con API SIRO Banco Roela
            </div>
            <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8,
              padding:'12px 14px', fontSize:12, marginBottom:16 }}>
              Consulta los pagos directamente desde el servidor de SIRO sin necesidad de descargar archivos manualmente.
              Requiere credenciales API provistas por su ejecutivo de cuentas en Banco Roela.
            </div>
            <Sel label="Período a importar" value={expSel} onChange={setExpSel}
              opts={[{v:'',l:'— Seleccione período —'},
                ...expensas.map(e => ({ v:e.id, l:`${periodoLabel(e.periodo)} — ${e.tipo||''}` }))
              ]} />
            <div style={{ marginTop:14, display:'flex', gap:8 }}>
              <Btn onClick={consultarAPIRoela} disabled={cargandoSiro || !expSel || !config?.siro_api_usuario}
                style={{ background: config?.siro_api_usuario ? AZ : GR }}>
                {cargandoSiro ? '⏳ Consultando SIRO...' : '🔌 Consultar y registrar pagos'}
              </Btn>
            </div>
            {!config?.siro_api_usuario && (
              <div style={{ marginTop:10, fontSize:12, color:AM }}>
                ⚠️ Configurá las credenciales API en la pestaña ⚙️ Configuración
              </div>
            )}
            {siroConectado && (
              <div style={{ marginTop:10, fontSize:12, color:VD, fontWeight:600 }}>
                ✓ Conectado a API SIRO Banco Roela
              </div>
            )}
          </Card>
          <Card style={{ background:'#eff6ff', border:'1px solid #bfdbfe' }}>
            <div style={{ fontWeight:600, fontSize:13, color:AZ, marginBottom:10 }}>
              ¿Cómo obtener las credenciales API?
            </div>
            <div style={{ fontSize:12, color:'#374151', lineHeight:1.9 }}>
              1. Contactar a Banco Roela: <strong>mesadeayuda@bancoroela.com.ar</strong><br/>
              2. WhatsApp desarrolladores: <strong>+54 9 3513 95-1668</strong><br/>
              3. Indicar: número de convenio SIRO + CUIT del administrador<br/>
              4. Solicitar activación de <strong>API SIRO</strong> (gestión de cobranzas)<br/>
              5. Banco Roela proveerá: usuario API + contraseña API
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB: CONFIGURACIÓN ── */}
      {tab === 'config' && config && (
        <div>
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>
              Expensas Pagas
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
              <div>
                <label style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, fontSize:13 }}>
                  <input type="checkbox" checked={config.ep_activo||false}
                    onChange={e=>setConfig(c=>({...c,ep_activo:e.target.checked}))} />
                  <strong>Activo</strong>
                </label>
              </div>
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Código EP (4 dígitos)</div>
                <input value={config.ep_convenio_id||''} placeholder="ej: 0145"
                  onChange={e=>setConfig(c=>({...c,ep_convenio_id:e.target.value}))}
                  style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>ID Consorcio EP</div>
                <input value={config.ep_consorcio_id||''} placeholder="ej: 1872"
                  onChange={e=>setConfig(c=>({...c,ep_consorcio_id:e.target.value}))}
                  style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
              </div>
            </div>
          </Card>
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>
              SIRO Banco Roela
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <div>
                <label style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, fontSize:13 }}>
                  <input type="checkbox" checked={config.siro_activo||false}
                    onChange={e=>setConfig(c=>({...c,siro_activo:e.target.checked}))} />
                  <strong>SIRO activo</strong>
                </label>
              </div>
              <div>
                <label style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, fontSize:13 }}>
                  <input type="checkbox" checked={config.siro_api_activo||false}
                    onChange={e=>setConfig(c=>({...c,siro_api_activo:e.target.checked}))} />
                  <strong>API activa</strong>
                </label>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              {[
                { k:'siro_convenio_id',  l:'Nro. convenio (10 dígitos)', p:'ej: 0000001234' },
                { k:'siro_codigo_interno',l:'Código interno (4 dígitos)', p:'ej: 0024 · 1139 · 0005 · 0006' },
                { k:'siro_cuit_admin',   l:'CUIT administrador',          p:'ej: 20186006802' },
                { k:'siro_api_usuario',  l:'Usuario API',                  p:'Provisto por Banco Roela' },
                { k:'siro_api_password', l:'Contraseña API',               p:'Provisto por Banco Roela' },
              ].map(f => (
                <div key={f.k}>
                  <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>{f.l}</div>
                  <input type={f.k.includes('password')?'password':'text'}
                    value={config[f.k]||''} placeholder={f.p}
                    onChange={e=>setConfig(c=>({...c,[f.k]:e.target.value}))}
                    style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                </div>
              ))}
            </div>
            <div style={{ marginTop:8, padding:'10px 14px', background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:8, fontSize:11, color:'#0369a1' }}>
              <strong>Códigos internos SIRO según cuenta Roela:</strong>&nbsp;
              Triplex Nayades=0024 · Gulliver=0005 · Constitución=0006 · Bunge 1139=1139 · Bonito II=0022
            </div>
          </Card>
          <Btn onClick={guardarConfig}>✓ Guardar configuración</Btn>
        </div>
      )}

      {/* ── TAB: HISTORIAL ── */}
      {tab === 'historial' && (
        <Card>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>
            Últimas importaciones ({historial.length})
          </div>
          {historial.length === 0 ? (
            <div style={{ color:GR, fontSize:13, padding:'16px 0' }}>Sin importaciones previas</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Fecha','Sistema','Archivo','Período','OK','Errores','Total'].map((h,i) => (
                    <th key={i} style={{ padding:'7px 10px', textAlign:i>=4?'center':'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historial.map(h => (
                  <tr key={h.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>
                      {new Date(h.created_at).toLocaleDateString('es-AR')}
                    </td>
                    <td style={{ padding:'7px 10px' }}>
                      <Badge text={h.sistema==='expensas_pagas'?'Exp. Pagas':h.sistema==='siro_multi'?'SIRO Multi':'SIRO'}
                        color={h.sistema==='expensas_pagas'?AZ:'#7c3aed'}
                        bg={h.sistema==='expensas_pagas'?'#eff6ff':'#faf5ff'} />
                    </td>
                    <td style={{ padding:'7px 10px', fontSize:11, color:GR, maxWidth:150 }}>
                      {h.archivo_nombre}
                    </td>
                    <td style={{ padding:'7px 10px', fontSize:11 }}>
                      {periodoLabel(expensas.find(e=>e.id===h.expensa_id)?.periodo)}
                    </td>
                    <td style={{ padding:'7px 10px', textAlign:'center', color:VD, fontWeight:700 }}>
                      {h.registros_ok}
                    </td>
                    <td style={{ padding:'7px 10px', textAlign:'center',
                      color: h.registros_error > 0 ? RJ : GR, fontWeight: h.registros_error > 0 ? 700 : 400 }}>
                      {h.registros_error || '—'}
                    </td>
                    <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700 }}>
                      {fmtN(h.total_importe)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  )
}
