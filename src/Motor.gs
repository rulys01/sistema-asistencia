/* ============================================================================
 *  MOTOR DE CÁLCULO + RESULTADOS PRECALCULADOS + INDICADORES
 * ========================================================================== */

/** Carga SOLO los datos de una clase (de las hojas del ciclo si está archivada). */
function motor_(c) {
  const sh = base => c.Archivada ? base + '_' + slug_(cicloDe_(c)) : base;
  return {
    per: leerPor_(sh('Periodos'), 'ClaseID', c.ClaseID),
    act: leerPor_(sh('Actividades'), 'ClaseID', c.ClaseID),
    asi: leerPor_(sh('Asistencia'), 'ClaseID', c.ClaseID),
    cal: leerPor_(sh('Calificaciones'), 'ClaseID', c.ClaseID)
  };
}

/** Normaliza un valor de asistencia: 1 presente, 0 falta, 'R' retardo, 'J' justificada, 'PM' permiso, null sin marca. */
function codAs_(v) {
  if (v === '' || v == null) return null;
  if (v === 1 || v === '1') return 1;
  if (v === 0 || v === '0') return 0;
  const s = String(v).toUpperCase();
  return (s === 'R' || s === 'J' || s === 'PM') ? s : null;
}

/**
 * Calificación de un parcial (función pura: no accede a hojas).
 *  Asistencia (0-10) = ROUND(asistencias ponderadas × 10 / total)  ·  puntos = asis10/10 × peso
 *  Calificación = (puntos asistencia + criterios generales + libreta ajustada a (100 - pesoGen)) / 10
 *  opt.pesosAs = valor de retardo / justificada / permiso (fracción de asistencia)
 */
function calcParcial_(M, c, t, pa, ests, opt) {
  const PA = (opt && opt.pesosAs) || PESOS_AS_DEF, ok = filtroCtx_(c, t, pa);
  const per = M.per.find(ok) || null;
  const total = per ? Number(per.TotalDias) || 0 : 0;
  const pesoAsis = per && per.PesoAsistencia !== '' && per.PesoAsistencia != null ? Number(per.PesoAsistencia) : 10;
  const acts = M.act.filter(ok).sort((a, b) => Number(a.Orden) - Number(b.Orden))
    .map(a => ({ ActID: a.ActID, Nombre: a.Nombre, Categoria: a.Categoria, Max: Number(a.Max) }));
  const gen = acts.filter(a => a.Categoria === 'GENERAL'), lib = acts.filter(a => a.Categoria === 'LIBRETA');
  const pesoGen = pesoAsis + gen.reduce((s, a) => s + a.Max, 0);
  const pesoLib = Math.max(0, 100 - pesoGen), maxLib = lib.reduce((s, a) => s + a.Max, 0);
  const asi = M.asi.filter(ok), cal = M.cal.filter(ok);
  const fechas = Array.from(new Set(asi.filter(a => codAs_(a.Valor) !== null).map(a => a.Fecha))).sort();
  const cm = {}; cal.forEach(r => cm[r.EstID + '|' + r.ActID] = r.Valor);
  const am = {}; asi.forEach(r => { const v = codAs_(r.Valor); if (v !== null) am[r.EstID + '|' + r.Fecha] = v; });
  const filas = ests.map(e => {
    let w = 0, pres = 0, ret = 0, jus = 0, pm = 0, fa = 0;
    fechas.forEach(f => {
      const v = am[e.EstID + '|' + f];
      if (v === 1) { w += 1; pres++; }
      else if (v === 0) fa++;
      else if (v === 'R') { w += PA.R; ret++; }
      else if (v === 'J') { w += PA.J; jus++; }
      else if (v === 'PM') { w += PA.PM; pm++; }
    });
    w = xround_(w, 2);
    const asis10 = total > 0 ? Math.min(10, xround_(w * 10 / total, 0)) : 0;
    const ptsAsis = asis10 / 10 * pesoAsis;
    const vals = {}, pts = {}; let sg = 0, sl = 0;
    gen.concat(lib).forEach(a => {
      const raw = cm[e.EstID + '|' + a.ActID];
      vals[a.ActID] = raw === undefined ? '' : raw;
      pts[a.ActID] = num_(raw, a.Max);
      if (a.Categoria === 'GENERAL') sg += pts[a.ActID]; else sl += pts[a.ActID];
    });
    const ptsL = maxLib > 0 ? sl * pesoLib / maxLib : 0;
    return { EstID: e.EstID, NumLista: Number(e.NumLista) || 0, Nombre: e.Nombre, Etiqueta: e.Etiqueta, Matricula: e.Matricula,
             presentes: pres, retardos: ret, justificadas: jus, permisos: pm, faltas: fa,
             pct: total > 0 ? Math.min(100, w / total * 100) : 0,
             pctSes: fechas.length ? Math.min(100, w / fechas.length * 100) : 100,
             asis10: asis10, ptsAsis: ptsAsis, vals: vals, pts: pts, califL: ptsL, gral: (ptsAsis + sg + ptsL) / 10,
             obs: cm[e.EstID + '|OBS'] || '' };
  });
  return { per: per ? { TotalDias: total, Mes: per.Mes, PesoAsistencia: pesoAsis } : null, total: total, pesoAsis: pesoAsis,
           pesoGen: pesoGen, pesoLib: pesoLib, maxLib: maxLib, acts: gen.concat(lib), fechas: fechas, am: am, filas: filas };
}

