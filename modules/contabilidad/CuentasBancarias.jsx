// modules — CuentasBancarias.jsx
// Extraído del V59. Props → useApp().

import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function CuentasBancarias() {
  const { session, consorcioActivo } = useApp()
  const consorcioId = consorcioActivo?.id
  const uid = session?.user?.id

  const [cuentas, setCuentas] = useState([])
  const [form, setForm]       = useState(null)
  const [msg, setMsg]         = useState(null)
  const [guardando, setGuardando] = useState(false)
  const hoy = new Date().toISOString().split('T')[0]

  async function cargar() {
    const { data } = await supabase.from('con_cuentas_banco').select('*')
      .eq('consorcio_id', consorcioId).order('created_at')
    setCuentas(data || [])
  }

  async function guardar() {
    if (!form?.nombre?.trim()) return setMsg({ tipo:'warn', texto:'Ingresá el nombre de la cuenta' })
    setGuardando(true)
    const payload = {
      admin_id: uid,
      consorcio_id: consorcioId,
      nombre: form.nombre.trim(),
      banco: form.banco || null,
      tipo: form.tipo || 'corriente',
      cbu: form.cbu || null,
      alias: form.alias || null,
      nro_cuenta: form.nro_cuenta || null,
      saldo_inicial: parseFloat(form.saldo_inicial || 0),
      fecha_inicio: form.fecha_inicio || hoy,
      activa: true,
    }
    const { error } = form.id
      ? await supabase.from('con_cuentas_banco').update(payload).eq('id', form.id)
      : await supabase.from('con_cuentas_banco').insert([{ id:`CBC-${Date.now()}`, ...payload }])
    if (error) setMsg({ tipo:'error', texto: error.message })
    else { setMsg({ tipo:'ok', texto:'✓ Cuenta guardada' }); setForm(null); cargar() }
    setGuardando(false)
  }

  async function toggleActiva(c) {
    await supabase.from('con_cuentas_banco').update({ activa: !c.activa }).eq('id', c.id)
    cargar()
  }

  useEffect(() => { if (consorcioId) cargar() }, [consorcioId])


  const TIPOS = [
    { v:'corriente', l:'Cuenta corriente' },
    { v:'caja_ahorro', l:'Caja de ahorro' },
    { v:'virtual', l:'Cuenta virtual (CVU)' },
  ]

  function handlePDFCuentas(){
    exportarPDF({titulo:'Cuentas Bancarias',logoB64:null,
      columnas:[{key:'nombre',label:'Nombre'},{key:'banco',label:'Banco'},{key:'tipo',label:'Tipo'},
        {key:'cbu',label:'CBU'},{key:'alias',label:'Alias'},{key:'nro',label:'N° Cuenta'},
        {key:'estado',label:'Estado'}],
      filas:cuentas.map(c=>({nombre:c.nombre,banco:c.banco||'',tipo:c.tipo||'',
        cbu:c.cbu||'',alias:c.alias||'',nro:c.nro_cuenta||'',estado:c.activa?'Activa':'Inactiva'}))
    })
  }
  function handleExcelCuentas(){
    exportarExcel({titulo:'Cuentas-Bancarias',
      columnas:[{key:'nombre',label:'Nombre'},{key:'banco',label:'Banco'},{key:'tipo',label:'Tipo'},
        {key:'cbu',label:'CBU'},{key:'alias',label:'Alias'},{key:'nro',label:'N° Cuenta'},
        {key:'saldo_ini',label:'Saldo Inicial'},{key:'estado',label:'Estado'}],
      filas:cuentas.map(c=>({nombre:c.nombre,banco:c.banco||'',tipo:c.tipo||'',
        cbu:c.cbu||'',alias:c.alias||'',nro:c.nro_cuenta||'',
        saldo_ini:c.saldo_inicial||0,estado:c.activa?'Activa':'Inactiva'}))
    })
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>🏛️ Cuentas bancarias</div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn small color={GR} onClick={handlePDFCuentas}>🖨️ PDF</Btn>
          <Btn small color={VD} onClick={handleExcelCuentas}>📊 Excel</Btn>
          <Btn small color={AZ} onClick={() => {
            exportarPDF({
              titulo: 'Listado de Cuentas Bancarias',
              subtitulo: consorcioActivo?.nombre || '',
              logoB64: null,
              columnas: [
                {key:'n',label:'#'},{key:'nombre',label:'Nombre / Referencia'},
                {key:'banco',label:'Banco'},{key:'tipo',label:'Tipo'},
                {key:'cbu',label:'CBU/CVU'},{key:'alias',label:'Alias'},
                {key:'nro',label:'N° Cuenta'},
                {key:'saldo_ini',label:'Saldo Inicial'},{key:'estado',label:'Estado'},
              ],
              filas: cuentas.map((c,i) => ({
                n: i+1,
                nombre: c.nombre,
                banco: c.banco || '—',
                tipo: c.tipo === 'corriente' ? 'Cta. Cte.' : c.tipo === 'caja_ahorro' ? 'Caja Ahorro' : 'Virtual (CVU)',
                cbu: c.cbu || '—',
                alias: c.alias || '—',
                nro: c.nro_cuenta || '—',
                saldo_ini: '$' + Number(c.saldo_inicial||0).toLocaleString('es-AR',{minimumFractionDigits:2}),
                estado: c.activa ? 'Activa' : 'Inactiva',
              })),
            })
          }}>📋 Listado completo</Btn>
          <Btn onClick={() => setForm({ tipo:'corriente', fecha_inicio: hoy })}>+ Nueva cuenta</Btn>
        </div>
      </div>
      <div style={{ fontSize:12, color:GR, marginBottom:12 }}>
        Cuentas bancarias de {consorcioActivo?.nombre} para registro de ingresos y egresos
      </div>
      <Msg data={msg} />

      {form && (
        <Card style={{ marginBottom:16, border:'1.5px solid #bae6fd' }}>
          <div style={{ fontWeight:600, color:AZ, fontSize:13, marginBottom:14 }}>
            {form.id ? 'Editar cuenta' : 'Nueva cuenta bancaria'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Nombre / referencia *</div>
              <input value={form.nombre||''} placeholder="ej: Cuenta Roela Dorado 1056"
                onChange={e=>setForm(f=>({...f,nombre:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <Sel label="Tipo" value={form.tipo||'corriente'} onChange={v=>setForm(f=>({...f,tipo:v}))} opts={TIPOS} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Banco</div>
              <input value={form.banco||''} placeholder="ej: Banco Roela"
                onChange={e=>setForm(f=>({...f,banco:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>CBU / CVU</div>
              <input value={form.cbu||''} placeholder="22 dígitos"
                onChange={e=>setForm(f=>({...f,cbu:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Alias</div>
              <input value={form.alias||''} placeholder="CHOZA.TOPO.SASTRE"
                onChange={e=>setForm(f=>({...f,alias:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:14 }}>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>N° de cuenta</div>
              <input value={form.nro_cuenta||''} placeholder="12660/0"
                onChange={e=>setForm(f=>({...f,nro_cuenta:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Saldo inicial</div>
              <input type="number" min="0" step="0.01" value={form.saldo_inicial||''}
                onChange={e=>setForm(f=>({...f,saldo_inicial:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>Fecha de inicio</div>
              <input type="date" value={form.fecha_inicio||hoy}
                onChange={e=>setForm(f=>({...f,fecha_inicio:e.target.value}))}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, boxSizing:'border-box' }} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={guardar} disabled={guardando}>{guardando?'⏳':'✓ Guardar'}</Btn>
            <BtnSec onClick={()=>{setForm(null);setMsg(null)}}>Cancelar</BtnSec>
          </div>
        </Card>
      )}

      {cuentas.length === 0 ? (
        <Card>
          <div style={{ textAlign:'center', padding:32, color:GR }}>
            <div style={{ fontSize:28, marginBottom:8 }}>🏛️</div>
            <div style={{ fontWeight:600, marginBottom:6 }}>Sin cuentas bancarias configuradas</div>
            <div style={{ fontSize:12, marginBottom:16 }}>
              Registre las cuentas bancarias del consorcio para vincularlas con cobranzas y pagos
            </div>
            <Btn onClick={() => setForm({ tipo:'corriente', fecha_inicio: hoy })}>+ Agregar cuenta</Btn>
          </div>
        </Card>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {cuentas.map(c => (
            <Card key={c.id} style={{ opacity: c.activa ? 1 : 0.6 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14, color:AZ }}>{c.nombre}</div>
                  <div style={{ fontSize:12, color:GR, marginTop:2 }}>
                    {c.banco && <span>{c.banco} · </span>}
                    <span style={{ textTransform:'capitalize' }}>{c.tipo?.replace('_',' ')}</span>
                    {c.nro_cuenta && <span> · Cta: {c.nro_cuenta}</span>}
                  </div>
                  {c.cbu && (
                    <div style={{ fontSize:11, color:GR, marginTop:4, fontFamily:'monospace' }}>
                      CBU: {c.cbu}
                    </div>
                  )}
                  {c.alias && (
                    <div style={{ fontSize:11, color:'#7c3aed', marginTop:2 }}>
                      Alias: {c.alias}
                    </div>
                  )}
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:11, color:GR, marginBottom:4 }}>Saldo inicial</div>
                  <div style={{ fontWeight:700, fontSize:16, color:VD }}>{fmt(c.saldo_inicial)}</div>
                  <div style={{ display:'flex', gap:6, marginTop:8, justifyContent:'flex-end' }}>
                    <Btn small onClick={() => setForm({...c})}
                      style={{ background:'#f3f4f6', color:'#374151' }}>✏</Btn>
                    <Btn small onClick={() => toggleActiva(c)}
                      style={{ background: c.activa?'#fee2e2':'#dcfce7', color: c.activa?RJ:VD }}>
                      {c.activa ? 'Desactivar' : 'Activar'}
                    </Btn>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
