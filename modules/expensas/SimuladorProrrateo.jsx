import { useState, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { AZ, GR, BG, RJ } from '../../lib/config'
import { exportarExcel } from '../../lib/exportExcel'
import { Btn, Card, Input, Sel, Msg } from '../../components/ui'

// Coeficientes disponibles para repartir el monto
const COEFS = [
  { v: 'porcentaje_fiscal', l: 'Coeficiente fiscal (%)' },
  { v: 'pct_gtos_grales',   l: 'Gastos generales' },
  { v: 'pct_fdo_obras',     l: 'Fondo de obras' },
  { v: 'pct_gtos_part',     l: 'Gastos particulares' },
  { v: 'pct_cochera',       l: 'Cochera' },
]

const th = { padding: '9px 12px', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }
const td = { padding: '8px 12px' }

export default function SimuladorProrrateo() {
  const { consorcioActivo, unidades, copropietarios } = useApp()
  const [monto, setMonto]         = useState('')
  const [concepto, setConcepto]   = useState('')
  const [campoCoef, setCampoCoef] = useState('porcentaje_fiscal')
  const [ajuste, setAjuste]       = useState(true)

  const fmt = n => '$' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const ufs = useMemo(
    () => (unidades || []).filter(u => u.consorcio_id === consorcioActivo?.id),
    [unidades, consorcioActivo]
  )

  const res = useMemo(() => {
    const total = parseFloat(monto) || 0
    if (total <= 0 || !ufs.length) return null
    const coefTotal = ufs.reduce((a, u) => a + (parseFloat(u[campoCoef]) || 0), 0)
    if (coefTotal <= 0) return { error: 'Las unidades no tienen cargado ese coeficiente. Probá con otro.' }

    let acum = 0
    const filas = ufs.slice()
      .sort((a, b) => (parseInt(a.numero) || 0) - (parseInt(b.numero) || 0) || String(a.numero).localeCompare(String(b.numero)))
      .map(u => {
        const coef = parseFloat(u[campoCoef]) || 0
        const m = Math.round(total * (coef / coefTotal) * 100) / 100
        acum += m
        const cp = (copropietarios || []).find(c => c.id === u.propietario_id)
        return { numero: u.numero, prop: cp?.apellido_nombre || '\u2014', pct: coef / coefTotal * 100, monto: m }
      })

    // Diferencia por redondeo -> a la primera UF (si se pide ajustar)
    const dif = Math.round((total - acum) * 100) / 100
    if (ajuste && filas.length && Math.abs(dif) >= 0.01) {
      filas[0].monto = Math.round((filas[0].monto + dif) * 100) / 100
    }
    const suma = Math.round(filas.reduce((a, f) => a + f.monto, 0) * 100) / 100
    return { filas, coefTotal, suma, total }
  }, [monto, campoCoef, ajuste, ufs, copropietarios])

  function exportar() {
    if (!res?.filas) return
    exportarExcel({
      titulo: `Prorrateo-${consorcioActivo?.nombre || ''}${concepto ? '-' + concepto : ''}`,
      columnas: [
        { key: 'numero',   label: 'UF' },
        { key: 'prop',     label: 'Propietario' },
        { key: 'pctTxt',   label: 'Coeficiente %' },
        { key: 'montoTxt', label: 'Monto estimado' },
      ],
      filas: [
        ...res.filas.map(f => ({ numero: f.numero, prop: f.prop, pctTxt: f.pct.toFixed(4), montoTxt: f.monto.toFixed(2) })),
        { numero: '', prop: 'TOTAL', pctTxt: '100.0000', montoTxt: res.suma.toFixed(2) },
      ],
    })
  }

  if (!consorcioActivo) {
    return <div style={{ padding: 20 }}><Msg data={{ tipo: 'warn', texto: 'Seleccion\u00e1 un consorcio primero.' }} /></div>
  }

  const coefLabel = COEFS.find(c => c.v === campoCoef)?.l || campoCoef

  return (
    <div style={{ padding: 20, maxWidth: 920, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: AZ, fontSize: 20 }}>\ud83e\uddee Simulador de prorrateo</h2>
        <p style={{ color: GR, fontSize: 13, marginTop: 4 }}>
          Estim\u00e1 cu\u00e1nto le tocar\u00eda a cada unidad al repartir un monto por coeficiente \u2014 por ejemplo,
          el costo de una obra \u2014 <b>sin generar ninguna liquidaci\u00f3n ni tocar datos</b>.
        </p>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Input label="Monto total a prorratear" type="number" value={monto} onChange={setMonto} placeholder="Ej: 1000000" />
          <Input label="Concepto (opcional)" value={concepto} onChange={setConcepto} placeholder="Ej: Obra fachada" />
          <Sel label="Coeficiente de reparto" value={campoCoef} onChange={setCampoCoef} opts={COEFS} />
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
            <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', color: '#374151' }}>
              <input type="checkbox" checked={ajuste} onChange={e => setAjuste(e.target.checked)} />
              Ajustar centavos en la 1\u00aa UF (para cuadrar el total)
            </label>
          </div>
        </div>
      </Card>

      {res?.error && <div style={{ marginTop: 14 }}><Msg data={{ tipo: 'warn', texto: res.error }} /></div>}

      {res?.filas && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, color: GR }}>
              {res.filas.length} unidades \u00b7 repartido por <b>{coefLabel}</b>
            </div>
            <Btn small onClick={exportar}>\ud83d\udcca Exportar</Btn>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: BG }}>
                  <th style={{ ...th, textAlign: 'center' }}>UF</th>
                  <th style={{ ...th, textAlign: 'left' }}>Propietario</th>
                  <th style={{ ...th, textAlign: 'right' }}>Coef. %</th>
                  <th style={{ ...th, textAlign: 'right' }}>Monto estimado</th>
                </tr>
              </thead>
              <tbody>
                {res.filas.map((f, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ ...td, fontWeight: 600, textAlign: 'center' }}>{f.numero}</td>
                    <td style={td}>{f.prop}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{f.pct.toFixed(4)}%</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(f.monto)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid ' + AZ, background: BG }}>
                  <td style={{ ...td, fontWeight: 700 }} colSpan={3}>TOTAL</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: AZ }}>{fmt(res.suma)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {Math.abs(res.suma - res.total) > 0.005 && (
            <div style={{ fontSize: 11, color: RJ, marginTop: 6 }}>
              \u26a0\ufe0f La suma ({fmt(res.suma)}) difiere del monto ingresado ({fmt(res.total)}) por {fmt(res.suma - res.total)} \u2014 activ\u00e1 \u201cAjustar centavos\u201d para cuadrar.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
