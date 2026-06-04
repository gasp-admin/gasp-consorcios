import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

const LOTE_UFS   = 25
const UMBRAL_GRANDE = 30

export default function HistorialLiquidaciones() {
  const { session, consorcios } = useApp()
  const SB  = 'https://payzqbkydmvovjxlznuq.supabase.co'
  const AK  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBheXpxYmt5ZG12b3ZqeGx6bnVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0OTg0ODAsImV4cCI6MjA5MTA3NDQ4MH0.ut-cHjkd1oztZa-W3uYRbHDScEB4RLg55WtfIcBidm8'
  const EF  = `${SB}/functions/v1/importar-liquidacion-historica`
  const tok = session?.access_token

  const [tab, setTab]                     = useState('importar')
  const [historial, setHistorial]         = useState([])
  const [cola, setCola]                   = useState([])
  const [loading, setLoading]             = useState(false)
  const [procesando, setProcesando]       = useState(false)
  const [msg, setMsg]                     = useState('')
  const [progreso, setProgreso]           = useState({ paso: '', pct: 0 })
  const [filtroCon, setFiltroCon]         = useState('todos')
  const [driveUrl, setDriveUrl]           = useState('')
  const [fileIdsManual, setFileIdsManual] = useState('')
  const [consorcioImportar, setConsorcioImportar] = useState(null)

  const headers = { apikey: AK, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }
  const efPost  = async (body) => {
    const r = await fetch(EF, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) })
    return r.json()
  }

  const cargarTodo = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${SB}/rest/v1/con_expensas?pdf_procesado=eq.true&select=id,consorcio_id,periodo,total_gastos,saldo_caja_final,fecha_vencimiento,drive_pdf_url&order=periodo.desc&limit=300`, { headers })
      const hist = await r.json().catch(() => [])
      const colaRes = await efPost({ accion: 'estado_cola' }).catch(() => ({ cola: [] }))
      setHistorial(Array.isArray(hist) ? hist : [])
      setCola(Array.isArray(colaRes.cola) ? colaRes.cola : [])
    } finally { setLoading(false) }
  }
  useEffect(() => { cargarTodo() }, [])

  // ── Subir PDF a Storage y devolver path ──────────────────────────────────
  const subirPDFaStorage = async (file, consorcioId) => {
    const path = `${consorcioId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('liquidaciones-temp').upload(path, file, { contentType: 'application/pdf', upsert: true })
    if (error) throw new Error(`Storage: ${error.message}`)
    return path
  }

  const eliminarPDFdeStorage = async (path) => {
    await supabase.storage.from('liquidaciones-temp').remove([path]).catch(() => {})
  }

  // ── Flujo principal ───────────────────────────────────────────────────────
  const procesarPDF = async (file, colaId) => {
    if (!consorcioImportar?.id) { setMsg('⚠️ Seleccioná el consorcio destino.'); return }
    const con = consorcioImportar
    setProcesando(true)

    // Cantidad de UFs
    const { count: nUFs } = await supabase.from('con_unidades').select('id', { count: 'exact', head: true }).eq('consorcio_id', con.id)
    const totalUFs  = nUFs ?? 0
    const esGrande  = totalUFs > UMBRAL_GRANDE

    // Subir PDF a Storage (una sola vez)
    setProgreso({ paso: 'Subiendo PDF...', pct: 5 })
    let storagePath = null
    try {
      storagePath = await subirPDFaStorage(file, con.id)
    } catch (e) {
      setMsg(`❌ ${e.message}`)
      setProcesando(false)
      return
    }

    try {
      // Paso 1: Meta
      setProgreso({ paso: 'Extrayendo metadatos y rubros...', pct: 10 })
      const metaRes = await efPost({
        accion: 'procesar_meta',
        cola_id: colaId,
        storage_path: storagePath,
        pdf_url: '',
        consorcio_id: con.id
      })
      if (!metaRes.ok) {
        setMsg(`❌ Error en meta: ${metaRes.error || 'desconocido'}`)
        return
      }
      const { periodo, expensa_id } = metaRes

      if (!esGrande) {
        setMsg(`✅ ${file.name} importado — Período ${periodo}`)
        return
      }

      // Paso 2: Rangos de prorrateo
      const rangos = []
      for (let d = 1; d <= totalUFs; d += LOTE_UFS) rangos.push({ desde: d, hasta: Math.min(d + LOTE_UFS - 1, totalUFs) })

      let ufsOk = 0, ufsErr = 0
      for (let i = 0; i < rangos.length; i++) {
        const { desde, hasta } = rangos[i]
        const pct = 15 + Math.round((i / rangos.length) * 75)
        setProgreso({ paso: `Procesando UFs ${desde}–${hasta} (${i+1}/${rangos.length})...`, pct })
        setMsg(`⚙️ ${file.name} — UFs ${desde}–${hasta} de ${totalUFs}`)

        const res = await efPost({
          accion: 'procesar_prorrateo_rango',
          cola_id: colaId,
          storage_path: storagePath,
          consorcio_id: con.id,
          expensa_id,
          periodo,
          uf_desde: desde,
          uf_hasta: hasta
        })
        if (!res.ok) setMsg(`⚠️ Rango ${desde}–${hasta}: ${res.error || 'error'}`)
        else { ufsOk += res.nUFs || 0; ufsErr += res.errores || 0 }

        if (i < rangos.length - 1) await new Promise(r => setTimeout(r, 500))
      }

      // Paso 3: Finalizar
      setProgreso({ paso: 'Finalizando...', pct: 95 })
      await efPost({ accion: 'finalizar', cola_id: colaId, expensa_id, consorcio_id: con.id })

      setProgreso({ paso: 'Completado', pct: 100 })
      const adv = ufsErr > 0 ? ` ⚠️ ${ufsErr} UF(s) con diferencia aritmética.` : ''
      setMsg(`✅ ${file.name} — ${ufsOk} UFs — Período ${periodo}${adv}`)

    } finally {
      // Limpiar PDF de Storage
      if (storagePath) await eliminarPDFdeStorage(storagePath)
      setProcesando(false)
      setTimeout(cargarTodo, 1500)
    }
  }

  // ── Opción C: file input ──────────────────────────────────────────────────
  const handleFilePick = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!consorcioImportar?.id) { setMsg('⚠️ Seleccioná el consorcio destino.'); return }
    const fakeId = `LOCAL-${Date.now()}`
    const colaId = `COLA-${consorcioImportar.id}-${fakeId}`
    await efPost({ accion: 'encolar_lote', archivos: [{ drive_file_id: fakeId, drive_file_nombre: file.name, consorcio_id: consorcioImportar.id, consorcio_nombre: consorcioImportar.nombre }] })
    await procesarPDF(file, colaId)
    e.target.value = ''
  }

  const consorcioPorId = (id) => (consorcios||[]).find(c => c.id === id)
  const fmt = n => n != null ? `$ ${Number(n).toLocaleString('es-AR')}` : '—'

  const card    = { background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:20, marginBottom:16 }
  const btn     = (c) => ({ background:c||'#1F4E79', color:'#fff', border:'none', borderRadius:7, padding:'8px 16px', cursor:'pointer', fontSize:13, fontWeight:600 })
  const btnOut  = { background:'#fff', color:'#1F4E79', border:'1px solid #1F4E79', borderRadius:7, padding:'8px 14px', cursor:'pointer', fontSize:13 }
  const inputSt = { border:'1px solid #d1d5db', borderRadius:7, padding:'8px 12px', fontSize:13, width:'100%', boxSizing:'border-box' }
  const badge   = (c) => ({ background:c, color:'#fff', borderRadius:12, padding:'2px 8px', fontSize:11, fontWeight:600 })
  const estadoColor = { pendiente:'#6b7280', procesando:'#d97706', meta_ok:'#2563eb', completado:'#107569', completado_con_advertencias:'#f59e0b', error:'#dc2626' }

  const historialFiltrado = filtroCon==='todos' ? historial : historial.filter(h=>h.consorcio_id===filtroCon)
  const consorciosFiltro  = [...new Set(historial.map(h=>h.consorcio_id))]
  const tabs = [
    { id:'importar',  label:'📥 Importar' },
    { id:'historial', label:`📋 Importadas (${historial.length})` },
    { id:'cola',      label:`⚙️ Cola (${cola.length})` },
  ]

  return (
    <div style={{ padding:20, maxWidth:1100, margin:'0 auto' }}>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h2 style={{ margin:0, color:'#1F4E79', fontSize:22 }}>📂 Historial de Liquidaciones</h2>
          <p style={{ margin:'4px 0 0', color:'#6b7280', fontSize:13 }}>Importar liquidaciones históricas — Mis Expensas v34</p>
        </div>
        <button style={btn()} onClick={cargarTodo}>🔄 Actualizar</button>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:20, borderBottom:'2px solid #e5e7eb' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            background:'none', border:'none', padding:'10px 16px', cursor:'pointer',
            borderBottom: tab===t.id?'2px solid #1F4E79':'2px solid transparent',
            color: tab===t.id?'#1F4E79':'#6b7280', fontWeight: tab===t.id?700:400, fontSize:14
          }}>{t.label}</button>
        ))}
      </div>

      {msg && (
        <div style={{
          background: msg.startsWith('✅')?'#d1fae5':msg.startsWith('❌')?'#fee2e2':'#fef9c3',
          border:'1px solid', borderColor: msg.startsWith('✅')?'#6ee7b7':msg.startsWith('❌')?'#fca5a5':'#fde68a',
          borderRadius:8, padding:'10px 16px', marginBottom:16, fontSize:13
        }}>{msg}</div>
      )}

      {procesando && (
        <div style={{ ...card, background:'#f0f9ff', border:'1px solid #bae6fd', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
            <span style={{ fontWeight:600, color:'#1F4E79' }}>⚙️ {progreso.paso||'Procesando...'}</span>
            <span style={{ fontSize:12, color:'#6b7280' }}>{progreso.pct}%</span>
          </div>
          <div style={{ height:8, background:'#e2e8f0', borderRadius:4, overflow:'hidden' }}>
            <div style={{ height:'100%', background:'#1F4E79', borderRadius:4, width:`${progreso.pct}%`, transition:'width 0.5s' }} />
          </div>
        </div>
      )}

      {/* ── TAB IMPORTAR ─────────────────────────────────────────────────── */}
      {tab==='importar' && (
        <div>
          {/* Selector consorcio */}
          <div style={{ ...card, background:consorcioImportar?'#f0fdf4':'#fff7ed', border:consorcioImportar?'2px solid #22c55e':'2px solid #f97316', marginBottom:20 }}>
            <h3 style={{ margin:'0 0 10px', fontSize:15, color:consorcioImportar?'#166534':'#9a3412', display:'flex', alignItems:'center', gap:8 }}>
              🏢 Consorcio destino
              <span style={{ fontSize:11, fontWeight:400, background:consorcioImportar?'#dcfce7':'#ffedd5', color:consorcioImportar?'#166534':'#9a3412', padding:'2px 8px', borderRadius:10 }}>
                {consorcioImportar?'Seleccionado':'Requerido'}
              </span>
            </h3>
            <select style={{ ...inputSt, fontWeight:700, fontSize:14, color:'#1F4E79', border:consorcioImportar?'2px solid #22c55e':'2px solid #f97316', background:'#fff' }}
              value={consorcioImportar?.id||''}
              onChange={e=>{ const c=(consorcios||[]).find(x=>x.id===e.target.value); setConsorcioImportar(c||null) }}>
              <option value=''>— Seleccionar consorcio destino —</option>
              {(consorcios||[]).slice().sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).map(c=>(
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            {consorcioImportar
              ? <div style={{ marginTop:10, padding:'8px 14px', background:'#dcfce7', borderRadius:7, fontSize:13, color:'#166534', fontWeight:600 }}>✅ Destino: <b>{consorcioImportar.nombre}</b> <span style={{ fontWeight:400, fontSize:11 }}>({consorcioImportar.id})</span></div>
              : <div style={{ marginTop:8, fontSize:12, color:'#dc2626', fontWeight:600 }}>⛔ Seleccioná el consorcio antes de procesar.</div>
            }
          </div>

          {/* Opción C */}
          <div style={{ background:'#fffbeb', border:'2px solid #f59e0b', borderRadius:8, padding:16, marginBottom:16 }}>
            <h3 style={{ margin:'0 0 6px', fontSize:15, color:'#92400e' }}>📤 Subir PDF desde PC</h3>
            <p style={{ fontSize:12, color:'#92400e', margin:'0 0 10px' }}>
              El PDF se sube a Storage, se procesa en rangos y se elimina automáticamente. Sin límite de tamaño.
            </p>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'9px 20px', background:consorcioImportar&&!procesando?'#f59e0b':'#d1d5db', color:'#fff', borderRadius:6, fontSize:13, fontWeight:700, cursor:consorcioImportar&&!procesando?'pointer':'not-allowed', opacity:consorcioImportar&&!procesando?1:0.6 }}>
              📁 Elegir PDF
              <input type="file" accept=".pdf,application/pdf" style={{ display:'none' }} disabled={!consorcioImportar||procesando} onChange={handleFilePick} />
            </label>
            {!consorcioImportar && <p style={{ margin:'8px 0 0', fontSize:12, color:'#dc2626', fontWeight:600 }}>⛔ Seleccioná el consorcio destino primero.</p>}
          </div>

          {/* Info */}
          <div style={{ ...card, background:'#f0fdf4', border:'1px solid #bbf7d0' }}>
            <h4 style={{ margin:'0 0 8px', fontSize:13, color:'#166534' }}>✅ Flujo v34 — Mis Expensas</h4>
            <ul style={{ margin:0, paddingLeft:20, fontSize:12, color:'#166534', lineHeight:1.8 }}>
              <li>PDF → Supabase Storage (una sola subida)</li>
              <li>Parsing determinista: transcripción pipe-separated + validación aritmética</li>
              <li>Consorcios grandes: procesamiento en rangos de {LOTE_UFS} UFs</li>
              <li>PDF eliminado de Storage al finalizar</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── TAB HISTORIAL ─────────────────────────────────────────────────── */}
      {tab==='historial' && (
        <div>
          <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center' }}>
            <span style={{ fontSize:13, fontWeight:600 }}>Filtrar:</span>
            <select style={{ ...inputSt, width:'auto' }} value={filtroCon} onChange={e=>setFiltroCon(e.target.value)}>
              <option value="todos">Todos ({historial.length})</option>
              {consorciosFiltro.map(id=>(
                <option key={id} value={id}>{(consorcioPorId(id)||{}).nombre||id} ({historial.filter(h=>h.consorcio_id===id).length})</option>
              ))}
            </select>
          </div>
          {loading ? <div style={{ textAlign:'center', padding:40, color:'#6b7280' }}>Cargando...</div>
          : historialFiltrado.length===0 ? (
            <div style={{ ...card, textAlign:'center', color:'#6b7280', padding:40 }}><div style={{ fontSize:40, marginBottom:12 }}>📂</div>No hay liquidaciones importadas.</div>
          ) : (
            [...new Set(historialFiltrado.map(h=>h.consorcio_id))].map(cid=>{
              const perCon=historialFiltrado.filter(h=>h.consorcio_id===cid).sort((a,b)=>b.periodo.localeCompare(a.periodo))
              const con=consorcioPorId(cid)||{}
              return (
                <div key={cid} style={{ ...card, padding:0, overflow:'hidden' }}>
                  <div style={{ background:'#1F4E79', color:'#fff', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontWeight:700, fontSize:14 }}>🏢 {con.nombre||cid}</span>
                    <span style={{ fontSize:12, opacity:0.8 }}>{perCon.length} período(s)</span>
                  </div>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead><tr style={{ background:'#f8fafc' }}>
                      {['Período','Vencimiento','Total Gastos','Saldo Final','PDF'].map(h=>(
                        <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontSize:12, color:'#6b7280', fontWeight:600, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {perCon.map((h,i)=>(
                        <tr key={h.id} style={{ borderBottom:'1px solid #f3f4f6', background:i%2?'#fafafa':'#fff' }}>
                          <td style={{ padding:'10px 14px', fontWeight:600, fontSize:13 }}>{h.periodo}</td>
                          <td style={{ padding:'10px 14px', fontSize:12, color:'#6b7280' }}>{h.fecha_vencimiento||'—'}</td>
                          <td style={{ padding:'10px 14px', fontSize:13 }}>{fmt(h.total_gastos)}</td>
                          <td style={{ padding:'10px 14px', fontSize:13 }}><span style={{ color:(h.saldo_caja_final||0)>=0?'#107569':'#dc2626', fontWeight:600 }}>{fmt(h.saldo_caja_final)}</span></td>
                          <td style={{ padding:'10px 14px' }}>{h.drive_pdf_url?<a href={h.drive_pdf_url} target="_blank" rel="noreferrer" style={{ color:'#1F4E79', fontSize:12 }}>📄 Ver</a>:<span style={{ color:'#9ca3af', fontSize:11 }}>—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── TAB COLA ──────────────────────────────────────────────────────── */}
      {tab==='cola' && (
        <div>
          {cola.length===0
            ? <div style={{ ...card, textAlign:'center', color:'#6b7280', padding:40 }}>No hay ítems en la cola.</div>
            : <div style={card}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr style={{ background:'#f8fafc' }}>
                    {['Archivo','Consorcio','Estado','Período','Procesado'].map(h=>(
                      <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:12, color:'#6b7280', fontWeight:600, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {cola.map((c,i)=>(
                      <tr key={c.id} style={{ borderBottom:'1px solid #f3f4f6', background:i%2?'#fafafa':'#fff' }}>
                        <td style={{ padding:'8px 12px', fontSize:12, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.drive_file_nombre||c.drive_file_id}</td>
                        <td style={{ padding:'8px 12px', fontSize:12 }}>{c.consorcio_nombre}</td>
                        <td style={{ padding:'8px 12px' }}>
                          <span style={badge(estadoColor[c.estado]||'#6b7280')}>{c.estado}</span>
                          {c.error_mensaje&&<div style={{ fontSize:10, color:'#6b7280', marginTop:2 }}>{c.error_mensaje.slice(0,80)}</div>}
                        </td>
                        <td style={{ padding:'8px 12px', fontSize:12 }}>{c.periodo_detectado||'—'}</td>
                        <td style={{ padding:'8px 12px', fontSize:11, color:'#9ca3af' }}>{c.procesado_at?new Date(c.procesado_at).toLocaleString('es-AR'):'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </div>
      )}
    </div>
  )
}
