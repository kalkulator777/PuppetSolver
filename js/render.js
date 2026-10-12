/*
 * Canvas2D renderer for the Puppet Cube V2 model (js/puppet-core.js).
 *
 * Dependency free, classic script (works from file://).  Load after
 * js/data.js and js/puppet-core.js.  Exposes window.PuppetRenderer
 * (module.exports in Node, where it can only be required, not drawn).
 *
 *   var r = new PuppetRenderer(canvas, {
 *     colors: [R, L, U, D, F, B],   // css colours of the six home faces
 *     interior: '#2a2a2a',          // colour of plastic (non-sticker) faces
 *     background: null,             // null -> transparent canvas, else css colour
 *     yaw: -35, pitch: 30,          // default view in degrees (U, F, R visible)
 *     zoom: 1,
 *     // rarely needed: edgeColor '#0c0c0e', edgeWidth 0.042 (world units),
 *     // fit 4.15 (world units fitted into half the short side),
 *     // perspective 24 (eye distance), dragSpeed 0.45 (degrees per css px)
 *   });
 *   r.setState(state)               // array of 26 rotation indices; redraws.
 *                                   // Cancels a running/queued animation.
 *   r.getState()                    // copy of the displayed state
 *   r.setStickerColorFn(fn|null)    // fn(piece, homeFace) -> css | null
 *                                   // (null -> colors[homeFace]); call r.render()
 *                                   // after the data behind fn changes
 *   r.setColors([6 css])            // replace options.colors
 *   r.setHighlights([{piece, face}] | null)   // face = home face index; pulsing
 *   r.animateMove(token, {duration: 300}) -> Promise
 *        token: 'Rw\'' etc. (or a parsed move object).  Calls made while a move
 *        is animating are QUEUED and run in order.  Resolves with the new state,
 *        null if the move is physically blocked (the layer shakes and flashes
 *        red, the state is kept), undefined if cancelled by setState()/destroy().
 *        Rejects on an invalid token.
 *   r.isAnimating()                 // a move is running or queued
 *   r.pick(clientX, clientY) -> {piece, face} | null   // sticker under the point;
 *                                   // null for background and plastic faces
 *   r.resize()                      // after the canvas' css size changes
 *   r.setView(yaw, pitch); r.getView(); r.resetView(); r.setZoom(z);
 *   r.render(); r.destroy();
 *   r.onPick = function (hit) {};  // tap (< 6 px movement) on the canvas
 *
 * The canvas must get its size from css (e.g. width:100%; height:100%); the
 * backing store is sized to css size * devicePixelRatio by resize().  Dragging
 * rotates the view (yaw / pitch, pitch clamped to +-88); the canvas gets
 * touch-action: none.
 *
 * Geometry: every piece is a set of unit voxels on the integer grid (see
 * puppet-core.js).  A voxel face is drawn when the neighbouring cell is free
 * (during an animation moving and static pieces are treated as separate
 * worlds) and it faces the camera.  Faces are painted back to front per voxel:
 * for voxels of one rigid lattice the distance from the eye to the voxel centre
 * is an exact painter's order for unit cubes, also under perspective.  During a
 * turn the moving pieces form a second (rotated) lattice; the two are ordered
 * by slabs perpendicular to the turning axis and, inside a slab, by a 2D
 * separating-axis test, combined with a topological sort.
 */
