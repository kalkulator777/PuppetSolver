// Node tests for the Puppet Cube model and solver.  Run:  node tests/run-tests.js
'use strict';
var path = require('path');
var fs = require('fs');
var P = require('../js/puppet-core.js');
var S = require('../js/solver.js');

var failures = 0, passed = 0;
function check(name, cond, info) {
  if (cond) { passed++; return; }
  failures++;
  console.log('FAIL: ' + name + (info !== undefined ? ' — ' + info : ''));
}
function section(t) { console.log('\n# ' + t); }

var solved = P.solvedState();
var FC = ['W', 'Y', 'R', 'O', 'G', 'B'];
var seed = 4242;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

// --------------------------------------------------------------------------
section('model basics');
check('26 pieces', P.NP === 26);
check('24 rotations', P.ROTS.length === 24);
check('solved is cube form', P.isCube(solved));
check('solved is solved', P.isSolved(solved));
(function () {
  var occ = {};
  var n = 0;
  P.PIECES.forEach(function (pc) { pc.vox.forEach(function (v) { occ[v.join(',')] = 1; n++; }); });
  check('63 voxels (+ core) fill the cube', n === 63 && Object.keys(occ).length === 63);
})();
check('notation round trip', P.invertAlg("Rw U2 M' S E2 F'") === "F E2 S' M U2 Rw'");
check('simplify merges', P.simplify(['R', 'R', 'U', "U'", 'M2', 'M2', 'Rw', 'Rw2']).join(' ') === "R2 Rw'");
['M2', 'E2', 'S2', 'M', "E'", 'S'].forEach(function (m) {
  check('middle slice ' + m + ' keeps the cube shape', P.isCube(P.applyMove(solved, m)));
});
['U', 'R', 'F', 'L', 'D', 'B', 'Rw', 'Uw', 'Fw'].forEach(function (m) {
  var s = P.applyMove(solved, m);
  check('outer turn ' + m + ' is legal from solved', !!s);
  check('outer turn ' + m + ' changes the shape', s && !P.isCube(s));
});

// --------------------------------------------------------------------------
section('JS model matches the Python reference (tests/vectors.json)');
(function () {
  var file = path.join(__dirname, 'vectors.json');
  if (!fs.existsSync(file)) { console.log('  (skipped: run python3 tools/gen_vectors.py)'); return; }
  var walks = JSON.parse(fs.readFileSync(file, 'utf8'));
  var mism = 0, steps = 0;
  walks.forEach(function (w, wi) {
    var s = solved;
    w.steps.forEach(function (st) {
      var n = P.applyMove(s, st.move);
      steps++;
      if (!!n !== st.legal) mism++;
      if (n) s = n;
    });
    var snap = [];
    for (var i = 0; i < P.NP; i++) P.VOX[i][s[i]].forEach(function (v) { snap.push(P.PIECES[i].name + ':' + v.join(',')); });
    snap.sort();
    check('walk ' + wi + ' final voxels', snap.join(';') === w.final.join(';'));
    check('walk ' + wi + ' cube flag', P.isCube(s) === w.cube);
  });
  check('legality agrees on all ' + steps + ' steps', mism === 0, mism + ' mismatches');
})();

