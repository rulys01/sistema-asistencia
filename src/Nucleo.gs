/* ============================================================================
 *  NÚCLEO: utilidades, configuración, sesión, permisos y alcance de datos
 * ========================================================================== */

/* =============================== UTILIDADES ================================ */

const uid_ = p => p + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
const bool_ = v => v === true || ['TRUE', '1', 'SI', 'SÍ'].indexOf(String(v).toUpperCase()) >= 0;
const norm_ = v => String(v == null ? '' : v).trim().toUpperCase();
const xround_ = (x, d) => { const f = Math.pow(10, d || 0); return Math.round(x * f + 1e-9) / f; };   // ROUND de Excel
const num_ = (v, max) => { const n = Number(v); return (v === '' || v == null || isNaN(n)) ? 0 : Math.max(0, Math.min(max, n)); };
const esTodo_ = u => norm_(u.Rol) === 'ADMIN' || String(u.DocenteID) === '*';
const emailValido_ = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());
const escH_ = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Código numérico aleatorio (usa UUID del sistema en lugar de Math.random). */
function codigoSeguro_(n) {
  let s = '';
  while (s.length < n) {
    const h = Utilities.getUuid().replace(/-/g, '');
    for (let i = 0; i < h.length - 1 && s.length < n; i += 2) s += String(parseInt(h.substr(i, 2), 16) % 10);
  }
  return s;
}
const claveAleatoria_ = () => codigoSeguro_(6);

function hash_(pass, salt) {
  let h = salt + pass;
  for (let i = 0; i < APP.HASH_VUELTAS; i++)
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  return h;
}

/* =============================== CONFIGURACIÓN ============================= */

function config_() { const o = {}; leer_('Config').forEach(r => o[r.Clave] = r.Valor); return o; }
function setConfig_(obj) {
  const filas = leer_('Config');
  Object.keys(obj).forEach(k => {
    const f = filas.find(r => r.Clave === k);
    if (f) actualizar_('Config', f._fila, { Valor: obj[k] }); else agregar_('Config', { Clave: k, Valor: obj[k] });
  });
}
const cicloActual_ = () => String(config_().CICLO || '').trim();
const cicloInsc_ = () => cicloActual_() || 'SIN-CICLO';
const cicloDe_ = c => String(c.Ciclo || '').trim() || cicloInsc_();

function cfgNum_(cfg, k, def) { const v = parseFloat(cfg[k]); return isNaN(v) ? def : v; }
/** Fracción de asistencia que vale cada estado (retardo, justificada, permiso). */
function pesosAs_(cfg) {
  cfg = cfg || config_();
  const f = (k, d) => Math.max(0, Math.min(1, cfgNum_(cfg, k, d)));
  return { R: f('PESO_RETARDO', PESOS_AS_DEF.R), J: f('PESO_JUSTIFICADA', PESOS_AS_DEF.J), PM: f('PESO_PERMISO', PESOS_AS_DEF.PM) };
}
function cfgPublica_(c) {
  return { INSTITUCION: c.INSTITUCION, ENCABEZADO2: c.ENCABEZADO2, CCT: c.CCT, CICLO: c.CICLO, DIRECTOR: c.DIRECTOR,
           UMBRAL_ASIS: cfgNum_(c, 'UMBRAL_ASIS', 80), PESO_RETARDO: cfgNum_(c, 'PESO_RETARDO', 0.5),
           PESO_JUSTIFICADA: cfgNum_(c, 'PESO_JUSTIFICADA', 1), PESO_PERMISO: cfgNum_(c, 'PESO_PERMISO', 1),
           RESPALDOS_MAX: cfgNum_(c, 'RESPALDOS_MAX', 14), BITACORA_DIAS: cfgNum_(c, 'BITACORA_DIAS', 365) };
}
function logoUri_() {
  const cache = CacheService.getScriptCache(), c = cache.get('LOGO');
  if (c) return c;
  const id = config_().LOGO_ID;
  if (!id) return '';
  try {
    const b = DriveApp.getFileById(id).getBlob();
    const uri = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    if (uri.length < 95000) cache.put('LOGO', uri, 3600);
    return uri;
  } catch (e) { return ''; }
}

