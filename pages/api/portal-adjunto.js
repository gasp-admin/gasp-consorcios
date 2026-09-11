// pages/api/portal-adjunto.js
// Subida de UN adjunto (comprobante de pago o adjunto de reclamo) desde el Portal del Propietario.
//
// El WebView in-app de Android bloquea las requests a supabase.co, así que el archivo NO puede subir
// directo a Storage desde el navegador. Sube a este endpoint (mismo dominio que el portal) y desde acá,
// con SERVICE ROLE, se guarda en el bucket PRIVADO `consorcios-adjuntos`.
//
// Recibe los BYTES CRUDOS en el body (Content-Type = mime del archivo); los metadatos van por query string.
// bodyParser:false → se lee el stream sin base64: evita el +33% de inflado y el tope de ~4,5 MB del body
// de las funciones serverless de Vercel (un PDF de 4 MB entra; en base64 serían ~5,5 MB y lo rechazaría).
//
// Seguridad: exige el portal_token (credencial del propietario). El path se ata a la unidad de ese token.
// El bucket es privado; el admin lee vía signed URL (policy SELECT scoped por admin_id).

import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: false } }

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SRV_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON_KEY

const db = createClient(SUPA_URL, SRV_KEY, { auth: { persistSession: false } })

const BUCKET  = 'consorcios-adjuntos'
const MIME_OK = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const MAX_PDF = 4 * 1024 * 1024   // 4 MB (spec)
const MAX_IMG = 6 * 1024 * 1024   // la imagen ya viene comprimida del cliente; tope de resguardo

function leerBody(req, limite) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > limite) { reject(new Error('too_large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sanitizar(nombre) {
  const n = String(nombre || 'archivo').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_')
  return (n.slice(-60) || 'archivo').replace(/^[_.\-]+/, '') || 'archivo'
}

async function resolverUnidad(token) {
  const tk = Array.isArray(token) ? token[0] : String(token || '').trim()
  if (!tk) return null
  const { data } = await db.from('con_unidades').select('id, consorcio_id, admin_id').eq('portal_token', tk).single()
  return data || null
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'metodo' })
    if (!SUPA_URL || !SRV_KEY) return res.status(500).json({ error: 'config' })

    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    const ext = MIME_OK[mime]
    if (!ext) return res.status(415).json({ error: 'tipo_no_permitido' })

    const uf = await resolverUnidad(req.query?.token)
    if (!uf) return res.status(404).json({ error: 'link_invalido' })

    const limite = ext === 'pdf' ? MAX_PDF : MAX_IMG
    let buf
    try { buf = await leerBody(req, limite) } catch (e) { return res.status(413).json({ error: 'muy_grande' }) }
    if (!buf || !buf.length) return res.status(400).json({ error: 'vacio' })

    let base = sanitizar(req.query?.nombre)
    if (!base.toLowerCase().endsWith('.' + ext)) base = base.replace(/\.\w+$/, '') + '.' + ext
    const path = `${uf.admin_id}/${uf.consorcio_id}/${uf.id}/${Date.now()}-${base}`

    const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false })
    if (error) return res.status(500).json({ error: 'upload', detalle: error.message })

    return res.status(200).json({ ok: true, path })
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
