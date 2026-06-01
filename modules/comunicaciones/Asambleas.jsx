import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Asambleas() {
  const { session, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, expensas, setExpensas, proveedores, setProveedores, adminPerfil, setAdminPerfil, cargando, esSuperAdmin, consorcios, setConsorcios, pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, navItems, secciones, navActivo, formCon, setFormCon, msgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [asambleas,  setAsambleas]  = useState([])
  const [vista,      setVista]      = useState('lista')
  const [tabLista,   setTabLista]   = useState('registros')   // 'registros' | 'actas_pdf' | 'mandato'
  const [form,       setForm]       = useState(null)
  const [detalle,    setDetalle]    = useState(null)
  const [tabDet,     setTabDet]     = useState('convocatoria')
  const [msg,        setMsg]        = useState(null)
  const [generando,  setGenerando]  = useState(false)
  const [enviando,   setEnviando]   = useState(false)
  const [actaEdit,   setActaEdit]   = useState('')
  const [transcEdit, setTranscEdit] = useState('')
  const [presentes,  setPresentes]  = useState('')
  const [horaFin,    setHoraFin]    = useState('')
  const [convTxt,    setConvTxt]    = useState('')
  // Actas PDF (tab lista)
  const [subiendoPDF,  setSubiendoPDF]  = useState(false)
  const [pdfSubido,    setPdfSubido]    = useState(null)
  const [analizandoIA, setAnalizandoIA] = useState(false)
  const [iaResultado,  setIaResultado]  = useState(null)
  const [pdfConsorcioId, setPdfConsorcioId] = useState('')
  // Actas PDF (tab detalle)
  const [subiendoPDFDet,  setSubiendoPDFDet]  = useState(false)
  const [analizandoIADet, setAnalizandoIADet] = useState(false)
  const [iaResultadoDet,  setIaResultadoDet]  = useState(null)
  // Mandato (tab lista — nuevo mandato sin asamblea previa)
  const [mandatoLibre, setMandatoLibre] = useState(null)
  const [guardandoML,  setGuardandoML]  = useState(false)
  // Mandato (tab detalle)
  const [mandatoForm,     setMandatoForm]     = useState(null)
  const [guardandoMandato, setGuardandoMandato] = useState(false)

  const PLATS   = [['zoom','Zoom'],['meet','Google Meet'],['teams','Teams'],['jitsi','Jitsi'],['otro','Otra']]
  const EST_L   = { convocatoria:'📋 Convocatoria', realizada:'✅ Realizada', acta_generada:'📄 Acta generada', acta_aprobada:'✔ Acta aprobada' }
  const EST_C   = { convocatoria:AZ, realizada:AM, acta_generada:'#7c3aed', acta_aprobada:VD }
  const fmtF    = d => d ? new Date(d+'T12:00:00').toLocaleDateString('es-AR') : '—'
  const diasR   = d => d ? Math.ceil((new Date(d+'T12:00:00').getTime()-Date.now())/86400000) : null
  const NOTA_RP = 'Nota RPAC (art.2060 CCCN): para ser decisión: más del 50% consorcistas + 50% propiedad (doble mayoría).'
  const consorcioNombre = (cid) => {
    if (!cid) return ''
    if (consorcioActivo?.id === cid) return consorcioActivo?.nombre || ''
    return cid.replace('CON','Consorcio ')
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const crearAlertaCalendario = async ({ cid, descripcion, fecha_vencimiento, fecha_aviso1, fecha_aviso2, tipo, notas }) => {
    const id = 'AGV-'+(cid||consorcioId)+'-'+tipo+'-'+Date.now()
    const { data } = await supabase.from('con_agenda_vencimientos').insert([{
      id, admin_id: session.user.id, consorcio_id: cid||consorcioId,
      tipo, descripcion, fecha_vencimiento, fecha_aviso1, fecha_aviso2,
      estado: 'pendiente', notas, created_at: new Date().toISOString()
    }]).select().single()
    return data?.id || null
  }

  const agregarDias = (fecha, dias) => {
    if (!fecha) return ''
    const d = new Date(fecha+'T12:00:00')
    d.setDate(d.getDate() + dias)
    return d.toISOString().slice(0,10)
  }

  // ── GENERARTEXTO (antes de abrirDetalle — evita TDZ) ─────────────────────
  const generarTexto = (a) => {
    if (!a) return ''
    const cn   = consorcioActivo ? (consorcioActivo.nombre || '...') : '...'
    const tipo = a.tipo === 'ordinaria' ? 'ORDINARIA' : 'EXTRAORDINARIA'
    const tipoL = a.tipo === 'ordinaria' ? 'Ordinaria' : 'Extraordinaria'
    const fC   = a.fecha ? new Date(a.fecha+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '...'
    const fL   = a.fecha ? new Date(a.fecha+'T12:00:00').toLocaleDateString('es-AR',{day:'numeric',month:'long',year:'numeric'}) : '...'
    const plat = a.plataforma_virtual ? (a.plataforma_virtual.charAt(0).toUpperCase()+a.plataforma_virtual.slice(1)) : 'Zoom'
    const od   = (a.orden_del_dia||[]).map((p,i) => (i+1)+'. '+p).join('\n')
    const cab  = 'Del Lenguado 1313 Local 3 — Pinamar\n(02254) 51-6386 / (02267) 15 444035\nadministración@administracionpinamar.com\n\n'
    const firma = '\n\nJavier García Pérez — Administrador — Mat. RPAC N° 83\n\n'+NOTA_RP
    if (a.modalidad === 'virtual' || a.modalidad === 'mixta') {
      const mixta = a.modalidad === 'mixta' ? ('\nPresencial: '+(a.lugar||'...')+' — y a distancia vía '+plat) : ('\nVirtual vía '+plat)
      const clave = a.clave_virtual ? ('Clave: '+a.clave_virtual) : ''
      const moda  = a.modalidad === 'virtual' ? 'modalidad a distancia' : 'modalidad presencial y virtual'
      return cab+'CONVOCATORIA A ASAMBLEA GENERAL '+tipo+'\n'+cn.toUpperCase()+' — PINAMAR\n'+
        mixta+'\n— '+fC+' — '+a.hora+' hs —\n\nDe mi mayor consideración:\n\n'+
        'En carácter de administrador del '+cn+', lo invito a una Asamblea General '+tipoL+
        ' a celebrarse bajo '+moda+' el día '+fL+' a las '+a.hora+' hs.\n\n'+
        'ORDEN DEL DÍA\n'+od+'\n\nIngreso — link de acceso:\n'+
        (a.link_virtual||'[COMPLETAR LINK]')+'\n'+clave+
        '\n\nEs requisito: nombre y apellido visibles; cámara encendida al acreditarse y votar.'+firma
    }
    return cab+'CONVOCATORIA A ASAMBLEA GENERAL '+tipo+'\n'+cn.toUpperCase()+' — PINAMAR\n'+
      (a.lugar ? ('A las '+a.hora+' horas en '+a.lugar+'\n') : '\n')+
      '\nDe mi mayor consideración:\n\nPor la presente, y en mi carácter de Administrador del '+cn+
      ', convoco a Asamblea General '+tipoL+', para el día '+fL+' a las '+a.hora+
      ' horas en '+(a.lugar||'...')+'\n\nORDEN DEL DÍA\n'+od+
      '\n\nSin más por el particular, saluda atte.'+firma
  }

  const cargar = async () => {
    const { data } = await supabase.from('con_asambleas').select('*')
      .eq('admin_id', session.user.id)
      .order('fecha', { ascending:false }).limit(100)
    setAsambleas(data || [])
  }
  useEffect(() => { cargar() }, [])

  const abrirDetalle = (a) => {
    setDetalle({...a})
    setActaEdit(a.acta_borrador || a.acta_final || '')
    setTranscEdit(a.transcripcion || '')
    setPresentes((a.unidades_presentes||[]).join(', '))
    setHoraFin(a.hora_fin || '')
    setTabDet('convocatoria')
    setConvTxt(generarTexto(a))
    setIaResultadoDet(null)
    setMandatoForm(a.mandato_administrador ? {
      fecha_inicio: a.mandato_fecha_inicio || '',
      fecha_fin:    a.mandato_fecha_fin || '',
      duracion_anos: a.mandato_duracion_anos || 1,
      observaciones: a.mandato_observaciones || ''
    } : null)
    setVista('detalle')
  }

  const nuevoForm = (tipo) => {
    const od = tipo === 'ordinaria'
      ? ['Declaración de la validez de la Asamblea.',
         'Designación del Presidente de la Asamblea.',
         'Designación del Secretario de Acta y dos copropietarios para firmarla.',
         'Rendición de cuentas y estado financiero.',
         'Renovación de mandato del administrador o cambio del mismo.',
         'Designación de miembros del Consejo de Propietarios.']
      : ['Declaración de la validez de la Asamblea.',
         'Designación del Presidente de la Asamblea.',
         'Designación del Secretario de Acta y dos copropietarios para firmarla.']
    setForm({ tipo, modalidad:'virtual', hora:'19:00', plataforma_virtual:'zoom', orden_del_dia:od, estado:'convocatoria' })
    setVista('form')
  }

  const guardarForm = async () => {
    if (!form.fecha) return setMsg({ tipo:'warn', texto:'La fecha es requerida' })
    const od = (form.orden_del_dia||[]).filter(p => p.trim())
    const isNueva = !form.id
    const newId = form.id || ('ASM-'+consorcioId+'-'+Date.now())
    const { error } = await supabase.from('con_asambleas').upsert([{
      ...form, id: newId,
      admin_id: session.user.id, consorcio_id: consorcioId,
      orden_del_dia: od, updated_at: new Date().toISOString()
    }], { onConflict:'id' })
    if (error) return setMsg({ tipo:'error', texto:error.message })
    if (isNueva && form.fecha) {
      const alertaId = await crearAlertaCalendario({
        cid: consorcioId,
        descripcion: 'Asamblea General '+(form.tipo==='ordinaria'?'Ordinaria':'Extraordinaria')+' — '+(consorcioActivo?.nombre||''),
        fecha_vencimiento: form.fecha,
        fecha_aviso1: agregarDias(form.fecha, -15),
        fecha_aviso2: agregarDias(form.fecha, -7),
        tipo: 'asamblea_convocatoria',
        notas: 'Recordar preparar documentación para la asamblea.'
      })
      if (alertaId) await supabase.from('con_asambleas').update({ calendario_convocatoria_id: alertaId }).eq('id', newId)
    }
    setMsg({ tipo:'ok', texto:'✓ Guardado'+(isNueva?' — Alerta de calendario creada':'') })
    setVista('lista'); setForm(null); cargar()
  }

  const enviarConv = async () => {
    const cps = copropietarios.filter(c => c.consorcio_id === consorcioId && c.email)
    if (!cps.length) return setMsg({ tipo:'warn', texto:'No hay copropietarios con email en este consorcio' })
    if (!confirm('¿Enviar convocatoria a '+cps.length+' propietarios?')) return
    setEnviando(true); setMsg(null)
    const { data:{ session:sess } } = await supabase.auth.getSession()
    const tipoL = detalle.tipo==='ordinaria'?'Ordinaria':'Extraordinaria'
    const asunto = 'Convocatoria Asamblea General '+tipoL+' — '+(consorcioActivo?.nombre||'')+' — '+fmtF(detalle.fecha)
    let ok=0, err=0
    for (const cp of cps) {
      try {
        const r = await fetch(SUPA_URL+'/functions/v1/enviar-notificacion', {
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+sess?.access_token,'apikey':process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},
          body: JSON.stringify({ destinatarios:[cp.email], asunto, cuerpo_texto:convTxt, consorcio_id:consorcioId })
        })
        if (r.ok) ok++; else err++
      } catch { err++ }
    }
    await supabase.from('con_asambleas').update({ convocatoria_enviada:true, fecha_envio_conv:new Date().toISOString() }).eq('id', detalle.id)
    setDetalle(d => ({...d, convocatoria_enviada:true}))
    setMsg({ tipo:err===0?'ok':'warn', texto:'✓ Enviado a '+ok+' propietarios'+(err>0?' · '+err+' errores':'') })
    setEnviando(false); cargar()
  }

  const guardarTranscripcion = async () => {
    const pres = presentes.split(',').map(p=>p.trim()).filter(Boolean)
    await supabase.from('con_asambleas').update({
      transcripcion:transcEdit, unidades_presentes:pres,
      total_presentes:pres.length, hora_fin:horaFin,
      estado:'realizada', updated_at:new Date().toISOString()
    }).eq('id', detalle.id)
    setDetalle(d => ({...d, transcripcion:transcEdit, unidades_presentes:pres, hora_fin:horaFin, estado:'realizada'}))
    setMsg({ tipo:'ok', texto:'✓ Guardado' })
  }

  const generarActa = async () => {
    if (!transcEdit.trim()) return setMsg({ tipo:'warn', texto:'Pegá la transcripción antes' })
    setGenerando(true); setMsg(null)
    const { data:{ session:sess } } = await supabase.auth.getSession()
    const res = await fetch(SUPA_URL+'/functions/v1/generar-acta-asamblea', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+sess?.access_token,'apikey':process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},
      body: JSON.stringify({
        transcripcion:transcEdit, consorcio_nombre:consorcioActivo?.nombre,
        consorcio_direccion:consorcioActivo?.direccion, tipo_asamblea:detalle.tipo,
        modalidad:detalle.modalidad, plataforma_virtual:detalle.plataforma_virtual,
        fecha:fmtF(detalle.fecha), hora_inicio:detalle.hora, hora_fin:horaFin,
        orden_del_dia:detalle.orden_del_dia||[], unidades_presentes:detalle.unidades_presentes||[],
        total_ufs:unidades.length, matricula_rpi:consorcioActivo?.matricula_rpi
      })
    })
    const data = await res.json()
    if (!res.ok||data.error) { setMsg({ tipo:'error', texto:'Error: '+(data.error||'desconocido') }); setGenerando(false); return }
    setActaEdit(data.acta)
    await supabase.from('con_asambleas').update({ acta_borrador:data.acta, estado:'acta_generada', updated_at:new Date().toISOString() }).eq('id', detalle.id)
    setDetalle(d => ({...d, acta_borrador:data.acta, estado:'acta_generada'}))
    setTabDet('acta'); setMsg({ tipo:'ok', texto:'✓ Acta generada' })
    setGenerando(false); cargar()
  }

  const guardarActa = async (aprobar) => {
    const upd = aprobar ? { acta_final:actaEdit, estado:'acta_aprobada', updated_at:new Date().toISOString() }
                        : { acta_borrador:actaEdit, updated_at:new Date().toISOString() }
    await supabase.from('con_asambleas').update(upd).eq('id', detalle.id)
    setDetalle(d => ({...d,...upd}))
    setMsg({ tipo:'ok', texto:aprobar?'✔ Acta aprobada':'✓ Borrador guardado' })
    cargar()
  }

  // ── SUBIR PDF (helper reutilizable) ───────────────────────────────────────
  const subirPDFComun = async (file, asmId, cid, onDone, setSubiendo) => {
    if (!file || file.type !== 'application/pdf') { setMsg({ tipo:'warn', texto:'Solo se admiten archivos PDF' }); return }
    setSubiendo(true); setMsg(null)
    try {
      const path = `asambleas/${session.user.id}/${cid}/${asmId}_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('actas-pdf').upload(path, file, { upsert:true, contentType:'application/pdf' })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('actas-pdf').getPublicUrl(path)
      const url = urlData.publicUrl
      await supabase.from('con_asambleas').update({
        acta_subida_pdf_url: url, acta_subida_pdf_path: path,
        acta_fuente: 'subida', updated_at: new Date().toISOString()
      }).eq('id', asmId)
      setMsg({ tipo:'ok', texto:'✓ PDF subido. Podés analizarlo con IA.' })
      onDone({ url, name: file.name })
    } catch(e) { setMsg({ tipo:'error', texto:'Error al subir: '+e.message }) }
    setSubiendo(false)
  }

  // ── ANALIZAR PDF con IA (helper reutilizable) ─────────────────────────────
  const analizarPDFconIA = async (pdfUrl, onResultado, setAnalizando) => {
    if (!pdfUrl) return setMsg({ tipo:'warn', texto:'Primero subí un PDF' })
    setAnalizando(true); setMsg(null)
    try {
      const { data:{ session:sess } } = await supabase.auth.getSession()
      const res = await fetch(SUPA_URL+'/functions/v1/extraer-pdf-ia', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+sess?.access_token,'apikey':process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},
        body: JSON.stringify({
          pdf_url: pdfUrl,
          instrucciones: `Sos un asistente especializado en administración de consorcios argentina (Ley 13.512 y CCCN).
Analizá el acta de asamblea y respondé SOLO en JSON con este esquema exacto:
{
  "consorcio_nombre": "nombre del consorcio o null",
  "tipo_asamblea": "ordinaria|extraordinaria",
  "fecha_asamblea": "YYYY-MM-DD o null",
  "mandato_administrador": true,
  "mandato_tipo": "designacion|renovacion|null",
  "mandato_fecha_inicio": "YYYY-MM-DD o null",
  "mandato_fecha_fin": "YYYY-MM-DD o null",
  "mandato_duracion_anos": 1,
  "mandato_nombre_administrador": "nombre o null",
  "resoluciones_clave": ["lista de resoluciones principales"],
  "resumen": "resumen del acta en 3-5 oraciones"
}
No incluyas texto fuera del JSON.`
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Error en IA')
      let parsed = data.resultado
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch(_) {} }
      onResultado(parsed)
      setMsg({ tipo:'ok', texto:'✓ Análisis completado.' })
    } catch(e) { setMsg({ tipo:'error', texto:'Error en IA: '+e.message }) }
    setAnalizando(false)
  }

  // ── GUARDAR MANDATO ───────────────────────────────────────────────────────
  const guardarMandatoParaAsamblea = async (asmId, mf, cid) => {
    if (!mf?.fecha_inicio || !mf?.fecha_fin)
      return setMsg({ tipo:'warn', texto:'Ingresá fecha de inicio y fin del mandato' })
    setGuardandoMandato(true); setMsg(null)
    const alertaId = await crearAlertaCalendario({
      cid,
      descripcion: 'Vencimiento mandato administrador — '+(consorcioActivo?.nombre||cid||''),
      fecha_vencimiento: mf.fecha_fin,
      fecha_aviso1: agregarDias(mf.fecha_fin, -90),
      fecha_aviso2: agregarDias(mf.fecha_fin, -30),
      tipo: 'mandato_administrador',
      notas: 'Preparar convocatoria a Asamblea para renovación de mandato.\n'+
             'Inicio: '+mf.fecha_inicio+' — Fin: '+mf.fecha_fin+
             (mf.observaciones ? '\n'+mf.observaciones : '')
    })
    await supabase.from('con_asambleas').update({
      mandato_administrador: true, mandato_fecha_inicio: mf.fecha_inicio,
      mandato_fecha_fin: mf.fecha_fin, mandato_duracion_anos: mf.duracion_anos,
      mandato_observaciones: mf.observaciones, calendario_mandato_id: alertaId,
      updated_at: new Date().toISOString()
    }).eq('id', asmId)
    setDetalle(d => d ? ({...d, mandato_administrador:true, mandato_fecha_inicio:mf.fecha_inicio,
      mandato_fecha_fin:mf.fecha_fin, mandato_duracion_anos:mf.duracion_anos,
      mandato_observaciones:mf.observaciones, calendario_mandato_id:alertaId}) : d)
    setMsg({ tipo:'ok', texto:'✓ Mandato guardado — Alertas: 90 y 30 días antes del '+fmtF(mf.fecha_fin) })
    setGuardandoMandato(false); cargar()
  }

  // ── FORM MANDATO reutilizable ─────────────────────────────────────────────
  const renderFormMandato = (mf, setMf, onGuardar, guardando, asmId, cid) => (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
        <div>
          <div style={{fontSize:12,color:GR,marginBottom:4}}>Fecha inicio mandato</div>
          <input type="date" value={mf.fecha_inicio}
            onChange={e=>{
              const fi=e.target.value; let ff=mf.fecha_fin
              if(fi&&mf.duracion_anos){const d=new Date(fi+'T12:00:00');d.setFullYear(d.getFullYear()+parseInt(mf.duracion_anos));ff=d.toISOString().slice(0,10)}
              setMf(x=>({...x,fecha_inicio:fi,fecha_fin:ff}))
            }}
            style={{width:'100%',padding:'8px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13}}/>
        </div>
        <div>
          <div style={{fontSize:12,color:GR,marginBottom:4}}>Duración (años)</div>
          <select value={mf.duracion_anos}
            onChange={e=>{
              const dur=parseInt(e.target.value); let ff=mf.fecha_fin
              if(mf.fecha_inicio&&dur){const d=new Date(mf.fecha_inicio+'T12:00:00');d.setFullYear(d.getFullYear()+dur);ff=d.toISOString().slice(0,10)}
              setMf(x=>({...x,duracion_anos:dur,fecha_fin:ff}))
            }}
            style={{width:'100%',padding:'8px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13}}>
            {[1,2,3,4,5].map(n=><option key={n} value={n}>{n} año{n>1?'s':''}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:12,color:GR,marginBottom:4}}>Fecha fin mandato</div>
          <input type="date" value={mf.fecha_fin}
            onChange={e=>setMf(x=>({...x,fecha_fin:e.target.value}))}
            style={{width:'100%',padding:'8px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13}}/>
        </div>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:12,color:GR,marginBottom:4}}>Observaciones</div>
        <input value={mf.observaciones}
          onChange={e=>setMf(x=>({...x,observaciones:e.target.value}))}
          placeholder="ej: Designación, unanimidad, art. 2066 CCCN"
          style={{width:'100%',padding:'8px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13}}/>
      </div>
      {mf.fecha_fin&&(
        <div style={{padding:'10px 14px',background:'#fffbeb',borderRadius:8,fontSize:12,color:'#92400e',marginBottom:12,border:'1px solid #fde68a'}}>
          📅 Alertas en Agenda: {fmtF(agregarDias(mf.fecha_fin,-90))} (90d) · {fmtF(agregarDias(mf.fecha_fin,-30))} (30d) · Venc: {fmtF(mf.fecha_fin)}
        </div>
      )}
      <div style={{display:'flex',gap:8}}>
        <Btn onClick={()=>onGuardar(asmId,mf,cid)} disabled={guardando} style={{opacity:guardando?0.5:1}}>
          {guardando?'⏳ Guardando...':'🔖 Guardar y activar alertas'}
        </Btn>
        <BtnSec onClick={()=>setMf(null)}>Cancelar</BtnSec>
      </div>
    </div>
  )

  // ── RENDER FORM ────────────────────────────────────────────────────────────
  if (vista === 'form' && form) return (
    <div>
      <div style={{fontWeight:700,fontSize:15,marginBottom:16}}>{form.id?'✏ Editar':'+ Nueva Asamblea '+(form.tipo==='ordinaria'?'Ordinaria':'Extraordinaria')}</div>
      <Msg data={msg}/>
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:12}}>📋 Datos generales</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
          <Input label="Fecha" value={form.fecha||''} onChange={v=>setForm(x=>({...x,fecha:v}))} type="date"/>
          <Input label="Hora" value={form.hora||''} onChange={v=>setForm(x=>({...x,hora:v}))} placeholder="19:00"/>
          <div>
            <div style={{fontSize:12,color:GR,marginBottom:4}}>Modalidad</div>
            <select value={form.modalidad} onChange={e=>setForm(x=>({...x,modalidad:e.target.value}))}
              style={{width:'100%',padding:'8px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13}}>
              {[['presencial','Presencial'],['virtual','Virtual'],['mixta','Presencial + Virtual']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {(form.modalidad==='presencial'||form.modalidad==='mixta')&&(<div style={{gridColumn:'span 3'}}><Input label="Lugar" value={form.lugar||''} onChange={v=>setForm(x=>({...x,lugar:v}))} placeholder="Salón del edificio"/></div>)}
          {(form.modalidad==='virtual'||form.modalidad==='mixta')&&(<>
            <div><div style={{fontSize:12,color:GR,marginBottom:4}}>Plataforma</div>
              <select value={form.plataforma_virtual||'zoom'} onChange={e=>setForm(x=>({...x,plataforma_virtual:e.target.value}))}
                style={{width:'100%',padding:'8px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13}}>
                {PLATS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{gridColumn:'span 2'}}><Input label="Link de acceso" value={form.link_virtual||''} onChange={v=>setForm(x=>({...x,link_virtual:v}))} placeholder="https://zoom.us/j/..."/></div>
            <Input label="Clave" value={form.clave_virtual||''} onChange={v=>setForm(x=>({...x,clave_virtual:v}))} placeholder="123456"/>
          </>)}
        </div>
      </Card>
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:12}}>📝 Orden del Día</div>
        {(form.orden_del_dia||[]).map((p,i)=>(
          <div key={i} style={{display:'flex',gap:8,marginBottom:8,alignItems:'flex-start'}}>
            <div style={{minWidth:24,paddingTop:9,fontSize:12,color:GR,fontWeight:600}}>{i+1}.</div>
            <textarea value={p} onChange={e=>{const od=[...(form.orden_del_dia||[])];od[i]=e.target.value;setForm(x=>({...x,orden_del_dia:od}))}}
              rows={2} style={{flex:1,padding:'8px',border:'1px solid #d1d5db',borderRadius:7,fontSize:12.5,fontFamily:'inherit',resize:'vertical'}}/>
            <button type="button" onClick={()=>setForm(x=>({...x,orden_del_dia:(x.orden_del_dia||[]).filter((_,j)=>j!==i)}))}
              style={{padding:'6px 10px',background:'#fee2e2',color:RJ,border:'none',borderRadius:6,cursor:'pointer',fontSize:12}}>✕</button>
          </div>
        ))}
        <button type="button" onClick={()=>setForm(x=>({...x,orden_del_dia:[...(x.orden_del_dia||[]),'']}))
          } style={{padding:'7px 16px',background:'#eff6ff',color:AZ,border:'1px solid '+AZ,borderRadius:7,fontSize:12,cursor:'pointer'}}>
          + Agregar punto
        </button>
      </Card>
      <div style={{display:'flex',gap:8}}><Btn onClick={guardarForm}>💾 Guardar</Btn><BtnSec onClick={()=>{setVista('lista');setForm(null)}}>Cancelar</BtnSec></div>
    </div>
  )

  // ── RENDER DETALLE ─────────────────────────────────────────────────────────
  if (vista === 'detalle' && detalle) return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
        <BtnSec onClick={()=>setVista('lista')}>← Volver</BtnSec>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:14}}>{'Asamblea General '+(detalle.tipo==='ordinaria'?'Ordinaria':'Extraordinaria')}</div>
          <div style={{fontSize:12,color:GR}}>{fmtF(detalle.fecha)} — {detalle.hora} hs · <span style={{fontWeight:600,color:EST_C[detalle.estado]}}>{EST_L[detalle.estado]}</span></div>
        </div>
        <BtnSec onClick={()=>{setForm({...detalle,orden_del_dia:detalle.orden_del_dia||[]});setVista('form')}}>✏ Editar</BtnSec>
      </div>
      <Msg data={msg}/>
      <div style={{display:'flex',gap:0,marginBottom:16,borderBottom:'2px solid #e5e7eb',overflowX:'auto'}}>
        {[['convocatoria','📋 Conv.'],['asistencia','👥 Asist.'],['transcripcion','🎙 Transcr.'],
          ['acta','📄 Acta'],['actas_pdf','📎 PDF'],['mandato','🔖 Mandato']].map(([id,l])=>(
          <button key={id} type="button" onClick={()=>setTabDet(id)}
            style={{padding:'8px 12px',border:'none',borderBottom:tabDet===id?'2px solid '+AZ:'2px solid transparent',
              background:'transparent',color:tabDet===id?AZ:GR,fontWeight:tabDet===id?700:400,cursor:'pointer',fontSize:12,whiteSpace:'nowrap'}}>
            {l}
          </button>
        ))}
      </div>

      {tabDet==='convocatoria'&&(<div>
        {(detalle.orden_del_dia||[]).length>0&&(
          <Card style={{marginBottom:14}}>
            <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:8}}>Orden del Día</div>
            {(detalle.orden_del_dia||[]).map((p,i)=>(
              <div key={i} style={{display:'flex',gap:8,marginBottom:5,fontSize:13}}><span style={{color:GR,fontWeight:600,minWidth:20}}>{i+1}.</span>{p}</div>
            ))}
          </Card>
        )}
        {(detalle.modalidad==='virtual'||detalle.modalidad==='mixta')&&detalle.link_virtual&&(
          <Card style={{marginBottom:14,background:'#eff6ff',border:'1px solid #bfdbfe'}}>
            <div style={{fontWeight:600,color:AZ,marginBottom:4}}>🔗 Acceso virtual</div>
            <a href={detalle.link_virtual} target="_blank" rel="noreferrer" style={{color:AZ,fontWeight:600,fontSize:13}}>{detalle.link_virtual}</a>
            {detalle.clave_virtual&&<div style={{fontSize:12,color:GR,marginTop:4}}>Clave: {detalle.clave_virtual}</div>}
          </Card>
        )}
        <Card style={{marginBottom:14}}>
          <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:8}}>Texto convocatoria <span style={{fontWeight:400,color:GR,fontSize:11}}>(editable)</span></div>
          <textarea value={convTxt} onChange={e=>setConvTxt(e.target.value)} rows={22}
            style={{width:'100%',padding:'12px',border:'1px solid #e5e7eb',borderRadius:8,fontSize:12,fontFamily:'monospace',resize:'vertical'}}/>
        </Card>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <Btn onClick={()=>{setConvTxt(generarTexto(detalle));setMsg({tipo:'ok',texto:'✓ Regenerado'})}}>🔄 Regenerar</Btn>
          <Btn onClick={()=>{navigator.clipboard.writeText(convTxt);setMsg({tipo:'ok',texto:'✓ Copiado'})}}>📋 Copiar</Btn>
          <Btn onClick={enviarConv} disabled={enviando} style={{opacity:enviando?0.5:1,background:'#16a34a'}}>
            {enviando?'⏳ Enviando...':'✉ Enviar a propietarios'+(detalle.convocatoria_enviada?' (re-enviar)':'')}
          </Btn>
        </div>
        {detalle.convocatoria_enviada&&<div style={{marginTop:10,fontSize:12,color:VD}}>✓ Enviada el {fmtF(detalle.fecha_envio_conv)}</div>}
        {detalle.calendario_convocatoria_id&&<div style={{marginTop:8,padding:'6px 12px',background:'#f0fdf4',borderRadius:8,fontSize:12,color:VD,border:'1px solid #bbf7d0'}}>📅 Alertas de calendario activas (15 y 7 días antes)</div>}
      </div>)}

      {tabDet==='asistencia'&&(
        <Card>
          <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:12}}>👥 Asistencia</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
            <div>
              <div style={{fontSize:12,color:GR,marginBottom:4}}>Unidades presentes (coma)</div>
              <textarea value={presentes} onChange={e=>setPresentes(e.target.value)} rows={6} placeholder="1A, 2B, 3C..."
                style={{width:'100%',padding:'10px',border:'1px solid #d1d5db',borderRadius:7,fontSize:12.5,fontFamily:'inherit',resize:'vertical'}}/>
            </div>
            <div style={{background:'#f8fafc',borderRadius:8,padding:'14px',fontSize:13}}>
              <div style={{marginBottom:6}}>Total UFs: <strong>{unidades.length}</strong></div>
              <div style={{marginBottom:6}}>Presentes: <strong>{presentes.split(',').filter(p=>p.trim()).length}</strong></div>
              <div style={{marginBottom:6}}>% por unidades: <strong style={{color:presentes.split(',').filter(p=>p.trim()).length/Math.max(unidades.length,1)>=0.5?VD:RJ}}>{(presentes.split(',').filter(p=>p.trim()).length/Math.max(unidades.length,1)*100).toFixed(1)}%</strong></div>
              {(() => {
                // Calcular % por coeficiente de las UFs presentes
                const presLista = presentes.split(',').map(p=>p.trim()).filter(Boolean)
                const coefTotal = unidades.reduce((a,u)=>a+(parseFloat(u.porcentaje_fiscal)||0),0)||100
                const coefPresentes = unidades
                  .filter(u => presLista.some(p => {
                    // El ítem puede ser solo el número ("PB A") o texto con nombre
                    // ("- PB A" Rodolfo Mascheroni (presente)"). Buscar si el
                    // número o numero_interno aparece en cualquier parte del texto.
                    const t     = p.toLowerCase().replace(/['"]/g,' ')  // quitar comillas
                    const tNoSp = t.replace(/\s/g,'')
                    const num   = String(u.numero||'').toLowerCase().trim()
                    const nNoSp = num.replace(/\s/g,'')
                    const numInt= (u.numero_interno||'').toLowerCase().trim()
                    const desc  = (u.descripcion||'').toLowerCase().trim()
                    return (
                      (num.length >= 2 && t.includes(num))    ||   // 'pb a' dentro del texto
                      (nNoSp.length >= 2 && tNoSp.includes(nNoSp)) || // 'pba' sin espacios
                      (numInt.length >= 2 && t.includes(numInt))   ||   // numero_interno dentro
                      (desc.length > 3 && t.includes(desc))
                    )
                  }))
                  .reduce((a,u)=>a+(parseFloat(u.porcentaje_fiscal)||0),0)
                const pctCoef = (coefPresentes/coefTotal*100)
                return (
                  <div style={{marginBottom:12}}>
                    % por coeficiente: <strong style={{color:pctCoef>=50?VD:RJ}}>{pctCoef.toFixed(2)}%</strong>
                    <span style={{fontSize:11,color:GR,marginLeft:6}}>({coefPresentes.toFixed(2)} / {coefTotal.toFixed(2)})</span>
                    {pctCoef>=50&&presentes.split(',').filter(p=>p.trim()).length/Math.max(unidades.length,1)>=0.5&&(
                      <span style={{marginLeft:8,background:VD,color:'#fff',borderRadius:5,padding:'2px 7px',fontSize:11,fontWeight:700}}>✓ Quórum doble mayoría</span>
                    )}
                  </div>
                )
              })()}
              <div style={{fontSize:12,color:GR,marginBottom:4}}>Hora fin</div>
              <input type="time" value={horaFin} onChange={e=>setHoraFin(e.target.value)} style={{padding:'6px 10px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13}}/>
            </div>
          </div>
          <Btn onClick={guardarTranscripcion}>💾 Guardar asistencia</Btn>
        </Card>
      )}

      {tabDet==='transcripcion'&&(<div>
        <div style={{fontSize:12,color:GR,marginBottom:10}}>Pegá la transcripción (Zoom, Meet, o manual)</div>
        <Card>
          <textarea value={transcEdit} onChange={e=>setTranscEdit(e.target.value)} rows={22} placeholder="Transcripción..."
            style={{width:'100%',padding:'12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:12.5,fontFamily:'inherit',resize:'vertical'}}/>
          <div style={{display:'flex',gap:8,marginTop:10}}>
            <Btn onClick={guardarTranscripcion}>💾 Guardar</Btn>
            <Btn onClick={generarActa} disabled={generando||!transcEdit.trim()} style={{background:'#7c3aed',opacity:generando||!transcEdit.trim()?0.5:1}}>
              {generando?'⏳ Generando...':'🤖 Generar acta con IA'}
            </Btn>
          </div>
        </Card>
      </div>)}

      {tabDet==='acta'&&(<div>
        {!actaEdit&&!detalle.acta_borrador?(
          <Card><div style={{textAlign:'center',padding:'24px 0',color:GR}}>
            <div style={{fontSize:32,marginBottom:8}}>📄</div>
            <div style={{fontWeight:600,marginBottom:6}}>Sin acta generada</div>
            <BtnSec onClick={()=>setTabDet('transcripcion')}>Ir a Transcripción →</BtnSec>
          </div></Card>
        ):(
          <div>
            <div style={{fontSize:12,color:GR,marginBottom:10}}>{detalle.acta_final?'✔ Acta aprobada':'📄 Borrador'}</div>
            <textarea value={actaEdit} onChange={e=>setActaEdit(e.target.value)} rows={32}
              style={{width:'100%',padding:'14px',border:'1px solid '+(detalle.acta_final?VD:'#d1d5db'),borderRadius:8,fontSize:12.5,fontFamily:'inherit',resize:'vertical'}}/>
            <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
              <Btn onClick={()=>guardarActa(false)}>💾 Borrador</Btn>
              {!detalle.acta_final&&<Btn onClick={()=>{if(confirm('¿Aprobar?'))guardarActa(true)}} style={{background:VD}}>✔ Aprobar</Btn>}
              <Btn onClick={()=>{navigator.clipboard.writeText(actaEdit);setMsg({tipo:'ok',texto:'✓ Copiado'})}}>📋 Copiar</Btn>
              <Btn onClick={generarActa} disabled={generando} style={{background:'#7c3aed',opacity:generando?0.5:1}}>{generando?'⏳...':'🤖 Re-generar'}</Btn>
            </div>
          </div>
        )}
      </div>)}

      {tabDet==='actas_pdf'&&(<div>
        <Card>
          <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:4}}>📎 Acta en PDF</div>
          <div style={{fontSize:12,color:GR,marginBottom:14}}>Subí el acta en PDF. La IA identificará consorcio, tipo y mandatos.</div>
          {!(detalle.acta_subida_pdf_url) ? (
            <label style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
              border:'2px dashed #c7d2fe',borderRadius:12,padding:'28px 20px',cursor:'pointer',background:'#f8faff'}}
              onDragOver={e=>e.preventDefault()}
              onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)subirPDFComun(f,detalle.id,detalle.consorcio_id||consorcioId,url=>{setDetalle(d=>({...d,acta_subida_pdf_url:url.url}));cargar()},setSubiendoPDFDet)}}>
              <input type="file" accept="application/pdf" style={{display:'none'}}
                onChange={e=>e.target.files[0]&&subirPDFComun(e.target.files[0],detalle.id,detalle.consorcio_id||consorcioId,url=>{setDetalle(d=>({...d,acta_subida_pdf_url:url.url}));cargar()},setSubiendoPDFDet)}/>
              {subiendoPDFDet?<div style={{color:AZ,fontWeight:600}}>⏳ Subiendo...</div>:(
                <><div style={{fontSize:36,marginBottom:8}}>📄</div>
                <div style={{fontWeight:600,color:AZ,fontSize:13}}>Arrastrá el PDF aquí</div>
                <div style={{fontSize:12,color:GR}}>o hacé click para seleccionar</div></>
              )}
            </label>
          ) : (
            <div>
              <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',background:'#f0fdf4',borderRadius:10,border:'1px solid #bbf7d0',marginBottom:14}}>
                <div style={{fontSize:28}}>📄</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13,color:'#14532d'}}>Acta subida</div>
                  <a href={detalle.acta_subida_pdf_url} target="_blank" rel="noreferrer" style={{fontSize:12,color:AZ}}>Ver PDF ↗</a>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <Btn onClick={()=>analizarPDFconIA(detalle.acta_subida_pdf_url,r=>{setIaResultadoDet(r);if(r?.mandato_administrador)setMandatoForm({fecha_inicio:r.mandato_fecha_inicio||'',fecha_fin:r.mandato_fecha_fin||'',duracion_anos:r.mandato_duracion_anos||1,observaciones:r.mandato_tipo?('IA: '+r.mandato_tipo):''})},setAnalizandoIADet)} disabled={analizandoIADet} style={{background:'#7c3aed',opacity:analizandoIADet?0.5:1,fontSize:12}}>
                    {analizandoIADet?'⏳ Analizando...':'🤖 Analizar con IA'}
                  </Btn>
                  <BtnSec onClick={()=>setDetalle(d=>({...d,acta_subida_pdf_url:null}))} style={{fontSize:12}}>Cambiar</BtnSec>
                </div>
              </div>
              {iaResultadoDet&&(
                <div style={{padding:'14px',background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:10}}>
                  <div style={{fontWeight:700,color:'#7c3aed',fontSize:13,marginBottom:10}}>🤖 Resultado IA</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:13,marginBottom:10}}>
                    {iaResultadoDet.consorcio_nombre&&<div><span style={{color:GR}}>Consorcio:</span> <strong>{iaResultadoDet.consorcio_nombre}</strong></div>}
                    {iaResultadoDet.tipo_asamblea&&<div><span style={{color:GR}}>Tipo:</span> <strong style={{textTransform:'capitalize'}}>{iaResultadoDet.tipo_asamblea}</strong></div>}
                    {iaResultadoDet.fecha_asamblea&&<div><span style={{color:GR}}>Fecha:</span> <strong>{fmtF(iaResultadoDet.fecha_asamblea)}</strong></div>}
                    <div><span style={{color:GR}}>Mandato:</span> <strong style={{color:iaResultadoDet.mandato_administrador?VD:GR}}>{iaResultadoDet.mandato_administrador?'✓ Detectado':'No'}</strong></div>
                    {iaResultadoDet.mandato_fecha_inicio&&<div><span style={{color:GR}}>Inicio:</span> <strong>{fmtF(iaResultadoDet.mandato_fecha_inicio)}</strong></div>}
                    {iaResultadoDet.mandato_fecha_fin&&<div><span style={{color:GR}}>Fin:</span> <strong>{fmtF(iaResultadoDet.mandato_fecha_fin)}</strong></div>}
                  </div>
                  {iaResultadoDet.resumen&&<div style={{fontSize:12,color:'#374151',background:'#fff',padding:'10px',borderRadius:8,lineHeight:1.5}}>{iaResultadoDet.resumen}</div>}
                  {iaResultadoDet.mandato_administrador&&<div style={{marginTop:10,padding:'8px 12px',background:'#fef9c3',borderRadius:8,fontSize:12,color:'#92400e'}}>⚠️ Mandato detectado — confirmá en el tab <strong>🔖 Mandato</strong></div>}
                </div>
              )}
            </div>
          )}
          {detalle.acta_final&&(
            <div style={{marginTop:14,padding:'12px 16px',background:'#eff6ff',borderRadius:10,border:'1px solid #bfdbfe'}}>
              <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:6}}>📄 Acta del sistema</div>
              <BtnSec onClick={()=>setTabDet('acta')} style={{fontSize:12}}>Ver texto del acta →</BtnSec>
            </div>
          )}
        </Card>
      </div>)}

      {tabDet==='mandato'&&(<div>
        <Card>
          <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:4}}>🔖 Mandato del Administrador</div>
          <div style={{fontSize:12,color:GR,marginBottom:14}}>Alertas automáticas 90 y 30 días antes del vencimiento.</div>
          {detalle.mandato_administrador&&!mandatoForm&&(
            <div style={{padding:'12px 16px',background:'#f0fdf4',borderRadius:10,border:'1px solid #bbf7d0',marginBottom:14}}>
              <div style={{fontWeight:600,color:VD,marginBottom:6}}>✓ Mandato registrado</div>
              <div style={{fontSize:13,display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div><span style={{color:GR}}>Inicio:</span> <strong>{fmtF(detalle.mandato_fecha_inicio)}</strong></div>
                <div><span style={{color:GR}}>Fin:</span> <strong>{fmtF(detalle.mandato_fecha_fin)}</strong></div>
                <div><span style={{color:GR}}>Duración:</span> <strong>{detalle.mandato_duracion_anos} año(s)</strong></div>
              </div>
              {detalle.mandato_observaciones&&<div style={{fontSize:12,color:GR,marginTop:8}}>{detalle.mandato_observaciones}</div>}
              {detalle.calendario_mandato_id&&<div style={{marginTop:8,fontSize:12,color:VD}}>📅 Alertas activas</div>}
              <BtnSec onClick={()=>setMandatoForm({fecha_inicio:detalle.mandato_fecha_inicio||'',fecha_fin:detalle.mandato_fecha_fin||'',duracion_anos:detalle.mandato_duracion_anos||1,observaciones:detalle.mandato_observaciones||''})} style={{marginTop:10,fontSize:12}}>✏ Modificar</BtnSec>
            </div>
          )}
          {(!detalle.mandato_administrador||mandatoForm)&&(
            !mandatoForm
              ? <div style={{textAlign:'center',padding:'20px 0',color:GR}}>
                  <div style={{fontSize:32,marginBottom:8}}>🔖</div>
                  <div style={{fontSize:13,marginBottom:14}}>Sin mandato registrado para esta asamblea</div>
                  <Btn onClick={()=>setMandatoForm({fecha_inicio:'',fecha_fin:'',duracion_anos:1,observaciones:''})}>+ Registrar mandato</Btn>
                </div>
              : renderFormMandato(mandatoForm,setMandatoForm,guardarMandatoParaAsamblea,guardandoMandato,detalle.id,detalle.consorcio_id||consorcioId)
          )}
        </Card>
      </div>)}
    </div>
  )

  // ── RENDER LISTA ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header con tabs y botones */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:15}}>🏛 Asambleas</div>
        {tabLista==='registros'&&(
          <div style={{display:'flex',gap:8}}>
            <Btn small onClick={()=>nuevoForm('ordinaria')}>+ Ordinaria</Btn>
            <Btn small onClick={()=>nuevoForm('extraordinaria')} style={{background:'#7c3aed'}}>+ Extraordinaria</Btn>
          </div>
        )}
      </div>

      {/* Tabs de la lista */}
      <div style={{display:'flex',gap:0,marginBottom:16,borderBottom:'2px solid #e5e7eb'}}>
        {[['registros','📋 Convocatorias y Actas'],['actas_pdf','📎 Subir Acta PDF'],['mandato','🔖 Registrar Mandato']].map(([id,l])=>(
          <button key={id} type="button" onClick={()=>{setTabLista(id);setMsg(null)}}
            style={{padding:'8px 14px',border:'none',borderBottom:tabLista===id?'2px solid '+AZ:'2px solid transparent',
              background:'transparent',color:tabLista===id?AZ:GR,fontWeight:tabLista===id?700:400,cursor:'pointer',fontSize:12.5,whiteSpace:'nowrap'}}>
            {l}
          </button>
        ))}
      </div>

      <Msg data={msg}/>

      {/* ── TAB: Convocatorias y Actas ── */}
      {tabLista==='registros'&&(
        <>
          <div style={{fontSize:12,color:GR,marginBottom:12}}>Convocatorias, actas y seguimiento de asambleas de todos los consorcios</div>
          {asambleas.length===0?(
            <Card><div style={{textAlign:'center',padding:'32px 0',color:GR}}>
              <div style={{fontSize:40,marginBottom:10}}>🏛</div>
              <div style={{fontWeight:600,marginBottom:6}}>Sin asambleas registradas</div>
              <div style={{fontSize:12}}>Creá una nueva convocatoria o subí un acta existente</div>
            </div></Card>
          ):(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {asambleas.map(a=>{
                const dias=diasR(a.fecha); const esP=a.estado==='convocatoria'&&dias!==null&&dias>=0
                return (
                  <Card key={a.id} onClick={()=>abrirDetalle(a)}
                    style={{cursor:'pointer',border:esP?'1.5px solid '+AZ:'1px solid #e5e7eb',background:esP?'#f8faff':'#fff'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                          <span style={{fontWeight:700,fontSize:13}}>{'Asamblea General '+(a.tipo==='ordinaria'?'Ordinaria':'Extraordinaria')}</span>
                          <span style={{fontSize:11,padding:'2px 8px',borderRadius:6,fontWeight:600,
                            background:a.estado==='acta_aprobada'?'#dcfce7':a.estado==='acta_generada'?'#ede9fe':a.estado==='realizada'?'#fef9c3':'#eff6ff',
                            color:EST_C[a.estado]}}>{EST_L[a.estado]}</span>
                          {a.mandato_administrador&&<span style={{fontSize:10,padding:'2px 7px',borderRadius:6,background:'#fef9c3',color:'#92400e',fontWeight:600}}>🔖 Mandato</span>}
                          {a.acta_subida_pdf_url&&<span style={{fontSize:10,padding:'2px 7px',borderRadius:6,background:'#f3f4f6',color:GR,fontWeight:600}}>📎 PDF</span>}
                        </div>
                        <div style={{fontSize:12,color:GR}}>
                          {fmtF(a.fecha)} — {a.hora} hs
                          {a.modalidad==='virtual'?' · Virtual ('+(a.plataforma_virtual||'Zoom')+')':a.modalidad==='mixta'?' · Mixta':''}
                          {a.lugar?' · '+a.lugar:''}
                        </div>
                        <div style={{fontSize:11,color:GR,marginTop:3}}>
                          {(a.orden_del_dia?.length||0)+' puntos'}
                          {a.convocatoria_enviada?' · ✉ Enviada':''}
                          {a.acta_final?' · ✔ Acta aprobada':a.acta_borrador?' · 📄 Borrador':''}
                          {a.mandato_fecha_fin?' · Mandato hasta '+fmtF(a.mandato_fecha_fin):''}
                        </div>
                        {a.consorcio_id&&a.consorcio_id!==consorcioId&&(
                          <div style={{fontSize:10,color:AZ,marginTop:2,fontWeight:600,opacity:0.8}}>
                            {consorcioNombre(a.consorcio_id)}
                          </div>
                        )}
                      </div>
                      <div style={{textAlign:'right',marginLeft:12}}>
                        {esP&&<div style={{fontSize:16,fontWeight:800,color:dias<=7?RJ:dias<=15?AM:AZ}}>{dias===0?'Hoy':dias+'d'}</div>}
                        <div style={{fontSize:11,color:GR,marginTop:2}}>Ver →</div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── TAB: Subir Acta PDF ── */}
      {tabLista==='actas_pdf'&&(
        <Card>
          <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:4}}>📎 Subir Acta en PDF</div>
          <div style={{fontSize:12,color:GR,marginBottom:14}}>
            Subí un acta ya confeccionada (PC o Drive). La IA identificará consorcio, tipo y mandatos automáticamente, sin necesidad de crear una convocatoria previa.
          </div>

          {/* Selector de consorcio */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,color:GR,marginBottom:4}}>Consorcio al que pertenece el acta</div>
            <select value={pdfConsorcioId||consorcioId||''}
              onChange={e=>setPdfConsorcioId(e.target.value)}
              style={{width:'100%',padding:'9px',border:'1px solid #d1d5db',borderRadius:7,fontSize:13}}>
              <option value={consorcioId||''}>{consorcioActivo?.nombre||'Consorcio activo'}</option>
            </select>
            <div style={{fontSize:11,color:GR,marginTop:4}}>Para cambiar el consorcio, seleccionalo desde el menú principal primero.</div>
          </div>

          {!pdfSubido ? (
            <label style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
              border:'2px dashed #c7d2fe',borderRadius:12,padding:'32px 20px',cursor:'pointer',background:'#f8faff'}}
              onDragOver={e=>e.preventDefault()}
              onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f){
                const cid=pdfConsorcioId||consorcioId||''
                const tempId='ASM-'+cid+'-'+Date.now()
                subirPDFComun(f,tempId,cid,result=>setPdfSubido({...result,asmId:tempId,cid}),setSubiendoPDF)
              }}}>
              <input type="file" accept="application/pdf" style={{display:'none'}}
                onChange={e=>{if(e.target.files[0]){
                  const cid=pdfConsorcioId||consorcioId||''
                  const tempId='ASM-'+cid+'-'+Date.now()
                  subirPDFComun(e.target.files[0],tempId,cid,result=>setPdfSubido({...result,asmId:tempId,cid}),setSubiendoPDF)
                }}}/>
              {subiendoPDF?<div style={{color:AZ,fontWeight:600}}>⏳ Subiendo PDF...</div>:(
                <><div style={{fontSize:40,marginBottom:10}}>📄</div>
                <div style={{fontWeight:600,color:AZ,fontSize:14,marginBottom:4}}>Arrastrá el PDF aquí</div>
                <div style={{fontSize:12,color:GR}}>o hacé click para seleccionar desde PC</div></>
              )}
            </label>
          ) : (
            <div>
              <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',background:'#f0fdf4',borderRadius:10,border:'1px solid #bbf7d0',marginBottom:14}}>
                <div style={{fontSize:32}}>📄</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13,color:'#14532d'}}>{pdfSubido.name}</div>
                  <a href={pdfSubido.url} target="_blank" rel="noreferrer" style={{fontSize:12,color:AZ}}>Ver PDF ↗</a>
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <Btn onClick={()=>analizarPDFconIA(pdfSubido.url,r=>{setIaResultado(r);if(r?.mandato_administrador){setTabLista('mandato');setMandatoLibre({fecha_inicio:r.mandato_fecha_inicio||'',fecha_fin:r.mandato_fecha_fin||'',duracion_anos:r.mandato_duracion_anos||1,observaciones:r.mandato_tipo?('IA: '+r.mandato_tipo):'',asmId:pdfSubido.asmId,cid:pdfSubido.cid})}},setAnalizandoIA)} disabled={analizandoIA} style={{background:'#7c3aed',opacity:analizandoIA?0.5:1,fontSize:12}}>
                    {analizandoIA?'⏳ Analizando...':'🤖 Analizar con IA'}
                  </Btn>
                  <BtnSec onClick={()=>{setPdfSubido(null);setIaResultado(null)}} style={{fontSize:12}}>Cambiar</BtnSec>
                </div>
              </div>

              {iaResultado&&(
                <div style={{padding:'14px',background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:10,marginBottom:14}}>
                  <div style={{fontWeight:700,color:'#7c3aed',fontSize:13,marginBottom:10}}>🤖 Análisis IA</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:13,marginBottom:10}}>
                    {iaResultado.consorcio_nombre&&<div><span style={{color:GR}}>Consorcio:</span> <strong>{iaResultado.consorcio_nombre}</strong></div>}
                    {iaResultado.tipo_asamblea&&<div><span style={{color:GR}}>Tipo:</span> <strong style={{textTransform:'capitalize'}}>{iaResultado.tipo_asamblea}</strong></div>}
                    {iaResultado.fecha_asamblea&&<div><span style={{color:GR}}>Fecha:</span> <strong>{fmtF(iaResultado.fecha_asamblea)}</strong></div>}
                    <div><span style={{color:GR}}>Mandato admin:</span> <strong style={{color:iaResultado.mandato_administrador?VD:GR}}>{iaResultado.mandato_administrador?'✓ Detectado':'No'}</strong></div>
                    {iaResultado.mandato_fecha_inicio&&<div><span style={{color:GR}}>Inicio:</span> <strong>{fmtF(iaResultado.mandato_fecha_inicio)}</strong></div>}
                    {iaResultado.mandato_fecha_fin&&<div><span style={{color:GR}}>Fin:</span> <strong>{fmtF(iaResultado.mandato_fecha_fin)}</strong></div>}
                  </div>
                  {iaResultado.resoluciones_clave?.length>0&&(
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:12,color:GR,marginBottom:4}}>Resoluciones:</div>
                      {iaResultado.resoluciones_clave.map((r,i)=><div key={i} style={{fontSize:12,marginBottom:3}}>• {r}</div>)}
                    </div>
                  )}
                  {iaResultado.resumen&&<div style={{fontSize:12,color:'#374151',background:'#fff',padding:'10px',borderRadius:8,lineHeight:1.5}}>{iaResultado.resumen}</div>}
                  {iaResultado.mandato_administrador&&(
                    <div style={{marginTop:10,padding:'8px 12px',background:'#fef9c3',borderRadius:8,fontSize:12,color:'#92400e'}}>
                      ⚠️ Mandato detectado — el tab <strong>🔖 Registrar Mandato</strong> fue pre-completado con los datos de la IA.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── TAB: Registrar Mandato ── */}
      {tabLista==='mandato'&&(
        <Card>
          <div style={{fontWeight:600,color:AZ,fontSize:13,marginBottom:4}}>🔖 Registrar Mandato del Administrador</div>
          <div style={{fontSize:12,color:GR,marginBottom:14}}>
            Registrá un mandato sin necesidad de crear una convocatoria previa. Se guardarán alertas en Agenda de Vencimientos.
          </div>
          {!mandatoLibre?(
            <div style={{textAlign:'center',padding:'20px 0',color:GR}}>
              <div style={{fontSize:36,marginBottom:10}}>🔖</div>
              <div style={{fontSize:13,marginBottom:14}}>Completá los datos del mandato</div>
              <Btn onClick={()=>setMandatoLibre({fecha_inicio:'',fecha_fin:'',duracion_anos:1,observaciones:'',asmId:null,cid:pdfConsorcioId||consorcioId||''})}>+ Nuevo mandato</Btn>
            </div>
          ):(
            <div>
              {renderFormMandato(
                mandatoLibre,
                setMandatoLibre,
                async (asmId,mf,cid)=>{
                  // Mandato libre (sin asamblea previa): solo crear la alerta en agenda
                  if (!mf?.fecha_inicio||!mf?.fecha_fin) return setMsg({tipo:'warn',texto:'Ingresá fechas'})
                  setGuardandoML(true); setMsg(null)
                  const alertaId = await crearAlertaCalendario({
                    cid: mf.cid||cid||consorcioId,
                    descripcion:'Vencimiento mandato administrador — '+(consorcioActivo?.nombre||''),
                    fecha_vencimiento:mf.fecha_fin,
                    fecha_aviso1:agregarDias(mf.fecha_fin,-90),
                    fecha_aviso2:agregarDias(mf.fecha_fin,-30),
                    tipo:'mandato_administrador',
                    notas:'Inicio: '+mf.fecha_inicio+' — Fin: '+mf.fecha_fin+(mf.observaciones?'\n'+mf.observaciones:'')
                  })
                  setMsg({tipo:'ok',texto:'✓ Mandato registrado — Alertas: 90 y 30 días antes del '+fmtF(mf.fecha_fin)})
                  setMandatoLibre(null); setGuardandoML(false)
                },
                guardandoML,
                mandatoLibre.asmId,
                mandatoLibre.cid||pdfConsorcioId||consorcioId
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
