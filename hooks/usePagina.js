// hooks/usePagina.js — Hook de navegación para GASP Consorcios.
// Antes: NAV, secciones y pagina en App() mezclados con lógica de datos.
// Ahora: hook independiente. NAV es la fuente de verdad del menú.

import { useState } from 'react'

export const NAV_ITEMS = [
  { id: 'dashboard',                label: 'Dashboard',               icon: '📊', sec: 'Inicio' },
  { id: 'listado_consorcios',       label: 'Mis Consorcios',          icon: '🏛️', sec: 'Consorcio' },
  { id: 'unidades',                 label: 'Unidades (UFs)',          icon: '🏢', sec: 'Consorcio' },
  { id: 'copropietarios',           label: 'Copropietarios',          icon: '👤', sec: 'Consorcio' },
  { id: 'cta_corriente',            label: 'Cta. corriente UF',      icon: '📋', sec: 'Consorcio' },
  { id: 'reclamos',                 label: 'Reclamos / Tickets',      icon: '🎫', sec: 'Consorcio' },
  { id: 'cert_libre_deuda',         label: 'Certificado Libre Deuda', icon: '📜', sec: 'Consorcio' },
  { id: 'rendicion_cuentas',        label: 'Rendición de cuentas',    icon: '📊', sec: 'Expensas' },
  { id: 'liquidacion',              label: 'Liquidar período',        icon: '📝', sec: 'Expensas' },
  { id: 'expensas',                 label: 'Períodos',                icon: '📅', sec: 'Expensas' },
  { id: 'periodos',                 label: 'Control períodos',        icon: '🔒', sec: 'Expensas' },
  { id: 'historial_liquidaciones',  label: 'Historial Liquidaciones', icon: '📂', sec: 'Expensas' },
  { id: 'cobranzas',                label: 'Cobranzas',               icon: '💳', sec: 'Cobranzas' },
  { id: 'cobranzas_auto',           label: 'Cobranzas automáticas',   icon: '🏦', sec: 'Cobranzas' },
  { id: 'generar_debito',           label: 'Generar débito',          icon: '📤', sec: 'Cobranzas' },
  { id: 'anular_cobranza',          label: 'Anular cobranzas',        icon: '↩️', sec: 'Cobranzas' },
  { id: 'mora_diferencial',         label: 'Interés por mora',        icon: '⚖️', sec: 'Cobranzas' },
  { id: 'morosos',                  label: 'Morosos',                 icon: '⚠️', sec: 'Cobranzas' },
  { id: 'recibos',                  label: 'Recibos de pago',         icon: '🧾', sec: 'Cobranzas' },
  { id: 'proveedores',              label: 'Proveedores',             icon: '🔧', sec: 'Proveedores' },
  { id: 'comprobantes',             label: 'Comprobantes',            icon: '🧾', sec: 'Proveedores' },
  { id: 'pagos_prov',               label: 'Pagos',                   icon: '💸', sec: 'Proveedores' },
  { id: 'cta_proveedor',            label: 'Cta. corriente prov.',    icon: '📊', sec: 'Proveedores' },
  { id: 'sueldos',                  label: 'Sueldos',                 icon: '💼', sec: 'Contabilidad' },
  { id: 'cuentas_banco',            label: 'Cuentas bancarias',       icon: '🏛️', sec: 'Contabilidad' },
  { id: 'mov_entre_cuentas',        label: 'Mov. entre cuentas',      icon: '↔️', sec: 'Contabilidad' },
  { id: 'mov_varios',               label: 'Movimientos varios',      icon: '🔄', sec: 'Contabilidad' },
  { id: 'movimientos',              label: 'Notas Déb/Cré UF',       icon: '↕️', sec: 'Contabilidad' },
  { id: 'reporte_movimientos',      label: 'Movim. por período',      icon: '📈', sec: 'Reportes' },
  { id: 'estado_financiero',        label: 'Estado financiero',       icon: '🏦', sec: 'Reportes' },
  { id: 'balance_anual',            label: 'Balance Anual',           icon: '📊', sec: 'Reportes' },
  { id: 'asambleas',                label: 'Asambleas',               icon: '🏛',  sec: 'Comunicaciones' },
  { id: 'emails',                   label: 'Enviar liquidación',      icon: '✉️', sec: 'Comunicaciones' },
  { id: 'notificacion',             label: 'Enviar notificación',     icon: '📣', sec: 'Comunicaciones' },
  { id: 'consultar_enviados',       label: 'Consultar enviados',      icon: '📂', sec: 'Comunicaciones' },
  { id: 'email_tracking',           label: 'Seguimiento liquidaciones',icon: '📬', sec: 'Comunicaciones' },
  { id: 'agenda_venc',              label: 'Agenda vencimientos',     icon: '📅', sec: 'Comunicaciones' },
  { id: 'plan_cuentas',             label: 'Plan de cuentas',         icon: '📑', sec: 'Configuración' },
  { id: 'grupos_liquidacion',       label: 'Grupos de liquidación',   icon: '🗂️', sec: 'Configuración' },
  { id: 'importar',                 label: 'Importar datos',          icon: '📥', sec: 'Configuración' },
  { id: 'importar_pdf',             label: 'Migrar desde PDF (IA)',    icon: '🤖', sec: 'Configuración' },
  { id: 'equipo',                   label: 'Equipo',                  icon: '👥', sec: 'Configuración' },
  { id: 'perfil',                   label: 'Mi perfil',               icon: '⚙️', sec: 'Configuración' },
]

export const NAV_SUPERADMIN = { id: 'clientes', label: 'Clientes GASP', icon: '🏢', sec: 'Configuración' }

export function usePagina(esSuperAdmin = false) {
  const [pagina, setPagina]           = useState('dashboard')
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [isMobile, setIsMobile]       = useState(false)

  const navItems  = esSuperAdmin ? [...NAV_ITEMS, NAV_SUPERADMIN] : NAV_ITEMS
  const secciones = [...new Set(navItems.map(n => n.sec))]
  const navActivo = navItems.find(n => n.id === pagina)

  return { pagina, setPagina, menuAbierto, setMenuAbierto, isMobile, setIsMobile, navItems, secciones, navActivo }
}
