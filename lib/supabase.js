// lib/supabase.js
// ═══════════════════════════════════════════════════════════════════
// Instancia única del cliente Supabase para toda la aplicación.
// Antes: createClient() se llamaba en el body global de index.jsx.
// Ahora: se importa desde aquí en cada módulo que lo necesite.
// ═══════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { SUPA_URL, SUPA_KEY } from './config'

export const supabase = createClient(SUPA_URL, SUPA_KEY)
