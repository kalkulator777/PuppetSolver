/*
 * Puppet Cube V2 solver.
 *
 * Works on the cube shape (all blocks in place, pieces may be permuted).
 *   1. blocks: optimal half-turn sequences (Rw, Uw, Fw) precomputed in data.js
 *   2. centres: middle-slice turns (they never change the shape)
 *   3. edges: 3-cycles built from the tutorial algorithms
 *      (M2 U' M U2 M' U' M2 and friends) in all 24 holdings, conjugated by
 *      middle-slice set-up moves.
 * Every move of the final solution is re-checked with the collision model.
 */
(function (root) {
  'use strict';
  var P = root.Puppet;
  if (!P && typeof require === 'function') P = require('./puppet-core.js');
  var DATA = P.DATA;
  var NP = P.NP;

  function same(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
  function sgnKey(a) { return a.map(function (c) { return c > 0 ? '+' : '-'; }).join(''); }

  var KIND_SLOT = { main: 'corner', big: 'corner', lblock: 'corner', little: 'corner', edge: 'edge', centre: 'centre' };
  var CORNER_P = [], EDGE_P = [], CENTRE_P = [];
  P.PIECES.forEach(function (pc, i) {
    var k = KIND_SLOT[pc.kind];
    if (k === 'corner') CORNER_P.push(i); else if (k === 'edge') EDGE_P.push(i); else CENTRE_P.push(i);
  });

  // ------------------------------------------------------ visible facelets
  // Which inner facelet each outer surface cell shows in cube form.
  // surfaceMap[face][row][col] = facelet index (rows top->bottom, cols left->right
  // as seen from outside, with U seen from above with B at the top, D seen from
  // below with F at the top).
  var FACE_FRAME = {
    // face: [right direction, down direction] as seen from outside
    0: [[0, 0, -1], [0, -1, 0]], // R
    1: [[0, 0, 1], [0, -1, 0]],  // L
    2: [[1, 0, 0], [0, 0, 1]],   // U (B at the top)
    3: [[1, 0, 0], [0, 0, -1]],  // D (F at the top)
    4: [[1, 0, 0], [0, -1, 0]],  // F
    5: [[-1, 0, 0], [0, -1, 0]]  // B
  };
  var SOLVED_OWNER = {};
  (function () {
    for (var i = 0; i < NP; i++) P.PIECES[i].vox.forEach(function (v) { SOLVED_OWNER[v.join(',')] = i; });
  })();
  function surfaceCell(face, row, col) {
    // voxel in solved cube form whose outer face is this cell
    var d = P.FACE_DIRS[face], fr = FACE_FRAME[face];
    var v = [0, 0, 0];
    for (var k = 0; k < 3; k++) {
      // cube spans -2..1 on every axis; coordinate along face normal: 1 or -2
      if (d[k] !== 0) v[k] = d[k] > 0 ? 1 : -2;
      else {
        var c = 0;
        if (fr[0][k] !== 0) c += fr[0][k] > 0 ? (-2 + col) : (1 - col);
        if (fr[1][k] !== 0) c += fr[1][k] > 0 ? (-2 + row) : (1 - row);
        v[k] = c;
      }
    }
    return v;
  }
  var SURFACE = [];      // SURFACE[face][row][col] = {piece, facelet}
  var VISIBLE = {};      // facelet index -> true
  for (var f = 0; f < 6; f++) {
    var rows = [];
    for (var r = 0; r < 4; r++) {
      var cols = [];
      for (var c = 0; c < 4; c++) {
        var v = surfaceCell(f, r, c);
        var owner = SOLVED_OWNER[v.join(',')];
        var fi = P.faceletIndex(P.PIECES[owner].anchor, f);
        cols.push({ piece: owner, facelet: fi });
        VISIBLE[fi] = true;
      }
      rows.push(cols);
    }
    SURFACE.push(rows);
  }
  var VISIBLE_LIST = Object.keys(VISIBLE).map(Number).sort(function (a, b) { return a - b; });

  // Reveal steps: a middle-slice half turn keeps the cube shape and brings
  // hidden facelets to visible places.  For each step: the facelet positions
  // to read after the turn and which original facelet each one shows.
  function revealStep(token) {
    var mv = P.physical(P.parseToken(token));
    var gi = P.ROTS[P.INV[P.axisRot(mv.axis, mv.q)]];
    var reads = [];
    // origOf[idx]: which original facelet is seen at position idx after the turn
    var origOf = [];
    for (var j = 0; j < 54; j++) {
      var fq = P.faceletPos(j);
      if (P.layerOf(fq.pos[mv.axis]) !== 0) { origOf.push(j); continue; }
      origOf.push(P.faceletIndex(P.matApply(gi, fq.pos), P.dirToFace(P.matApply(gi, P.FACE_DIRS[fq.face]))));
    }
    for (var idx = 0; idx < 54; idx++) {
      if (!VISIBLE[idx]) continue;
      var fp = P.faceletPos(idx);
      if (P.layerOf(fp.pos[mv.axis]) !== 0) continue;
      // after the turn position p shows the original facelet at g^-1 p
      var op = P.matApply(gi, fp.pos), od = P.matApply(gi, P.FACE_DIRS[fp.face]);
      var orig = P.faceletIndex(op, P.dirToFace(od));
      if (VISIBLE[orig]) continue; // nothing new
      reads.push({ shown: idx, original: orig });
    }
    return { move: token, reads: reads, origOf: origOf };
  }
  var REVEALS = ['M2', 'E2', 'S2'].map(revealStep);

  // ------------------------------------------------ colours <-> state
  function faceletColoursFromState(state, faceColours) {
    var fl = P.facelets(state);
    return fl.map(function (f) { return faceColours[f]; });
  }

  // cols: array(54) of colour labels (null = unknown). Returns {state, faceColours} or {error}
  function stateFromFacelets(cols) {
    var i, missing = cols.filter(function (c) { return c === null || c === undefined; }).length;
    if (missing) return { error: 'Не заполнено наклеек: ' + missing + '.' };
    var counts = {};
    cols.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    var labels = Object.keys(counts);
    if (labels.length !== 6) return { error: 'Должно быть ровно 6 цветов, а найдено ' + labels.length + '.' };
    var bad = labels.filter(function (l) { return counts[l] !== 9; });
    if (bad.length) return { error: 'Каждый цвет должен встречаться 9 раз (считая скрытые детали). Сейчас: ' + labels.map(function (l) { return l + ' — ' + counts[l]; }).join(', ') + '.' };
    // face colours from the main block (L, D, B) and the small corner (R, U, F)
    var faceColours = new Array(6);
    [1, 3, 5].forEach(function (fc) { faceColours[fc] = cols[P.faceletIndex([-1, -1, -1], fc)]; });
    [0, 2, 4].forEach(function (fc) { faceColours[fc] = cols[P.faceletIndex([1, 1, 1], fc)]; });
    var uniq = {};
    faceColours.forEach(function (c) { uniq[c] = true; });
    if (Object.keys(uniq).length !== 6) return { error: 'Цвета главного блока и маленького уголка должны быть шестью разными цветами.' };
    var state = new Array(NP);
    var slotUsed = {};
    var problems = [];
    for (i = 0; i < NP; i++) {
      var pc = P.PIECES[i];
      var found = -1, foundPos = null;
      for (var r = 0; r < 24 && found < 0; r++) {
        var pos = P.ANC[i][r];
        var ok = true;
        for (var k = 0; k < pc.facelets.length && ok; k++) {
          var hf = pc.facelets[k];
          var nd = P.matApply(P.ROTS[r], P.FACE_DIRS[hf]);
          if (cols[P.faceletIndex(pos, P.dirToFace(nd))] !== faceColours[hf]) ok = false;
        }
        if (ok) { found = r; foundPos = pos; }
      }
      if (found < 0) { problems.push(pc.name); continue; }
      var key = foundPos.join(',');
      if (slotUsed[key] !== undefined) { problems.push(pc.name); continue; }
      slotUsed[key] = i;
      state[i] = found;
    }
    if (problems.length) {
      return { error: 'Не получается найти некоторые детали (' + problems.length + ' шт.) — проверьте цвета: возможно, где-то ошибка ввода или деталь перевёрнута.', problems: problems };
    }
    if (!P.isCube(state)) return { error: 'С такими цветами блоки не складываются в форму куба. Проверьте цвета больших и L-образных блоков.' };
    // parity: corners + edges + centres permutation parity must be even
    var par = permParity(CORNER_P, state) ^ permParity(EDGE_P, state) ^ permParity(CENTRE_P, state);
    if (par) return { error: 'Такая позиция невозможна (нарушена чётность перестановки). Скорее всего, перепутаны цвета двух деталей.' };
    if (!centreFrameOk(state)) return { error: 'Центры стоят в невозможном порядке. Проверьте цвета центров.' };
    return { state: state, faceColours: faceColours };
  }

  function permParity(list, state) {
    var slots = list.map(function (i) { return P.PIECES[i].anchor.join(','); });
    var perm = list.map(function (i) { return slots.indexOf(P.ANC[i][state[i]].join(',')); });
    var seen = [], parity = 0;
    for (var a = 0; a < perm.length; a++) {
      if (seen[a]) continue;
      var len = 0, b = a;
      while (!seen[b]) { seen[b] = true; b = perm[b]; len++; }
      parity ^= (len + 1) & 1;
    }
    return parity;
  }

  function centreFrameOk(state) {
    // opposite centres must stay opposite
    for (var a = 0; a < CENTRE_P.length; a++) {
      for (var b = 0; b < CENTRE_P.length; b++) {
        var pa = P.PIECES[CENTRE_P[a]].anchor, pb = P.PIECES[CENTRE_P[b]].anchor;
        if (pa[0] === -pb[0] && pa[1] === -pb[1] && pa[2] === -pb[2]) {
          var qa = P.ANC[CENTRE_P[a]][state[CENTRE_P[a]]], qb = P.ANC[CENTRE_P[b]][state[CENTRE_P[b]]];
          if (!(qa[0] === -qb[0] && qa[1] === -qb[1] && qa[2] === -qb[2])) return false;
        }
      }
    }
    return true;
  }

  // ------------------------------------------------------------- edges
  var EDGE_SLOTS = EDGE_P.map(function (i) { return P.PIECES[i].anchor; });
  var EDGE_SLOT_KEY = {};
  EDGE_SLOTS.forEach(function (a, k) { EDGE_SLOT_KEY[a.join(',')] = k; });
  function edgeDirs(a) {
    var out = [];
    for (var ax = 0; ax < 3; ax++) if (a[ax] !== 0) { var d = [0, 0, 0]; d[ax] = a[ax]; out.push(d); }
    return out;
  }
  // stickers[pos] = home sticker index found at sticker position pos
  function edgeStickers(state) {
    var cur = new Array(24);
    EDGE_P.forEach(function (i, e) {
      var m = P.ROTS[state[i]];
      var pos = P.ANC[i][state[i]];
      var k = EDGE_SLOT_KEY[pos.join(',')];
      var sd = edgeDirs(pos);
      edgeDirs(EDGE_SLOTS[e]).forEach(function (d, j) {
        var nd = P.matApply(m, d);
        var jj = same(nd, sd[0]) ? 0 : 1;
        cur[2 * k + jj] = 2 * e + j;
      });
    });
    return cur;
  }
  function edgeSolvedCount(cur) {
    var n = 0;
    for (var p = 0; p < 24; p++) if (cur[p] === p) n++;
    return n;
  }
  function applyPerm(cur, sigma) {
    // sigma[p] = new position of the sticker at p
    var out = new Array(24);
    for (var p = 0; p < 24; p++) out[sigma[p]] = cur[p];
    return out;
  }

  var SLICES = ['M', 'M2', "M'", 'E', 'E2', "E'", 'S', 'S2', "S'"];

  // Library of legal edge 3-cycles (setup + tutorial algorithm + undo),
  // generated and checked move by move by tools/gen_edges.py.
  var LIB = null; // array of {tokens, sigma}
  var LIB_BY_KEY = null;
  function buildLibrary() {
    if (LIB) return LIB;
    var solved = P.solvedState();
    LIB_BY_KEY = {};
    LIB = [];
    DATA.edgeLib.forEach(function (alg) {
      var st = P.applyAlg(solved, alg, false).state;
      var cur = edgeStickers(st);
      var sigma = new Array(24);
      for (var p = 0; p < 24; p++) sigma[cur[p]] = p;
      var key = sigma.join(',');
      if (LIB_BY_KEY[key]) return;
      var moved = [];
      for (var q = 0; q < 24; q++) if (sigma[q] !== q) moved.push(q);
      var m = { tokens: alg.split(' '), sigma: sigma, moved: moved };
      LIB_BY_KEY[key] = m;
      LIB.push(m);
    });
    return LIB;
  }
  var IDENT_KEY = (function () { var a = []; for (var p = 0; p < 24; p++) a.push(p); return a.join(','); })();

  function inversePermKey(cur) {
    // the permutation that solves `cur`: sticker at p must move to cur[p]
    return cur.join(',');
  }

  // change of the number of solved stickers when macro m is applied to cur
  function gainOf(cur, m) {
    var g = 0, mv = m.moved, sg = m.sigma;
    for (var k = 0; k < mv.length; k++) {
      var p = mv[k], h = cur[p];
      if (sg[p] === h) g++;
      if (p === h) g--;
    }
    return g;
  }

  function solveEdgeStickers(cur) {
    buildLibrary();
    var steps = [];
    var guard = 0;
    function take(m) { steps.push(m); cur = applyPerm(cur, m.sigma); }
    while (edgeSolvedCount(cur) < 24) {
      if (++guard > 60) return { error: 'Не удалось собрать рёбра (внутренняя ошибка).' };
      var direct = LIB_BY_KEY[inversePermKey(cur)];
      if (direct) { take(direct); continue; }
      var bestM = null, bestScore = 0, m, score;
      for (m = 0; m < LIB.length; m++) {
        var gain = gainOf(cur, LIB[m]);
        if (gain <= 0) continue;
        score = gain * 1000 - LIB[m].tokens.length;
        if (score > bestScore) { bestScore = score; bestM = LIB[m]; }
      }
      if (bestM) { take(bestM); continue; }
      // no single cycle helps: look two cycles ahead
      var best2 = null; bestScore = 0;
      for (var a = 0; a < LIB.length; a++) {
        var g1 = gainOf(cur, LIB[a]);
        var c1 = applyPerm(cur, LIB[a].sigma);
        for (m = 0; m < LIB.length; m++) {
          var g2 = g1 + gainOf(c1, LIB[m]);
          if (g2 <= 0) continue;
          score = g2 * 1000 - LIB[a].tokens.length - LIB[m].tokens.length;
          if (score > bestScore) { bestScore = score; best2 = [LIB[a], LIB[m]]; }
        }
      }
      if (!best2) {
        var wrong = 0, flipped = 0;
        for (var k = 0; k < 12; k++) {
          if (cur[2 * k] !== 2 * k) wrong++;
          if (cur[2 * k] === 2 * k + 1) flipped++;
        }
        if (wrong === 1 && flipped === 1) return { error: 'Такая позиция невозможна: перевёрнуто одно ребро. Проверьте цвета рёбер.' };
        return { error: 'Не удалось собрать рёбра (внутренняя ошибка).' };
      }
      take(best2[0]); take(best2[1]);
    }
    return { steps: steps };
  }

  // ------------------------------------------------------------- centres
  function centreKey(state) { return CENTRE_P.map(function (i) { return P.ANC[i][state[i]].join(','); }).join('|'); }
  var CENTRE_HOME = CENTRE_P.map(function (i) { return P.PIECES[i].anchor.join(','); }).join('|');
  function solveCentres(state) {
    if (centreKey(state) === CENTRE_HOME) return [];
    var prev = {}, start = centreKey(state);
    prev[start] = null;
    var queue = [{ st: state, key: start }];
    while (queue.length) {
      var cur = queue.shift();
      for (var k = 0; k < SLICES.length; k++) {
        var ns = P.applyMove(cur.st, SLICES[k], false);
        var nk = centreKey(ns);
        if (prev[nk] !== undefined) continue;
        prev[nk] = { from: cur.key, move: SLICES[k] };
        if (nk === CENTRE_HOME) {
          var path = [], x = nk;
          while (prev[x]) { path.push(prev[x].move); x = prev[x].from; }
          return path.reverse();
        }
        queue.push({ st: ns, key: nk });
      }
    }
    return null;
  }

  // ------------------------------------------------------------- blocks
  var BLOCK_NAMES = ['BIGx', 'BIGy', 'BIGz', 'LBx', 'LBy', 'LBz'];
  function blockKey(state) {
    return BLOCK_NAMES.map(function (n) { var i = P.PIDX[n]; return sgnKey(P.ANC[i][state[i]]); }).join(',');
  }
  function blocksSolved(state) {
    return BLOCK_NAMES.every(function (n) { return state[P.PIDX[n]] === 0; });
  }

  // ------------------------------------------------------------- solve
  // Returns {phases:[{id,title,groups:[{label,moves:[]}]}], moves:[...], states} or {error}
  function solve(state) {
    if (!P.isCube(state)) return { error: 'Кубик должен быть в форме куба.' };
    var phases = [];
    var cur = state.slice();

    var bAlg = DATA.blockTable[blockKey(cur)];
    if (bAlg === undefined) return { error: 'Неизвестное расположение блоков (внутренняя ошибка).' };
    var bMoves = bAlg ? bAlg.split(' ') : [];
    cur = P.applyAlg(cur, bMoves.join(' '), false).state;
    phases.push({
      id: 'blocks', title: 'Большие и L-образные блоки',
      note: bMoves.length ? 'Держите главный блок (снизу-сзади-слева) неподвижно и поворачивайте правую, верхнюю и переднюю половины, как у кубика 2×2.' : 'Блоки уже на месте.',
      groups: bMoves.length ? [{ label: 'Расставить блоки', moves: bMoves }] : []
    });

    var cMoves = solveCentres(cur);
    if (cMoves === null) return { error: 'Не удалось собрать центры: позиция невозможна. Проверьте цвета центров.' };
    cur = P.applyAlg(cur, cMoves.join(' '), false).state;
    phases.push({
      id: 'centres', title: 'Центры',
      note: cMoves.length ? 'Только средние слои: форма куба не меняется.' : 'Центры уже на месте.',
      groups: cMoves.length ? [{ label: 'Поставить центры', moves: cMoves }] : []
    });

    var es = solveEdgeStickers(edgeStickers(cur));
    if (es.error) return { error: es.error };
    var groups = es.steps.map(function (m, k) { return { label: 'Цикл рёбер ' + (k + 1), moves: m.tokens.slice() }; });
    groups.forEach(function (g) { cur = P.applyAlg(cur, g.moves.join(' '), false).state; });
    phases.push({
      id: 'edges', title: 'Рёбра',
      note: groups.length ? 'Каждая группа меняет местами три ребра и возвращает форму куба.' : 'Рёбра уже на месте.',
      groups: groups
    });

    if (!P.isSolved(cur)) return { error: 'Внутренняя ошибка: решение не собирает кубик.' };

    // flatten and verify legality move by move
    var moves = [], meta = [];
    phases.forEach(function (ph, pi) {
      ph.groups.forEach(function (g, gi) {
        g.moves.forEach(function (mv, mi) { moves.push(mv); meta.push({ phase: pi, group: gi, index: mi }); });
      });
    });
    var st = state.slice();
    for (var k = 0; k < moves.length; k++) {
      var n = P.applyMove(st, moves[k]);
      if (!n) return { error: 'Внутренняя ошибка: ход ' + moves[k] + ' (№' + (k + 1) + ') заблокирован.' };
      st = n;
    }
    return { phases: phases, moves: moves, meta: meta };
  }

  // Random reachable cube-form state (for practice and tests).
  function randomState(rand) {
    rand = rand || Math.random;
    var s = P.solvedState();
    var keys = Object.keys(DATA.blockTable);
    var alg = DATA.blockTable[keys[Math.floor(rand() * keys.length)]];
    if (alg) s = P.applyAlg(s, P.invertAlg(alg), false).state;
    buildLibrary();
    for (var k = 0; k < 12; k++) {
      var m = LIB[Math.floor(rand() * LIB.length)];
      s = P.applyAlg(s, m.tokens.join(' '), false).state;
      var sl = SLICES[Math.floor(rand() * SLICES.length)];
      s = P.applyMove(s, sl, false);
    }
    return s;
  }

  var Solver = {
    SURFACE: SURFACE, VISIBLE: VISIBLE_LIST, REVEALS: REVEALS,
    faceletColoursFromState: faceletColoursFromState,
    stateFromFacelets: stateFromFacelets,
    solve: solve, randomState: randomState,
    buildLibrary: buildLibrary, blocksSolved: blocksSolved,
    _edgeStickers: edgeStickers, _solveEdgeStickers: solveEdgeStickers
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
  else root.PuppetSolver = Solver;
})(this);