/* =============================== ESQUEMAS DE EVALUACIÓN ==================== */

function normEsq_(e) {
  e = e || ESQ_DEF_OBJ;
  const n = (v, d) => { const x = Number(v); return (v === '' || v == null || isNaN(x)) ? d : x; };
  return { EsquemaID: e.EsquemaID, Nombre: e.Nombre, NumPeriodos: n(e.NumPeriodos, 3) || 3, Parciales: n(e.Parciales, 2) || 2,
           NombrePeriodo: e.NombrePeriodo || 'Trimestre', Aprobatoria: n(e.Aprobatoria, 6), DecFinal: n(e.DecFinal, 1) };
}
function esquemas_() { const l = leer_('Esquemas'); return l.length ? l : [ESQ_DEF_OBJ]; }
function esquemaDe_(c) {
  const id = (c && c.EsquemaID) || ESQ_DEF, l = esquemas_();
  return normEsq_(l.find(x => x.EsquemaID === id) || l[0]);
}

/* =============================== PERMISOS ================================== */

function rolesLista_() {
  const r = { ADMIN: 1 };
  leer_('Permisos').forEach(p => r[norm_(p.Rol)] = 1);
  return Object.keys(r);
}
function permisos_(rol) {
  const p = {}, admin = norm_(rol) === 'ADMIN';
  Object.keys(MODULOS).forEach(m => p[m] = { ver: admin, crear: admin, editar: admin, eliminar: admin });
  if (!admin) leer_('Permisos').filter(r => norm_(r.Rol) === norm_(rol) && p[r.Modulo]).forEach(r => {
    p[r.Modulo] = { ver: bool_(r.Ver), crear: bool_(r.Crear), editar: bool_(r.Editar), eliminar: bool_(r.Eliminar) };
  });
  return p;
}
function exige_(u, mod, perm) {
  const p = permisos_(u.Rol)[mod];
  if (!p || !p[perm]) throw new Error('No tienes permiso para realizar esta operación.');
}

/* =============================== SESIÓN / LOGIN ============================ */

function nuevaSesion_(u, google) {
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('S_' + token, JSON.stringify({ u: u.Usuario, g: google ? 1 : 0, t: Date.now() }), APP.SESION_SEG);
  return token;
}
function sesion_(token) {
  const cache = CacheService.getScriptCache(), raw = token && cache.get('S_' + token);
  if (!raw) throw new Error('SESION_EXPIRADA');
  let s; try { s = JSON.parse(raw); } catch (e) { throw new Error('SESION_EXPIRADA'); }
  const pv = Number(cache.get('PV_' + s.u) || 0);                      // contraseña restablecida después de iniciar sesión
  if (pv && s.t < pv) throw new Error('SESION_EXPIRADA');
  const u = leer_('Usuarios').find(x => x.Usuario === s.u && bool_(x.Activo));
  if (!u) throw new Error('SESION_EXPIRADA');
  cache.put('S_' + token, raw, APP.SESION_SEG);
  return Object.assign({}, u, { _google: !!s.g });
}

/** Público: datos para la pantalla de acceso. */
function infoPublica() {
  const c = config_();
  return { titulo: APP.TITULO, institucion: c.INSTITUCION || '', encabezado2: c.ENCABEZADO2 || '',
           logo: logoUri_(), desarrollador: APP.DESARROLLADOR };
}

