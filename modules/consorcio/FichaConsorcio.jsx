// modules/consorcio/FichaConsorcio.jsx
// Módulo: Ficha y edición del consorcio activo
// Permite ver y editar todos los datos del consorcio: nombre, CUIT, domicilio,
// datos bancarios, administrador, seguro, reglamento, formato liquidación, notas.

import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'
import { Card, Btn, Sel } from '../../components/ui'

const FLD = { fontSize: 13, padding: '7px 10px', border: '1px solid #d0d9e8', borderRadius: 6, width: '100%', boxSizing: 'border-box' }
const LBL = { fontSize: 12, color: '#5a6a8a', fontWeight: 600, marginBottom: 3, display: 'block' }
const SEC = { fontWeight: 700, fontSize: 13, color: AZ, borderBottom: '2px solid #e0e8f4', paddingBottom: 6, marginBottom: 14, marginTop: 20 }
const COL2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }
const COL3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 16px' }

const FORMATOS = [
  { value: 'standard',     label: 'Standard (1 grupo)' },
  { value: 'con_subtotal', label: 'Con subtotal (Ática II)' },
  { value: 'cazon',        label: 'Cazón 1900 (3 grupos %)' },
]

export default function FichaConsorcio() {
  const { consorcioActivo, setConsorcioActivo, consorcios, setConsorcios } = useApp()
  const [form, setForm] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (consorcioActivo) {
      setForm({
        nombre:               consorcioActivo.nombre || '',
        cuit:                 consorcioActivo.cuit || '',
        direccion:            consorcioActivo.direccion || '',
        localidad:            consorcioActivo.localidad || '',
        provincia:            consorcioActivo.provincia || 'Buenos Aires',
        telefono:             consorcioActivo.telefono || '',
        email_consorcio:      consorcioActivo.email_consorcio || '',
        banco:                consorcioActivo.banco || '',
        cbu:                  consorcioActivo.cbu || '',
        alias_cbu:            consorcioActivo.alias_cbu || '',
        cuenta_nro:           consorcioActivo.cuenta_nro || '',
        aseguradora:          consorcioActivo.aseguradora || '',
        poliza_nro:           consorcioActivo.poliza_nro || '',
        poliza_vencimiento:   consorcioActivo.poliza_vencimiento || '',
        formato_liquidacion:  consorcioActivo.formato_liquidacion || 'standard',
        modelo_cc:            consorcioActivo.modelo_cc || '',
        notas:                consorcioActivo.notas || '',
        reglamento_url:       consorcioActivo.reglamento_url || '',
      })
    }
  }, [consorcioActivo])

  function upd(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function guardar() {
    if (!consorcioActivo?.id) return
    setGuardando(true); setMsg(null)
    try {
      const { error } = await supabase
        .from('con_consorcios')
        .update(form)
        .eq('id', consorcioActivo.id)
      if (error) throw error
      // Actualizar contexto
      const updated = { ...consorcioActivo, ...form }
      setConsorcioActivo(updated)
      setConsorcios(prev => prev.map(c => c.id === updated.id ? updated : c))
      setMsg({ tipo: 'ok', txt: '✅ Datos guardados correctamente.' })
    } catch(e) {
      setMsg({ tipo: 'err', txt: '❌ Error al guardar: ' + e.message })
    } finally { setGuardando(false) }
  }

  if (!consorcioActivo) return <Card><p style={{ color: GR }}>Seleccione un consorcio primero.</p></Card>
  if (!form) return <Card><p style={{ color: GR }}>Cargando...</p></Card>

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 0 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: AZ }}>📋 Ficha del Consorcio</h2>
        <div style={{ fontSize: 12, color: GR }}>ID: <b>{consorcioActivo.id}</b></div>
      </div>

      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14,
          background: msg.tipo === 'ok' ? '#f0fdf4' : '#fff1f1',
          color: msg.tipo === 'ok' ? VD : RJ, fontSize: 13 }}>
          {msg.txt}
        </div>
      )}

      <Card>
        {/* ─── Identificación ─────────────────── */}
        <div style={SEC}>Identificación</div>
        <div style={COL2}>
          <div>
            <label style={LBL}>Nombre del consorcio</label>
            <input style={FLD} value={form.nombre} onChange={e => upd('nombre', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>CUIT</label>
            <input style={FLD} value={form.cuit} onChange={e => upd('cuit', e.target.value)}
              placeholder="30-XXXXXXXX-X" maxLength={13} />
          </div>
        </div>

        {/* ─── Domicilio ──────────────────────── */}
        <div style={SEC}>Domicilio</div>
        <div style={COL3}>
          <div style={{ gridColumn: '1 / 3' }}>
            <label style={LBL}>Dirección</label>
            <input style={FLD} value={form.direccion} onChange={e => upd('direccion', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Localidad</label>
            <input style={FLD} value={form.localidad} onChange={e => upd('localidad', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Provincia</label>
            <input style={FLD} value={form.provincia} onChange={e => upd('provincia', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Teléfono</label>
            <input style={FLD} value={form.telefono} onChange={e => upd('telefono', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Email del consorcio</label>
            <input style={FLD} value={form.email_consorcio} onChange={e => upd('email_consorcio', e.target.value)}
              type="email" />
          </div>
        </div>

        {/* ─── Datos bancarios ────────────────── */}
        <div style={SEC}>Datos bancarios</div>
        <div style={COL3}>
          <div>
            <label style={LBL}>Banco</label>
            <input style={FLD} value={form.banco} onChange={e => upd('banco', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>CBU</label>
            <input style={FLD} value={form.cbu} onChange={e => upd('cbu', e.target.value)}
              placeholder="22 dígitos" maxLength={22} />
          </div>
          <div>
            <label style={LBL}>Alias CBU</label>
            <input style={FLD} value={form.alias_cbu} onChange={e => upd('alias_cbu', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Número de cuenta</label>
            <input style={FLD} value={form.cuenta_nro} onChange={e => upd('cuenta_nro', e.target.value)} />
          </div>
        </div>

        {/* ─── Seguro ─────────────────────────── */}
        <div style={SEC}>Seguro del edificio</div>
        <div style={COL3}>
          <div>
            <label style={LBL}>Aseguradora</label>
            <input style={FLD} value={form.aseguradora} onChange={e => upd('aseguradora', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>N° de póliza</label>
            <input style={FLD} value={form.poliza_nro} onChange={e => upd('poliza_nro', e.target.value)} />
          </div>
          <div>
            <label style={LBL}>Vencimiento póliza</label>
            <input style={{ ...FLD }} type="date" value={form.poliza_vencimiento}
              onChange={e => upd('poliza_vencimiento', e.target.value)} />
          </div>
        </div>

        {/* ─── Configuración GASP ─────────────── */}
        <div style={SEC}>Configuración GASP</div>
        <div style={COL2}>
          <div>
            <label style={LBL}>Formato de liquidación</label>
            <select style={FLD} value={form.formato_liquidacion}
              onChange={e => upd('formato_liquidacion', e.target.value)}>
              {FORMATOS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label style={LBL}>Modelo cuenta corriente</label>
            <select style={FLD} value={form.modelo_cc || ''}
              onChange={e => upd('modelo_cc', e.target.value)}>
              <option value="">Normal (período actual)</option>
              <option value="historico">Histórico (carga desde PDF)</option>
              <option value="mixto">Mixto</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LBL}>URL reglamento de propiedad (Google Drive)</label>
            <input style={FLD} value={form.reglamento_url} onChange={e => upd('reglamento_url', e.target.value)}
              placeholder="https://drive.google.com/..." />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LBL}>Notas internas (formato liquidación, observaciones)</label>
            <textarea style={{ ...FLD, minHeight: 60, resize: 'vertical' }} value={form.notas}
              onChange={e => upd('notas', e.target.value)}
              placeholder="Ej: Formato 3 grupos: GASTOS COMUNES + COCHERAS + OBRAS..." />
          </div>
        </div>

        {/* ─── Botón guardar ──────────────────── */}
        <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn onClick={guardar} disabled={guardando}
            style={{ background: VD, color: '#fff', padding: '9px 24px', fontSize: 13, fontWeight: 600 }}>
            {guardando ? 'Guardando...' : '💾 Guardar cambios'}
          </Btn>
        </div>
      </Card>
    </div>
  )
}
