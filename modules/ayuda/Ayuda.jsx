// modules/ayuda/Ayuda.jsx
// Centro de Ayuda — Manual de uso, FAQ, novedades y soporte
// GASP Consorcios v1.0

import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import { AZ, VD, RJ, AM, GR } from '../../lib/config'

// ── Contenido ─────────────────────────────────────────────────────────────────

const SECCIONES = [
  {
    id: 'inicio',
    icon: '🚀',
    titulo: 'Primeros pasos',
    items: [
      {
        p: '¿Cómo empiezo a usar GASP Consorcios?',
        r: `1. Ingresá con tu email y contraseña en consorcios.administracionpinamar.com.\n2. Seleccioná el consorcio con el que querés trabajar desde el selector superior.\n3. El Dashboard mostrará los KPIs y vencimientos del consorcio activo.\n4. Desde el menú lateral accedés a todos los módulos.`,
      },
      {
        p: '¿Cómo selecciono un consorcio?',
        r: `En la parte superior de la pantalla hay un selector desplegable con los 26 consorcios habilitados. Hacé click y elegí el consorcio. Todos los módulos trabajan sobre el consorcio seleccionado.`,
      },
      {
        p: '¿Puedo instalar GASP Consorcios en el celular?',
        r: `Sí. GASP Consorcios es una PWA (Progressive Web App). En el navegador de tu celular, abrí el menú y elegí "Agregar a pantalla de inicio". Funciona como una app nativa sin necesidad de instalar desde una tienda.`,
      },
      {
        p: '¿Cómo salgo del sistema?',
        r: `Usá el botón "Cerrar sesión" en la parte inferior del menú lateral. La sesión se mantiene activa automáticamente para que no tengas que volver a ingresar en cada visita.`,
      },
    ],
  },
  {
    id: 'consorcios',
    icon: '🏢',
    titulo: 'Gestión de Consorcios',
    items: [
      {
        p: '¿Cómo cargo o actualizo los datos de un consorcio?',
        r: `Menú → Consorcio → ✏️ Ficha del consorcio. Allí podés editar razón social, domicilio, datos bancarios, póliza de seguro (número, aseguradora, fechas), reglamento de copropiedad y configuración de expensas. Los datos de póliza aparecen automáticamente en la Agenda de Vencimientos.`,
      },
      {
        p: '¿Cómo gestiono las unidades funcionales?',
        r: `Menú → Consorcio → Unidades. Podés crear, editar y dar de baja UFs. Cada UF tiene número, propietario asignado, coeficiente y número de UF del PDF (nro_uf_pdf) que se usa para importar liquidaciones.`,
      },
      {
        p: '¿Cómo asigno copropietarios a las unidades?',
        r: `Menú → Consorcio → Copropietarios. Creá el copropietario con sus datos (nombre, DNI/CUIT, email, teléfono, CBU). Luego en la UF correspondiente asignalo desde el campo "Propietario".`,
      },
      {
        p: '¿Qué es el modelo de cuentas corrientes?',
        r: `Cada consorcio importado con PDF histórico usa el modelo "histórico". Esto significa que las cuentas corrientes se calculan a partir del estado financiero del PDF de Mis Expensas. El portal del copropietario muestra el saldo neto correctamente.`,
      },
    ],
  },
  {
    id: 'expensas',
    icon: '📋',
    titulo: 'Liquidaciones y Expensas',
    items: [
      {
        p: '¿Cómo importo una liquidación desde PDF?',
        r: `Menú → Expensas → Importar historial PDF.\n1. Seleccioná el consorcio.\n2. Subí el PDF de Mis Expensas.\n3. El sistema procesa automáticamente el estado financiero y el prorrateo de cada UF.\n4. Verificá los resultados en la pantalla de revisión.\n5. Confirmá la importación.\n\nNota: el PDF debe ser de Mis Expensas (formato estándar). Para formatos especiales como Caracol, Maromar XI o Torre Punta Médanos, el sistema tiene configurado el formato correspondiente.`,
      },
      {
        p: '¿Qué hago si una importación da diferencias aritméticas?',
        r: `Si aparecen UFs con diferencias > $0,50 en el reporte de importación:\n• Verificá que el PDF no esté corrupto o sea escaneado.\n• Comprobá que las UFs existen en el sistema con el nro_uf_pdf correcto.\n• Si son UFs nuevas, créalas primero en el módulo Unidades.\n• Volvé a importar. El sistema reemplaza los datos anteriores sin duplicar.`,
      },
      {
        p: '¿Qué significa "Ajuste de liquidación" en la cuenta corriente?',
        r: `El "Ajuste de liquidación" es una línea de convergencia que el sistema genera automáticamente cuando hay diferencia entre los movimientos históricos y el total del PDF. Esto ocurre en consorcios donde el saldo anterior ya venía acumulado de Mis Expensas (el sistema no tiene datos de períodos anteriores al importado). Es normal y no representa un error: el saldo final siempre coincide con el total_uf del PDF.`,
      },
      {
        p: '¿Cómo veo la cuenta corriente de una unidad?',
        r: `Menú → Expensas → Cuenta corriente (o desde el Dashboard → Cta. Cte.). Seleccioná la UF. Verás el detalle completo: débitos, créditos, saldo actual y estado (pagada/pendiente).`,
      },
      {
        p: '¿Cómo genero una nueva liquidación mensual?',
        r: `Menú → Expensas → Nueva liquidación. Completá el período, los grupos de gastos y los items. El sistema calcula el prorrateo por coeficiente. Podés exportar a PDF o enviar por email a los copropietarios.`,
      },
    ],
  },
  {
    id: 'cobranzas',
    icon: '💳',
    titulo: 'Cobranzas y Pagos',
    items: [
      {
        p: '¿Cómo registro un pago de expensas?',
        r: `Menú → Cobranzas → Registrar cobro. Seleccioná la UF, el período, el monto y el medio de pago (efectivo, transferencia, cheque). El sistema acredita automáticamente en la cuenta corriente con la leyenda "Pago Exp. [Mes Año]".`,
      },
      {
        p: '¿Cómo importo un archivo de cobranzas SIRO?',
        r: `Menú → Cobranzas → Importar cobranzas automáticas.\n• Sistema: "SIRO — Transferencias bancarias (TransferenciasSiro)" para archivos TransferenciasSiro_*.txt\n• Sistema: "SIRO Roela — Multi-consorcio" para archivos CobranzasSiro_*.txt\nEl sistema detecta automáticamente las UFs por el código CPE y los importes. Revisá el listado de imputaciones antes de confirmar.`,
      },
      {
        p: '¿Qué es el archivo CobranzasSiro vs TransferenciasSiro?',
        r: `• **CobranzasSiro**: rendición de cobranzas por SIRO/Roela. Formato 125 chars. CPE en pos 40-42 (3 dígitos = número de UF). Importe en pos 24-34 (/100).\n• **TransferenciasSiro**: transferencias bancarias procesadas por SIRO. Formato 120 chars. Importe en pos 16-25 (10 dígitos /100). UF detectada por campo "UFn" en la referencia.`,
      },
      {
        p: 'Registré una cobranza pero no aparece en la cuenta corriente',
        r: `Verificá que:\n1. El estado de la cobranza sea "acreditado" (no "pendiente" o "vigente").\n2. La cobranza tenga unidad_id asignada (no nula).\n3. El período de la cobranza coincida con el de la liquidación.\nSi el problema persiste, la cobranza puede haberse guardado con un estado inválido. Reportalo al soporte con el número de cobranza.`,
      },
      {
        p: '¿Cómo veo los morosos?',
        r: `Menú → Cobranzas → Morosos. Muestra todas las UFs con saldo deudor, días de mora y monto adeudado. Podés filtrar por consorcio y exportar a Excel o PDF para gestionar intimaciones.`,
      },
    ],
  },
  {
    id: 'portal',
    icon: '👤',
    titulo: 'Portal del Copropietario',
    items: [
      {
        p: '¿Cómo accede un copropietario a su portal?',
        r: `Cada copropietario accede en:\nconsorcios.administracionpinamar.com/portal\nIngresa con su email. Si no tiene contraseña, usa "Olvidé mi contraseña" para generarla. El sistema le muestra su consorcio, unidad, estado de deuda y cuenta corriente.`,
      },
      {
        p: '¿Qué ve el copropietario en su portal?',
        r: `• Estado de cuenta: Al día / Debe $X\n• Último pago registrado\n• Cuenta corriente con todos los movimientos\n• Pestaña Expensas: historial de liquidaciones\n• Pestaña Pagos: cobros registrados\n• Pestaña Informar pago: para notificar transferencias\n• Documentación del consorcio: reglamento, actas, liquidaciones históricas`,
      },
      {
        p: '¿Por qué el portal muestra "Al día" cuando hay deuda?',
        r: `Esto puede ocurrir si el campo "monto" en la tabla de detalles no coincide con el total real (total_uf). El sistema fue corregido en junio 2026 para que monto = total_uf en todos los casos. Si ves esta inconsistencia, reportalo con el nombre del consorcio y número de UF.`,
      },
      {
        p: '¿Cómo genero el acceso para un copropietario nuevo?',
        r: `Menú → Consorcio → Copropietarios → seleccioná el copropietario → botón "Enviar acceso al portal". El sistema genera un email con el link de activación. El copropietario elige su contraseña.`,
      },
    ],
  },
  {
    id: 'vencimientos',
    icon: '📅',
    titulo: 'Agenda de Vencimientos',
    items: [
      {
        p: '¿Cómo agrego un vencimiento a la agenda?',
        r: `Menú → Comunicaciones → Agenda de vencimientos → ＋ Agregar. Completá tipo (póliza, ART, impuesto, asamblea, etc.), descripción, consorcio, fecha y opcionalmente fechas de aviso y monto. Podés marcarlo como recurrente con frecuencia en días.`,
      },
      {
        p: '¿Por qué las pólizas aparecen automáticamente?',
        r: `Si cargaste la fecha de vencimiento en la Ficha del Consorcio (campo "Vencimiento póliza"), el sistema la incluye automáticamente en la agenda. Lo mismo para ART y seguros de proveedores si tienen fecha cargada en el módulo Proveedores.`,
      },
      {
        p: '¿Cómo actualizo la fecha de una póliza vencida?',
        r: `Desde la Agenda de Vencimientos, hacé click en "✏️ Actualizar ficha" en el ítem correspondiente. El sistema cambia automáticamente al consorcio indicado y abre la Ficha para que actualices la fecha. Luego guardá los cambios.`,
      },
      {
        p: '¿Cómo marco un vencimiento como cumplido?',
        r: `En la lista de vencimientos, cada ítem manual tiene el botón "✓ Cumplido". Al marcarlo, se archiva y deja de aparecer en la lista activa. Los vencimientos automáticos (pólizas, ART) solo se actualizan editando la fecha en la ficha correspondiente.`,
      },
    ],
  },
  {
    id: 'configuracion',
    icon: '⚙️',
    titulo: 'Configuración',
    items: [
      {
        p: '¿Cómo configuro el formato de liquidación de un consorcio?',
        r: `Menú → Configuración → Formato de liquidación. Cada consorcio tiene un formato según el PDF de Mis Expensas: standard, con_subtotal, cazon, etc. El sistema detecta automáticamente el formato pero podés cambiarlo manualmente si hay errores de importación.`,
      },
      {
        p: '¿Cómo configuro las cuentas bancarias?',
        r: `Menú → Consorcio → Ficha del consorcio → sección "Datos bancarios". Ingresá el banco, CBU y número de cuenta del consorcio. Estos datos aparecen en las liquidaciones y certificados de libre deuda.`,
      },
      {
        p: '¿Cómo agrego o edito proveedores?',
        r: `Menú → Proveedores → Gestión de proveedores. Podés cargar CUIT, razón social, rubro, teléfono, email, CBU y fechas de vencimiento de ART y seguro (estas últimas aparecen en la Agenda de Vencimientos automáticamente).`,
      },
    ],
  },
  {
    id: 'tecnico',
    icon: '🔧',
    titulo: 'Aspectos técnicos',
    items: [
      {
        p: '¿Qué navegadores son compatibles?',
        r: `Chrome 90+, Edge 90+, Firefox 88+, Safari 14+. Para la mejor experiencia se recomienda Chrome. Internet Explorer no es compatible.`,
      },
      {
        p: '¿Los datos están seguros?',
        r: `Sí. GASP Consorcios usa Supabase (PostgreSQL en la nube con Row Level Security). Cada usuario solo accede a sus propios datos. Las conexiones usan HTTPS/TLS. Los backups se realizan automáticamente.`,
      },
      {
        p: '¿Puedo trabajar sin conexión a internet?',
        r: `La app requiere conexión para sincronizar datos con la base de datos. Como PWA, puede mostrar la última versión cacheada de la interfaz sin conexión, pero no podrás guardar cambios hasta reconectarte.`,
      },
      {
        p: '¿Con qué frecuencia se actualiza el sistema?',
        r: `GASP Consorcios se actualiza continuamente. Las actualizaciones se despliegan automáticamente sin que debas hacer nada. Si detectás algún comportamiento diferente al esperado después de una actualización, podés reportarlo al soporte.`,
      },
    ],
  },
]

