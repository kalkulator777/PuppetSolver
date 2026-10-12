"""Build a library of legal edge 3-cycle macros for the Puppet Cube V2.

Each macro is  setup + A + setup^-1  where A is one of the tutorial edge
algorithms (in any of the 24 holdings) and the setup is a short sequence of
single-layer turns.  Every macro is checked move by move with the collision
model starting from the solved cube shape (edges and centres never collide,
so legality holds for any arrangement of them as long as the blocks are
solved).  Only pure edge 3-cycles are kept, shortest macro per effect.
"""
import itertools
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import puppet_model as pm  # noqa: E402

EDGE_ALGS = [
    "M2 U' M U2 M' U' M2",
    "M2 U M U2 M' U M2",
    "M U M' U2 M U M'",
    "M U' M' U2 M U' M'",
]
FACE_DIRS = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
LETTER_FACE = {'R': 0, 'L': 1, 'U': 2, 'D': 3, 'F': 4, 'B': 5}
SLICE_FACE = {'M': 1, 'E': 3, 'S': 4}
FACE_LETTER = 'RLUDFB'


def tok_parse(tok):
    base = tok.rstrip("'2")
    suf = tok[len(base):]
    turns = {'': 1, "'": -1, '2': 2}[suf]
    if base[0] in SLICE_FACE:
        return SLICE_FACE[base[0]], 'mid', turns
    return LETTER_FACE[base[0]], ('wide' if base.endswith('w') else 'outer'), turns


def tok_name(face, kind, turns):
    suf = {1: '', -1: "'", 2: '2'}[turns]
    if kind == 'mid':
        letter = 'M' if face in (0, 1) else ('E' if face in (2, 3) else 'S')
        t = turns
        if face != SLICE_FACE[letter] and t != 2:
            t = -t
        return letter + {1: '', -1: "'", 2: '2'}[t]
    return FACE_LETTER[face] + ('w' if kind == 'wide' else '') + suf


def transform(alg, rot):
    m = pm.ROTS[rot]
    out = []
    for tok in alg.split():
        face, kind, turns = tok_parse(tok)
        d = pm.mat_apply(m, FACE_DIRS[face])
        out.append(tok_name(FACE_DIRS.index(d), kind, turns))
    return out


def inv_tok(tok):
    face, kind, turns = tok_parse(tok)
    return tok_name(face, kind, turns if turns == 2 else -turns)


def phys(tok):
    face, kind, turns = tok_parse(tok)
    d = FACE_DIRS[face]
    axis = [i for i in range(3) if d[i]][0]
    sgn = d[axis]
    layers = {sgn} if kind == 'outer' else ({0} if kind == 'mid' else {sgn, 0})
    q = 2 if turns == 2 else -turns * sgn
    return axis, frozenset(layers), q


def simplify(tokens):
    out = []
    for tok in tokens:
        a, l, q = phys(tok)
        if out:
            a2, l2, q2 = phys(out[-1])
            if a == a2 and l == l2:
                tot = (q + q2) % 4
                last = out.pop()
                if tot:
                    face, kind, _ = tok_parse(last)
                    base_q = phys(tok_name(face, kind, 1))[2] % 4
                    turns = 2 if tot == 2 else (1 if tot == base_q else -1)
                    out.append(tok_name(face, kind, turns))
                continue
        out.append(tok)
    return out


def turn(state, axis, layers, q):
    g = pm.axis_rot(axis, q)
    return tuple(pm.COMP[g][r] if pm.layer_of(pm.ANC[i][r][axis]) in layers else r for i, r in enumerate(state))


CORNERS = [i for i, p in enumerate(pm.PIECES) if p['kind'] in ('main', 'big', 'lblock', 'little')]
EDGES = [i for i, p in enumerate(pm.PIECES) if p['kind'] == 'edge']
CENTRES = [i for i, p in enumerate(pm.PIECES) if p['kind'] == 'centre']


def legal(tokens):
    st = tuple(0 for _ in CORNERS)
    for tok in tokens:
        axis, layers, q = phys(tok)
        st = pm.move(st, axis, layers, q, CORNERS)
        if st is None:
            return False
    return True


def effect(tokens):
    st = pm.SOLVED
    for tok in tokens:
        st = turn(st, *phys(tok))
    for i in CORNERS:
        if st[i] != 0:
            return None
    for i in CENTRES:
        if pm.ANC[i][st[i]] != pm.PIECES[i]['anchor']:
            return None
    changed = [i for i in EDGES if st[i] != 0]
    if len(changed) != 3:
        return None
    return tuple(st[i] for i in EDGES)