/** Público: inicio de sesión del personal con usuario y contraseña. */
function login(usuario, pass) {
  usuario = String(usuario || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache(), kInt = 'INT_' + usuario;
  if (Number(cache.get(kInt) || 0) >= APP.MAX_INTENTOS)
    return { ok: false, error: 'Demasiados intentos fallidos. Intenta de nuevo en 10 minutos.' };
  const u = leer_('Usuarios').find(x => String(x.Usuario).toLowerCase() === usuario);
  if (!u || !bool_(u.Activo) || hash_(String(pass || ''), String(u.Salt)) !== u.Hash) {
    cache.put(kInt, String(Number(cache.get(kInt) || 0) + 1), APP.BLOQUEO_SEG);
    logEvento_(usuario, 'LOGIN_FALLIDO', '');
    return { ok: false, error: 'Usuario o contraseña incorrectos.' };
  }
  cache.remove(kInt);
  logEvento_(u.Usuario, 'LOGIN', '');
  return { ok: true, data: { token: nuevaSesion_(u, false) } };
}

/**
 * Público: inicio de sesión con la cuenta de Google del navegador.
 * Requiere una implementación "Ejecutar como: yo" con acceso "Cualquier usuario de tu dominio" (Workspace),
 * donde Session.getActiveUser() devuelve el correo de quien visita. El correo debe estar capturado en Usuarios.
 */
function loginGoogle() {
  const correo = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!correo) return { ok: false, error: 'No se pudo identificar tu cuenta de Google. Abre la versión del sistema publicada para tu dominio (Workspace) o usa usuario y contraseña.' };
  const cache = CacheService.getScriptCache(), k = 'GINT_' + correo;
  if (Number(cache.get(k) || 0) >= APP.MAX_INTENTOS) return { ok: false, error: 'Demasiados intentos. Intenta de nuevo en 10 minutos.' };
  const u = leer_('Usuarios').find(x => String(x.Correo || '').trim().toLowerCase() === correo && bool_(x.Activo));
  if (!u) {
    cache.put(k, String(Number(cache.get(k) || 0) + 1), APP.BLOQUEO_SEG);
    logEvento_(correo, 'LOGIN_GOOGLE_RECHAZADO', '');
    return { ok: false, error: 'La cuenta ' + correo + ' no está vinculada a ningún usuario activo. Pide al administrador que registre tu correo en el módulo Usuarios.' };
  }
  cache.remove(k);
  logEvento_(u.Usuario, 'LOGIN_GOOGLE', correo);
  return { ok: true, data: { token: nuevaSesion_(u, true) } };
}

/** Público: envía por correo un código de 6 dígitos (vigente 15 min). No revela si el usuario existe. */
function solicitarRecuperacion(usuarioOCorreo) {
  const id = String(usuarioOCorreo || '').trim().toLowerCase(), cache = CacheService.getScriptCache();
  const respuesta = { ok: true, mensaje: 'Si el usuario existe y tiene un correo registrado, recibirás un código de verificación.' };
  if (!id) return { ok: false, error: 'Escribe tu usuario o correo.' };
  const kr = 'REC_' + id, n = Number(cache.get(kr) || 0);
  if (n >= 3) return { ok: false, error: 'Demasiadas solicitudes. Intenta de nuevo en una hora.' };
  cache.put(kr, String(n + 1), 3600);
  const u = leer_('Usuarios').find(x => bool_(x.Activo) && emailValido_(x.Correo) &&
    (String(x.Usuario).toLowerCase() === id || String(x.Correo).trim().toLowerCase() === id));
  if (!u) return respuesta;
  const codigo = codigoSeguro_(6), salt = uid_('r');
  cache.put('RC_' + u.Usuario, JSON.stringify({ h: hash_(codigo, salt), s: salt, n: 0, exp: Date.now() + APP.RECUP_SEG * 1000 }), APP.RECUP_SEG);
  try {
    MailApp.sendEmail({ to: String(u.Correo).trim(), name: config_().INSTITUCION || APP.TITULO,
      subject: 'Código para restablecer tu contraseña',
      htmlBody: '<p>Hola ' + escH_(u.Nombre) + ',</p><p>Tu código de verificación es:</p>' +
        '<p style="font-size:26px;font-weight:bold;letter-spacing:4px">' + codigo + '</p>' +
        '<p>Es válido por 15 minutos. Si no lo solicitaste, ignora este mensaje.</p>' });
    logEvento_(u.Usuario, 'RECUPERACION_SOLICITADA', '');
  } catch (e) { logEvento_(u.Usuario, 'RECUPERACION_ERROR_CORREO', String(e.message).slice(0, 200)); }
  return respuesta;
}

