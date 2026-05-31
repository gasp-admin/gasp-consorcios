// lib/nav.js
// CORRECCIÓN: Next.js requiere que import() dentro de dynamic() sea un STRING LITERAL.
// Con import(variable) el bundler no puede resolver la ruta → módulo nunca carga → pantalla en blanco.
// Dashboard funciona porque se importa estáticamente en pages/index.jsx.

import dynamic from 'next/dynamic'

const opts = { ssr: false }

export const MODULE_ROUTES = {
  // Consorcio
  listado_consorcios:       dynamic(() => import('../modules/consorcio/ListadoConsorcios'),       opts),
  unidades:                 dynamic(() => import('../modules/unidades/Unidades'),                 opts),
  copropietarios:           dynamic(() => import('../modules/copropietarios/Copropietarios'),     opts),
  cta_corriente:            dynamic(() => import('../modules/unidad/CtaCorriente'),               opts),
  cert_libre_deuda:         dynamic(() => import('../modules/unidad/CertificadoLibreDeuda'),      opts),
  // Expensas
  liquidacion:              dynamic(() => import('../modules/expensas/LiquidacionPeriodo'),       opts),
  expensas:                 dynamic(() => import('../modules/expensas/Expensas'),                 opts),
  historial_liquidaciones:  dynamic(() => import('../modules/expensas/HistorialLiquidaciones'),   opts),
  // Cobranzas
  cobranzas:                dynamic(() => import('../modules/cobranzas/Cobranzas'),               opts),
  cobranzas_auto:           dynamic(() => import('../modules/cobranzas/CobranzasAutomaticas'),    opts),
  morosos:                  dynamic(() => import('../modules/cobranzas/Morosos'),                 opts),
  // Proveedores
  comprobantes:             dynamic(() => import('../modules/proveedores/Comprobantes'),          opts),
  // Contabilidad
  sueldos:                  dynamic(() => import('../modules/contabilidad/Sueldos'),              opts),
  // Reportes
  balance_anual:            dynamic(() => import('../modules/reportes/BalanceAnual'),             opts),
  // Comunicaciones
  asambleas:                dynamic(() => import('../modules/comunicaciones/Asambleas'),          opts),
  email_tracking:           dynamic(() => import('../modules/comunicaciones/EmailTracking'),      opts),
  // Configuración
  importar_pdf:             dynamic(() => import('../modules/configuracion/ImportarPDF'),         opts),
  perfil:                   dynamic(() => import('../modules/configuracion/PerfilAdmin'),         opts),
  // Superadmin
  clientes:                 dynamic(() => import('../modules/superadmin/ClientesGASP'),           opts),
}