SINGLE = []
for letter in 'RLUDFBMES':
    for suf in ('', "'", '2'):
        SINGLE.append(letter + suf)


def build(max_depth=2):
    algs = []
    seen = set()
    for rot in range(24):
        for a in EDGE_ALGS:
            t = transform(a, rot)
            k = ' '.join(t)
            if k not in seen and legal(t):
                seen.add(k)
                algs.append(t)
    print('alg instances', len(algs))
    setups = [[]]
    for depth in range(1, max_depth + 1):
        for seq in itertools.product(SINGLE, repeat=depth):
            ok = True
            for x, y in zip(seq, seq[1:]):
                if phys(x)[:2] == phys(y)[:2]:
                    ok = False
            if ok and legal(list(seq)):
                setups.append(list(seq))
    print('setups', len(setups))
    best = {}
    t0 = time.time()
    for su in setups:
        inv = [inv_tok(t) for t in reversed(su)]
        for a in algs:
            toks = simplify(su + a + inv)
            eff = effect(toks)
            if eff is None:
                continue
            if eff in best and len(best[eff]) <= len(toks):
                continue
            if not legal(toks):
                continue
            best[eff] = toks
    print('distinct 3-cycles', len(best), 'in', round(time.time() - t0, 1), 's')
    return best


if __name__ == '__main__':
    lib = build(int(sys.argv[1]) if len(sys.argv) > 1 else 2)
    lens = {}
    for v in lib.values():
        lens[len(v)] = lens.get(len(v), 0) + 1
    print(sorted(lens.items()))


# ---------------------------------------------------------------- fast path
EDGE_HOME = [pm.PIECES[i]['anchor'] for i in EDGES]
SLOT_OF = {a: k for k, a in enumerate(EDGE_HOME)}


def edge_dirs(a):
    out = []
    for ax in range(3):
        if a[ax]:
            d = [0, 0, 0]
            d[ax] = a[ax]
            out.append(tuple(d))
    return out


def sticker_map(tokens):
    """f[p] = sticker position where the sticker at position p ends up"""
    st = pm.SOLVED
    for tok in tokens:
        st = turn(st, *phys(tok))
    f = [None] * 24
    for e, i in enumerate(EDGES):
        m = pm.ROTS[st[i]]
        pos = pm.ANC[i][st[i]]
        k = SLOT_OF[pos]
        sd = edge_dirs(pos)
        for j, d in enumerate(edge_dirs(EDGE_HOME[e])):
            nd = pm.mat_apply(m, d)
            f[2 * e + j] = 2 * k + (0 if nd == sd[0] else 1)
    return tuple(f)


def build_full(max_depth=3, base=None):
    best = {} if base is None else dict(base)
    keyed = {}
    for eff, toks in best.items():
        keyed[sticker_map(toks)] = toks
    algs = []
    seen = set()
    for rot in range(24):
        for a in EDGE_ALGS:
            t = transform(a, rot)
            k = ' '.join(t)
            if k not in seen and legal(t):
                seen.add(k)
                algs.append((t, sticker_map(t)))
    t0 = time.time()
    for depth in range(1, max_depth + 1):
        n_setups = 0
        for seq in itertools.product(SINGLE, repeat=depth):
            seq = list(seq)
            if any(phys(x)[:2] == phys(y)[:2] for x, y in zip(seq, seq[1:])):
                continue
            if not legal(seq):
                continue
            n_setups += 1
            fs = sticker_map(seq)
            fs_inv = [0] * 24
            for p, q in enumerate(fs):
                fs_inv[q] = p
            inv = [inv_tok(t) for t in reversed(seq)]
            for a, fa in algs:
                # macro: first setup, then alg, then inverse setup
                g = tuple(fs_inv[fa[fs[p]]] for p in range(24))
                cand_len = 2 * depth + len(a)
                if g in keyed and len(keyed[g]) <= cand_len - 2:
                    continue
                toks = simplify(seq + a + inv)
                if g in keyed and len(keyed[g]) <= len(toks):
                    continue
                if not legal(toks):
                    continue
                keyed[g] = toks
        print(f'depth {depth}: {n_setups} setups, {len(keyed)} distinct cycles, {time.time() - t0:.1f}s', flush=True)
    return keyed
