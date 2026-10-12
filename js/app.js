/* Puppet Cube V2 solver — user interface. */
(function () {
  'use strict';
  var P = window.Puppet, S = window.PuppetSolver;

  // ------------------------------------------------------------ colours
  var COLOURS = [
    { id: 'W', name: 'Белый', css: '#f4f4f4' },
    { id: 'Y', name: 'Жёлтый', css: '#ffd400' },
    { id: 'R', name: 'Красный', css: '#d3203b' },
    { id: 'O', name: 'Оранжевый', css: '#ff6c12' },
    { id: 'B', name: 'Синий', css: '#1f5ad6' },
    { id: 'G', name: 'Зелёный', css: '#10a35a' }
  ];
  var CSS = {};
  COLOURS.forEach(function (c) { CSS[c.id] = c.css; });
  var UNKNOWN_CSS = '#5d6474';
  // MoYu Puppet V2 colours in our holding: faces R, L, U, D, F, B
  var DEFAULT_FACE = ['B', 'G', 'Y', 'W', 'O', 'R'];
  var DEFAULT_CSS = DEFAULT_FACE.map(function (c) { return CSS[c]; });

  var ANCHOR_PIECE = {};
  P.PIECES.forEach(function (pc, i) { ANCHOR_PIECE[pc.anchor.join(',')] = i; });

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) e.textContent = text;
    return e;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ } }
  function load(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function setMessage(node, text, kind) {
    node.textContent = text || '';
    node.className = 'message' + (kind ? ' ' + kind : '');
  }

  // --------------------------------------------------------- moves text
  var FROM = { 0: 'справа', 1: 'слева', 2: 'сверху', 3: 'снизу', 4: 'спереди', 5: 'сзади' };
  var OUTER_NAME = {
    0: 'правый тонкий слой (ряд маленьких квадратиков)',
    2: 'верхний тонкий слой (ряд маленьких квадратиков)',
    4: 'передний тонкий слой (ряд маленьких квадратиков)',
    1: 'левая половина кубика',
    3: 'нижняя половина кубика',
    5: 'задняя половина кубика'
  };
  var WIDE_NAME = {
    0: 'правая половина (тонкий слой вместе со средним)',
    2: 'верхняя половина (тонкий слой вместе со средним)',
    4: 'передняя половина (тонкий слой вместе со средним)',
    1: 'левая половина вместе со средним слоем',
    3: 'нижняя половина вместе со средним слоем',
    5: 'задняя половина вместе со средним слоем'
  };
  var MID_NAME = { M: 'средний слой между левой и правой гранями', E: 'средний слой между верхом и низом', S: 'средний слой между передом и задом' };
  function describeMove(tok) {
    var mv = P.parseToken(tok);
    var dir = mv.turns === 2 ? 'на 180°' : (mv.turns === 1 ? 'по часовой стрелке' : 'против часовой стрелки');
    var name;
    if (mv.kind === 'mid') name = MID_NAME[tok[0]];
    else if (mv.kind === 'wide') name = WIDE_NAME[mv.face];
    else name = OUTER_NAME[mv.face];
    var look = mv.turns === 2 ? '' : ', если смотреть ' + FROM[mv.face];
    return name.charAt(0).toUpperCase() + name.slice(1) + ' — ' + dir + look + '.';
  }

  // ------------------------------------------------------- renderers
  var renderers = {};
  function makeRenderer(canvasId, opts) {
    if (!window.PuppetRenderer) return null;
    var r = new window.PuppetRenderer($(canvasId), Object.assign({ colors: DEFAULT_CSS }, opts || {}));
    renderers[canvasId] = r;
    return r;
  }

  // ------------------------------------------------------------- tabs
  var currentTab = 'input';
  function showTab(name) {
    currentTab = name;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    // canvases may have had zero size while hidden
    requestAnimationFrame(function () {
      Object.keys(renderers).forEach(function (k) { if (renderers[k]) renderers[k].resize(); });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });
  window.addEventListener('resize', function () {
    Object.keys(renderers).forEach(function (k) { if (renderers[k]) renderers[k].resize(); });
  });

  // =================================================================
  //                               INPUT
  // =================================================================
  var STEP_TITLES = ['Как держать', 'Видимые цвета', 'Слой M', 'Слой E', 'Слой S', 'Проверка'];
  var saved = load('puppet.input.v1') || {};
  var inputCols = Array.isArray(saved.cols) && saved.cols.length === 54 ? saved.cols : new Array(54).fill(null);
  var inputStep = typeof saved.step === 'number' ? Math.min(Math.max(saved.step, 0), 5) : 0;
  var currentColour = COLOURS[0].id;
  var inputRenderer = makeRenderer('input-canvas');
  var inputMessage = $('input-message');

  function saveInput() { store('puppet.input.v1', { cols: inputCols, step: inputStep }); }

  // view of the current step: which original facelet is shown at each
  // position, which positions are editable
  function stepView() {
    var ident = [];
    for (var i = 0; i < 54; i++) ident.push(i);
    if (inputStep >= 2 && inputStep <= 4) {
      var rv = S.REVEALS[inputStep - 2];
      var editable = {};
      rv.reads.forEach(function (x) { editable[x.shown] = true; });
      return { origOf: rv.origOf, editable: editable, reveal: rv };
    }
    var ed = {};
    if (inputStep === 1) S.VISIBLE.forEach(function (i) { ed[i] = true; });
    return { origOf: ident, editable: ed, reveal: null };
  }

  // -------------------------------------------------------------- net
  var FACE_POS = { 2: [4, 0], 1: [0, 4], 4: [4, 4], 0: [8, 4], 5: [12, 4], 3: [4, 8] };
  var FACE_LABEL = { 0: 'R', 1: 'L', 2: 'U', 3: 'D', 4: 'F', 5: 'B' };
  function drawNet() {
    var net = $('net');
    while (net.firstChild) net.removeChild(net.firstChild);
    var view = stepView();
    var cellsG = svg('g'), linesG = svg('g'), hiG = svg('g'), textG = svg('g');
    net.appendChild(cellsG); net.appendChild(linesG); net.appendChild(hiG); net.appendChild(textG);
    for (var f = 0; f < 6; f++) {
      var ox = FACE_POS[f][0], oy = FACE_POS[f][1];
      for (var r = 0; r < 4; r++) {
        for (var c = 0; c < 4; c++) {
          var idx = S.SURFACE[f][r][c].facelet;
          var orig = view.origOf[idx];
          var col = inputCols[orig];
          var editable = !!view.editable[idx];
          var rect = svg('rect', {
            x: ox + c, y: oy + r, width: 1.001, height: 1.001,
            fill: col ? CSS[col] : UNKNOWN_CSS,
            'class': 'cell' + (editable ? '' : ' locked'),
            'data-idx': idx
          });
          if (!editable && inputStep >= 2 && inputStep <= 4) rect.setAttribute('opacity', '0.45');
          cellsG.appendChild(rect);
          // borders between different facelets
          var nb = [[r - 1, c, 'h', 0], [r + 1, c, 'h', 1], [r, c - 1, 'v', 0], [r, c + 1, 'v', 1]];
          nb.forEach(function (n) {
            var rr = n[0], cc = n[1];
            var other = (rr >= 0 && rr < 4 && cc >= 0 && cc < 4) ? S.SURFACE[f][rr][cc].facelet : -1;
            if (other === idx) return;
            var x1, y1, x2, y2;
            if (n[2] === 'h') { y1 = y2 = oy + r + n[3]; x1 = ox + c; x2 = ox + c + 1; }
            else { x1 = x2 = ox + c + n[3]; y1 = oy + r; y2 = oy + r + 1; }
            var g = editable && view.reveal ? hiG : linesG;
            g.appendChild(svg('line', {
              x1: x1, y1: y1, x2: x2, y2: y2,
              stroke: editable && view.reveal ? '#4f8cff' : '#0b0d12',
              'stroke-width': editable && view.reveal ? 0.12 : 0.06, 'stroke-linecap': 'round'
            }));
          });
          if (editable && !col) {
            var t = svg('text', { x: ox + c + 0.5, y: oy + r + 0.72, 'text-anchor': 'middle', 'class': 'qmark' });
            t.textContent = '?';
            textG.appendChild(t);
          }
        }
      }
      var lab = svg('text', { x: ox + 0.08, y: oy + 0.42, 'class': 'label' });
      lab.textContent = FACE_LABEL[f];
      lab.setAttribute('style', 'fill:#000;opacity:.55;font-weight:700');
      textG.appendChild(lab);
    }
  }
  $('net').addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var idx = t.getAttribute('data-idx');
    if (idx === null) return;
    paintShown(Number(idx));
  });
  function paintShown(idx) {
    var view = stepView();
    if (!view.editable[idx]) {
      if (inputStep === 0 || inputStep === 5) setMessage(inputMessage, 'Перейдите к шагу ввода цветов.');
      else setMessage(inputMessage, 'Эту наклейку на этом шаге менять не нужно.');
      return;
    }
    var orig = view.origOf[idx];
    inputCols[orig] = inputCols[orig] === currentColour ? null : currentColour;
    setMessage(inputMessage, '');
    saveInput();
    refreshInput(false);
  }

  // ---------------------------------------------------------- palette
  function drawPalette() {
    var pal = $('palette');
    pal.innerHTML = '';
    COLOURS.forEach(function (c) {
      var b = el('button', { 'class': 'swatch' + (c.id === currentColour ? ' active' : ''), title: c.name, 'aria-label': c.name });
      b.style.background = c.css;
      b.addEventListener('click', function () { currentColour = c.id; drawPalette(); });
      pal.appendChild(b);
    });
  }

  // ------------------------------------------------------ 3D preview
  function inputColourFn(piece, face) {
    var col = inputCols[P.faceletIndex(P.PIECES[piece].anchor, face)];
    return col ? CSS[col] : UNKNOWN_CSS;
  }
  function refreshPreview(animate) {
    if (!inputRenderer) return;
    inputRenderer.setStickerColorFn(inputColourFn);
    var view = stepView();
    var hl = [];
    if (view.reveal) {
      view.reveal.reads.forEach(function (x) {
        var fp = P.faceletPos(x.original);
        hl.push({ piece: ANCHOR_PIECE[fp.pos.join(',')], face: fp.face });
      });
    }
    inputRenderer.setHighlights(hl.length ? hl : null);
    var solved = P.solvedState();
    if (view.reveal) {
      if (animate) {
        inputRenderer.setState(solved);
        setTimeout(function () { inputRenderer.animateMove(view.reveal.move, { duration: 900 }); }, 350);
      } else {
        inputRenderer.setState(P.applyMove(solved, view.reveal.move));
      }
    } else {
      inputRenderer.setState(solved);
    }
  }
  if (inputRenderer) {
    inputRenderer.onPick = function (hit) {
      if (!hit) return;
      var orig = P.faceletIndex(P.PIECES[hit.piece].anchor, hit.face);
      var view = stepView();
      var shown = view.origOf.indexOf(orig);
      if (shown < 0) return;
      paintShown(shown);
    };
  }

  // ------------------------------------------------------- step texts
  var REVEAL_TEXT = {
    'M2': ['M', 'средний вертикальный слой между левой и правой гранями (тот, что проходит через центр крестика на передней грани сверху вниз)'],
    'E2': ['E', 'средний горизонтальный слой между верхом и низом (проходит через центр крестиков на передней и правой гранях)'],
    'S2': ['S', 'средний слой между передом и задом (проходит через центр крестиков на верхней и правой гранях)']
  };
  function stepBody() {
    var b = $('input-step-body');
    var html = '';
    if (inputStep === 0) {
      html = '<p><b>Кубик должен быть в форме куба.</b> Если он «разъехался», сначала загляните во вкладку «Форма куба».</p>' +
        '<p>Держите кубик так, как на модели справа: <b>крошечный уголок</b> (самый маленький кубик) — сверху-спереди-справа. ' +
        'Тогда на верхней (U), передней (F) и правой (R) гранях видны «крестики» из маленьких квадратиков, ' +
        'а левая (L), нижняя (D) и задняя (B) грани выглядят как гладкий кубик 2×2. Сзади-снизу-слева находится <b>главный блок</b>.</p>' +
        '<p>Дальше вы отметите цвета на развёртке, а затем трижды повернёте средний слой на 180°, чтобы увидеть спрятанные детали. ' +
        'Модель справа можно вращать пальцем.</p>';
    } else if (inputStep === 1) {
      html = '<p>Выберите цвет внизу и нажимайте на области развёртки. Каждая область — это одна деталь ' +
        '(большой квадрат, L-образная деталь или маленький квадратик). Нажатие тем же цветом стирает.</p>' +
        '<p class="hint">Развёртка: U — верх, F — перед, R — право, B — зад, L — лево, D — низ. Грань U нарисована так, как её видно, если наклонить кубик верхом к себе; D — если наклонить верхом от себя. L, R и B — как если повернуть кубик вокруг вертикальной оси.</p>';
    } else if (inputStep >= 2 && inputStep <= 4) {
      var rv = S.REVEALS[inputStep - 2];
      var t = REVEAL_TEXT[rv.move];
      html = '<p><b>Поверните ' + t[0] + ' на 180° (' + rv.move + ').</b> Это ' + t[1] + '. Форма куба при этом не меняется — модель покажет, как.</p>' +
        '<p>Теперь видны детали, которые были спрятаны. Отметьте цвета <b>только в подсвеченных областях</b> (со знаком «?» или синей рамкой). ' +
        'Остальные области уже известны — сверьтесь с ними: если они не совпадают с вашим кубиком, значит слой повёрнут не тот.</p>' +
        '<p><b>После ввода поверните этот же слой ещё раз на 180°</b>, чтобы вернуть кубик в исходное положение.</p>' +
        '<p><button class="btn small" id="btn-replay">Показать поворот ещё раз</button></p>';
    } else {
      html = '<p>Проверка введённых цветов. Если всё в порядке, нажмите «Решить».</p><div id="check-result"></div>';
    }
    b.innerHTML = html;
    var rp = $('btn-replay');
    if (rp) rp.addEventListener('click', function () { refreshPreview(true); });
  }

  function drawSteps() {
    var ol = $('input-steps');
    ol.innerHTML = '';
    STEP_TITLES.forEach(function (t, i) {
      var li = el('li', { 'class': i === inputStep ? 'active' : (i < inputStep ? 'done' : '') }, t);
      li.style.cursor = 'pointer';
      li.addEventListener('click', function () { inputStep = i; saveInput(); refreshInput(true); });
      ol.appendChild(li);
    });
  }

  function missingInStep() {
    var view = stepView();
    var miss = 0;
    Object.keys(view.editable).forEach(function (idx) { if (!inputCols[view.origOf[idx]]) miss++; });
    return miss;
  }

  function runCheck() {
    var box = $('check-result');
    var res = S.stateFromFacelets(inputCols);
    if (res.error) {
      box.innerHTML = '';
      box.appendChild(el('p', { 'class': 'message error' }, res.error));
      $('btn-next-step').textContent = 'Решить';
      $('btn-next-step').disabled = true;
      return null;
    }
    var sol = S.solve(res.state);
    if (sol.error) {
      box.innerHTML = '';
      box.appendChild(el('p', { 'class': 'message error' }, sol.error));
      $('btn-next-step').disabled = true;
      return null;
    }
    box.innerHTML = '';
    var counts = sol.phases.map(function (ph) { return ph.groups.reduce(function (a, g) { return a + g.moves.length; }, 0); });
    box.appendChild(el('p', { 'class': 'message ok' },
      'Позиция корректна. Решение: ' + sol.moves.length + ' ходов (блоки — ' + counts[0] + ', центры — ' + counts[1] + ', рёбра — ' + counts[2] + ').'));
    $('btn-next-step').textContent = 'Решить';
    $('btn-next-step').disabled = false;
    return { parsed: res, solution: sol };
  }

  function refreshInput(animate) {
    drawSteps();
    stepBody();
    $('input-work').style.display = '';
    $('net').parentNode.style.display = inputStep === 0 ? 'none' : '';
    $('palette').style.display = (inputStep >= 1 && inputStep <= 4) ? '' : 'none';
    drawNet();
    refreshPreview(animate);
    $('btn-prev-step').disabled = inputStep === 0;
    $('btn-next-step').disabled = false;
    $('btn-next-step').textContent = inputStep === 5 ? 'Решить' : 'Далее';
    if (inputStep === 5) runCheck();
    if (inputRenderer) requestAnimationFrame(function () { inputRenderer.resize(); });
  }

  $('btn-prev-step').addEventListener('click', function () {
    if (inputStep > 0) { inputStep--; saveInput(); setMessage(inputMessage, ''); refreshInput(true); }
  });
  $('btn-next-step').addEventListener('click', function () {
    if (inputStep >= 1 && inputStep <= 4) {
      var miss = missingInStep();
      if (miss) { setMessage(inputMessage, 'Осталось заполнить областей: ' + miss + '.', 'error'); return; }
    }
    if (inputStep < 5) { inputStep++; saveInput(); setMessage(inputMessage, ''); refreshInput(true); return; }
    var r = runCheck();
    if (r) startSolution(r.parsed.state, r.parsed.faceColours.map(function (c) { return CSS[c]; }), r.solution);
  });
  $('btn-fill-solved').addEventListener('click', function () {
    var st = P.solvedState();
    inputCols = S.faceletColoursFromState(st, DEFAULT_FACE);
    saveInput(); setMessage(inputMessage, 'Заполнено цветами собранного кубика. Измените отличающиеся детали.'); refreshInput(false);
  });
  $('btn-clear').addEventListener('click', function () {
    inputCols = new Array(54).fill(null);
    saveInput(); setMessage(inputMessage, ''); refreshInput(false);
  });
  $('btn-example').addEventListener('click', function () {
    var st = S.randomState(Math.random);
    inputCols = S.faceletColoursFromState(st, DEFAULT_FACE);
    inputStep = 1;
    saveInput();
    setMessage(inputMessage, 'Загружена случайная позиция (все цвета уже заполнены, включая спрятанные). Можно пролистать шаги или сразу перейти к проверке.');
    refreshInput(false);
  });

  // =================================================================
  //                              SOLUTION
  // =================================================================
  var solRenderer = makeRenderer('solution-canvas');
  var sol = null; // {states, moves, meta, phases, colours}
  var solIndex = 0, playing = false, busy = false;

  function startSolution(state, coloursCss, solution) {
    var states = [state.slice()];
    var st = state.slice();
    solution.moves.forEach(function (m) { st = P.applyMove(st, m, false); states.push(st); });
    sol = { states: states, moves: solution.moves, meta: solution.meta, phases: solution.phases, colours: coloursCss };
    solIndex = 0;
    stopPlay();
    $('solution-empty').hidden = true;
    $('solution-body').hidden = false;
    if (solRenderer) {
      solRenderer.setStickerColorFn(function (piece, face) { return coloursCss[face]; });
      solRenderer.setHighlights(null);
      solRenderer.setState(states[0]);
    }
    drawPhases();
    updatePlayer();
    showTab('solution');
  }

  function drawPhases() {
    var box = $('solution-phases');
    box.innerHTML = '';
    var k = 0;
    sol.phases.forEach(function (ph, pi) {
      var d = el('div', { 'class': 'card phase' });
      var count = ph.groups.reduce(function (a, g) { return a + g.moves.length; }, 0);
      d.appendChild(el('h3', null, (pi + 1) + '. ' + ph.title + (count ? ' — ' + count + ' ход.' : '')));
      d.appendChild(el('div', { 'class': 'note' }, ph.note));
      ph.groups.forEach(function (g) {
        var gd = el('div', { 'class': 'group' });
        if (ph.groups.length > 1) gd.appendChild(el('div', { 'class': 'group-label' }, g.label));
        var mv = el('div', { 'class': 'moves' });
        g.moves.forEach(function (m) {
          var idx = k++;
          var b = el('button', { 'class': 'mv', 'data-k': idx }, m);
          b.addEventListener('click', function () { if (!busy) { stopPlay(); solIndex = idx; renderSolState(); } });
          mv.appendChild(b);
        });
        gd.appendChild(mv);
        d.appendChild(gd);
      });
      box.appendChild(d);
    });
  }

  function renderSolState() {
    if (solRenderer) solRenderer.setState(sol.states[solIndex]);
    updatePlayer();
  }

  function updatePlayer() {
    if (!sol) return;
    var n = sol.moves.length;
    var next = solIndex < n ? sol.moves[solIndex] : null;
    $('move-big').textContent = next || (n ? 'Готово!' : 'Уже собран');
    $('move-desc').textContent = next ? describeMove(next) : (n ? 'Кубик собран.' : '');
    var phaseText = '';
    if (next) {
      var m = sol.meta[solIndex];
      var ph = sol.phases[m.phase];
      phaseText = ph.title + (ph.groups.length > 1 ? ' · ' + ph.groups[m.group].label : '') + ' · ';
    }
    $('move-progress').textContent = phaseText + 'ход ' + Math.min(solIndex + 1, n) + ' из ' + n;
    Array.prototype.forEach.call(document.querySelectorAll('#solution-phases .mv'), function (b) {
      var k = Number(b.getAttribute('data-k'));
      b.classList.toggle('done', k < solIndex);
      b.classList.toggle('current', k === solIndex);
    });
    var cur = document.querySelector('#solution-phases .mv.current');
    if (cur && playing && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    $('btn-back').disabled = solIndex === 0;
    $('btn-first').disabled = solIndex === 0;
    $('btn-fwd').disabled = solIndex >= n;
    $('btn-last').disabled = solIndex >= n;
  }

  function speed() { return Number($('speed').value); }

  function stepForward() {
    if (!sol || busy || solIndex >= sol.moves.length) return Promise.resolve(false);
    busy = true;
    var tok = sol.moves[solIndex];
    var done = function () { busy = false; solIndex++; renderSolState(); return true; };
    if (!solRenderer) return Promise.resolve(done());
    solRenderer.setState(sol.states[solIndex]);
    return solRenderer.animateMove(tok, { duration: speed() }).then(done, done);
  }
  function stepBack() {
    if (!sol || busy || solIndex === 0) return;
    busy = true;
    var tok = P.invertToken(sol.moves[solIndex - 1]);
    var done = function () { busy = false; solIndex--; renderSolState(); };
    if (!solRenderer) return done();
    solRenderer.setState(sol.states[solIndex]);
    solRenderer.animateMove(tok, { duration: speed() }).then(done, done);
  }
  function stopPlay() { playing = false; $('btn-play').textContent = '▶ Авто'; }
  function playLoop() {
    if (!playing) return;
    if (!sol || solIndex >= sol.moves.length) { stopPlay(); return; }
    stepForward().then(function () { setTimeout(playLoop, Math.max(80, speed() * 0.4)); });
  }
  $('btn-fwd').addEventListener('click', function () { stopPlay(); stepForward(); });
  $('btn-back').addEventListener('click', function () { stopPlay(); stepBack(); });
  $('btn-first').addEventListener('click', function () { if (busy) return; stopPlay(); solIndex = 0; renderSolState(); });
  $('btn-last').addEventListener('click', function () { if (busy) return; stopPlay(); solIndex = sol.moves.length; renderSolState(); });
  $('btn-play').addEventListener('click', function () {
    if (playing) { stopPlay(); return; }
    playing = true; $('btn-play').textContent = '⏸ Пауза'; playLoop();
  });

  // =================================================================
  //                             SIMULATOR
  // =================================================================
  var simRenderer = makeRenderer('sim-canvas');
  var simState = P.solvedState();
  var simHistory = [];
  var simBusy = false;
  var simStatus = $('sim-status');

  function simShowStatus(extra, kind) {
    var txt = P.isSolved(simState) ? 'Собран.' : (P.isCube(simState) ? 'Форма куба (можно решать).' : 'Форма изменена.');
    setMessage(simStatus, (extra ? extra + ' ' : '') + txt, kind);
  }
  function simApply(tok) {
    if (simBusy) return Promise.resolve(false);
    var next = P.applyMove(simState, tok);
    if (!next) {
      simShowStatus('Ход ' + tok + ' невозможен — детали упираются.', 'error');
      if (simRenderer) { simBusy = true; return simRenderer.animateMove(tok, { duration: 250 }).then(function () { simBusy = false; return false; }, function () { simBusy = false; return false; }); }
      return Promise.resolve(false);
    }
    simHistory.push(simState);
    var finish = function () { simState = next; simBusy = false; if (simRenderer) simRenderer.setState(simState); simShowStatus(); return true; };
    if (!simRenderer) return Promise.resolve(finish());
    simBusy = true;
    return simRenderer.animateMove(tok, { duration: 260 }).then(finish, finish);
  }
  (function buildMoveGrid() {
    var grid = $('sim-moves');
    var rows = [['R', 'Rw'], ['U', 'Uw'], ['F', 'Fw'], ['L', 'M'], ['D', 'E'], ['B', 'S']];
    rows.forEach(function (pair) {
      pair.forEach(function (base) {
        ['', "'", '2'].forEach(function (suf) {
          var tok = base + suf;
          var b = el('button', { 'class': 'btn', title: describeMove(tok) }, tok);
          b.addEventListener('click', function () { simApply(tok); });
          grid.appendChild(b);
        });
      });
    });
  })();
  function runAlg(text) {
    var toks;
    try { toks = P.parse(text).map(function (mv) { return P.moveName(mv); }); }
    catch (e) { setMessage(simStatus, e.message, 'error'); return; }
    var i = 0;
    (function nextMove() {
      if (i >= toks.length) return;
      var tok = toks[i++];
      simApply(tok).then(function (ok) { if (ok) nextMove(); });
    })();
  }
  $('btn-sim-run').addEventListener('click', function () { runAlg($('sim-alg').value); });
  $('sim-alg').addEventListener('keydown', function (e) { if (e.key === 'Enter') runAlg($('sim-alg').value); });
  $('btn-sim-undo').addEventListener('click', function () {
    if (simBusy || !simHistory.length) return;
    simState = simHistory.pop();
    if (simRenderer) simRenderer.setState(simState);
    simShowStatus();
  });
  $('btn-sim-reset').addEventListener('click', function () {
    if (simBusy) return;
    simState = P.solvedState(); simHistory = [];
    if (simRenderer) simRenderer.setState(simState);
    simShowStatus();
  });
  $('btn-sim-scramble').addEventListener('click', function () {
    if (simBusy) return;
    simHistory.push(simState);
    simState = S.randomState(Math.random);
    if (simRenderer) simRenderer.setState(simState);
    simShowStatus('Случайная позиция в форме куба.');
  });
  $('btn-sim-solve').addEventListener('click', function () {
    if (!P.isCube(simState)) { simShowStatus('Сначала верните форму куба.', 'error'); return; }
    var res = S.solve(simState);
    if (res.error) { simShowStatus(res.error, 'error'); return; }
    startSolution(simState, DEFAULT_CSS, res);
  });

  // =================================================================
  //                               SHAPES
  // =================================================================
  var shapeRenderer = makeRenderer('shape-canvas');
  // only the geometry matters here: plain grey pieces, main block in gold
  if (shapeRenderer) shapeRenderer.setStickerColorFn(function (piece) { return piece === P.PIDX.MAIN ? '#f2c230' : '#d7dbe4'; });
  var shapeSel = 0, shapeBusy = false;
  function shapeState(i) {
    return P.applyAlg(P.solvedState(), P.invertAlg(P.DATA.shapes[i].alg), false).state;
  }
  function selectShape(i) {
    shapeSel = i;
    Array.prototype.forEach.call(document.querySelectorAll('#shape-list .btn'), function (b, k) {
      b.classList.toggle('primary', k === i);
    });
    $('shape-alg').textContent = P.DATA.shapes[i].alg;
    if (shapeRenderer) shapeRenderer.setState(shapeState(i));
  }
  (function buildShapes() {
    var list = $('shape-list');
    P.DATA.shapes.forEach(function (sh, i) {
      var b = el('button', { 'class': 'btn small' }, sh.name);
      b.addEventListener('click', function () { if (!shapeBusy) selectShape(i); });
      list.appendChild(b);
    });
  })();
  $('btn-shape-show').addEventListener('click', function () { if (!shapeBusy) selectShape(shapeSel); });
  $('btn-shape-play').addEventListener('click', function () {
    if (shapeBusy || !shapeRenderer) return;
    var st = shapeState(shapeSel);
    shapeRenderer.setState(st);
    var toks = P.DATA.shapes[shapeSel].alg.split(' ');
    var i = 0;
    shapeBusy = true;
    (function next() {
      if (i >= toks.length) { shapeBusy = false; return; }
      shapeRenderer.animateMove(toks[i++], { duration: 550 }).then(function () { setTimeout(next, 150); }, function () { shapeBusy = false; });
    })();
  });

  // =================================================================
  //                                HELP
  // =================================================================
  (function buildHelp() {
    var rows = [
      ['R', 'Правый тонкий слой (ряд маленьких квадратиков) по часовой, если смотреть справа.'],
      ['U', 'Верхний тонкий слой.'],
      ['F', 'Передний тонкий слой.'],
      ['L', 'Левая половина кубика (толстая) по часовой, если смотреть слева.'],
      ['D', 'Нижняя половина кубика.'],
      ['B', 'Задняя половина кубика.'],
      ['M', 'Средний тонкий слой между L и R, в ту же сторону, что L.'],
      ['E', 'Средний слой между U и D, как D.'],
      ['S', 'Средний слой между F и B, как F.'],
      ['Rw', 'Правая половина: R вместе со средним слоем — как поворот R у кубика 2×2. Аналогично Uw, Fw.'],
      ["X'", 'Штрих — против часовой стрелки; X2 — на 180°. Иногда поворот на 180° в одну сторону упирается, а в другую проходит — анимация показывает рабочее направление.']
    ];
    var html = '<h3>Как держать кубик</h3>' +
      '<p>Крошечный уголок — сверху-спереди-справа; на гранях U, F, R видны «крестики» из маленьких квадратиков. ' +
      'Главный блок (цельный 2×2×2 с тремя гладкими гранями) — снизу-сзади-слева. Все ходы в приложении записаны для этого положения, перехватывать кубик не нужно.</p>' +
      '<h3>Обозначения ходов</h3><table>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>' +
      '<h3>Из чего состоит Puppet Cube V2</h3>' +
      '<p>Внутри спрятан обычный кубик 3×3, сдвинутый к одному углу. Детали на сторонах L, D, B продолжены наружу, поэтому снаружи кубик выглядит как 2×2:</p>' +
      '<ul><li><b>главный блок</b> — цельный блок 2×2×2;</li>' +
      '<li><b>три больших блока</b> — тоже выглядят как 2×2×2, внутри каждого спрятано ребро;</li>' +
      '<li><b>три L-блока</b> — L-образные, в их вырезах видны маленькие рёбра;</li>' +
      '<li><b>маленькие детали</b> — уголок, рёбра и центры внутреннего 3×3, образующие «крестики».</li></ul>' +
      '<p>Повороты внешних слоёв меняют форму (детали выпирают), средние слои M, E, S форму не меняют. Некоторые ходы невозможны: выступающие части упираются друг в друга. Решение составлено только из ходов, которые модель проверила на выполнимость.</p>' +
      '<h3>Как работает решатель</h3>' +
      '<ol><li>Блоки ставятся на место оптимальной (кратчайшей) последовательностью поворотов половинок, найденной полным перебором — не больше 13 ходов.</li>' +
      '<li>Центры — поворотами средних слоёв.</li>' +
      '<li>Рёбра — циклами из трёх рёбер: формулы из туториалов (<code>M2 U\' M U2 M\' U\' M2</code> и др.) с подготовительными ходами.</li></ol>' +
      '<h3>Источники</h3>' +
      '<p>Модель головоломки сверена с алгоритмами и описаниями из: статьи «Puppet Cubes» (viXra 2201.0038, разделы 11.1–11.2), гайдов SommerCubes (Rune Vang Sommer), туториалов Cuber Stu и разбора J Perm. ' +
      'Кратчайшие обмены блоков в модели (10 и 11 ходов) совпали с найденными компьютером в статье.</p>' +
      '<p class="hint">Если какой-то ход на настоящем кубике не получается, проверьте, что кубик держится правильно и предыдущие ходы сделаны точно (половинки/слои повернуты до щелчка).</p>';
    $('help-body').innerHTML = html;
  })();

  // =================================================================
  //                                 INIT
  // =================================================================
  drawPalette();
  refreshInput(false);
  simShowStatus();
  if (simRenderer) simRenderer.setState(simState);
  if (shapeRenderer) selectShape(0);
  if (!window.PuppetRenderer) {
    setMessage(inputMessage, 'Не загрузился 3D-модуль (js/render.js).', 'error');
  }
})();
