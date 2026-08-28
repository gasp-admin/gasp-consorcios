import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { Btn, BtnSec, Card, Sel, Msg } from '../../components/ui'

// Los 5 "slots" de coeficiente disponibles en con_unidades
const CAMPOS_COEF = [
  { campo: 'porcentaje_fiscal', label: 'Porcentaje fiscal' },
  { campo: 'pct_gtos_grales', label: 'Gastos generales' },
  { campo: 'pct_fdo_obras', label: 'Fondo de obras' },
  { campo: 'pct_cochera', label: 'Cochera' },
  { campo: 'pct_gtos_part', label: 'Gastos particulares' },
]
const labelCampo = (c) => CAMPOS_COEF.find(x => x.campo === c)?.label || c
const n2 = (v) => Number(v || 0)

export default function CoeficientesColumnas() {
  const { session, consorcioActivo, unidades, puede } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const puedeEditar = true  // acceso ya filtrado por el menú (perm 'configurar') + RLS

  const [tab, setTab] = useState('columnas') // 'columnas' | 'coeficientes'
  const [columnas, setColumnas] = useState([])
  const [msg, setMsg] = useState(null)
  const [guardando, setGuardando] = useState(false)

  // UF del consorcio activo, ordenadas por número
  const ufs = useMemo(() => (unidades || [])
    .filter(u => u.consorcio_id === consorcioId)
    .sort((a, b) => String(a.nro_uf_pdf || a.numero || '').localeCompare(
      String(b.nro_uf_pdf || b.numero || ''), undefined, { numeric: true })),
    [unidades, consorcioId])

  // ── Cargar columnas del consorcio ────────────────────────────────
  useEffect(() => {
    if (!consorcioId) return
    setMsg(null)
    supabase.from('con_columnas_liquidacion').select('*')
      .eq('consorcio_id', consorcioId).order('orden')
      .then(({ data }) => setColumnas(data || []))
  }, [consorcioId])

  // ═══════════════ SECCIÓN COLUMNAS ═══════════════
  function setCol(id, campo, valor) {
    setColumnas(cols => cols.map(c => c.id === id ? { ...c, [campo]: valor } : c))
  }
  async function guardarColumnas() {
    setGuardando(true); setMsg(null)
    try {
      const res = await Promise.all(columnas.map(c =>
        supabase.from('con_columnas_liquidacion')
          .update({ nombre: c.nombre, orden: Number(c.orden) || 0, activo: !!c.activo })
          .eq('id', c.id)))
      const err = res.find(r => r.error)
      if (err) throw err.error
      setMsg({ tipo: 'ok', texto: '✓ Columnas actualizadas' })
    } catch (e) { setMsg({ tipo: 'error', texto: e.message }) }
    finally { setGuardando(false) }
  }

  // ═══════════════ SECCIÓN COEFICIENTES ═══════════════
  const [campoSel, setCampoSel] = useState('porcentaje_fiscal')
  const [valores, setValores] = useState({}) // { unidad_id: valor }
  const [copiarDe, setCopiarDe] = useState('')

  // Al cambiar el campo o el consorcio, precargar los valores actuales
  useEffect(() => {
    const v = {}
    for (const u of ufs) v[u.id] = u[campoSel] ?? ''
    setValores(v)
    setCopiarDe('')
  }, [campoSel, consorcioId, ufs])

  const totalCoef = useMemo(
    () => Object.values(valores).reduce((a, x) => a + n2(x), 0),
    [valores])
  // Detecta si el consorcio trabaja en base 100 (porcentaje) o base 1 (fracción)
  const formatoBase = totalCoef > 5 ? 100 : 1
  const sumaOk = Math.abs(totalCoef - formatoBase) < (formatoBase === 100 ? 0.05 : 0.0005)

  function aplicarCopia() {
    if (!copiarDe) return
    const v = {}
    for (const u of ufs) v[u.id] = u[copiarDe] ?? ''
    setValores(v)
    setMsg({ tipo: 'ok', texto: `Copiados los valores de "${labelCampo(copiarDe)}". Revisá y guardá.` })
  }
  function setVal(uid_, valor) {
    setValores(v => ({ ...v, [uid_]: valor }))
  }
  async function guardarCoeficientes() {
    setGuardando(true); setMsg(null)
    try {
      const res = await Promise.all(ufs.map(u =>
        supabase.from('con_unidades')
          .update({ [campoSel]: n2(valores[u.id]) })
          .eq('id', u.id)))
      const err = res.find(r => r.error)
      if (err) throw err.error
      setMsg({ tipo: 'ok', texto: `✓ Coeficientes de "${labelCampo(campoSel)}" guardados (${ufs.length} UF)` })
    } catch (e) { setMsg({ tipo: 'error', texto: e.message }) }
    finally { setGuardando(false) }
  }

  if (!consorcioId) return <Card><p style={{ padding: 16 }}>Elegí un consorcio para gestionar sus columnas y coeficientes.</p></Card>

  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 13, color: '#5b6b7a', borderBottom: '2px solid #e8eef2' }
  const td = { padding: '6px 10px', borderBottom: '1px solid #eef2f5', fontSize: 14 }
  const inpNum = { width: 120, padding: '6px 8px', border: '1px solid #cdd7df', borderRadius: 6, textAlign: 'right', fontSize: 14 }

  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ margin: '0 0 4px' }}>Columnas y coeficientes</h2>
      <p style={{ color: '#5b6b7a', margin: '0 0 16px', fontSize: 14 }}>
        Consorcio: <strong>{consorcioActivo?.nombre}</strong>
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Btn onClick={() => setTab('columnas')} style={tab === 'columnas' ? {} : { background: '#e8eef2', color: '#1a2b3c' }}>Columnas de liquidación</Btn>
        <Btn onClick={() => setTab('coeficientes')} style={tab === 'coeficientes' ? {} : { background: '#e8eef2', color: '#1a2b3c' }}>Carga de coeficientes</Btn>
      </div>

      {msg && <div style={{ marginBottom: 12 }}><Msg tipo={msg.tipo}>{msg.texto}</Msg></div>}

      {tab === 'columnas' && (
        <Card>
          <div style={{ padding: 16 }}>
            <p style={{ marginTop: 0, fontSize: 14, color: '#5b6b7a' }}>
              Marcá qué columnas usa este consorcio en la liquidación. Cada columna usa el coeficiente indicado.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, width: 60 }}>Usar</th>
                <th style={th}>Nombre de la columna</th>
                <th style={th}>Coeficiente que usa</th>
                <th style={{ ...th, width: 80 }}>Orden</th>
              </tr></thead>
              <tbody>
                {columnas.map(c => (
                  <tr key={c.id} style={{ opacity: c.activo ? 1 : 0.55 }}>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <input type="checkbox" checked={!!c.activo} disabled={!puedeEditar}
                        onChange={e => setCol(c.id, 'activo', e.target.checked)} style={{ width: 18, height: 18 }} />
                    </td>
                    <td style={td}>
                      <input value={c.nombre || ''} disabled={!puedeEditar}
                        onChange={e => setCol(c.id, 'nombre', e.target.value)}
                        style={{ width: '95%', padding: '6px 8px', border: '1px solid #cdd7df', borderRadius: 6, fontSize: 14 }} />
                    </td>
                    <td style={{ ...td, color: '#5b6b7a' }}>{labelCampo(c.campo_coef)}</td>
                    <td style={td}>
                      <input type="number" value={c.orden ?? ''} disabled={!puedeEditar}
                        onChange={e => setCol(c.id, 'orden', e.target.value)}
                        style={{ width: 60, padding: '6px 8px', border: '1px solid #cdd7df', borderRadius: 6, fontSize: 14 }} />
                    </td>
                  </tr>
                ))}
                {columnas.length === 0 && <tr><td colSpan={4} style={{ ...td, color: '#5b6b7a' }}>Este consorcio no tiene columnas configuradas.</td></tr>}
              </tbody>
            </table>
            {puedeEditar && columnas.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Btn onClick={guardarColumnas} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar columnas'}</Btn>
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === 'coeficientes' && (
        <Card>
          <div style={{ padding: 16 }}>
            <p style={{ marginTop: 0, fontSize: 14, color: '#5b6b7a' }}>
              Cargá o corregí de una sola vez el coeficiente de todas las UF. Podés copiar los valores de otra columna ya cargada.
            </p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
              <div style={{ minWidth: 220 }}>
                <Sel label="Coeficiente a cargar" value={campoSel} onChange={setCampoSel}
                  opts={CAMPOS_COEF.map(c => ({ v: c.campo, l: c.label }))} />
              </div>
              <div style={{ minWidth: 220 }}>
                <Sel label="Copiar valores de…" value={copiarDe} onChange={setCopiarDe}
                  opts={[{ v: '', l: '(elegir columna)' }, ...CAMPOS_COEF.filter(c => c.campo !== campoSel).map(c => ({ v: c.campo, l: c.label }))]} />
              </div>
              <BtnSec onClick={aplicarCopia} disabled={!copiarDe}>Copiar</BtnSec>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>UF</th>
                <th style={th}>Unidad</th>
                <th style={{ ...th, textAlign: 'right' }}>Coeficiente</th>
              </tr></thead>
              <tbody>
                {ufs.map(u => (
                  <tr key={u.id}>
                    <td style={td}>{u.nro_uf_pdf || u.numero}</td>
                    <td style={{ ...td, color: '#5b6b7a' }}>{u.numero}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <input type="number" step="any" value={valores[u.id] ?? ''} disabled={!puedeEditar}
                        onChange={e => setVal(u.id, e.target.value)} style={inpNum} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td style={{ ...td, fontWeight: 700 }} colSpan={2}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: sumaOk ? '#13876b' : '#c0392b' }}>
                  {totalCoef.toFixed(4)} {sumaOk ? '✓' : `(esperado ${formatoBase})`}
                </td>
              </tr></tfoot>
            </table>

            {puedeEditar && ufs.length > 0 && (
              <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
                <Btn onClick={guardarCoeficientes} disabled={guardando}>{guardando ? 'Guardando…' : `Guardar coeficientes (${ufs.length} UF)`}</Btn>
                {!sumaOk && <span style={{ fontSize: 13, color: '#c0392b' }}>La suma no da {formatoBase}. Podés guardar igual, pero revisá los valores.</span>}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