/**
 * Periodo = ROUND(promedio de sus parciales, 0). Final = suma de periodos / N (DecFinal decimales).
 * El número de periodos y parciales sale del esquema de evaluación de la asignatura.
 */
function calcAnual_(M, c, ests, esq, opt) {
  esq = esq || ESQ_DEF_OBJ;
  const N = Number(esq.NumPeriodos) || 3, NP = Number(esq.Parciales) || 2, dec = esq.DecFinal == null ? 1 : Number(esq.DecFinal);
  const R = {}; ests.forEach(e => R[e.EstID] = { trim: [], total: 0, n: 0 });
  for (let t = 1; t <= N; t++) {
    const ps = [];
    for (let pa = 1; pa <= NP; pa++) {
      if (!M.per.some(x => x.ClaseID === c.ClaseID && Number(x.Trimestre) === t && Number(x.Parcial) === pa)) { ps.push(null); continue; }
      const P = calcParcial_(M, c, t, pa, ests, opt), mp = {};
      P.filas.forEach(f => mp[f.EstID] = f.gral);
      ps.push(mp);
    }
    ests.forEach(e => {
      const g = ps.map(mp => mp ? mp[e.EstID] : null), v = g.filter(x => x !== null);
      const cal = v.length ? xround_(v.reduce((a, b) => a + b, 0) / v.length, 0) : null;
      R[e.EstID].trim.push({ p: g, cal: cal });
      if (cal !== null) { R[e.EstID].total += cal; R[e.EstID].n++; }
    });
  }
  ests.forEach(e => {
    const r = R[e.EstID];
    r.final = r.n ? xround_(r.total / (r.n === N ? N : r.n), dec) : null;
    r.provisional = r.n < N;
  });
  return R;
}

/* ============================================================================
 *  RESULTADOS PRECALCULADOS (hoja Resultados)
 *  Cada escritura marca la clase como "sucia"; se recalcula al consultarla o
 *  por el disparador triggerResultados_ (cada 10 minutos).
 * ========================================================================== */

function sucias_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('SUCIAS') || '[]'); } catch (e) { return []; }
}
function guardarSucias_(l) { PropertiesService.getScriptProperties().setProperty('SUCIAS', JSON.stringify(l)); }
function marcarSucias_(ids) {
  const l = sucias_(), s = new Set(l); let cambio = false;
  ids.forEach(id => { if (!s.has(id)) { l.push(id); s.add(id); cambio = true; } });
  if (cambio) guardarSucias_(l);
}
const marcarSucia_ = id => marcarSucias_([id]);
const estaSucia_ = id => sucias_().indexOf(id) >= 0;
function quitarSucia_(id) { const l = sucias_(), i = l.indexOf(id); if (i >= 0) { l.splice(i, 1); guardarSucias_(l); } }
function sucioGrupo_(grado, grupo) {
  marcarSucias_(leer_('Asignaciones').filter(a => mismoGrupo_(a, { Grado: grado, Grupo: grupo })).map(a => a.ClaseID));
}
function marcarTodasSucias_() { marcarSucias_(leer_('Asignaciones').map(a => a.ClaseID)); }

