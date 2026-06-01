import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function GruposLiquidacion() {
  const { session, consorcioActivo } = useApp()
  const uid = session?.user?.id session, consorcioId, consorcioActivo } session, consorcioId, consorcioActivo }
  const [grupos, setGrupos]     = useState([])
  const [columnas, setColumnas] = useState([])
  const [tab, setTab]           = useState('grupos') // 'grupos' | 'columnas'
  const [formGrupo, setFormGrupo]   = useState(null)
  const [formCol, setFormCol]       = useState(null)
  const [msg, setMsg]               = useState(null)
  const [guardando, setGuardando]   = useState(false)

  const CATS_DISPONIBLES = [
    'sueldos','cargas_sociales','electricidad','agua','gas','servicios_publicos',
    'honorarios_admin','contratos','seguros','mantenimiento','varios',
    'gastos_bancarios','impuesto_municipal','impuesto_provincial','reintegros',
  ]

  const CAMPOS_COEF = [
    { v:'porcentaje_fiscal',  l:'Coef. Fiscal (predeterminado)' },
    { v:'pct_gtos_grales',    l:'Gastos Generales' },
    { v:'pct_fdo_obras',      l:'Fondo de Obras' },
    { v:'pct_cochera',        l:'Cochera' },
    { v:'pct_gtos_part',      l:'Gastos Particulares' },
  ]

  async function cargar() {
    const [{ data: g }, { data: c }] = await Promise.all([
      supabase.from('con_grupos_liquidacion').select('*')
        .eq('consorcio_id', consorcioId).order('numero'),
      supabase.from('con_columnas_liquidacion').select('*')
        .eq('consorcio_id', consorcioId).order('orden'),
    ])
    setGrupos(g || [])
    setColumnas(c || [])
  }

  async function cargarDefaults() {
    // Carga grupos predeterminados de Administración Global
    if (!confirm('Esto cargará los 7 rubros estándar (servicios públicos, adm, seguros, mantenimiento, varios, bancarios). ¿Continuar?')) return
    const defaults = [
      { numero:1, nombre:'SUELDOS Y CARGAS SOCIALES',    categorias:['sueldos','cargas_sociales'] },
      { numero:2, nombre:'SERVICIOS PÚBLICOS',            categorias:['electricidad','agua','gas','servicios_publicos'] },
      { numero:3, nombre:'GASTOS DE ADMINISTRACIÓN',      categorias:['honorarios_admin','contratos'] },
      { numero:4, nombre:'SEGUROS',                       categorias:['seguros'] },
      { numero:5, nombre:'MANTENIMIENTO GENERAL',         categorias:['mantenimiento'] },
      { numero:6, nombre:'VARIOS',                        categorias:['varios'] },
      { numero:7, nombre:'GASTOS BANCARIOS',              categorias:['gastos_bancarios'] },
      { numero:8, nombre:'IMPUESTOS Y TASAS',             categorias:['impuesto_municipal','impuesto_provincial'] },
    ]
    const inserts = defaults.map(d => ({
      id: `GRL-${consorcioId}-${d.numero}`,
      admin_id: session.user.id,
      consorcio_id: consorcioId,
      numero: d.numero, nombre: d.nombre, categorias: d.categorias,
    }))
    await supabase.from('con_grupos_liquidacion').upsert(inserts, { onConflict:'id' })
    await cargar()
    setMsg({ tipo:'ok', texto:'✓ Grupos predeterminados cargados' })
  }

  async function guardarGrupo() {
    if (!formGrupo?.nombre?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el nombre del rubro' })
    if (!formGrupo?.numero) return setMsg({ tipo:'warn', texto:'Ingresá el número del rubro' })
    setGuardando(true)
    const payload = {
      admin_id: session.user.id, consorcio_id: consorcioId,
      numero: parseInt(formGrupo.numero), nombre: formGrupo.nombre.trim(),
      categorias: formGrupo.categorias || [], activo: true,
    }
    if (formGrupo.id) {
      await supabase.from('con_grupos_liquidacion').update(payload).eq('id', formGrupo.id)
    } else {
      await supabase.from('con_grupos_liquidacion').insert([{ id:`GRL-${consorcioId}-${Date.now()}`, ...payload }])
    }
    setFormGrupo(null); await cargar(); setGuardando(false)
    setMsg({ tipo:'ok', texto:'✓ Grupo guardado' })
  }

  async function eliminarGrupo(id) {
    if (!confirm('¿Eliminar este grupo?')) return
    await supabase.from('con_grupos_liquidacion').delete().eq('id', id)
    cargar()
  }

  async function guardarColumna() {
    if (!formCol?.nombre?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el nombre de la columna' })
    if (!formCol?.campo_coef) return setMsg({ tipo:'warn', texto:'Seleccioná el campo de coeficiente' })
    if (!formCol?.codigo?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el código de la columna' })
    setGuardando(true)
    const payload = {
      admin_id: session.user.id, consorcio_id: consorcioId,
      codigo: formCol.codigo.trim().toLowerCase().replace(/\s/g,'_'),
      nombre: formCol.nombre.trim().toUpperCase(),
      campo_coef: formCol.campo_coef,
      orden: parseInt(formCol.orden||1),
      activo: true,
    }
    if (formCol.id) {
      await supabase.from('con_columnas_liquidacion').update(payload).eq('id', formCol.id)
    } else {
      await supabase.from('con_columnas_liquidacion').insert([{ id:`COL-${consorcioId}-${Date.now()}`, ...payload }])
    }
    setFormCol(null); await cargar(); setGuardando(false)
    setMsg({ tipo:'ok', texto:'✓ Columna guardada' })
  }

  async function eliminarColumna(id) {
    if (!confirm('¿Eliminar esta columna?')) return
    await supabase.from('con_columnas_liquidacion').delete().eq('id', id)
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>🗂️ Grupos y columnas de liquidación</div>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:16 }}>
        Configurá los rubros de gastos y las columnas de coeficientes que usará este consorcio en sus liquidaciones.
        Cada consorcio puede tener distintos grupos y columnas.
      </div>
      <Msg data={msg} />

      {/* Info box */}
      <Card style={{ marginBottom:16, background:'#eff6ff', border:'1px solid #bfdbfe' }}>
        <div style={{ fontSize:12, color:'#1e40af', lineHeight:1.7 }}>
          <strong>¿Cómo funciona?</strong><br/>
          • <strong>Grupos:</strong> Son los rubros de la tabla de gastos (ej: "2 SERVICIOS PÚBLICOS", "5 MANTENIMIENTO"). Cada grupo contiene una o más categorías de gastos.<br/>
          • <strong>Columnas:</strong> Son los coeficientes de distribución del prorrateo. El más común es el coeficiente fiscal, pero algunos consorcios tienen columnas separadas (GTOS GRALES, FDO OBRAS, COCHERA, etc.).<br/>
          • Si no configurás nada, el sistema usa los 7 rubros estándar y el coeficiente fiscal único.
        </div>
      </Card>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:16, borderBottom:'2px solid #e5e7eb' }}>
        {[{v:'grupos',l:'📋 Rubros de gastos'},{v:'columnas',l:'📐 Columnas de prorrateo'}].map(t=>(
          <div key={t.v} onClick={()=>setTab(t.v)} style={{ padding:'8px 18px', fontWeight:tab===t.v?700:400,
            color:tab===t.v?AZ:GR, borderBottom:tab===t.v?`2px solid ${AZ}`:'2px solid transparent',
            cursor:'pointer', fontSize:13, marginBottom:-2 }}>{t.l}</div>
        ))}
      </div>

      {/* TAB GRUPOS */}
      {tab === 'grupos' && (
        <div>
          <div style={{ display:'flex', gap:8, marginBottom:12 }}>
            <Btn onClick={()=>setFormGrupo({ numero: grupos.length + 1, categorias:[] })}>+ Nuevo rubro</Btn>
            {grupos.length === 0 && (
              <BtnSec onClick={cargarDefaults}>⚡ Cargar rubros estándar</BtnSec>
            )}
          </div>

          {formGrupo && (
            <Card style={{ marginBottom:12, border:'1.5px solid #bae6fd' }}>
              <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>
                {formGrupo.id ? 'Editar rubro' : 'Nuevo rubro de gastos'}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'100px 1fr', gap:10, marginBottom:10 }}>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>N° rubro *</div>
                  <input type="number" min="1" max="20" value={formGrupo.numero||''}
                    onChange={e=>setFormGrupo(f=>({...f,numero:e.target.value}))}
                    style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:14, fontWeight:700, boxSizing:'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Nombre del rubro *</div>
                  <input value={formGrupo.nombre||''} placeholder="ej: MANTENIMIENTO GENERAL"
                    onChange={e=>setFormGrupo(f=>({...f,nombre:e.target.value.toUpperCase()}))}
                    style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                </div>
              </div>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, color:GR, marginBottom:6, fontWeight:500 }}>Categorías de gastos incluidas</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
                  {CATS_DISPONIBLES.map(cat => (
                    <label key={cat} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer',
                      padding:'4px 8px', borderRadius:5, background:(formGrupo.categorias||[]).includes(cat)?'#dbeafe':'#f9fafb',
                      border:(formGrupo.categorias||[]).includes(cat)?'1px solid #93c5fd':'1px solid #e5e7eb' }}>
                      <input type="checkbox"
                        checked={(formGrupo.categorias||[]).includes(cat)}
                        onChange={e=>setFormGrupo(f=>({...f,
                          categorias: e.target.checked
                            ? [...(f.categorias||[]), cat]
                            : (f.categorias||[]).filter(c=>c!==cat)
                        }))} />
                      {cat.replace(/_/g,' ')}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn onClick={guardarGrupo} disabled={guardando}>{guardando?'⏳':'💾 Guardar'}</Btn>
                <BtnSec onClick={()=>setFormGrupo(null)}>Cancelar</BtnSec>
              </div>
            </Card>
          )}

          {grupos.length === 0 ? (
            <Card style={{ textAlign:'center', padding:32, color:GR }}>
              <div style={{ fontSize:24, marginBottom:8 }}>📋</div>
              <div style={{ fontWeight:600, marginBottom:8 }}>Sin rubros configurados</div>
              <div style={{ fontSize:12 }}>El sistema usa los 7 rubros estándar por defecto.<br/>Podés cargarlos y personalizarlos.</div>
            </Card>
          ) : (
            <Card>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['N°','Nombre del rubro','Categorías incluidas',''].map((h,i)=>(
                      <th key={i} style={{ padding:'7px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grupos.map(g=>(
                    <tr key={g.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'7px 10px', fontWeight:700, color:AZ, fontSize:14, width:40 }}>{g.numero}</td>
                      <td style={{ padding:'7px 10px', fontWeight:600 }}>{g.nombre}</td>
                      <td style={{ padding:'7px 10px' }}>
                        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                          {(g.categorias||[]).map(c=>(
                            <span key={c} style={{ fontSize:10, background:'#dbeafe', color:'#1e40af', borderRadius:4, padding:'1px 6px' }}>
                              {c.replace(/_/g,' ')}
                            </span>
                          ))}
                          {(!g.categorias || g.categorias.length===0) && <span style={{ color:GR, fontSize:11 }}>Sin categorías</span>}
                        </div>
                      </td>
                      <td style={{ padding:'7px 10px' }}>
                        <div style={{ display:'flex', gap:4 }}>
                          <Btn small onClick={()=>setFormGrupo({...g, categorias:g.categorias||[]})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                          <Btn small onClick={()=>eliminarGrupo(g.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {/* TAB COLUMNAS */}
      {tab === 'columnas' && (
        <div>
          <div style={{ marginBottom:12 }}>
            <Btn onClick={()=>setFormCol({ orden: columnas.length + 1, campo_coef:'porcentaje_fiscal' })}>+ Nueva columna</Btn>
          </div>

          <Card style={{ marginBottom:12, background:'#f8fafc' }}>
            <div style={{ fontSize:12, color:GR, lineHeight:1.7 }}>
              <strong>Columnas de coeficiente</strong> = las que aparecen en la tabla de prorrateo de la liquidación.<br/>
              Ejemplo MAROMAR XI: <strong>GTOS GRALES</strong> (usa pct_gtos_grales) · <strong>FDO OBRAS</strong> (usa pct_fdo_obras) · <strong>COCHERA</strong> (usa pct_cochera)<br/>
              Ejemplo DORADO 1056: una sola columna <strong>EXPENSAS A</strong> (usa porcentaje_fiscal)<br/>
              Si no configurás columnas, se usa el coeficiente fiscal con la etiqueta "EXPENSAS A".
            </div>
          </Card>

          {formCol && (
            <Card style={{ marginBottom:12, border:'1.5px solid #bae6fd' }}>
              <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:12 }}>
                {formCol.id ? 'Editar columna' : 'Nueva columna de prorrateo'}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 80px', gap:10, marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Nombre (encabezado en PDF) *</div>
                  <input value={formCol.nombre||''} placeholder="ej: GTOS GRALES"
                    onChange={e=>setFormCol(f=>({...f,nombre:e.target.value.toUpperCase()}))}
                    style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Coeficiente a usar *</div>
                  <select value={formCol.campo_coef||'porcentaje_fiscal'}
                    onChange={e=>setFormCol(f=>({...f,campo_coef:e.target.value}))}
                    style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' }}>
                    {CAMPOS_COEF.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Orden</div>
                  <input type="number" min="1" max="20" value={formCol.orden||1}
                    onChange={e=>setFormCol(f=>({...f,orden:e.target.value}))}
                    style={{ width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Código interno (sin espacios)</div>
                <input value={formCol.codigo||''} placeholder="ej: gtos_grales"
                  onChange={e=>setFormCol(f=>({...f,codigo:e.target.value.toLowerCase().replace(/\s/g,'_')}))}
                  style={{ width:200, padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn onClick={guardarColumna} disabled={guardando}>{guardando?'⏳':'💾 Guardar'}</Btn>
                <BtnSec onClick={()=>setFormCol(null)}>Cancelar</BtnSec>
              </div>
            </Card>
          )}

          {columnas.length === 0 ? (
            <Card style={{ textAlign:'center', padding:32, color:GR }}>
              <div style={{ fontSize:24, marginBottom:8 }}>📐</div>
              <div style={{ fontWeight:600, marginBottom:8 }}>Sin columnas configuradas</div>
              <div style={{ fontSize:12 }}>Se usará el coeficiente fiscal con la etiqueta "EXPENSAS A".</div>
            </Card>
          ) : (
            <Card>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#f3f4f6' }}>
                    {['Orden','Nombre (PDF)','Código','Coeficiente',''].map((h,i)=>(
                      <th key={i} style={{ padding:'7px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:GR, borderBottom:'1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {columnas.map(c=>(
                    <tr key={c.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'7px 10px', fontWeight:700, color:AZ, width:40 }}>{c.orden}</td>
                      <td style={{ padding:'7px 10px', fontWeight:600 }}>{c.nombre}</td>
                      <td style={{ padding:'7px 10px', color:GR, fontSize:11 }}>{c.codigo}</td>
                      <td style={{ padding:'7px 10px', fontSize:11 }}>
                        {CAMPOS_COEF.find(f=>f.v===c.campo_coef)?.l || c.campo_coef}
                      </td>
                      <td style={{ padding:'7px 10px' }}>
                        <div style={{ display:'flex', gap:4 }}>
                          <Btn small onClick={()=>setFormCol({...c})} style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                          <Btn small onClick={()=>eliminarColumna(c.id)} style={{ background:'#fee2e2', color:RJ }}>✕</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
