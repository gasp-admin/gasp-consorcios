// modules — CertificadoLibreDeuda.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { SUPA_URL, AZ, AZ2, VD, RJ, AM, GR, BG, SUPERADMIN } from '../../lib/config'
import { fmt, fmtD, fmtN, periodoLabel, periodoActual, nextId, colGasto } from '../../lib/formatters'
import { exportarExcel } from '../../lib/exportExcel'
import { exportarPDF, generarPDFLiquidacion } from '../../lib/exportPdf'
import { getCuentaCorriente, siroProxy, enviarLiquidacion, generarCertificadoLibreDeuda, gestionarClienteGASP, crearDemoConsorcios } from '../../api/edgeFunctions'
import { Btn, BtnSec, Card, Input, Sel, Badge, Msg, BarraListado } from '../../components/ui'

export default function CertificadoLibreDeuda({
  const { session, consorcioActivo, unidades, copropietarios, expensas, adminPerfil } = useApp()
  const uid = session?.user?.id
  const consorcioId = consorcioActivo?.id session, consorcioId, consorcioActivo, unidades, copropietarios, expensas }
