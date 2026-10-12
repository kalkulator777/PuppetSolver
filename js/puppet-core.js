/*
 * Puppet Cube V2 model.
 *
 * The puzzle is a classic 3x3x3 ("inner cube") whose pieces on the L, D and B
 * sides carry extensions ("shell") filling the outer shape up to a 4x4x4 cube
 * that looks like a 2x2x2.  Coordinates are voxel centres relative to the core
 * centre, every coordinate in -2..2.  In the solved cube form all voxels lie in
 * [-2, 1]^3.  Axes: x -> R, y -> U, z -> F.  Plain ("thick") faces: L, D, B.
 * Faces with the small cross: R, U, F.
 *
 * Mirrors tools/puppet_model.py (the Python reference used to generate data.js).
 */
(function (root) {
  'use strict';

  var DATA = root.PUPPET_DATA;
  if (!DATA && typeof require === 'function') DATA = require('./data.js');

  // ------------------------------------------------------------ rotations
  // 3x3 integer matrices stored row-major in arrays of 9.
  function matMul(a, b) {
    var r = new Array(9);
    for (var i = 0; i < 3; i++)
      for (var j = 0; j < 3; j++)
        r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return r;
  }
  function matApply(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
  }
  var IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // +90 degrees (right hand rule) about x, y, z
  var QUARTER = [
    [1, 0, 0, 0, 0, -1, 0, 1, 0],
    [0, 0, 1, 0, 1, 0, -1, 0, 0],
    [0, -1, 0, 1, 0, 0, 0, 0, 1]
  ];
  var ROTS = [IDENT];
  (function () {
    var frontier = [IDENT];
    while (frontier.length) {
      var next = [];
      frontier.forEach(function (m) {
        QUARTER.forEach(function (g) {
          var n = matMul(g, m);
          var key = n.join(',');
          if (!ROTS.some(function (x) { return x.join(',') === key; })) { ROTS.push(n); next.push(n); }
        });
      });
      frontier = next;
    }
  })();
  var RKEY = {};
  ROTS.forEach(function (m, i) { RKEY[m.join(',')] = i; });
  var COMP = ROTS.map(function (g) {
    return ROTS.map(function (r) { return RKEY[matMul(g, r).join(',')]; });
  });
  var INV = ROTS.map(function (m) {
    return RKEY[[m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].join(',')];
  });
  function axisRot(axis, q) {
    var m = IDENT;
    for (var k = 0; k < ((q % 4) + 4) % 4; k++) m = matMul(QUARTER[axis], m);
    return RKEY[m.join(',')];
  }

  // ---------------------------------------------------------------- faces
  // 0 R(+x) 1 L(-x) 2 U(+y) 3 D(-y) 4 F(+z) 5 B(-z)
  var FACE_NAMES = ['R', 'L', 'U', 'D', 'F', 'B'];
  var FACE_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function dirToFace(d) {
    for (var f = 0; f < 6; f++)
      if (FACE_DIRS[f][0] === d[0] && FACE_DIRS[f][1] === d[1] && FACE_DIRS[f][2] === d[2]) return f;
    return -1;
  }
  var OPPOSITE = [1, 0, 3, 2, 5, 4];

  // --------------------------------------------------------------- pieces
  function octant(signs) {
    var rng = signs.map(function (s) { return s < 0 ? [0, 1] : [2, 3]; });
    var out = [];
    rng[0].forEach(function (a) { rng[1].forEach(function (b) { rng[2].forEach(function (c) { out.push([a, b, c]); }); }); });
    return out;
  }
  function same(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
  function toU(p) { return [p[0] - 2, p[1] - 2, p[2] - 2]; }
  var AX = 'xyz';

  var PIECES = [];
  function addPiece(name, kind, voxI) {
    var vox = voxI.map(toU);
    var inner = vox.filter(function (v) { return Math.abs(v[0]) <= 1 && Math.abs(v[1]) <= 1 && Math.abs(v[2]) <= 1; });
    if (inner.length !== 1) throw new Error('bad piece ' + name);
    PIECES.push({ name: name, kind: kind, vox: vox, anchor: inner[0] });
  }
  addPiece('MAIN', 'main', octant([-1, -1, -1]));
  for (var thin = 0; thin < 3; thin++) {
    var sg = [-1, -1, -1]; sg[thin] = 1;
    var v = octant(sg);
    var hidden = [1, 1, 1]; hidden[thin] = 2;
    v = v.filter(function (p) { return !same(p, hidden); });
    addPiece('BIG' + AX[thin], 'big', v);
    addPiece('HE' + AX[thin], 'edge', [hidden]);
  }
  for (var thick = 0; thick < 3; thick++) {
    var sg2 = [1, 1, 1]; sg2[thick] = -1;
    var oct = octant(sg2);
    var corner = [3, 3, 3]; corner[thick] = 1;
    var lb = oct.filter(function (p) { return p[thick] === 0; }).concat([corner]);
    addPiece('LB' + AX[thick], 'lblock', lb);
    oct.forEach(function (p) {
      if (p[thick] === 1 && !same(p, corner)) {
        var twos = 0;
        for (var a = 0; a < 3; a++) if (a !== thick && p[a] === 2) twos++;
        var kind = twos === 2 ? 'centre' : 'edge';
        addPiece((kind === 'centre' ? 'C' : 'IE') + p.join(''), kind, [p]);
      }
    });
  }
  octant([1, 1, 1]).forEach(function (p) {
    if (p[0] === 2 && p[1] === 2 && p[2] === 2) return; // core never moves
    var threes = p.filter(function (c) { return c === 3; }).length;
    var kind = { 3: 'little', 2: 'edge', 1: 'centre' }[threes];
    addPiece('A' + p.join(''), kind, [p]);
  });
  var NP = PIECES.length;
  var PIDX = {};
  PIECES.forEach(function (p, i) { PIDX[p.name] = i; });

  function inCube(v) {
    return v[0] >= -2 && v[0] <= 1 && v[1] >= -2 && v[1] <= 1 && v[2] >= -2 && v[2] <= 1;
  }
  // Stickers: voxel faces lying on the outer surface of the solved cube.
  PIECES.forEach(function (pc) {
    pc.stickers = [];
    pc.vox.forEach(function (vx, vi) {
      for (var f = 0; f < 6; f++) {
        var d = FACE_DIRS[f];
        var nb = [vx[0] + d[0], vx[1] + d[1], vx[2] + d[2]];
        if (!inCube(nb)) pc.stickers.push({ vox: vi, face: f });
      }
    });
    // inner-3x3 facelets of the anchor cubie
    pc.facelets = [];
    for (var f = 0; f < 6; f++) {
      var d = FACE_DIRS[f], a = pc.anchor, ok = false;
      for (var k = 0; k < 3; k++) if (d[k] !== 0 && a[k] === d[k]) ok = true;
      if (ok) pc.facelets.push(f);
    }
  });

  // per piece, per rotation: voxel positions and anchor position
  var VOX = PIECES.map(function (pc) {
    return ROTS.map(function (m) { return pc.vox.map(function (x) { return matApply(m, x); }); });
  });
  var ANC = PIECES.map(function (pc) {
    return ROTS.map(function (m) { return matApply(m, pc.anchor); });
  });

  // ------------------------------------------------------------ collisions
  // Masks over the 125 cells of [-2,2]^3 as 4 uint32 words.
  function cellIndex(v) { return (v[0] + 2) * 25 + (v[1] + 2) * 5 + (v[2] + 2); }
  var QLIST = [1, -1, 2, -2];
  function confMask(axis, q, cell) {
    var qi = QLIST.indexOf(q);
    var base = ((axis * 4 + qi) * 125 + cell) * 4;
    return DATA.conf.slice(base, base + 4);
  }
  function isShell(v) { return Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) === 2; }
  var SMASK = [], SWEPT = [];
  for (var pi = 0; pi < NP; pi++) {
    SMASK.push([]); SWEPT.push([]);
    for (var r = 0; r < 24; r++) {
      var sm = [0, 0, 0, 0];
      var shell = VOX[pi][r].filter(isShell);
      shell.forEach(function (x) { var c = cellIndex(x); sm[c >> 5] |= (1 << (c & 31)); });
      SMASK[pi].push(sm);
      var sw = [];
      for (var axis = 0; axis < 3; axis++) {
        sw.push(QLIST.map(function (q) {
          var w = [0, 0, 0, 0];
          shell.forEach(function (x) {
            var cm = confMask(axis, q, cellIndex(x));
            for (var k = 0; k < 4; k++) w[k] |= cm[k];
          });
          return w;
        }));
      }
      SWEPT[pi].push(sw);
    }
  }

  function layerOf(c) { return c <= -1 ? -1 : (c === 0 ? 0 : 1); }
  // layers: array of layer ids in {-1,0,1}
  function inLayers(layers, c) { return layers.indexOf(layerOf(c)) >= 0; }

  function movingPieces(state, axis, layers) {
    var res = [];
    for (var i = 0; i < NP; i++) if (inLayers(layers, ANC[i][state[i]][axis])) res.push(i);
    return res;
  }

  // Returns the direction (+2 / -2 / q) the turn can be made in, or 0 if blocked.
  function legalTurn(state, axis, layers, q) {
    var moving = [], st = [0, 0, 0, 0], i, k;
    for (i = 0; i < NP; i++) {
      if (inLayers(layers, ANC[i][state[i]][axis])) moving.push(i);
      else { var m = SMASK[i][state[i]]; for (k = 0; k < 4; k++) st[k] |= m[k]; }
    }
    var qq = ((q % 4) + 4) % 4;
    if (qq === 0) return 4;
    var tries = qq === 2 ? [2, -2] : [qq === 1 ? 1 : -1];
    for (var t = 0; t < tries.length; t++) {
      var qi = QLIST.indexOf(tries[t]);
      var w = [0, 0, 0, 0];
      for (var j = 0; j < moving.length; j++) {
        var s = SWEPT[moving[j]][state[moving[j]]][axis][qi];
        for (k = 0; k < 4; k++) w[k] |= s[k];
      }
      if (!((w[0] & st[0]) || (w[1] & st[1]) || (w[2] & st[2]) || (w[3] & st[3]))) return tries[t];
    }
    return 0;
  }

  // Apply a turn without legality check.
  function turn(state, axis, layers, q) {
    var g = axisRot(axis, q);
    var out = state.slice();
    for (var i = 0; i < NP; i++) if (inLayers(layers, ANC[i][state[i]][axis])) out[i] = COMP[g][state[i]];
    return out;
  }

  // Apply a turn; returns null when the turn is physically blocked.
  function move(state, axis, layers, q) {
    if (!legalTurn(state, axis, layers, q)) return null;
    return turn(state, axis, layers, q);
  }

  function isCube(state) {
    for (var i = 0; i < NP; i++) {
      var vs = VOX[i][state[i]];
      for (var j = 0; j < vs.length; j++) if (!inCube(vs[j])) return false;
    }
    return true;
  }

  function solvedState() { var s = []; for (var i = 0; i < NP; i++) s.push(0); return s; }

  function isSolved(state) {
    for (var i = 0; i < NP; i++) {
      if (PIECES[i].kind === 'centre') { if (!same(ANC[i][state[i]], PIECES[i].anchor)) return false; }
      else if (state[i] !== 0) return false;
    }
    return true;
  }

  // ------------------------------------------------------------- notation
  // A move is described by the outward normal of its layer (signed axis), the
  // layer kind and the number of clockwise quarter turns seen from that normal.
  //   outer: R L U D F B (on L, D, B this is the thick half, on R, U, F the
  //          thin outer layer); mid: M (as L), E (as D), S (as F);
  //   wide: Rw Lw Uw Dw Fw Bw (outer layer + middle slice).
  var FACE_LETTER = { R: 0, L: 1, U: 2, D: 3, F: 4, B: 5 };
  var SLICE = { M: 1, E: 3, S: 4 }; // face whose sense the slice follows
  function parseToken(tok) {
    tok = tok.replace(/’/g, "'");
    var m = /^([RLUDFBMES])(w?)(2'|'2|2|')?$/.exec(tok);
    if (!m) throw new Error('Неизвестный ход: ' + tok);
    var letter = m[1], wide = m[2] === 'w', suf = m[3] || '';
    var turns = suf === "'" ? -1 : (suf === '' ? 1 : 2);
    var face, kind;
    if (SLICE[letter] !== undefined) { face = SLICE[letter]; kind = 'mid'; if (wide) throw new Error('Неизвестный ход: ' + tok); }
    else { face = FACE_LETTER[letter]; kind = wide ? 'wide' : 'outer'; }
    return { face: face, kind: kind, turns: turns };
  }
  function parse(alg) {
    return alg.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean).map(parseToken);
  }
  // physical description: axis, layers, q (right hand quarter turns about +axis)
  function physical(mv) {
    var d = FACE_DIRS[mv.face];
    var axis = d[0] !== 0 ? 0 : (d[1] !== 0 ? 1 : 2);
    var sgn = d[axis];
    var layers = mv.kind === 'outer' ? [sgn] : (mv.kind === 'mid' ? [0] : [sgn, 0]);
    // clockwise seen from outside = rotation by -90 about the outward normal
    var q = mv.turns === 2 ? 2 : -mv.turns * sgn;
    return { axis: axis, layers: layers, q: q };
  }
  function moveName(mv) {
    var suf = mv.turns === 2 ? '2' : (mv.turns === -1 ? "'" : '');
    if (mv.kind === 'mid') {
      var letter = mv.face === 1 || mv.face === 0 ? 'M' : (mv.face === 3 || mv.face === 2 ? 'E' : 'S');
      var t = mv.turns;
      if (mv.face !== SLICE[letter] && t !== 2) t = -t;
      return letter + (t === 2 ? '2' : (t === -1 ? "'" : ''));
    }
    return FACE_NAMES[mv.face] + (mv.kind === 'wide' ? 'w' : '') + suf;
  }
  function normalizeName(tok) { return moveName(parseToken(tok)); }

  function applyMove(state, tok, check) {
    var mv = typeof tok === 'string' ? parseToken(tok) : tok;
    var p = physical(mv);
    if (check === false) return turn(state, p.axis, p.layers, p.q);
    return move(state, p.axis, p.layers, p.q);
  }
  // Returns {state, blockedAt} (blockedAt = index of first blocked move or -1)
  function applyAlg(state, alg, check) {
    var mvs = typeof alg === 'string' ? parse(alg) : alg;
    for (var i = 0; i < mvs.length; i++) {
      var n = applyMove(state, mvs[i], check);
      if (!n) return { state: state, blockedAt: i };
      state = n;
    }
    return { state: state, blockedAt: -1 };
  }
  function invertToken(tok) {
    var mv = parseToken(tok);
    if (mv.turns !== 2) mv.turns = -mv.turns;
    return moveName(mv);
  }
  function invertAlg(alg) {
    return alg.split(/\s+/).filter(Boolean).reverse().map(invertToken).join(' ');
  }

  // Re-express an algorithm written for a different holding.  `rot` maps
  // directions of the algorithm's frame to directions of our frame.
  function transformAlg(alg, rot) {
    var m = ROTS[rot];
    return parse(alg).map(function (mv) {
      var d = matApply(m, FACE_DIRS[mv.face]);
      return moveName({ face: dirToFace(d), kind: mv.kind, turns: mv.turns });
    }).join(' ');
  }

  // Merge consecutive turns of the same layer(s).
  function simplify(tokens) {
    var out = [];
    tokens.forEach(function (tok) {
      var mv = parseToken(tok), p = physical(mv);
      if (out.length) {
        var last = out[out.length - 1];
        var lp = physical(parseToken(last));
        if (lp.axis === p.axis && lp.layers.slice().sort().join() === p.layers.slice().sort().join()) {
          var q = (((lp.q + p.q) % 4) + 4) % 4;
          out.pop();
          if (q !== 0) {
            // express as a turn of the same notation family as the last move
            var lm = parseToken(last);
            var base = physical({ face: lm.face, kind: lm.kind, turns: 1 }).q; // q of a single cw turn
            var turns = q === 2 ? 2 : (q === (((base % 4) + 4) % 4) ? 1 : -1);
            out.push(moveName({ face: lm.face, kind: lm.kind, turns: turns }));
          }
          return;
        }
      }
      out.push(tok);
    });
    return out;
  }

  // ---------------------------------------------------------- inner facelets
  // Facelet of the inner 3x3: (position of cubie, face direction).
  // Index = face * 9 + row-major index of the two in-plane coordinates.
  function faceletIndex(pos, f) {
    var d = FACE_DIRS[f];
    var axis = d[0] !== 0 ? 0 : (d[1] !== 0 ? 1 : 2);
    var o = [0, 1, 2].filter(function (a) { return a !== axis; });
    return f * 9 + (pos[o[0]] + 1) * 3 + (pos[o[1]] + 1);
  }
  function faceletPos(idx) {
    var f = Math.floor(idx / 9), k = idx % 9;
    var d = FACE_DIRS[f];
    var axis = d[0] !== 0 ? 0 : (d[1] !== 0 ? 1 : 2);
    var o = [0, 1, 2].filter(function (a) { return a !== axis; });
    var p = [0, 0, 0];
    p[axis] = d[axis];
    p[o[0]] = Math.floor(k / 3) - 1;
    p[o[1]] = (k % 3) - 1;
    return { pos: p, face: f };
  }
  // For each facelet position: the face (home colour) of the facelet there.
  // The core facelet-free centre of each face keeps its home colour if no
  // centre piece is present (never happens: all six centres are pieces).
  function facelets(state) {
    var out = new Array(54);
    for (var i = 0; i < NP; i++) {
      var pc = PIECES[i], m = ROTS[state[i]];
      var pos = ANC[i][state[i]];
      pc.facelets.forEach(function (f) {
        var nd = matApply(m, FACE_DIRS[f]);
        out[faceletIndex(pos, dirToFace(nd))] = f;
      });
    }
    return out;
  }

  var Puppet = {
    DATA: DATA,
    ROTS: ROTS, COMP: COMP, INV: INV, axisRot: axisRot, matApply: matApply, matMul: matMul,
    FACE_NAMES: FACE_NAMES, FACE_DIRS: FACE_DIRS, OPPOSITE: OPPOSITE, dirToFace: dirToFace,
    PIECES: PIECES, NP: NP, PIDX: PIDX, VOX: VOX, ANC: ANC,
    layerOf: layerOf, movingPieces: movingPieces,
    legalTurn: legalTurn, turn: turn, move: move,
    isCube: isCube, solvedState: solvedState, isSolved: isSolved,
    parse: parse, parseToken: parseToken, physical: physical, moveName: moveName,
    normalizeName: normalizeName, applyMove: applyMove, applyAlg: applyAlg,
    invertToken: invertToken, invertAlg: invertAlg, transformAlg: transformAlg, simplify: simplify,
    faceletIndex: faceletIndex, faceletPos: faceletPos, facelets: facelets
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Puppet;
  else root.Puppet = Puppet;
})(this);
