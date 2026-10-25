/**
 * ============================================================================
 *  SISTEMA DE REGISTRO DE ASISTENCIA Y CALIFICACIONES  ·  v2.0
 *  Desarrollador: Mtro. Raúl Dionicio
 * ----------------------------------------------------------------------------
 *  Archivos del proyecto Apps Script:
 *    Codigo.gs     Constantes, esquema de la BD, instalación, migración, triggers
 *    Datos.gs      Capa de datos: caché, lectura filtrada, borrado lógico, auditoría
 *    Nucleo.gs     Utilidades, sesión, login Google, recuperación, permisos, alcance
 *    Motor.gs      Cálculo de calificaciones, resultados precalculados, indicadores
 *    Api.gs        Acciones del personal autenticado + consulta de invitado
 *    Servicios.gs  Correo, respaldos, archivos (Drive), sanitizador de HTML
 *    Pruebas.gs    Pruebas unitarias del motor (ejecutarPruebas)
 *    Index.html + css_app.html + js_*.html   Interfaz separada con include()
 * ============================================================================
 */

/**
 * ID de la hoja de cálculo que funciona como base de datos.
 * Es la parte de la URL entre /d/ y /edit:
 *   https://docs.google.com/spreadsheets/d/AQUI_ESTA_EL_ID/edit
 */
const SHEET_ID = '1F1qCqM9ujxy5WnWutwp4GLf0DQy2xs2BLeF0rIfBoDE';

const APP = {
  TITULO: 'Sistema de Asistencia y Calificaciones',
  DESARROLLADOR: 'Mtro. Raúl Dionicio',
  VERSION: '2.0',
  SESION_SEG: 21600,      // 6 horas (máximo permitido por CacheService)
  MAX_INTENTOS: 5,        // intentos fallidos antes de bloquear
  BLOQUEO_SEG: 600,       // 10 minutos
  HASH_VUELTAS: 300,
  RECUP_SEG: 900,         // vigencia del código de recuperación (15 min)
  CACHE_CHUNK: 30000,     // caracteres por fragmento de caché (< 100 KB por valor)
  CACHE_MAX_CHUNKS: 30,   // tope por entrada de caché
  ADJUNTO_MAX: 4 * 1024 * 1024
};

/** Esquema de evaluación por defecto: 3 trimestres × 2 parciales. */
const ESQ_DEF = 'E3x2';
const ESQ_DEF_OBJ = { EsquemaID: ESQ_DEF, Nombre: '3 trimestres × 2 parciales', NumPeriodos: 3, Parciales: 2,
                      NombrePeriodo: 'Trimestre', Aprobatoria: 6, DecFinal: 1 };

/** Valor de cada estado de asistencia (fracción de asistencia que cuenta). Configurable en Config. */
const PESOS_AS_DEF = { R: 0.5, J: 1, PM: 1 };

/**
 * Estructura de la base de datos: una hoja por entidad.
 * IMPORTANTE: las columnas nuevas siempre se AGREGAN AL FINAL para no romper datos existentes.
 */
const ESQUEMA = {
  Config:         ['Clave', 'Valor'],
  Usuarios:       ['Usuario', 'Nombre', 'Rol', 'DocenteID', 'Salt', 'Hash', 'Activo', 'CambiarPass', 'Correo'],
  Permisos:       ['Rol', 'Modulo', 'Ver', 'Crear', 'Editar', 'Eliminar'],
  Docentes:       ['DocenteID', 'Nombre', 'Correo', 'Activo', 'Eliminado'],
  Esquemas:       ['EsquemaID', 'Nombre', 'NumPeriodos', 'Parciales', 'NombrePeriodo', 'Aprobatoria', 'DecFinal'],
  Asignaciones:   ['ClaseID', 'DocenteID', 'Asignatura', 'Grado', 'Grupo', 'Ciclo', 'Activo', 'Archivada', 'EsquemaID', 'Eliminado'],
  Estudiantes:    ['EstID', 'Matricula', 'Clave', 'NumLista', 'Nombre', 'Grado', 'Grupo', 'Etiqueta', 'Activo',
                   'Tutor', 'CorreoTutor', 'TelTutor', 'Eliminado'],
  Inscripciones:  ['InscID', 'EstID', 'Ciclo', 'Grado', 'Grupo', 'NumLista', 'Estado'],
  Periodos:       ['Key', 'ClaseID', 'Trimestre', 'Parcial', 'TotalDias', 'Mes', 'PesoAsistencia'],
  Asistencia:     ['Key', 'ClaseID', 'Trimestre', 'Parcial', 'Fecha', 'EstID', 'Valor'],
  Actividades:    ['ActID', 'ClaseID', 'Trimestre', 'Parcial', 'Nombre', 'Categoria', 'Max', 'Orden', 'Eliminado'],
  Calificaciones: ['Key', 'ClaseID', 'Trimestre', 'Parcial', 'ActID', 'EstID', 'Valor'],
  Resultados:     ['Key', 'ClaseID', 'EstID', 'Datos', 'Actualizado'],
  Seguimiento:    ['SegID', 'EstID', 'ClaseID', 'Fecha', 'Tipo', 'Texto', 'ArchivoID', 'ArchivoNombre', 'Usuario', 'Eliminado'],
  Bitacora:       ['Fecha', 'Usuario', 'Accion', 'Hoja', 'Operacion', 'Registro', 'Antes', 'Despues']
};

