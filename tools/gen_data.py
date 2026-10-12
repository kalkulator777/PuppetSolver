"""Generate js/data.js for the web app.

Usage:  python3 tools/gen_data.py

* collision masks (shell voxel sweep conflicts) used by the JS model
* optimal block-phase solutions for every cube-form arrangement of the
  big blocks and L blocks (moves Rw, Uw, Fw: the main block stays still)
* verified "typical shape" algorithms for getting back to cube shape
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import puppet_model as pm  # noqa: E402
import gen_edges  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ------------------------------------------------------------ block phase
CORNERS = [pm.PIDX[n] for n in ('MAIN', 'BIGx', 'BIGy', 'BIGz', 'LBx', 'LBy', 'LBz', 'A333')]
BLOCK_MOVES = []
for base in ('Rw', 'Uw', 'Fw'):
    for suf in ('', '2', "'"):
        name = base + suf
        (_, axis, layers, q), = pm.parse(name)
        BLOCK_MOVES.append((name, axis, layers, q))


def inverse_name(name):
    if name.endswith("'"):
        return name[:-1]
    if name.endswith('2'):
        return name
    return name + "'"


def block_bfs():
    start = tuple(0 for _ in CORNERS)
    parent = {start: None}
    frontier = [start]
    depth = 0
    t0 = time.time()
    while frontier:
        nxt = []
        for s in frontier:
            for mi, (_, axis, layers, q) in enumerate(BLOCK_MOVES):
                u = pm.move(s, axis, layers, q, CORNERS)
                if u is None or u in parent:
                    continue
                parent[u] = (s, mi)
                nxt.append(u)
        frontier = nxt
        depth += 1
        if frontier:
            print(f'  block BFS depth {depth}: {len(frontier)} new, {len(parent)} total', flush=True)
    print(f'  block BFS done in {time.time() - t0:.1f}s, {len(parent)} states, max depth {depth - 1}')
    return parent


def block_key(state):
    """positions of BIGx,BIGy,BIGz,LBx,LBy,LBz anchors (cube form) as a string"""
    parts = []
    for k, i in enumerate(CORNERS[1:7], start=1):
        a = pm.ANC[i][state[k]]
        parts.append(''.join('+' if c > 0 else '-' for c in a))
    return ','.join(parts)


def block_table():
    parent = block_bfs()
    table = {}
    for s in parent:
        if not pm.is_cube(s, CORNERS):
            continue
        assert s[0] == 0
        lc = s[7]
        assert pm.ANC[CORNERS[7]][lc] == (1, 1, 1) and lc == 0, 'little corner must be home & untwisted'
        path = []
        cur = s
        while parent[cur] is not None:
            prev, mi = parent[cur]
            path.append(BLOCK_MOVES[mi][0])
            cur = prev
        # path lists moves from solved towards s in reverse order; solution = inverse
        sol = [inverse_name(m) for m in path]
        # verify
        st, bad = pm.apply_alg(s, ' '.join(sol), CORNERS)
        assert bad is None and st == tuple(0 for _ in CORNERS)
        table[block_key(s)] = ' '.join(sol)
    print(f'  cube-form block arrangements: {len(table)}')
    return table


# ------------------------------------------------------------- typical shapes
# Step-1 algorithms from SommerCubes' Puppet guides (written there with the
# main block at down-left-front, 2x2 notation).  Converted to this app's
# holding (main block down-left-back, cross corner up-right-front): the
# source R becomes our F side, the source U stays U.  On the cross side a
# "half" is the wide move (Fw, Uw, Rw); on the plain side it is L, D, B.
SHAPES = [
    ('Пистолет (J)', "Fw' Uw Fw Uw"),
    ('Z', "Fw' Uw2 Fw Uw"),
    ('Линия (Y)', "Fw' Uw' Fw"),
    ('+1', "Fw' Uw' Fw Uw"),
    ('+2', "Fw Uw Fw' Uw2"),
    ('Ховеркар', "B' L' Fw' Uw Fw Uw"),
    ('Крюк', "D' Fw Uw Fw' D Uw2 Fw' Uw Fw Uw"),
    ('Небесная палуба', "Uw Fw Rw Fw' Uw2"),
]


def inverse_alg(alg):
    return ' '.join(inverse_name(t) for t in reversed(alg.split()))


def check_shapes():
    out = []
    for name, alg in SHAPES:
        shape, bad = pm.apply_alg(pm.SOLVED, inverse_alg(alg))
        if bad is not None:
            print(f'  shape {name}: inverse blocked at move {bad} -> skipped')
            continue
        if pm.is_cube(shape):
            print(f'  shape {name}: already cube form -> skipped')
            continue
        back, bad = pm.apply_alg(shape, alg)
        assert bad is None and back == pm.SOLVED
        out.append({'name': name, 'alg': alg})
        print(f'  shape {name}: ok')
    return out


# ------------------------------------------------------------------ masks

def conf_masks():
    words = []
    for axis in range(3):
        for q in (1, -1, 2, -2):
            for cell in pm.CELLS:
                m = pm.CONF.get((axis, q, cell), 0)
                words.extend([(m >> (32 * w)) & 0xFFFFFFFF for w in range(4)])
    return words


def main():
    print('generating block table...')
    table = block_table()
    print('checking typical shapes...')
    shapes = check_shapes()
    print('building edge 3-cycle library...')
    lib = gen_edges.build_full(3)
    edge_lib = sorted((' '.join(t) for t in lib.values()), key=lambda x: (len(x.split()), x))
    data = {
        'version': 1,
        'eps': pm.EPS,
        'conf': conf_masks(),
        'blockTable': table,
        'shapes': shapes,
        'edgeLib': edge_lib,
    }
    path = os.path.join(ROOT, 'js', 'data.js')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/gen_data.py - do not edit by hand.\n')
        f.write('(function (root) {\n  var DATA = ')
        f.write(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
        f.write(";\n  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;\n")
        f.write('  else root.PUPPET_DATA = DATA;\n})(this);\n')
    print('wrote', path, os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
