// modules/consorcio/FichaConsorcio.jsx
// Módulo: Ficha y edición del consorcio activo — v2
// Campos ajustados a la estructura real de con_consorcios

import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL } from '../../lib/config'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { Card, Btn } from '../../components/ui'

const FLD = { fontSize: 13, padding: '7px 10px', border: '1px solid #d0d9e8', borderRadius: 6, width: '100%', boxSizing: 'border-box' }
const LBL = { fontSize: 12, color: '#5a6a8a', fontWeight: 600, marginBottom: 3, display: 'block' }
const SEC = { fontWeight: 700, fontSize: 13, color: AZ, borderBottom: '2px solid #e0e8f4', paddingBottom: 6, marginBottom: 14, marginTop: 22 }
const COL2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }
const COL3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 16px' }

const FORMATOS = [
  { value: 'standard',     label: 'Standard (1 grupo de gastos)' },
  { value: 'con_subtotal', label: 'Con subtotal — Ática II' },
  { value: 'cazon',        label: 'Cazón 1900 (3 grupos %)' },
]

// Campos que se guardan en con_consorcios
const CAMPOS = [
  'nombre', 'cuit', 'direccion', 'localidad', 'provincia', 'telefono', 'email_consorcio',
  'banco', 'cbu', 'alias_cbu', 'nro_cuenta',
  'aseguradora', 'poliza_nro', 'poliza_compania', 'poliza_vto_desde', 'poliza_vto_hasta', 'poliza_suma', 'poliza_vencimiento',
  'poliza_url', 'poliza_coberturas', 'poliza_detalle', 'poliza_analizada_at',
  'matricula_rpi', 'escritura_nro', 'escritura_fecha', 'escritura_escribano',
  'vto1_dia', 'vto2_dia',
  'interes_mora', 'interes_mora_2',
  'notas_liquidacion_default',
  'formato_liquidacion', 'modelo_cc',
  'reglamento_url', 'drive_folder_url',
  'notas',
]

function emptyForm(c) {
  const f = {}
  CAMPOS.forEach(k => { f[k] = c?.[k] ?? '' })
  return f
}

