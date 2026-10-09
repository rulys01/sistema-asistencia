/**
 * ============================================================================
 *  SISTEMA DE REGISTRO DE ASISTENCIA Y CALIFICACIONES
 *  Google Apps Script + Google Sheets (base de datos)
 *  Desarrollador: Mtro. Raúl Dionicio
 * ============================================================================
 *  INSTALACIÓN RÁPIDA
 *  1. Crea una hoja de cálculo de Google (será la base de datos).
 *  2. Extensiones > Apps Script. Pega este archivo como "Code.gs" y crea un
 *     archivo HTML llamado "Index" con el contenido de Index.html.
 *     (Opcional: en Configuración del proyecto activa "Mostrar appsscript.json"
 *      y reemplaza su contenido con el archivo appsscript.json incluido.)
 *  3. Ejecuta la función  instalar()  (acepta los permisos). Crea las hojas,
 *     el rol y los permisos base, y el usuario  admin / Admin2026*
 *  4. (Opcional) Ejecuta  cargarDatosDeEjemplo()  para cargar el grupo del
 *     archivo LISTA_ASISTENCIA_E.xlsx (docente, asignatura y 40 estudiantes).
 *  5. Implementar > Nueva implementación > Aplicación web
 *       Ejecutar como: Yo  |  Quién tiene acceso: Cualquier persona
 *     (necesario para que el módulo de invitado funcione sin cuenta Google;
 *      el acceso del personal se controla con usuario y contraseña propios).
 * ============================================================================
 */

const APP = {
  TITULO: 'Sistema de Asistencia y Calificaciones',
  DESARROLLADOR: 'Mtro. Raúl Dionicio',
  SESION_SEG: 21600,   // 6 horas (máximo permitido por CacheService)
  MAX_INTENTOS: 5,     // intentos fallidos antes de bloquear
  BLOQUEO_SEG: 600,    // 10 minutos
  HASH_VUELTAS: 300
};

/** Estructura de la base de datos: una hoja por entidad. */
const ESQUEMA = {
  Config:         ['Clave', 'Valor'],
  Usuarios:       ['Usuario', 'Nombre', 'Rol', 'DocenteID', 'Salt', 'Hash', 'Activo', 'CambiarPass'],
  Permisos:       ['Rol', 'Modulo', 'Ver', 'Crear', 'Editar', 'Eliminar'],
  Docentes:       ['DocenteID', 'Nombre', 'Correo', 'Activo'],
  Asignaciones:   ['ClaseID', 'DocenteID', 'Asignatura', 'Grado', 'Grupo', 'Ciclo', 'Activo'],
  Estudiantes:    ['EstID', 'Matricula', 'Clave', 'NumLista', 'Nombre', 'Grado', 'Grupo', 'Etiqueta', 'Activo'],
  Periodos:       ['Key', 'ClaseID', 'Trimestre', 'Parcial', 'TotalDias', 'Mes', 'PesoAsistencia'],
  Asistencia:     ['Key', 'ClaseID', 'Trimestre', 'Parcial', 'Fecha', 'EstID', 'Valor'],
  Actividades:    ['ActID', 'ClaseID', 'Trimestre', 'Parcial', 'Nombre', 'Categoria', 'Max', 'Orden'],
  Calificaciones: ['Key', 'ClaseID', 'Trimestre', 'Parcial', 'ActID', 'EstID', 'Valor']
};
/** Columnas que siempre se guardan como texto (evita que Sheets convierta fechas o quite ceros). */
const COLS_TEXTO = ['Key', 'Fecha', 'Matricula', 'Clave', 'Salt', 'Hash', 'Grado', 'Grupo', 'Mes', 'Ciclo',
                    'Usuario', 'ClaseID', 'EstID', 'ActID', 'DocenteID'];

const MODULOS = {
  docentes: 'Docentes y asignaturas', estudiantes: 'Estudiantes', asistencia: 'Asistencia',
  actividades: 'Actividades y calificaciones', reportes: 'Reportes',
  usuarios: 'Usuarios', permisos: 'Permisos', config: 'Configuración'
};
/** Permisos base por rol: v=ver, c=crear, e=editar, d=eliminar */
const PERMISOS_BASE = {
  DOCENTE:  { docentes: 'v', estudiantes: 'vce', asistencia: 'vced', actividades: 'vced', reportes: 'v' },
  AUXILIAR: { estudiantes: 'v', asistencia: 'vce', actividades: 'v', reportes: 'v' }
};

/* =============================== PUNTO DE ENTRADA ========================== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP.TITULO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* =============================== INSTALACIÓN =============================== */
/* Solo el propietario puede ejecutarlas desde el editor. */

function soloPropietario_() {
  const a = Session.getActiveUser().getEmail(), e = Session.getEffectiveUser().getEmail();
  if (!a || a !== e) throw new Error('Operación permitida solo al propietario del script desde el editor.');
}