/** Hojas que se parten por ciclo escolar al archivar (Hoja_2025_2026). */
const HOJAS_CICLO = ['Periodos', 'Asistencia', 'Actividades', 'Calificaciones'];

/** Columnas que siempre se guardan como texto (evita que Sheets convierta fechas o quite ceros). */
const COLS_TEXTO = ['Key', 'Fecha', 'Matricula', 'Clave', 'Salt', 'Hash', 'Grado', 'Grupo', 'Mes', 'Ciclo',
                    'Usuario', 'ClaseID', 'EstID', 'ActID', 'DocenteID', 'InscID', 'SegID', 'EsquemaID', 'Datos',
                    'Antes', 'Despues', 'Actualizado', 'Eliminado', 'Estado', 'TelTutor', 'Texto', 'ArchivoID',
                    'ArchivoNombre', 'Registro', 'Hoja', 'Operacion', 'Accion'];

const MODULOS = {
  docentes: 'Docentes y asignaturas', estudiantes: 'Estudiantes', asistencia: 'Asistencia',
  actividades: 'Actividades y calificaciones', reportes: 'Reportes', seguimiento: 'Seguimiento de estudiantes',
  comunicacion: 'Notificaciones a tutores', papelera: 'Papelera y restauración',
  usuarios: 'Usuarios', permisos: 'Permisos', bitacora: 'Bitácora de auditoría', config: 'Configuración'
};
/** Permisos base por rol: v=ver, c=crear, e=editar, d=eliminar */
const PERMISOS_BASE = {
  DOCENTE:  { docentes: 'v', estudiantes: 'vce', asistencia: 'vced', actividades: 'vced', reportes: 'v',
              seguimiento: 'vce', comunicacion: 'vc', papelera: 've' },
  AUXILIAR: { estudiantes: 'v', asistencia: 'vce', actividades: 'v', reportes: 'v', seguimiento: 'v' }
};

/** Valores iniciales de la hoja Config (solo se agregan las claves que falten). */
const CONFIG_DEF = {
  INSTITUCION: 'Nombre de la institución', ENCABEZADO2: 'Secretaría / Subsistema educativo', CCT: '',
  CICLO: '2026 - 2027', DIRECTOR: '', LOGO_ID: '',
  PESO_RETARDO: '0.5', PESO_JUSTIFICADA: '1', PESO_PERMISO: '1',
  UMBRAL_ASIS: '80', RESPALDOS_MAX: '14', BITACORA_DIAS: '365', CARPETA_RESP: '', CARPETA_EVID: ''
};