export default function FichaConsorcio() {
  const { consorcioActivo, setConsorcioActivo, setConsorcios, consorcios, session, pagina, setPagina, puede } = useApp()
  const esNuevo = pagina === 'nuevo_consorcio'
  const [form, setForm]         = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg]           = useState(null)
  const [analizandoReg, setAnalizandoReg] = useState(false)
  const [msgReg, setMsgReg]     = useState(null)
  const [analizandoPol, setAnalizandoPol] = useState(false)
  const [msgPol, setMsgPol]     = useState(null)
  const [cambiosPol, setCambiosPol] = useState([])
  const [codigoNuevo, setCodigoNuevo] = useState('')

  useEffect(() => {
    if (esNuevo) {
      setForm(emptyForm(null))
      const maxNum = Math.max(0, ...(consorcios||[]).map(c => parseInt(String(c.id||'').replace(/^CON/i,''), 10) || 0))
      setCodigoNuevo(String(maxNum + 1))
    }
    else if (consorcioActivo) setForm(emptyForm(consorcioActivo))
  }, [consorcioActivo?.id, esNuevo])

  function upd(k, v) { setForm(f => ({ ...f, [k]: v })); setMsg(null) }

  async function crearNuevo() {
    if (!puede('editar')) { setMsg({ tipo:'err', txt:'Tu rol no permite editar datos del consorcio.' }); return }
    if (!form.nombre?.trim()) { setMsg({ tipo:'err', txt:'⚠️ El nombre del consorcio es obligatorio.' }); return }
    setGuardando(true); setMsg(null)
    try {
      const cod = String(codigoNuevo || '').trim().replace(/^CON/i,'').trim()
      if (!cod) { setMsg({ tipo:'err', txt:'⚠️ Ingresá el código del consorcio.' }); setGuardando(false); return }
      const nuevoId = 'CON' + cod
      if ((consorcios||[]).some(c => String(c.id||'').toUpperCase() === nuevoId.toUpperCase())) {
        setMsg({ tipo:'err', txt:`⚠️ Ya existe un consorcio con el ID ${nuevoId}. Elegí otro código.` }); setGuardando(false); return
      }
      const adminId = (consorcios||[])[0]?.admin_id || session?.user?.id
      if (!adminId) throw new Error('No se pudo determinar el administrador.')
      const payload = { id: nuevoId, admin_id: adminId }
      CAMPOS.forEach(k => { const v = form[k]; payload[k] = (v === '' || v === null || v === undefined) ? null : v })
      const { error } = await supabase.from('con_consorcios').insert(payload)
      if (error) throw error
      const creado = { ...payload }
      setConsorcios(prev => [...(prev||[]), creado])
      setConsorcioActivo(creado)
      setMsg({ tipo:'ok', txt:`✅ Consorcio creado con ID ${nuevoId}. Completá el resto de los datos y guardá.` })
      setPagina('ficha_consorcio')
    } catch(e) {
      setMsg({ tipo:'err', txt:'❌ Error al crear el consorcio: ' + e.message })
    } finally { setGuardando(false) }
  }

  async function guardar() {
    if (esNuevo) return crearNuevo()
    if (!consorcioActivo?.id) return
    setGuardando(true); setMsg(null)
    try {
      // Solo enviar campos no vacíos (evitar sobrescribir con cadenas vacías tipos date)
      const payload = {}
      CAMPOS.forEach(k => {
        const v = form[k]
        if (v === '' || v === null || v === undefined) {
          payload[k] = null
        } else {
          payload[k] = v
        }
      })
      const { error } = await supabase.from('con_consorcios').update(payload).eq('id', consorcioActivo.id)
      if (error) throw error
      const updated = { ...consorcioActivo, ...payload }
      setConsorcioActivo(updated)
      setConsorcios(prev => prev.map(c => c.id === updated.id ? updated : c))
      setMsg({ tipo: 'ok', txt: '✅ Datos guardados correctamente.' })
    } catch(e) {
      setMsg({ tipo: 'err', txt: '❌ Error al guardar: ' + e.message })
    } finally { setGuardando(false) }
  }

  async function analizarReglamento() {
    if (!form.reglamento_url?.trim()) {
      setMsgReg({ tipo: 'err', txt: '⚠️ Primero cargá la URL del reglamento en Google Drive.' })
      return
    }
    setAnalizandoReg(true); setMsgReg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${SUPA_URL}/functions/v1/extraer-reglamento-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ reglamento_url: form.reglamento_url }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error || 'No se pudo analizar el reglamento')
      const d = json.datos || {}
      setForm(f => ({
        ...f,
        matricula_rpi: d.matricula_rpi && d.matricula_rpi !== 'null' ? d.matricula_rpi : f.matricula_rpi,
        escritura_escribano: d.escritura_escribano && d.escritura_escribano !== 'null' ? d.escritura_escribano : f.escritura_escribano,
        escritura_nro: d.escritura_nro && d.escritura_nro !== 'null' ? d.escritura_nro : f.escritura_nro,
        escritura_fecha: d.escritura_fecha && d.escritura_fecha !== 'null' ? d.escritura_fecha : f.escritura_fecha,
      }))
      const confianzaIcon = d.confianza === 'alta' ? '✅' : d.confianza === 'media' ? '⚠️' : '❗'
      setMsgReg({
        tipo: d.confianza === 'baja' ? 'warn' : 'ok',
        txt: `${confianzaIcon} Datos extraídos (confianza ${d.confianza || 'media'}). Revisá los campos antes de guardar.${d.notas ? ' — ' + d.notas : ''}`,
      })
    } catch(e) {
      setMsgReg({ tipo: 'err', txt: '❌ Error al analizar: ' + e.message })
    } finally { setAnalizandoReg(false) }
  }

  // ── Póliza: análisis con IA (EF extraer-poliza-pdf). Completa el formulario; se persiste recién al Guardar.
  // Actualiza de forma indirecta la Agenda (lee poliza_vto_hasta) y el PDF de liquidación (art. 11 inc. j).
  async function analizarPoliza() {
    if (!form.poliza_url?.trim()) { setMsgPol({ tipo: 'err', txt: '⚠️ Primero cargá el link de la póliza en Google Drive.' }); return }
    setAnalizandoPol(true); setMsgPol(null); setCambiosPol([])
    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      const resp = await fetch(`${SUPA_URL}/functions/v1/extraer-poliza-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token}` },
        body: JSON.stringify({ poliza_url: form.poliza_url.trim() }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!json.ok) throw new Error(json.error || 'No se pudo analizar la póliza')
      const d = json.datos || {}
      const val = v => (v === null || v === undefined || v === '' || v === 'null') ? null : v
      const nuevos = {
        aseguradora:      val(d.aseguradora),
        poliza_compania:  val(d.compania_razon_social),
        poliza_nro:       val(d.poliza_nro) != null ? String(d.poliza_nro).trim() : null,
        poliza_vto_desde: val(d.vigencia_desde),
        poliza_vto_hasta: val(d.vigencia_hasta),
        poliza_suma:      val(d.suma_asegurada_principal),
      }
      const ETQ = { aseguradora: 'Aseguradora', poliza_compania: 'Compañía (razón social)', poliza_nro: 'N° de póliza',
        poliza_vto_desde: 'Vigencia desde', poliza_vto_hasta: 'Vencimiento', poliza_suma: 'Suma asegurada' }
      const cambios = []
      Object.entries(nuevos).forEach(([k, v]) => {
        if (v === null) return
        const antes = form[k] === '' || form[k] == null ? '' : String(form[k])
        if (String(v) !== antes) cambios.push({ campo: ETQ[k], antes: antes || '—', despues: String(v) })
      })
      const detalle = { asegurado: val(d.asegurado), ubicacion_riesgo: val(d.ubicacion_riesgo), productor: val(d.productor),
        ramo: val(d.ramo), moneda: val(d.moneda), premio_total: val(d.premio_total), forma_pago: val(d.forma_pago),
        cuotas: Array.isArray(d.cuotas) ? d.cuotas : [], confianza: d.confianza || 'media', notas: d.notas || '', modo: json.modo }
      setForm(f => {
        const n = { ...f }
        Object.entries(nuevos).forEach(([k, v]) => { if (v !== null) n[k] = v })
        if (Array.isArray(d.coberturas) && d.coberturas.length) n.poliza_coberturas = d.coberturas
        n.poliza_detalle = detalle
        n.poliza_analizada_at = new Date().toISOString()
        return n
      })
      setCambiosPol(cambios)
      // Controles de coherencia (no bloquean; avisan)
      const avisos = []
      const nums = String(form.direccion || '').match(/\d{3,}/g) || []
      if (detalle.ubicacion_riesgo && nums.length && !nums.some(x => String(detalle.ubicacion_riesgo).includes(x)))
        avisos.push(`la ubicación del riesgo ("${detalle.ubicacion_riesgo}") no coincide con el domicilio del consorcio: verificá que la póliza corresponda a este edificio`)
      if (nuevos.poliza_vto_hasta && nuevos.poliza_vto_hasta < new Date().toISOString().slice(0, 10))
        avisos.push('la vigencia informada ya está vencida: ¿es la póliza renovada?')
      const icon = d.confianza === 'alta' ? '✅' : d.confianza === 'baja' ? '❗' : '⚠️'
      setMsgPol({
        tipo: avisos.length || d.confianza === 'baja' ? 'warn' : 'ok',
        txt: `${icon} Póliza leída (confianza ${d.confianza || 'media'}${json.modo === 'documento' ? ', PDF escaneado' : ''}). ${cambios.length ? cambios.length + ' campo(s) actualizados en el formulario' : 'Sin cambios respecto de lo cargado'}. Revisá y presioná Guardar.`
          + (avisos.length ? ' ⚠️ Atención: ' + avisos.join('; ') + '.' : '') + (d.notas ? ' — ' + d.notas : ''),
      })
    } catch (e) {
      setMsgPol({ tipo: 'err', txt: '❌ Error al analizar: ' + e.message })
    } finally { setAnalizandoPol(false) }
  }

  if (!esNuevo && !consorcioActivo) return <Card><p style={{ color: GR }}>Seleccione un consorcio primero.</p></Card>
  if (!form) return <Card><p style={{ color: GR }}>Cargando...</p></Card>

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 0 48px' }}>

      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: AZ }}>{esNuevo ? '➕ Nuevo Consorcio' : '📋 Ficha del Consorcio'}</h2>
        {esNuevo ? (
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize: 12, color: '#5a6a8a', fontWeight:600 }}>ID: CON</span>
            <input value={codigoNuevo} onChange={e=>{ setCodigoNuevo(e.target.value.replace(/[^0-9A-Za-z]/g,'')); setMsg(null) }}
              placeholder="1285" style={{ width:90, fontSize:13, padding:'5px 8px', border:'1px solid #d0d9e8', borderRadius:6 }} />
          </div>
        ) : (
          <span style={{ fontSize: 11, color: GR, background: '#f0f4ff', padding: '3px 10px', borderRadius: 6 }}>
            ID: {consorcioActivo.id}
          </span>
        )}
      </div>

      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14,
          background: msg.tipo === 'ok' ? '#f0fdf4' : '#fff1f1',
          color: msg.tipo === 'ok' ? VD : RJ, fontSize: 13, fontWeight: 600 }}>
          {msg.txt}
        </div>
      )}

      <Card>

        {/* ── Identificación ─────────────────────────── */}
        <div style={SEC}>Identificación</div>
        <div style={COL2}>
          <div>
            <label style={LBL}>Nombre del consorcio *</label>
            <input style={FLD} value={form.nombre || ''} onChange={e => upd('nombre', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>CUIT</label>
            <input style={FLD} value={form.cuit || ''} onChange={e => upd('cuit', e.target.value)} placeholder="30-XXXXXXXX-X" maxLength={13} />
          </div>
        </div>

        {/* ── Domicilio ──────────────────────────────── */}
        <div style={SEC}>Domicilio del edificio</div>
        <div style={COL3}>
          <div style={{ gridColumn: '1 / 3' }}>
            <label style={LBL}>Dirección</label>
            <input style={FLD} value={form.direccion || ''} onChange={e => upd('direccion', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Localidad</label>
            <input style={FLD} value={form.localidad || ''} onChange={e => upd('localidad', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Provincia</label>
            <input style={FLD} value={form.provincia || ''} onChange={e => upd('provincia', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Teléfono</label>
            <input style={FLD} value={form.telefono || ''} onChange={e => upd('telefono', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Email del consorcio</label>
            <input style={FLD} type="email" value={form.email_consorcio || ''} onChange={e => upd('email_consorcio', e.target.value)} />
          </div>
        </div>

        {/* ── Datos bancarios ────────────────────────── */}
        <div style={SEC}>Datos bancarios</div>
        <div style={COL3}>
          <div>
            <label style={LBL}>Banco</label>
            <input style={FLD} value={form.banco || ''} onChange={e => upd('banco', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>CBU (22 dígitos)</label>
            <input style={FLD} value={form.cbu || ''} onChange={e => upd('cbu', e.target.value)} maxLength={22} />
          </div>
          <div>
            <label style={LBL}>Alias CBU</label>
            <input style={FLD} value={form.alias_cbu || ''} onChange={e => upd('alias_cbu', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>N° de cuenta</label>
            <input style={FLD} value={form.nro_cuenta || ''} onChange={e => upd('nro_cuenta', e.target.value)} />
          </div>
        </div>

        {/* ── Seguro ─────────────────────────────────── */}
        <div style={SEC}>Seguro del edificio</div>
        <div style={COL3}>
          <div>
            <label style={LBL}>Aseguradora</label>
            <input style={FLD} value={form.aseguradora || ''} onChange={e => upd('aseguradora', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Compañía (razón social)</label>
            <input style={FLD} value={form.poliza_compania || ''} onChange={e => upd('poliza_compania', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>N° de póliza</label>
            <input style={FLD} value={form.poliza_nro || ''} onChange={e => upd('poliza_nro', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Vigencia desde</label>
            <input style={FLD} type="date" value={form.poliza_vto_desde || ''} onChange={e => upd('poliza_vto_desde', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Vencimiento</label>
            <input style={FLD} type="date" value={form.poliza_vto_hasta || ''} onChange={e => upd('poliza_vto_hasta', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Suma asegurada ($)</label>
            <input style={FLD} type="number" value={form.poliza_suma || ''} onChange={e => upd('poliza_suma', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LBL}>URL Póliza vigente (Google Drive)</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input style={{ ...FLD, flex: 1 }} value={form.poliza_url || ''} onChange={e => upd('poliza_url', e.target.value)} placeholder="https://drive.google.com/file/d/..." />
              <button
                onClick={analizarPoliza}
                disabled={analizandoPol || !form.poliza_url?.trim()}
                title="Leer el PDF de la póliza con IA y completar los datos del seguro"
                style={{
                  whiteSpace: 'nowrap', padding: '7px 14px', fontSize: 12, fontWeight: 700,
                  background: analizandoPol ? '#9CA3AF' : AZ, color: '#fff', border: 'none',
                  borderRadius: 6, cursor: (analizandoPol || !form.poliza_url?.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (!form.poliza_url?.trim()) ? 0.5 : 1,
                }}>
                {analizandoPol ? '⏳ Analizando...' : '🔎 Analizar con IA'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: GR, marginTop: 4 }}>
              El archivo debe estar compartido como "Cualquier persona con el enlace". Al guardar se actualizan la Agenda de vencimientos y el bloque de seguro del PDF de liquidación.
              {form.poliza_analizada_at ? ` Última lectura: ${new Date(form.poliza_analizada_at).toLocaleString('es-AR')}.` : ''}
            </div>
            {form.poliza_url?.trim() && (
              <a href={form.poliza_url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: AZ, textDecoration: 'none', marginTop: 4, display: 'inline-block' }}>
                📄 Ver póliza en Drive →
              </a>
            )}
            {msgPol && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: msgPol.tipo === 'ok' ? '#f0fdf4' : msgPol.tipo === 'warn' ? '#fffbea' : '#fff1f1',
                color: msgPol.tipo === 'ok' ? VD : msgPol.tipo === 'warn' ? '#C07D10' : RJ,
              }}>
                {msgPol.txt}
              </div>
            )}
            {cambiosPol.length > 0 && (
              <table style={{ width: '100%', marginTop: 8, fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#f1f5fb' }}>
                  <th style={{ textAlign: 'left', padding: '5px 8px' }}>Campo</th>
                  <th style={{ textAlign: 'left', padding: '5px 8px' }}>Antes</th>
                  <th style={{ textAlign: 'left', padding: '5px 8px' }}>Leído de la póliza</th>
                </tr></thead>
                <tbody>{cambiosPol.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eef2f7' }}>
                    <td style={{ padding: '5px 8px', color: GR }}>{c.campo}</td>
                    <td style={{ padding: '5px 8px', textDecoration: 'line-through', color: '#9CA3AF' }}>{c.antes}</td>
                    <td style={{ padding: '5px 8px', fontWeight: 700 }}>{c.despues}</td>
                  </tr>))}
                </tbody>
              </table>
            )}
            {Array.isArray(form.poliza_coberturas) && form.poliza_coberturas.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12 }}>
                <div style={{ fontWeight: 700, color: AZ, marginBottom: 4 }}>Coberturas</div>
                {form.poliza_coberturas.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', padding: '3px 0' }}>
                    <span>{c.cobertura}</span>
                    <span style={{ fontWeight: 600 }}>{c.suma_asegurada != null ? '$ ' + Number(c.suma_asegurada).toLocaleString('es-AR', { minimumFractionDigits: 2 }) : '—'}</span>
                  </div>))}
              </div>
            )}
            {form.poliza_detalle && typeof form.poliza_detalle === 'object' && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: '#374151', lineHeight: 1.6 }}>
                {form.poliza_detalle.asegurado && <div><b>Asegurado:</b> {form.poliza_detalle.asegurado}</div>}
                {form.poliza_detalle.ubicacion_riesgo && <div><b>Ubicación del riesgo:</b> {form.poliza_detalle.ubicacion_riesgo}</div>}
                {form.poliza_detalle.productor && <div><b>Productor:</b> {form.poliza_detalle.productor}</div>}
                {form.poliza_detalle.forma_pago && <div><b>Forma de pago:</b> {form.poliza_detalle.forma_pago}</div>}
                {Array.isArray(form.poliza_detalle.cuotas) && form.poliza_detalle.cuotas.length > 0 && (
                  <div><b>Cuotas:</b> {form.poliza_detalle.cuotas.map(c => `N° ${c.nro ?? '?'}${c.vencimiento ? ' vto ' + c.vencimiento.split('-').reverse().join('/') : ''}${c.importe != null ? ' $' + Number(c.importe).toLocaleString('es-AR', { minimumFractionDigits: 2 }) : ''}`).join(' · ')}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Reglamento / Escribanía ────────────────── */}
        <div style={SEC}>📖 Reglamento de propiedad horizontal</div>
        <div style={COL2}>
          <div>
            <label style={LBL}>Matrícula RPI</label>
            <input style={FLD} value={form.matricula_rpi || ''} onChange={e => upd('matricula_rpi', e.target.value)} placeholder="Ej: 123456/Folio 45/Tomo 12" />
          </div>
          <div>
            <label style={LBL}>Escribano/a</label>
            <input style={FLD} value={form.escritura_escribano || ''} onChange={e => upd('escritura_escribano', e.target.value)} placeholder="Nombre y matrícula" />
          </div>
          <div>
            <label style={LBL}>Escritura N°</label>
            <input style={FLD} value={form.escritura_nro || ''} onChange={e => upd('escritura_nro', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Fecha de escritura</label>
            <input style={FLD} value={form.escritura_fecha || ''} onChange={e => upd('escritura_fecha', e.target.value)} placeholder="dd/mm/aaaa" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LBL}>URL Reglamento (Google Drive)</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input style={{ ...FLD, flex: 1 }} value={form.reglamento_url || ''} onChange={e => upd('reglamento_url', e.target.value)} placeholder="https://drive.google.com/file/d/..." />
              <button
                onClick={analizarReglamento}
                disabled={analizandoReg || !form.reglamento_url?.trim()}
                title="Analizar el PDF del reglamento con IA y completar los campos automáticamente"
                style={{
                  whiteSpace: 'nowrap', padding: '7px 14px', fontSize: 12, fontWeight: 700,
                  background: analizandoReg ? '#9CA3AF' : AZ, color: '#fff', border: 'none',
                  borderRadius: 6, cursor: (analizandoReg || !form.reglamento_url?.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (!form.reglamento_url?.trim()) ? 0.5 : 1,
                }}>
                {analizandoReg ? '⏳ Analizando...' : '🔎 Analizar con IA'}
              </button>
            </div>
            {form.reglamento_url?.trim() && (
              <a href={form.reglamento_url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: AZ, textDecoration: 'none', marginTop: 4, display: 'inline-block' }}>
                📄 Ver documento en Drive →
              </a>
            )}
            {msgReg && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: msgReg.tipo === 'ok' ? '#f0fdf4' : msgReg.tipo === 'warn' ? '#fffbea' : '#fff1f1',
                color: msgReg.tipo === 'ok' ? VD : msgReg.tipo === 'warn' ? '#C07D10' : RJ,
              }}>
                {msgReg.txt}
              </div>
            )}
          </div>
        </div>

        {/* ── Expensas / Liquidación ─────────────────── */}
        <div style={SEC}>Configuración de expensas</div>
        <div style={COL3}>
          <div>
            <label style={LBL}>Vencimiento 1° — día del mes</label>
            <input style={FLD} type="number" min="1" max="31" value={form.vto1_dia || ''} onChange={e => upd('vto1_dia', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Vencimiento 2° — día del mes</label>
            <input style={FLD} type="number" min="1" max="31" value={form.vto2_dia || ''} onChange={e => upd('vto2_dia', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Interés mora 1° (%)</label>
            <input style={FLD} type="number" step="0.01" value={form.interes_mora || ''} onChange={e => upd('interes_mora', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Interés mora 2° (%)</label>
            <input style={FLD} type="number" step="0.01" value={form.interes_mora_2 || ''} onChange={e => upd('interes_mora_2', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LBL}>Nota por defecto en liquidaciones</label>
            <textarea style={{ ...FLD, minHeight: 50, resize: 'vertical' }} value={form.notas_liquidacion_default || ''} onChange={e => upd('notas_liquidacion_default', e.target.value)} />
          </div>
        </div>

        {/* ── Configuración GASP ─────────────────────── */}
        <div style={SEC}>Configuración GASP</div>
        <div style={COL2}>
          <div>
            <label style={LBL}>Formato de liquidación</label>
            <select style={FLD} value={form.formato_liquidacion || 'standard'} onChange={e => upd('formato_liquidacion', e.target.value)}>
              {FORMATOS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label style={LBL}>Modelo cuenta corriente</label>
            <select style={FLD} value={form.modelo_cc || ''} onChange={e => upd('modelo_cc', e.target.value)}>
              <option value="">Normal</option>
              <option value="historico">Histórico (carga desde PDF)</option>
              <option value="mixto">Mixto</option>
            </select>
          </div>
          <div>
            <label style={LBL}>URL carpeta Google Drive</label>
            <input style={FLD} value={form.drive_folder_url || ''} onChange={e => upd('drive_folder_url', e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
          </div>
          <div>
            <label style={LBL}>ID carpeta Drive (interno)</label>
            <input style={{ ...FLD, background: '#f7f9fc', color: '#888' }} value={(esNuevo ? '' : consorcioActivo?.drive_folder_id) || '—'} readOnly />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LBL}>Notas internas (formato, observaciones)</label>
            <textarea style={{ ...FLD, minHeight: 60, resize: 'vertical' }} value={form.notas || ''} onChange={e => upd('notas', e.target.value)} placeholder="Ej: Formato 3 grupos: GASTOS COMUNES + COCHERAS + OBRAS..." />
          </div>
        </div>

        {/* ── Botón guardar ──────────────────────────── */}
        <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn
            onClick={guardar}
            disabled={guardando}
            style={{ background: VD, color: '#fff', padding: '10px 28px', fontSize: 13, fontWeight: 700, borderRadius: 8 }}>
            {guardando ? (esNuevo ? 'Creando...' : 'Guardando...') : (esNuevo ? '➕ Crear consorcio' : '💾 Guardar cambios')}
          </Btn>
        </div>

      </Card>
    </div>
  )
}
