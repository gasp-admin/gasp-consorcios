// api/edgeFunctions.js
// Wrapper centralizado para todas las Edge Functions de GASP Consorcios.
// Si cambia el nombre de una EF o su contrato, se corrige aquí.

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

export const getCuentaCorriente = (unidadId, token, filtros = {}) =>
  callEF('get-cuenta-corriente', { unidad_id: unidadId, ...filtros }, token)

export const extraerPdfIA = (payload, token) =>
  callEF('extraer-pdf-ia', payload, token)

export const listarDrivePdfs = (payload, token) =>
  callEF('listar-drive-pdfs', payload, token)

export const importarLiquidacionHistorica = (payload, token) =>
  callEF('importar-liquidacion-historica', payload, token)

export const siroProxy = (accion, extra = {}, token) =>
  callEF('siro-proxy', { accion, ...extra }, token)

export const enviarLiquidacion = (payload, token) =>
  callEF('enviar-liquidacion', payload, token)

export const gestionarClienteGASP = (accion, extra = {}, token) =>
  callEF('gestionar-clientes-gasp', { accion, ...extra }, token)

export const crearDemoConsorcios = (payload, token) =>
  callEF('crear-demo-consorcios', payload, token)
