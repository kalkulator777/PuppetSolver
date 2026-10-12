"""Voxel model of the MoYu Puppet Cube V2 (reference implementation in Python).

Geometry
--------
The puzzle is a classic 3x3x3 ("inner cube") whose pieces on the L, D and B
sides carry extensions ("shell") that fill the outer shape up to a 4x4x4
cube that looks like a 2x2x2.  Coordinates are voxel centres relative to the
core centre: every coordinate is an integer in -2..2.  In the solved cube form
all voxels lie in [-2, 1]^3.

* inner cube voxels: every coordinate in -1..1 (27 cubies, core at 0,0,0)
* shell voxels: max(|x|, |y|, |z|) == 2

Axes: x -> R, y -> U, z -> F.  The thick ("plain 2x2") faces are L, D, B,
the thin faces with the small 3x3 cross are R, U, F.

Move legality
-------------
Layer membership is decided by the inner cubie ("anchor") of each piece.
A turn is blocked when a shell voxel of a turning piece sweeps through a
shell voxel of a piece that stays.  Inner cubies never collide (the hidden
parts of the inner 3x3 are rounded).  This rule reproduces the computer
optimal block-swap algorithms published for the Puppet Cube (10 and 11 moves)
and the edge algorithms used by human tutorials.
"""

import itertools
import math

# ---------------------------------------------------------------- rotations

def mat_mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)) for i in range(3))


def mat_apply(m, v):
    return tuple(sum(m[i][k] * v[k] for k in range(3)) for i in range(3))


IDENT = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
# +90 degrees (right hand rule) about x, y, z
QUARTER = (
    ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    ((0, 0, 1), (0, 1, 0), (-1, 0, 0)),
    ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
)


def _gen_rots():
    rots = [IDENT]
    frontier = [IDENT]
    while frontier:
        nxt = []
        for m in frontier:
            for g in QUARTER:
                n = mat_mul(g, m)
                if n not in rots:
                    rots.append(n)
                    nxt.append(n)
        frontier = nxt
    return rots


ROTS = _gen_rots()
assert len(ROTS) == 24
RIDX = {m: i for i, m in enumerate(ROTS)}
COMP = [[RIDX[mat_mul(ROTS[g], ROTS[r])] for r in range(24)] for g in range(24)]


def axis_rot(axis, q):
    m = IDENT
    for _ in range(q % 4):
        m = mat_mul(QUARTER[axis], m)
    return RIDX[m]


# ------------------------------------------------------------------- pieces

def _octant(signs):
    """voxels (i-coords 0..3) of an octant: sign -1 -> {0,1}, +1 -> {2,3}"""
    rng = [(0, 1) if s < 0 else (2, 3) for s in signs]
    return [p for p in itertools.product(*rng)]


def _u(p):
    return tuple(c - 2 for c in p)


def build_pieces():
    """Return list of pieces: dict(name, kind, vox (u coords), anchor)."""
    pieces = []

    def add(name, kind, vox_i):
        vox = [_u(p) for p in vox_i]
        inner = [v for v in vox if all(-1 <= c <= 1 for c in v)]
        assert len(inner) == 1, (name, vox)
        pieces.append({'name': name, 'kind': kind, 'vox': vox, 'anchor': inner[0]})

    add('MAIN', 'main', _octant((-1, -1, -1)))
    axes = 'xyz'
    for thin in range(3):  # big blocks: two thick axes
        signs = [-1, -1, -1]
        signs[thin] = 1
        vox = _octant(signs)
        hidden = tuple(2 if a == thin else 1 for a in range(3))
        vox.remove(hidden)
        add('BIG' + axes[thin], 'big', vox)
        add('HE' + axes[thin], 'edge', [hidden])
    for thick in range(3):  # L blocks: one thick axis
        signs = [1, 1, 1]
        signs[thick] = -1
        octv = _octant(signs)
        corner = tuple(1 if a == thick else 3 for a in range(3))
        lb = [p for p in octv if p[thick] == 0] + [corner]
        add('LB' + axes[thick], 'lblock', lb)
        for p in octv:
            if p[thick] == 1 and p != corner:
                twos = sum(1 for a in range(3) if a != thick and p[a] == 2)
                kind = 'centre' if twos == 2 else 'edge'
                add(('C' if kind == 'centre' else 'IE') + ''.join(map(str, p)), kind, [p])
    for p in _octant((1, 1, 1)):
        if p == (2, 2, 2):
            continue  # core never moves
        threes = sum(1 for c in p if c == 3)
        kind = {3: 'little', 2: 'edge', 1: 'centre'}[threes]
        add('A' + ''.join(map(str, p)), kind, [p])
    seen = set()
    for pc in pieces:
        for v in pc['vox']:
            assert v not in seen
            seen.add(v)
    assert len(pieces) == 26 and len(seen) == 63
    return pieces


PIECES = build_pieces()
NP = len(PIECES)
PIDX = {p['name']: i for i, p in enumerate(PIECES)}

# --------------------------------------------------------------- collisions
EPS = 0.05
PLANE = [(1, 2), (2, 0), (0, 1)]  # in-plane axes ordered so +q is counter-clockwise
CELLS = list(itertools.product(range(-2, 3), repeat=3))


def cell_index(v):
    return (v[0] + 2) * 25 + (v[1] + 2) * 5 + (v[2] + 2)


