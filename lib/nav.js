// lib/nav.js — Mapeo de IDs de página a módulos React.
// Usa dynamic() de Next.js para code splitting automático:
// cada módulo se carga solo cuando el usuario navega a esa página.

import dynamic from 'next/dynamic'

const loading = () => null
const d = (path) => dynamic(() => import(path), { loading, ssr: false })

export const MODULE_ROUTES = {
  // Consorcio
  dashboard:                d('../modules/consorcio/Dashboard'),
  listado_consorcios:       d('../modules/consorcio/ListadoConsorcios'),
  unidades:                 d('../modules/unidades/Unidades'),
  copropietarios:           d('../modules/copropietarios/Copropietarios'),
  cta_corriente:            d('../modules/unidad/CtaCorriente'),
  reclamos:                 d('../modules/unidad/Reclamos'),
  cert_libre_deuda:         d('../modules/unidad/CertificadoLibreDeuda'),
  // Expensas
  rendicion_cuentas:        d('../modules/expensas/RendicionCuentas'),
  liquidacion:              d('../modules/expensas/LiquidacionPeriodo'),
  expensas:                 d('../modules/expensas/Expensas'),
  periodos:                 d('../modules/expensas/ControlPeriodos'),
  historial_liquidaciones:  d('../modules/expensas/HistorialLiquidaciones'),
  // Cobranzas
  cobranzas:                d('../modules/cobranzas/Cobranzas'),
  cobranzas_auto:           d('../modules/cobranzas/CobranzasAutomaticas'),
  generar_debito:           d('../modules/cobranzas/GenerarDebito'),
  anular_cobranza:          d('../modules/cobranzas/AnularCobranzas'),
  mora_diferencial:         d('../modules/cobranzas/MoraDiferencial'),
  morosos:                  d('../modules/cobranzas/Morosos'),
  recibos:                  d('../modules/cobranzas/ReciboPago'),
  // Proveedores
  proveedores:              d('../modules/proveedores/Proveedores'),
  comprobantes:             d('../modules/proveedores/Comprobantes'),
  pagos_prov:               d('../modules/proveedores/PagosProveedor'),
  cta_proveedor:            d('../modules/proveedores/CtaProveedor'),
  // Contabilidad
  sueldos:                  d('../modules/contabilidad/Sueldos'),
  cuentas_banco:            d('../modules/contabilidad/CuentasBancarias'),
  mov_entre_cuentas:        d('../modules/contabilidad/MovEntrecuentas'),
  mov_varios:               d('../modules/contabilidad/MovimientosVarios'),
  movimientos:              d('../modules/contabilidad/MovimientosUnidad'),
  plan_cuentas:             d('../modules/contabilidad/PlanCuentas'),
  // Reportes
  reporte_movimientos:      d('../modules/reportes/ReporteMovimientos'),
  estado_financiero:        d('../modules/reportes/EstadoFinanciero'),
  balance_anual:            d('../modules/reportes/BalanceAnual'),
  // Comunicaciones
  asambleas:                d('../modules/comunicaciones/Asambleas'),
  emails:                   d('../modules/comunicaciones/EnviarEmails'),
  notificacion:             d('../modules/comunicaciones/EnviarNotificacion'),
  consultar_enviados:       d('../modules/comunicaciones/ConsultarEnviados'),
  email_tracking:           d('../modules/comunicaciones/EmailTracking'),
  agenda_venc:              d('../modules/comunicaciones/AgendaVencimientos'),
  // Configuración
  grupos_liquidacion:       d('../modules/configuracion/GruposLiquidacion'),
  importar:                 d('../modules/configuracion/ImportarExcel'),
  importar_pdf:             d('../modules/configuracion/ImportarPDF'),
  equipo:                   d('../modules/configuracion/Equipo'),
  perfil:                   d('../modules/configuracion/PerfilAdmin'),
  // Superadmin
  clientes:                 d('../modules/superadmin/ClientesGASP'),
}
