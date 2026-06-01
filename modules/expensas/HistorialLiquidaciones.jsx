import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function HistorialLiquidaciones() {
  const { session, consorcioActivo, unidades, copropietarios, expensas, adminPerfil } = useApp()
  const uid = session?.user?.id session, consorcioId, consorcioActivo, consorcios } session, consorcioId, consorcioActivo, consorcios } session, consorcioId, consorcioActivo, consorcios }
  const SB = 'https://payzqbkydmvovjxlznuq.supabase.co';
  const AK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBheXpxYmt5ZG12b3ZqeGx6bnVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0OTg0ODAsImV4cCI6MjA5MTA3NDQ4MH0.ut-cHjkd1oztZa-W3uYRbHDScEB4RLg55WtfIcBidm8';
  const EF_URL = `${SB}/functions/v1/importar-liquidacion-historica`;

  const [tab, setTab]                         = useState('importar');
  const [driveUrl, setDriveUrl]               = useState('');
  const [archivosEncontrados, setArchivosEncontrados] = useState([]);
  const [seleccionados, setSeleccionados]     = useState([]);
  const [cola, setCola]                       = useState([]);
  const [historial, setHistorial]             = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [procesando, setProcesando]           = useState(false);
  const [msg, setMsg]                         = useState('');
  const [progreso, setProgreso]               = useState({ actual: 0, total: 0 });
  const [detalle, setDetalle]                 = useState(null);
  const [filtroCon, setFiltroCon]             = useState('todos');
  const [fileIdsManual, setFileIdsManual]     = useState('');

  const tok = session?.access_token;

  const sbGet = async (tabla, query) => {
    const q = query || '';
    const r = await fetch(`${SB}/rest/v1/${tabla}?${q}`, {
      headers: { apikey: AK, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }
    });
    return r.json();
  };

  const cargarTodo = async () => {
    setLoading(true);
    try {
      const hist = await sbGet('con_expensas',
        'pdf_procesado=eq.true&select=id,consorcio_id,periodo,total_gastos,saldo_caja_final,fecha_vencimiento,drive_pdf_url,fuente&order=periodo.desc&limit=300'
      ).catch(() => []);
      let colaData = [];
      try {
        const cr = await fetch(EF_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ accion: 'estado_cola' })
        });
        const cj = await cr.json();
        colaData = Array.isArray(cj.cola) ? cj.cola : [];
      } catch (_) {}
      setHistorial(Array.isArray(hist) ? hist : []);
      setCola(colaData);
    } finally { setLoading(false); }
  };

  useEffect(() => { cargarTodo(); }, []);

  const extraerFolderId = (url) => {
    const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  };

  const buscarEnDrive = async () => {
    const folderId = extraerFolderId(driveUrl);
    if (!folderId) {
      setMsg('❌ URL de carpeta no válida. Debe ser drive.google.com/drive/folders/...');
      return;
    }
    setLoading(true);
    setMsg('🔍 Consultando carpeta de Drive...');
    try {
      const r = await fetch(`${SB}/functions/v1/listar-drive-pdfs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ folder_id: folderId })
      });
      const d = await r.json();
      if (d.ok && d.archivos && d.archivos.length > 0) {
        setArchivosEncontrados(d.archivos);
        setSeleccionados(d.archivos.map((a) => a.id));
        setMsg(`✅ ${d.archivos.length} liquidación(es) encontrada(s). Revisá la selección y procesá.`);
      } else {
        // Fallback: extraer IDs del link de Drive compartido no funciona sin API key de Google.
        // Mostrar instrucción para usar Opción B con el folder ID extraído.
        setMsg(`⚠️ No se pudo listar la carpeta automáticamente (requiere Google API Key en el servidor). Usá la Opción B pegando los IDs de los PDFs directamente.`);
        // Pre-rellenar el campo de Opción B con el folder ID para orientar al usuario
        setFileIdsManual(`# Folder ID detectado: ${folderId}\n# Pegá aquí los IDs de los PDFs de Drive (uno por línea)\n# Los IDs se encuentran en la URL de cada archivo:\n# drive.google.com/file/d/ID_AQUI/view`);
      }
    } catch (e) {
      setMsg(`❌ Error al conectar con el servidor: ${e.message}. Usá la Opción B.`);
    } finally { setLoading(false); }
  };

  const procesarLote = async (ids, nombresMap) => {
    if (!consorcioActivo || !consorcioActivo.id) { setMsg('Seleccionar un consorcio activo'); return; }
    setProcesando(true);
    setProgreso({ actual: 0, total: ids.length });
    let ok = 0, err = 0;
    for (let i = 0; i < ids.length; i++) {
      const fileId = ids[i];
      const nombre = nombresMap[fileId] || fileId;
      setProgreso({ actual: i + 1, total: ids.length });
      setMsg(`⚙️ Procesando ${i + 1}/${ids.length}: ${nombre}`);
      const colaId = `COLA-${consorcioActivo.id}-${fileId}`;
      try {
        await fetch(EF_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({
            accion: 'encolar_lote',
            archivos: [{ drive_file_id: fileId, drive_file_nombre: nombre, consorcio_id: consorcioActivo.id, consorcio_nombre: consorcioActivo.nombre }]
          })
        });
        const r = await fetch(EF_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({
            accion: 'procesar_pdf',
            cola_id: colaId,
            pdf_id: fileId,
            pdf_url: `https://drive.google.com/file/d/${fileId}/view`,
            consorcio_id: consorcioActivo.id,
            consorcio_nombre: consorcioActivo.nombre
          })
        });
        const res = await r.json();
        if (res.ok) { ok++; } else { err++; console.error(nombre, res.error); }
      } catch (e) { err++; }
      if (i < ids.length - 1) await new Promise((res) => setTimeout(res, 2000));
    }
    setMsg(`✅ Completado: ${ok} exitosos, ${err} errores.`);
    setProcesando(false);
    setTimeout(() => cargarTodo(), 1500);
  };

  const procesarSeleccionados = () => {
    const nombresMap = {};
    archivosEncontrados.forEach((a) => { nombresMap[a.id] = a.nombre; });
    procesarLote(seleccionados, nombresMap);
  };

  const procesarManual = () => {
    const ids = fileIdsManual.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return;
    const nombresMap = {};
    ids.forEach((id) => { nombresMap[id] = id; });
    procesarLote(ids, nombresMap);
  };

  const verDetalle = async (expensaId, periodo) => {
    try {
      const [items, ufs] = await Promise.all([
        sbGet('con_liquidacion_items', `expensa_id=eq.${expensaId}&order=rubro_nro.asc`),
        sbGet('con_liquidacion_uf',    `expensa_id=eq.${expensaId}&order=nro_uf.asc`)
      ]);
      setDetalle({
        expensaId, periodo,
        items: Array.isArray(items) ? items : [],
        ufs:   Array.isArray(ufs)   ? ufs   : []
      });
      setTab('detalle');
    } catch (e) { setMsg(`❌ Error al cargar detalle: ${e.message}`); }
  };

  const consorcioPorId = (id) => (consorcios || []).find((c) => c.id === id);

  const card      = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 16 };
  const btn       = (c) => ({ background: c || '#1F4E79', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 });
  const btnOut    = { background: '#fff', color: '#1F4E79', border: '1px solid #1F4E79', borderRadius: 7, padding: '8px 14px', cursor: 'pointer', fontSize: 13 };
  const badge     = (c) => ({ background: c, color: '#fff', borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 600 });
  const inputSt   = { border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' };
  const estadoColor = { pendiente: '#6b7280', procesando: '#d97706', completado: '#107569', error: '#dc2626' };

  const historialFiltrado = filtroCon === 'todos' ? historial : historial.filter((h) => h.consorcio_id === filtroCon);
  const consorciosFiltro  = [...new Set(historial.map((h) => h.consorcio_id))];

  const tabs = [
    { id: 'importar',  label: '📥 Importar' },
    { id: 'historial', label: `📋 Importadas (${historial.length})` },
    { id: 'cola',      label: `⚙️ Cola (${cola.length})` },
    ...(detalle ? [{ id: 'detalle', label: '🔍 Detalle' }] : [])
  ];

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>

      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: '#1F4E79', fontSize: 22 }}>📂 Historial de Liquidaciones</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>Importar liquidaciones históricas desde Drive y reconstruir cuentas corrientes</p>
        </div>
        <button style={btn()} onClick={cargarTodo}>🔄 Actualizar</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '2px solid #e5e7eb' }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: 'none', border: 'none', padding: '10px 16px', cursor: 'pointer',
            borderBottom: tab === t.id ? '2px solid #1F4E79' : '2px solid transparent',
            color: tab === t.id ? '#1F4E79' : '#6b7280', fontWeight: tab === t.id ? 700 : 400, fontSize: 14
          }}>{t.label}</button>
        ))}
      </div>

      {/* Mensajes */}
      {msg && (
        <div style={{
          background: msg.startsWith('✅') ? '#d1fae5' : msg.startsWith('❌') ? '#fee2e2' : '#fef9c3',
          border: '1px solid', borderColor: msg.startsWith('✅') ? '#6ee7b7' : msg.startsWith('❌') ? '#fca5a5' : '#fde68a',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13
        }}>{msg}</div>
      )}

      {/* Barra de progreso */}
      {procesando && (
        <div style={{ ...card, background: '#f0f9ff', border: '1px solid #bae6fd', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontWeight: 600, color: '#1F4E79' }}>⚙️ Procesando con IA...</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>{progreso.actual} / {progreso.total}</span>
          </div>
          <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#1F4E79', borderRadius: 4, width: `${progreso.total ? (progreso.actual / progreso.total) * 100 : 0}%`, transition: 'width 0.5s' }} />
          </div>
        </div>
      )}

      {/* ─── TAB IMPORTAR ─────────────────────────────── */}
      {tab === 'importar' && (
        <div>
          {!consorcioActivo && (
            <div style={{ ...card, background: '#fef9c3', border: '1px solid #fde68a', color: '#92400e' }}>
              ⚠️ Seleccioná un consorcio activo en el menú superior antes de importar.
            </div>
          )}

          {/* Opción A: URL de carpeta */}
          <div style={card}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>🔗 Opción A — URL de carpeta Drive</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              Pegá la URL de la carpeta del edificio. Si la carpeta tiene configurada la Google API Key en el servidor, detecta PDFs automáticamente. De lo contrario, copiá los IDs de los PDFs en la Opción B.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...inputSt, flex: 1 }} placeholder="https://drive.google.com/drive/folders/..."
                value={driveUrl} onChange={(e) => setDriveUrl(e.target.value)} />
              <button style={btn()} onClick={buscarEnDrive} disabled={loading || !driveUrl}>🔍 Buscar</button>
            </div>

            {archivosEncontrados.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>📄 {archivosEncontrados.length} archivo(s) encontrado(s)</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={btnOut} onClick={() => setSeleccionados(archivosEncontrados.map((a) => a.id))}>Todos</button>
                    <button style={btnOut} onClick={() => setSeleccionados([])}>Ninguno</button>
                  </div>
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 7 }}>
                  {archivosEncontrados.map((a) => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #f3f4f6', background: seleccionados.includes(a.id) ? '#eff6ff' : '#fff' }}>
                      <input type="checkbox" checked={seleccionados.includes(a.id)}
                        onChange={(e) => setSeleccionados((prev) => e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id))} />
                      <span style={{ fontSize: 13, flex: 1 }}>{a.nombre}</span>
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>{a.id}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                  <button style={btn('#107569')} onClick={procesarSeleccionados} disabled={procesando || !seleccionados.length || !consorcioActivo}>
                    🤖 Procesar {seleccionados.length} con IA
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Opción B: IDs manuales */}
          <div style={card}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>🔑 Opción B — IDs de Drive (uno por línea)</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              El ID se obtiene de la URL del archivo: drive.google.com/file/d/<b>ID_AQUI</b>/view
            </p>
            <textarea style={{ ...inputSt, height: 120, fontFamily: 'monospace', fontSize: 12 }}
              placeholder={'1XKR4HgCmeUdP1pE9oha3DSJhZPM0Xom1\n1dqLbZbBZxNbeXyneBi8EX01FPJ4GsJ2o\n...'}
              value={fileIdsManual} onChange={(e) => setFileIdsManual(e.target.value)} />
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {fileIdsManual.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length} ID(s) ingresado(s)
              </span>
              <button style={btn('#107569')} onClick={procesarManual} disabled={procesando || !fileIdsManual.trim() || !consorcioActivo}>
                🤖 Procesar con IA
              </button>
            </div>
          </div>
          {/* Opción C — subida manual para consorcios grandes (>80 UFs) */}
          <div style={{ background:'#fffbeb', border:'2px solid #f59e0b', borderRadius:8, padding:16, marginBottom:16 }}>
            <h3 style={{ margin:'0 0 6px', fontSize:15, color:'#92400e' }}>
              📤 Opción C — Subir PDF desde tu PC
              <span style={{ marginLeft:8, fontSize:11, fontWeight:400, color:'#b45309', background:'#fef3c7', padding:'2px 8px', borderRadius:10 }}>
                Para Torre Punta Medanos y consorcios de más de 80 UFs
              </span>
            </h3>
            <p style={{ fontSize:12, color:'#92400e', margin:'0 0 10px' }}>
              Descargá el PDF de Drive a tu PC y seleccionalo acá. Se procesa con IA directamente, sin pasar por Drive. Un PDF por vez (~60 segundos).
            </p>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'9px 20px',
              background:'#f59e0b', color:'#fff', borderRadius:6, fontSize:13, fontWeight:700, cursor:'pointer' }}>
              📁 Elegir PDF
              <input
                type="file"
                accept=".pdf,application/pdf"
                style={{ display:'none' }}
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0]
                  if (!file) return
                  if (!consorcioActivo || !consorcioActivo.id) { setMsg('Seleccionar un consorcio activo'); return }
                  setProcesando(true)
                  setMsg('Leyendo PDF...')
                  const reader = new FileReader()
                  reader.onerror = () => { setMsg('Error al leer el archivo'); setProcesando(false) }
                  reader.onload = async () => {
                    try {
                      const base64 = reader.result.split(',')[1]
                      const h = atob(base64.slice(0, 8))
                      if (!h.startsWith('%PDF')) { setMsg('El archivo no es un PDF valido'); setProcesando(false); e.target.value = ''; return }
                      const fakeId = 'LOCAL-' + Date.now()
                      const colaId = 'COLA-' + consorcioActivo.id + '-' + fakeId
                      setMsg('Enviando a IA: ' + file.name)
                      await fetch(EF_URL, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
                        body: JSON.stringify({ accion: 'encolar_lote', archivos: [{ drive_file_id: fakeId, drive_file_nombre: file.name, consorcio_id: consorcioActivo.id, consorcio_nombre: consorcioActivo.nombre }] })
                      })
                      const r = await fetch(EF_URL, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
                        body: JSON.stringify({ accion: 'procesar_pdf', cola_id: colaId, pdf_id: fakeId, pdf_url: '', pdf_base64: base64, consorcio_id: consorcioActivo.id, consorcio_nombre: consorcioActivo.nombre })
                      })
                      const res = await r.json()
                      if (res.ok) { setMsg('OK: ' + file.name + ' periodo ' + res.periodo + ' UFs: ' + res.ufs) }
                      else { setMsg('Error: ' + (res.error || 'desconocido')) }
                    } catch (err) { setMsg('Error: ' + err.message) }
                    setProcesando(false); e.target.value = ''; setTimeout(() => cargarTodo(), 1500)
                  }
                  reader.readAsDataURL(file)
                }}
              />
            </label>
          </div>


