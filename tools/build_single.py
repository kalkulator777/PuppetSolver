"""Build puppet-solver.html: the whole app in one self-contained file
(handy for phones: copy the file and open it in a browser, no server needed).

Usage:  python3 tools/build_single.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def main():
    html = read('index.html')

    def css(m):
        return '<style>\n' + read(m.group(1)) + '\n</style>'

    def js(m):
        code = read(m.group(1)).replace('</script', '<\\/script')
        return '<script>\n' + code + '\n</script>'

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    out = os.path.join(ROOT, 'puppet-solver.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
