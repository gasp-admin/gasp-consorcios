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
          con_expensas:expensa_id (id, periodo, fuente, fecha_vencimiento, estado, tipo, total_expensa, total_gastos)
        `).eq('unidad_id', uf.id).order('created_at', { ascending: false }).limit(24),
        db.from('con_cobranzas').select(`
          id, expensa_id, monto, fecha, medio_pago, recibo_numero, observaciones,
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
        adjuntos: (Array.isArray(b.adjuntos) && b.adjuntos.length)
          ? b.adjuntos.slice(0, 5).map((x) => String(x))
          : null,
      }
      const { error } = await db.from('con_reclamos').insert([row])
      if (error) return res.status(500).json({ error: 'insert', detalle: error.message })
      return res.status(200).json({ ok: true })
    }

    // ── sum_config: espacios activos + disponibilidad + reservas ocupadas (SUM/Amenities) ──
    if (accion === 'sum_config') {
      const { data: esps } = await db.from('con_sum_espacios').select('*')
        .eq('consorcio_id', uf.consorcio_id).eq('activo', true).order('created_at', { ascending: true })
      const espIds = (esps || []).map((e) => e.id)
      let dispo = [], reservas = []
      if (espIds.length) {
        const desde = new Date().toISOString().slice(0, 10)
        const [rd, rr] = await Promise.all([
          db.from('con_sum_disponibilidad').select('id, espacio_id, dia_semana, franja_label, hora_inicio, hora_fin')
            .in('espacio_id', espIds).eq('activo', true),
          db.from('con_sum_reservas').select('id, espacio_id, unidad_id, fecha, franja_label, estado, tipo')
            .in('espacio_id', espIds).gte('fecha', desde)
            .in('estado', ['solicitada', 'pendiente_pago', 'confirmada']),
        ])
        dispo = rd.data || []; reservas = rr.data || []
      }
      return res.status(200).json({ espacios: esps || [], dispo, reservas })
    }

    // ── sum_reservar: crear una reserva del propietario (POST) ──
    if (accion === 'sum_reservar' && isPost) {
      const b = req.body || {}
      const { data: esp } = await db.from('con_sum_espacios').select('*')
        .eq('id', b.espacio_id).eq('consorcio_id', uf.consorcio_id).eq('activo', true).maybeSingle()
      if (!esp) return res.status(400).json({ error: 'espacio_invalido' })
      const fecha = String(b.fecha || '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'fecha_invalida' })
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
      const fd = new Date(fecha + 'T12:00:00Z')
      const maxd = esp.anticipacion_max_dias || 60
      const limite = new Date(hoy.getTime() + maxd * 86400000)
      if (fd < hoy || fd > new Date(limite.getTime() + 86400000)) return res.status(400).json({ error: 'fecha_fuera_de_rango' })
      const dow = fd.getUTCDay()
      const { data: disps } = await db.from('con_sum_disponibilidad').select('*')
        .eq('espacio_id', esp.id).eq('activo', true).eq('dia_semana', dow).eq('franja_label', b.franja_label).limit(1)
      const disp = (disps || [])[0]
      if (!disp) return res.status(400).json({ error: 'franja_no_disponible' })
      const { count } = await db.from('con_sum_reservas').select('id', { count: 'exact', head: true })
        .eq('espacio_id', esp.id).eq('unidad_id', uf.id).in('estado', ['solicitada', 'pendiente_pago', 'confirmada'])
      if ((count || 0) >= (esp.max_reservas_activas_uf || 1)) return res.status(400).json({ error: 'limite_reservas' })
      const inicio = `${fecha}T${disp.hora_inicio}-03:00`
      let finFecha = fecha
      if (disp.hora_fin <= disp.hora_inicio) {   // franja nocturna: termina al día siguiente
        const dn = new Date(fecha + 'T12:00:00Z'); dn.setUTCDate(dn.getUTCDate() + 1)
        finFecha = dn.toISOString().slice(0, 10)
      }
      const fin = `${finFecha}T${disp.hora_fin}-03:00`
      const estado = esp.requiere_aprobacion ? 'solicitada' : (esp.requiere_pago ? 'pendiente_pago' : 'confirmada')
      const row = {
        id: `RES-${esp.id}-${Date.now()}`, admin_id: uf.admin_id, consorcio_id: uf.consorcio_id,
        espacio_id: esp.id, unidad_id: uf.id, tipo: 'reserva', fecha, inicio, fin,
        franja_label: b.franja_label, estado,
        pago_requerido: !!esp.requiere_pago,
        pago_estado: esp.requiere_pago ? 'pendiente' : 'no_aplica',
        pago_monto: esp.requiere_pago ? esp.tarifa : null,
        creado_por: 'portal',
      }
      const { error } = await db.from('con_sum_reservas').insert([row])
      if (error) {
        const m = String(error.message || '')
        if (m.includes('sum_sin_solape')) return res.status(409).json({ error: 'ocupado' })
        return res.status(500).json({ error: 'insert', detalle: m })
      }
      return res.status(200).json({ ok: true, reserva_id: row.id, estado, pago_requerido: row.pago_requerido, tarifa: esp.tarifa })
    }

    // ── sum_adjuntar_pago: asociar el path del comprobante a la reserva (POST) ──
    if (accion === 'sum_adjuntar_pago' && isPost) {
      const b = req.body || {}
      const { data: r } = await db.from('con_sum_reservas').select('id, unidad_id').eq('id', b.reserva_id).maybeSingle()
      if (!r || r.unidad_id !== uf.id) return res.status(403).json({ error: 'reserva_ajena' })
      const { error } = await db.from('con_sum_reservas')
        .update({ pago_adjunto_path: String(b.path || '').slice(0, 300), pago_estado: 'pendiente' })
        .eq('id', b.reserva_id)
      if (error) return res.status(500).json({ error: 'update', detalle: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'accion_desconocida' })
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