{/* Info */}
          <div style={{ ...card, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#166534' }}>✅ ¿Qué genera la importación?</h4>
            <ul style={{ margin: '0', paddingLeft: 20, fontSize: 12, color: '#166534', lineHeight: 1.8 }}>
              <li><b>Período cerrado</b> con saldos financieros completos (saldo anterior, ingresos, egresos, saldo final)</li>
              <li><b>Ítems de gastos</b> por rubro (servicios, mantenimiento, administración, seguros, etc.)</li>
              <li><b>Proveedores</b> detectados automáticamente con nombre y CUIT si figuran en la FC</li>
              <li><b>Cuenta corriente histórica</b> por UF (saldo anterior, pagos, intereses, expensa, total)</li>
              <li><b>Enlace al PDF original</b> disponible desde el portal del copropietario</li>
            </ul>
          </div>
        </div>
      )}

      {/* ─── TAB HISTORIAL ────────────────────────────── */}
      {tab === 'historial' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Filtrar:</span>
            <select style={{ ...inputSt, width: 'auto' }} value={filtroCon} onChange={(e) => setFiltroCon(e.target.value)}>
              <option value="todos">Todos los consorcios ({historial.length})</option>
              {consorciosFiltro.map((id) => (
                <option key={id} value={id}>
                  {(consorcioPorId(id) || {}).nombre || id} ({historial.filter((h) => h.consorcio_id === id).length})
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Cargando...</div>
          ) : historialFiltrado.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: '#6b7280', padding: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
              No hay liquidaciones importadas aún.<br />
              Usá la pestaña <b>Importar</b> para comenzar.
            </div>
          ) : (
            [...new Set(historialFiltrado.map((h) => h.consorcio_id))].map((cid) => {
              const perCon = historialFiltrado.filter((h) => h.consorcio_id === cid).sort((a, b) => b.periodo.localeCompare(a.periodo));
              const con    = consorcioPorId(cid) || {};
              return (
                <div key={cid} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                  <div style={{ background: '#1F4E79', color: '#fff', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>🏢 {con.nombre || cid}</span>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>{perCon.length} período(s)</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        {['Período','Vencimiento','Total Gastos','Saldo Final','PDF',''].map((h) => (
                          <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 12, color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {perCon.map((h, i) => (
                        <tr key={h.id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#fafafa' : '#fff' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600, fontSize: 13 }}>{h.periodo}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: '#6b7280' }}>{h.fecha_vencimiento || '—'}</td>
                          <td style={{ padding: '10px 14px', fontSize: 13 }}>
                            {h.total_gastos != null ? `$ ${Number(h.total_gastos).toLocaleString('es-AR')}` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 13 }}>
                            <span style={{ color: (h.saldo_caja_final || 0) >= 0 ? '#107569' : '#dc2626', fontWeight: 600 }}>
                              $ {Number(h.saldo_caja_final || 0).toLocaleString('es-AR')}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {h.drive_pdf_url
                              ? <a href={h.drive_pdf_url} target="_blank" rel="noreferrer" style={{ color: '#1F4E79', fontSize: 12 }}>📄 Ver PDF</a>
                              : <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <button style={{ ...btnOut, fontSize: 11, padding: '4px 10px' }} onClick={() => verDetalle(h.id, h.periodo)}>
                              🔍 Detalle
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ─── TAB COLA ─────────────────────────────────── */}
      {tab === 'cola' && (
        <div>
          {cola.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: '#6b7280', padding: 40 }}>No hay ítems en la cola aún.</div>
          ) : (
            <div style={card}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Archivo','Consorcio','Estado','Período','Procesado'].map((h) => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cola.map((c, i) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#fafafa' : '#fff' }}>
                      <td style={{ padding: '8px 12px', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.drive_file_nombre || c.drive_file_id}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }}>{c.consorcio_nombre}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={badge(estadoColor[c.estado] || '#6b7280')}>{c.estado}</span>
                        {c.error_mensaje && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>{c.error_mensaje.slice(0, 80)}</div>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }}>{c.periodo_detectado || '—'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: '#9ca3af' }}>
                        {c.procesado_at ? new Date(c.procesado_at).toLocaleString('es-AR') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB DETALLE ──────────────────────────────── */}
      {tab === 'detalle' && detalle && (
        <div>
          <button style={{ ...btnOut, marginBottom: 16 }} onClick={() => setTab('historial')}>← Volver</button>
          <h3 style={{ margin: '0 0 16px', color: '#1F4E79' }}>Período: {detalle.periodo}</h3>

          {/* Rubros */}
          <div style={{ ...card, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>📊 Rubros de Gastos ({detalle.items.length} ítems)</h4>
            {detalle.items.length === 0 ? (
              <div style={{ color: '#9ca3af', fontSize: 13 }}>Sin datos de rubros cargados.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Rubro','Proveedor / CUIT','Concepto','N° Comprobante','Total'].map((h) => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.items.map((it, i) => (
                      <tr key={it.id || i} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#fafafa' : '#fff' }}>
                        <td style={{ padding: '6px 10px' }}>
                          <span style={badge('#1F4E79')}>{it.rubro_nro}</span>&nbsp;{it.rubro_nombre}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          {it.proveedor_nombre || '—'}
                          {it.cuit_proveedor && <div style={{ fontSize: 10, color: '#9ca3af' }}>{it.cuit_proveedor}</div>}
                        </td>
                        <td style={{ padding: '6px 10px', maxWidth: 200 }}>{it.concepto || '—'}</td>
                        <td style={{ padding: '6px 10px', color: '#6b7280' }}>{it.nro_comprobante || '—'}</td>
                        <td style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'right' }}>
                          $ {Number(it.importe_total || 0).toLocaleString('es-AR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* UFs */}
          <div style={card}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>🏠 Prorrateo por UF ({detalle.ufs.length} unidades)</h4>
            {detalle.ufs.length === 0 ? (
              <div style={{ color: '#9ca3af', fontSize: 13 }}>Sin datos de UFs cargados.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['UF','Dpto','Propietario','Coef%','Saldo Ant.','Pagos','Interés','Expensa','Total'].map((h) => (
                        <th key={h} style={{ padding: '6px 10px', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb', textAlign: ['Dpto','Propietario'].includes(h) ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.ufs.map((uf, i) => (
                      <tr key={uf.id || i} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#fafafa' : '#fff' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'right' }}>{uf.nro_uf}</td>
                        <td style={{ padding: '6px 10px' }}>{uf.dpto || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>{uf.propietario_nombre || '—'}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{uf.coeficiente}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: '#6b7280' }}>$ {Number(uf.saldo_anterior || 0).toLocaleString('es-AR')}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: '#107569' }}>$ {Number(uf.pagos || 0).toLocaleString('es-AR')}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: '#dc2626' }}>$ {Number(uf.interes || 0).toLocaleString('es-AR')}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>$ {Number(uf.expensa_calculada || 0).toLocaleString('es-AR')}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: (uf.total_uf || 0) >= 0 ? '#107569' : '#dc2626' }}>
                          $ {Number(uf.total_uf || 0).toLocaleString('es-AR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