/** Público: valida el código y establece la nueva contraseña. */
function restablecerPassword(usuario, codigo, nueva) {
  usuario = String(usuario || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const u = leer_('Usuarios').find(x => bool_(x.Activo) && (String(x.Usuario).toLowerCase() === usuario ||
    (emailValido_(x.Correo) && String(x.Correo).trim().toLowerCase() === usuario)));
  const malo = { ok: false, error: 'Código incorrecto o vencido.' };
  if (!u) return malo;
  const k = 'RC_' + u.Usuario, raw = cache.get(k);
  if (!raw) return malo;
  const r = JSON.parse(raw);
  if (Date.now() > r.exp) { cache.remove(k); return malo; }
  if (hash_(String(codigo || '').trim(), r.s) !== r.h) {
    r.n++;
    if (r.n >= APP.MAX_INTENTOS) cache.remove(k); else cache.put(k, JSON.stringify(r), Math.max(60, Math.floor((r.exp - Date.now()) / 1000)));
    return malo;
  }
  nueva = String(nueva || '');
  if (nueva.length < 8) return { ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  conBloqueo_(() => {
    const salt = uid_('s');
    actualizar_('Usuarios', u._fila, { Salt: salt, Hash: hash_(nueva, salt), CambiarPass: false });
  });
  cache.remove(k);
  cache.put('PV_' + u.Usuario, String(Date.now()), APP.SESION_SEG);      // cierra las sesiones abiertas
  CacheService.getScriptCache().remove('INT_' + String(u.Usuario).toLowerCase());
  logEvento_(u.Usuario, 'PASSWORD_RESTABLECIDA', 'por correo');
  return { ok: true, mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
}

/* =============================== ALCANCE DE DATOS ========================== */

function claseObj_(a, docs) {
  return { ClaseID: a.ClaseID, DocenteID: a.DocenteID, Docente: (docs || {})[a.DocenteID] || '', Asignatura: a.Asignatura,
           Grado: String(a.Grado), Grupo: String(a.Grupo), Ciclo: cicloDe_(a), Archivada: bool_(a.Archivada),
           EsquemaID: a.EsquemaID || ESQ_DEF, Esquema: esquemaDe_(a) };
}
function clasesDe_(u) {
  const docs = {}; leer_('Docentes').forEach(d => docs[d.DocenteID] = d.Nombre);
  const todo = esTodo_(u);
  return leer_('Asignaciones').filter(a => bool_(a.Activo) && (todo || a.DocenteID === u.DocenteID)).map(a => claseObj_(a, docs));
}
function clase_(u, id) {
  const c = clasesDe_(u).find(x => x.ClaseID === id);
  if (!c) throw new Error('La asignatura seleccionada no está disponible para tu usuario.');
  return c;
}
function exigeEscritura_(c) {
  if (c.Archivada) throw new Error('El ciclo ' + c.Ciclo + ' está archivado: solo lectura. Pide al administrador que lo reabra.');
}
const mismoGrupo_ = (a, b) => norm_(a.Grado) === norm_(b.Grado) && norm_(a.Grupo) === norm_(b.Grupo);
const ordenLista_ = (a, b) => (Number(a.NumLista) || 999) - (Number(b.NumLista) || 999) || String(a.Nombre).localeCompare(String(b.Nombre));

/** Estudiantes inscritos en el ciclo de la clase (historial real vía Inscripciones). */
function estudiantesDe_(c) {
  const ins = leer_('Inscripciones'), ciclo = norm_(cicloDe_(c));
  let lista;
  if (!ins.length) {
    lista = leer_('Estudiantes').filter(e => bool_(e.Activo) && mismoGrupo_(e, c));
  } else {
    const m = {}; leer_('Estudiantes').forEach(e => m[e.EstID] = e);
    lista = ins.filter(i => norm_(i.Ciclo) === ciclo && mismoGrupo_(i, c) && i.Estado !== 'BAJA' && m[i.EstID])
      .map(i => Object.assign({}, m[i.EstID], { NumLista: i.NumLista }));
  }
  return lista.sort(ordenLista_);
}
const estLite_ = e => ({ EstID: e.EstID, NumLista: Number(e.NumLista) || 0, Nombre: e.Nombre, Etiqueta: e.Etiqueta, Matricula: e.Matricula });
function exigePar_(u, grado, grupo) {
  const k = norm_(grado) + '|' + norm_(grupo);
  if (!clasesDe_(u).some(c => norm_(c.Grado) + '|' + norm_(c.Grupo) === k)) throw new Error('No tienes acceso a ese grado y grupo.');
}
function exigeEstudiante_(u, estId) {
  const e = leer_('Estudiantes').find(x => x.EstID === estId);
  if (!e) throw new Error('Estudiante no encontrado.');
  exigePar_(u, e.Grado, e.Grupo);
  return e;
}
function ctx_(u, p) {
  const c = clase_(u, p.ClaseID), esq = c.Esquema, t = Number(p.Trimestre), pa = Number(p.Parcial);
  if (!(t >= 1 && t <= esq.NumPeriodos) || !(pa >= 1 && pa <= esq.Parciales)) throw new Error('Periodo o parcial no válido para el esquema de esta asignatura.');
  return { c: c, t: t, pa: pa, esq: esq };
}
const filtroCtx_ = (c, t, pa) => o => o.ClaseID === c.ClaseID && Number(o.Trimestre) === t && Number(o.Parcial) === pa;

/** Sincroniza la inscripción vigente de cada estudiante (la que coincide con su grado y grupo actuales). */
function sincInsc_(ests) {
  const ins = leer_('Inscripciones'), por = {}, upd = [], nuevas = [];
  ins.forEach(i => (por[i.EstID] = por[i.EstID] || []).push(i));
  ests.forEach(e => {
    const prev = (por[e.EstID] || []).filter(i => mismoGrupo_(i, e)).pop();
    const estado = bool_(e.Activo) ? 'ACTIVA' : (prev && prev.Estado === 'EGRESADO' ? 'EGRESADO' : 'BAJA');
    const o = { Grado: e.Grado, Grupo: e.Grupo, NumLista: e.NumLista, Estado: estado };
    if (prev) upd.push({ fila: prev._fila, obj: o });
    else nuevas.push(Object.assign({ InscID: uid_('I-'), EstID: e.EstID, Ciclo: cicloInsc_() }, o));
  });
  actualizarVarios_('Inscripciones', upd);
  agregarVarios_('Inscripciones', nuevas);
}

/* =============================== AUXILIARES DE ESTUDIANTES ================= */

function matriculaAuto_(grado, grupo, num, existentes) {
  const base = (String(grado).replace(/\D/g, '') || '0') + String(grupo).toUpperCase() + ('0' + num).slice(-2);
  let m = base, i = 1;
  while (existentes.some(e => norm_(e.Matricula) === norm_(m))) m = base + '-' + (i++);
  return m;
}
/** Quita marcas finales como "N.I." o "U" del nombre y las guarda como etiqueta. */
function separarEtiqueta_(txt) {
  let t = String(txt).replace(/\s+/g, ' ').trim(), et = '';
  const m = /\s(N\.?\s?I\.?|U)$/i.exec(t);
  if (m) { et = /^N/i.test(m[1]) ? 'N.I.' : 'U'; t = t.slice(0, m.index).trim(); }
  return { nombre: t.toUpperCase(), etiqueta: et };
}
function importarNombres_(grado, grupo, nombres) {
  const todos = leer_('Estudiantes', true);
  let num = todos.filter(e => !e.Eliminado && mismoGrupo_(e, { Grado: grado, Grupo: grupo }))
                 .reduce((m, e) => Math.max(m, Number(e.NumLista) || 0), 0);
  const filas = [];
  nombres.forEach(n => {
    const s = separarEtiqueta_(n);
    if (!s.nombre) return;
    num++;
    const e = { EstID: uid_('E-'), Clave: claveAleatoria_(), NumLista: num, Nombre: s.nombre, Grado: grado, Grupo: grupo,
                Etiqueta: s.etiqueta, Activo: true };
    e.Matricula = matriculaAuto_(grado, grupo, num, todos.concat(filas));
    filas.push(e);
  });
  agregarVarios_('Estudiantes', filas);
  sincInsc_(filas);
  return filas.length;
}
