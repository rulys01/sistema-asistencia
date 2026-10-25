/* ============================================================================
 *  PRUEBAS UNITARIAS  ·  Ejecuta ejecutarPruebas() desde el editor y revisa el registro.
 *  Las pruebas del motor son funciones puras: no leen ni escriben en las hojas.
 * ========================================================================== */

function ejecutarPruebas() {
  soloPropietario_();
  const r = correrPruebas_();
  Logger.log('PRUEBAS: ' + r.ok + ' correctas, ' + r.fail + ' con error.');
  r.fallos.forEach(f => Logger.log('  ✗ ' + f));
  if (r.fail) throw new Error(r.fail + ' prueba(s) fallaron. Revisa el registro de ejecución.');
  return r;
}

function correrPruebas_() {
  const res = { ok: 0, fail: 0, fallos: [] };
  const t = (nombre, fn) => { try { fn(); res.ok++; } catch (e) { res.fail++; res.fallos.push(nombre + ': ' + e.message); } };
  const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' esperado ' + JSON.stringify(b) + ' y se obtuvo ' + JSON.stringify(a)); };
  const cerca = (a, b, m) => { if (Math.abs(a - b) > 1e-6) throw new Error((m || '') + ' esperado ' + b + ' y se obtuvo ' + a); };
  const verdad = (v, m) => { if (!v) throw new Error(m || 'condición falsa'); };

  /* ---- Datos de prueba ---- */
  const C = { ClaseID: 'C1' };
  const est = (id, n) => ({ EstID: id, NumLista: n, Nombre: 'Alumno ' + n });
  const per = (t, p, total, peso) => ({ Key: 'C1|' + t + '|' + p, ClaseID: 'C1', Trimestre: t, Parcial: p, TotalDias: total, Mes: '', PesoAsistencia: peso === undefined ? 10 : peso });
  const act = (id, t, p, nombre, cat, max, ord) => ({ ActID: id, ClaseID: 'C1', Trimestre: t, Parcial: p, Nombre: nombre, Categoria: cat, Max: max, Orden: ord });
  const cal = (t, p, a, e, v) => ({ ClaseID: 'C1', Trimestre: t, Parcial: p, ActID: a, EstID: e, Valor: v });
  const asi = (t, p, f, e, v) => ({ ClaseID: 'C1', Trimestre: t, Parcial: p, Fecha: f, EstID: e, Valor: v });
  const dias = n => Array.from({ length: n }, (_, i) => '2026-09-' + ('0' + (i + 1)).slice(-2));

  /* ---- Utilidades ---- */
  t('xround_ redondea como Excel', () => { eq(xround_(2.5, 0), 3); eq(xround_(1.005, 2), 1.01); eq(xround_(7.949, 1), 7.9); });
  t('num_ acota entre 0 y el máximo', () => { eq(num_('', 10), 0); eq(num_(12, 10), 10); eq(num_(-3, 10), 0); eq(num_('7.5', 10), 7.5); eq(num_('x', 10), 0); });
  t('codAs_ normaliza estados', () => {
    eq(codAs_(1), 1); eq(codAs_('1'), 1); eq(codAs_(0), 0); eq(codAs_('0'), 0); eq(codAs_(''), null);
    eq(codAs_('r'), 'R'); eq(codAs_('J'), 'J'); eq(codAs_('pm'), 'PM'); eq(codAs_('x'), null);
  });
  t('emailValido_', () => { verdad(emailValido_('a@b.mx')); verdad(!emailValido_('a@b')); verdad(!emailValido_('sin arroba')); verdad(!emailValido_('')); });
  t('hash_ es determinista y depende de la sal', () => {
    eq(hash_('abc', 's1'), hash_('abc', 's1')); verdad(hash_('abc', 's1') !== hash_('abc', 's2')); verdad(hash_('abc', 's1') !== hash_('abd', 's1'));
  });
  t('codigoSeguro_ genera solo dígitos de la longitud pedida', () => { const c = codigoSeguro_(6); eq(c.length, 6); verdad(/^\d{6}$/.test(c)); });
  t('separarEtiqueta_', () => { eq(separarEtiqueta_('perez juan N.I.').etiqueta, 'N.I.'); eq(separarEtiqueta_('perez juan U').nombre, 'PEREZ JUAN'); eq(separarEtiqueta_('ana').etiqueta, ''); });
  t('esquema por defecto normalizado', () => { const e = normEsq_(ESQ_DEF_OBJ); eq(e.NumPeriodos, 3); eq(e.Parciales, 2); eq(e.Aprobatoria, 6); });

  /* ---- calcParcial_ ---- */
  const mParcial = () => {
    const M = { per: [per(1, 1, 10)], asi: [], cal: [], act: [
      act('A1', 1, 1, 'Examen', 'GENERAL', 30, 1), act('A2', 1, 1, 'Participación', 'GENERAL', 10, 2),
      act('L1', 1, 1, 'Libreta', 'LIBRETA', 10, 3), act('L2', 1, 1, 'Tareas', 'LIBRETA', 10, 4)] };
    dias(10).forEach(f => M.asi.push(asi(1, 1, f, 'E1', 1)));
    dias(10).forEach((f, i) => M.asi.push(asi(1, 1, f, 'E2', i < 8 ? 1 : 0)));
    M.cal.push(cal(1, 1, 'A1', 'E1', 24), cal(1, 1, 'A2', 'E1', 8), cal(1, 1, 'L1', 'E1', 10), cal(1, 1, 'L2', 'E1', 5));
    return M;
  };
  t('calcParcial_: fórmula completa', () => {
    const P = calcParcial_(mParcial(), C, 1, 1, [est('E1', 1), est('E2', 2)]), f1 = P.filas[0], f2 = P.filas[1];
    eq(P.pesoGen, 50, 'pesoGen'); eq(P.pesoLib, 50, 'pesoLib'); eq(P.maxLib, 20, 'maxLib');
    eq(f1.asis10, 10); cerca(f1.ptsAsis, 10);
    cerca(f1.califL, 37.5, 'libreta ajustada');          // 15 pts de 20 × 50 / 20
    cerca(f1.gral, 7.95, 'gral E1');                      // (10 + 32 + 37.5) / 10
    eq(f2.asis10, 8); eq(f2.faltas, 2); cerca(f2.gral, 0.8, 'gral E2');
  });
  t('calcParcial_: estados de asistencia ponderados', () => {
    const M = { per: [per(1, 1, 10)], act: [], cal: [], asi: [] };
    const marcas = ['1', '1', '1', '1', '1', '1', 'R', 'R', 'J', '0'];
    dias(10).forEach((f, i) => M.asi.push(asi(1, 1, f, 'E3', marcas[i] === '1' ? 1 : (marcas[i] === '0' ? 0 : marcas[i]))));
    const f = calcParcial_(M, C, 1, 1, [est('E3', 3)], { pesosAs: { R: 0.5, J: 1, PM: 1 } }).filas[0];
    eq(f.presentes, 6); eq(f.retardos, 2); eq(f.justificadas, 1); eq(f.faltas, 1);
    eq(f.asis10, 8, '6 + 2×0.5 + 1 = 8 de 10');
    const g = calcParcial_(M, C, 1, 1, [est('E3', 3)], { pesosAs: { R: 1, J: 1, PM: 1 } }).filas[0];
    eq(g.asis10, 9, 'retardos como asistencia completa');
    const h = calcParcial_(M, C, 1, 1, [est('E3', 3)], { pesosAs: { R: 0, J: 0, PM: 0 } }).filas[0];
    eq(h.asis10, 6, 'retardos y justificadas sin valor');
  });
  t('calcParcial_: la asistencia no excede 10', () => {
    const M = { per: [per(1, 1, 5)], act: [], cal: [], asi: [] };
    dias(8).forEach(f => M.asi.push(asi(1, 1, f, 'E1', 1)));
    const f = calcParcial_(M, C, 1, 1, [est('E1', 1)]).filas[0];
    eq(f.asis10, 10); eq(f.pct, 100);
  });
  t('calcParcial_: calificación fuera de rango se acota', () => {
    const M = { per: [per(1, 1, 10)], asi: [], act: [act('A1', 1, 1, 'Ex', 'GENERAL', 10, 1)], cal: [cal(1, 1, 'A1', 'E1', 99)] };
    cerca(calcParcial_(M, C, 1, 1, [est('E1', 1)]).filas[0].pts.A1, 10);
  });
  t('calcParcial_: sin periodo configurado devuelve ceros', () => {
    const P = calcParcial_({ per: [], act: [], asi: [], cal: [] }, C, 1, 1, [est('E1', 1)]);
    eq(P.per, null); eq(P.filas[0].gral, 0);
  });
  t('calcParcial_: pctSes usa las sesiones registradas', () => {
    const M = { per: [per(1, 1, 20)], act: [], cal: [], asi: [] };
    dias(4).forEach((f, i) => M.asi.push(asi(1, 1, f, 'E1', i < 3 ? 1 : 0)));
    cerca(calcParcial_(M, C, 1, 1, [est('E1', 1)]).filas[0].pctSes, 75);
  });

  /* ---- calcAnual_ ---- */
  const parcialSimple = (M, t, p, valor) => {          // parcial con calificación = valor (criterio GENERAL de 100 pts, asistencia con peso 0)
    M.per.push(per(t, p, 10, 0));
    M.act.push(act('G' + t + p, t, p, 'Examen', 'GENERAL', 100, 1));
    M.cal.push(cal(t, p, 'G' + t + p, 'E1', valor * 10));
  };
  t('calcAnual_: esquema 3×2, final completo', () => {
    const M = { per: [], act: [], asi: [], cal: [] };
    [[1, 1, 8], [1, 2, 9], [2, 1, 7], [2, 2, 7], [3, 1, 6], [3, 2, 10]].forEach(a => parcialSimple(M, a[0], a[1], a[2]));
    const r = calcAnual_(M, C, [est('E1', 1)], ESQ_DEF_OBJ).E1;
    eq(r.trim[0].cal, 9, 'avg 8.5 → 9'); eq(r.trim[1].cal, 7); eq(r.trim[2].cal, 8);
    eq(r.total, 24); eq(r.final, 8); eq(r.provisional, false);
  });
  t('calcAnual_: provisional cuando faltan periodos', () => {
    const M = { per: [], act: [], asi: [], cal: [] };
    parcialSimple(M, 1, 1, 8); parcialSimple(M, 1, 2, 9);
    const r = calcAnual_(M, C, [est('E1', 1)], ESQ_DEF_OBJ).E1;
    eq(r.final, 9); eq(r.provisional, true); eq(r.n, 1);
  });
  t('calcAnual_: esquema personalizado 2 periodos × 1 parcial', () => {
    const M = { per: [], act: [], asi: [], cal: [] };
    parcialSimple(M, 1, 1, 7); parcialSimple(M, 2, 1, 8);
    const esq = { NumPeriodos: 2, Parciales: 1, DecFinal: 1 }, r = calcAnual_(M, C, [est('E1', 1)], esq).E1;
    eq(r.trim.length, 2); eq(r.trim[0].p.length, 1); eq(r.final, 7.5); eq(r.provisional, false);
  });
  t('calcAnual_: decimales finales configurables', () => {
    const M = { per: [], act: [], asi: [], cal: [] };
    parcialSimple(M, 1, 1, 7); parcialSimple(M, 2, 1, 8); parcialSimple(M, 3, 1, 8);
    const r = calcAnual_(M, C, [est('E1', 1)], { NumPeriodos: 3, Parciales: 1, DecFinal: 2 }).E1;
    cerca(r.final, 7.67);
    eq(calcAnual_(M, C, [est('E1', 1)], { NumPeriodos: 3, Parciales: 1, DecFinal: 0 }).E1.final, 8);
  });
  t('calcAnual_: sin datos no genera calificación', () => {
    const r = calcAnual_({ per: [], act: [], asi: [], cal: [] }, C, [est('E1', 1)], ESQ_DEF_OBJ).E1;
    eq(r.final, null); eq(r.provisional, true);
  });

  /* ---- Sanitizador de HTML para PDF ---- */
  const san = h => sanitizarHtml_(h);
  t('sanitizarHtml_ quita scripts y manejadores de eventos', () => {
    const s = san('<div onclick="x()"><script>alert(1)</script><b>ok</b><img src=x onerror="alert(1)"></div>');
    verdad(s.indexOf('script') < 0 && s.indexOf('alert') < 0 && s.indexOf('onclick') < 0 && s.indexOf('onerror') < 0, s);
    verdad(s.indexOf('<b>ok</b>') >= 0, s);
  });
  t('sanitizarHtml_ conserva tablas, clases y estilos seguros', () => {
    const s = san('<table class="rep"><tr><th colspan="2" style="color:#fff;background:#0d6efd">A</th></tr><tr><td>1</td><td>2</td></tr></table>');
    verdad(s.indexOf('colspan="2"') >= 0 && s.indexOf('class="rep"') >= 0 && s.indexOf('background:#0d6efd') >= 0, s);
  });
  t('sanitizarHtml_ bloquea estilos y URLs peligrosas', () => {
    const s = san('<div style="background:url(javascript:alert(1))">x</div><img src="javascript:alert(1)"><img src="https://evil.com/a.png"><a href="javascript:alert(1)">l</a>');
    verdad(s.indexOf('javascript') < 0 && s.indexOf('evil.com') < 0 && s.indexOf('<a') < 0 && s.indexOf('url(') < 0, s);
  });
  t('sanitizarHtml_ permite solo imágenes data: de formatos seguros', () => {
    const ok = san('<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo">');
    verdad(ok.indexOf('data:image/png;base64,iVBORw0KGgo=') >= 0, ok);
    verdad(san('<img src="data:image/svg+xml;base64,PHN2Zz4=">').indexOf('svg') < 0);
    verdad(san('<img src="data:text/html;base64,PHNjcmlwdD4=">').indexOf('text/html') < 0);
  });
  t('sanitizarHtml_ limpia el bloque <style>', () => {
    const s = san('<style>@import url(http://x.com/a.css); td{color:red} body{background:url(http://x.com/i.png)}</style><p>t</p>');
    verdad(s.indexOf('@import') < 0 && s.indexOf('url(') < 0 && s.indexOf('td{color:red}') >= 0, s);
  });
  t('sanitizarHtml_ elimina iframes, formularios y svg con su contenido', () => {
    const s = san('<iframe src="x"></iframe><form><input></form><svg onload="x()"><text>a</text></svg><p>fin</p>');
    verdad(s.indexOf('iframe') < 0 && s.indexOf('form') < 0 && s.indexOf('svg') < 0 && s.indexOf('<p>fin</p>') >= 0, s);
  });
  t('sanitizarHtml_ escapa "<" sueltos y no se rompe con etiquetas sin cerrar', () => {
    const s = san('<p>3 < 5 y <b onmouseover="x()" ');
    verdad(s.indexOf('<b') < 0 && s.indexOf('&lt;') >= 0, s);      // queda como texto escapado, no como etiqueta
  });
  t('sanitizarHtml_ termina rápido con entradas hostiles', () => {
    const t0 = Date.now(); san('<div ' + 'a="'.repeat(5000)); san('<'.repeat(20000)); san('<p class="' + 'x'.repeat(200000) + '">z</p>');
    verdad(Date.now() - t0 < 3000, 'demasiado lento');
  });

  /* ---- Caché fragmentada ---- */
  t('caché JSON fragmentada ida y vuelta', () => {
    const obj = { a: Array.from({ length: 4000 }, (_, i) => ({ i: i, t: 'texto ñandú ' + i })) };
    verdad(cachePutJson_('TEST|x', obj), 'no cupo en caché');
    eq(JSON.stringify(cacheGetJson_('TEST|x')), JSON.stringify(obj));
  });
  return res;
}