/* =============================== PUNTO DE ENTRADA ========================== */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(APP.TITULO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Inserta archivos parciales (css_*, js_*) en Index.html con <?!= include('js_core') ?> */
function include(nombre) {
  if (!/^(css|js)_[a-z]+$/.test(String(nombre))) throw new Error('Archivo no permitido.');
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* =============================== INSTALACIÓN =============================== */
/* Solo el propietario puede ejecutarlas desde el editor. */

function soloPropietario_() {
  const a = Session.getActiveUser().getEmail(), e = Session.getEffectiveUser().getEmail();
  if (!a || a !== e) throw new Error('Operación permitida solo al propietario del script desde el editor.');
}

/** Instala o ACTUALIZA la estructura (se puede ejecutar de nuevo tras cada actualización del código). */
function instalar() {
  soloPropietario_();
  const ss = SpreadsheetApp.openById(SHEET_ID);
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  Object.keys(ESQUEMA).forEach(n => prepararHoja_(ss.getSheetByName(n) || ss.insertSheet(n), n));
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(n => {
    const v = ss.getSheetByName(n);
    if (v && v.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(v);
  });
  Object.keys(ESQUEMA).forEach(invalida_);
  if (!leer_('Esquemas', true).length) agregar_('Esquemas', ESQ_DEF_OBJ);
  asegurarConfig_();
  asegurarPermisos_();
  if (!leer_('Usuarios', true).length) {
    const salt = uid_('s');
    agregar_('Usuarios', { Usuario: 'admin', Nombre: 'Administrador', Rol: 'ADMIN', DocenteID: '*', Salt: salt,
                           Hash: hash_('Admin2026*', salt), Activo: true, CambiarPass: true, Correo: '' });
  }
  migrar_();
  instalarTriggers();
  flushAud_('sistema', 'instalar');
  Logger.log('Instalación lista (v' + APP.VERSION + '). Usuario: admin | Contraseña: Admin2026* (se pedirá cambiarla).');
}

/** Solo migración de datos (la usa instalar). Útil si ya tienes datos de la versión 1. */
function migrar() {
  soloPropietario_();
  Object.keys(ESQUEMA).forEach(n => { const s = hojaOpt_(n); if (s) prepararHoja_(s, n); });
  Object.keys(ESQUEMA).forEach(invalida_);
  asegurarConfig_(); asegurarPermisos_(); migrar_();
  flushAud_('sistema', 'migrar');
  Logger.log('Migración completada.');
}

function migrar_() {
  // 1) Esquema de evaluación por defecto en asignaciones existentes.
  const sinEsq = leer_('Asignaciones', true).filter(a => !a.EsquemaID);
  if (sinEsq.length) actualizarVarios_('Asignaciones', sinEsq.map(a => ({ fila: a._fila, obj: { EsquemaID: ESQ_DEF } })));
  // 2) Inscripciones (historial por ciclo) a partir de los estudiantes existentes.
  if (!leer_('Inscripciones').length) {
    const ciclo = cicloInsc_();
    agregarVarios_('Inscripciones', leer_('Estudiantes', true).map(e => ({
      InscID: uid_('I-'), EstID: e.EstID, Ciclo: ciclo, Grado: e.Grado, Grupo: e.Grupo, NumLista: e.NumLista,
      Estado: bool_(e.Activo) ? 'ACTIVA' : 'BAJA' })));
  }
  marcarTodasSucias_();
}

function asegurarConfig_() {
  const ex = {}; leer_('Config').forEach(r => ex[r.Clave] = 1);
  const nuevas = Object.keys(CONFIG_DEF).filter(k => !ex[k]).map(k => ({ Clave: k, Valor: CONFIG_DEF[k] }));
  agregarVarios_('Config', nuevas);
}

function asegurarPermisos_() {
  const ex = leer_('Permisos'), roles = {}, hay = {};
  Object.keys(PERMISOS_BASE).forEach(r => roles[r] = 1);
  ex.forEach(p => { roles[norm_(p.Rol)] = 1; hay[norm_(p.Rol) + '|' + p.Modulo] = 1; });
  delete roles.ADMIN;
  const filas = [];
  Object.keys(roles).forEach(rol => Object.keys(MODULOS).forEach(m => {
    if (hay[rol + '|' + m]) return;
    const l = (PERMISOS_BASE[rol] || {})[m] || '';
    filas.push({ Rol: rol, Modulo: m, Ver: l.indexOf('v') >= 0, Crear: l.indexOf('c') >= 0,
                 Editar: l.indexOf('e') >= 0, Eliminar: l.indexOf('d') >= 0 });
  }));
  agregarVarios_('Permisos', filas);
}

/** Crea los disparadores: respaldo diario (2:00) y precálculo de resultados (cada 10 min). */
function instalarTriggers() {
  soloPropietario_();
  ScriptApp.getProjectTriggers().forEach(t => {
    const f = t.getHandlerFunction();
    if (f === 'triggerRespaldo_' || f === 'triggerResultados_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('triggerRespaldo_').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('triggerResultados_').timeBased().everyMinutes(10).create();
}
