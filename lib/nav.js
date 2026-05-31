// lib/nav.js
// Módulos con dynamic() — string literal + objeto literal inline (Next.js 13)
// Solo incluye módulos que existen en el repo.

import dynamic from 'next/dynamic'

export const MODULE_ROUTES = {
  // Consorcio
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
  // Proveedores
  comprobantes:             dynamic(() => import('../modules/proveedores/Comprobantes'),          { ssr: false }),
  // Contabilidad
  sueldos:                  dynamic(() => import('../modules/contabilidad/Sueldos'),              { ssr: false }),
  // Comunicaciones
  asambleas:                dynamic(() => import('../modules/comunicaciones/Asambleas'),          { ssr: false }),
  email_tracking:           dynamic(() => import('../modules/comunicaciones/EmailTracking'),      { ssr: false }),
  // Configuración
  importar_pdf:             dynamic(() => import('../modules/configuracion/ImportarPDF'),         { ssr: false }),
  // Superadmin
  clientes:                 dynamic(() => import('../modules/superadmin/ClientesGASP'),           { ssr: false }),
}
