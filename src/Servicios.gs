/* ============================================================================
 *  SERVICIOS: HTML seguro para PDF, respaldos, correo, archivos de Drive
 * ========================================================================== */

/* =============================== HTML SEGURO (PDF) ========================= */

const HTML_TAGS_OK_ = { html: 1, head: 1, meta: 1, title: 1, style: 1, body: 1, table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1,
  th: 1, td: 1, div: 1, span: 1, img: 1, br: 1, hr: 1, p: 1, b: 1, strong: 1, i: 1, em: 1, u: 1, h1: 1, h2: 1, h3: 1, h4: 1,
  small: 1, ul: 1, ol: 1, li: 1, col: 1, colgroup: 1 };
const HTML_VOID_ = { meta: 1, img: 1, br: 1, hr: 1, col: 1 };
const HTML_DROP_ = /<(script|iframe|object|embed|noscript|template|svg|math|form|textarea|link|base|applet|frameset)\b[\s\S]*?<\/\1\s*>/gi;

function cssSeguro_(css) {
  return String(css).replace(/@import[^;]*;?/gi, '').replace(/url\s*\([^)]*\)/gi, '').replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript\s*:/gi, '').replace(/behavior\s*:/gi, '').replace(/-moz-binding\s*:[^;}]*/gi, '').replace(/<[^>]*>/g, '');
}
function atributoSeguro_(tag, nombre, valor) {
  const v = String(valor == null ? '' : valor).trim();
  switch (nombre) {
    case 'class': return /^[\w\s\-]*$/.test(v) ? v : null;
    case 'style': return (/^[\w\s:;#%.,()'"\-!\/]*$/.test(v) && !/url\s*\(|expression|javascript|@import/i.test(v)) ? v : null;
    case 'colspan': case 'rowspan': return /^\d{1,2}$/.test(v) ? v : null;
    case 'width': case 'height': return /^\d+(\.\d+)?(px|%|mm|pt)?$/.test(v) ? v : null;
    case 'align': return /^(left|right|center|justify)$/i.test(v) ? v : null;
    case 'lang': return /^[a-zA-Z\-]{2,10}$/.test(v) ? v : null;
    case 'charset': return /^utf-8$/i.test(v) ? v : null;
    case 'alt': return v.slice(0, 200);
    case 'src': return (tag === 'img' && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(v)) ? v : null;
    default: return null;
  }
}
/** Divide el HTML en [{texto, tag}] respetando comillas dentro de las etiquetas (sin regex con retroceso). */
function tokenizarHtml_(s) {
  const toks = []; let i = 0, ini = 0; const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    if (!/[a-zA-Z\/]/.test(s.charAt(lt + 1))) { i = lt + 1; continue; }
    let j = lt + 1, q = '';
    while (j < n) {
      const ch = s.charAt(j);
      if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break;
      j++;
    }
    if (j >= n) { i = lt + 1; continue; }              // etiqueta sin cerrar: el "<" queda como texto
    toks.push({ texto: s.slice(ini, lt), tag: s.slice(lt + 1, j) });
    ini = j + 1; i = j + 1;
  }
  toks.push({ texto: s.slice(ini), tag: null });
  return toks;
}
/** Reconstruye el HTML usando SOLO etiquetas y atributos de la lista blanca. */
function sanitizarHtml_(html) {
  let s = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  let prev;
  do { prev = s; s = s.replace(HTML_DROP_, ''); } while (s !== prev);
  const out = []; let enStyle = false;
  tokenizarHtml_(s).forEach(tk => {
    out.push(enStyle ? cssSeguro_(tk.texto) : tk.texto.replace(/</g, '&lt;'));
    enStyle = false;
    if (tk.tag == null) return;
    const m = /^(\/?)([a-zA-Z][a-zA-Z0-9]*)([\s\S]*)$/.exec(tk.tag);
    if (!m) return;
    const cierre = m[1] === '/', nombre = m[2].toLowerCase();
    if (!HTML_TAGS_OK_[nombre]) return;
    if (cierre) { if (!HTML_VOID_[nombre]) out.push('</' + nombre + '>'); return; }
    let attrs = '';
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a;
    while ((a = re.exec(m[3])) !== null) {
      const val = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
      const ok = atributoSeguro_(nombre, a[1].toLowerCase(), val);
      if (ok !== null) attrs += ' ' + a[1].toLowerCase() + '="' + String(ok).replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"';
    }
    out.push('<' + nombre + attrs + '>');
    if (nombre === 'style') enStyle = true;
  });
  return '<!DOCTYPE html>' + out.join('');
}

/* =============================== CARPETAS Y RESPALDOS ====================== */

/** Devuelve (y crea si falta) una carpeta de Drive cuyo ID se guarda en Config. */
function carpeta_(claveCfg, nombre) {
  const id = String(config_()[claveCfg] || '').trim();
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const it = DriveApp.getFoldersByName(nombre), f = it.hasNext() ? it.next() : DriveApp.createFolder(nombre);
  setConfig_({ [claveCfg]: f.getId() });
  return f;
}

/** Copia de seguridad completa de la hoja de cálculo en Drive; conserva las últimas N copias. */
function crearRespaldo_(origen) {
  const ss = ss_(), tz = Session.getScriptTimeZone(), carpeta = carpeta_('CARPETA_RESP', 'Respaldos_Asistencia');
  const nombre = ('Respaldo_' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HHmm') + '_' + ss.getName()).slice(0, 100);
  const copia = DriveApp.getFileById(ss.getId()).makeCopy(nombre, carpeta);
  const max = Math.max(1, Math.round(cfgNum_(config_(), 'RESPALDOS_MAX', 14)));
  const archivos = []; const it = carpeta.getFiles();
  while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf('Respaldo_') === 0) archivos.push(f); }
  archivos.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  archivos.slice(max).forEach(f => f.setTrashed(true));
  aud_('Respaldo', 'RESPALDO', copia.getId(), null, { origen: origen, nombre: nombre });
  return { id: copia.getId(), nombre: nombre, url: copia.getUrl() };
}
function listarRespaldos_() {
  const carpeta = carpeta_('CARPETA_RESP', 'Respaldos_Asistencia'), out = [], it = carpeta.getFiles(), tz = Session.getScriptTimeZone();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('Respaldo_') === 0)
      out.push({ nombre: f.getName(), fecha: Utilities.formatDate(f.getDateCreated(), tz, 'yyyy-MM-dd HH:mm'), url: f.getUrl(), t: f.getDateCreated().getTime() });
  }
  return out.sort((a, b) => b.t - a.t).slice(0, 30).map(x => ({ nombre: x.nombre, fecha: x.fecha, url: x.url }));
}
/** Elimina de la bitácora los registros más antiguos que BITACORA_DIAS. */
function depurarBitacora_() {
  const dias = Math.max(30, Math.round(cfgNum_(config_(), 'BITACORA_DIAS', 365)));
  const corte = Utilities.formatDate(new Date(Date.now() - dias * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return borrarDonde_('Bitacora', o => String(o.Fecha) < corte);
}

/** Disparador diario (2:00): respaldo + depuración de bitácora. */
function triggerRespaldo_() {
  try { conBloqueo_(() => { crearRespaldo_('automatico'); depurarBitacora_(); }); }
  catch (e) { Logger.log('Respaldo automático falló: ' + e.message); logEvento_('sistema', 'RESPALDO_ERROR', String(e.message).slice(0, 200)); }
  flushAud_('sistema', 'respaldo.automatico');
}
/** Para ejecutar manualmente desde el editor. */
function respaldarAhora() { soloPropietario_(); const r = crearRespaldo_('manual'); flushAud_('sistema', 'respaldo.manual'); Logger.log(r.url); return r.url; }

/* =============================== ARCHIVOS ADJUNTOS (Seguimiento) =========== */

const MIME_OK_ = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'txt' };

function guardarAdjunto_(arch, estId) {
  if (!arch || !arch.b64) return null;
  const mime = String(arch.mime || '');
  if (!MIME_OK_[mime]) throw new Error('Tipo de archivo no permitido (usa PDF, imagen, Word o texto).');
  const bytes = Utilities.base64Decode(String(arch.b64));
  if (bytes.length > APP.ADJUNTO_MAX) throw new Error('El archivo no debe pesar más de 4 MB.');
  const nombre = String(arch.nombre || 'evidencia').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  const f = carpeta_('CARPETA_EVID', 'Evidencias_Asistencia').createFile(Utilities.newBlob(bytes, mime, estId + '_' + nombre));
  return { id: f.getId(), nombre: nombre };
}

/* =============================== CORREO A TUTORES ========================== */

function correoTutorHtml_(cfg, est, clase, tit, fila, esq, mensaje) {
  const calif = fila ? Math.round(fila.gral * 10) / 10 : null;
  const bajo = fila && fila.gral < esq.Aprobatoria;
  let html = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">' +
    '<h2 style="margin:0 0 4px">' + escH_(cfg.INSTITUCION || APP.TITULO) + '</h2>' +
    '<div style="color:#666;margin-bottom:14px">' + escH_(cfg.ENCABEZADO2 || '') + '</div>' +
    '<p>Estimado(a) ' + escH_(est.Tutor || 'padre, madre o tutor') + ':</p>' +
    '<p>Le compartimos el seguimiento de <b>' + escH_(est.Nombre) + '</b> (' + escH_(clase.Grado) + '° ' + escH_(clase.Grupo) +
    ') en <b>' + escH_(clase.Asignatura) + '</b> — ' + escH_(tit) + '.</p>';
  if (fila) html += '<table style="border-collapse:collapse;width:100%;margin:10px 0">' +
    '<tr><td style="border:1px solid #ccc;padding:6px">Calificación del parcial</td><td style="border:1px solid #ccc;padding:6px;font-weight:bold;color:' + (bajo ? '#c0392b' : '#198754') + '">' + calif + '</td></tr>' +
    '<tr><td style="border:1px solid #ccc;padding:6px">Asistencia (sesiones registradas)</td><td style="border:1px solid #ccc;padding:6px">' + Math.round(fila.pctSes) + '%</td></tr>' +
    '<tr><td style="border:1px solid #ccc;padding:6px">Faltas / retardos</td><td style="border:1px solid #ccc;padding:6px">' + fila.faltas + ' / ' + fila.retardos + '</td></tr></table>';
  if (fila && fila.obs) html += '<p><b>Observaciones del docente:</b> ' + escH_(fila.obs) + '</p>';
  if (mensaje) html += '<p style="white-space:pre-wrap">' + escH_(mensaje) + '</p>';
  return html + '<p style="color:#666;font-size:12px;margin-top:18px">Docente: ' + escH_(clase.Docente) + '</p></div>';
}

/* =============================== ELIMINACIÓN DEFINITIVA ==================== */

function purgarClase_(claseId) {
  HOJAS_CICLO.forEach(base => hojasDe_(base).forEach(n => borrarDonde_(n, o => o.ClaseID === claseId)));
  borrarDonde_('Resultados', o => o.ClaseID === claseId);
  borrarDonde_('Asignaciones', o => o.ClaseID === claseId);
}
function purgarEstudiante_(estId) {
  ['Asistencia', 'Calificaciones'].forEach(base => hojasDe_(base).forEach(n => borrarDonde_(n, o => o.EstID === estId)));
  borrarDonde_('Resultados', o => o.EstID === estId);
  borrarDonde_('Inscripciones', o => o.EstID === estId);
  leer_('Seguimiento', true).filter(s => s.EstID === estId && s.ArchivoID).forEach(s => { try { DriveApp.getFileById(s.ArchivoID).setTrashed(true); } catch (e) {} });
  borrarDonde_('Seguimiento', o => o.EstID === estId);
  borrarDonde_('Estudiantes', o => o.EstID === estId);
}
function purgarActividad_(actId) {
  hojasDe_('Calificaciones').forEach(n => borrarDonde_(n, o => o.ActID === actId));
  hojasDe_('Actividades').forEach(n => borrarDonde_(n, o => o.ActID === actId));
}
