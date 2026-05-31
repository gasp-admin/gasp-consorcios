// lib/exportPdf.js
// Utilidades de exportación a PDF para GASP Consorcios.
// Antes: exportarPDF() y generarPDFLiquidacion() en el scope global.
// Ahora: módulo independiente.
//
// NOTA: Este archivo contiene la lógica de exportarPDF() y
// generarPDFLiquidacion() extraídas del V59.
// El contenido completo está en el archivo exportPdf_COMPLETO.js
// de esta carpeta. Copiarlo tal cual a lib/exportPdf.js en el repo.
//
// Contiene referencias a: RUBROS_PDF, CAT_RUBRO, fmtN, periodoLabel,
// colGasto — estas constantes deben importarse o copiarse localmente
// hasta que se complete la Fase 2.
//
// Por ahora en la Fase 1: este archivo se crea vacío.
// En la Fase 2 se completará con las importaciones correctas.
// El archivo que funciona hoy sigue siendo pages/index.jsx V59.

// TODO Fase 2: importar y separar generarPDFLiquidacion correctamente
export { exportarPDF } from './exportPdf_impl'
