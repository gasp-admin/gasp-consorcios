import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'
import { LOGO_ADM_B64 } from '../../lib/logo'
import { generarReciboHTML, numeroRecibo, saldoDesdeCtaCte, abrirVentanaRecibo, escribirVentanaRecibo } from '../../lib/recibo'

export default function ReciboPago() {
  const { session, cargando, esSuperAdmin, consorcios, setConsorcios, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, expensas, setExpensas, proveedores, setProveedores, adminPerfil, setAdminPerfil, formCon, setFormCon, msgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio, pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, navItems, secciones, navActivo } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id
  const [cobranzas, setCobranzas] = useState([])
  const [filtroExp, setFiltroExp] = useState('')
  const [filtroUF, setFiltroUF]   = useState('')
  const [msg, setMsg]             = useState(null)

  async function cargar() {
    const q = supabase.from('con_cobranzas').select('*')
      .eq('consorcio_id', consorcioId).in('estado',['vigente','acreditado','cobrado'])
      .order('fecha', { ascending:false }).limit(200)
    if (filtroExp) q.eq('expensa_id', filtroExp)
    if (filtroUF)  q.eq('unidad_id', filtroUF)
    const { data } = await q
    setCobranzas(data || [])
  }

  // Recibo art. 12 Ley 14.701 — generador único compartido con el Portal (lib/recibo.js).
  // El estado de deuda (inc. h) sale de get-cuenta-corriente (misma fuente que la pantalla y el Portal).
  async function datosRecibo(cob) {
    const uf  = unidades.find(u => u.id === cob.unidad_id) || {}
    const cp  = copropietarios.find(c => c.id === uf.propietario_id) || {}
    const exp = expensas.find(e => e.id === cob.expensa_id) || {}
    let saldo = null, cuentaBanco = null, interfast = null
    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      saldo = saldoDesdeCtaCte(await getCuentaCorriente(cob.unidad_id, s?.access_token))
    } catch (e) { saldo = null }
    try {
      const [{ data: cb }, { data: ifu }, { data: cfg }] = await Promise.all([
        supabase.from('con_cuentas_banco').select('*').eq('consorcio_id', consorcioId).eq('activa', true).limit(1),
        supabase.from('con_interfast_uf').select('cpe, cvu, alias').eq('unidad_id', cob.unidad_id).maybeSingle(),
        supabase.from('con_config_cobranza').select('interfast_activo').eq('consorcio_id', consorcioId).maybeSingle(),
      ])
      cuentaBanco = cb?.[0] || null
      interfast   = cfg?.interfast_activo ? (ifu || null) : null
    } catch (e) { /* formas de pago: se usan los datos del consorcio */ }
    return { cob, consorcio: consorcioActivo || {}, unidad: uf, copropietario: cp, expensa: exp,
      adm: adminPerfil || {}, cuentaBanco, interfast, saldo }
  }

  async function imprimirRecibo(cob) {
    const win = abrirVentanaRecibo()
    if (!win) return setMsg({ tipo: 'warn', texto: 'Habilite las ventanas emergentes para generar el recibo.' })
    const d = await datosRecibo(cob)
    escribirVentanaRecibo(win, generarReciboHTML({ ...d, autoPrint: true }))
  }

  async function descargarRecibo(cob) {
    const d = await datosRecibo(cob)
    const html = generarReciboHTML({ ...d, autoPrint: false })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `Recibo_${numeroRecibo(cob)}_UF${d.unidad?.numero || '?'}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId, filtroExp, filtroUF])

  const fmt = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits:2 })
  const fmtD = d => d ? new Date(d+'T00:00:00').toLocaleDateString('es-AR') : '—'
  const periodoLabel = pid => {
    const exp = expensas.find(e=>e.id===pid)
    if (!exp) return '—'
    const [y,m] = (exp.periodo||'').split('-')
    const mes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return m ? `${mes[parseInt(m)-1]} ${y}` : exp.periodo
  }

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>🧾 Recibos de pago</div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Genere e imprima recibos individuales de pago para cada copropietario
      </div>
      <Msg data={msg} />

      <Card style={{ marginBottom:16, background:'#eff6ff', border:'1px solid #bfdbfe' }}>
        <div style={{ fontSize:12, color:'#1e40af' }}>
          ℹ️ Los recibos se generan como página HTML lista para imprimir o guardar como PDF desde el navegador.
          Contenido del art. 12 Ley 14.701: consorcio y domicilio, UF, propietario, período, vencimientos e intereses, formas de pago, datos, CUIT, inscripción y firma del administrador, y estado de deuda a la fecha (desde la cuenta corriente).
          Cumplen con las exigencias del RPAC Provincia de Buenos Aires (Ley 14.701).
        </div>
      </Card>

      {/* Filtros */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Sel label="Filtrar por período" value={filtroExp} onChange={setFiltroExp}
            opts={[{v:'',l:'Todos los períodos'},
              ...expensas.map(e => {
                const [y,m] = (e.periodo||'').split('-')
                const mes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                return { v:e.id, l:m?`${mes[parseInt(m)-1]} ${y}`:e.periodo }
              })
            ]} />
          <Sel label="Filtrar por unidad" value={filtroUF} onChange={setFiltroUF}
            opts={[{v:'',l:'Todas las unidades'},
              ...unidades.map(u => ({ v:u.id, l:`UF ${u.numero}` }))
            ]} />
        </div>
      </Card>

      {/* Tabla de cobranzas */}
      <Card>
        <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>
          Cobranzas registradas ({cobranzas.length})
        </div>
        {cobranzas.length === 0 ? (
          <div style={{ textAlign:'center', padding:24, color:GR }}>
            Sin cobranzas en el filtro seleccionado
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {['Fecha','UF','Propietario','Período','Monto','Medio','N° Recibo','Acciones'].map((h,i) => (
                    <th key={i} style={{ padding:'7px 10px', textAlign:i===4?'right':'left',
                      fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb',
                      whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cobranzas.map(cob => {
                  const uf  = unidades.find(u=>u.id===cob.unidad_id)
                  const cp  = copropietarios.find(c=>c.id===uf?.propietario_id)
                  const nro = cob.nro_recibo || cob.recibo_numero || cob.id.slice(-8).toUpperCase()
                  return (
                    <tr key={cob.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>{fmtD(cob.fecha)}</td>
                      <td style={{ padding:'7px 10px', fontWeight:700 }}>UF {uf?.numero||'?'}</td>
                      <td style={{ padding:'7px 10px', fontSize:11 }}>{cp?.apellido_nombre||'—'}</td>
                      <td style={{ padding:'7px 10px', fontSize:11, color:GR }}>{periodoLabel(cob.expensa_id)}</td>
                      <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700, color:VD }}>{fmt(cob.monto)}</td>
                      <td style={{ padding:'7px 10px', fontSize:11, color:GR, textTransform:'capitalize' }}>
                        {(cob.medio_pago||'efectivo').replace(/_/g,' ')}
                      </td>
                      <td style={{ padding:'7px 10px', fontFamily:'monospace', fontSize:11 }}>{nro}</td>
                      <td style={{ padding:'7px 10px' }}>
                        <div style={{ display:'flex', gap:4 }}>
                          <Btn small onClick={() => imprimirRecibo(cob)}
                            style={{ background:'#eff6ff', color:AZ }}>
                            🖨️ Imprimir
                          </Btn>
                          <Btn small onClick={() => descargarRecibo(cob)}
                            style={{ background:'#f3f4f6', color:'#374151' }}>
                            ⬇
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