const NOVEDADES = [
  { fecha: 'Junio 2026', items: [
    'Módulo de Ayuda y Centro de Soporte (este módulo)',
    'Agenda de Vencimientos en Dashboard con widget de próximos vencimientos',
    'Botón ✏️ Actualizar ficha desde la agenda navega al consorcio correcto',
    'Cobranzas automáticas: nuevo sistema TransferenciasSiro (archivos bancarios)',
    'Corrección masiva de cuentas corrientes — 0 saldos incorrectos en 906 UFs',
    'Auditoría integral de saldos: 4 patrones de error detectados y corregidos',
  ]},
  { fecha: 'Mayo 2026', items: [
    'Importación masiva de liquidaciones PDF para 26 consorcios (906 UFs)',
    'Portal del Copropietario con cuenta corriente, expensas y documentación',
    'Módulo de Cobranzas Automáticas (SIRO Multi-consorcio, Expensas Pagas)',
    'Ficha del Consorcio con datos de póliza, seguro y configuración',
    'Agenda de Vencimientos en Comunicaciones con vistas lista y calendario',
    'Certificado de Libre Deuda automático',
    '0 diferencias aritméticas en todas las importaciones de liquidaciones',
  ]},
]

// ── Componente principal ──────────────────────────────────────────────────────
export default function Ayuda() {
  const [tab, setTab]         = useState('faq')       // faq | manual | novedades | soporte
  const [secActiva, setSecActiva] = useState(null)
  const [itemAbierto, setItemAbierto] = useState(null)
  const [busqueda, setBusqueda] = useState('')

  // Búsqueda global en FAQ
  const resultadosBusqueda = busqueda.trim().length > 1
    ? SECCIONES.flatMap(s => s.items
        .filter(i => i.p.toLowerCase().includes(busqueda.toLowerCase()) || i.r.toLowerCase().includes(busqueda.toLowerCase()))
        .map(i => ({ ...i, secIcon: s.icon, secTitulo: s.titulo }))
      )
    : []

  const BTN_TAB = (id, label, icon) => (
    <button key={id} onClick={() => setTab(id)}
      style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        borderRadius: 8, border: '1px solid',
        borderColor: tab === id ? AZ : '#d1d5db',
        background: tab === id ? AZ : '#fff',
        color: tab === id ? '#fff' : '#374151' }}>
      {icon} {label}
    </button>
  )

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 0 60px' }}>

      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${AZ} 0%, #1e4db7 100%)`,
        borderRadius: 14, padding: '24px 28px', marginBottom: 24, color: '#fff' }}>
        <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>
          ❓ Centro de Ayuda
        </div>
        <div style={{ fontSize: 14, opacity: 0.85 }}>
          GASP Consorcios · Administración Pinamar · Javier García Pérez RPAC N° 83
        </div>
        <div style={{ marginTop: 16 }}>
          <input
            placeholder="🔍 Buscar en toda la documentación..."
            value={busqueda}
            onChange={e => { setBusqueda(e.target.value); setTab('faq') }}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8,
              border: 'none', fontSize: 14, boxSizing: 'border-box',
              outline: 'none', color: '#111827' }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {BTN_TAB('faq',       'Preguntas frecuentes', '❓')}
        {BTN_TAB('manual',    'Manual por módulo',    '📖')}
        {BTN_TAB('novedades', 'Novedades',            '🆕')}
        {BTN_TAB('soporte',   'Soporte',              '💬')}
      </div>

      {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
      {tab === 'faq' && (
        <div>
          {/* Resultados de búsqueda */}
          {busqueda.trim().length > 1 ? (
            <div>
              <div style={{ fontSize: 13, color: GR, marginBottom: 12 }}>
                {resultadosBusqueda.length} resultado{resultadosBusqueda.length !== 1 ? 's' : ''} para "{busqueda}"
              </div>
              {resultadosBusqueda.length === 0 ? (
                <div style={{ background: '#f9fafb', borderRadius: 10, padding: 24,
                  textAlign: 'center', color: GR, fontSize: 14 }}>
                  No se encontraron resultados. Intentá con otras palabras o consultá al soporte.
                </div>
              ) : (
                resultadosBusqueda.map((item, i) => (
                  <ItemFAQ key={i} item={item} idx={'b'+i}
                    abierto={itemAbierto === 'b'+i}
                    toggle={() => setItemAbierto(itemAbierto === 'b'+i ? null : 'b'+i)}
                    prefijo={item.secIcon + ' ' + item.secTitulo + ' — '} />
                ))
              )}
            </div>
          ) : (
            /* Categorías */
            <div>
              {/* Grid de categorías */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 24 }}>
                {SECCIONES.map(s => (
                  <button key={s.id} onClick={() => setSecActiva(secActiva === s.id ? null : s.id)}
                    style={{ padding: '14px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                      border: '1px solid', borderColor: secActiva === s.id ? AZ : '#e5e7eb',
                      background: secActiva === s.id ? '#f0f4ff' : '#fff',
                      color: secActiva === s.id ? AZ : '#374151' }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{s.titulo}</div>
                    <div style={{ fontSize: 11, color: GR, marginTop: 2 }}>{s.items.length} preguntas</div>
                  </button>
                ))}
              </div>

              {/* Items de la sección activa o todas */}
              {(secActiva ? SECCIONES.filter(s => s.id === secActiva) : SECCIONES).map(s => (
                <div key={s.id} style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: AZ, marginBottom: 10,
                    display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{s.icon}</span> {s.titulo}
                  </div>
                  {s.items.map((item, i) => (
                    <ItemFAQ key={i} item={item} idx={s.id+i}
                      abierto={itemAbierto === s.id+i}
                      toggle={() => setItemAbierto(itemAbierto === s.id+i ? null : s.id+i)} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MANUAL ──────────────────────────────────────────────────────────── */}
      {tab === 'manual' && (
        <div>
          <div style={{ background: '#f0f4ff', borderRadius: 10, padding: '14px 18px', marginBottom: 20,
            fontSize: 13, color: '#374151', border: '1px solid #c0cfe8' }}>
            💡 El manual describe el funcionamiento de cada sección. Para ver el manual completo en PDF,
            descargalo desde el botón de abajo.
          </div>
          {SECCIONES.map(s => (
            <div key={s.id} style={{ marginBottom: 20, background: '#fff', borderRadius: 10,
              border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div onClick={() => setSecActiva(secActiva === s.id ? null : s.id)}
                style={{ padding: '14px 18px', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', cursor: 'pointer',
                  background: secActiva === s.id ? '#f0f4ff' : '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{s.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: AZ }}>{s.titulo}</span>
                  <span style={{ fontSize: 11, color: GR }}>· {s.items.length} temas</span>
                </div>
                <span style={{ color: GR }}>{secActiva === s.id ? '▲' : '▼'}</span>
              </div>
              {secActiva === s.id && (
                <div style={{ padding: '4px 18px 16px', borderTop: '1px solid #e5e7eb' }}>
                  {s.items.map((item, i) => (
                    <ItemFAQ key={i} item={item} idx={'m'+s.id+i}
                      abierto={itemAbierto === 'm'+s.id+i}
                      toggle={() => setItemAbierto(itemAbierto === 'm'+s.id+i ? null : 'm'+s.id+i)} />
                  ))}
                </div>
              )}
            </div>
          ))}
          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <a href="https://drive.google.com/drive/folders/1EXlLiRq6G43qzwLvLGR_UkM-TB9BeH58"
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', padding: '10px 24px', background: AZ,
                color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
              📄 Ver documentación completa en Drive
            </a>
          </div>
        </div>
      )}

      {/* ── NOVEDADES ───────────────────────────────────────────────────────── */}
      {tab === 'novedades' && (
        <div>
          {NOVEDADES.map((n, ni) => (
            <div key={ni} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: AZ, marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ background: ni === 0 ? '#dcfce7' : '#f3f4f6',
                  color: ni === 0 ? VD : GR, padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                  {ni === 0 ? '🆕 ' : ''}{n.fecha}
                </span>
              </div>
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                {n.items.map((item, i) => (
                  <div key={i} style={{ padding: '10px 16px', fontSize: 13, color: '#374151',
                    borderBottom: i < n.items.length - 1 ? '1px solid #f3f4f6' : 'none',
                    display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: ni === 0 ? VD : GR, flexShrink: 0, marginTop: 1 }}>
                      {ni === 0 ? '✅' : '·'}
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── SOPORTE ─────────────────────────────────────────────────────────── */}
      {tab === 'soporte' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            {[
              { icon: '✉️', titulo: 'Email', desc: 'admconspinamar@gmail.com', link: 'mailto:admconspinamar@gmail.com', label: 'Enviar email' },
              { icon: '💬', titulo: 'WhatsApp', desc: '+54 9 2254 60-0000', link: 'https://wa.me/5492254600000', label: 'Abrir WhatsApp' },
              { icon: '🌐', titulo: 'Sitio web', desc: 'administracionpinamar.com', link: 'https://administracionpinamar.com', label: 'Visitar sitio' },
              { icon: '📍', titulo: 'Oficina', desc: 'Júpiter 49 Local 1, Pinamar', link: 'https://maps.google.com/?q=Jupiter+49+Pinamar', label: 'Ver en mapa' },
            ].map((c, i) => (
              <a key={i} href={c.link} target="_blank" rel="noopener noreferrer"
                style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
                  padding: '16px 18px', textDecoration: 'none', color: '#111827',
                  display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 22 }}>{c.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: AZ }}>{c.titulo}</span>
                <span style={{ fontSize: 12, color: GR }}>{c.desc}</span>
                <span style={{ fontSize: 11, color: AZ, marginTop: 4, fontWeight: 600 }}>{c.label} →</span>
              </a>
            ))}
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: AZ, marginBottom: 12 }}>
              📋 Información para reportar un problema
            </div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
              Al reportar un error, incluí:<br />
              • <strong>Consorcio afectado</strong> (ej: EDIF. GULLIVER)<br />
              • <strong>Unidad funcional</strong> si aplica (ej: 2do 3)<br />
              • <strong>Módulo</strong> donde ocurre (ej: Cobranzas automáticas)<br />
              • <strong>Descripción</strong> del comportamiento esperado vs lo que ocurre<br />
              • <strong>Captura de pantalla</strong> si es posible
            </div>
          </div>

          <div style={{ marginTop: 16, background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 10, padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: VD, marginBottom: 4 }}>
              ✅ Versión del sistema
            </div>
            <div style={{ fontSize: 12, color: '#374151' }}>
              GASP Consorcios v1.0 · Junio 2026<br />
              26 consorcios · 906 unidades funcionales<br />
              Supabase + Next.js 13.5.6 + Vercel
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-componente ItemFAQ ────────────────────────────────────────────────────
function ItemFAQ({ item, idx, abierto, toggle, prefijo = '' }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <button onClick={toggle}
        style={{ width: '100%', textAlign: 'left', padding: '12px 16px', background: abierto ? '#f0f4ff' : '#fff',
          border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', gap: 10, fontSize: 13, fontWeight: 600, color: '#111827' }}>
        <span>{prefijo}{item.p}</span>
        <span style={{ color: '#6B7280', flexShrink: 0, fontSize: 11, marginTop: 2 }}>
          {abierto ? '▲' : '▼'}
        </span>
      </button>
      {abierto && (
        <div style={{ padding: '12px 16px', background: '#f9fafb', borderTop: '1px solid #e5e7eb',
          fontSize: 13, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
          {item.r}
        </div>
      )}
    </div>
  )
}
