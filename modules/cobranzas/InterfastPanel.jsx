import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'

const fmtN = n => '$' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })
const box = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 16, background: '#fff' }
const h = { fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#111' }
const lbl = { fontSize: 12, color: GR, marginBottom: 4, display: 'block' }
const inp = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }
const btn = (bg, dis) => ({ padding: '8px 14px', border: 'none', borderRadius: 8, background: dis ? '#cbd5e1' : bg, color: '#fff', fontWeight: 600, fontSize: 13, cursor: dis ? 'default' : 'pointer' })

const primerDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

export default function InterfastPanel() {
  const { session, consorcioActivo, expensas, puede } = useApp()
  const consorcioId = consorcioActivo?.id
  const [cfg, setCfg] = useState(null)
  const [ufs, setUfs] = useState([])
  const [expSel, setExpSel] = useState('')
  const [fDesde, setFDesde] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [fHasta, setFHasta] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [pubs, setPubs] = useState([])
  // Conciliación y control
  const [cDesde, setCDesde] = useState(primerDiaMes())
  const [cHasta, setCHasta] = useState(new Date().toISOString().slice(0, 10))
  const [cTodos, setCTodos] = useState(true)
  const [cSoloProb, setCSoloProb] = useState(true)
  const [concil, setConcil] = useState(null)

  useEffect(() => { if (consorcioId) { cargarCfg(); cargarUfs(); cargarPubs() } }, [consorcioId])

  async function cargarCfg() {
    const { data } = await supabase.from('con_config_cobranza').select('*').eq('consorcio_id', consorcioId).maybeSingle()
    setCfg(data || { consorcio_id: consorcioId, interfast_activo: false, interfast_convenio: '', interfast_codigo_admin: '', interfast_api_usuario: '', interfast_api_password: '' })
  }
  async function cargarUfs() {
    const { data } = await supabase.from('con_interfast_uf').select('*').eq('consorcio_id', consorcioId).order('codigo_cliente')
    setUfs(data || [])
  }
  async function cargarPubs() {
    const { data } = await supabase.from('con_interfast_publicacion').select('*').eq('consorcio_id', consorcioId).order('created_at', { ascending: false })
    setPubs(data || [])
  }
  function set(k, v) { setCfg(c => ({ ...c, [k]: v })) }

  async function guardarCfg() {
    setBusy('cfg'); setMsg(null)
    const payload = { ...cfg, id: `CFG-COB-${consorcioId}`, admin_id: session.user.id, consorcio_id: consorcioId, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('con_config_cobranza').upsert([payload], { onConflict: 'consorcio_id' })
    setBusy(''); setMsg(error ? { t: 'e', x: error.message } : { t: 'ok', x: '✓ Configuración guardada' })
  }

  async function invoke(fn, body, tag) {
    setBusy(tag); setMsg(null); setPreview(null)
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      return data
    } catch (e) { setMsg({ t: 'e', x: e.message }); return null }
    finally { setBusy('') }
  }

  async function publicar(dry) {
    if (!expSel) return setMsg({ t: 'w', x: 'Elegí una liquidación' })
    const d = await invoke('publicar-deuda-interfast', { expensa_id: expSel, dry_run: dry }, dry ? 'pub-dry' : 'pub')
    if (!d) return
    if (dry) { setPreview(d); setMsg({ t: 'ok', x: `Vista previa: ${d.total_registros} UF · 1er vto ${fmtN(d.total_1er_vto)} · 2do ${fmtN(d.total_2do_vto)}` }) }
    else { setMsg({ t: d.ok ? 'ok' : 'e', x: d.ok ? `✓ Publicado. Nº ${d.respuesta?.PublicacionId ?? ''} — ${d.total_registros} UF` : (d.respuesta?.Mensaje || d.mensaje || 'Error al publicar') }); if (d.ok) cargarPubs() }
  }
  async function cvu() {
    const d = await invoke('interfast-medios-pago', { accion: 'cvu_crear', consorcio_id: consorcioId }, 'cvu')
    if (d) { setMsg({ t: 'ok', x: `CVU: ${d.creadas} procesadas · ${d.errores} errores` }); cargarUfs() }
  }
  async function cvuSync() {
    const d = await invoke('interfast-medios-pago', { accion: 'cvu_listar', consorcio_id: consorcioId }, 'cvusync')
    if (d) { setMsg({ t: 'ok', x: `Sincronizadas ${d.con_cvu} CVU · ${d.sin_cvu} sin asignar` }); cargarUfs() }
  }
  async function qr() {
    const d = await invoke('interfast-medios-pago', { accion: 'qr_generar', consorcio_id: consorcioId }, 'qr')
    if (d) { setMsg({ t: d.generados ? 'ok' : 'w', x: `QR: ${d.generados} generados · ${d.errores} errores` }); cargarUfs() }
  }
  async function traerPagos(dry) {
    const d = await invoke('imputar-pagos-interfast', { consorcio_id: consorcioId, fecha_desde: fDesde, fecha_hasta: fHasta, dry_run: dry }, dry ? 'pg-dry' : 'pg')
    if (!d) return
    setPreview(d)
    setMsg({ t: 'ok', x: dry ? `${d.total_pagos} pagos · ${d.detalle?.filter(x => x.estado === 'imputaria').length || 0} a imputar` : `✓ Imputados ${d.imputados} · ${d.ya_imputados} ya estaban · ${d.sin_match} sin UF` })
  }

  // ── Conciliación y control ──────────────────────────────────────────────
  async function conciliar() {
    setConcil(null)
    const body = { fecha_desde: cDesde, fecha_hasta: cHasta }
    if (!cTodos) body.consorcio_id = consorcioId
    const d = await invoke('conciliar-interfast', body, 'conc')
    if (!d) return
    setConcil(d)
    const t = d.totales || {}
    setMsg({ t: (t.no_imputado_cant || t.sin_match_cant || t.sin_rendicion_cant) ? 'w' : 'ok', x: `Conciliado ${t.conciliado_cant}/${t.rendido_cant} · No imputado ${t.no_imputado_cant} (${fmtN(t.no_imputado_total)}) · Sin UF ${t.sin_match_cant} · Huérfanos ${t.sin_rendicion_cant}` })
  }
  async function imputarFaltantes(c) {
    const n = c.no_imputado_cant + c.sin_match_cant
    if (!window.confirm(`Imputar en ${c.nombre} los pagos rendidos por Interfast que faltan (${c.no_imputado_cant} imputables${c.sin_match_cant ? ` · ${c.sin_match_cant} sin match UF se saltarán` : ''})?\nSe crearán las cobranzas en la cta cte. Rango ${cDesde} a ${cHasta}.`)) return
    const d = await invoke('imputar-pagos-interfast', { consorcio_id: c.consorcio_id, fecha_desde: cDesde, fecha_hasta: cHasta, dry_run: false }, 'imp-' + c.consorcio_id)
    if (!d) return
    setMsg({ t: 'ok', x: `✓ ${c.nombre}: imputados ${d.imputados} · ya estaban ${d.ya_imputados} · sin UF ${d.sin_match}` })
    conciliar()
  }
  function exportCSV() {
    if (!concil) return
    const rows = [['Consorcio', 'Fecha', 'UF', 'CodCliente', 'Canal', 'Monto', 'Estado', 'IdPago']]
    for (const c of concil.consorcios || []) {
      for (const p of c.pagos || []) rows.push([c.nombre, p.fecha, p.uf_label, p.codCliente, p.canal || '', String(p.monto).replace('.', ','), p.estado, p.idPago])
      for (const hg of c.huerfanos_gasp || []) rows.push([c.nombre, hg.fecha, hg.uf_label, '', '', String(hg.monto).replace('.', ','), 'huerfano_gasp', hg.idPago])
    }
    const csv = rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `conciliacion_interfast_${cDesde}_${cHasta}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const card = (label, cant, monto, color) => (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: GR }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{cant}</div>
      <div style={{ fontSize: 12, color: '#374151' }}>{fmtN(monto)}</div>
    </div>
  )
  const estBadge = (est) => {
    const m = ({
      conciliado: { bg: '#dcfce7', c: '#166534', t: 'Conciliado' },
      no_imputado: { bg: '#fee2e2', c: '#991b1b', t: 'No imputado' },
      sin_match_uf: { bg: '#ffedd5', c: '#9a3412', t: 'Sin match UF' },
      monto_cero: { bg: '#f1f5f9', c: '#475569', t: 'Monto 0' },
      huerfano_gasp: { bg: '#fef9c3', c: '#854d0e', t: 'Huérfano GASP' },
    })[est] || { bg: '#f1f5f9', c: '#475569', t: est }
    return <span style={{ background: m.bg, color: m.c, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{m.t}</span>
  }

  if (!consorcioId) return <div style={{ padding: 20, color: GR }}>Elegí un consorcio.</div>
  if (!cfg) return <div style={{ padding: 20, color: GR }}>Cargando…</div>
  const expOrd = [...(expensas || [])].filter(e => e.consorcio_id === consorcioId).sort((a, b) => (b.periodo || '').localeCompare(a.periodo || ''))
  const B = (busy !== '')
  const puedeCobrar = typeof puede === 'function' ? puede('cobrar') : true
  const consConMov = concil ? (concil.consorcios || []).filter(c => c.rendido_cant > 0 || c.imputado_cant > 0 || c.error) : []
  const detalle = concil ? (concil.consorcios || []).flatMap(c => [
    ...(c.pagos || []).map(p => ({ consorcio: c.nombre, fecha: p.fecha, uf_label: p.uf_label, canal: p.canal, monto: p.monto, estado: p.estado, idPago: p.idPago })),
    ...(c.huerfanos_gasp || []).map(hg => ({ consorcio: c.nombre, fecha: hg.fecha, uf_label: hg.uf_label, canal: '', monto: hg.monto, estado: 'huerfano_gasp', idPago: hg.idPago })),
  ]) : []
  const detalleVis = detalle.filter(d => !cSoloProb || d.estado !== 'conciliado').sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))

  return (
    <div style={{ maxWidth: 900 }}>
      {msg && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13, background: msg.t === 'e' ? '#fee2e2' : msg.t === 'w' ? '#fef9c3' : '#dcfce7', color: msg.t === 'e' ? '#991b1b' : msg.t === 'w' ? '#854d0e' : '#166534' }}>{msg.x}</div>}

      {/* Config */}
      <div style={box}>
        <div style={h}>⚙️ Configuración Interfast (Banco Macro)</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13 }}>
          <input type="checkbox" checked={!!cfg.interfast_activo} onChange={e => set('interfast_activo', e.target.checked)} />
          Interfast activo para este consorcio
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={lbl}>Código de convenio</label><input style={inp} value={cfg.interfast_convenio || ''} onChange={e => set('interfast_convenio', e.target.value)} placeholder="ej. 1" /></div>
          <div><label style={lbl}>Código de administrador</label><input style={inp} value={cfg.interfast_codigo_admin || ''} onChange={e => set('interfast_codigo_admin', e.target.value)} placeholder="ej. 903" /></div>
          <div><label style={lbl}>Usuario API</label><input style={inp} value={cfg.interfast_api_usuario || ''} onChange={e => set('interfast_api_usuario', e.target.value)} /></div>
          <div><label style={lbl}>Contraseña API</label><input style={inp} type="password" value={cfg.interfast_api_password || ''} onChange={e => set('interfast_api_password', e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 12 }}><button style={btn(AZ, busy === 'cfg')} disabled={B} onClick={guardarCfg}>{busy === 'cfg' ? 'Guardando…' : 'Guardar configuración'}</button></div>
      </div>

      {/* Publicar */}
      <div style={box}>
        <div style={h}>📤 Publicar deuda</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={lbl}>Liquidación</label>
            <select style={inp} value={expSel} onChange={e => setExpSel(e.target.value)}>
              <option value="">— Elegí —</option>
              {expOrd.map(e => <option key={e.id} value={e.id}>{e.periodo} · {e.estado}</option>)}
            </select>
          </div>
          <button style={btn(GR, busy === 'pub-dry')} disabled={B} onClick={() => publicar(true)}>Vista previa</button>
          <button style={btn(VD, busy === 'pub')} disabled={B} onClick={() => publicar(false)}>Publicar</button>
        </div>
        {preview?.publicacion && (
          <div style={{ marginTop: 12, maxHeight: 220, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f8fafc' }}><th style={{ padding: 6, textAlign: 'left' }}>UF</th><th style={{ padding: 6, textAlign: 'left' }}>Nombre</th><th style={{ padding: 6, textAlign: 'right' }}>1er vto</th><th style={{ padding: 6, textAlign: 'right' }}>2do vto</th></tr></thead>
              <tbody>{preview.publicacion.Items.map((it, i) => <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 6 }}>{it.CodigoCliente}</td><td style={{ padding: 6 }}>{it.NombreCliente}</td><td style={{ padding: 6, textAlign: 'right' }}>{fmtN(it.ImportePrimerVencimiento)}</td><td style={{ padding: 6, textAlign: 'right' }}>{fmtN(it.ImporteSegundoVencimiento)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Publicaciones a Interfast */}
      <div style={box}>
        <div style={h}>🧾 Publicaciones a Interfast</div>
        {pubs.length > 0 ? (
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: 6, textAlign: 'left' }}>Período</th>
                <th style={{ padding: 6, textAlign: 'left' }}>IdDeuda</th>
                <th style={{ padding: 6, textAlign: 'right' }}>1er vto</th>
                <th style={{ padding: 6, textAlign: 'right' }}>2do vto</th>
                <th style={{ padding: 6, textAlign: 'center' }}>UF</th>
                <th style={{ padding: 6, textAlign: 'center' }}>Estado</th>
                <th style={{ padding: 6, textAlign: 'left' }}>Fecha</th>
              </tr></thead>
              <tbody>{pubs.map(p => {
                const ok = p.respuesta?.Exito === true || String(p.respuesta?.Exito) === 'true'
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: 6 }}>{p.periodo}</td>
                    <td style={{ padding: 6, fontFamily: 'monospace' }}>{p.id_deuda ?? '—'}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(p.total_1er_vto)}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(p.total_2do_vto)}</td>
                    <td style={{ padding: 6, textAlign: 'center' }}>{p.registros}</td>
                    <td style={{ padding: 6, textAlign: 'center', color: ok ? '#166534' : '#991b1b', fontWeight: 600 }}>{ok ? '✅ OK' : '❌'}</td>
                    <td style={{ padding: 6 }}>{String(p.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        ) : <div style={{ fontSize: 12, color: GR }}>Sin publicaciones registradas todavía.</div>}
      </div>

      {/* Medios de pago */}
      <div style={box}>
        <div style={h}>💳 Medios de pago (CVU · QR)</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <button style={btn(AZ, busy === 'cvu')} disabled={B} onClick={cvu}>Crear CVU</button>
          <button style={btn(GR, busy === 'cvusync')} disabled={B} onClick={cvuSync}>Sincronizar CVU</button>
          <button style={btn(GR, busy === 'qr')} disabled={B} onClick={qr}>Generar QR</button>
        </div>
        {ufs.length > 0 ? (
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f8fafc' }}><th style={{ padding: 6, textAlign: 'left' }}>UF</th><th style={{ padding: 6, textAlign: 'left' }}>CPE</th><th style={{ padding: 6, textAlign: 'left' }}>CVU</th><th style={{ padding: 6, textAlign: 'center' }}>QR</th></tr></thead>
              <tbody>{ufs.map(u => <tr key={u.id} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 6 }}>{u.codigo_cliente}</td><td style={{ padding: 6, fontFamily: 'monospace' }}>{u.cpe}</td><td style={{ padding: 6, fontFamily: 'monospace' }}>{u.cvu || <span style={{ color: GR }}>—</span>}</td><td style={{ padding: 6, textAlign: 'center' }}>{u.qr ? '✓' : '—'}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <div style={{ fontSize: 12, color: GR }}>Sin CVU generadas todavía.</div>}
      </div>

      {/* Traer pagos */}
      <div style={box}>
        <div style={h}>📥 Traer pagos (rendiciones)</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Desde</label><input style={inp} type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} /></div>
          <div><label style={lbl}>Hasta</label><input style={inp} type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} /></div>
          <button style={btn(GR, busy === 'pg-dry')} disabled={B} onClick={() => traerPagos(true)}>Vista previa</button>
          <button style={btn(VD, busy === 'pg')} disabled={B} onClick={() => traerPagos(false)}>Imputar</button>
        </div>
        {preview?.detalle && Array.isArray(preview.detalle) && (
          <div style={{ marginTop: 12, maxHeight: 220, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f8fafc' }}><th style={{ padding: 6, textAlign: 'left' }}>Pago</th><th style={{ padding: 6, textAlign: 'left' }}>UF</th><th style={{ padding: 6, textAlign: 'right' }}>Monto</th><th style={{ padding: 6, textAlign: 'left' }}>Estado</th></tr></thead>
              <tbody>{preview.detalle.map((d, i) => <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 6 }}>{d.idPago}</td><td style={{ padding: 6 }}>{d.codCliente}</td><td style={{ padding: 6, textAlign: 'right' }}>{fmtN(d.monto)}</td><td style={{ padding: 6 }}>{d.estado}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Conciliación y control */}
      <div style={box}>
        <div style={h}>🔎 Conciliación y control de acreditaciones</div>
        <div style={{ fontSize: 12, color: GR, marginBottom: 12 }}>Cruza lo <b>rendido por Interfast</b> contra lo <b>imputado en GASP</b> (cta cte) en ambos sentidos. No modifica datos: solo el botón “Imputar faltantes” crea cobranzas, con confirmación.</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 6 }}>
          <div><label style={lbl}>Desde</label><input style={inp} type="date" value={cDesde} onChange={e => setCDesde(e.target.value)} /></div>
          <div><label style={lbl}>Hasta</label><input style={inp} type="date" value={cHasta} onChange={e => setCHasta(e.target.value)} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 8 }}>
            <input type="checkbox" checked={cTodos} onChange={e => setCTodos(e.target.checked)} /> Todos los consorcios activos
          </label>
          <button style={btn(AZ, busy === 'conc')} disabled={B} onClick={conciliar}>{busy === 'conc' ? 'Conciliando…' : 'Conciliar'}</button>
          {concil && <button style={btn(GR, false)} disabled={B} onClick={exportCSV}>Exportar CSV</button>}
        </div>

        {concil && (
          <div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '14px 0' }}>
              {card('Rendido IF', concil.totales?.rendido_cant || 0, concil.totales?.rendido_total || 0, '#111')}
              {card('Conciliado', concil.totales?.conciliado_cant || 0, concil.totales?.conciliado_total || 0, VD)}
              {card('No imputado', concil.totales?.no_imputado_cant || 0, concil.totales?.no_imputado_total || 0, RJ)}
              {card('Sin match UF', concil.totales?.sin_match_cant || 0, concil.totales?.sin_match_total || 0, AM)}
              {card('Huérfanos GASP', concil.totales?.sin_rendicion_cant || 0, concil.totales?.sin_rendicion_total || 0, AM)}
            </div>

            {/* Resumen por consorcio */}
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #eee', borderRadius: 8, marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: 6, textAlign: 'left' }}>Consorcio</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>Rend.</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>$ Rendido</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>Concil.</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>No imp.</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>Sin UF</th>
                  <th style={{ padding: 6, textAlign: 'center' }}>Huérf.</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Diferencia</th>
                  <th style={{ padding: 6, textAlign: 'center' }}></th>
                </tr></thead>
                <tbody>{consConMov.length ? consConMov.map(c => {
                  const alerta = (c.no_imputado_cant + c.sin_match_cant + c.sin_rendicion_cant) > 0 || c.error
                  return (
                    <tr key={c.consorcio_id} style={{ borderTop: '1px solid #f1f5f9', background: c.error ? '#fef2f2' : alerta ? '#fffbeb' : '#fff' }}>
                      <td style={{ padding: 6 }}>{c.nombre}{c.error ? <span style={{ color: '#991b1b' }}> — {c.error}</span> : ''}</td>
                      <td style={{ padding: 6, textAlign: 'center' }}>{c.rendido_cant}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(c.rendido_total)}</td>
                      <td style={{ padding: 6, textAlign: 'center', color: '#166534' }}>{c.conciliado_cant}</td>
                      <td style={{ padding: 6, textAlign: 'center', color: c.no_imputado_cant ? '#991b1b' : '#94a3b8', fontWeight: c.no_imputado_cant ? 700 : 400 }}>{c.no_imputado_cant}</td>
                      <td style={{ padding: 6, textAlign: 'center', color: c.sin_match_cant ? '#9a3412' : '#94a3b8' }}>{c.sin_match_cant}</td>
                      <td style={{ padding: 6, textAlign: 'center', color: c.sin_rendicion_cant ? '#854d0e' : '#94a3b8' }}>{c.sin_rendicion_cant}</td>
                      <td style={{ padding: 6, textAlign: 'right', color: Math.abs(c.diferencia) > 0.009 ? '#991b1b' : '#166534', fontWeight: 600 }}>{fmtN(c.diferencia)}</td>
                      <td style={{ padding: 6, textAlign: 'center' }}>{c.no_imputado_cant > 0 && puedeCobrar ? <button style={btn(VD, busy === 'imp-' + c.consorcio_id)} disabled={B} onClick={() => imputarFaltantes(c)}>Imputar</button> : ''}</td>
                    </tr>
                  )
                }) : <tr><td colSpan={9} style={{ padding: 10, textAlign: 'center', color: GR }}>Sin movimientos de Interfast en el rango.</td></tr>}</tbody>
              </table>
            </div>

            {/* Detalle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Detalle ({detalleVis.length})</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: GR }}>
                <input type="checkbox" checked={cSoloProb} onChange={e => setCSoloProb(e.target.checked)} /> Solo con diferencias
              </label>
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: 6, textAlign: 'left' }}>Fecha</th>
                  {cTodos && <th style={{ padding: 6, textAlign: 'left' }}>Consorcio</th>}
                  <th style={{ padding: 6, textAlign: 'left' }}>UF</th>
                  <th style={{ padding: 6, textAlign: 'left' }}>Canal</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Monto</th>
                  <th style={{ padding: 6, textAlign: 'left' }}>Estado</th>
                </tr></thead>
                <tbody>{detalleVis.length ? detalleVis.map((d, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: 6 }}>{d.fecha}</td>
                    {cTodos && <td style={{ padding: 6 }}>{d.consorcio}</td>}
                    <td style={{ padding: 6 }}>{d.uf_label}</td>
                    <td style={{ padding: 6, color: GR }}>{d.canal || '—'}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{fmtN(d.monto)}</td>
                    <td style={{ padding: 6 }}>{estBadge(d.estado)}</td>
                  </tr>
                )) : <tr><td colSpan={cTodos ? 6 : 5} style={{ padding: 10, textAlign: 'center', color: GR }}>Nada para mostrar.</td></tr>}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
