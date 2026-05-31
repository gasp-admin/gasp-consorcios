// hooks/useConsorcio.js — Estado del consorcio activo para GASP Consorcios.
// Antes: estado y funciones en App() con prop drilling a 40+ módulos.
// Ahora: hook independiente. Los módulos consumen useApp().

import { useState, useCallback } from 'react'
import { getConsorcios, getUnidades, getCopropietarios, getExpensas, getProveedores, getAdminPerfil, saveConsorcio as apiSaveConsorcio } from '../api/index'

export function useConsorcio(session) {
  const [consorcios, setConsorcios]             = useState([])
  const [consorcioActivo, setConsorcioActivo]   = useState(null)
  const [unidades, setUnidades]                 = useState([])
  const [copropietarios, setCopropietarios]     = useState([])
  const [expensas, setExpensas]                 = useState([])
  const [proveedores, setProveedores]           = useState([])
  const [adminPerfil, setAdminPerfil]           = useState({})
  const [formCon, setFormCon]                   = useState(null)
  const [msgCon, setMsgCon]                     = useState(null)

  const cargarConsorcio = useCallback(async (cid, uid) => {
    if (!cid || !uid) return
    const [u, cp, exp, prov] = await Promise.all([getUnidades(uid, cid), getCopropietarios(uid, cid), getExpensas(uid, cid), getProveedores(uid, cid)])
    setUnidades(u); setCopropietarios(cp); setExpensas(exp); setProveedores(prov)
  }, [])

  const cargarConsorcios = useCallback(async (uid, setCargando) => {
    if (!uid) return
    if (setCargando) setCargando(true)
    try {
      const cons = await getConsorcios(uid)
      setConsorcios(cons)
      if (cons.length > 0 && !consorcioActivo) {
        setConsorcioActivo(cons[0])
        await cargarConsorcio(cons[0].id, uid)
      }
      const perfil = await getAdminPerfil(uid)
      setAdminPerfil(perfil)
    } finally {
      if (setCargando) setCargando(false)
    }
  }, [consorcioActivo, cargarConsorcio])

  async function guardarConsorcio() {
    if (!formCon?.nombre) { setMsgCon({ tipo: 'warn', texto: 'El nombre es obligatorio' }); return }
    await apiSaveConsorcio(formCon, session?.user?.id)
    setFormCon(null)
    setMsgCon({ tipo: 'ok', texto: '✓ Consorcio guardado' })
    await cargarConsorcios(session?.user?.id, null)
  }

  return { consorcios, setConsorcios, consorcioActivo, setConsorcioActivo, unidades, setUnidades, copropietarios, setCopropietarios, expensas, setExpensas, proveedores, adminPerfil, setAdminPerfil, formCon, setFormCon, msgCon, setMsgCon, cargarConsorcio, cargarConsorcios, guardarConsorcio }
}
