// api/edgeFunctions.js
// Wrapper centralizado para todas las Edge Functions de GASP Consorcios.

import { SUPA_URL } from '../lib/config'

async function callEF(slug, payload, token) {
  const res = await fetch(`${SUPA_URL}/functions/v1/${slug}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// Cuenta corriente por unidad
export const getCuentaCorriente = (unidadId, token, filtros = {}) =>
  callEF('get-cuenta-corriente', { unidad_id: unidadId, ...filtros }, token)

// IA — PDF y facturas
export const extraerPdfIA = (payload, token) =>
  callEF('extraer-pdf-ia', payload, token)

export const extraerFacturaIA = (payload, token) =>
  callEF('extraer-factura-ia', payload, token)

// Drive
export const listarDrivePdfs = (payload, token) =>
  callEF('listar-drive-pdfs', payload, token)

// Liquidaciones históricas
export const importarLiquidacionHistorica = (payload, token) =>
  callEF('importar-liquidacion-historica', payload, token)

// SIRO / Banco Roela
export const siroProxy = (accion, extra = {}, token) =>
  callEF('siro-proxy', { accion, ...extra }, token)

// Envío de liquidaciones y notificaciones
export const enviarLiquidacion = (payload, token) =>
  callEF('enviar-liquidacion', payload, token)

export const enviarNotificacion = (payload, token) =>
  callEF('enviar-notificacion', payload, token)

// Certificado libre de deuda
export const generarCertificadoLibreDeuda = (payload, token) =>
  callEF('generar-certificado-libre-deuda', payload, token)

// Asambleas — generación de acta PDF
export const generarActaAsamblea = (payload, token) =>
  callEF('generar-acta-asamblea', payload, token)

// Sueldos — lectura de recibo
export const leerReciboSueldo = (payload, token) =>
  callEF('leer-recibo-sueldo', payload, token)

// Email — verificar estado de envío (Resend)
export const verificarEmailEstado = (emailId, token) =>
  callEF('verificar-email-estado', { email_id: emailId }, token)

// Usuarios empresa (equipo)
export const gestionarUsuariosEmpresa = (accion, extra = {}, token) =>
  callEF('gestionar-usuarios-empresa', { accion, ...extra }, token)

// Clientes GASP (superadmin)
export const gestionarClienteGASP = (accion, extra = {}, token) =>
  callEF('gestionar-clientes-gasp', { accion, ...extra }, token)

export const crearDemoConsorcios = (payload, token) =>
  callEF('crear-demo-consorcios', payload, token)
