// ============================================================
// GASP CONSORCIOS — PDF LIQUIDACIÓN DE EXPENSAS
// Reemplaza la función generarPDFLiquidacion() en pages/index.jsx
// Replica el formato de Administración Global (6 páginas)
// Fecha: 10-05-2026
// ============================================================
//
// DEPENDENCIAS: ninguna externa. Usa window.print() + HTML dinámico.
// Igual que el resto de PDFs del ecosistema GASP.
//
// DATOS REQUERIDOS (vienen del state de la página):
//   - consorcioActivo: objeto con datos del consorcio
//   - expensaSeleccionada: objeto con datos del período
//   - gastosDelPeriodo: array de gastos
//   - unidadesConDetalles: array de UFs con copropietario y monto calculado
//   - adminPerfil: datos del administrador (nombre, RPAC, tel, email, CUIT)
//
// TABLAS SUPABASE INVOLUCRADAS:
//   con_consorcios, con_unidades, con_copropietarios,
//   con_expensas, con_expensas_detalle, con_gastos
// ============================================================

// ─── RUBROS (igual que Administración Global) ───────────────
const RUBROS_ORDEN = [
  { numero: 2,  label: 'SUELDOS Y CARGAS SOCIALES' },
  { numero: 3,  label: 'SERVICIOS PÚBLICOS' },
  { numero: 4,  label: 'CONTRATOS Y ABONOS' },
  { numero: 5,  label: 'GASTOS DE ADMINISTRACIÓN' },
  { numero: 6,  label: 'SEGUROS' },
  { numero: 7,  label: 'MANTENIMIENTO GENERAL' },
  { numero: 8,  label: 'VARIOS' },
  { numero: 9,  label: 'GASTOS BANCARIOS' },
  { numero: 10, label: 'IMPUESTO MUNICIPAL' },
  { numero: 11, label: 'CARGAS SOCIALES' },
];

// Mapeo de categoría del gasto → número de rubro
const CATEGORIA_A_RUBRO = {
  'sueldos':              2,
  'fateryh':              2,
  'cargas_sociales':      11,
  'vep_931':              11,
  'electricidad':         3,
  'gas':                  3,
  'agua':                 3,
  'servicios_publicos':   3,
  'telefonia':            4,
  'internet':             4,
  'contratos':            4,
  'abonos':               4,
  'honorarios_admin':     5,
  'honorarios_contador':  5,
  'gastos_admin':         5,
  'seguros':              6,
  'mantenimiento':        7,
  'pintura':              7,
  'plomeria':             7,
  'electricista':         7,
  'jardineria':           7,
  'reparaciones':         7,
  'limpieza':             8,
  'articulos_limpieza':   8,
  'varios':               8,
  'gastos_bancarios':     9,
  'impuesto_municipal':   10,
  'municipalidad':        10,
};

// Columnas de distribución (igual que Adm. Global)
// Grupo A = 0, FDO OBRAS = 1, GTOS GRALES = 2, COCHERA = 3, DPTOS = 4
const COL_LABELS = ['Grupo A', 'FDO OBRAS', 'GTOS GRALES', 'COCHERA', 'DPTOS'];

// Determina a qué columna de distribución va cada gasto
// según su categoría. Ajustar según la lógica real del consorcio.
function columnaDeGasto(gasto) {
  const cat = (gasto.categoria || '').toLowerCase();
  if (cat.includes('municipal') || cat.includes('impuesto_mun')) return 3; // COCHERA en el PDF real
  if (cat.includes('fdo_obras') || cat.includes('obra') || cat.includes('pintura')) return 1;
  return 2; // GTOS GRALES por defecto
}

// ─── HELPERS ────────────────────────────────────────────────

