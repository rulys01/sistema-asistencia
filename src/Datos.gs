/* ============================================================================
 *  CAPA DE DATOS (Google Sheets)
 *   · Caché versionada por hoja (CacheService) + memoria por ejecución
 *   · Lectura filtrada (leerPor_) que solo trae las filas de una clase
 *   · Hojas partidas por ciclo (Asistencia_2025_2026, ...)
 *   · Borrado lógico (columna Eliminado) con restauración
 *   · Bitácora de auditoría con valor anterior
 * ========================================================================== */

const MEMO_ = {};                 // memoria por ejecución
let AUD_ = [];                    // acumulador de auditoría de la ejecución
let AUD_ACTIVO_ = true;
let LOCK_ = false;
const NO_AUD_ = { Bitacora: 1, Resultados: 1 };

const esq_ = n => ESQUEMA[n] || ESQUEMA[String(n).split('_')[0]];
const slug_ = c => String(c || '').replace(/[^0-9A-Za-z]+/g, '_').replace(/^_+|_+$/g, '') || 'X';

/* ---------- Acceso a hojas ---------- */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function hojaOpt_(n) { return ss_().getSheetByName(n); }
function hoja_(n) {
  const s = hojaOpt_(n);
  if (!s) throw new Error('Falta la hoja "' + n + '". Ejecuta la función instalar().');
  const h = esq_(n);
  if (h && s.getMaxColumns() < h.length) s.insertColumnsAfter(s.getMaxColumns(), h.length - s.getMaxColumns());
  return s;
}
/** Crea (si no existe) una hoja partida por ciclo con los mismos encabezados. */
function hojaPartida_(nombre) {
  let s = hojaOpt_(nombre);
  if (!s) { s = ss_().insertSheet(nombre); prepararHoja_(s, String(nombre).split('_')[0]); }
  return s;
}
/** Encabezados, formato de texto y columnas nuevas (sin tocar los datos existentes). */
function prepararHoja_(s, base) {
  const h = ESQUEMA[base];
  if (s.getMaxColumns() < h.length) s.insertColumnsAfter(s.getMaxColumns(), h.length - s.getMaxColumns());
  const act = s.getLastRow() > 0 ? s.getRange(1, 1, 1, Math.max(1, s.getLastColumn())).getValues()[0] : [];
  for (let i = 0; i < h.length; i++) {
    const a = act[i];
    if (a !== undefined && a !== '' && String(a) !== h[i])
      throw new Error('La hoja "' + s.getName() + '" tiene en la columna ' + (i + 1) + ' el encabezado "' + a + '" y se esperaba "' + h[i] + '".');
  }
  for (let i = 0; i < h.length; i++) if (String(act[i] === undefined ? '' : act[i]) !== h[i]) s.getRange(1, i + 1).setValue(h[i]);
  s.getRange(1, 1, 1, h.length).setFontWeight('bold').setBackground('#0d6efd').setFontColor('#ffffff');
  s.setFrozenRows(1);
  h.forEach((c, i) => { if (COLS_TEXTO.indexOf(c) >= 0) s.getRange(1, i + 1, s.getMaxRows(), 1).setNumberFormat('@'); });
}
function asegurarFilas_(s, necesarias) {
  if (s.getMaxRows() < necesarias) s.insertRowsAfter(s.getMaxRows(), necesarias - s.getMaxRows() + 100);
}

