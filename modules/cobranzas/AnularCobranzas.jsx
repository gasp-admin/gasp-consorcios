import {{ useState, useEffect, useCallback, useRef }} from 'react'
import {{ useApp }} from '../../context/AppContext'
import {{ supabase }} from '../../lib/supabase'
import {{ SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN }} from '../../lib/config'
import {{ fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto }} from '../../lib/formatters'
import {{ exportarExcel }} from '../../lib/exportExcel'
import {{ exportarPDF, generarPDFLiquidacion }} from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import {{ Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado }} from '../../components/ui'

export default function AnularCobranzas({
  const { session, unidades, copropietarios, expensas, consorcioActivo} = useApp()
  const uid = session?.user?.id session, consorcioId, unidades, copropietarios, expensas }