function instalar() {
  soloPropietario_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  Object.keys(ESQUEMA).forEach(n => {
    const s = ss.getSheetByName(n) || ss.insertSheet(n);
    const h = ESQUEMA[n];
    if (s.getLastRow() === 0) {
      s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#0d6efd').setFontColor('#ffffff');
      s.setFrozenRows(1);
    }
    h.forEach((c, i) => { if (COLS_TEXTO.indexOf(c) >= 0) s.getRange(1, i + 1, s.getMaxRows(), 1).setNumberFormat('@'); });
  });
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(n => {
    const v = ss.getSheetByName(n);
    if (v && v.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(v);
  });
  if (!leer_('Config').length) {
    setConfig_({ INSTITUCION: 'Nombre de la institución', ENCABEZADO2: 'Secretaría / Subsistema educativo',
                 CCT: '', CICLO: '2026 - 2027', DIRECTOR: '', LOGO_ID: '' });
  }
  if (!leer_('Permisos').length) {
    const filas = [];
    Object.keys(PERMISOS_BASE).forEach(rol => Object.keys(MODULOS).forEach(m => {
      const l = PERMISOS_BASE[rol][m] || '';
      filas.push({ Rol: rol, Modulo: m, Ver: l.indexOf('v') >= 0, Crear: l.indexOf('c') >= 0,
                   Editar: l.indexOf('e') >= 0, Eliminar: l.indexOf('d') >= 0 });
    }));
    agregarVarios_('Permisos', filas);
  }
  if (!leer_('Usuarios').length) {
    const salt = uid_('s');
    agregar_('Usuarios', { Usuario: 'admin', Nombre: 'Administrador', Rol: 'ADMIN', DocenteID: '*',
                           Salt: salt, Hash: hash_('Admin2026*', salt), Activo: true, CambiarPass: true });
  }
  Logger.log('Instalación lista. Usuario: admin  |  Contraseña: Admin2026*  (se pedirá cambiarla).');
}

/** Carga el grupo del archivo LISTA_ASISTENCIA_E.xlsx como ejemplo. */
function cargarDatosDeEjemplo() {
  soloPropietario_();
  if (leer_('Estudiantes').length) throw new Error('Ya existen estudiantes; no se cargó el ejemplo.');
  const did = uid_('D-'), cid = uid_('C-');
  agregar_('Docentes', { DocenteID: did, Nombre: 'Mtro. Raúl Dionicio Panzo', Correo: '', Activo: true });
  agregar_('Asignaciones', { ClaseID: cid, DocenteID: did, Asignatura: 'Informática III', Grado: '2°', Grupo: 'E',
                             Ciclo: '2026 - 2027', Activo: true });
  importarNombres_('2°', 'E', LISTA_EJEMPLO);
  Logger.log('Ejemplo cargado: 1 docente, 1 asignatura y ' + LISTA_EJEMPLO.length + ' estudiantes.');
}

const LISTA_EJEMPLO = [
 "ARROYO LOPEZ EDUARDO",
 "BAUTISTA MIRON SARAI",
 "CARRERA SANTANA MATEO SANTIAGO",
 "CASTRO SALAS KHAMILA MAYRENI",
 "CASTRO MARTINEZ MOISES ULISES",
 "CORDOVA FLORES EIMMY",
 "CRISOSTOMO SUAREZ JORGE ABRAHAM N.I.",
 "DECTOR CONTRERAS XIMENA",
 "GALLARDO HERRERA IANN",
 "GARCIA HEREDIA EVELYN DAYANA",
 "GONZALEZ MARTINEZ NAHOMI",
 "HERNANDEZ FLORES CAROLINA",
 "HERNANDEZ MALDONADO ALLISON BRISEIDA N.I.",
 "HERNANDEZ MARTINEZ ALEJANDRO ZURIEL",
 "HERNANDEZ VALDEZ DAVID U",
 "JIMENEZ MARTINEZ AARON",
 "JUAREZ RAMIREZ KEVIN SANTIAGO",
 "LAZARO CORDOBA SEBASTIAN",
 "LOPEZ GOMEZ SAUL DE JESUS",
 "MARTINEZ CALIHUA SADAY",
 "MARTINEZ RIVERA WENDY MICHELLE",
 "MEJIA HERNANDEZ JORGE ANTONIO",
 "MENDOZA CASTILLO BRITANY",
 "NOLASCO LEON VANESSA",
 "ORTIZ MORALES OSCAR FERNANDO",
 "RAMIREZ RODRIGUEZ ANGEL YAEL",
 "REYES VELAZQUEZ XADA MADAID",
 "RIVERA FIGUEROA ISABEL NAHOMI",
 "RODRIGUEZ MARQUEZ JESUS EMMANUEL N. I.",
 "ROJAS LOPEZ IKER JOHAN",
 "ROJAS VALIENTE KEVIN SAÚL N.I.",
 "ROSAS RODRIGUEZ EMILY XIOMARA",
 "SALAS SOLIS SOFÍA JACQUELINE N.I.",
 "SANCHEZ GONZALEZ SAMANTHA GUADALUPE",
 "SANCHEZ TRINIDAD DULCE MARIA",
 "TELLEZ GALAN ISAAC JULIAN",
 "URRUTIA MARTINEZ ARANZA",
 "VILLA ROJAS CARLOS",
 "ZAMORA CARRERA GORETTI",
 "ZEPEDA CASTILLO MARIEL U"
];

/* =============================== BASE DE DATOS (Sheets) ==================== */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function hoja_(n) {
  const s = ss_().getSheetByName(n);
  if (!s) throw new Error('Falta la hoja "' + n + '". Ejecuta la función instalar().');
  return s;
}
/** Evita que un texto se interprete como fórmula. */
function limpiar_(v) { return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v; }
function fila_(n, o, base) { return ESQUEMA[n].map((c, i) => o[c] === undefined ? (base ? base[i] : '') : limpiar_(o[c])); }

function leer_(n) {
  const s = hoja_(n), ult = s.getLastRow(), h = ESQUEMA[n];
  if (ult < 2) return [];
  const tz = Session.getScriptTimeZone();
  return s.getRange(2, 1, ult - 1, h.length).getValues().map((f, i) => {
    const o = { _fila: i + 2 };
    h.forEach((c, j) => { let v = f[j]; if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd'); o[c] = v; });
    return o;
  });
}
function agregar_(n, o) { hoja_(n).appendRow(fila_(n, o)); }
function agregarVarios_(n, lista) {
  if (!lista.length) return;
  const s = hoja_(n), h = ESQUEMA[n];
  s.getRange(s.getLastRow() + 1, 1, lista.length, h.length).setValues(lista.map(o => fila_(n, o)));
}
function actualizar_(n, fila, o) {
  const s = hoja_(n), h = ESQUEMA[n], r = s.getRange(fila, 1, 1, h.length);
  r.setValues([fila_(n, o, r.getValues()[0])]);
}
/** Elimina todas las filas que cumplan el predicado (reescribe la hoja una sola vez). */
function borrarDonde_(n, pred) {
  const s = hoja_(n), h = ESQUEMA[n], ult = s.getLastRow();
  if (ult < 2) return 0;
  const rng = s.getRange(2, 1, ult - 1, h.length), vals = rng.getValues();
  const keep = vals.filter(f => { const o = {}; h.forEach((c, j) => o[c] = f[j]); return !pred(o); });
  const n0 = vals.length - keep.length;
  if (n0) { rng.clearContent(); if (keep.length) s.getRange(2, 1, keep.length, h.length).setValues(keep); }
  return n0;
}
/** Inserta o actualiza (por Key) el campo Valor de forma masiva. */
function upsert_(n, filas) {
  const u = {}; filas.forEach(o => u[o.Key] = o);
  filas = Object.keys(u).map(k => u[k]);
  if (!filas.length) return;
  const h = ESQUEMA[n], s = hoja_(n), ult = s.getLastRow(), iVal = h.indexOf('Valor') + 1, mapa = {};
  if (ult > 1) s.getRange(2, 1, ult - 1, 1).getValues().forEach((f, i) => mapa[f[0]] = i + 2);
  const nuevas = [], cambios = [];
  filas.forEach(o => {
    const r = mapa[o.Key];
    if (r) cambios.push([r, limpiar_(o.Valor)]); else if (o.Valor !== '') nuevas.push(o);
  });
  if (cambios.length <= 6) cambios.forEach(c => s.getRange(c[0], iVal).setValue(c[1]));
  else {
    const rng = s.getRange(2, iVal, ult - 1, 1), col = rng.getValues();
    cambios.forEach(c => col[c[0] - 2][0] = c[1]);
    rng.setValues(col);
  }
  agregarVarios_(n, nuevas);
}
function conBloqueo_(fn) {
  const l = LockService.getScriptLock();
  l.waitLock(25000);
  try { return fn(); } finally { l.releaseLock(); }
}

/* =============================== UTILIDADES ================================ */

const uid_ = p => p + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
const bool_ = v => v === true || ['TRUE', '1', 'SI', 'SÍ'].indexOf(String(v).toUpperCase()) >= 0;
const norm_ = v => String(v == null ? '' : v).trim().toUpperCase();
const xround_ = (x, d) => { const f = Math.pow(10, d || 0); return Math.round(x * f + 1e-9) / f; };   // ROUND de Excel
const num_ = (v, max) => { const n = Number(v); return (v === '' || v == null || isNaN(n)) ? 0 : Math.max(0, Math.min(max, n)); };
const esTodo_ = u => norm_(u.Rol) === 'ADMIN' || String(u.DocenteID) === '*';
const claveAleatoria_ = () => String(Math.floor(100000 + Math.random() * 900000));

function hash_(pass, salt) {
  let h = salt + pass;
  for (let i = 0; i < APP.HASH_VUELTAS; i++)
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  return h;
}
function config_() { const o = {}; leer_('Config').forEach(r => o[r.Clave] = r.Valor); return o; }
function setConfig_(obj) {
  const filas = leer_('Config');
  Object.keys(obj).forEach(k => {
    const f = filas.find(r => r.Clave === k);
    if (f) actualizar_('Config', f._fila, { Valor: obj[k] }); else agregar_('Config', { Clave: k, Valor: obj[k] });
  });
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

/** Público: datos para la pantalla de acceso. */
function infoPublica() {
  const c = config_();
  return { titulo: APP.TITULO, institucion: c.INSTITUCION || '', encabezado2: c.ENCABEZADO2 || '',
           logo: logoUri_(), desarrollador: APP.DESARROLLADOR };
}

/** Público: inicio de sesión del personal. */
function login(usuario, pass) {
  usuario = String(usuario || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache(), kInt = 'INT_' + usuario;
  if (Number(cache.get(kInt) || 0) >= APP.MAX_INTENTOS)
    return { ok: false, error: 'Demasiados intentos fallidos. Intenta de nuevo en 10 minutos.' };
  const u = leer_('Usuarios').find(x => String(x.Usuario).toLowerCase() === usuario);
  if (!u || !bool_(u.Activo) || hash_(String(pass || ''), String(u.Salt)) !== u.Hash) {
    cache.put(kInt, String(Number(cache.get(kInt) || 0) + 1), APP.BLOQUEO_SEG);
    return { ok: false, error: 'Usuario o contraseña incorrectos.' };
  }
  cache.remove(kInt);
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('S_' + token, u.Usuario, APP.SESION_SEG);
  return { ok: true, data: { token: token } };
}

function sesion_(token) {
  const cache = CacheService.getScriptCache();
  const nombre = token && cache.get('S_' + token);
  if (!nombre) throw new Error('SESION_EXPIRADA');
  const u = leer_('Usuarios').find(x => x.Usuario === nombre && bool_(x.Activo));
  if (!u) throw new Error('SESION_EXPIRADA');
  cache.put('S_' + token, nombre, APP.SESION_SEG);
  return u;
}

/* =============================== ALCANCE DE DATOS ========================== */

function clasesDe_(u) {
  const docs = {}; leer_('Docentes').forEach(d => docs[d.DocenteID] = d.Nombre);
  const todo = esTodo_(u);
  return leer_('Asignaciones').filter(a => bool_(a.Activo) && (todo || a.DocenteID === u.DocenteID)).map(a => ({
    ClaseID: a.ClaseID, DocenteID: a.DocenteID, Docente: docs[a.DocenteID] || '', Asignatura: a.Asignatura,
    Grado: String(a.Grado), Grupo: String(a.Grupo), Ciclo: String(a.Ciclo)
  }));
}
function clase_(u, id) {
  const c = clasesDe_(u).find(x => x.ClaseID === id);
  if (!c) throw new Error('La asignatura seleccionada no está disponible para tu usuario.');
  return c;
}
function estudiantesDe_(c) {
  return leer_('Estudiantes')
    .filter(e => bool_(e.Activo) && norm_(e.Grado) === norm_(c.Grado) && norm_(e.Grupo) === norm_(c.Grupo))
    .sort((a, b) => (Number(a.NumLista) || 999) - (Number(b.NumLista) || 999) || String(a.Nombre).localeCompare(String(b.Nombre)));
}
const estLite_ = e => ({ EstID: e.EstID, NumLista: Number(e.NumLista) || 0, Nombre: e.Nombre, Etiqueta: e.Etiqueta });
function exigePar_(u, grado, grupo) {
  const k = norm_(grado) + '|' + norm_(grupo);
  if (!clasesDe_(u).some(c => norm_(c.Grado) + '|' + norm_(c.Grupo) === k)) throw new Error('No tienes acceso a ese grado y grupo.');
}
function ctx_(u, p) {
  const c = clase_(u, p.ClaseID), t = Number(p.Trimestre), pa = Number(p.Parcial);
  if ([1, 2, 3].indexOf(t) < 0 || [1, 2].indexOf(pa) < 0) throw new Error('Trimestre o parcial no válido.');
  return { c: c, t: t, pa: pa };
}
const filtroCtx_ = (c, t, pa) => o => o.ClaseID === c.ClaseID && Number(o.Trimestre) === t && Number(o.Parcial) === pa;

/* =============================== MOTOR DE CÁLCULO ========================== */
/* Replica las fórmulas del archivo LISTA_ASISTENCIA_E.xlsx                    */

function motor_() { return { per: leer_('Periodos'), act: leer_('Actividades'), asi: leer_('Asistencia'), cal: leer_('Calificaciones') }; }

/**
 * Calificación de un parcial.
 *  - Asistencia (0-10)  = ROUND(asistencias*10/TotalDias, 0)    -> puntos = asis10/10 * pesoAsistencia
 *  - Generales          = suma de puntos capturados (máx = peso de cada criterio)
 *  - Libreta (pts)      = suma actividades * pesoLibreta / suma máximos,  pesoLibreta = 100 - pesoGenerales
 *  - Calif. general     = (asistencia + generales + libreta) / 10
 */
function calcParcial_(M, c, t, pa, ests) {
  const ok = filtroCtx_(c, t, pa);
  const per = M.per.find(ok) || null;
  const total = per ? Number(per.TotalDias) || 0 : 0;
  const pesoAsis = per && per.PesoAsistencia !== '' ? Number(per.PesoAsistencia) : 10;
  const acts = M.act.filter(ok).sort((a, b) => Number(a.Orden) - Number(b.Orden))
    .map(a => ({ ActID: a.ActID, Nombre: a.Nombre, Categoria: a.Categoria, Max: Number(a.Max) }));
  const gen = acts.filter(a => a.Categoria === 'GENERAL'), lib = acts.filter(a => a.Categoria === 'LIBRETA');
  const pesoGen = pesoAsis + gen.reduce((s, a) => s + a.Max, 0);
  const pesoLib = Math.max(0, 100 - pesoGen), maxLib = lib.reduce((s, a) => s + a.Max, 0);
  const asi = M.asi.filter(ok), cal = M.cal.filter(ok);
  const fechas = Array.from(new Set(asi.filter(a => a.Valor !== '').map(a => a.Fecha))).sort();
  const cm = {}; cal.forEach(r => cm[r.EstID + '|' + r.ActID] = r.Valor);
  const am = {}; asi.forEach(r => { if (r.Valor !== '') am[r.EstID + '|' + r.Fecha] = Number(r.Valor); });
  const filas = ests.map(e => {
    let pr = 0, fa = 0;
    fechas.forEach(f => { const v = am[e.EstID + '|' + f]; if (v === 1) pr++; else if (v === 0) fa++; });
    const asis10 = total > 0 ? Math.min(10, xround_(pr * 10 / total, 0)) : 0;
    const ptsAsis = asis10 / 10 * pesoAsis;
    const vals = {}, pts = {}; let sg = 0, sl = 0;
    gen.concat(lib).forEach(a => {
      const raw = cm[e.EstID + '|' + a.ActID];
      vals[a.ActID] = raw === undefined ? '' : raw;
      pts[a.ActID] = num_(raw, a.Max);
      if (a.Categoria === 'GENERAL') sg += pts[a.ActID]; else sl += pts[a.ActID];
    });
    const ptsL = maxLib > 0 ? sl * pesoLib / maxLib : 0;
    return { EstID: e.EstID, NumLista: Number(e.NumLista) || 0, Nombre: e.Nombre, Etiqueta: e.Etiqueta,
             presentes: pr, faltas: fa, pct: total > 0 ? Math.min(100, pr / total * 100) : 0, asis10: asis10,
             ptsAsis: ptsAsis, vals: vals, pts: pts, califL: ptsL, gral: (ptsAsis + sg + ptsL) / 10,
             obs: cm[e.EstID + '|OBS'] || '' };
  });
  return { per: per ? { TotalDias: total, Mes: per.Mes, PesoAsistencia: pesoAsis } : null, total: total, pesoAsis: pesoAsis,
           pesoGen: pesoGen, pesoLib: pesoLib, maxLib: maxLib, acts: gen.concat(lib), fechas: fechas, am: am, filas: filas };
}

/** Trimestre = ROUND(promedio de parciales, 0). Final = suma de trimestres / 3 (1 decimal). */
function calcAnual_(M, c, ests) {
  const R = {}; ests.forEach(e => R[e.EstID] = { trim: [], total: 0, n: 0 });
  for (let t = 1; t <= 3; t++) {
    const ps = [1, 2].map(p => M.per.some(x => x.ClaseID === c.ClaseID && Number(x.Trimestre) === t && Number(x.Parcial) === p)
                          ? calcParcial_(M, c, t, p, ests) : null);
    ests.forEach(e => {
      const g = ps.map(P => P ? P.filas.find(f => f.EstID === e.EstID).gral : null), v = g.filter(x => x !== null);
      const cal = v.length ? xround_(v.reduce((a, b) => a + b, 0) / v.length, 0) : null;
      R[e.EstID].trim.push({ p: g, cal: cal });
      if (cal !== null) { R[e.EstID].total += cal; R[e.EstID].n++; }
    });
  }
  ests.forEach(e => {
    const r = R[e.EstID];
    r.final = r.n ? xround_(r.total / (r.n === 3 ? 3 : r.n), 1) : null;
    r.provisional = r.n < 3;
  });
  return R;
}

/* =============================== MÓDULO INVITADO =========================== */

/** Público: consulta de un solo estudiante con matrícula + clave de consulta. */
function consultaInvitado(matricula, clave) {
  const cache = CacheService.getScriptCache(), k = 'G_' + norm_(matricula).slice(0, 40);
  if (Number(cache.get(k) || 0) >= APP.MAX_INTENTOS)
    return { ok: false, error: 'Demasiados intentos. Intenta de nuevo en 10 minutos.' };
  const e = leer_('Estudiantes').find(x => bool_(x.Activo) && norm_(x.Matricula) === norm_(matricula));
  if (!matricula || !e || String(e.Clave) !== String(clave || '').trim()) {
    cache.put(k, String(Number(cache.get(k) || 0) + 1), APP.BLOQUEO_SEG);
    return { ok: false, error: 'Matrícula o clave de consulta incorrecta.' };
  }
  cache.remove(k);
  const M = motor_(), cfg = config_(), docs = {};
  leer_('Docentes').forEach(d => docs[d.DocenteID] = d.Nombre);
  const materias = leer_('Asignaciones')
    .filter(a => bool_(a.Activo) && norm_(a.Grado) === norm_(e.Grado) && norm_(a.Grupo) === norm_(e.Grupo))
    .map(a => {
      const R = calcAnual_(M, { ClaseID: a.ClaseID }, [e])[e.EstID];
      return { asignatura: a.Asignatura, docente: docs[a.DocenteID] || '', ciclo: String(a.Ciclo), trim: R.trim,
               total: R.total, final: R.final, provisional: R.provisional };
    });
  return { ok: true, data: {
    estudiante: { nombre: e.Nombre, grado: String(e.Grado), grupo: String(e.Grupo), matricula: e.Matricula },
    institucion: cfg.INSTITUCION || '', encabezado2: cfg.ENCABEZADO2 || '', cct: cfg.CCT || '',
    logo: logoUri_(), materias: materias } };
}

/* =============================== API PRIVADA =============================== */

/**
 * ACCIONES[nombre] = [módulo, permiso (o función(p)), escribe?, función(usuario, parámetros)]
 */
const ACCIONES = {

  'init': [null, null, false, u => {
    const c = config_();
    return { usuario: { usuario: u.Usuario, nombre: u.Nombre, rol: u.Rol, cambiarPass: bool_(u.CambiarPass) },
             permisos: permisos_(u.Rol),
             config: { INSTITUCION: c.INSTITUCION, ENCABEZADO2: c.ENCABEZADO2, CCT: c.CCT, CICLO: c.CICLO, DIRECTOR: c.DIRECTOR },
             logo: logoUri_(), clases: clasesDe_(u) };
  }],

  'cuenta.password': [null, null, true, (u, p) => {
    if (hash_(String(p.actual || ''), String(u.Salt)) !== u.Hash) throw new Error('La contraseña actual no es correcta.');
    const n = String(p.nueva || '');
    if (n.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
    if (n === String(p.actual)) throw new Error('La nueva contraseña debe ser distinta a la actual.');
    const salt = uid_('s');
    actualizar_('Usuarios', u._fila, { Salt: salt, Hash: hash_(n, salt), CambiarPass: false });
    return true;
  }],

  /* ---------- Docentes y asignaturas ---------- */
  'docentes.listar': ['docentes', 'ver', false, u => {
    const todo = esTodo_(u), nom = {}, all = leer_('Docentes');
    all.forEach(d => nom[d.DocenteID] = d.Nombre);
    return {
      puedeTodo: todo,
      docentes: all.filter(d => todo || d.DocenteID === u.DocenteID)
        .map(d => ({ DocenteID: d.DocenteID, Nombre: d.Nombre, Correo: d.Correo, Activo: bool_(d.Activo) })),
      asignaciones: leer_('Asignaciones').filter(a => todo || a.DocenteID === u.DocenteID).map(a => ({
        ClaseID: a.ClaseID, DocenteID: a.DocenteID, Docente: nom[a.DocenteID] || '', Asignatura: a.Asignatura,
        Grado: String(a.Grado), Grupo: String(a.Grupo), Ciclo: String(a.Ciclo), Activo: bool_(a.Activo) }))
    };
  }],
  'docentes.guardar': ['docentes', p => p.DocenteID ? 'editar' : 'crear', true, (u, p) => {
    if (!esTodo_(u)) throw new Error('Solo el administrador puede registrar docentes.');
    const nombre = String(p.Nombre || '').trim();
    if (nombre.length < 3) throw new Error('Escribe el nombre del docente.');
    const o = { Nombre: nombre, Correo: String(p.Correo || '').trim(), Activo: p.Activo !== false };
    if (p.DocenteID) {
      const d = leer_('Docentes').find(x => x.DocenteID === p.DocenteID);
      if (!d) throw new Error('Docente no encontrado.');
      actualizar_('Docentes', d._fila, o); return d.DocenteID;
    }
    o.DocenteID = uid_('D-'); agregar_('Docentes', o); return o.DocenteID;
  }],
  'docentes.eliminar': ['docentes', 'eliminar', true, (u, p) => {
    if (!esTodo_(u)) throw new Error('Solo el administrador puede eliminar docentes.');
    if (leer_('Asignaciones').some(a => a.DocenteID === p.DocenteID))
      throw new Error('Primero elimina o reasigna las asignaturas de este docente.');
    if (borrarDonde_('Docentes', o => o.DocenteID === p.DocenteID) < 1) throw new Error('Docente no encontrado.');
    return true;
  }],
  'docentes.guardarAsig': ['docentes', p => p.ClaseID ? 'editar' : 'crear', true, (u, p) => {
    const todo = esTodo_(u), doc = todo ? String(p.DocenteID || '') : u.DocenteID;
    if (!leer_('Docentes').some(d => d.DocenteID === doc)) throw new Error('Selecciona un docente válido.');
    const o = { DocenteID: doc, Asignatura: String(p.Asignatura || '').trim(), Grado: String(p.Grado || '').trim(),
                Grupo: String(p.Grupo || '').trim().toUpperCase(), Ciclo: String(p.Ciclo || '').trim(), Activo: p.Activo !== false };
    if (!o.Asignatura || !o.Grado || !o.Grupo) throw new Error('Asignatura, grado y grupo son obligatorios.');
    if (p.ClaseID) {
      const a = leer_('Asignaciones').find(x => x.ClaseID === p.ClaseID && (todo || x.DocenteID === u.DocenteID));
      if (!a) throw new Error('Asignación no encontrada.');
      actualizar_('Asignaciones', a._fila, o); return a.ClaseID;
    }
    o.ClaseID = uid_('C-'); agregar_('Asignaciones', o); return o.ClaseID;
  }],
  'docentes.eliminarAsig': ['docentes', 'eliminar', true, (u, p) => {
    const a = leer_('Asignaciones').find(x => x.ClaseID === p.ClaseID && (esTodo_(u) || x.DocenteID === u.DocenteID));
    if (!a) throw new Error('Asignación no encontrada.');
    ['Periodos', 'Asistencia', 'Actividades', 'Calificaciones'].forEach(h => borrarDonde_(h, o => o.ClaseID === a.ClaseID));
    borrarDonde_('Asignaciones', o => o.ClaseID === a.ClaseID);
    return true;
  }],

  /* ---------- Estudiantes ---------- */
  'estudiantes.listar': ['estudiantes', 'ver', false, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    return leer_('Estudiantes').filter(e => norm_(e.Grado) === norm_(p.Grado) && norm_(e.Grupo) === norm_(p.Grupo))
      .sort((a, b) => (Number(a.NumLista) || 999) - (Number(b.NumLista) || 999))
      .map(e => ({ EstID: e.EstID, Matricula: e.Matricula, Clave: e.Clave, NumLista: Number(e.NumLista) || 0,
                   Nombre: e.Nombre, Etiqueta: e.Etiqueta, Activo: bool_(e.Activo) }));
  }],
  'estudiantes.guardar': ['estudiantes', p => p.EstID ? 'editar' : 'crear', true, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    const nombre = String(p.Nombre || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (nombre.length < 3) throw new Error('Escribe el nombre del estudiante.');
    const todos = leer_('Estudiantes'), mat = String(p.Matricula || '').trim();
    if (mat && todos.some(e => norm_(e.Matricula) === norm_(mat) && e.EstID !== p.EstID)) throw new Error('Esa matrícula ya está registrada.');
    const o = { Nombre: nombre, Grado: p.Grado, Grupo: p.Grupo, Etiqueta: String(p.Etiqueta || '').trim(), Activo: p.Activo !== false };
    if (mat) o.Matricula = mat;
    if (p.NumLista) o.NumLista = Number(p.NumLista);
    if (p.EstID) {
      const e = todos.find(x => x.EstID === p.EstID);
      if (!e) throw new Error('Estudiante no encontrado.');
      exigePar_(u, e.Grado, e.Grupo);
      actualizar_('Estudiantes', e._fila, o); return e.EstID;
    }
    const mismos = todos.filter(e => norm_(e.Grado) === norm_(p.Grado) && norm_(e.Grupo) === norm_(p.Grupo));
    o.NumLista = o.NumLista || mismos.reduce((m, e) => Math.max(m, Number(e.NumLista) || 0), 0) + 1;
    o.EstID = uid_('E-'); o.Clave = claveAleatoria_();
    if (!o.Matricula) o.Matricula = matriculaAuto_(p.Grado, p.Grupo, o.NumLista, todos);
    agregar_('Estudiantes', o); return o.EstID;
  }],
  'estudiantes.eliminar': ['estudiantes', 'eliminar', true, (u, p) => {
    const e = leer_('Estudiantes').find(x => x.EstID === p.EstID);
    if (!e) throw new Error('Estudiante no encontrado.');
    exigePar_(u, e.Grado, e.Grupo);
    borrarDonde_('Asistencia', o => o.EstID === e.EstID);
    borrarDonde_('Calificaciones', o => o.EstID === e.EstID);
    borrarDonde_('Estudiantes', o => o.EstID === e.EstID);
    return true;
  }],
  'estudiantes.importar': ['estudiantes', 'crear', true, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    const nombres = String(p.Texto || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 200);
    if (!nombres.length) throw new Error('Pega al menos un nombre (uno por renglón).');
    return importarNombres_(p.Grado, p.Grupo, nombres);
  }],
  'estudiantes.clave': ['estudiantes', 'editar', true, (u, p) => {
    const e = leer_('Estudiantes').find(x => x.EstID === p.EstID);
    if (!e) throw new Error('Estudiante no encontrado.');
    exigePar_(u, e.Grado, e.Grupo);
    const c = claveAleatoria_(); actualizar_('Estudiantes', e._fila, { Clave: c }); return c;
  }],
  'estudiantes.ordenar': ['estudiantes', 'editar', true, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    const lista = leer_('Estudiantes').filter(e => bool_(e.Activo) && norm_(e.Grado) === norm_(p.Grado) && norm_(e.Grupo) === norm_(p.Grupo))
      .sort((a, b) => String(a.Nombre).localeCompare(String(b.Nombre), 'es'));
    const s = hoja_('Estudiantes'), col = ESQUEMA.Estudiantes.indexOf('NumLista') + 1, ult = s.getLastRow();
    const rng = s.getRange(2, col, ult - 1, 1), v = rng.getValues();
    lista.forEach((e, i) => v[e._fila - 2][0] = i + 1);
    rng.setValues(v); return lista.length;
  }],

  /* ---------- Asistencia ---------- */
  'asistencia.cargar': ['asistencia', 'ver', false, (u, p) => {
    const x = ctx_(u, p), ests = estudiantesDe_(x.c), M = motor_(), P = calcParcial_(M, x.c, x.t, x.pa, ests);
    const marcas = {};
    M.asi.filter(filtroCtx_(x.c, x.t, x.pa)).forEach(r => { if (r.Fecha === p.Fecha && r.Valor !== '') marcas[r.EstID] = Number(r.Valor); });
    const resumen = {}; P.filas.forEach(f => resumen[f.EstID] = { p: f.presentes, f: f.faltas, pct: f.pct });
    return { periodo: P.per, total: P.total, fechas: P.fechas, marcas: marcas, resumen: resumen, estudiantes: ests.map(estLite_) };
  }],
  'asistencia.periodo': ['asistencia', 'editar', true, (u, p) => {
    const x = ctx_(u, p);
    const total = Math.round(Number(p.TotalDias));
    if (!(total >= 1 && total <= 300)) throw new Error('El número de asistencias debe estar entre 1 y 300.');
    const peso = (p.PesoAsistencia === '' || p.PesoAsistencia == null) ? 10 : Number(p.PesoAsistencia);
    if (isNaN(peso) || peso < 0 || peso > 100) throw new Error('El peso de la asistencia debe estar entre 0 y 100.');
    const key = [x.c.ClaseID, x.t, x.pa].join('|'), ok = filtroCtx_(x.c, x.t, x.pa);
    const gen = leer_('Actividades').filter(a => ok(a) && a.Categoria === 'GENERAL').reduce((s, a) => s + Number(a.Max), 0);
    if (peso + gen > 100) throw new Error('Los puntos de los criterios generales no pueden superar 100.');
    const o = { Key: key, ClaseID: x.c.ClaseID, Trimestre: x.t, Parcial: x.pa, TotalDias: total, Mes: String(p.Mes || '').trim(), PesoAsistencia: peso };
    const ex = leer_('Periodos').find(r => r.Key === key);
    if (ex) actualizar_('Periodos', ex._fila, o); else agregar_('Periodos', o);
    return true;
  }],
  'asistencia.guardar': ['asistencia', 'editar', true, (u, p) => {
    const x = ctx_(u, p);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.Fecha))) throw new Error('Fecha no válida.');
    if (!leer_('Periodos').some(r => r.Key === [x.c.ClaseID, x.t, x.pa].join('|')))
      throw new Error('Primero indica cuántas asistencias se tomarán en cuenta para este parcial.');
    const ids = new Set(estudiantesDe_(x.c).map(e => e.EstID)), filas = [];
    (p.marcas || []).forEach(m => {
      if (!ids.has(m.EstID)) throw new Error('Estudiante no válido.');
      filas.push({ Key: [x.c.ClaseID, x.t, x.pa, p.Fecha, m.EstID].join('|'), ClaseID: x.c.ClaseID, Trimestre: x.t, Parcial: x.pa,
                   Fecha: p.Fecha, EstID: m.EstID, Valor: m.valor === 1 ? 1 : (m.valor === 0 ? 0 : '') });
    });
    upsert_('Asistencia', filas);
    return filas.length;
  }],
  'asistencia.borrarFecha': ['asistencia', 'eliminar', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa);
    return borrarDonde_('Asistencia', o => ok(o) && o.Fecha === p.Fecha);
  }],

  /* ---------- Actividades y calificaciones ---------- */
  'actividades.cargar': ['actividades', 'ver', false, (u, p) => {
    const x = ctx_(u, p), P = calcParcial_(motor_(), x.c, x.t, x.pa, estudiantesDe_(x.c));
    delete P.am; return P;
  }],
  'actividades.guardarAct': ['actividades', p => p.ActID ? 'editar' : 'crear', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa);
    const per = leer_('Periodos').find(r => r.Key === [x.c.ClaseID, x.t, x.pa].join('|'));
    if (!per) throw new Error('Primero configura el parcial (número de asistencias para evaluación).');
    const nombre = String(p.Nombre || '').trim(), cat = p.Categoria === 'LIBRETA' ? 'LIBRETA' : 'GENERAL', max = Number(p.Max);
    if (!nombre) throw new Error('Escribe el nombre de la actividad.');
    if (!(max > 0 && max <= 100)) throw new Error('El valor máximo debe ser mayor que 0 y no exceder 100.');
    const pesoAsis = per.PesoAsistencia === '' ? 10 : Number(per.PesoAsistencia);
    const otras = leer_('Actividades').filter(a => ok(a) && a.ActID !== p.ActID);
    const genOtras = otras.filter(a => a.Categoria === 'GENERAL').reduce((s, a) => s + Number(a.Max), 0);
    if (cat === 'GENERAL' && pesoAsis + genOtras + max > 100) throw new Error('Los puntos generales (incluida la asistencia) no pueden superar 100.');
    const o = { Nombre: nombre, Categoria: cat, Max: max };
    if (p.ActID) {
      const a = leer_('Actividades').find(r => r.ActID === p.ActID && ok(r));
      if (!a) throw new Error('Actividad no encontrada.');
      actualizar_('Actividades', a._fila, o); return a.ActID;
    }
    o.ActID = uid_('A-'); o.ClaseID = x.c.ClaseID; o.Trimestre = x.t; o.Parcial = x.pa;
    o.Orden = otras.reduce((m, a) => Math.max(m, Number(a.Orden) || 0), 0) + 1;
    agregar_('Actividades', o); return o.ActID;
  }],
  'actividades.eliminarAct': ['actividades', 'eliminar', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa);
    borrarDonde_('Calificaciones', o => ok(o) && o.ActID === p.ActID);
    if (borrarDonde_('Actividades', o => ok(o) && o.ActID === p.ActID) < 1) throw new Error('Actividad no encontrada.');
    return true;
  }],
  'actividades.plantilla': ['actividades', 'crear', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa);
    if (!leer_('Periodos').some(r => r.Key === [x.c.ClaseID, x.t, x.pa].join('|'))) throw new Error('Primero configura el parcial.');
    if (leer_('Actividades').some(ok)) throw new Error('Este parcial ya tiene actividades registradas.');
    agregarVarios_('Actividades', ['Participación', 'Disciplina', 'Examen'].map((n, i) => ({
      ActID: uid_('A-'), ClaseID: x.c.ClaseID, Trimestre: x.t, Parcial: x.pa, Nombre: n, Categoria: 'GENERAL', Max: 10, Orden: i + 1 })));
    return true;
  }],
  'actividades.guardarCalif': ['actividades', 'editar', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa), acts = {}, ids = new Set(estudiantesDe_(x.c).map(e => e.EstID)), filas = [];
    leer_('Actividades').filter(ok).forEach(a => acts[a.ActID] = a);
    (p.items || []).forEach(it => {
      if (!ids.has(it.EstID)) throw new Error('Estudiante no válido.');
      let v;
      if (it.ActID === 'OBS') v = String(it.Valor || '').slice(0, 300);
      else {
        const a = acts[it.ActID];
        if (!a) throw new Error('Actividad no válida.');
        if (it.Valor === '' || it.Valor == null) v = '';
        else {
          v = Number(it.Valor);
          if (isNaN(v) || v < 0 || v > Number(a.Max)) throw new Error('El valor de "' + a.Nombre + '" debe estar entre 0 y ' + a.Max + '.');
        }
      }
      filas.push({ Key: [x.c.ClaseID, x.t, x.pa, it.ActID, it.EstID].join('|'), ClaseID: x.c.ClaseID, Trimestre: x.t,
                   Parcial: x.pa, ActID: it.ActID, EstID: it.EstID, Valor: v });
    });
    upsert_('Calificaciones', filas);
    return filas.length;
  }],

  /* ---------- Reportes ---------- */
  'reportes.datos': ['reportes', 'ver', false, (u, p) => {
    const x = ctx_(u, p), ests = estudiantesDe_(x.c), M = motor_(), cfg = config_();
    const R = { tipo: p.tipo, t: x.t, pa: x.pa, clase: x.c, ests: ests.map(estLite_), logo: logoUri_(),
                cfg: { INSTITUCION: cfg.INSTITUCION, ENCABEZADO2: cfg.ENCABEZADO2, CCT: cfg.CCT, DIRECTOR: cfg.DIRECTOR } };
    if (p.tipo === 'final') R.anual = calcAnual_(M, x.c, ests); else R.P = calcParcial_(M, x.c, x.t, x.pa, ests);
    return R;
  }],
  'reportes.pdf': ['reportes', 'ver', false, (u, p) => {
    const html = String(p.html || '').replace(/<script[\s\S]*?<\/script>/gi, '');
    if (!html || html.length > 3000000) throw new Error('Reporte no válido o demasiado grande.');
    const blob = Utilities.newBlob(html, 'text/html', 'reporte.html').getAs('application/pdf');
    return { b64: Utilities.base64Encode(blob.getBytes()), nombre: String(p.nombre || 'reporte').replace(/[^\w\-]+/g, '_') + '.pdf' };
  }],

  /* ---------- Usuarios ---------- */
  'usuarios.listar': ['usuarios', 'ver', false, () => ({
    usuarios: leer_('Usuarios').map(x => ({ Usuario: x.Usuario, Nombre: x.Nombre, Rol: x.Rol, DocenteID: x.DocenteID, Activo: bool_(x.Activo) })),
    docentes: leer_('Docentes').map(d => ({ DocenteID: d.DocenteID, Nombre: d.Nombre })),
    roles: rolesLista_() })],
  'usuarios.guardar': ['usuarios', p => p.nuevo ? 'crear' : 'editar', true, (u, p) => {
    const usuario = String(p.Usuario || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('Usuario: 3 a 30 caracteres (letras, números, punto, guion).');
    const rol = norm_(p.Rol);
    if (rolesLista_().indexOf(rol) < 0) throw new Error('Rol no válido.');
    const todos = leer_('Usuarios'), ex = todos.find(x => String(x.Usuario).toLowerCase() === usuario);
    if (p.nuevo && ex) throw new Error('Ese usuario ya existe.');
    if (!p.nuevo && !ex) throw new Error('Usuario no encontrado.');
    const activo = p.Activo !== false;
    const o = { Usuario: usuario, Nombre: String(p.Nombre || '').trim(), Rol: rol, DocenteID: rol === 'ADMIN' ? '*' : String(p.DocenteID || ''), Activo: activo };
    if (!o.Nombre) throw new Error('Escribe el nombre del usuario.');
    if (p.Password) {
      if (String(p.Password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      const salt = uid_('s'); o.Salt = salt; o.Hash = hash_(String(p.Password), salt); o.CambiarPass = true;
    } else if (p.nuevo) throw new Error('Asigna una contraseña inicial (mínimo 8 caracteres).');
    const admins = todos.filter(x => norm_(x.Rol) === 'ADMIN' && bool_(x.Activo) && x.Usuario !== usuario).length + (rol === 'ADMIN' && activo ? 1 : 0);
    if (admins < 1) throw new Error('Debe existir al menos un administrador activo.');
    if (ex) actualizar_('Usuarios', ex._fila, o); else agregar_('Usuarios', o);
    return true;
  }],
  'usuarios.eliminar': ['usuarios', 'eliminar', true, (u, p) => {
    if (p.Usuario === u.Usuario) throw new Error('No puedes eliminar tu propio usuario.');
    const x = leer_('Usuarios').find(r => r.Usuario === p.Usuario);
    if (!x) throw new Error('Usuario no encontrado.');
    if (norm_(x.Rol) === 'ADMIN' && leer_('Usuarios').filter(r => norm_(r.Rol) === 'ADMIN' && bool_(r.Activo) && r.Usuario !== x.Usuario).length < 1)
      throw new Error('Debe existir al menos un administrador activo.');
    borrarDonde_('Usuarios', o => o.Usuario === p.Usuario); return true;
  }],

  /* ---------- Permisos ---------- */
  'permisos.cargar': ['permisos', 'ver', false, () => {
    const matriz = {};
    rolesLista_().forEach(r => matriz[r] = permisos_(r));
    return { roles: rolesLista_(), matriz: matriz, modulos: MODULOS };
  }],
  'permisos.guardar': ['permisos', 'editar', true, (u, p) => {
    const rol = norm_(p.rol);
    if (!/^[A-Z0-9_ ]{3,20}$/.test(rol)) throw new Error('Nombre de rol: 3 a 20 caracteres (letras, números, espacio o guion bajo).');
    if (rol === 'ADMIN') throw new Error('El rol ADMIN siempre tiene acceso total y no se modifica.');
    const filas = Object.keys(MODULOS).map(m => {
      const g = (p.matriz || {})[m] || {}, ver = !!g.ver;
      return { Rol: rol, Modulo: m, Ver: ver, Crear: ver && !!g.crear, Editar: ver && !!g.editar, Eliminar: ver && !!g.eliminar };
    });
    borrarDonde_('Permisos', o => norm_(o.Rol) === rol);
    agregarVarios_('Permisos', filas); return true;
  }],
  'permisos.eliminarRol': ['permisos', 'eliminar', true, (u, p) => {
    const rol = norm_(p.rol);
    if (rol === 'ADMIN') throw new Error('El rol ADMIN no se puede eliminar.');
    if (leer_('Usuarios').some(x => norm_(x.Rol) === rol)) throw new Error('Hay usuarios con este rol; cámbialos antes de eliminarlo.');
    borrarDonde_('Permisos', o => norm_(o.Rol) === rol); return true;
  }],

  /* ---------- Configuración (encabezado y logotipo) ---------- */
  'config.cargar': ['config', 'ver', false, () => ({ config: config_(), logo: logoUri_() })],
  'config.guardar': ['config', 'editar', true, (u, p) => {
    const o = {};
    ['INSTITUCION', 'ENCABEZADO2', 'CCT', 'CICLO', 'DIRECTOR'].forEach(k => o[k] = String(p[k] || '').trim().slice(0, 150));
    setConfig_(o); return true;
  }],
  'config.logo': ['config', 'editar', true, (u, p) => {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(p.dataUri || ''));
    if (!m) throw new Error('Formato de imagen no válido (usa PNG o JPG).');
    const bytes = Utilities.base64Decode(m[2]);
    if (bytes.length > 250000) throw new Error('El logotipo no debe pesar más de 250 KB.');
    const viejo = config_().LOGO_ID;
    if (viejo) { try { DriveApp.getFileById(viejo).setTrashed(true); } catch (e) {} }
    const f = DriveApp.createFile(Utilities.newBlob(bytes, m[1], 'logo_institucion'));
    setConfig_({ LOGO_ID: f.getId() });
    CacheService.getScriptCache().remove('LOGO');
    return true;
  }]
};

/** Punto único de acceso para el personal autenticado. */
function api(token, accion, p) {
  try {
    if (accion === 'salir') { CacheService.getScriptCache().remove('S_' + token); return { ok: true }; }
    const a = ACCIONES[accion];
    if (!a) throw new Error('Acción no válida.');
    const u = sesion_(token);
    p = p || {};
    if (a[0]) exige_(u, a[0], typeof a[1] === 'function' ? a[1](p) : a[1]);
    const data = a[2] ? conBloqueo_(() => a[3](u, p)) : a[3](u, p);
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: e.message || String(e), sesion: e.message === 'SESION_EXPIRADA' };
  }
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
  const todos = leer_('Estudiantes');
  let num = todos.filter(e => norm_(e.Grado) === norm_(grado) && norm_(e.Grupo) === norm_(grupo))
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
  return filas.length;
}
