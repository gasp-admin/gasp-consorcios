// modules/sum/SUM.jsx — Gestión de SUM / Amenities (lado admin).
// Modelo: ventana operativa por día (apertura–cierre) + el propietario elige rango libre.
// Camino A: el pago confirmado impacta la caja vía RPC sum_confirmar_pago → con_movimientos_varios.
// Controles nativos (input/select) — el Input/Sel de components/ui reenvía el VALOR, no el evento.

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { fmt, fmtD } from '../../lib/formatters'
import { Btn, BtnSec, Card, Msg } from '../../components/ui'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const EST_COLOR = { solicitada: AM, pendiente_pago: AM, confirmada: VD, rechazada: RJ, cancelada: GR, expirada: GR }
const EST_LABEL = { solicitada: 'Solicitada', pendiente_pago: 'Pend. pago', confirmada: 'Confirmada', rechazada: 'Rechazada', cancelada: 'Cancelada', expirada: 'Expirada' }
const INP = { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', width: '100%' }
const INPS = { padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
const cierreTxt = (hi, hf) => (hf <= hi ? (hf === '00:00:00' || hf === '00:00' ? '24:00' : hf.slice(0, 5) + ' (+1)') : hf.slice(0, 5))

export default function SUM() {
  const app = useApp()
  const { session, consorcioActivo } = app
  const puede = app.puede || (() => true)
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [espacios, setEspacios] = useState([])
  const [espSel, setEspSel]     = useState(null)
  const [dispo, setDispo]       = useState([])
  const [reservas, setReservas] = useState([])
  const [form, setForm]         = useState(null)
  const [wForm, setWForm]       = useState(null)   // form de ventana operativa
  const [bForm, setBForm]       = useState(null)   // form de bloqueo admin
  const [fEstado, setFEstado]   = useState('activas')
  const [msg, setMsg]           = useState(null)
  const hoy = new Date().toISOString().split('T')[0]

  const guard = () => { if (!puede('editar')) { setMsg({ tipo: 'error', texto: 'Tu rol no permite operar reservas' }); return false } return true }

  const cargarEspacios = useCallback(async () => {
    if (!consorcioId) return
    const { data } = await supabase.from('con_sum_espacios').select('*').eq('consorcio_id', consorcioId).order('created_at', { ascending: true })
    setEspacios(data || [])
    setEspSel(prev => (data || []).find(e => e.id === prev?.id) || (data || [])[0] || null)
  }, [consorcioId])

  const cargarDetalle = useCallback(async () => {
    if (!espSel?.id) { setDispo([]); setReservas([]); return }
    const [{ data: d }, { data: r }] = await Promise.all([
      supabase.from('con_sum_disponibilidad').select('*').eq('espacio_id', espSel.id).order('dia_semana').order('hora_inicio'),
      supabase.from('con_sum_reservas').select('*').eq('espacio_id', espSel.id).order('inicio', { ascending: false }).limit(300),
    ])
    setDispo(d || []); setReservas(r || [])
  }, [espSel])

  useEffect(() => { cargarEspacios() }, [cargarEspacios])
  useEffect(() => { cargarDetalle() }, [cargarDetalle])

  function nuevoEspacio() {
    setForm({ activo: true, requiere_pago: false, requiere_aprobacion: false, registrar_ingreso_caja: false, auto_confirmar_pago: false, tarifa: 0, anticipacion_max_dias: 60, max_reservas_activas_uf: 1, dur_min_h: 1, dur_max_h: 6, gran_min: 30, capacidad: 1, recursos_txt: '', permite_invitados: false })
  }
  function editarEspacio(e) {
    const r = e.reglas || {}
    setForm({ ...e, dur_min_h: (r.dur_min_min || 60) / 60, dur_max_h: (r.dur_max_min || 360) / 60, gran_min: r.granularidad_min || 30, capacidad: e.capacidad || 1, recursos_txt: (Array.isArray(r.recursos) ? r.recursos.join(', ') : '') })
  }

  async function guardarEspacio() {
    if (!guard()) return
    if (!form?.nombre?.trim()) return setMsg({ tipo: 'warn', texto: 'Ingresá el nombre del espacio' })
    const cap = Math.max(1, parseInt(form.capacidad) || 1)
    const recursos = String(form.recursos_txt || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, cap)
    const reglas = {
      dur_min_min: Math.round((parseFloat(form.dur_min_h) || 1) * 60),
      dur_max_min: Math.round((parseFloat(form.dur_max_h) || 6) * 60),
      granularidad_min: parseInt(form.gran_min) || 30, recursos,
    }
    const payload = {
      nombre: form.nombre.trim(), activo: !!form.activo, requiere_pago: !!form.requiere_pago,
      tarifa: parseFloat(form.tarifa) || 0, requiere_aprobacion: !!form.requiere_aprobacion,
      registrar_ingreso_caja: !!form.registrar_ingreso_caja, auto_confirmar_pago: !!form.auto_confirmar_pago, permite_invitados: !!form.permite_invitados,
      anticipacion_max_dias: parseInt(form.anticipacion_max_dias) || 60,
      max_reservas_activas_uf: parseInt(form.max_reservas_activas_uf) || 1, capacidad: cap, reglas,
    }
    if (form.id) {
      const { error } = await supabase.from('con_sum_espacios').update(payload).eq('id', form.id)
      if (error) return setMsg({ tipo: 'error', texto: error.message })
      setMsg({ tipo: 'ok', texto: '✓ Espacio actualizado' })
    } else {
      const { error } = await supabase.from('con_sum_espacios').insert([{ id: `SUM-${consorcioId}-${Date.now()}`, admin_id: uid, consorcio_id: consorcioId, ...payload }])
      if (error) return setMsg({ tipo: 'error', texto: error.message })
      setMsg({ tipo: 'ok', texto: '✓ Espacio creado' })
    }
    setForm(null); cargarEspacios()
  }

  // ── Ventanas operativas (una fila por día) ──
  function toggleDia(dw) {
    setWForm(f => {
      const dias = f.dias.includes(dw) ? f.dias.filter(x => x !== dw) : [...f.dias, dw]
      return { ...f, dias }
    })
  }
  async function agregarVentana() {
    if (!guard()) return
    if (!wForm?.dias?.length) return setMsg({ tipo: 'warn', texto: 'Elegí al menos un día' })
    if (wForm.cierre === wForm.apertura) return setMsg({ tipo: 'warn', texto: 'El cierre no puede ser igual a la apertura' })
    const rows = wForm.dias.map(dw => ({
      id: `DISP-${espSel.id}-${Date.now()}-${dw}`, admin_id: uid, espacio_id: espSel.id,
      dia_semana: parseInt(dw), franja_label: 'Ventana', hora_inicio: wForm.apertura, hora_fin: wForm.cierre, activo: true,
    }))
    const { error } = await supabase.from('con_sum_disponibilidad').insert(rows)
    if (error) return setMsg({ tipo: 'error', texto: error.message })
    setWForm(null); cargarDetalle()
  }
  async function borrarVentana(id) {
    if (!guard()) return
    if (!confirm('¿Quitar esta ventana?')) return
    await supabase.from('con_sum_disponibilidad').delete().eq('id', id); cargarDetalle()
  }

  // ── Reservas ──
  async function aprobar(r) {
    if (!guard()) return
    const estado = r.pago_requerido ? 'pendiente_pago' : 'confirmada'
    const { error } = await supabase.from('con_sum_reservas').update({ estado, pago_estado: r.pago_requerido ? 'pendiente' : 'no_aplica' }).eq('id', r.id)
    if (error) return setMsg({ tipo: 'error', texto: error.message })
    setMsg({ tipo: 'ok', texto: '✓ Reserva aprobada' }); cargarDetalle()
  }
  async function rechazar(r) {
    if (!guard()) return
    if (!confirm('¿Rechazar esta reserva? Libera el horario.')) return
    await supabase.from('con_sum_reservas').update({ estado: 'rechazada' }).eq('id', r.id)
    setMsg({ tipo: 'ok', texto: 'Reserva rechazada' }); cargarDetalle()
  }
  async function cancelar(r) {
    if (!guard()) return
    if (!confirm('¿Cancelar esta reserva? Libera el horario.')) return
    await supabase.from('con_sum_reservas').update({ estado: 'cancelada' }).eq('id', r.id)
    setMsg({ tipo: 'ok', texto: 'Reserva cancelada. Si tenía ingreso de caja, revisalo en Movimientos varios.' }); cargarDetalle()
  }
  async function confirmarPago(r) {
    if (!guard()) return
    const { error } = await supabase.rpc('sum_confirmar_pago', { p_reserva_id: r.id })
    if (error) return setMsg({ tipo: 'error', texto: error.message })
    setMsg({ tipo: 'ok', texto: espSel?.registrar_ingreso_caja ? '✓ Pago confirmado — ingreso cargado en Movimientos varios (Uso Amenities)' : '✓ Pago confirmado' })
    cargarDetalle()
  }
  async function verComprobante(path) {
    const { data, error } = await supabase.storage.from('consorcios-adjuntos').createSignedUrl(path, 300)
    if (error || !data?.signedUrl) return setMsg({ tipo: 'error', texto: 'No se pudo abrir el comprobante' })
    window.open(data.signedUrl, '_blank')
  }

  async function guardarBloqueo() {
    if (!guard()) return
    if (!bForm?.fecha) return setMsg({ tipo: 'warn', texto: 'Elegí la fecha a bloquear' })
    if (bForm.hf === bForm.hi) return setMsg({ tipo: 'warn', texto: 'La hora fin no puede ser igual al inicio' })
    const inicio = `${bForm.fecha}T${bForm.hi}:00-03:00`
    let finFecha = bForm.fecha
    if (bForm.hf < bForm.hi) { const dn = new Date(bForm.fecha + 'T12:00:00Z'); dn.setUTCDate(dn.getUTCDate() + 1); finFecha = dn.toISOString().slice(0, 10) }
    const fin = `${finFecha}T${bForm.hf}:00-03:00`
    const cap = espSel.capacidad || 1
    const nros = (cap > 1 && bForm.recurso && bForm.recurso !== 'todas') ? [parseInt(bForm.recurso)] : Array.from({ length: cap }, (_, i) => i + 1)
    const rows = nros.map(nro => ({
      id: `RES-${espSel.id}-${Date.now()}-${nro}`, admin_id: uid, consorcio_id: consorcioId, espacio_id: espSel.id,
      unidad_id: null, tipo: 'bloqueo', fecha: bForm.fecha, inicio, fin, franja_label: `${bForm.hi}–${bForm.hf}`,
      recurso_nro: nro, estado: 'confirmada', creado_por: 'admin', notas: bForm.notas || 'Bloqueo administrativo',
    }))
    const { error } = await supabase.from('con_sum_reservas').insert(rows)
    if (error) return setMsg({ tipo: 'error', texto: error.message.includes('sum_sin_solape') ? 'Ese día/horario ya está ocupado o reservado' : error.message })
    setBForm(null); setMsg({ tipo: 'ok', texto: '✓ Día/horario bloqueado' }); cargarDetalle()
  }

  const recLabel = (r) => {
    const cap = espSel?.capacidad || 1
    if (r?.tipo === 'bloqueo') return '—'
    if (cap <= 1) return ''
    const labels = (espSel?.reglas && Array.isArray(espSel.reglas.recursos)) ? espSel.reglas.recursos : []
    return labels[r.recurso_nro - 1] || `${espSel.nombre} ${r.recurso_nro}`
  }

  const reservasFiltradas = reservas.filter(r => {
    if (fEstado === 'activas') return ['solicitada', 'pendiente_pago', 'confirmada'].includes(r.estado)
    if (fEstado === 'todas') return true
    return r.estado === fEstado
  })

  if (!consorcioId) return <Card><div style={{ color: GR }}>Seleccioná un consorcio.</div></Card>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>🏖️ Reservas SUM / Amenities</div>
        <Btn small color={AZ} onClick={nuevoEspacio}>+ Nuevo espacio</Btn>
      </div>
      <Msg data={msg} />

      {espacios.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {espacios.map(e => (
            <div key={e.id} onClick={() => setEspSel(e)} style={{ cursor: 'pointer', padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${espSel?.id === e.id ? AZ : '#e5e7eb'}`, background: espSel?.id === e.id ? '#eff6ff' : '#fff', fontSize: 13 }}>
              {e.activo ? '🟢' : '⚪'} {e.nombre} {e.requiere_pago ? `· ${fmt(e.tarifa)}` : ''}
            </div>
          ))}
        </div>
      )}

      {form && (
        <Card style={{ marginBottom: 16, border: `1.5px solid ${AZ}` }}>
          <div style={{ fontWeight: 700, color: AZ, fontSize: 13, marginBottom: 12 }}>{form.id ? '✏ Editar espacio' : '➕ Nuevo espacio'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4 }}>Nombre *</div>
              <input value={form.nombre || ''} placeholder="SUM, Quincho, Parrilla…" onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} style={INP} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4 }}>Tarifa de uso</div>
              <input type="number" value={form.tarifa} onChange={e => setForm(f => ({ ...f, tarifa: e.target.value }))} style={INP} />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12, fontSize: 13 }}>
            <label><input type="checkbox" checked={!!form.activo} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} /> Habilitado</label>
            <label><input type="checkbox" checked={!!form.requiere_pago} onChange={e => setForm(f => ({ ...f, requiere_pago: e.target.checked }))} /> Requiere pago</label>
            <label><input type="checkbox" checked={!!form.requiere_aprobacion} onChange={e => setForm(f => ({ ...f, requiere_aprobacion: e.target.checked }))} /> Requiere aprobación (si no, autoservicio)</label>
            <label><input type="checkbox" checked={!!form.registrar_ingreso_caja} onChange={e => setForm(f => ({ ...f, registrar_ingreso_caja: e.target.checked }))} /> Registrar ingreso a caja (Uso Amenities)</label>
            <label><input type="checkbox" checked={!!form.auto_confirmar_pago} onChange={e => setForm(f => ({ ...f, auto_confirmar_pago: e.target.checked }))} /> Confiar en comprobante (auto-confirma)</label>
            <label><input type="checkbox" checked={!!form.permite_invitados} onChange={e => setForm(f => ({ ...f, permite_invitados: e.target.checked }))} /> Permite reservas por invitado (inquilino)</label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4 }}>Anticip. máx. (días)</div>
              <input type="number" value={form.anticipacion_max_dias} onChange={e => setForm(f => ({ ...f, anticipacion_max_dias: e.target.value }))} style={INP} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4 }}>Reservas/UF</div>
              <input type="number" value={form.max_reservas_activas_uf} onChange={e => setForm(f => ({ ...f, max_reservas_activas_uf: e.target.value }))} style={INP} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4 }}>Dur. mín (h)</div>
              <input type="number" step="0.5" value={form.dur_min_h} onChange={e => setForm(f => ({ ...f, dur_min_h: e.target.value }))} style={INP} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4 }}>Dur. máx (h)</div>
              <input type="number" step="0.5" value={form.dur_max_h} onChange={e => setForm(f => ({ ...f, dur_max_h: e.target.value }))} style={INP} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4 }}>Granularidad</div>
              <select value={form.gran_min} onChange={e => setForm(f => ({ ...f, gran_min: e.target.value }))} style={INP}>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4 }}>Cantidad (unidades)</div>
              <input type="number" min="1" value={form.capacidad} onChange={e => setForm(f => ({ ...f, capacidad: e.target.value }))} style={INP} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: GR, marginBottom: 4 }}>Nombres (coma, opcional — ej. Parrilla 1, Parrilla 2)</div>
              <input value={form.recursos_txt || ''} placeholder="Se autogeneran si lo dejás vacío" onChange={e => setForm(f => ({ ...f, recursos_txt: e.target.value }))} style={INP} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn small color={VD} onClick={guardarEspacio}>Guardar</Btn>
            <BtnSec small onClick={() => setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {espSel && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>🗓️ Ventana operativa por día — {espSel.nombre}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <BtnSec small onClick={() => editarEspacio(espSel)}>✏ Editar espacio</BtnSec>
                <Btn small color={AZ} onClick={() => setWForm({ dias: [], apertura: '10:00', cierre: '00:00' })}>+ Ventana</Btn>
              </div>
            </div>
            {wForm && (
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: GR, marginBottom: 6 }}>Días</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {DIAS.map((d, i) => (
                    <span key={i} onClick={() => toggleDia(i)} style={{ cursor: 'pointer', padding: '4px 10px', borderRadius: 20, fontSize: 12, border: `1.5px solid ${wForm.dias.includes(i) ? AZ : '#e5e7eb'}`, background: wForm.dias.includes(i) ? '#eff6ff' : '#fff' }}>{d}</span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: GR }}>Apertura</span>
                  <input type="time" value={wForm.apertura} onChange={e => setWForm(f => ({ ...f, apertura: e.target.value }))} style={INPS} />
                  <span style={{ fontSize: 12, color: GR }}>Cierre</span>
                  <input type="time" value={wForm.cierre} onChange={e => setWForm(f => ({ ...f, cierre: e.target.value }))} style={INPS} />
                  <span style={{ fontSize: 11, color: AM }}>00:00 = medianoche (24 hs){wForm.cierre && wForm.apertura && wForm.cierre < wForm.apertura && wForm.cierre !== '00:00' ? ' · cierra al día siguiente' : ''}</span>
                  <Btn small color={VD} onClick={agregarVentana}>Agregar</Btn>
                  <BtnSec small onClick={() => setWForm(null)}>Cancelar</BtnSec>
                </div>
              </div>
            )}
            {dispo.length === 0
              ? <div style={{ color: GR, fontSize: 13 }}>Sin ventanas cargadas. El propietario no verá días disponibles hasta que agregues al menos una.</div>
              : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {dispo.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: '#eff6ff', fontSize: 12 }}>
                      <b>{DIAS[d.dia_semana]}</b> {d.hora_inicio?.slice(0, 5)}–{cierreTxt(d.hora_inicio, d.hora_fin)}
                      <span style={{ cursor: 'pointer', color: RJ }} onClick={() => borrarVentana(d.id)}>✕</span>
                    </div>
                  ))}
                </div>}
            <div style={{ fontSize: 11, color: GR, marginTop: 8 }}>
              Duración {(espSel.reglas?.dur_min_min || 60) / 60}–{(espSel.reglas?.dur_max_min || 360) / 60} h · turnos cada {espSel.reglas?.granularidad_min || 30} min. El propietario elige su rango dentro de la ventana.
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>📋 Reservas</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={INPS}>
                  <option value="activas">Activas</option>
                  <option value="solicitada">Solicitadas</option>
                  <option value="pendiente_pago">Pendientes de pago</option>
                  <option value="confirmada">Confirmadas</option>
                  <option value="todas">Todas</option>
                </select>
                <Btn small color={RJ} onClick={() => setBForm({ fecha: hoy, hi: '10:00', hf: '00:00', recurso: 'todas' })}>🚫 Bloquear</Btn>
              </div>
            </div>

            {bForm && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, background: '#fff1f2', padding: 10, borderRadius: 8 }}>
                <input type="date" value={bForm.fecha} onChange={e => setBForm(f => ({ ...f, fecha: e.target.value }))} style={INPS} />
                <input type="time" value={bForm.hi} onChange={e => setBForm(f => ({ ...f, hi: e.target.value }))} style={INPS} />
                <span style={{ color: GR }}>a</span>
                <input type="time" value={bForm.hf} onChange={e => setBForm(f => ({ ...f, hf: e.target.value }))} style={INPS} />
                {(espSel.capacidad || 1) > 1 && (
                  <select value={bForm.recurso || 'todas'} onChange={e => setBForm(f => ({ ...f, recurso: e.target.value }))} style={INPS}>
                    <option value="todas">Todas</option>
                    {Array.from({ length: espSel.capacidad || 1 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{recLabel({ recurso_nro: n })}</option>)}
                  </select>
                )}
                <input value={bForm.notas || ''} placeholder="Motivo (opcional)" onChange={e => setBForm(f => ({ ...f, notas: e.target.value }))} style={{ ...INPS, flex: 1, minWidth: 140 }} />
                <Btn small color={RJ} onClick={guardarBloqueo}>Bloquear</Btn>
                <BtnSec small onClick={() => setBForm(null)}>Cancelar</BtnSec>
              </div>
            )}

            {reservasFiltradas.length === 0
              ? <div style={{ color: GR, fontSize: 13 }}>Sin reservas para el filtro seleccionado.</div>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: GR, borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ padding: 6 }}>Fecha</th><th>Horario</th><th>Unidad</th><th>UF</th><th>Estado</th><th>Pago</th><th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reservasFiltradas.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: 6 }}>{fmtD(r.fecha)}</td>
                          <td>{r.franja_label || '—'}</td>
                          <td>{recLabel(r) || '—'}</td>
                          <td>{r.tipo === 'bloqueo' ? <i style={{ color: RJ }}>bloqueo</i> : (r.unidad_id || '—')}</td>
                          <td><span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, color: '#fff', background: EST_COLOR[r.estado] || GR }}>{EST_LABEL[r.estado] || r.estado}</span></td>
                          <td>{r.pago_requerido ? `${r.pago_estado}${r.pago_monto ? ' · ' + fmt(r.pago_monto) : ''}` : '—'}</td>
                          <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '6px 0' }}>
                            {r.tipo !== 'bloqueo' && r.estado === 'solicitada' && <>
                              <Btn small color={VD} onClick={() => aprobar(r)}>Aprobar</Btn>
                              <Btn small color={RJ} onClick={() => rechazar(r)}>Rechazar</Btn>
                            </>}
                            {r.pago_adjunto_path && <BtnSec small onClick={() => verComprobante(r.pago_adjunto_path)}>📎 Comprob.</BtnSec>}
                            {r.tipo !== 'bloqueo' && r.pago_requerido && r.pago_estado !== 'confirmado' && ['pendiente_pago', 'confirmada'].includes(r.estado) &&
                              <Btn small color={AZ} onClick={() => confirmarPago(r)}>Confirmar pago</Btn>}
                            {['solicitada', 'pendiente_pago', 'confirmada'].includes(r.estado) &&
                              <BtnSec small onClick={() => cancelar(r)}>Cancelar</BtnSec>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
          </Card>
        </>
      )}
    </div>
  )
}
