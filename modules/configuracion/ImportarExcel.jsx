import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function ImportarExcel() {
  const { session, consorcioActivo} = useApp()
  const uid = session?.user?.id session, consorcioId, onDone } session, consorcioId, onDone }
  const [archivo, setArchivo]   = useState(null)
  const [preview, setPreview]   = useState([])
  const [tipo, setTipo]         = useState('copropietarios')
  const [importando, setImportando] = useState(false)
  const [msg, setMsg]           = useState(null)
  const [errores, setErrores]   = useState([])

  function procesarArchivo(file) {
    setArchivo(file); setPreview([]); setErrores([]); setMsg(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const XLSX = window.XLSX
        if (!XLSX) { setMsg({ tipo:'error', texto:'Librería XLSX no disponible' }); return }
        const wb   = XLSX.read(data, { type:'array' })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval:'' })
        setPreview(rows.slice(0, 5))
        setMsg({ tipo:'info', texto:`${rows.length} filas detectadas. Primeras 5 mostradas abajo.` })
      } catch(err) {
        setMsg({ tipo:'error', texto:'Error leyendo el archivo: ' + err.message })
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function importar() {
    if (!archivo) return setMsg({ tipo:'warn', texto:'Seleccioná un archivo primero' })
    setImportando(true); setErrores([]); setMsg(null)

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const XLSX = window.XLSX
        const wb   = XLSX.read(new Uint8Array(e.target.result), { type:'array' })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval:'' })

        let ok = 0; const errs = []

        if (tipo === 'copropietarios') {
          // Columnas esperadas: apellido_nombre, dni, email, telefono, es_consejero
          for (const row of rows) {
            const nombre = row['apellido_nombre'] || row['nombre'] || row['Nombre'] || ''
            if (!nombre) continue
            const { error } = await supabase.from('con_copropietarios').upsert({
              id: 'CP-IMP-' + Date.now() + '-' + ok,
              admin_id: session.user.id,
              consorcio_id: consorcioId,
              apellido_nombre: nombre,
              dni: String(row['dni'] || row['DNI'] || ''),
              email: row['email'] || row['Email'] || row['EMAIL'] || null,
              telefono: String(row['telefono'] || row['Telefono'] || row['tel'] || ''),
              es_consejero: false,
            }, { onConflict: 'id' })
            if (error) errs.push(`Fila ${ok+1}: ${error.message}`)
            else ok++
          }
        } else if (tipo === 'unidades') {
          // Columnas: numero, tipo, piso, superficie_cubierta, porcentaje_fiscal
          for (const row of rows) {
            const num = row['numero'] || row['Numero'] || row['UF'] || ''
            if (!num) continue
            const { error } = await supabase.from('con_unidades').upsert({
              id: 'UF-IMP-' + Date.now() + '-' + ok,
              admin_id: session.user.id,
              consorcio_id: consorcioId,
              numero: String(num),
              tipo: row['tipo'] || row['Tipo'] || 'departamento',
              piso: String(row['piso'] || row['Piso'] || ''),
              superficie_cubierta: parseFloat(row['superficie'] || row['Superficie'] || 0) || null,
              porcentaje_fiscal: parseFloat(row['coeficiente'] || row['porcentaje_fiscal'] || row['pct'] || 0) || null,
              pct_gtos_grales: parseFloat(row['coeficiente'] || row['porcentaje_fiscal'] || row['pct'] || 0) || null,
              pct_fdo_obras: parseFloat(row['pct_fdo_obras'] || row['coeficiente'] || 0) || null,
              pct_cochera: parseFloat(row['pct_cochera'] || 0) || null,
              estado: 'ocupada',
              portal_token: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
            }, { onConflict: 'id' })
            if (error) errs.push(`Fila ${ok+1}: ${error.message}`)
            else ok++
          }
        }

        setErrores(errs)
        setMsg({ tipo: errs.length === 0 ? 'ok' : 'warn',
          texto: `✓ ${ok} registros importados' + (errs.length>0?' · '+errs.length+' errores':'') + '` })
        if (ok > 0 && errs.length === 0) setTimeout(() => onDone?.(), 1500)
      } catch(err) {
        setMsg({ tipo:'error', texto:'Error importando: ' + err.message })
      }
      setImportando(false)
    }
    reader.readAsArrayBuffer(archivo)
  }

  // Cargar XLSX dinámicamente desde CDN
  useEffect(() => {
    if (!window.XLSX) {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
      document.head.appendChild(script)
    }
  }, [])

  const FORMATOS = {
    copropietarios: ['apellido_nombre', 'dni', 'email', 'telefono'],
    unidades: ['numero', 'tipo', 'piso', 'superficie', 'coeficiente', 'pct_fdo_obras', 'pct_cochera'],
  }

  return (
    <div>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>📥 Importar desde Excel</div>
      <div style={{ fontSize:12, color:GR, marginBottom:20 }}>
        Cargue copropietarios y unidades funcionales desde un archivo .xlsx o .csv
      </div>
      <Msg data={msg} />

      <Card style={{ marginBottom:16 }}>
        <div style={{ fontWeight:600, color:AZ, marginBottom:14, fontSize:13 }}>
          Configuración
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
          <Sel label="¿Qué desea importar?" value={tipo} onChange={setTipo}
            opts={[
              { v:'copropietarios', l:'👤 Copropietarios' },
              { v:'unidades', l:'🏢 Unidades Funcionales' },
            ]} />
          <div>
            <div style={{ fontSize:12, color:GR, marginBottom:4, fontWeight:500 }}>
              Archivo Excel / CSV
            </div>
            <input type="file" accept=".xlsx,.xls,.csv"
              onChange={e => e.target.files[0] && procesarArchivo(e.target.files[0])}
              style={{ width:'100%', padding:'7px 0', fontSize:13 }} />
          </div>
        </div>

        {/* Formato esperado */}
        <div style={{ background:'#f8fafc', borderRadius:8, padding:'12px 14px', marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:600, color:GR, marginBottom:6 }}>
            Columnas esperadas en la planilla:
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {FORMATOS[tipo].map(col => (
              <code key={col} style={{ background:'#e5e7eb', padding:'2px 8px',
                borderRadius:4, fontSize:11 }}>{col}</code>
            ))}
          </div>
          <div style={{ fontSize:11, color:GR, marginTop:8 }}>
            La primera fila debe ser el encabezado. Puede incluir columnas adicionales — se ignoran.
          </div>
        </div>

        {/* Preview */}
        {preview.length > 0 && (
          <div style={{ overflowX:'auto', marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:600, color:GR, marginBottom:6 }}>
              Vista previa (primeras 5 filas):
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ background:'#f3f4f6' }}>
                  {Object.keys(preview[0]).slice(0,6).map(k => (
                    <th key={k} style={{ padding:'5px 8px', textAlign:'left',
                      borderBottom:'1px solid #e5e7eb', fontWeight:600, color:GR }}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                    {Object.values(row).slice(0,6).map((v, j) => (
                      <td key={j} style={{ padding:'5px 8px', fontSize:11 }}>
                        {String(v).slice(0,30)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {errores.length > 0 && (
          <div style={{ background:'#fee2e2', borderRadius:8, padding:'10px 14px',
            marginBottom:14, fontSize:12, color:RJ }}>
            <strong>Errores:</strong>
            {errores.slice(0,5).map((e,i) => <div key={i}>{e}</div>)}
            {errores.length > 5 && <div>...y {errores.length-5} más</div>}
          </div>
        )}

        <div style={{ display:'flex', gap:8 }}>
          <Btn onClick={importar} disabled={!archivo || importando}>
            {importando ? '⏳ Importando...' : '📥 Importar'}
          </Btn>
          <BtnSec onClick={() => { setArchivo(null); setPreview([]); setMsg(null); setErrores([]) }}>
            Limpiar
          </BtnSec>
        </div>
      </Card>

      {/* Plantillas descargables */}
      <Card style={{ background:'#f0f9ff', border:'1px solid #bae6fd' }}>
        <div style={{ fontWeight:600, fontSize:13, color:'#0369a1', marginBottom:10 }}>
          📋 Plantillas de ejemplo
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <Btn small color='#0369a1' onClick={() => {
            const csv = `apellido_nombre,dni,email,telefono\nGarc\u00EDa Juan,12345678,juan@mail.com,1112341234\nL\u00F3pez Mar\u00EDa,87654321,maria@mail.com,\n`
            const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url
            a.download = 'plantilla_copropietarios.csv'; a.click()
          }}>⬇ Copropietarios CSV</Btn>
          <Btn small color='#0369a1' onClick={() => {
            const csv = `numero,tipo,piso,superficie,coeficiente,pct_fdo_obras,pct_cochera\n1A,departamento,1,55,2.50,2.50,0\n1B,departamento,1,48,2.30,2.30,0\nLOC-1,local comercial,PB,80,3.20,3.20,0\nCO-1,cochera,SS,,0.80,0.80,100\n`
            const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url
            a.download = 'plantilla_unidades.csv'; a.click()
          }}>⬇ Unidades CSV</Btn>
        </div>
        <div style={{ fontSize:11, color:GR, marginTop:8 }}>
          Descargue la plantilla, complete con sus datos y vuelva a importar.
        </div>
      </Card>
    </div>
  )
}
