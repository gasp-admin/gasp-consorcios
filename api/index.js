// api/index.js — Data Access Layer de GASP Consorcios.
// Antes: supabase.from('con_X') aparecía ~200 veces en index.jsx
// Ahora: una función por entidad. Cambio de esquema = un solo lugar.

import { supabase } from '../lib/supabase'

// CONSORCIOS
export async function getConsorcios(adminId) {
  const { data, error } = await supabase.from('con_consorcios').select('*').eq('admin_id', adminId).eq('activo', true).order('nombre')
  if (error) throw error
  return data || []
}

export async function saveConsorcio(form, adminId) {
  if (form.id) {
    const { error } = await supabase.from('con_consorcios').update(form).eq('id', form.id)
    if (error) throw error
  } else {
    const { data: existing } = await supabase.from('con_consorcios').select('id').eq('admin_id', adminId)
    const id = 'CON' + String((existing?.length || 0) + 1).padStart(3, '0')
    const { error } = await supabase.from('con_consorcios').insert([{ ...form, id, admin_id: adminId, activo: true }])
    if (error) throw error
  }
}

// UNIDADES
export async function getUnidades(adminId, consorcioId) {
  const { data, error } = await supabase.from('con_unidades').select('*').eq('admin_id', adminId).eq('consorcio_id', consorcioId).order('numero')
  if (error) throw error
  return data || []
}

export async function saveUnidad(unidad) {
  if (unidad.id) {
    const { error } = await supabase.from('con_unidades').update(unidad).eq('id', unidad.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('con_unidades').insert([unidad])
    if (error) throw error
  }
}

export async function deleteUnidad(id) {
  const { error } = await supabase.from('con_unidades').update({ activo: false }).eq('id', id)
  if (error) throw error
}

// COPROPIETARIOS
export async function getCopropietarios(adminId, consorcioId) {
  const { data, error } = await supabase.from('con_copropietarios').select('*').eq('admin_id', adminId).eq('consorcio_id', consorcioId).order('apellido_nombre')
  if (error) throw error
  return data || []
}

export async function saveCopropietario(copropietario) {
  if (copropietario.id) {
    const { error } = await supabase.from('con_copropietarios').update(copropietario).eq('id', copropietario.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('con_copropietarios').insert([copropietario])
    if (error) throw error
  }
}

// EXPENSAS
export async function getExpensas(adminId, consorcioId) {
  const { data, error } = await supabase.from('con_expensas').select('*').eq('admin_id', adminId).eq('consorcio_id', consorcioId).order('periodo', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getDetallesExpensa(expensaId) {
  const { data, error } = await supabase.from('con_expensas_detalle').select('*, con_unidades(numero, porcentaje_fiscal)').eq('expensa_id', expensaId).order('created_at')
  if (error) throw error
  return data || []
}

export async function getGastosExpensa(expensaId) {
  const { data, error } = await supabase.from('con_gastos').select('*, con_proveedores(razon_social)').eq('expensa_id', expensaId).order('fecha')
  if (error) throw error
  return data || []
}

// COBRANZAS
export async function getCobranzas(adminId, consorcioId, filtros = {}) {
  let q = supabase.from('con_cobranzas').select('*, con_expensas(periodo), con_unidades(numero)').eq('admin_id', adminId).eq('consorcio_id', consorcioId).in('estado', ['vigente', 'acreditado', 'cobrado']).order('fecha', { ascending: false })
  if (filtros.desde) q = q.gte('fecha', filtros.desde)
  if (filtros.hasta) q = q.lte('fecha', filtros.hasta)
  if (filtros.unidad_id) q = q.eq('unidad_id', filtros.unidad_id)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function registrarCobro(payload) {
  const { data, error } = await supabase.from('con_cobranzas').insert([payload]).select().single()
  if (error) throw error
  return data
}

export async function anularCobro(id, adminId) {
  const { error } = await supabase.from('con_cobranzas').update({ estado: 'anulada' }).eq('id', id).eq('admin_id', adminId)
  if (error) throw error
}

// PROVEEDORES
export async function getProveedores(adminId, consorcioId) {
  const { data, error } = await supabase.from('con_proveedores').select('*').eq('admin_id', adminId).or(`consorcio_id.eq.${consorcioId},consorcio_id.is.null`).order('razon_social')
  if (error) throw error
  return data || []
}

export async function saveProveedor(proveedor) {
  if (proveedor.id) {
    const { error } = await supabase.from('con_proveedores').update(proveedor).eq('id', proveedor.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('con_proveedores').insert([proveedor])
    if (error) throw error
  }
}

// MOVIMIENTOS
export async function getMovimientosUnidad(adminId, consorcioId, unidadId) {
  let q = supabase.from('con_movimientos_unidad').select('*').eq('admin_id', adminId).eq('consorcio_id', consorcioId).in('estado', ['vigente', 'acreditado', 'cobrado']).order('fecha', { ascending: false })
  if (unidadId) q = q.eq('unidad_id', unidadId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function insertMovimiento(movimiento) {
  const { error } = await supabase.from('con_movimientos_unidad').insert([movimiento])
  if (error) throw error
}

// PERFIL ADMIN
export async function getAdminPerfil(adminId) {
  const { data } = await supabase.from('con_admin_perfil').select('*').eq('admin_id', adminId).single()
  return data || {}
}

export async function saveAdminPerfil(perfil, adminId) {
  const { data: existing } = await supabase.from('con_admin_perfil').select('id').eq('admin_id', adminId).single()
  if (existing) {
    const { error } = await supabase.from('con_admin_perfil').update(perfil).eq('admin_id', adminId)
    if (error) throw error
  } else {
    const { error } = await supabase.from('con_admin_perfil').insert([{ ...perfil, admin_id: adminId }])
    if (error) throw error
  }
}