// --------------------------------------------------------------------------
section('published algorithms');
// Algorithms in 2x2 notation for the holding "main block at down-left-front":
// on the cross side a half is a wide turn, on the plain side a thick turn.
function from2x2(alg, rot) {
  return alg.split(' ').map(function (t) {
    var mv = P.parseToken(t);
    var f = P.dirToFace(P.matApply(P.ROTS[rot], P.FACE_DIRS[mv.face]));
    var crossSide = f === 0 || f === 2 || f === 4;
    return P.moveName({ face: f, kind: crossSide ? 'wide' : 'outer', turns: mv.turns });
  }).join(' ');
}
function holdingsWhere(alg, pred) {
  var res = [];
  for (var r = 0; r < 24; r++) {
    var a = from2x2(alg, r);
    var x = P.applyAlg(solved, a);
    if (x.blockedAt < 0 && pred(x.state)) res.push(r);
  }
  return res;
}
function changedBlocks(st) {
  return ['BIGx', 'BIGy', 'BIGz', 'LBx', 'LBy', 'LBz'].filter(function (n) { return st[P.PIDX[n]] !== 0; });
}
[
  ['vixra big block swap 1', "R U2 R' U R' B' U2 R2 U' B'", 'BIG'],
  ['vixra big block swap 2', "B' R' U2 R2 B' U' R U' R2 U", 'BIG'],
  ['vixra L block swap 1', "U2 R B2 R' B R B2 R2 U R U", 'LB'],
  ['vixra L block swap 2', "U2 B' R2 B R' B' R2 B2 U' B' U'", 'LB']
].forEach(function (t) {
  var hs = holdingsWhere(t[1], function (st) {
    var ch = changedBlocks(st);
    return P.isCube(st) && ch.length === 2 && ch.every(function (n) { return n.indexOf(t[2]) === 0; });
  });
  check(t[0] + ' works in exactly the 3 symmetric holdings', hs.length === 3, JSON.stringify(hs));
});
// the main block must sit at down-left-front in those holdings: our main block
// is at (-,-,-); the holding maps algorithm directions to ours, so the
// algorithm's (-x,-y,+z) corner must map to (-1,-1,-1).
(function () {
  var hs = holdingsWhere("R U2 R' U R' B' U2 R2 U' B'", P.isCube);
  var ok = hs.every(function (r) {
    var v = P.matApply(P.ROTS[r], [-1, -1, 1]);
    return v[0] === -1 && v[1] === -1 && v[2] === -1;
  });
  check('big block swap holding = main block down-left-front', ok);
})();
["M2 U' M U2 M' U' M2", "M2 U M U2 M' U M2", "M U M' U2 M U M'", "M U' M' U2 M U' M'"].forEach(function (alg) {
  var n = 0;
  for (var r = 0; r < 24; r++) {
    var x = P.applyAlg(solved, P.transformAlg(alg, r));
    if (x.blockedAt < 0 && P.isCube(x.state)) n++;
  }
  check('tutorial edge algorithm ' + alg + ' legal in all holdings', n === 24, n);
});

// --------------------------------------------------------------------------
section('generated data');
(function () {
  var keys = Object.keys(P.DATA.blockTable);
  check('36 block arrangements', keys.length === 36);
  var bad = 0, maxLen = 0;
  keys.forEach(function (k) {
    var alg = P.DATA.blockTable[k];
    if (!alg) return;
    maxLen = Math.max(maxLen, alg.split(' ').length);
    var start = P.applyAlg(solved, P.invertAlg(alg));
    if (start.blockedAt >= 0 || !P.isCube(start.state)) { bad++; return; }
    var back = P.applyAlg(start.state, alg);
    if (back.blockedAt >= 0 || back.state.join() !== solved.join()) bad++;
  });
  check('block table entries legal and correct', bad === 0, bad);
  check('block solutions at most 13 moves', maxLen <= 13, maxLen);

  var lib = S.buildLibrary();
  check('edge library has >= 1700 distinct 3-cycles', lib.length >= 1700, lib.length);
  var illegal = 0, impure = 0;
  lib.forEach(function (m) {
    var x = P.applyAlg(solved, m.tokens.join(' '));
    if (x.blockedAt >= 0) { illegal++; return; }
    if (m.moved.length !== 6 || !P.isCube(x.state)) impure++;
  });
  check('every edge macro is legal', illegal === 0, illegal);
  check('every edge macro is a pure 3-cycle', impure === 0, impure);

  P.DATA.shapes.forEach(function (sh) {
    var shape = P.applyAlg(solved, P.invertAlg(sh.alg));
    check('shape ' + sh.name + ' reachable', shape.blockedAt < 0 && !P.isCube(shape.state));
    var back = P.applyAlg(shape.state, sh.alg);
    check('shape ' + sh.name + ' algorithm restores the cube', back.blockedAt < 0 && P.isSolved(back.state));
  });
})();