def _sq_corners(cx, cy, th, h):
    c, s = math.cos(th), math.sin(th)
    pts = [(cx - h, cy - h), (cx + h, cy - h), (cx + h, cy + h), (cx - h, cy + h)]
    return [(p[0] * c - p[1] * s, p[0] * s + p[1] * c) for p in pts]


def _overlap(p, q):
    for poly in (p, q):
        for i in range(4):
            a, b = poly[i], poly[(i + 1) % 4]
            nx, ny = b[1] - a[1], a[0] - b[0]
            pa = [nx * x + ny * y for x, y in p]
            pb = [nx * x + ny * y for x, y in q]
            if max(pa) <= min(pb) + 1e-9 or max(pb) <= min(pa) + 1e-9:
                return False
    return True


def _is_shell(v):
    return max(abs(c) for c in v) == 2


def _build_conf():
    conf = {}
    shell = [c for c in CELLS if _is_shell(c)]
    h = 0.5 - EPS
    for axis in range(3):
        o0, o1 = PLANE[axis]
        for q in (1, -1, 2, -2):
            ang = q * 90.0
            steps = max(4, int(abs(ang) / 3))
            for m in shell:
                mask = 0
                for s in shell:
                    if s[axis] != m[axis]:
                        continue
                    x, y, a, b = m[o0], m[o1], s[o0], s[o1]
                    if abs(math.hypot(x, y) - math.hypot(a, b)) > 1.5:
                        continue
                    sq = [(a - h, b - h), (a + h, b - h), (a + h, b + h), (a - h, b + h)]
                    for k in range(1, steps):
                        if _overlap(_sq_corners(x, y, math.radians(ang * k / steps), h), sq):
                            mask |= 1 << cell_index(s)
                            break
                conf[(axis, q, m)] = mask
    return conf


CONF = _build_conf()

VOX = [[[mat_apply(ROTS[r], v) for v in pc['vox']] for r in range(24)] for pc in PIECES]
ANC = [[mat_apply(ROTS[r], pc['anchor']) for r in range(24)] for pc in PIECES]
SMASK = [[0] * 24 for _ in range(NP)]
SWEPT = {}
for i in range(NP):
    for r in range(24):
        sh = [v for v in VOX[i][r] if _is_shell(v)]
        m = 0
        for v in sh:
            m |= 1 << cell_index(v)
        SMASK[i][r] = m
        for axis in range(3):
            for q in (1, -1, 2, -2):
                w = 0
                for v in sh:
                    w |= CONF[(axis, q, v)]
                SWEPT[(i, r, axis, q)] = w


def layer_of(c):
    return -1 if c <= -1 else (0 if c == 0 else 1)


def move(state, axis, layers, q, pieces=None):
    """Apply a turn; return new state tuple or None when blocked.

    state: tuple of rotation indices (one per piece in `pieces`, default all).
    layers: set of layer ids in {-1, 0, 1}.  q: quarter turns (right hand).
    """
    idx = range(NP) if pieces is None else pieces
    moving = []
    static = 0
    for k, i in enumerate(idx):
        if layer_of(ANC[i][state[k]][axis]) in layers:
            moving.append(k)
        else:
            static |= SMASK[i][state[k]]
    qq = q % 4
    tries = [2, -2] if qq == 2 else [1 if qq == 1 else -1]
    for t in tries:
        w = 0
        for k in moving:
            w |= SWEPT[(idx[k], state[k], axis, t)]
        if not (w & static):
            g = axis_rot(axis, qq)
            mv = set(moving)
            return tuple(COMP[g][r] if k in mv else r for k, r in enumerate(state))
    return None


def is_cube(state, pieces=None):
    idx = range(NP) if pieces is None else pieces
    for k, i in enumerate(idx):
        for v in VOX[i][state[k]]:
            if not all(-2 <= c <= 1 for c in v):
                return False
    return True


# ---------------------------------------------------------------- notation
# name -> (axis, layer set, quarter turns for the plain (clockwise) move)
BASE_MOVES = {
    'R': (0, {1}, -1), 'L': (0, {-1}, 1), 'M': (0, {0}, 1),
    'U': (1, {1}, -1), 'D': (1, {-1}, 1), 'E': (1, {0}, 1),
    'F': (2, {1}, -1), 'B': (2, {-1}, 1), 'S': (2, {0}, -1),
    'Rw': (0, {0, 1}, -1), 'Lw': (0, {-1, 0}, 1),
    'Uw': (1, {0, 1}, -1), 'Dw': (1, {-1, 0}, 1),
    'Fw': (2, {0, 1}, -1), 'Bw': (2, {-1, 0}, 1),
}


def parse(alg):
    out = []
    for tok in alg.replace('(', ' ').replace(')', ' ').split():
        tok = tok.replace('’', "'")
        base = tok.rstrip("'2")
        suf = tok[len(base):]
        axis, layers, q = BASE_MOVES[base]
        mult = {'': 1, "'": -1, '2': 2, "2'": 2, "'2": 2}[suf]
        out.append((tok, axis, layers, q * mult))
    return out


def apply_alg(state, alg, pieces=None):
    """Return (state, None) or (None, index_of_blocked_move)."""
    for n, (_, axis, layers, q) in enumerate(parse(alg)):
        nxt = move(state, axis, layers, q, pieces)
        if nxt is None:
            return None, n
        state = nxt
    return state, None


SOLVED = tuple(0 for _ in range(NP))
