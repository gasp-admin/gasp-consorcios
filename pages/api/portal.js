// pages/api/portal.js
// Endpoint server-side del portal del propietario.
// El WebView in-app de Android bloquea las requests a supabase.co, por lo que el portal
// no puede consultar Supabase desde el navegador. Este endpoint corre en el servidor de
// Vercel (mismo dominio que el portal) y hace las consultas ahí; el portal solo hace
// fetch a `/api/portal` (mismo dominio), que el WebView no bloquea.
//
// Usa la SERVICE ROLE key (server-side, nunca expuesta al cliente): pasa por encima de RLS
// y evita la función get_admin_id_efectivo, que el rol anon no puede ejecutar.
//
// Seguridad: toda acción exige el portal_token (credencial del propietario). Las consultas
// se limitan a la unidad/consorcio de ese token; las escrituras se atan a esa unidad.
// NO toca el cliente Supabase del portal (pages/portal.jsx) — eso rompía el build de Vercel.

import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SRV_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON_KEY

const db = createClient(SUPA_URL, SRV_KEY, { auth: { persistSession: false } })

async function resolverUnidad(token) {
  const tk = Array.isArray(token) ? token[0] : String(token || '').trim()
  if (!tk) return null
  const { data } = await db.from('con_unidades').select('*').eq('portal_token', tk).single()
  return data || null
}

export default async function handler(req, res) {
  try {
    if (!SUPA_URL || !SRV_KEY) return res.status(500).json({ error: 'config' })

    const isPost = req.method === 'POST'
    const accion = (isPost ? req.body?.accion : req.query?.accion) || 'init'
    const token  = isPost ? req.body?.token : req.query?.token

    const uf = await resolverUnidad(token)
    if (!uf) return res.status(404).json({ error: 'link_invalido' })

    // ── init: carga inicial del portal ──
    if (accion === 'init') {
      const [
        { data: cp }, { data: con }, { data: adm },
        { data: cuentas }, { data: dets }, { data: cobs }, { data: ifuf }, { data: cfgcob },
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
        db.from('con_interfast_uf').select('cpe, cvu, alias').eq('unidad_id', uf.id).maybeSingle(),
        db.from('con_config_cobranza').select('interfast_activo').eq('consorcio_id', uf.consorcio_id).maybeSingle(),
      ])

      // Corte nativo: no mostrar expensas anteriores a fecha_corte_nativo (coherente con get-cuenta-corriente).
      // La historia queda congelada en el saldo de apertura; la cta cte arranca desde el corte.
      let detsVisibles = dets || []
      if (con?.fecha_corte_nativo) {
        const corteYM = String(con.fecha_corte_nativo).slice(0, 7)
        detsVisibles = detsVisibles.filter((d) => {
          const per = d?.con_expensas?.periodo
          return !per || per >= corteYM
        })
      }
      return res.status(200).json({ uf, cp, con, adm, cuentas, dets: detsVisibles, cobs, interfast: (cfgcob?.interfast_activo ? ifuf : null) })
    }

    // ── cta: cuenta corriente (llama a la EF desde el servidor) ──
    if (accion === 'cta') {
      const r = await fetch(`${SUPA_URL}/functions/v1/get-cuenta-corriente`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SRV_KEY}`,
          'apikey': SRV_KEY,      // FIX: misma key que Authorization (el gateway nuevo rechaza apikey!=Authorization)
        },
        body: JSON.stringify({ unidad_id: uf.id }),
      })
      const data = await r.json().catch(() => ({}))
      return res.status(200).json(data)
    }

    // ── liq: detalle de un período (para el PDF de liquidación) ──
    if (accion === 'liq') {
      const expId = req.query?.exp
      if (!expId) return res.status(400).json({ error: 'sin_exp' })
      const { data: exp } = await db.from('con_expensas').select('*').eq('id', expId).single()
      if (!exp || exp.consorcio_id !== uf.consorcio_id) return res.status(403).json({ error: 'exp_ajena' })
      const [
        { data: gastos }, { data: dets }, { data: ufs }, { data: cps }, { data: lufs }, { data: comprobantes },
      ] = await Promise.all([
        db.from('con_gastos').select('categoria, concepto, monto, proveedor_nombre, comprobante').eq('expensa_id', expId).order('categoria'),
        db.from('con_expensas_detalle').select('*').eq('expensa_id', expId),
        db.from('con_unidades').select('*').eq('consorcio_id', uf.consorcio_id),
        db.from('con_copropietarios').select('*').eq('consorcio_id', uf.consorcio_id),
        db.from('con_liquidacion_uf').select('unidad_id, total_uf, saldo_anterior, pagos, deuda, interes, expensa_calculada, ajustes').eq('consorcio_id', uf.consorcio_id).eq('periodo', exp.periodo),
        db.from('con_comprobantes_proveedor').select('saldo_pendiente').eq('expensa_id', expId),
      ])
      return res.status(200).json({ gastos, dets, ufs, cps, exp, lufs, comprobantes })
    }

    // ── reclamo: crear reclamo / informar pago (POST) ──
    if (accion === 'reclamo' && isPost) {
      const b = req.body || {}
      const row = {
        id: (b.prefijo || 'REC') + '-' + Date.now(),
        admin_id: uf.admin_id,
        consorcio_id: uf.consorcio_id,
        unidad_id: uf.id,
        copropietario_id: uf.propietario_id,
        categoria: b.categoria || 'otro',
        titulo: String(b.titulo || '').slice(0, 200),
        descripcion: String(b.descripcion || '').slice(0, 4000),
        estado: 'abierto',
        prioridad: b.prioridad || 'normal',
      }
      const { error } = await db.from('con_reclamos').insert([row])
      if (error) return res.status(500).json({ error: 'insert', detalle: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'accion_desconocida' })
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