// --------------------------------------------------------------------------
section('input and reveal steps');
check('39 facelets visible in cube form', S.VISIBLE.length === 39, S.VISIBLE.length);
(function () {
  var seen = {};
  S.VISIBLE.forEach(function (f) { seen[f] = 1; });
  S.REVEALS.forEach(function (r) {
    check('reveal ' + r.move + ' shows 6 new facelets', r.reads.length === 6, r.reads.length);
    r.reads.forEach(function (x) { seen[x.original] = 1; });
  });
  check('visible + reveals cover all 54 facelets', Object.keys(seen).length === 54, Object.keys(seen).length);
  // reading after the reveal turn really shows the original facelet
  var st = S.randomState(rnd);
  var cols = S.faceletColoursFromState(st, FC);
  S.REVEALS.forEach(function (r) {
    var after = S.faceletColoursFromState(P.applyMove(st, r.move), FC);
    var ok = r.reads.every(function (x) { return after[x.shown] === cols[x.original]; });
    check('reveal ' + r.move + ' mapping', ok);
  });
  // surface map: every cell of each 4x4 face shows a visible facelet
  var cells = 0;
  S.SURFACE.forEach(function (rows) { rows.forEach(function (row) { row.forEach(function (c) { if (S.VISIBLE.indexOf(c.facelet) >= 0) cells++; }); }); });
  check('96 surface cells map to visible facelets', cells === 96, cells);
})();
(function () {
  var st = S.randomState(rnd);
  var cols = S.faceletColoursFromState(st, FC);
  var r = S.stateFromFacelets(cols);
  check('colours -> state round trip', !r.error && r.state.every(function (x, i) {
    return P.PIECES[i].kind === 'centre' ? P.ANC[i][x].join() === P.ANC[i][st[i]].join() : x === st[i];
  }), r.error);
  var c2 = cols.slice(); c2[5] = null;
  check('missing colour reported', !!S.stateFromFacelets(c2).error);
  // swap two stickers of one edge piece -> single flip -> impossible
  var edgeIdx = P.PIDX.IE132;
  var pos = P.ANC[edgeIdx][st[edgeIdx]];
  var fs = [];
  for (var f = 0; f < 6; f++) {
    var d = P.FACE_DIRS[f], on = false;
    for (var k = 0; k < 3; k++) if (d[k] !== 0 && pos[k] === d[k]) on = true;
    if (on) fs.push(P.faceletIndex(pos, f));
  }
  var c3 = cols.slice(); var tmp = c3[fs[0]]; c3[fs[0]] = c3[fs[1]]; c3[fs[1]] = tmp;
  var r3 = S.stateFromFacelets(c3);
  var s3 = r3.error ? r3 : S.solve(r3.state);
  check('flipped edge is reported as an error', !!s3.error);
  // swap two colours of one big block -> a mirrored piece cannot exist
  var c4 = cols.slice();
  var a = P.faceletIndex([-1, -1, 1], 1), b = P.faceletIndex([-1, -1, 1], 3);
  tmp = c4[a]; c4[a] = c4[b]; c4[b] = tmp;
  var r4 = S.stateFromFacelets(c4);
  check('inconsistent block colours reported', !!(r4.error || S.solve(r4.state).error));
})();

// --------------------------------------------------------------------------
section('solver on random positions');
(function () {
  var N = 300, fails = 0, total = 0, maxLen = 0;
  for (var n = 0; n < N; n++) {
    var st = S.randomState(rnd);
    var parsed = S.stateFromFacelets(S.faceletColoursFromState(st, FC));
    if (parsed.error) { fails++; continue; }
    var sol = S.solve(parsed.state);
    if (sol.error) { fails++; continue; }
    var res = P.applyAlg(st, sol.moves.join(' '));
    if (res.blockedAt >= 0 || !P.isSolved(res.state)) { fails++; continue; }
    total += sol.moves.length; maxLen = Math.max(maxLen, sol.moves.length);
  }
  check('all ' + N + ' random positions solved with legal moves', fails === 0, fails + ' failures');
  console.log('  average ' + (total / N).toFixed(1) + ' moves, max ' + maxLen);
  var s0 = S.solve(solved);
  check('solved position needs no moves', !s0.error && s0.moves.length === 0);
})();

console.log('\n' + passed + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
