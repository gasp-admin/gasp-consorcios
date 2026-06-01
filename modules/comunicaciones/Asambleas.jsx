// modules — Asambleas.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, enviarNotificacion, generarActaAsamblea, extraerPdfIA, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function Asambleas({
  const { session, consorcioActivo, unidades, copropietarios, expensas } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id session, consorcioId, consorcioActivo, unidades, copropietarios, expensas }
