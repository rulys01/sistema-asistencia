/* ============================================================================
 *  API PRIVADA
 *  ACCIONES[nombre] = [módulo, permiso (o función(p)), escribe?, función(usuario, parámetros)]
 *  Las acciones que escriben se ejecutan con bloqueo y su auditoría se guarda en Bitacora.
 * ========================================================================== */

/** Verifica que un esquema nuevo no deje fuera datos ya capturados de esa clase. */
function validarEsqVsDatos_(claseId, esq) {
  if (leerPor_('Periodos', 'ClaseID', claseId).some(r => Number(r.Trimestre) > esq.NumPeriodos || Number(r.Parcial) > esq.Parciales))
    throw new Error('Esa asignatura ya tiene datos en periodos o parciales que el esquema elegido no contempla.');
}
const tituloPer_ = x => x.t + '.º ' + String(x.esq.NombrePeriodo).toLowerCase() + ' · parcial ' + x.pa;

const ACCIONES = {

  'init': [null, null, false, u => {
    const c = config_();
    return { usuario: { usuario: u.Usuario, nombre: u.Nombre, rol: u.Rol, cambiarPass: bool_(u.CambiarPass) && !u._google,
                        google: !!u._google, correo: u.Correo || '' },
             permisos: permisos_(u.Rol), config: cfgPublica_(c), logo: logoUri_(), clases: clasesDe_(u),
             esquemas: esquemas_().map(normEsq_), version: APP.VERSION };
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
        Grado: String(a.Grado), Grupo: String(a.Grupo), Ciclo: cicloDe_(a), Activo: bool_(a.Activo),
        Archivada: bool_(a.Archivada), EsquemaID: a.EsquemaID || ESQ_DEF }))
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
    if (marcarElim_('Docentes', o => o.DocenteID === p.DocenteID) < 1) throw new Error('Docente no encontrado.');
    return true;
  }],
  'docentes.guardarAsig': ['docentes', p => p.ClaseID ? 'editar' : 'crear', true, (u, p) => {
    const todo = esTodo_(u), doc = todo ? String(p.DocenteID || '') : u.DocenteID;
    if (!leer_('Docentes').some(d => d.DocenteID === doc)) throw new Error('Selecciona un docente válido.');
    const esqId = String(p.EsquemaID || ESQ_DEF);
    if (!esquemas_().some(e => e.EsquemaID === esqId)) throw new Error('Esquema de evaluación no válido.');
    const o = { DocenteID: doc, Asignatura: String(p.Asignatura || '').trim(), Grado: String(p.Grado || '').trim(),
                Grupo: String(p.Grupo || '').trim().toUpperCase(), Ciclo: String(p.Ciclo || '').trim(), Activo: p.Activo !== false,
                EsquemaID: esqId };
    if (!o.Asignatura || !o.Grado || !o.Grupo) throw new Error('Asignatura, grado y grupo son obligatorios.');
    if (p.ClaseID) {
      const a = leer_('Asignaciones').find(x => x.ClaseID === p.ClaseID && (todo || x.DocenteID === u.DocenteID));
      if (!a) throw new Error('Asignación no encontrada.');
      if (bool_(a.Archivada)) throw new Error('La asignación pertenece a un ciclo archivado.');
      if (esqId !== (a.EsquemaID || ESQ_DEF)) validarEsqVsDatos_(a.ClaseID, normEsq_(esquemas_().find(e => e.EsquemaID === esqId)));
      delete o.Ciclo; if (String(p.Ciclo || '').trim()) o.Ciclo = String(p.Ciclo).trim();
      actualizar_('Asignaciones', a._fila, o); marcarSucia_(a.ClaseID); return a.ClaseID;
    }
    o.ClaseID = uid_('C-'); o.Archivada = false; agregar_('Asignaciones', o); return o.ClaseID;
  }],
  'docentes.eliminarAsig': ['docentes', 'eliminar', true, (u, p) => {
    const a = leer_('Asignaciones').find(x => x.ClaseID === p.ClaseID && (esTodo_(u) || x.DocenteID === u.DocenteID));
    if (!a) throw new Error('Asignación no encontrada.');
    marcarElim_('Asignaciones', o => o.ClaseID === a.ClaseID);      // los datos se conservan (se puede restaurar)
    return true;
  }],

  /* ---------- Estudiantes ---------- */
  'estudiantes.listar': ['estudiantes', 'ver', false, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    return leer_('Estudiantes').filter(e => mismoGrupo_(e, p)).sort(ordenLista_)
      .map(e => ({ EstID: e.EstID, Matricula: e.Matricula, Clave: e.Clave, NumLista: Number(e.NumLista) || 0, Nombre: e.Nombre,
                   Etiqueta: e.Etiqueta, Activo: bool_(e.Activo), Tutor: e.Tutor || '', CorreoTutor: e.CorreoTutor || '',
                   TelTutor: e.TelTutor || '' }));
  }],
  'estudiantes.guardar': ['estudiantes', p => p.EstID ? 'editar' : 'crear', true, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    const nombre = String(p.Nombre || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (nombre.length < 3) throw new Error('Escribe el nombre del estudiante.');
    const todos = leer_('Estudiantes', true), mat = String(p.Matricula || '').trim();
    if (mat && todos.some(e => norm_(e.Matricula) === norm_(mat) && e.EstID !== p.EstID)) throw new Error('Esa matrícula ya está registrada.');
    const correo = String(p.CorreoTutor || '').trim();
    if (correo && !emailValido_(correo)) throw new Error('El correo del tutor no es válido.');
    const o = { Nombre: nombre, Grado: p.Grado, Grupo: p.Grupo, Etiqueta: String(p.Etiqueta || '').trim(), Activo: p.Activo !== false,
                Tutor: String(p.Tutor || '').trim().slice(0, 100), CorreoTutor: correo, TelTutor: String(p.TelTutor || '').trim().slice(0, 20) };
    if (mat) o.Matricula = mat;
    if (p.NumLista) o.NumLista = Number(p.NumLista);
    if (p.EstID) {
      const e = todos.find(x => x.EstID === p.EstID && !x.Eliminado);
      if (!e) throw new Error('Estudiante no encontrado.');
      exigePar_(u, e.Grado, e.Grupo);
      actualizar_('Estudiantes', e._fila, o);
      sincInsc_([Object.assign({}, e, o)]); sucioGrupo_(e.Grado, e.Grupo);
      return e.EstID;
    }
    const mismos = todos.filter(e => !e.Eliminado && mismoGrupo_(e, p));
    o.NumLista = o.NumLista || mismos.reduce((m, e) => Math.max(m, Number(e.NumLista) || 0), 0) + 1;
    o.EstID = uid_('E-'); o.Clave = claveAleatoria_();
    if (!o.Matricula) o.Matricula = matriculaAuto_(p.Grado, p.Grupo, o.NumLista, todos);
    agregar_('Estudiantes', o); sincInsc_([o]); sucioGrupo_(p.Grado, p.Grupo);
    return o.EstID;
  }],
  'estudiantes.eliminar': ['estudiantes', 'eliminar', true, (u, p) => {
    const e = exigeEstudiante_(u, p.EstID);
    marcarElim_('Estudiantes', o => o.EstID === e.EstID);           // sus calificaciones y asistencias se conservan
    sucioGrupo_(e.Grado, e.Grupo);
    return true;
  }],
  'estudiantes.importar': ['estudiantes', 'crear', true, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    const nombres = String(p.Texto || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 200);
    if (!nombres.length) throw new Error('Pega al menos un nombre (uno por renglón).');
    const n = importarNombres_(p.Grado, p.Grupo, nombres);
    sucioGrupo_(p.Grado, p.Grupo); return n;
  }],
  'estudiantes.clave': ['estudiantes', 'editar', true, (u, p) => {
    const e = exigeEstudiante_(u, p.EstID);
    const c = claveAleatoria_(); actualizar_('Estudiantes', e._fila, { Clave: c }); return c;
  }],
  'estudiantes.ordenar': ['estudiantes', 'editar', true, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    const lista = leer_('Estudiantes').filter(e => bool_(e.Activo) && mismoGrupo_(e, p))
      .sort((a, b) => String(a.Nombre).localeCompare(String(b.Nombre), 'es'));
    actualizarVarios_('Estudiantes', lista.map((e, i) => ({ fila: e._fila, obj: { NumLista: i + 1 } })));
    sincInsc_(lista.map((e, i) => Object.assign({}, e, { NumLista: i + 1 })));
    sucioGrupo_(p.Grado, p.Grupo);
    return lista.length;
  }],
  /** Promueve un grupo completo al siguiente grado/ciclo conservando el historial en Inscripciones. */
  'estudiantes.promover': ['estudiantes', 'editar', true, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    const cicloNuevo = String(p.NuevoCiclo || '').trim(), egresar = !!p.Egresar;
    const ng = String(p.NuevoGrado || '').trim(), ngr = String(p.NuevoGrupo || '').trim().toUpperCase();
    if (!cicloNuevo) throw new Error('Indica el ciclo escolar nuevo.');
    if (!egresar && (!ng || !ngr)) throw new Error('Indica el nuevo grado y grupo.');
    const todos = leer_('Estudiantes'), ins = leer_('Inscripciones');
    const orig = todos.filter(e => bool_(e.Activo) && mismoGrupo_(e, p)).sort(ordenLista_);
    if (!orig.length) throw new Error('No hay estudiantes activos en ese grupo.');
    if (!egresar && mismoGrupo_({ Grado: ng, Grupo: ngr }, p) && norm_(cicloNuevo) === norm_(cicloInsc_()) && !p.CambiarCiclo)
      throw new Error('El destino es igual al origen. Cambia el grado, el grupo o el ciclo.');
    let num = egresar ? 0 : todos.filter(e => mismoGrupo_(e, { Grado: ng, Grupo: ngr })).reduce((m, e) => Math.max(m, Number(e.NumLista) || 0), 0);
    const updIns = [], nuevas = [], updEst = [];
    orig.forEach(e => {
      const prev = ins.filter(i => i.EstID === e.EstID && mismoGrupo_(i, e)).pop();
      if (prev) updIns.push({ fila: prev._fila, obj: { Estado: egresar ? 'EGRESADO' : 'PROMOVIDO' } });
      if (egresar) updEst.push({ fila: e._fila, obj: { Activo: false } });
      else {
        num++;
        nuevas.push({ InscID: uid_('I-'), EstID: e.EstID, Ciclo: cicloNuevo, Grado: ng, Grupo: ngr, NumLista: num, Estado: 'ACTIVA' });
        updEst.push({ fila: e._fila, obj: { Grado: ng, Grupo: ngr, NumLista: num } });
      }
    });
    actualizarVarios_('Inscripciones', updIns); agregarVarios_('Inscripciones', nuevas); actualizarVarios_('Estudiantes', updEst);
    if (p.CambiarCiclo && norm_(cicloNuevo) !== norm_(config_().CICLO)) setConfig_({ CICLO: cicloNuevo });
    sucioGrupo_(p.Grado, p.Grupo); if (!egresar) sucioGrupo_(ng, ngr);
    return { promovidos: orig.length };
  }],
  'estudiantes.credenciales': ['estudiantes', 'ver', false, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    const c = config_();
    return { cfg: { INSTITUCION: c.INSTITUCION, ENCABEZADO2: c.ENCABEZADO2, CCT: c.CCT, CICLO: c.CICLO }, logo: logoUri_(),
             lista: leer_('Estudiantes').filter(e => bool_(e.Activo) && mismoGrupo_(e, p)).sort(ordenLista_)
               .map(e => ({ EstID: e.EstID, Matricula: e.Matricula, Clave: e.Clave, NumLista: Number(e.NumLista) || 0, Nombre: e.Nombre,
                            Grado: String(e.Grado), Grupo: String(e.Grupo) })) };
  }],

  /* ---------- Asistencia ---------- */
  'asistencia.cargar': ['asistencia', 'ver', false, (u, p) => {
    const x = ctx_(u, p), ests = estudiantesDe_(x.c), M = motor_(x.c);
    const P = calcParcial_(M, x.c, x.t, x.pa, ests, { pesosAs: pesosAs_() }), marcas = {};
    M.asi.filter(filtroCtx_(x.c, x.t, x.pa)).forEach(r => { const v = codAs_(r.Valor); if (r.Fecha === p.Fecha && v !== null) marcas[r.EstID] = v; });
    const resumen = {};
    P.filas.forEach(f => resumen[f.EstID] = { p: f.presentes, r: f.retardos, j: f.justificadas, pm: f.permisos, f: f.faltas, pct: f.pct });
    return { periodo: P.per, total: P.total, fechas: P.fechas, marcas: marcas, resumen: resumen, estudiantes: ests.map(estLite_) };
  }],
  'asistencia.periodo': ['asistencia', 'editar', true, (u, p) => {
    const x = ctx_(u, p); exigeEscritura_(x.c);
    const total = Math.round(Number(p.TotalDias));
    if (!(total >= 1 && total <= 300)) throw new Error('El número de asistencias debe estar entre 1 y 300.');
    const peso = (p.PesoAsistencia === '' || p.PesoAsistencia == null) ? 10 : Number(p.PesoAsistencia);
    if (isNaN(peso) || peso < 0 || peso > 100) throw new Error('El peso de la asistencia debe estar entre 0 y 100.');
    const key = [x.c.ClaseID, x.t, x.pa].join('|'), ok = filtroCtx_(x.c, x.t, x.pa);
    const gen = leerPor_('Actividades', 'ClaseID', x.c.ClaseID).filter(a => ok(a) && a.Categoria === 'GENERAL').reduce((s, a) => s + Number(a.Max), 0);
    if (peso + gen > 100) throw new Error('Los puntos de los criterios generales no pueden superar 100.');
    const o = { Key: key, ClaseID: x.c.ClaseID, Trimestre: x.t, Parcial: x.pa, TotalDias: total, Mes: String(p.Mes || '').trim(), PesoAsistencia: peso };
    const ex = leerPor_('Periodos', 'ClaseID', x.c.ClaseID).find(r => r.Key === key);
    if (ex) actualizar_('Periodos', ex._fila, o); else agregar_('Periodos', o);
    marcarSucia_(x.c.ClaseID);
    return true;
  }],
  'asistencia.guardar': ['asistencia', 'editar', true, (u, p) => {
    const x = ctx_(u, p); exigeEscritura_(x.c);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.Fecha))) throw new Error('Fecha no válida.');
    if (!leerPor_('Periodos', 'ClaseID', x.c.ClaseID).some(r => r.Key === [x.c.ClaseID, x.t, x.pa].join('|')))
      throw new Error('Primero indica cuántas asistencias se tomarán en cuenta para este parcial.');
    const ids = new Set(estudiantesDe_(x.c).map(e => e.EstID)), filas = [];
    (p.marcas || []).forEach(m => {
      if (!ids.has(m.EstID)) throw new Error('Estudiante no válido.');
      const v = codAs_(m.valor);
      filas.push({ Key: [x.c.ClaseID, x.t, x.pa, p.Fecha, m.EstID].join('|'), ClaseID: x.c.ClaseID, Trimestre: x.t, Parcial: x.pa,
                   Fecha: p.Fecha, EstID: m.EstID, Valor: v === null ? '' : v });
    });
    upsert_('Asistencia', filas);
    marcarSucia_(x.c.ClaseID);
    return filas.length;
  }],
  'asistencia.borrarFecha': ['asistencia', 'eliminar', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa); exigeEscritura_(x.c);
    const n = borrarDonde_('Asistencia', o => ok(o) && o.Fecha === p.Fecha);
    marcarSucia_(x.c.ClaseID); return n;
  }],

  /* ---------- Actividades y calificaciones ---------- */
  'actividades.cargar': ['actividades', 'ver', false, (u, p) => {
    const x = ctx_(u, p), P = calcParcial_(motor_(x.c), x.c, x.t, x.pa, estudiantesDe_(x.c), { pesosAs: pesosAs_() });
    delete P.am; P.aprobatoria = x.esq.Aprobatoria; return P;
  }],
  'actividades.guardarAct': ['actividades', p => p.ActID ? 'editar' : 'crear', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa); exigeEscritura_(x.c);
    const per = leerPor_('Periodos', 'ClaseID', x.c.ClaseID).find(r => r.Key === [x.c.ClaseID, x.t, x.pa].join('|'));
    if (!per) throw new Error('Primero configura el parcial (número de asistencias para evaluación).');
    const nombre = String(p.Nombre || '').trim(), cat = p.Categoria === 'LIBRETA' ? 'LIBRETA' : 'GENERAL', max = Number(p.Max);
    if (!nombre) throw new Error('Escribe el nombre de la actividad.');
    if (!(max > 0 && max <= 100)) throw new Error('El valor máximo debe ser mayor que 0 y no exceder 100.');
    const pesoAsis = per.PesoAsistencia === '' ? 10 : Number(per.PesoAsistencia);
    const todas = leerPor_('Actividades', 'ClaseID', x.c.ClaseID), otras = todas.filter(a => ok(a) && a.ActID !== p.ActID);
    const genOtras = otras.filter(a => a.Categoria === 'GENERAL').reduce((s, a) => s + Number(a.Max), 0);
    if (cat === 'GENERAL' && pesoAsis + genOtras + max > 100) throw new Error('Los puntos generales (incluida la asistencia) no pueden superar 100.');
    const o = { Nombre: nombre, Categoria: cat, Max: max };
    marcarSucia_(x.c.ClaseID);
    if (p.ActID) {
      const a = todas.find(r => r.ActID === p.ActID && ok(r));
      if (!a) throw new Error('Actividad no encontrada.');
      actualizar_('Actividades', a._fila, o); return a.ActID;
    }
    o.ActID = uid_('A-'); o.ClaseID = x.c.ClaseID; o.Trimestre = x.t; o.Parcial = x.pa;
    o.Orden = otras.reduce((m, a) => Math.max(m, Number(a.Orden) || 0), 0) + 1;
    agregar_('Actividades', o); return o.ActID;
  }],
  'actividades.eliminarAct': ['actividades', 'eliminar', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa); exigeEscritura_(x.c);
    if (marcarElim_('Actividades', o => ok(o) && o.ActID === p.ActID) < 1) throw new Error('Actividad no encontrada.');
    marcarSucia_(x.c.ClaseID); return true;
  }],
  'actividades.plantilla': ['actividades', 'crear', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa); exigeEscritura_(x.c);
    if (!leerPor_('Periodos', 'ClaseID', x.c.ClaseID).some(r => r.Key === [x.c.ClaseID, x.t, x.pa].join('|'))) throw new Error('Primero configura el parcial.');
    if (leerPor_('Actividades', 'ClaseID', x.c.ClaseID).some(ok)) throw new Error('Este parcial ya tiene actividades registradas.');
    agregarVarios_('Actividades', ['Participación', 'Disciplina', 'Examen'].map((n, i) => ({
      ActID: uid_('A-'), ClaseID: x.c.ClaseID, Trimestre: x.t, Parcial: x.pa, Nombre: n, Categoria: 'GENERAL', Max: 10, Orden: i + 1 })));
    marcarSucia_(x.c.ClaseID); return true;
  }],
  'actividades.guardarCalif': ['actividades', 'editar', true, (u, p) => {
    const x = ctx_(u, p), ok = filtroCtx_(x.c, x.t, x.pa), acts = {}, ids = new Set(estudiantesDe_(x.c).map(e => e.EstID)), filas = [];
    exigeEscritura_(x.c);
    leerPor_('Actividades', 'ClaseID', x.c.ClaseID).filter(ok).forEach(a => acts[a.ActID] = a);
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
    marcarSucia_(x.c.ClaseID);
    return filas.length;
  }],

  /* ---------- Reportes ---------- */
  'reportes.datos': ['reportes', 'ver', false, (u, p) => {
    const x = ctx_(u, p), ests = estudiantesDe_(x.c), M = motor_(x.c), cfg = config_(), opt = { pesosAs: pesosAs_(cfg) };
    const R = { tipo: p.tipo, t: x.t, pa: x.pa, clase: x.c, esq: x.esq, ests: ests.map(estLite_), logo: logoUri_(),
                cfg: { INSTITUCION: cfg.INSTITUCION, ENCABEZADO2: cfg.ENCABEZADO2, CCT: cfg.CCT, DIRECTOR: cfg.DIRECTOR } };
    if (p.tipo === 'final') R.anual = calcAnual_(M, x.c, ests, x.esq, opt); else R.P = calcParcial_(M, x.c, x.t, x.pa, ests, opt);
    return R;
  }],
  'reportes.estudiantes': ['reportes', 'ver', false, (u, p) => estudiantesDe_(clase_(u, p.ClaseID)).map(estLite_)],
  'reportes.boleta': ['reportes', 'ver', false, (u, p) => {
    const e = exigeEstudiante_(u, p.EstID), ins = inscripcionesDe_(e);
    const sel = ins.find(i => norm_(i.Ciclo) === norm_(p.Ciclo)) || ins[0], cfg = config_();
    const materias = materiasDeEst_(e, sel, clasesDe_(u));
    if (!materias.length) throw new Error('No hay asignaturas visibles para este estudiante en ' + sel.Ciclo + '.');
    return { est: { nombre: e.Nombre, matricula: e.Matricula, numLista: Number(e.NumLista) || 0 }, ins: sel, ciclos: ins.map(i => i.Ciclo),
             materias: materias, logo: logoUri_(),
             cfg: { INSTITUCION: cfg.INSTITUCION, ENCABEZADO2: cfg.ENCABEZADO2, CCT: cfg.CCT, DIRECTOR: cfg.DIRECTOR } };
  }],
  'reportes.grupo': ['reportes', 'ver', false, (u, p) => {
    exigePar_(u, p.Grado, p.Grupo);
    const cfg = config_(), ciclo = String(p.Ciclo || cfg.CICLO || '').trim();
    const clases = clasesDe_(u).filter(c => mismoGrupo_(c, p) && norm_(c.Ciclo) === norm_(ciclo));
    if (!clases.length) throw new Error('No hay asignaturas de ese grupo en el ciclo ' + ciclo + '.');
    const ests = estudiantesDe_(clases[0]), matriz = {};
    clases.forEach(c => {
      const m = resultadosClase_(c);
      ests.forEach(e => { (matriz[e.EstID] = matriz[e.EstID] || {})[c.ClaseID] = m[e.EstID] ? { f: m[e.EstID].final, pr: m[e.EstID].provisional } : null; });
    });
    return { ciclo: ciclo, Grado: String(p.Grado), Grupo: String(p.Grupo), logo: logoUri_(),
             clases: clases.map(c => ({ ClaseID: c.ClaseID, Asignatura: c.Asignatura, Docente: c.Docente, aprobatoria: c.Esquema.Aprobatoria })),
             ests: ests.map(estLite_), matriz: matriz,
             cfg: { INSTITUCION: cfg.INSTITUCION, ENCABEZADO2: cfg.ENCABEZADO2, CCT: cfg.CCT, DIRECTOR: cfg.DIRECTOR } };
  }],
  'reportes.pdf': ['reportes', 'ver', false, (u, p) => {
    const html = sanitizarHtml_(String(p.html || '').slice(0, 3000000));
    if (html.length < 60) throw new Error('Reporte no válido.');
    const blob = Utilities.newBlob(html, 'text/html', 'reporte.html').getAs('application/pdf');
    return { b64: Utilities.base64Encode(blob.getBytes()), nombre: String(p.nombre || 'reporte').replace(/[^\w\-]+/g, '_') + '.pdf' };
  }],

  /* ---------- Panel de inicio ---------- */
  'dashboard.datos': [null, null, false, (u, p) => dashboardDatos_(u, p || {})],

  /* ---------- Seguimiento de estudiantes ---------- */
  'seguimiento.listar': ['seguimiento', 'ver', false, (u, p) => {
    const e = exigeEstudiante_(u, p.EstID);
    return leer_('Seguimiento').filter(s => s.EstID === e.EstID).sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)))
      .map(s => ({ SegID: s.SegID, Fecha: s.Fecha, Tipo: s.Tipo, Texto: s.Texto, ArchivoNombre: s.ArchivoNombre || '', Usuario: s.Usuario }));
  }],
  'seguimiento.guardar': ['seguimiento', 'crear', true, (u, p) => {
    const e = exigeEstudiante_(u, p.EstID), tipo = String(p.Tipo || '');
    if (['INCIDENCIA', 'EVIDENCIA', 'NOTA', 'REUNION'].indexOf(tipo) < 0) throw new Error('Tipo de registro no válido.');
    const texto = String(p.Texto || '').trim();
    if (texto.length < 3 || texto.length > 1500) throw new Error('Escribe un comentario de 3 a 1500 caracteres.');
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(p.Fecha)) ? p.Fecha : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const f = guardarAdjunto_(p.archivo, e.EstID);
    agregar_('Seguimiento', { SegID: uid_('G-'), EstID: e.EstID, ClaseID: String(p.ClaseID || ''), Fecha: fecha, Tipo: tipo, Texto: texto,
                              ArchivoID: f ? f.id : '', ArchivoNombre: f ? f.nombre : '', Usuario: u.Usuario });
    return true;
  }],
  'seguimiento.archivo': ['seguimiento', 'ver', false, (u, p) => {
    const s = leer_('Seguimiento').find(r => r.SegID === p.SegID);
    if (!s || !s.ArchivoID) throw new Error('Archivo no encontrado.');
    exigeEstudiante_(u, s.EstID);
    const b = DriveApp.getFileById(s.ArchivoID).getBlob();
    return { b64: Utilities.base64Encode(b.getBytes()), mime: b.getContentType(), nombre: s.ArchivoNombre };
  }],
  'seguimiento.eliminar': ['seguimiento', 'eliminar', true, (u, p) => {
    const s = leer_('Seguimiento').find(r => r.SegID === p.SegID);
    if (!s) throw new Error('Registro no encontrado.');
    exigeEstudiante_(u, s.EstID);
    marcarElim_('Seguimiento', o => o.SegID === p.SegID); return true;
  }],

  /* ---------- Notificaciones a tutores ---------- */
  'comunicacion.vista': ['comunicacion', 'ver', false, (u, p) => {
    const x = ctx_(u, p), ests = estudiantesDe_(x.c), cfg = config_(), um = cfgNum_(cfg, 'UMBRAL_ASIS', 80);
    const P = calcParcial_(motor_(x.c), x.c, x.t, x.pa, ests, { pesosAs: pesosAs_(cfg) }), em = {};
    ests.forEach(e => em[e.EstID] = e);
    return { aprobatoria: x.esq.Aprobatoria, umbral: um, sesiones: P.fechas.length, filas: P.filas.map(f => {
      const e = em[f.EstID];
      return { EstID: f.EstID, NumLista: f.NumLista, Nombre: f.Nombre, gral: Math.round(f.gral * 10) / 10, pctSes: Math.round(f.pctSes),
               faltas: f.faltas, riesgo: f.gral < x.esq.Aprobatoria || (P.fechas.length >= 3 && f.pctSes < um),
               Tutor: e.Tutor || '', CorreoTutor: e.CorreoTutor || '', tieneCorreo: emailValido_(e.CorreoTutor) };
    }) };
  }],
  'comunicacion.enviar': ['comunicacion', 'crear', false, (u, p) => {
    const x = ctx_(u, p), cfg = config_(), ids = (p.EstIDs || []).slice(0, 60);
    if (!ids.length) throw new Error('Selecciona al menos un estudiante.');
    const ests = estudiantesDe_(x.c), em = {}; ests.forEach(e => em[e.EstID] = e);
    const P = calcParcial_(motor_(x.c), x.c, x.t, x.pa, ests, { pesosAs: pesosAs_(cfg) }), fm = {}; P.filas.forEach(f => fm[f.EstID] = f);
    const quedan = MailApp.getRemainingDailyQuota();
    if (quedan < ids.length) throw new Error('La cuota diaria de correos es insuficiente (quedan ' + quedan + ').');
    const mensaje = String(p.Mensaje || '').slice(0, 800), tit = tituloPer_(x);
    const res = { enviados: 0, sinCorreo: [], fallidos: [] };
    ids.forEach(id => {
      const e = em[id];
      if (!e) return;
      if (!emailValido_(e.CorreoTutor)) { res.sinCorreo.push(e.Nombre); return; }
      try {
        const o = { to: String(e.CorreoTutor).trim(), name: cfg.INSTITUCION || APP.TITULO,
                    subject: 'Seguimiento académico: ' + e.Nombre + ' · ' + x.c.Asignatura,
                    htmlBody: correoTutorHtml_(cfg, e, x.c, tit, fm[id], x.esq, mensaje) };
        if (emailValido_(u.Correo)) o.replyTo = String(u.Correo).trim();
        MailApp.sendEmail(o);
        res.enviados++;
        aud_('Correo', 'ENVIO', e.EstID, null, { para: o.to, clase: x.c.ClaseID });
      } catch (err) { res.fallidos.push(e.Nombre); }
    });
    return res;
  }],

  /* ---------- Usuarios ---------- */
  'usuarios.listar': ['usuarios', 'ver', false, () => ({
    usuarios: leer_('Usuarios').map(x => ({ Usuario: x.Usuario, Nombre: x.Nombre, Rol: x.Rol, DocenteID: x.DocenteID, Activo: bool_(x.Activo), Correo: x.Correo || '' })),
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
    const correo = String(p.Correo || '').trim().toLowerCase();
    if (correo && !emailValido_(correo)) throw new Error('El correo no es válido.');
    if (correo && todos.some(x => String(x.Correo || '').trim().toLowerCase() === correo && String(x.Usuario).toLowerCase() !== usuario))
      throw new Error('Ese correo ya está vinculado a otro usuario.');
    const activo = p.Activo !== false;
    const o = { Usuario: usuario, Nombre: String(p.Nombre || '').trim(), Rol: rol, DocenteID: rol === 'ADMIN' ? '*' : String(p.DocenteID || ''),
                Activo: activo, Correo: correo };
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

  /* ---------- Configuración ---------- */
  'config.cargar': ['config', 'ver', false, () => ({ config: cfgPublica_(config_()), logo: logoUri_() })],
  'config.guardar': ['config', 'editar', true, (u, p) => {
    const o = {}, antes = pesosAs_();
    ['INSTITUCION', 'ENCABEZADO2', 'CCT', 'CICLO', 'DIRECTOR'].forEach(k => o[k] = String(p[k] || '').trim().slice(0, 150));
    const rango = (k, min, max, def) => { const v = Number(p[k]); o[k] = (p[k] === '' || p[k] == null || isNaN(v)) ? def : Math.max(min, Math.min(max, v)); };
    rango('PESO_RETARDO', 0, 1, 0.5); rango('PESO_JUSTIFICADA', 0, 1, 1); rango('PESO_PERMISO', 0, 1, 1);
    rango('UMBRAL_ASIS', 0, 100, 80); rango('RESPALDOS_MAX', 1, 60, 14); rango('BITACORA_DIAS', 30, 3650, 365);
    setConfig_(o);
    const n = pesosAs_(o);
    if (n.R !== antes.R || n.J !== antes.J || n.PM !== antes.PM) marcarTodasSucias_();
    return true;
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
  }],

  /* ---------- Esquemas de evaluación ---------- */
  'esquemas.listar': ['config', 'ver', false, () => {
    const uso = {}; leer_('Asignaciones').forEach(a => { const k = a.EsquemaID || ESQ_DEF; uso[k] = (uso[k] || 0) + 1; });
    return esquemas_().map(e => Object.assign(normEsq_(e), { enUso: uso[e.EsquemaID] || 0 }));
  }],
  'esquemas.guardar': ['config', 'editar', true, (u, p) => {
    if (!esTodo_(u)) throw new Error('Solo el administrador puede modificar los esquemas.');
    const nombre = String(p.Nombre || '').trim().slice(0, 60), np = Math.round(Number(p.NumPeriodos)), pa = Math.round(Number(p.Parciales));
    const apr = Number(p.Aprobatoria), dec = Math.round(Number(p.DecFinal));
    if (!nombre) throw new Error('Escribe el nombre del esquema.');
    if (!(np >= 1 && np <= 6)) throw new Error('El número de periodos debe estar entre 1 y 6.');
    if (!(pa >= 1 && pa <= 4)) throw new Error('Los parciales por periodo deben estar entre 1 y 4.');
    if (!(apr >= 0 && apr <= 10)) throw new Error('La calificación aprobatoria debe estar entre 0 y 10.');
    const o = { Nombre: nombre, NumPeriodos: np, Parciales: pa, NombrePeriodo: String(p.NombrePeriodo || 'Periodo').slice(0, 20),
                Aprobatoria: apr, DecFinal: (dec >= 0 && dec <= 2) ? dec : 1 };
    if (p.EsquemaID) {
      const e = leer_('Esquemas').find(x => x.EsquemaID === p.EsquemaID);
      if (!e) throw new Error('Esquema no encontrado.');
      const usan = leer_('Asignaciones').filter(a => (a.EsquemaID || ESQ_DEF) === e.EsquemaID);
      usan.forEach(a => validarEsqVsDatos_(a.ClaseID, normEsq_(o)));
      actualizar_('Esquemas', e._fila, o);
      marcarSucias_(usan.map(a => a.ClaseID));
      return e.EsquemaID;
    }
    o.EsquemaID = uid_('Q-'); agregar_('Esquemas', o); return o.EsquemaID;
  }],
  'esquemas.eliminar': ['config', 'eliminar', true, (u, p) => {
    if (!esTodo_(u)) throw new Error('Solo el administrador puede eliminar esquemas.');
    if (p.EsquemaID === ESQ_DEF) throw new Error('El esquema predeterminado no se puede eliminar.');
    if (leer_('Asignaciones', true).some(a => a.EsquemaID === p.EsquemaID)) throw new Error('Hay asignaturas que usan este esquema.');
    if (borrarDonde_('Esquemas', o => o.EsquemaID === p.EsquemaID) < 1) throw new Error('Esquema no encontrado.');
    return true;
  }],

  /* ---------- Ciclos escolares (hojas partidas por ciclo) ---------- */
  'ciclos.listar': ['config', 'ver', false, () => {
    const m = {}, vig = norm_(cicloInsc_());
    leer_('Asignaciones').forEach(a => {
      const c = cicloDe_(a), r = m[c] = m[c] || { ciclo: c, clases: 0, archivadas: 0 };
      r.clases++; if (bool_(a.Archivada)) r.archivadas++;
    });
    return Object.keys(m).sort().reverse().map(k => Object.assign(m[k], { vigente: norm_(k) === vig }));
  }],
  'ciclos.archivar': ['config', 'editar', true, (u, p) => {
    if (!esTodo_(u)) throw new Error('Solo el administrador puede archivar ciclos.');
    const ciclo = String(p.Ciclo || '').trim();
    if (!ciclo) throw new Error('Indica el ciclo.');
    if (norm_(ciclo) === norm_(cicloInsc_())) throw new Error('No puedes archivar el ciclo vigente. Cambia primero el ciclo en Configuración.');
    const asg = leer_('Asignaciones').filter(a => norm_(cicloDe_(a)) === norm_(ciclo) && !bool_(a.Archivada));
    if (!asg.length) throw new Error('No hay asignaturas por archivar en ese ciclo.');
    const ids = new Set(asg.map(a => a.ClaseID)), sl = slug_(ciclo); let filas = 0;
    HOJAS_CICLO.forEach(b => { hojaPartida_(b + '_' + sl); filas += moverFilas_(b, b + '_' + sl, o => ids.has(o.ClaseID)); });
    actualizarVarios_('Asignaciones', asg.map(a => ({ fila: a._fila, obj: { Archivada: true, Ciclo: ciclo } })));
    return { clases: asg.length, filas: filas };
  }],
  'ciclos.reabrir': ['config', 'editar', true, (u, p) => {
    if (!esTodo_(u)) throw new Error('Solo el administrador puede reabrir ciclos.');
    const ciclo = String(p.Ciclo || '').trim(), sl = slug_(ciclo);
    const asg = leer_('Asignaciones').filter(a => norm_(cicloDe_(a)) === norm_(ciclo) && bool_(a.Archivada));
    if (!asg.length) throw new Error('No hay asignaturas archivadas en ese ciclo.');
    const ids = new Set(asg.map(a => a.ClaseID)); let filas = 0;
    HOJAS_CICLO.forEach(b => { filas += moverFilas_(b + '_' + sl, b, o => ids.has(o.ClaseID)); });
    actualizarVarios_('Asignaciones', asg.map(a => ({ fila: a._fila, obj: { Archivada: false } })));
    return { clases: asg.length, filas: filas };
  }],

  /* ---------- Respaldos ---------- */
  'respaldos.listar': ['config', 'ver', false, () => listarRespaldos_()],
  'respaldos.crear': ['config', 'editar', true, u => {
    if (!esTodo_(u)) throw new Error('Solo el administrador puede crear respaldos.');
    return crearRespaldo_('manual:' + u.Usuario);
  }],

  /* ---------- Bitácora ---------- */
  'bitacora.listar': ['bitacora', 'ver', false, (u, p) => {
    const s = hoja_('Bitacora'), ult = s.getLastRow();
    if (ult < 2) return { filas: [], total: 0 };
    const n = Math.min(ult - 1, 4000), lim = Math.min(Number(p.limite) || 300, 1000);
    const us = String(p.usuario || '').trim().toLowerCase(), ho = String(p.hoja || '').trim().toLowerCase(),
          tx = String(p.texto || '').trim().toLowerCase(), desde = String(p.desde || '');
    const filas = s.getRange(ult - n + 1, 1, n, 8).getValues().filter(f =>
      (!us || String(f[1]).toLowerCase().indexOf(us) >= 0) && (!ho || String(f[3]).toLowerCase() === ho) &&
      (!desde || String(f[0]).slice(0, 10) >= desde) &&
      (!tx || (String(f[2]) + ' ' + f[4] + ' ' + f[5] + ' ' + f[6] + ' ' + f[7]).toLowerCase().indexOf(tx) >= 0));
    return { total: ult - 1, filas: filas.reverse().slice(0, lim).map(f => ({ Fecha: String(f[0]), Usuario: f[1], Accion: f[2], Hoja: f[3],
                                                                             Operacion: f[4], Registro: f[5], Antes: f[6], Despues: f[7] })) };
  }],

  /* ---------- Papelera (borrado lógico) ---------- */
  'papelera.listar': ['papelera', 'ver', false, u => {
    const todo = esTodo_(u), cl = clasesDe_(u), pares = new Set(cl.map(c => norm_(c.Grado) + '|' + norm_(c.Grupo))), cids = {};
    cl.forEach(c => cids[c.ClaseID] = c.Asignatura);
    const elim = n => leer_(n, true).filter(r => r.Eliminado), out = [];
    elim('Estudiantes').filter(e => todo || pares.has(norm_(e.Grado) + '|' + norm_(e.Grupo)))
      .forEach(e => out.push({ tipo: 'Estudiantes', id: e.EstID, titulo: e.Nombre, detalle: e.Grado + '° ' + e.Grupo, eliminado: e.Eliminado }));
    elim('Asignaciones').filter(a => todo || a.DocenteID === u.DocenteID)
      .forEach(a => out.push({ tipo: 'Asignaciones', id: a.ClaseID, titulo: a.Asignatura, detalle: a.Grado + '° ' + a.Grupo + ' · ' + cicloDe_(a), eliminado: a.Eliminado }));
    if (todo) elim('Docentes').forEach(d => out.push({ tipo: 'Docentes', id: d.DocenteID, titulo: d.Nombre, detalle: d.Correo || '', eliminado: d.Eliminado }));
    elim('Actividades').filter(a => todo || cids[a.ClaseID])
      .forEach(a => out.push({ tipo: 'Actividades', id: a.ActID, titulo: a.Nombre, detalle: (cids[a.ClaseID] || a.ClaseID) + ' · ' + a.Trimestre + 'T P' + a.Parcial, eliminado: a.Eliminado }));
    return { items: out.sort((a, b) => String(b.eliminado).localeCompare(String(a.eliminado))), puedePurgar: todo };
  }],
  'papelera.restaurar': ['papelera', 'editar', true, (u, p) => {
    const lista = ACCIONES['papelera.listar'][3](u).items;
    if (!lista.some(i => i.tipo === p.tipo && i.id === p.id)) throw new Error('El elemento no está disponible en tu papelera.');
    const campo = { Estudiantes: 'EstID', Asignaciones: 'ClaseID', Docentes: 'DocenteID', Actividades: 'ActID' }[p.tipo];
    if (!campo) throw new Error('Tipo no válido.');
    if (p.tipo === 'Actividades') {
      const a = leer_('Actividades', true).find(r => r.ActID === p.id);
      if (!leer_('Asignaciones').some(c => c.ClaseID === a.ClaseID)) throw new Error('Restaura primero la asignatura a la que pertenece.');
    }
    marcarElim_(p.tipo, o => o[campo] === p.id, true);
    if (p.tipo === 'Estudiantes') { const e = leer_('Estudiantes').find(r => r.EstID === p.id); if (e) { sincInsc_([e]); sucioGrupo_(e.Grado, e.Grupo); } }
    if (p.tipo === 'Asignaciones') marcarSucia_(p.id);
    if (p.tipo === 'Actividades') { const a = leer_('Actividades').find(r => r.ActID === p.id); if (a) marcarSucia_(a.ClaseID); }
    return true;
  }],
  'papelera.purgar': ['papelera', 'eliminar', true, (u, p) => {
    if (!esTodo_(u)) throw new Error('Solo el administrador puede eliminar definitivamente.');
    const campo = { Estudiantes: 'EstID', Asignaciones: 'ClaseID', Docentes: 'DocenteID', Actividades: 'ActID' }[p.tipo];
    if (!campo) throw new Error('Tipo no válido.');
    if (!leer_(p.tipo, true).some(r => r[campo] === p.id && r.Eliminado)) throw new Error('Solo se pueden purgar elementos de la papelera.');
    if (p.tipo === 'Estudiantes') purgarEstudiante_(p.id);
    else if (p.tipo === 'Asignaciones') purgarClase_(p.id);
    else if (p.tipo === 'Actividades') purgarActividad_(p.id);
    else borrarDonde_('Docentes', o => o.DocenteID === p.id);
    return true;
  }]
};

/** Punto único de acceso para el personal autenticado. */
function api(token, accion, p) {
  let u = null;
  try {
    if (accion === 'salir') { CacheService.getScriptCache().remove('S_' + token); return { ok: true }; }
    const a = ACCIONES[accion];
    if (!a) throw new Error('Acción no válida.');
    u = sesion_(token);
    p = p || {};
    if (a[0]) exige_(u, a[0], typeof a[1] === 'function' ? a[1](p) : a[1]);
    const data = a[2] ? conBloqueo_(() => { try { return a[3](u, p); } finally { flushAud_(u.Usuario, accion); } })
                      : (() => { try { return a[3](u, p); } finally { flushAud_(u.Usuario, accion); } })();
    return { ok: true, data: data };
  } catch (e) {
    AUD_ = [];
    return { ok: false, error: e.message || String(e), sesion: e.message === 'SESION_EXPIRADA' };
  }
}