/** Recalcula y guarda los resultados de toda la clase. Debe ejecutarse dentro de conBloqueo_. */
function recalcClase_(c) {
  const ests = estudiantesDe_(c), esq = c.Esquema || esquemaDe_(c);
  const R = calcAnual_(motor_(c), c, ests, esq, { pesosAs: pesosAs_() }), ahora = ahora_();
  upsertFilas_('Resultados', ests.map(e => ({ Key: c.ClaseID + '|' + e.EstID, ClaseID: c.ClaseID, EstID: e.EstID,
                                              Datos: JSON.stringify(R[e.EstID]), Actualizado: ahora })));
  quitarSucia_(c.ClaseID);
  return R;
}
function parseRes_(rows) {
  const m = {};
  rows.forEach(r => { try { m[r.EstID] = JSON.parse(r.Datos); } catch (e) {} });
  return m;
}
/** Resultados de todos los estudiantes de la clase (recalcula solo si están desactualizados). */
function resultadosClase_(c) {
  let rows = leerPor_('Resultados', 'ClaseID', c.ClaseID);
  if (estaSucia_(c.ClaseID) || !rows.length) {
    conBloqueo_(() => recalcClase_(c));
    rows = leerPor_('Resultados', 'ClaseID', c.ClaseID);
  }
  return parseRes_(rows);
}
/** Resultado de un estudiante en una clase. */
function resultadoEst_(c, est) {
  if (!estaSucia_(c.ClaseID)) {
    const row = leerPor_('Resultados', 'EstID', est.EstID).find(r => r.ClaseID === c.ClaseID);
    if (row) { try { return JSON.parse(row.Datos); } catch (e) {} }
  }
  const m = resultadosClase_(c);
  if (m[est.EstID]) return m[est.EstID];
  return calcAnual_(motor_(c), c, [est], c.Esquema, { pesosAs: pesosAs_() })[est.EstID];
}
/** Disparador (cada 10 min): recalcula las clases con cambios pendientes. */
function triggerResultados_() {
  const ids = sucias_();
  if (!ids.length) return;
  const mapa = {}; leer_('Asignaciones').forEach(a => mapa[a.ClaseID] = claseObj_(a));
  const t0 = Date.now();
  for (let i = 0; i < ids.length; i++) {
    if (Date.now() - t0 > 240000) break;
    const c = mapa[ids[i]];
    if (!c) { quitarSucia_(ids[i]); continue; }
    try { conBloqueo_(() => recalcClase_(c)); } catch (e) { Logger.log('Resultados ' + ids[i] + ': ' + e.message); }
  }
}

/* ============================================================================
 *  BOLETA / CONSULTA DE INVITADO
 * ========================================================================== */

/** Materias de un estudiante en una inscripción (ciclo + grado + grupo) entre las clases dadas. */
function materiasDeEst_(est, ins, clases) {
  return clases.filter(c => mismoGrupo_(c, ins) && norm_(cicloDe_(c)) === norm_(ins.Ciclo)).map(c => {
    const R = resultadoEst_(c, est);
    return { asignatura: c.Asignatura, docente: c.Docente, ciclo: c.Ciclo, esq: c.Esquema,
             trim: R.trim, total: R.total, final: R.final, provisional: R.provisional };
  });
}
/** Inscripciones del estudiante (más reciente primero). Sin historial usa su grupo actual. */
function inscripcionesDe_(est) {
  let l = leer_('Inscripciones').filter(i => i.EstID === est.EstID && i.Estado !== 'BAJA')
    .map(i => ({ Ciclo: i.Ciclo, Grado: String(i.Grado), Grupo: String(i.Grupo) })).reverse();
  if (!l.length) l = [{ Ciclo: cicloInsc_(), Grado: String(est.Grado), Grupo: String(est.Grupo) }];
  return l;
}