(function (root) {
  'use strict';

  var DEG = Math.PI / 180;
  var DEFAULT_COLORS = ['#d0212c', '#ff7b14', '#f6f6f2', '#ffd21c', '#12a150', '#1f5fd1'];
  var CENTRE = [-0.5, -0.5, -0.5];          // visual centre of the solved cube
  var FACE_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // corners of a face quad in the (b, c) in-plane axes, and for each edge k
  // (corner k -> k+1) the in-plane neighbour direction as [slot, sign]
  var QUAD = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  var EDGE_NB = [[2, -1], [1, 1], [2, 1], [1, -1]];
  var LIGHT = (function () {
    var l = [-0.32, 0.6, 0.74], m = Math.sqrt(l[0] * l[0] + l[1] * l[1] + l[2] * l[2]);
    return [l[0] / m, l[1] / m, l[2] / m];
  })();
  var TAP_SLOP = 6;                         // css px

  function getPuppet() {
    if (root && root.Puppet) return root.Puppet;
    if (typeof require === 'function') { try { return require('./puppet-core.js'); } catch (e) { /* ignore */ } }
    return null;
  }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }
  function rafCall(cb) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
    return setTimeout(function () { cb(nowMs()); }, 16);
  }
  function rafCancel(id) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id);
  }
  function cellOf(x, y, z) {
    if (x < -2 || x > 2 || y < -2 || y > 2 || z < -2 || z > 2) return -1;
    return (x + 2) * 25 + (y + 2) * 5 + (z + 2);
  }
  // rotation by `ang` radians about +axis (right hand rule), row-major 3x3
  function axisMatrix(axis, ang) {
    var c = Math.cos(ang), s = Math.sin(ang);
    if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
    if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
    return [c, -s, 0, s, c, 0, 0, 0, 1];
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function tracePath(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(s[0], s[1]);
    ctx.lineTo(s[2], s[3]);
    ctx.lineTo(s[4], s[5]);
    ctx.lineTo(s[6], s[7]);
    ctx.closePath();
  }
  function traceSeams(ctx, s, seams) {
    var any = false;
    ctx.beginPath();
    for (var k = 0; k < 4; k++) {
      if (!seams[k]) continue;
      var k2 = (k + 1) & 3;
      ctx.moveTo(s[2 * k], s[2 * k + 1]);
      ctx.lineTo(s[2 * k2], s[2 * k2 + 1]);
      any = true;
    }
    return any;
  }

  // =====================================================================
  function PuppetRenderer(canvas, options) {
    if (!(this instanceof PuppetRenderer)) return new PuppetRenderer(canvas, options);
    var P = getPuppet();
    if (!P) throw new Error('PuppetRenderer: load js/puppet-core.js first');
    options = options || {};
    this.P = P;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colors = (options.colors || DEFAULT_COLORS).slice();
    this.interior = options.interior || '#2a2a2a';
    this.background = options.background || null;
    this.edgeColor = options.edgeColor || '#0c0c0e';
    this.edgeWidth = num(options.edgeWidth, 0.042);     // in world units
    this.fit = num(options.fit, 4.15);                  // world units fitted into half the short side
    this.camDist = num(options.perspective, 24);        // eye distance in world units
    this.dragSpeed = num(options.dragSpeed, 0.45);      // degrees per css px
    this.defaultYaw = num(options.yaw, -35);
    this.defaultPitch = num(options.pitch, 30);
    this.yaw = this.defaultYaw;
    this.pitch = this.defaultPitch;
    this.zoom = num(options.zoom, 1);
    this.onPick = null;

    this.state = P.solvedState();
    this.anim = null;
    this._gen = 0;
    this._queue = Promise.resolve();
    this._pending = 0;
    this._colorFn = null;
    this._hl = null;
    this._hlStart = nowMs();
    this._rgbCache = {};
    this._drawn = [];
    this._raf = 0;
    this._dirty = true;
    this._dpr = 1;
    this._ptr = null;

    this._prepTables();
    this._build();
    this._bindPointer();
    this.resize();
    this.render();
  }

  var proto = PuppetRenderer.prototype;

  // ----------------------------------------------------------- tables
  proto._prepTables = function () {
    var P = this.P;
    // sticker flags per piece: stick[i][voxIndex * 6 + homeFace]
    this._stick = P.PIECES.map(function (pc) {
      var a = new Uint8Array(pc.vox.length * 6);
      pc.stickers.forEach(function (s) { a[s.vox * 6 + s.face] = 1; });
      return a;
    });
    // HOME[r][f]: home face of the face currently pointing along FACE_DIRS[f]
    this._home = P.ROTS.map(function (m, r) {
      var inv = P.ROTS[P.INV[r]];
      return FACE_DIRS.map(function (d) { return P.dirToFace(P.matApply(inv, d)); });
    });
  };

  // Build the list of exposed voxel faces for the current state (and the
  // moving set of the running animation, if any).  Geometry is in grid space;
  // the animation rotation is applied per frame.
  proto._build = function () {
    var P = this.P, st = this.state, NP = P.NP, i, vi, f, k;
    var moving = new Uint8Array(NP);
    if (this.anim) this.anim.moving.forEach(function (j) { moving[j] = 1; });
    var occ = [new Uint8Array(125), new Uint8Array(125)];
    var owner = new Int16Array(125), ownerVi = new Int16Array(125);
    for (k = 0; k < 125; k++) owner[k] = -1;
    for (i = 0; i < NP; i++) {
      var vs = P.VOX[i][st[i]], o = occ[moving[i]];
      for (vi = 0; vi < vs.length; vi++) {
        var c0 = cellOf(vs[vi][0], vs[vi][1], vs[vi][2]);
        if (c0 < 0) continue;
        o[c0] = 1; owner[c0] = i; ownerVi[c0] = vi;
      }
    }
    // the core (never a piece) is solid for both groups
    var core = cellOf(0, 0, 0);
    occ[0][core] = occ[1][core] = 1;

    // Does the face (cell w, normal d) continue the face of piece i with the
    // given sticker flag?  (same piece, drawn, same colour)
    function continues(i, og, sk, home, isSt, w0, w1, w2, d) {
      var wc = cellOf(w0, w1, w2);
      if (wc < 0 || owner[wc] !== i) return false;
      var wn = cellOf(w0 + d[0], w1 + d[1], w2 + d[2]);
      if (wn >= 0 && og[wn]) return false;             // that face is hidden
      return sk[ownerVi[wc] * 6 + home] === isSt;
    }

    var voxels = [];
    for (i = 0; i < NP; i++) {
      var g = moving[i], og = occ[g], hm = this._home[st[i]], sk = this._stick[i];
      var vl = P.VOX[i][st[i]];
      for (vi = 0; vi < vl.length; vi++) {
        var v = vl[vi];
        var vox = { pi: i, vi: vi, g: g, c: v, wc: v, k: 0, dist: 0, faces: [], vis: [],
                    x0: 0, y0: 0, x1: 0, y1: 0 };
        for (f = 0; f < 6; f++) {
          var d = FACE_DIRS[f];
          var nb = cellOf(v[0] + d[0], v[1] + d[1], v[2] + d[2]);
          if (nb >= 0 && og[nb]) continue;
          var home = hm[f], isSt = sk[vi * 6 + home];
          var a = f >> 1, b = (a + 1) % 3, cc = (a + 2) % 3;
          var ax3 = [a, b, cc];
          var seams = [true, true, true, true], es = [];
          for (k = 0; k < 4; k++) {
            var e = [0, 0, 0];
            e[ax3[EDGE_NB[k][0]]] = EDGE_NB[k][1];
            es.push(e);
            if (continues(i, og, sk, home, isSt, v[0] + e[0], v[1] + e[1], v[2] + e[2], d)) seams[k] = false;
          }
          // concave corners of a merged sticker outline: corner k joins edges
          // k-1 and k; both continue but the diagonal neighbour does not
          var concave = [false, false, false, false];
          for (k = 0; k < 4; k++) {
            var e1 = es[(k + 3) & 3], e2 = es[k];
            if (seams[(k + 3) & 3] || seams[k]) continue;
            concave[k] = !continues(i, og, sk, home, isSt,
              v[0] + e1[0] + e2[0], v[1] + e1[1] + e2[1], v[2] + e1[2] + e2[2], d);
          }
          var corners = new Float64Array(12);
          for (k = 0; k < 4; k++) {
            var p = [v[0] + 0.5 * d[0], v[1] + 0.5 * d[1], v[2] + 0.5 * d[2]];
            p[b] += 0.5 * QUAD[k][0];
            p[cc] += 0.5 * QUAD[k][1];
            corners[3 * k] = p[0]; corners[3 * k + 1] = p[1]; corners[3 * k + 2] = p[2];
          }
          vox.faces.push({ pi: i, home: home, st: isSt, n: d, corners: corners, seams: seams,
                           concave: concave, scr: new Float64Array(8), shade: 1, vox: vox });
        }
        if (vox.faces.length) voxels.push(vox);
      }
    }
    this._voxels = voxels;
  };

  // ----------------------------------------------------------- colours
  proto._parse = function (css) {
    var hit = this._rgbCache[css];
    if (hit) return hit;
    var ctx = this.ctx, prev = ctx.fillStyle, out = [0, 0, 0, 1];
    ctx.fillStyle = '#000000';
    ctx.fillStyle = css;
    var s = String(ctx.fillStyle);
    ctx.fillStyle = prev;
    if (s.charAt(0) === '#') {
      out = [parseInt(s.substr(1, 2), 16), parseInt(s.substr(3, 2), 16), parseInt(s.substr(5, 2), 16), 1];
    } else {
      var m = s.match(/[\d.]+/g);
      if (m && m.length >= 3) out = [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1];
    }
    this._rgbCache[css] = out;
    return out;
  };
  proto._faceRGB = function (face, cache) {
    if (!face.st) return this._parse(this.interior);
    var key = face.pi * 6 + face.home;
    var c = cache[key];
    if (c) return c;
    var css = null;
    if (this._colorFn) { try { css = this._colorFn(face.pi, face.home); } catch (e) { css = null; } }
    if (css == null || css === '') css = this.colors[face.home];
    c = this._parse(css);
    cache[key] = c;
    return c;
  };

  // ----------------------------------------------------------- drawing
  proto.render = function () { this._dirty = true; this._requestFrame(); };

  proto._requestFrame = function () {
    if (this._raf) return;
    var self = this;
    this._raf = rafCall(function () { self._raf = 0; self._frame(); });
  };

  proto._frame = function () {
    var t = nowMs();
    if (this.anim) this._stepAnim(t);
    this._draw(t);
    if (this.anim || this._hl) this._requestFrame();
  };

  proto._draw = function (t) {
    var canvas = this.canvas, ctx = this.ctx, W = canvas.width, H = canvas.height;
    this._dirty = false;
    if (!W || !H) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.background) { ctx.fillStyle = this.background; ctx.fillRect(0, 0, W, H); }
    else ctx.clearRect(0, 0, W, H);

    var yaw = this.yaw * DEG, pitch = this.pitch * DEG;
    var cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // world -> camera: V = Rx(pitch) * Ry(yaw); camera looks along -z
    var V0 = cyw, V1 = 0, V2 = syw,
        V3 = sp * syw, V4 = cp, V5 = -sp * cyw,
        V6 = -cp * syw, V7 = sp, V8 = cp * cyw;
    var D = this.camDist;
    var eye = [CENTRE[0] + D * V6, CENTRE[1] + D * V7, CENTRE[2] + D * V8];
    var scale = Math.min(W, H) / (2 * this.fit) * this.zoom;
    var hx = W / 2, hy = H / 2;

    var anim = this.anim, R = null, flash = 0;
    if (anim) { R = axisMatrix(anim.axis, anim.angle); flash = anim.flash; }

    var voxels = this._voxels, list = [], i, j, k;
    for (i = 0; i < voxels.length; i++) {
      var vox = voxels[i], c = vox.c, rot = vox.g && R;
      var wc = rot ? [R[0] * c[0] + R[1] * c[1] + R[2] * c[2],
                      R[3] * c[0] + R[4] * c[1] + R[5] * c[2],
                      R[6] * c[0] + R[7] * c[1] + R[8] * c[2]] : c;
      vox.wc = wc;
      var ex = eye[0] - wc[0], ey = eye[1] - wc[1], ez = eye[2] - wc[2];
      vox.dist = ex * ex + ey * ey + ez * ez;
      vox.k = anim ? c[anim.axis] : 0;
      vox.vis.length = 0;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (j = 0; j < vox.faces.length; j++) {
        var face = vox.faces[j], n = face.n;
        var nx = n[0], ny = n[1], nz = n[2];
        if (rot) {
          nx = R[0] * n[0] + R[1] * n[1] + R[2] * n[2];
          ny = R[3] * n[0] + R[4] * n[1] + R[5] * n[2];
          nz = R[6] * n[0] + R[7] * n[1] + R[8] * n[2];
        }
        // back-face culling against the eye position
        var fx = wc[0] + 0.5 * nx, fy = wc[1] + 0.5 * ny, fz = wc[2] + 0.5 * nz;
        if (nx * (eye[0] - fx) + ny * (eye[1] - fy) + nz * (eye[2] - fz) <= 1e-9) continue;
        var cr = face.corners, scr = face.scr;
        for (k = 0; k < 4; k++) {
          var px = cr[3 * k], py = cr[3 * k + 1], pz = cr[3 * k + 2];
          if (rot) {
            var qx = R[0] * px + R[1] * py + R[2] * pz;
            var qy = R[3] * px + R[4] * py + R[5] * pz;
            pz = R[6] * px + R[7] * py + R[8] * pz;
            px = qx; py = qy;
          }
          px -= CENTRE[0]; py -= CENTRE[1]; pz -= CENTRE[2];
          var xc = V0 * px + V1 * py + V2 * pz;
          var yc = V3 * px + V4 * py + V5 * pz;
          var zc = V6 * px + V7 * py + V8 * pz;
          var pf = scale * D / (D - zc);
          var sx = hx + xc * pf, sy = hy - yc * pf;
          scr[2 * k] = sx; scr[2 * k + 1] = sy;
          if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
          if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
        }
        // Lambert-ish shading with a light fixed relative to the viewer
        var lx = V0 * nx + V1 * ny + V2 * nz, ly = V3 * nx + V4 * ny + V5 * nz, lz = V6 * nx + V7 * ny + V8 * nz;
        var dl = lx * LIGHT[0] + ly * LIGHT[1] + lz * LIGHT[2];
        face.shade = clamp(0.8 + 0.22 * dl, 0.6, 1.02);
        vox.vis.push(face);
      }
      if (vox.vis.length) { vox.x0 = x0; vox.y0 = y0; vox.x1 = x1; vox.y1 = y1; list.push(vox); }
    }

    var lw = Math.max(this._dpr * 0.8, scale * this.edgeWidth);
    var order;
    if (!anim) {
      list.sort(function (a, b) { return b.dist - a.dist; });
      order = list;
    } else {
      order = topoOrder(list, anim.axis, eye, R, lw);
    }

    // ---- paint
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    var cache = new Array(this.P.NP * 6);
    var hl = this._hl, pulse = 0;
    if (hl) pulse = 0.5 + 0.5 * Math.sin((t - this._hlStart) / 1000 * 2 * Math.PI * 1.2);
    var drawn = [];
    var crack = Math.max(1, this._dpr * 0.6);
    for (i = 0; i < order.length; i++) {
      var vv = order[i];
      for (j = 0; j < vv.vis.length; j++) {
        var fc = vv.vis[j], s = fc.scr;
        var rgb = this._faceRGB(fc, cache), sh = fc.shade;
        var r = rgb[0] * sh, g = rgb[1] * sh, b = rgb[2] * sh;
        var lit = hl && fc.st && hl[fc.pi * 6 + fc.home];
        if (lit) {
          // pulse the sticker itself: towards white, or towards grey for light colours
          var tgt = (r + g + b > 600) ? 150 : 255, m = 0.35 * pulse;
          r += (tgt - r) * m; g += (tgt - g) * m; b += (tgt - b) * m;
        }
        if (flash && vv.g) {
          r = r + (255 - r) * flash; g = g * (1 - flash) + 30 * flash; b = b * (1 - flash) + 30 * flash;
        }
        var col = 'rgba(' + clamp(Math.round(r), 0, 255) + ',' + clamp(Math.round(g), 0, 255) + ',' +
                  clamp(Math.round(b), 0, 255) + ',' + rgb[3] + ')';
        tracePath(ctx, s);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = crack;          // hides anti-aliasing cracks between merged faces
        ctx.strokeStyle = col;
        ctx.stroke();
        if (lit) this._drawHighlight(fc, pulse, lw * 0.45);
        if (traceSeams(ctx, s, fc.seams)) {
          ctx.lineWidth = lw;
          ctx.strokeStyle = this.edgeColor;
          ctx.stroke();
        }
        drawn.push(fc);
      }
    }
    this._drawn = drawn;
  };

  // Highlight: an inner two-tone band (white along the outline of the whole
  // sticker, thin black inside it) built from polygons so that faces of one
  // sticker join seamlessly.
  proto._drawHighlight = function (fc, pulse, extPx) {
    var ctx = this.ctx;
    ctx.beginPath();
    addBands(ctx, fc.scr, fc.seams, fc.concave, 0.2, extPx);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fill();
    ctx.beginPath();
    addBands(ctx, fc.scr, fc.seams, fc.concave, 0.13, extPx);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.6 + 0.4 * pulse).toFixed(3) + ')';
    ctx.fill();
  };
  // Sub-paths (all with the winding of the face) covering a band of width w
  // (fraction of the unit face) along the outline edges and concave corners.
  // extPx: how far (device px) bands reach into continuing neighbours, so
  // that no anti-aliasing crack shows between faces of one sticker.
  function addBands(ctx, s, seams, concave, w, extPx) {
    for (var k = 0; k < 4; k++) {
      var a = k, bb = (k + 1) & 3, pa = (k + 3) & 3, nb = (k + 2) & 3;
      var ax = s[2 * a], ay = s[2 * a + 1], bx = s[2 * bb], by = s[2 * bb + 1];
      var ex = bx - ax, ey = by - ay;
      var ext = extPx / (Math.sqrt(ex * ex + ey * ey) || 1);
      if (seams[k]) {
        var t0 = seams[pa] ? 0 : -ext, t1 = seams[bb] ? 1 : 1 + ext;
        var ix = w * (s[2 * pa] - ax), iy = w * (s[2 * pa + 1] - ay);
        var jx = w * (s[2 * nb] - bx), jy = w * (s[2 * nb + 1] - by);
        ctx.moveTo(ax + t0 * ex, ay + t0 * ey);
        ctx.lineTo(ax + t1 * ex, ay + t1 * ey);
        ctx.lineTo(ax + t1 * ex + jx, ay + t1 * ey + jy);
        ctx.lineTo(ax + t0 * ex + ix, ay + t0 * ey + iy);
        ctx.closePath();
      }
      if (concave[k]) {
        var ux = bx - ax, uy = by - ay, vx = s[2 * pa] - ax, vy = s[2 * pa + 1] - ay;
        // two rectangles, each reaching a little into one continuing neighbour
        quadUV(ctx, ax, ay, ux, uy, vx, vy, -ext, w, 0, w);
        quadUV(ctx, ax, ay, ux, uy, vx, vy, 0, w, -ext, w);
      }
    }
  }

  function quadUV(ctx, ax, ay, ux, uy, vx, vy, u0, u1, v0, v1) {
    ctx.moveTo(ax + u0 * ux + v0 * vx, ay + u0 * uy + v0 * vy);
    ctx.lineTo(ax + u1 * ux + v0 * vx, ay + u1 * uy + v0 * vy);
    ctx.lineTo(ax + u1 * ux + v1 * vx, ay + u1 * uy + v1 * vy);
    ctx.lineTo(ax + u0 * ux + v1 * vx, ay + u0 * uy + v1 * vy);
    ctx.closePath();
  }

  // Painter's order while two lattices (static + rotating) coexist.
  // `list` holds voxels with visible faces and screen bounding boxes.
  function topoOrder(list, axis, eye, R, margin) {
    var n = list.length, i, j;
    var ea = eye[axis];
    for (i = 0; i < n; i++) list[i].rank = Math.abs(list[i].k - ea);
    list.sort(function (a, b) { return (b.rank - a.rank) || (b.dist - a.dist); });
    var b = (axis + 1) % 3, c = (axis + 2) % 3;
    // 2D (b, c) directions of the rotated voxels' edges
    var U = [[1, 0], [0, 1], [R[b * 3 + b], R[c * 3 + b]], [R[b * 3 + c], R[c * 3 + c]]];
    var ctx2 = { ea: ea, b: b, c: c, U: U, eb: eye[b], ec: eye[c] };
    var indeg = new Int32Array(n), adj = new Array(n);
    for (i = 0; i < n; i++) adj[i] = [];
    for (i = 0; i < n; i++) {
      var A = list[i];
      for (j = i + 1; j < n; j++) {
        var B = list[j];
        if (A.x1 + margin < B.x0 || B.x1 + margin < A.x0 || A.y1 + margin < B.y0 || B.y1 + margin < A.y0) continue;
        var rel = relation(A, B, ctx2);
        if (rel < 0) { adj[i].push(j); indeg[j]++; }
        else if (rel > 0) { adj[j].push(i); indeg[i]++; }
      }
    }
    var out = new Array(n), done = new Uint8Array(n);
    for (var step = 0; step < n; step++) {
      var pick = -1;
      for (i = 0; i < n; i++) if (!done[i] && indeg[i] === 0) { pick = i; break; }
      if (pick < 0) for (i = 0; i < n; i++) if (!done[i]) { pick = i; break; }   // cycle: fall back
      done[pick] = 1;
      out[step] = list[pick];
      var ad = adj[pick];
      for (j = 0; j < ad.length; j++) indeg[ad[j]]--;
    }
    return out;
  }

  // -1: draw A first, 1: draw B first, 0: independent
  function relation(A, B, x) {
    if (A.k !== B.k) {
      var da = A.k - x.ea, db = B.k - x.ea;
      // slabs on opposite sides of the eye cannot occlude each other
      if (Math.abs(da) >= 0.5 && Math.abs(db) >= 0.5 && (da > 0) !== (db > 0)) return 0;
      return Math.abs(da) > Math.abs(db) ? -1 : 1;
    }
    if (A.g === B.g) return A.dist > B.dist ? -1 : (A.dist < B.dist ? 1 : 0);
    // same slab, one static and one rotated voxel: 2D separating axis
    var U = x.U, b = x.b, c = x.c;
    var dx = A.wc[b] - B.wc[b], dy = A.wc[c] - B.wc[c];
    var best = -Infinity, bu = null, bp = 0, bha = 0, bhb = 0;
    for (var k = 0; k < 4; k++) {
      var u = U[k];
      var proj = u[0] * dx + u[1] * dy;
      var ha = halfExt(A.g, u, U), hb = halfExt(B.g, u, U);
      var gap = Math.abs(proj) - ha - hb;
      if (gap > best) { best = gap; bu = u; bp = proj; bha = ha; bhb = hb; }
    }
    var pe = bu[0] * (x.eb - B.wc[b]) + bu[1] * (x.ec - B.wc[c]);
    if (bp >= 0) return pe > (bp - bha + bhb) / 2 ? 1 : -1;
    return pe < (bp + bha - bhb) / 2 ? 1 : -1;
  }
  function halfExt(g, u, U) {
    if (!g) return 0.5 * (Math.abs(u[0]) + Math.abs(u[1]));
    var p = U[2], q = U[3];
    return 0.5 * (Math.abs(u[0] * p[0] + u[1] * p[1]) + Math.abs(u[0] * q[0] + u[1] * q[1]));
  }

  // ----------------------------------------------------------- animation
  // Moves are queued: a call made while another move is animating starts when
  // the previous one has finished (from the state it produced).  The promise
  // resolves with the new state, with null when the move is physically blocked
  // (the layer shakes and flashes red, the state is kept), or with undefined
  // when the animation was cancelled by setState().  Invalid tokens reject.
  proto.animateMove = function (token, opts) {
    var self = this, gen = this._gen;
    opts = opts || {};
    this._pending++;
    var p = this._queue.then(function () {
      if (gen !== self._gen) return undefined;
      return self._runMove(token, opts);
    });
    var done = function () { self._pending--; };
    p.then(done, done);
    this._queue = p.then(null, function () { /* keep the queue alive */ });
    return p;
  };

  proto.isAnimating = function () { return !!this.anim || this._pending > 0; };

  proto._runMove = function (token, opts) {
    var self = this, P = this.P;
    var mv = typeof token === 'string' ? P.parseToken(token) : token;
    var ph = P.physical(mv);
    var legal = P.legalTurn(this.state, ph.axis, ph.layers, ph.q);
    var dur = num(opts.duration, 300);
    if (legal === 4) return Promise.resolve(this.state.slice());
    var newState = legal ? P.turn(this.state, ph.axis, ph.layers, ph.q) : null;
    if (legal && dur <= 0) {
      this.state = newState;
      this._build();
      this.render();
      return Promise.resolve(newState.slice());
    }
    return new Promise(function (resolve) {
      self.anim = {
        axis: ph.axis, q: legal || (ph.q > 0 ? 1 : -1), blocked: !legal,
        moving: P.movingPieces(self.state, ph.axis, ph.layers),
        start: nowMs(), duration: legal ? Math.max(1, dur) : Math.max(380, dur * 1.3),
        newState: newState, resolve: resolve, angle: 0, flash: 0
      };
      self._build();
      self._requestFrame();
    });
  };

  proto._stepAnim = function (t) {
    var a = this.anim;
    var u = (t - a.start) / a.duration;
    if (u >= 1) {
      this.anim = null;
      if (!a.blocked) this.state = a.newState;
      this._build();
      a.resolve(a.blocked ? null : this.state.slice());
      return;
    }
    if (u < 0) u = 0;
    if (a.blocked) {
      a.angle = (a.q > 0 ? 1 : -1) * 6 * DEG * Math.sin(u * Math.PI * 3) * (1 - u);
      a.flash = 0.6 * Math.min(1, u * 8) * (1 - u);
    } else {
      a.angle = a.q * 90 * DEG * (0.5 - 0.5 * Math.cos(Math.PI * u));
    }
  };

  // ----------------------------------------------------------- state & view
  proto.setState = function (state) {
    this._gen++;
    if (this.anim) {
      var a = this.anim;
      this.anim = null;
      a.resolve(undefined);
    }
    this.state = state ? state.slice() : this.P.solvedState();
    this._build();
    this.render();
  };
  proto.getState = function () { return this.state.slice(); };

  proto.setStickerColorFn = function (fn) {
    this._colorFn = typeof fn === 'function' ? fn : null;
    this.render();
  };

  proto.setColors = function (colors) {
    if (colors) this.colors = colors.slice();
    this.render();
  };

  proto.setHighlights = function (list) {
    if (!list || !list.length) { this._hl = null; this.render(); return; }
    var hl = {};
    list.forEach(function (h) { hl[h.piece * 6 + h.face] = true; });
    if (!this._hl) this._hlStart = nowMs();
    this._hl = hl;
    this.render();
  };

  proto.setView = function (yaw, pitch) {
    if (typeof yaw === 'number' && isFinite(yaw)) this.yaw = yaw;
    if (typeof pitch === 'number' && isFinite(pitch)) this.pitch = clamp(pitch, -88, 88);
    this.render();
  };
  proto.getView = function () { return { yaw: this.yaw, pitch: this.pitch }; };
  proto.resetView = function () { this.setView(this.defaultYaw, this.defaultPitch); };
  proto.setZoom = function (z) { if (z > 0) { this.zoom = z; this.render(); } };

  proto.resize = function () {
    var canvas = this.canvas;
    if (!canvas.getBoundingClientRect) return;
    var rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    var w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    this._dpr = dpr;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this._draw(nowMs());            // immediately, so the canvas is never left blank
  };

  // ----------------------------------------------------------- picking
  proto.pick = function (clientX, clientY) {
    var canvas = this.canvas;
    if (!canvas.getBoundingClientRect) return null;
    var rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    if (this._dirty) this._draw(nowMs());
    var x = (clientX - rect.left) * canvas.width / rect.width;
    var y = (clientY - rect.top) * canvas.height / rect.height;
    var d = this._drawn;
    for (var i = d.length - 1; i >= 0; i--) {
      if (insideQuad(d[i].scr, x, y)) return d[i].st ? { piece: d[i].pi, face: d[i].home } : null;
    }
    return null;
  };
  function insideQuad(s, x, y) {
    var pos = false, neg = false;
    for (var k = 0; k < 4; k++) {
      var k2 = (k + 1) & 3;
      var cr = (s[2 * k2] - s[2 * k]) * (y - s[2 * k + 1]) - (s[2 * k2 + 1] - s[2 * k + 1]) * (x - s[2 * k]);
      if (cr > 0) pos = true; else if (cr < 0) neg = true;
      if (pos && neg) return false;
    }
    return true;
  }

  // ----------------------------------------------------------- pointer input
  proto._bindPointer = function () {
    var self = this, canvas = this.canvas;
    if (!canvas.addEventListener) return;
    if (canvas.style) canvas.style.touchAction = 'none';
    var h = this._handlers = {
      down: function (e) {
        // a second finger is ignored; a new primary pointer restarts the gesture
        if (self._ptr !== null && !e.isPrimary) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        self._ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: self.yaw, pitch: self.pitch, moved: false };
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (e.cancelable) e.preventDefault();
      },
      move: function (e) {
        var p = self._ptr;
        if (!p || e.pointerId !== p.id) return;
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (!p.moved && dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) p.moved = true;
        if (p.moved) {
          self.yaw = p.yaw + dx * self.dragSpeed;
          self.pitch = clamp(p.pitch + dy * self.dragSpeed, -88, 88);
          self.render();
        }
      },
      up: function (e) {
        var p = self._ptr;
        if (!p || e.pointerId !== p.id) return;
        self._ptr = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (!p.moved && typeof self.onPick === 'function') self.onPick(self.pick(e.clientX, e.clientY));
      },
      cancel: function (e) {
        var p = self._ptr;
        if (p && e.pointerId === p.id) self._ptr = null;
      }
    };
    canvas.addEventListener('pointerdown', h.down);
    canvas.addEventListener('pointermove', h.move);
    canvas.addEventListener('pointerup', h.up);
    canvas.addEventListener('pointercancel', h.cancel);
  };

  proto.destroy = function () {
    var h = this._handlers, canvas = this.canvas;
    if (h && canvas.removeEventListener) {
      canvas.removeEventListener('pointerdown', h.down);
      canvas.removeEventListener('pointermove', h.move);
      canvas.removeEventListener('pointerup', h.up);
      canvas.removeEventListener('pointercancel', h.cancel);
    }
    this._gen++;
    if (this.anim) { var a = this.anim; this.anim = null; a.resolve(undefined); }
    this._hl = null;
    if (this._raf) { rafCancel(this._raf); this._raf = 0; }
    this.onPick = null;
  };

  PuppetRenderer.DEFAULT_COLORS = DEFAULT_COLORS.slice();

  if (typeof module !== 'undefined' && module.exports) module.exports = PuppetRenderer;
  else root.PuppetRenderer = PuppetRenderer;
})(this);
