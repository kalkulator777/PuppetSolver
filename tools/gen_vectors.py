"""Write tests/vectors.json: random move walks with legality and resulting
voxel occupancy, computed by the Python reference model.  The Node tests
replay them with the JS model and compare.

Usage:  python3 tools/gen_vectors.py
"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import puppet_model as pm  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS = [l + s for l in ('R', 'L', 'U', 'D', 'F', 'B', 'M', 'E', 'S', 'Rw', 'Uw', 'Fw') for s in ('', "'", '2')]


def snapshot(state):
    """sorted list of 'piece:x,y,z' for every voxel (order independent)"""
    out = []
    for i, r in enumerate(state):
        for v in pm.VOX[i][r]:
            out.append(pm.PIECES[i]['name'] + ':' + ','.join(map(str, v)))
    return sorted(out)


def main():
    rnd = random.Random(2024)
    walks = []
    for _ in range(60):
        state = pm.SOLVED
        steps = []
        for _ in range(25):
            tok = rnd.choice(TOKENS)
            (_, axis, layers, q), = pm.parse(tok)
            nxt = pm.move(state, axis, layers, q)
            steps.append({'move': tok, 'legal': nxt is not None})
            if nxt is not None:
                state = nxt
        walks.append({'steps': steps, 'final': snapshot(state), 'cube': pm.is_cube(state)})
    path = os.path.join(ROOT, 'tests', 'vectors.json')
    with open(path, 'w') as f:
        json.dump(walks, f)
    legal = sum(s['legal'] for w in walks for s in w['steps'])
    total = sum(len(w['steps']) for w in walks)
    print('wrote', path, f'({legal}/{total} legal moves)')


if __name__ == '__main__':
    main()