/** Público: consulta de un solo estudiante con matrícula + clave de consulta (incluye historial por ciclo). */
function consultaInvitado(matricula, clave) {
  const cache = CacheService.getScriptCache(), k = 'G_' + norm_(matricula).slice(0, 40);
  if (Number(cache.get(k) || 0) >= APP.MAX_INTENTOS) return { ok: false, error: 'Demasiados intentos. Intenta de nuevo en 10 minutos.' };
  const egresados = new Set(leer_('Inscripciones').filter(i => i.Estado === 'EGRESADO').map(i => i.EstID));
  const e = leer_('Estudiantes').find(x => norm_(x.Matricula) === norm_(matricula) && (bool_(x.Activo) || egresados.has(x.EstID)));
  if (!matricula || !e || String(e.Clave) !== String(clave || '').trim()) {
    cache.put(k, String(Number(cache.get(k) || 0) + 1), APP.BLOQUEO_SEG);
    return { ok: false, error: 'Matrícula o clave de consulta incorrecta.' };
  }
  cache.remove(k);
  const cfg = config_(), clases = clasesDe_({ Rol: 'ADMIN', DocenteID: '*' });
  const ciclos = inscripcionesDe_(e).map(i => ({ ciclo: i.Ciclo, grado: i.Grado, grupo: i.Grupo, materias: materiasDeEst_(e, i, clases) }))
    .filter(x => x.materias.length);
  return { ok: true, data: {
    estudiante: { nombre: e.Nombre, grado: String(e.Grado), grupo: String(e.Grupo), matricula: e.Matricula },
    institucion: cfg.INSTITUCION || '', encabezado2: cfg.ENCABEZADO2 || '', cct: cfg.CCT || '',
    logo: logoUri_(), ciclos: ciclos } };
}

/* ============================================================================
 *  PANEL DE INDICADORES (inicio)
 * ========================================================================== */

function dashboardDatos_(u, p) {
  const cfg = config_(), umbral = cfgNum_(cfg, 'UMBRAL_ASIS', 80), opt = { pesosAs: pesosAs_(cfg) };
  const ciclo = String(p.Ciclo || cfg.CICLO || '').trim();
  const clases = clasesDe_(u).filter(c => !c.Archivada && (!ciclo || norm_(c.Ciclo) === norm_(ciclo))).slice(0, 20);
  const out = clases.map(c => {
    const M = motor_(c), ests = estudiantesDe_(c), esq = c.Esquema, tend = [];
    let ultimo = null;
    for (let t = 1; t <= esq.NumPeriodos; t++) for (let pa = 1; pa <= esq.Parciales; pa++) {
      if (!M.per.some(filtroCtx_(c, t, pa))) continue;
      const P = calcParcial_(M, c, t, pa, ests, opt);
      const hay = P.fechas.length > 0 || P.filas.some(f => Object.keys(f.vals).some(k => f.vals[k] !== ''));
      if (!hay || !P.filas.length) continue;
      const prom = P.filas.reduce((s, f) => s + f.gral, 0) / P.filas.length;
      tend.push({ label: (t) + 'T·P' + pa, prom: xround_(prom, 1) });
      ultimo = { t: t, pa: pa, P: P };
    }
    const riesgo = [];
    let aprobados = 0;
    if (ultimo) ultimo.P.filas.forEach(f => {
      const motivos = [];
      if (f.gral < esq.Aprobatoria) motivos.push('Calificación baja');
      else aprobados++;
      if (ultimo.P.fechas.length >= 3 && f.pctSes < umbral) motivos.push('Inasistencia');
      if (motivos.length) riesgo.push({ EstID: f.EstID, NumLista: f.NumLista, Nombre: f.Nombre, gral: xround_(f.gral, 1),
                                        pctSes: Math.round(f.pctSes), motivos: motivos });
    });
    const emails = {}; ests.forEach(e => emails[e.EstID] = emailValido_(e.CorreoTutor));
    riesgo.forEach(r => r.tutor = !!emails[r.EstID]);
    return { ClaseID: c.ClaseID, titulo: c.Asignatura + ' · ' + c.Grado + '° ' + c.Grupo, nEst: ests.length,
             prom: tend.length ? tend[tend.length - 1].prom : null,
             pctApr: ultimo && ests.length ? Math.round(aprobados / ests.length * 100) : null,
             tendencia: tend, riesgo: riesgo, t: ultimo ? ultimo.t : 1, pa: ultimo ? ultimo.pa : 1,
             aprobatoria: esq.Aprobatoria };
  });
  return { ciclo: ciclo, umbral: umbral, clases: out };
}
