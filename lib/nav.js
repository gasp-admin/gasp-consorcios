// lib/nav.js
// Next.js 13 requiere:
// 1. import() con string literal (no variable)
// 2. opciones como objeto literal inline (no variable)

import dynamic from 'next/dynamic'

export const MODULE_ROUTES = {
  // Consorcio
  listado_consorcios:       dynamic(() => import('../modules/consorcio/ListadoConsorcios'),       { ssr: false }),
  unidades:                 dynamic(() => import('../modules/unidades/Unidades'),                 { ssr: false }),
  copropietarios:           dynamic(() => import('../modules/copropietarios/Copropietarios'),     { ssr: false }),
  cta_corriente:            dynamic(() => import('../modules/unidad/CtaCorriente'),               { ssr: false }),
  cert_libre_deuda:         dynamic(() => import('../modules/unidad/CertificadoLibreDeuda'),      { ssr: false }),
  // Expensas
  liquidacion:              dynamic(() => import('../modules/expensas/LiquidacionPeriodo'),       { ssr: false }),
  expensas:                 dynamic(() => import('../modules/expensas/Expensas'),                 { ssr: false }),
  historial_liquidaciones:  dynamic(() => import('../modules/expensas/HistorialLiquidaciones'),   { ssr: false }),
  // Cobranzas
  cobranzas:                dynamic(() => import('../modules/cobranzas/Cobranzas'),               { ssr: false }),
  cobranzas_auto:           dynamic(() => import('../modules/cobranzas/CobranzasAutomaticas'),    { ssr: false }),
  morosos:                  dynamic(() => import('../modules/cobranzas/Morosos'),                 { ssr: false }),
  // Proveedores
  comprobantes:             dynamic(() => import('../modules/proveedores/Comprobantes'),          { ssr: false }),
  // Contabilidad
  sueldos:                  dynamic(() => import('../modules/contabilidad/Sueldos'),              { ssr: false }),
  // Reportes
  balance_anual:            dynamic(() => import('../modules/reportes/BalanceAnual'),             { ssr: false }),
  // Comunicaciones
  asambleas:                dynamic(() => import('../modules/comunicaciones/Asambleas'),          { ssr: false }),
  email_tracking:           dynamic(() => import('../modules/comunicaciones/EmailTracking'),      { ssr: false }),
  // Configuración
  importar_pdf:             dynamic(() => import('../modules/configuracion/ImportarPDF'),         { ssr: false }),
  // Superadmin
  clientes:                 dynamic(() => import('../modules/superadmin/ClientesGASP'),           { ssr: false }),
}
