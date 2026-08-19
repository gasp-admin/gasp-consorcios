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

export default function InterfastPanel() {
  const { session, consorcioActivo, expensas } = useApp()
  const consorcioId = consorcioActivo?.id
  const [cfg, setCfg] = useState(null)
  const [ufs, setUfs] = useState([])
  const [expSel, setExpSel] = useState('')
  const [fDesde, setFDesde] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [fHasta, setFHasta] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null)

  useEffect(() => { if (consorcioId) { cargarCfg(); cargarUfs() } }, [consorcioId])

  async function cargarCfg() {
    const { data } = await supabase.from('con_config_cobranza').select('*').eq('consorcio_id', consorcioId).maybeSingle()
    setCfg(data || { consorcio_id: consorcioId, interfast_activo: false, interfast_convenio: '', interfast_codigo_admin: '', interfast_api_usuario: '', interfast_api_password: '' })
  }
  async function cargarUfs() {
    const { data } = await supabase.from('con_interfast_uf').select('*').eq('consorcio_id', consorcioId).order('codigo_cliente')
    setUfs(data || [])
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
    else setMsg({ t: d.ok ? 'ok' : 'e', x: d.ok ? `✓ Publicado. Nº ${d.respuesta?.PublicacionId ?? ''} — ${d.total_registros} UF` : (d.respuesta?.Mensaje || d.mensaje || 'Error al publicar') })
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

  if (!consorcioId) return <div style={{ padding: 20, color: GR }}>Elegí un consorcio.</div>
  if (!cfg) return <div style={{ padding: 20, color: GR }}>Cargando…</div>
  const expOrd = [...(expensas || [])].filter(e => e.consorcio_id === consorcioId).sort((a, b) => (b.periodo || '').localeCompare(a.periodo || ''))
  const B = (busy !== '')

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
    </div>
  )
}