/** Evita que un texto se interprete como fórmula. */
function limpiar_(v) { return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v; }
function fila_(n, o, base) { return esq_(n).map((c, i) => o[c] === undefined ? (base ? base[i] : '') : limpiar_(o[c])); }
function filaObj_(h, f, fila, tz) {
  const o = { _fila: fila };
  h.forEach((c, j) => { let v = f[j]; if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd'); o[c] = v; });
  return o;
}

/* ---------- Caché versionada ---------- */

function ver_(n) {
  const c = CacheService.getScriptCache(); let v = c.get('V_' + n);
  if (!v) { v = Date.now() + '.' + Math.floor(Math.random() * 1e6); c.put('V_' + n, v, 21600); }
  return v;
}
function invalida_(n) { CacheService.getScriptCache().put('V_' + n, Date.now() + '.' + Math.floor(Math.random() * 1e6), 21600); }

function cachePutJson_(key, obj) {
  const json = JSON.stringify(obj), SZ = APP.CACHE_CHUNK, n = Math.ceil(json.length / SZ) || 1;
  if (n > APP.CACHE_MAX_CHUNKS) return false;
  const m = {}; for (let i = 0; i < n; i++) m[key + '#' + i] = json.substr(i * SZ, SZ);
  m[key + '#n'] = String(n);
  try { CacheService.getScriptCache().putAll(m, 21600); return true; } catch (e) { return false; }
}
function cacheGetJson_(key) {
  const c = CacheService.getScriptCache(), n = Number(c.get(key + '#n') || 0);
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(key + '#' + i);
  const m = c.getAll(keys); let s = '';
  for (let i = 0; i < n; i++) { const p = m[key + '#' + i]; if (p == null) return null; s += p; }
  try { return JSON.parse(s); } catch (e) { return null; }
}

/* ---------- Lectura ---------- */

function leerRaw_(n) {
  const s = hoja_(n), ult = s.getLastRow(), h = esq_(n);
  if (ult < 2) return [];
  const tz = Session.getScriptTimeZone();
  return s.getRange(2, 1, ult - 1, h.length).getValues().map((f, i) => filaObj_(h, f, i + 2, tz));
}
const vivos_ = (n, rows) => esq_(n).indexOf('Eliminado') >= 0 ? rows.filter(r => !r.Eliminado) : rows;

/** Lee una hoja completa (con caché). Por defecto omite los registros eliminados lógicamente. */
function leer_(n, incluirEliminados) {
  const k = n + '|' + ver_(n);
  let rows = MEMO_[k];
  if (!rows) {
    rows = cacheGetJson_('D|' + k);
    if (!rows) { rows = leerRaw_(n); cachePutJson_('D|' + k, rows); }
    MEMO_[k] = rows;
  }
  return incluirEliminados ? rows : vivos_(n, rows);
}

/** Lee SOLO las filas donde campo == valor (p. ej. ClaseID). Es lo que se usa para Asistencia y Calificaciones. */
function leerPor_(n, campo, valor, incluirEliminados) {
  const k = n + '|' + campo + '|' + valor + '|' + ver_(n);
  let rows = MEMO_[k];
  if (!rows) {
    rows = cacheGetJson_('P|' + k);
    if (!rows) { rows = leerPorRaw_(n, campo, valor); cachePutJson_('P|' + k, rows); }
    MEMO_[k] = rows;
  }
  return incluirEliminados ? rows : vivos_(n, rows);
}
function leerPorRaw_(n, campo, valor) {
  const s = hojaOpt_(n);
  if (!s) return [];
  const h = esq_(n), ult = s.getLastRow(), col = h.indexOf(campo) + 1;
  if (ult < 2 || col < 1) return [];
  const colVals = s.getRange(2, col, ult - 1, 1).getValues(), runs = [], v = String(valor);
  let ini = -1;
  for (let i = 0; i < colVals.length; i++) {
    const ok = String(colVals[i][0]) === v;
    if (ok && ini < 0) ini = i;
    if (!ok && ini >= 0) { runs.push([ini, i - 1]); ini = -1; }
  }
  if (ini >= 0) runs.push([ini, colVals.length - 1]);
  if (!runs.length) return [];
  const tz = Session.getScriptTimeZone(), out = [];
  if (runs.length > 25) {                      // muchas franjas: más barato leer todo y filtrar
    s.getRange(2, 1, ult - 1, h.length).getValues().forEach((f, i) => { if (String(f[col - 1]) === v) out.push(filaObj_(h, f, i + 2, tz)); });
  } else {
    runs.forEach(r => s.getRange(r[0] + 2, 1, r[1] - r[0] + 1, h.length).getValues()
      .forEach((f, j) => out.push(filaObj_(h, f, r[0] + 2 + j, tz))));
  }
  return out;
}

/* ---------- Auditoría ---------- */

function audLimpia_(o) {
  if (o == null || typeof o !== 'object') return o;
  if (Array.isArray(o)) return o.map(audLimpia_);
  const r = {};
  Object.keys(o).forEach(k => {
    if (k === '_fila') return;
    r[k] = (k === 'Hash' || k === 'Salt' || k === 'Clave') ? '***' : audLimpia_(o[k]);
  });
  return r;
}
function aud_(hoja, op, reg, antes, despues) {
  if (!AUD_ACTIVO_ || NO_AUD_[String(hoja).split('_')[0]]) return;
  if (AUD_.length > 1500) return;
  AUD_.push({ hoja: hoja, op: op, reg: String(reg == null ? '' : reg), antes: audLimpia_(antes), despues: audLimpia_(despues) });
}
function audBorrado_(n, h, filas, op) {
  if (!AUD_ACTIVO_ || NO_AUD_[String(n).split('_')[0]]) return;
  const aObj = f => { const o = {}; h.forEach((c, j) => o[c] = f[j]); return o; };
  if (filas.length <= 10) filas.forEach(f => aud_(n, op, f[0], aObj(f), null));
  else aud_(n, op + '_MASIVA', '(' + filas.length + ' filas)', { muestra: filas.slice(0, 3).map(aObj) }, null);
}
const ahora_ = () => Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
const jsonAud_ = o => o == null ? '' : JSON.stringify(o).slice(0, 4000);

/** Escribe en la hoja Bitacora todo lo acumulado durante la ejecución. */
function flushAud_(usuario, accion) {
  if (!AUD_.length) return;
  let lista = AUD_; AUD_ = [];
  if (lista.length > 300) {
    const extra = lista.length - 300;
    lista = lista.slice(0, 300); lista.push({ hoja: '*', op: 'RESUMEN', reg: '', antes: null, despues: { omitidos: extra } });
  }
  const f = ahora_();
  try {
    agregarVarios_('Bitacora', lista.map(x => ({ Fecha: f, Usuario: usuario, Accion: accion, Hoja: x.hoja, Operacion: x.op,
      Registro: x.reg, Antes: jsonAud_(x.antes), Despues: jsonAud_(x.despues) })), true);
  } catch (e) { Logger.log('No se pudo escribir la bitácora: ' + e.message); }
}

/** Evento suelto (inicio de sesión, recuperación...). Limitado para que no se llene por ataques. */
function logEvento_(usuario, accion, detalle) {
  try {
    const c = CacheService.getScriptCache(), n = Number(c.get('LOGE') || 0);
    if (n > 200) return;
    c.put('LOGE', String(n + 1), 600);
    agregar_('Bitacora', { Fecha: ahora_(), Usuario: usuario, Accion: accion, Hoja: '', Operacion: 'EVENTO', Registro: '',
                           Antes: '', Despues: detalle || '' });
  } catch (e) {}
}

/* ---------- Escritura ---------- */

function agregar_(n, o) {
  const h = esq_(n);
  hoja_(n).appendRow(fila_(n, o));
  invalida_(n);
  aud_(n, 'ALTA', o[h[0]], null, o);
}
function agregarVarios_(n, lista, sinAud) {
  if (!lista.length) return;
  const s = hoja_(n), h = esq_(n), ult = s.getLastRow();
  asegurarFilas_(s, ult + lista.length);
  s.getRange(ult + 1, 1, lista.length, h.length).setValues(lista.map(o => fila_(n, o)));
  invalida_(n);
  if (!sinAud) {
    if (lista.length <= 10) lista.forEach(o => aud_(n, 'ALTA', o[h[0]], null, o));
    else aud_(n, 'ALTA_MASIVA', '(' + lista.length + ' filas)', null, { muestra: lista.slice(0, 3) });
  }
}
function actualizar_(n, fila, o) {
  const s = hoja_(n), h = esq_(n), r = s.getRange(fila, 1, 1, h.length), base = r.getValues()[0];
  const nueva = fila_(n, o, base), antes = {}, despues = {};
  h.forEach((c, i) => { if (String(base[i]) !== String(nueva[i])) { antes[c] = base[i]; despues[c] = nueva[i]; } });
  if (!Object.keys(despues).length) return;
  r.setValues([nueva]);
  invalida_(n);
  aud_(n, 'CAMBIO', base[0], antes, despues);
}
/** pares = [{fila, obj}] ; lee y escribe el bloque una sola vez. */
function actualizarVarios_(n, pares) {
  if (!pares.length) return;
  const s = hoja_(n), h = esq_(n), ult = s.getLastRow();
  if (ult < 2) return;
  const rng = s.getRange(2, 1, ult - 1, h.length), vals = rng.getValues();
  let cambios = 0;
  pares.forEach(p => {
    const i = p.fila - 2;
    if (i < 0 || i >= vals.length) return;
    const base = vals[i], nueva = fila_(n, p.obj, base), antes = {}, despues = {};
    h.forEach((c, j) => { if (String(base[j]) !== String(nueva[j])) { antes[c] = base[j]; despues[c] = nueva[j]; } });
    if (Object.keys(despues).length) { vals[i] = nueva; cambios++; aud_(n, 'CAMBIO', base[0], antes, despues); }
  });
  if (cambios) { rng.setValues(vals); invalida_(n); }
}
/** Elimina FÍSICAMENTE todas las filas que cumplan el predicado (reescribe la hoja una sola vez). */
function borrarDonde_(n, pred) {
  const s = hoja_(n), h = esq_(n), ult = s.getLastRow();
  if (ult < 2) return 0;
  const rng = s.getRange(2, 1, ult - 1, h.length), vals = rng.getValues(), borrar = [], keep = [];
  vals.forEach(f => { const o = {}; h.forEach((c, j) => o[c] = f[j]); (pred(o) ? borrar : keep).push(f); });
  if (!borrar.length) return 0;
  rng.clearContent();
  if (keep.length) s.getRange(2, 1, keep.length, h.length).setValues(keep);
  invalida_(n);
  audBorrado_(n, h, borrar, 'BAJA_FISICA');
  return borrar.length;
}
/** Borrado LÓGICO: marca la columna Eliminado con la fecha (o la limpia si restaurar = true). */
function marcarElim_(n, pred, restaurar) {
  const s = hoja_(n), h = esq_(n), ult = s.getLastRow(), ci = h.indexOf('Eliminado');
  if (ult < 2 || ci < 0) return 0;
  const vals = s.getRange(2, 1, ult - 1, h.length).getValues(), col = s.getRange(2, ci + 1, ult - 1, 1), nuevos = col.getValues(), ids = [];
  const marca = ahora_();
  vals.forEach((f, i) => {
    const o = {}; h.forEach((c, j) => o[c] = f[j]);
    if (!pred(o)) return;
    const ya = !!o.Eliminado;
    if (restaurar ? ya : !ya) { nuevos[i][0] = restaurar ? '' : marca; ids.push(f[0]); }
  });
  if (!ids.length) return 0;
  col.setValues(nuevos); invalida_(n);
  ids.slice(0, 50).forEach(id => aud_(n, restaurar ? 'RESTAURAR' : 'BAJA_LOGICA', id, null, null));
  return ids.length;
}
/** Inserta o actualiza (por Key) el campo Valor de forma masiva y registra solo lo que cambió. */
function upsert_(n, filas) {
  const u = {}; filas.forEach(o => u[o.Key] = o);
  filas = Object.keys(u).map(k => u[k]);
  if (!filas.length) return;
  const h = esq_(n), s = hoja_(n), ult = s.getLastRow(), iVal = h.indexOf('Valor') + 1, mapa = {};
  let vals = [];
  if (ult > 1) {
    s.getRange(2, 1, ult - 1, 1).getValues().forEach((f, i) => mapa[f[0]] = i);
    vals = s.getRange(2, iVal, ult - 1, 1).getValues();
  }
  const nuevas = [], idx = [];
  filas.forEach(o => {
    const i = mapa[o.Key], nv = limpiar_(o.Valor);
    if (i !== undefined) {
      const ant = vals[i][0];
      if (String(ant) !== String(nv)) { aud_(n, 'CAMBIO', o.Key, { Valor: ant }, { Valor: nv }); vals[i][0] = nv; idx.push(i); }
    } else if (o.Valor !== '') { nuevas.push(o); aud_(n, 'ALTA', o.Key, null, { Valor: o.Valor }); }
  });
  if (idx.length) {
    if (idx.length <= 6) idx.forEach(i => s.getRange(i + 2, iVal).setValue(vals[i][0]));
    else s.getRange(2, iVal, ult - 1, 1).setValues(vals);
  }
  agregarVarios_(n, nuevas, true);
  invalida_(n);
}
/** Inserta o reemplaza filas completas identificadas por Key (se usa en Resultados). */
function upsertFilas_(n, filas) {
  if (!filas.length) return;
  const s = hoja_(n), ult = s.getLastRow(), mapa = {};
  if (ult > 1) s.getRange(2, 1, ult - 1, 1).getValues().forEach((f, i) => mapa[f[0]] = i + 2);
  const nuevas = [], exist = [];
  filas.forEach(o => { const r = mapa[o.Key]; if (r) exist.push({ fila: r, obj: o }); else nuevas.push(o); });
  actualizarVarios_(n, exist);
  agregarVarios_(n, nuevas, true);
}
/** Mueve filas entre hojas del mismo esquema (archivado de ciclos). */
function moverFilas_(origen, destino, pred) {
  const so = hojaOpt_(origen);
  if (!so) return 0;
  const base = String(origen).split('_')[0], h = ESQUEMA[base], ult = so.getLastRow();
  if (ult < 2) return 0;
  const rng = so.getRange(2, 1, ult - 1, h.length), vals = rng.getValues(), mover = [], keep = [];
  vals.forEach(f => { const o = {}; h.forEach((c, j) => o[c] = f[j]); (pred(o) ? mover : keep).push(f); });
  if (!mover.length) return 0;
  const sd = hojaPartida_(destino), ud = sd.getLastRow();
  asegurarFilas_(sd, ud + mover.length);
  sd.getRange(ud + 1, 1, mover.length, h.length).setValues(mover);      // primero se copia...
  rng.clearContent();                                                    // ...y luego se quita del origen
  if (keep.length) so.getRange(2, 1, keep.length, h.length).setValues(keep);
  invalida_(origen); invalida_(destino);
  return mover.length;
}
/** Hojas de una entidad: la principal + las partidas por ciclo. */
function hojasDe_(base) {
  return ss_().getSheets().map(s => s.getName()).filter(nm => nm === base || nm.indexOf(base + '_') === 0);
}

/** Bloqueo global (reentrante dentro de una misma ejecución). */
function conBloqueo_(fn) {
  if (LOCK_) return fn();
  const l = LockService.getScriptLock();
  l.waitLock(25000);
  LOCK_ = true;
  try { return fn(); } finally { LOCK_ = false; l.releaseLock(); }
}