function fmt(num) {
  if (num === null || num === undefined || isNaN(num)) return '0,00';
  return Number(num).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(num) {
  if (!num) return '0,00%';
  return Number(num).toFixed(2) + '%';
}

function periodoLabel(periodo) {
  // "2026-04" → "Abril 2026"
  if (!periodo) return '';
  const [anio, mes] = periodo.split('-');
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${meses[parseInt(mes,10)-1]} ${anio}`;
}

// ─── FUNCIÓN PRINCIPAL ───────────────────────────────────────

export function generarPDFLiquidacion({
  consorcioActivo,
  expensaSeleccionada,
  gastosDelPeriodo = [],
  unidadesConDetalles = [],  // [{ unidad, copropietario, detalle }]
  adminPerfil = {},
  estadoFinanciero = null,   // si existe en DB, sino null (se calcula)
  notasDelPeriodo = '',
  formasDePago = null,       // { titular, cbu, alias, banco, sucursal }
}) {

  // ── 1. Agrupar gastos por rubro y columna ─────────────────
  // totalesRubro[rubroNum][colIdx] = suma
  const totalesRubro = {};
  const gastosPorRubro = {};

  RUBROS_ORDEN.forEach(r => {
    totalesRubro[r.numero] = [0,0,0,0,0];
    gastosPorRubro[r.numero] = [];
  });

  let totalGeneral = [0,0,0,0,0];

  gastosDelPeriodo.forEach(g => {
    const rubroNum = CATEGORIA_A_RUBRO[(g.categoria||'').toLowerCase()] || 8;
    const colIdx = columnaDeGasto(g);
    const monto = parseFloat(g.monto) || 0;

    if (!totalesRubro[rubroNum]) {
      totalesRubro[rubroNum] = [0,0,0,0,0];
      gastosPorRubro[rubroNum] = [];
    }
    totalesRubro[rubroNum][colIdx] += monto;
    gastosPorRubro[rubroNum].push({ ...g, colIdx });
    totalGeneral[colIdx] += monto;
  });

  const totalGlobalNum = totalGeneral.reduce((a,b) => a+b, 0);

  // ── 2. Calcular prorrateo por UF ──────────────────────────
  // Columnas: UF | Dpto | Prop | SaldoAnt | Pagos | Deuda | Interés
  //         | GtosPart% | FdoObras$ | GtosGrales$ | Cochera$ | Dptos$ | RED/AJT | Total

  const totalFdoObras   = totalGeneral[1];
  const totalGtosGrales = totalGeneral[2];
  const totalCochera    = totalGeneral[3];
  const totalDptos      = totalGeneral[4];

  const unidadesTabla = unidadesConDetalles.map(({ unidad, copropietario, detalle }) => {
    const pctFdo    = parseFloat(unidad.pct_fdo_obras)   || 0;
    const pctGrales = parseFloat(unidad.pct_gtos_grales) || 0;
    const pctCoch   = parseFloat(unidad.pct_cochera)     || 0;
    const pctPart   = parseFloat(unidad.pct_gtos_part)   || 0;

    const fdoObrasUF   = (pctFdo   / 100) * totalFdoObras;
    const gtosGralesUF = (pctGrales / 100) * totalGtosGrales;
    const cocheraUF    = (pctCoch  / 100) * totalCochera;
    const dptosUF      = (pctPart  / 100) * totalDptos;

    const saldoAnterior = parseFloat(detalle?.saldo_anterior) || 0;
    const pagos         = parseFloat(detalle?.pagos_periodo)  || 0;
    const interesMora   = parseFloat(detalle?.interes_mora)   || 0;
    const deuda         = Math.max(0, saldoAnterior - pagos);

    const expensaUF = fdoObrasUF + gtosGralesUF + cocheraUF + dptosUF;
    const redAjuste = parseFloat(detalle?.redondeo) || 0;
    const totalUF   = saldoAnterior - pagos + interesMora + expensaUF + redAjuste;

    return {
      uf:          unidad.numero || unidad.numero_interno,
      dpto:        unidad.piso ? `${unidad.piso} ${unidad.tipo === 'cochera' ? 'CO' : ''}` : (unidad.tipo === 'local' ? 'LOC' : unidad.numero),
      prop:        copropietario?.apellido_nombre || '—',
      saldoAnterior,
      pagos,
      deuda,
      interesMora,
      pctPart,
      fdoObrasUF,
      gtosGralesUF,
      cocheraUF,
      dptosUF,
      redAjuste,
      total:       totalUF,
    };
  });

  // ── 3. Morosos ────────────────────────────────────────────
  const morosos = unidadesTabla.filter(u => u.deuda > 0 || u.interesMora > 0);

  // ── 4. Estado financiero (usa el provisto o calcula básico) ─
  const efi = estadoFinanciero || (() => {
    const totalCobrado   = unidadesTabla.reduce((a,u) => a + u.pagos, 0);
    const saldoAnterior  = unidadesTabla.reduce((a,u) => a + u.saldoAnterior, 0);
    const totalIntereses = unidadesTabla.reduce((a,u) => a + u.interesMora, 0);
    return {
      saldo_anterior:     saldoAnterior,
      ingresos_termino:   totalCobrado,
      ingresos_adeudados: 0,
      ingresos_intereses: totalIntereses,
      egresos_pagos:      -totalGlobalNum,
      saldo_final:        saldoAnterior + totalCobrado + totalIntereses - totalGlobalNum,
      fecha_saldo_ant:    '—',
      fecha_saldo_fin:    '—',
    };
  })();

  // ── 5. Formas de pago ──────────────────────────────────────
  const fpago = formasDePago || {
    titular:  consorcioActivo?.nombre || '',
    cbu:      consorcioActivo?.cbu || '—',
    alias:    consorcioActivo?.alias || '—',
    banco:    consorcioActivo?.banco || '—',
    sucursal: consorcioActivo?.sucursal || '—',
  };

  // ── 6. CSS de impresión ────────────────────────────────────
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, Arial, sans-serif; font-size: 8.5pt; color: #111; background: #fff; }

    /* ── Saltos de página ── */
    .page { width: 210mm; min-height: 297mm; padding: 12mm 14mm 10mm; page-break-after: always; position: relative; }
    .page:last-child { page-break-after: auto; }
    @page { size: A4; margin: 0; }
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
    }

    /* ── Header ── */
    .header-wrap { display: flex; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1a5276; padding-bottom: 10px; margin-bottom: 8px; }
    .header-logo { width: 100px; flex-shrink: 0; }
    .header-logo img { width: 100%; }
    .header-title { flex: 1; }
    .header-title h1 { font-size: 15pt; color: #1a5276; font-weight: 700; letter-spacing: -0.3px; }
    .header-title h2 { font-size: 11pt; color: #2e4057; }
    .header-title p  { font-size: 7.5pt; color: #555; margin-top: 1px; }

    .datos-row { display: flex; gap: 24px; margin-bottom: 10px; }
    .datos-col { flex: 1; }
    .datos-col h3 { font-size: 8pt; color: #1a5276; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; border-bottom: 1px solid #1a5276; padding-bottom: 2px; margin-bottom: 4px; }
    .datos-col p  { font-size: 7.5pt; color: #222; line-height: 1.5; }

    /* ── Título de sección ── */
    .section-title { background: #1a5276; color: #fff; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 5px 8px; margin-bottom: 0; text-align: center; }

    /* ── Tablas ── */
    table { width: 100%; border-collapse: collapse; font-size: 7pt; }
    th { background: #2e4057; color: #fff; padding: 4px 5px; text-align: right; font-weight: 600; white-space: nowrap; }
    th:first-child, th.left { text-align: left; }
    td { padding: 3px 5px; text-align: right; border-bottom: 1px solid #e0e0e0; }
    td.left { text-align: left; }
    tr:nth-child(even) { background: #f5f8fa; }

    /* ── Rubro header ── */
    .rubro-header td { background: #d5e8f5; font-weight: 700; color: #1a5276; font-size: 7.5pt; }
    .rubro-total td  { background: #1a5276; color: #fff; font-weight: 700; font-size: 7.5pt; }
    .gran-total td   { background: #0d2b3e; color: #fff; font-weight: 700; font-size: 8pt; }

    /* ── Estado financiero ── */
    .ef-table td.concepto { text-align: left; padding-left: 14px; }
    .ef-table tr.ef-saldo-final td { background: #1a5276; color: #fff; font-weight: 700; }
    .ef-table tr.ef-indent td.concepto { padding-left: 24px; font-style: italic; }
    .ef-table tr.ef-sub-header td { background: #d5e8f5; font-weight: 600; text-align: left; padding-left: 6px; }

    /* ── Morosos ── */
    .morosos-table th, .morosos-table td { text-align: left; }
    .morosos-table td.num { text-align: right; }

    /* ── Prorrateo ── */
    .prorrateo-header { background: #1a5276; color: #fff; text-align: center; font-size: 8pt; font-weight: 700; padding: 4px; margin-bottom: 0; }
    .prorrateo-subheader { font-size: 7pt; color: #555; margin-bottom: 4px; }

    /* ── Formas de pago ── */
    .fpago-box { border: 1.5px solid #1a5276; border-radius: 6px; padding: 14px 18px; margin-top: 20px; max-width: 400px; }
    .fpago-box h3 { color: #1a5276; font-size: 10pt; font-weight: 700; margin-bottom: 8px; }
    .fpago-box p  { font-size: 8pt; color: #222; line-height: 1.8; }

    /* ── Notas ── */
    .notas-box { border: 1px solid #ccc; border-radius: 4px; padding: 10px 12px; margin-top: 10px; font-size: 7.5pt; line-height: 1.6; color: #333; }
    .notas-box h4 { font-size: 8pt; color: #1a5276; font-weight: 700; margin-bottom: 6px; }

    /* ── Pie de página ── */
    .footer-page { position: absolute; bottom: 8mm; left: 14mm; right: 14mm; display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid #ddd; padding-top: 4px; font-size: 6.5pt; color: #888; }

    /* ── Botón imprimir ── */
    .btn-print { display: block; margin: 20px auto; padding: 12px 32px; background: #1a5276; color: #fff; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-print:hover { background: #0d2b3e; }
  `;

  // ── 7. LOGO (base64 embebido del sistema GASP) ─────────────
  // Usar la misma constante LOGO_BASE64 que ya está en index.jsx
  const logoTag = `<img src="${typeof LOGO_BASE64 !== 'undefined' ? LOGO_BASE64 : ''}" alt="Logo" style="width:90px;"/>`;

  // ── 8. Cabecera reutilizable ───────────────────────────────
  const periodoStr = periodoLabel(expensaSeleccionada?.periodo);

  function headerHTML() {
    return `
      <div class="header-wrap">
        <div class="header-logo">${logoTag}</div>
        <div class="header-title">
          <h1>Administración de Consorcios Pinamar</h1>
          <h2>MIS EXPENSAS — Liquidación de mes: ${expensaSeleccionada?.periodo || ''}</h2>
        </div>
      </div>
      <div class="datos-row">
        <div class="datos-col">
          <h3>Administración</h3>
          <p>
            <strong>Nombre:</strong> ${adminPerfil.nombre || 'Javier Garcia Perez'}<br/>
            ${adminPerfil.direccion || 'Lenguado 1313 - Loc 3'}<br/>
            ${adminPerfil.email || 'administracion@administracionpinamar.com'}<br/>
            <strong>CUIT:</strong> ${adminPerfil.cuit || '20186006802'}<br/>
            <strong>Inscripción R.P.A:</strong> ${adminPerfil.rpac || '83'}<br/>
            <strong>Tel:</strong> ${adminPerfil.telefono || '02254 516386 / 2267 444034'}<br/>
            <strong>Situación fiscal:</strong> ${adminPerfil.situacion_fiscal || 'Monotributo'}
          </p>
        </div>
        <div class="datos-col">
          <h3>Consorcio</h3>
          <p>
            <strong>${consorcioActivo?.nombre || ''}</strong><br/>
            <strong>CUIT:</strong> ${consorcioActivo?.cuit || ''}<br/>
            <strong>Clave SUTERH:</strong> ${consorcioActivo?.clave_suterh || ''}
          </p>
        </div>
      </div>
    `;
  }

  function footerHTML(nroPag, totalPags) {
    return `
      <div class="footer-page">
        <span>${consorcioActivo?.nombre} — Liquidación ${periodoStr}</span>
        <span>Nº RPA: ${adminPerfil.rpac || '83'} | CUIT Consorcio: ${consorcioActivo?.cuit || ''} | Vencimiento: ${expensaSeleccionada?.fecha_vencimiento || ''}</span>
        <span>${nroPag}</span>
      </div>
    `;
  }

  // ── 9. PÁGINA 1: Gastos por rubros ────────────────────────
  function pag1_gastos() {
    let rows = '';
    RUBROS_ORDEN.forEach(rubro => {
      const gastos = gastosPorRubro[rubro.numero] || [];
      const totales = totalesRubro[rubro.numero] || [0,0,0,0,0];
      const totalRubro = totales.reduce((a,b) => a+b, 0);
      if (totalRubro === 0 && gastos.length === 0) return;

      const pct = totalGlobalNum > 0 ? (totalRubro / totalGlobalNum * 100).toFixed(2) : '0.00';

      rows += `
        <tr class="rubro-header">
          <td class="left" colspan="2">${rubro.numero} ${rubro.label}</td>
          <td>${COL_LABELS[0]}</td><td>${COL_LABELS[1]}</td><td>${COL_LABELS[2]}</td><td>${COL_LABELS[3]}</td><td>${COL_LABELS[4]}</td><td>Total</td>
        </tr>`;

      gastos.forEach(g => {
        const celdas = [0,0,0,0,0];
        celdas[g.colIdx] = parseFloat(g.monto) || 0;
        rows += `
          <tr>
            <td class="left" colspan="2" style="padding-left:12px;font-size:6.8pt;">
              ${g.concepto || g.descripcion || ''}${g.proveedor_nombre ? `, ${g.proveedor_nombre}` : ''}${g.comprobante ? `, ${g.comprobante}` : ''}
            </td>
            ${celdas.map(v => `<td>${v > 0 ? fmt(v) : '0,00'}</td>`).join('')}
            <td>${fmt(parseFloat(g.monto)||0)}</td>
          </tr>`;
      });

      rows += `
        <tr class="rubro-total">
          <td class="left" colspan="2">TOTAL RUBRO ${rubro.numero} &nbsp; ${pct}%</td>
          ${totales.map(v => `<td>${fmt(v)}</td>`).join('')}
          <td>${fmt(totalRubro)}</td>
        </tr>`;
    });

    const pctTotal = totalGeneral.reduce((a,b) => a+b, 0);

    rows += `
      <tr class="gran-total">
        <td class="left" colspan="2">TOTAL &nbsp; 100,00%</td>
        ${totalGeneral.map(v => `<td>${fmt(v)}</td>`).join('')}
        <td>${fmt(pctTotal)}</td>
      </tr>`;

    return `
      <div class="page">
        ${headerHTML()}
        <div class="section-title">PAGOS DEL PERÍODO POR SUMINISTROS, SERVICIOS, ABONOS Y SEGUROS</div>
        <table>
          <thead>
            <tr>
              <th class="left" colspan="2">Concepto</th>
              <th>Grupo A</th><th>FDO OBRAS</th><th>GTOS GRALES</th><th>COCHERA</th><th>DPTOS</th><th>Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${footerHTML(1, 6)}
      </div>`;
  }

  // ── 10. PÁGINA 2: Estado financiero + Notas ───────────────
  function pag2_estadoFinanciero() {
    // Columnas: CONCEPTO | Grupo A | FDO OBRAS | GTOS GRALES | COCHERA | DPTOS | Total
    // Por simplicidad, si no hay desglose por columna en el estado financiero,
    // mostrar solo la columna Total (igual que muchos sistemas).
    // Si se quiere el desglose completo, hay que tener los datos por grupo en DB.

    const {
      saldo_anterior, ingresos_termino, ingresos_adeudados,
      ingresos_intereses, egresos_pagos, saldo_final,
      fecha_saldo_ant, fecha_saldo_fin
    } = efi;

    return `
      <div class="page">
        ${headerHTML()}

        <div class="section-title">ESTADO FINANCIERO</div>
        <table class="ef-table">
          <thead>
            <tr>
              <th class="left">CONCEPTO</th>
              <th>Grupo A</th><th>FDO OBRAS</th><th>GTOS GRALES</th><th>COCHERA</th><th>DPTOS</th><th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="left concepto">Saldo anterior al ${fecha_saldo_ant || '—'}</td>
              <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
              <td>${fmt(saldo_anterior)}</td>
            </tr>
            <tr class="ef-indent">
              <td class="concepto">Ingresos por pago de expensas en término</td>
              <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
              <td>${fmt(ingresos_termino)}</td>
            </tr>
            <tr class="ef-indent">
              <td class="concepto">Ingresos por pago de expensas adeudadas</td>
              <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
              <td>${fmt(ingresos_adeudados)}</td>
            </tr>
            <tr class="ef-indent">
              <td class="concepto">Ingresos por pago de intereses</td>
              <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
              <td>${fmt(ingresos_intereses)}</td>
            </tr>
            <tr class="ef-indent">
              <td class="concepto">Egresos por pagos</td>
              <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
              <td>${fmt(egresos_pagos)}</td>
            </tr>
            <tr class="ef-saldo-final">
              <td class="left concepto">Saldo final al ${fecha_saldo_fin || '—'}</td>
              <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
              <td>${fmt(saldo_final)}</td>
            </tr>
          </tbody>
        </table>

        <div class="notas-box" style="margin-top:14px;">
          <h4>NOTAS</h4>
          <p><em>Nota del período</em></p>
          <p><strong>ESTADO FINANCIERO</strong></p>
          <p>
            Saldo Liq &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; $ ${fmt(saldo_final)} .-<br/>
            Pendiente de pagos $ ${fmt(unidadesTabla.reduce((a,u) => a + Math.max(0,u.deuda), 0))} -<br/>
            SALDO DISPONIBLE &nbsp; $ ${fmt(saldo_final + unidadesTabla.reduce((a,u) => a + Math.max(0,u.deuda), 0))} .- .-
          </p>
          ${notasDelPeriodo ? `<hr style="margin:8px 0; border:none; border-top:1px solid #ccc;"/><p style="white-space:pre-wrap;">${notasDelPeriodo}</p>` : ''}
        </div>

        <div class="notas-box" style="margin-top:10px; font-size:7pt;">
          <p>COMUNICAMOS A LOS SRES PROPIETARIOS/INQUILINOS QUE LOS PAGOS QUE NO SE REALICEN ANTES DE LOS DIAS 28 DE CADA MES, NO PODRAN SER ACREDITADOS EN TIEMPO Y FORMA POR CUESTIONES OPERATIVAS.</p>
          <br/>
          <p>SOLICITAMOS CANCELAR LAS EXPENSAS ANTES DE LA MENCIONADA FECHA, EVITANDO RECARGOS O INCONVENIENTES FUTUROS.</p>
        </div>

        ${footerHTML(2, 6)}
      </div>`;
  }

  // ── 11. PÁGINA 3: Contacto + Morosos ─────────────────────
  function pag3_morosos() {
    const filas = morosos.map(u => `
      <tr>
        <td class="left">${String(u.uf).padStart(2,'0')}</td>
        <td class="left">${u.dpto}</td>
        <td class="left">${u.prop}</td>
        <td class="num">${fmt(u.deuda)}</td>
        <td class="num" style="font-weight:700;">${fmt(u.deuda + u.interesMora)}</td>
      </tr>`).join('');

    const totalDeuda  = morosos.reduce((a,u) => a + u.deuda, 0);
    const totalConInt = morosos.reduce((a,u) => a + u.deuda + u.interesMora, 0);

    return `
      <div class="page">
        ${headerHTML()}

        <div class="notas-box" style="font-size:7pt; margin-bottom: 12px;">
          <p><strong>UBICACIÓN:</strong> ${adminPerfil.direccion || 'LENGUADO N° 1313 LOCAL 3 (ENTRE SHAW Y ENEAS)'}</p>
          <p><strong>HORARIO:</strong> ${adminPerfil.horario || 'LUNES A SABADOS DE 9.00 A 13.00 HORAS'}</p>
          <p><strong>TELÉFONOS:</strong> ${adminPerfil.telefono || ''}</p>
          <hr style="margin:6px 0; border:none; border-top:1px solid #ccc;"/>
          <p>RECOMENDAMOS HACER USO DE TRANSFERENCIAS BANCARIAS EN LAS CUENTAS CORRIENTES INFORMADAS RESPETANDO LOS IMPORTES CON CENTAVOS, PARA UNA CORRECTA IDENTIFICACIÓN Y EVITAR ERRORES EN LAS IMPUTACIONES.</p>
          <br/>
          <p>TAMBIÉN PUEDEN REALIZAR DEPÓSITOS EN EFECTIVO EN LA CUENTA BANCARIA DEL CONSORCIO.</p>
          <br/>
          <p>EN CASO DE TRANSFERIR O DEPOSITAR IMPORTES DISTINTOS A LOS INFORMADOS EN LA LIQUIDACIÓN, DEBERÁN ENVIAR AVISO CON EL COMPROBANTE PARA UNA CORRECTA IDENTIFICACIÓN Y ACREDITACIÓN A LA UNIDAD CORRESPONDIENTE.</p>
        </div>

        ${morosos.length > 0 ? `
          <div class="section-title">UNIDADES CON DEUDA DE EXPENSAS</div>
          <table class="morosos-table">
            <thead>
              <tr>
                <th class="left">U.F.</th>
                <th class="left">Dpto.</th>
                <th class="left">PROPIETARIO</th>
                <th class="left" style="text-align:right;">DEUDA</th>
                <th class="left" style="text-align:right;">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              ${filas}
              <tr style="background:#1a5276; color:#fff; font-weight:700;">
                <td colspan="3" style="text-align:right; padding-right:10px;">TOTAL</td>
                <td class="num">${fmt(totalDeuda)}</td>
                <td class="num">${fmt(totalConInt)}</td>
              </tr>
            </tbody>
          </table>
        ` : '<p style="text-align:center; color:#1a5276; font-weight:600; margin-top:20px;">✅ Sin unidades con deuda en este período.</p>'}

        ${footerHTML(3, 6)}
      </div>`;
  }

  // ── 12. PÁGINAS 4-5: Estado de cuentas y prorrateo ────────
  function pagsProrrateo() {
    // Dividir en chunks de ~35 filas por página
    const FILAS_POR_PAG = 35;
    const chunks = [];
    for (let i = 0; i < unidadesTabla.length; i += FILAS_POR_PAG) {
      chunks.push(unidadesTabla.slice(i, i + FILAS_POR_PAG));
    }

    const totSaldoAnt = unidadesTabla.reduce((a,u) => a + u.saldoAnterior, 0);
    const totPagos    = unidadesTabla.reduce((a,u) => a + u.pagos, 0);
    const totDeuda    = unidadesTabla.reduce((a,u) => a + u.deuda, 0);
    const totIntereses= unidadesTabla.reduce((a,u) => a + u.interesMora, 0);
    const totFdo      = unidadesTabla.reduce((a,u) => a + u.fdoObrasUF, 0);
    const totGrales   = unidadesTabla.reduce((a,u) => a + u.gtosGralesUF, 0);
    const totCoch     = unidadesTabla.reduce((a,u) => a + u.cocheraUF, 0);
    const totDptos    = unidadesTabla.reduce((a,u) => a + u.dptosUF, 0);
    const totTotal    = unidadesTabla.reduce((a,u) => a + u.total, 0);

    return chunks.map((chunk, ci) => {
      const nroPag = 4 + ci;
      const esUltima = ci === chunks.length - 1;

      const filas = chunk.map((u,idx) => `
        <tr>
          <td class="left">${String(u.uf).padStart(2,'0')}</td>
          <td class="left">${u.dpto}</td>
          <td class="left" style="max-width:80px; overflow:hidden; white-space:nowrap;">${u.prop}</td>
          <td>${fmt(u.saldoAnterior)}</td>
          <td>${fmt(u.pagos)}</td>
          <td>${u.deuda > 0 ? fmt(u.deuda) : '0,00'}</td>
          <td>${u.interesMora > 0 ? fmt(u.interesMora) : '0,00'}</td>
          <td>${fmtPct(u.pctPart)}</td>
          <td style="font-size:6.5pt;">${fmtPct(0)}</td>
          <td>${fmt(u.fdoObrasUF)}</td>
          <td>${fmtPct(0)}</td>
          <td>${fmt(u.gtosGralesUF)}</td>
          <td>${fmtPct(0)}</td>
          <td>${fmt(u.cocheraUF)}</td>
          <td>${fmt(u.dptosUF)}</td>
          <td style="font-size:6.5pt;">${fmt(u.redAjuste)}</td>
          <td style="font-weight:600;">${fmt(u.total)}</td>
          <td class="left" style="font-size:6pt; color:#888;">${String(u.uf).padStart(2,'0')}</td>
        </tr>`).join('');

      const filaTotal = esUltima ? `
        <tr style="background:#1a5276; color:#fff; font-weight:700; font-size:7pt;">
          <td colspan="3" style="text-align:right;">TOTAL</td>
          <td>${fmt(totSaldoAnt)}</td>
          <td>${fmt(totPagos)}</td>
          <td>${fmt(totDeuda)}</td>
          <td>${fmt(totIntereses)}</td>
          <td>100%</td>
          <td>,00</td>
          <td>${fmt(totFdo)}</td>
          <td>100%</td>
          <td>${fmt(totGrales)}</td>
          <td>100%</td>
          <td>${fmt(totCoch)}</td>
          <td>${fmt(totDptos)}</td>
          <td>,00</td>
          <td>${fmt(totTotal)}</td>
          <td></td>
        </tr>` : '';

      return `
        <div class="page">
          <div style="font-size:7pt; color:#444; margin-bottom:4px;">
            <strong>Administración:</strong> ${adminPerfil.nombre || 'Javier Garcia Perez'} &nbsp;&nbsp;
            <strong>Consorcio:</strong> ${consorcioActivo?.nombre || ''} &nbsp;&nbsp;
            <strong>Período:</strong> ${expensaSeleccionada?.periodo || ''}
            <span style="float:right; font-size:6.5pt;">Nº RPA: ${adminPerfil.rpac || '83'} &nbsp; CUIT Consorcio: ${consorcioActivo?.cuit || ''} &nbsp; Vencimiento: ${expensaSeleccionada?.fecha_vencimiento || ''}</span>
          </div>

          <div class="prorrateo-header">ESTADO DE CUENTAS Y PRORRATEO</div>

          <div style="overflow-x:auto;">
          <table style="font-size:6.2pt;">
            <thead>
              <tr>
                <th class="left">U.F.</th>
                <th class="left">Dpto.</th>
                <th class="left">PROP.</th>
                <th>SALDO ANT.</th>
                <th>PAGOS</th>
                <th>DEUDA</th>
                <th>INTERES</th>
                <th>GTOS PART.</th>
                <th></th>
                <th>FDO OBRAS</th>
                <th></th>
                <th>GTOS GRALES</th>
                <th></th>
                <th>COCH.</th>
                <th>DPTOS</th>
                <th>RED./AJ.</th>
                <th>TOTAL</th>
                <th>U.F.</th>
              </tr>
            </thead>
            <tbody>
              ${filas}
              ${filaTotal}
            </tbody>
          </table>
          </div>

          ${footerHTML(nroPag, 6)}
        </div>`;
    }).join('');
  }

  // ── 13. PÁGINA 6: Formas de pago ─────────────────────────
  function pag6_formasDePago() {
    return `
      <div class="page">
        ${headerHTML()}

        <div class="fpago-box" style="margin-top:30px;">
          <h3>FORMAS DE PAGO</h3>
          <p style="font-weight:600; margin-bottom:6px;">DEPÓSITO O TRANSFERENCIA</p>
          <p>
            <strong>Titular:</strong> ${fpago.titular}<br/>
            <strong>CBU:</strong> ${fpago.cbu}<br/>
            <strong>Nº de cuenta:</strong> ${fpago.nro_cuenta || '—'}<br/>
            <strong>Alias:</strong> ${fpago.alias}<br/>
            <strong>Banco:</strong> ${fpago.banco}<br/>
            <strong>Sucursal:</strong> ${fpago.sucursal}
          </p>
        </div>

        ${footerHTML(6, 6)}
      </div>`;
  }

  // ── 14. Ensamblar HTML completo ───────────────────────────
  const htmlCompleto = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8"/>
      <title>Liquidación ${periodoStr} — ${consorcioActivo?.nombre}</title>
      <style>${css}</style>
    </head>
    <body>
      <button class="btn-print no-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>

      ${pag1_gastos()}
      ${pag2_estadoFinanciero()}
      ${pag3_morosos()}
      ${pagsProrrateo()}
      ${pag6_formasDePago()}
    </body>
    </html>`;

  // ── 15. Abrir ventana de impresión ────────────────────────
  const ventana = window.open('', '_blank', 'width=900,height=700');
  ventana.document.write(htmlCompleto);
  ventana.document.close();
  ventana.focus();
}

// ============================================================
// INTEGRACIÓN EN index.jsx
// ============================================================
//
// 1. Agregar en el botón "📄 PDF" del módulo Expensas:
//
//    onClick={() => generarPDFLiquidacion({
//      consorcioActivo,
//      expensaSeleccionada: expensaActual,
//      gastosDelPeriodo: gastos.filter(g => g.expensa_id === expensaActual.id),
//      unidadesConDetalles: unidadesConDetalle,  // fetchear de con_expensas_detalle
//      adminPerfil: perfilAdmin,
//      estadoFinanciero: null,   // calcular automático
//      notasDelPeriodo: expensaActual.descripcion || '',
//      formasDePago: {
//        titular:   consorcioActivo.nombre,
//        cbu:       consorcioActivo.cbu,
//        alias:     consorcioActivo.alias,
//        banco:     consorcioActivo.banco,
//        sucursal:  consorcioActivo.sucursal,
//        nro_cuenta: consorcioActivo.nro_cuenta,
//      }
//    })}
//
// 2. Agregar campos al formulario de consorcio:
//    cbu, alias, banco, sucursal, nro_cuenta, clave_suterh, horario
//
// 3. Agregar a con_consorcios en Supabase:
//    ALTER TABLE con_consorcios ADD COLUMN IF NOT EXISTS cbu text;
//    ALTER TABLE con_consorcios ADD COLUMN IF NOT EXISTS alias text;
//    ALTER TABLE con_consorcios ADD COLUMN IF NOT EXISTS banco text;
//    ALTER TABLE con_consorcios ADD COLUMN IF NOT EXISTS sucursal text;
//    ALTER TABLE con_consorcios ADD COLUMN IF NOT EXISTS nro_cuenta text;
//    ALTER TABLE con_consorcios ADD COLUMN IF NOT EXISTS clave_suterh text;
//
// 4. Agregar a con_expensas_detalle:
//    ALTER TABLE con_expensas_detalle ADD COLUMN IF NOT EXISTS saldo_anterior numeric DEFAULT 0;
//    ALTER TABLE con_expensas_detalle ADD COLUMN IF NOT EXISTS pagos_periodo numeric DEFAULT 0;
//    ALTER TABLE con_expensas_detalle ADD COLUMN IF NOT EXISTS redondeo numeric DEFAULT 0;
//
// 5. La función columnaDeGasto() y el objeto CATEGORIA_A_RUBRO
//    deben ajustarse según el flujo real de carga de gastos
//    (qué categorías usa el administrador en la UI).
//
// ============================================================
