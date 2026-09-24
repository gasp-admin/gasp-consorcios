// modules/consorcio/Juicios.jsx
// A3b (2026-09-24) — Registro de juicios del consorcio (con_juicios).
// Alimenta: art. 11 inc. f Ley 14.701 (liquidación) · art. 10 incs. e/f (DDJJ anual al Registro)
//           art. 2067 inc. k CCyCN (notificar a todos los propietarios dentro de las 48 h hábiles).
// No toca otras tablas.

import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg } from '../../components/ui'

const CARACTER = [{ v: 'demandado', l: 'Demandado (el consorcio es demandado)' }, { v: 'actor', l: 'Actor (el consorcio demanda)' }, { v: 'tercero', l: 'Tercero / citado' }]
const TIPOS = [
  { v: 'cobro_expensas', l: 'Cobro de expensas' }, { v: 'danos', l: 'Daños y perjuicios' }, { v: 'laboral', l: 'Laboral' },
  { v: 'cesacion_2069', l: 'Cesación de infracción (art. 2069)' }, { v: 'impugnacion_asamblea', l: 'Impugnación de asamblea' },
  { v: 'administrativo', l: 'Reclamo administrativo' }, { v: 'otro', l: 'Otro' },
]
const lbl = (arr, v) => (arr.find(x => x.v === v) || {}).l || v || '—'
const fmtM = n => n == null || n === '' ? '—' : '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDT = d => d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtD = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—' }
const pad = n => String(n).padStart(2, '0')
const toLocalInput = d => { if (!d) return ''; const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}` }
function addBusinessDays(date, n) { const d = new Date(date); let k = 0; while (k < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) k++ } return d }
function restante(f) { const ms = new Date(f) - new Date(); if (ms <= 0) return { t: 'VENCIDO', c: RJ }; const h = Math.floor(ms / 3600000); return { t: h >= 48 ? `${Math.floor(h / 24)} días` : `${h} h`, c: h < 24 ? RJ : AM } }

const VACIO = { caracter: 'demandado', tipo: 'otro', departamento_judicial: 'Dolores', en_tramite: true }

export default function Juicios() {
  const { session, consorcioActivo, consorcios, unidades, puede } = useApp()
  const adminId = session?.user?.id
  const puedeEditar = puede ? puede('editar') : true
  const [lista, setLista] = useState([])
  const [todos, setTodos] = useState(false)
  const [verCerrados, setVerCerrados] = useState(false)
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    let q = supabase.from('con_juicios').select('*').order('en_tramite', { ascending: false }).order('fecha_inicio', { ascending: false })
    if (!todos && consorcioActivo?.id) q = q.eq('consorcio_id', consorcioActivo.id)
    const { data, error } = await q
    if (error) return setMsg({ tipo: 'error', texto: 'Error al cargar juicios: ' + error.message })
    setLista(data || [])
  }
  useEffect(() => { cargar() }, [consorcioActivo?.id, todos])

  const nombreCons = id => (consorcios || []).find(c => c.id === id)?.nombre || id
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function guardar() {
    if (!puedeEditar) return setMsg({ tipo: 'warn', texto: 'Tu rol no permite editar.' })
    if (!form.caratula?.trim()) return setMsg({ tipo: 'warn', texto: 'La carátula es obligatoria.' })
    const cid = form.consorcio_id || consorcioActivo?.id
    if (!cid) return setMsg({ tipo: 'warn', texto: 'Seleccioná un consorcio.' })
    setGuardando(true); setMsg(null)
    const conoc = form.fecha_conocimiento ? new Date(form.fecha_conocimiento) : null
    const row = {
      id: form.id || 'JUI-' + Date.now(),
      admin_id: form.admin_id || (consorcios || []).find(c => c.id === cid)?.admin_id || adminId,
      consorcio_id: cid,
      caracter: form.caracter, tipo: form.tipo, caratula: form.caratula.trim(),
      juzgado: form.juzgado?.trim() || null, departamento_judicial: form.departamento_judicial?.trim() || null,
      expediente: form.expediente?.trim() || null, objeto: form.objeto?.trim() || null,
      estado_procesal: form.estado_procesal?.trim() || null,
      capital_reclamado: form.capital_reclamado === '' || form.capital_reclamado == null ? null : parseFloat(form.capital_reclamado),
      unidad_id: form.unidad_id || null, letrado: form.letrado?.trim() || null,
      fecha_inicio: form.fecha_inicio || null,
      fecha_conocimiento: conoc && !isNaN(conoc) ? conoc.toISOString() : null,
      // 2067 k: 48 h hábiles desde que el consorcio recibe la comunicación (lun-vie; no contempla feriados)
      vence_notif_2067k: conoc && !isNaN(conoc) && form.caracter !== 'actor' ? addBusinessDays(conoc, 2).toISOString() : null,
      en_tramite: form.en_tramite !== false, fecha_fin: form.fecha_fin || null, resultado: form.resultado?.trim() || null,
      notas: form.notas?.trim() || null, updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('con_juicios').upsert([row], { onConflict: 'id' })
    setGuardando(false)
    if (error) return setMsg({ tipo: 'error', texto: 'No se pudo guardar: ' + error.message })
    setMsg({ tipo: 'ok', texto: '✓ Juicio guardado' }); setForm(null); cargar()
  }

  async function marcarNotificado(j) {
    if (!puedeEditar) return
    if (!confirm('¿Confirmás que se notificó a TODOS los propietarios la existencia de este reclamo (art. 2067 inc. k)?\nConservá las constancias de envío.')) return
    const { error } = await supabase.from('con_juicios').update({ notificado_propietarios_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', j.id)
    if (error) return setMsg({ tipo: 'error', texto: error.message })
    setMsg({ tipo: 'ok', texto: '✓ Notificación a propietarios registrada' }); cargar()
  }

  async function borrar(j) {
    if (!puedeEditar) return
    if (!confirm(`¿Eliminar el registro "${j.caratula}"? Si el juicio terminó, preferí marcarlo como finalizado para conservar el historial.`)) return
    const { error } = await supabase.from('con_juicios').delete().eq('id', j.id)
    if (error) return setMsg({ tipo: 'error', texto: error.message })
    cargar()
  }

  const visibles = lista.filter(j => verCerrados || j.en_tramite)
  const ufsCons = (unidades || []).filter(u => u.consorcio_id === (form?.consorcio_id || consorcioActivo?.id))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: AZ }}>⚖️ Juicios del consorcio</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: GR, display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} /> Todos los consorcios
          </label>
          <label style={{ fontSize: 12, color: GR, display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="checkbox" checked={verCerrados} onChange={e => setVerCerrados(e.target.checked)} /> Ver finalizados
          </label>
          {puedeEditar && <Btn small onClick={() => setForm({ ...VACIO, consorcio_id: consorcioActivo?.id })}>+ Nuevo juicio</Btn>}
        </div>
      </div>
      <Msg data={msg} />
      <div style={{ fontSize: 11.5, color: GR, marginBottom: 12 }}>
        Se informan en la liquidación (art. 11 inc. f Ley 14.701) y en la DDJJ anual al Registro (art. 10). Si el consorcio es demandado,
        el administrador debe notificar a todos los propietarios dentro de las 48 h hábiles de recibida la comunicación (art. 2067 inc. k CCyCN).
      </div>

      {form && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: AZ, marginBottom: 10 }}>{form.id ? 'Editar juicio' : 'Nuevo juicio'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {todos && <Sel label="Consorcio" value={form.consorcio_id} onChange={v => upd('consorcio_id', v)} opts={(consorcios || []).map(c => ({ v: c.id, l: c.nombre }))} required />}
            <Sel label="Carácter del consorcio" value={form.caracter} onChange={v => upd('caracter', v)} opts={CARACTER} required />
            <Sel label="Tipo" value={form.tipo} onChange={v => upd('tipo', v)} opts={TIPOS} required />
            <div style={{ gridColumn: '1 / -1' }}><Input label="Carátula" value={form.caratula} onChange={v => upd('caratula', v)} placeholder="Ej: CONSORCIO X c/ PEREZ, JUAN s/ Cobro ejecutivo" required /></div>
            <Input label="Juzgado" value={form.juzgado} onChange={v => upd('juzgado', v)} placeholder="Ej: Juzgado Civil y Comercial N° 2" />
            <Input label="Departamento judicial" value={form.departamento_judicial} onChange={v => upd('departamento_judicial', v)} />
            <Input label="N° de expediente" value={form.expediente} onChange={v => upd('expediente', v)} />
            <Input label="Capital reclamado ($)" type="number" value={form.capital_reclamado} onChange={v => upd('capital_reclamado', v)} />
            <div style={{ gridColumn: '1 / -1' }}><Input label="Objeto" value={form.objeto} onChange={v => upd('objeto', v)} placeholder="Qué se reclama" /></div>
            <Input label="Estado procesal" value={form.estado_procesal} onChange={v => upd('estado_procesal', v)} placeholder="Ej: en etapa de prueba" />
            <Input label="Letrado/a" value={form.letrado} onChange={v => upd('letrado', v)} />
            <Sel label="UF relacionada (opcional)" value={form.unidad_id} onChange={v => upd('unidad_id', v)} opts={[{ v: '', l: '—' }, ...ufsCons.map(u => ({ v: u.id, l: `UF ${u.nro_uf_pdf || u.numero}` }))]} />
            <Input label="Fecha de inicio" type="date" value={form.fecha_inicio} onChange={v => upd('fecha_inicio', v)} />
            {form.caracter !== 'actor' && (
              <div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>Recepción de la comunicación (2067 k)</div>
                <input type="datetime-local" value={toLocalInput(form.fecha_conocimiento)} onChange={e => upd('fecha_conocimiento', e.target.value)}
                  style={{ width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            )}
            <Sel label="Situación" value={form.en_tramite === false ? 'no' : 'si'} onChange={v => upd('en_tramite', v === 'si')} opts={[{ v: 'si', l: 'En trámite' }, { v: 'no', l: 'Finalizado' }]} />
            {form.en_tramite === false && <Input label="Fecha de finalización" type="date" value={form.fecha_fin} onChange={v => upd('fecha_fin', v)} />}
            {form.en_tramite === false && <Input label="Resultado" value={form.resultado} onChange={v => upd('resultado', v)} />}
            <div style={{ gridColumn: '1 / -1' }}><Input label="Notas internas (no se publican)" value={form.notas} onChange={v => upd('notas', v)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Btn onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Btn>
            <BtnSec onClick={() => setForm(null)}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {visibles.length === 0 ? (
        <Card><div style={{ color: GR, fontSize: 13 }}>No hay juicios {verCerrados ? '' : 'en trámite '}registrados{todos ? '' : ' para este consorcio'}.</div></Card>
      ) : visibles.map(j => {
        const pendiente2067 = j.vence_notif_2067k && !j.notificado_propietarios_at && j.en_tramite
        const r = pendiente2067 ? restante(j.vence_notif_2067k) : null
        return (
          <Card key={j.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                  <Badge text={j.en_tramite ? 'En trámite' : 'Finalizado'} color={j.en_tramite ? AM : GR} />
                  <Badge text={j.caracter === 'actor' ? 'Actor' : j.caracter === 'demandado' ? 'Demandado' : 'Tercero'} color={j.caracter === 'demandado' ? RJ : AZ} />
                  <Badge text={lbl(TIPOS, j.tipo)} color={GR} />
                  {todos && <span style={{ fontSize: 11, color: GR }}>{nombreCons(j.consorcio_id)}</span>}
                </div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{j.caratula}</div>
                <div style={{ fontSize: 12, color: '#374151', marginTop: 3, lineHeight: 1.6 }}>
                  {j.juzgado || '—'}{j.departamento_judicial ? ` · Dpto. Judicial ${j.departamento_judicial}` : ''} · Expte. {j.expediente || '—'}<br />
                  <b>Objeto:</b> {j.objeto || '—'} · <b>Estado:</b> {j.estado_procesal || '—'} · <b>Capital:</b> {fmtM(j.capital_reclamado)}
                  {j.letrado ? <> · <b>Letrado/a:</b> {j.letrado}</> : null}
                </div>
                {j.vence_notif_2067k && (
                  <div style={{ fontSize: 12, marginTop: 6, padding: '5px 8px', borderRadius: 6, background: j.notificado_propietarios_at ? '#dcfce7' : '#fef2f2', color: j.notificado_propietarios_at ? VD : RJ }}>
                    ⚖️ Notificación a propietarios (art. 2067 inc. k): {j.notificado_propietarios_at
                      ? `✓ realizada el ${fmtDT(j.notificado_propietarios_at)}`
                      : <>vence {fmtDT(j.vence_notif_2067k)} — <b>restan {r?.t}</b> <span style={{ color: GR }}>(días hábiles, sin feriados)</span></>}
                  </div>
                )}
              </div>
              {puedeEditar && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pendiente2067 && <Btn small color={RJ} onClick={() => marcarNotificado(j)}>Marcar notificado</Btn>}
                  <BtnSec small onClick={() => setForm({ ...j, capital_reclamado: j.capital_reclamado ?? '' })}>Editar</BtnSec>
                  <button onClick={() => borrar(j)} style={{ fontSize: 11, background: 'none', border: 'none', color: GR, cursor: 'pointer', textDecoration: 'underline' }}>Eliminar</button>
                </div>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
