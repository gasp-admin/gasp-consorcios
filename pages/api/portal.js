// pages/api/portal.js
// Endpoint server-side del portal del propietario.
// El WebView in-app de Android bloquea las requests a supabase.co (y/o localStorage),
// por lo que el portal no puede consultar Supabase desde el navegador. Este endpoint
// corre en el servidor de Vercel (mismo dominio que el portal) y hace las consultas ahí;
// el portal solo hace fetch a `/api/portal` (mismo dominio), que el WebView no bloquea.
//
// Seguridad: toda acción exige el portal_token (la credencial del propietario). Sin token
// válido no se devuelve nada. Las consultas se limitan a la unidad/consorcio de ese token.
//
// NO toca el cliente Supabase del portal (pages/portal.jsx) — eso rompía el build de Vercel.

import { createClient } from '@supabase/supabase-js'

const SUPA_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
// Si la service key está configurada en Vercel, se usa (evita RLS); si no, cae a anon
// (el portal ya lee estas tablas con anon, así que RLS lo permite igual).
const SRV_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON_KEY

const db = createClient(SUPA_URL, SRV_KEY, { auth: { persistSession: false } })

async function resolverUnidad(token) {
  const tk = Array.isArray(token) ? token[0] : String(token || '').trim()
  if (!tk) return null
  const { data } = await db.from('con_unidades').select('*').eq('portal_token', tk).single()
  return data || null
}

export default async function handler(req, res) {
  try {
    const accion = (req.query?.accion) || 'init'
    const token  = req.query?.token

    const uf = await resolverUnidad(token)
    if (!uf) return res.status(404).json({ error: 'link_invalido' })

    if (accion === 'init') {
      const [
        { data: cp }, { data: con }, { data: adm },
        { data: cuentas }, { data: dets }, { data: cobs },
      ] = await Promise.all([
        db.from('con_copropietarios').select('*').eq('id', uf.propietario_id).single(),
        db.from('con_consorcios').select('*').eq('id', uf.consorcio_id).single(),
        db.from('con_admin_perfil').select('*').eq('admin_id', uf.admin_id).single(),
        db.from('con_cuentas_banco').select('*').eq('consorcio_id', uf.consorcio_id).eq('activa', true).limit(1),
        db.from('con_expensas_detalle').select(`
          id, expensa_id, monto, saldo_anterior, pagos_periodo, interes_mora, estado,
          con_expensas:expensa_id (id, periodo, fecha_vencimiento, estado, tipo, total_expensa, total_gastos)
        `).eq('unidad_id', uf.id).order('created_at', { ascending: false }).limit(24),
        db.from('con_cobranzas').select(`
          id, monto, fecha, medio_pago, recibo_numero, observaciones,
          con_expensas:expensa_id (periodo)
        `).eq('unidad_id', uf.id).in('estado', ['vigente', 'acreditado', 'cobrado']).order('fecha', { ascending: false }).limit(30),
      ])
      return res.status(200).json({ uf, cp, con, adm, cuentas, dets, cobs })
    }

    if (accion === 'cta') {
      // Llama a la Edge Function get-cuenta-corriente DESDE EL SERVIDOR (el WebView no llega a supabase.co)
      const r = await fetch(`${SUPA_URL}/functions/v1/get-cuenta-corriente`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SRV_KEY}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ unidad_id: uf.id }),
      })
      const data = await r.json().catch(() => ({}))
      return res.status(200).json(data)
    }

    return res.status(400).json({ error: 'accion_desconocida' })
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
