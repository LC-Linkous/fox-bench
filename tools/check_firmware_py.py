#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The CircuitPython firmware against what CircuitPython's compiler and built-ins accept.

The simulator runs foxlib on desktop Python, which accepts a larger language: code that passes every scenario can
still be a SyntaxError or raise on a board. Each rule below was checked against the CircuitPython 9.2 source
(py/grammar.h, py/objstr.c, py/circuitpy_mpconfig.h); the comment says where.

  dict-unpack   `{**a, "k": v}`: dictorsetmaker_item is `test [':' test]`, no `**` (py/grammar.h). A SyntaxError
                that made netpayload.py fail to import on every board from foxlib 1.4 to 1.10.
  match         the match statement: no rule in py/grammar.h.
  decode-errors bytes.decode / str.encode with an errors argument: accepted and ignored (bytes_decode passes it to
                str(); objstr.c "TODO: validate 2nd/3rd args"), so invalid UTF-8 raises UnicodeError where desktop
                Python would substitute. Decode in a try, or use foxlib's text helper.
  method-kwargs keyword arguments to str/bytes/bytearray methods: they are positional-only
                (MP_DEFINE_CONST_FUN_OBJ_VAR_BETWEEN; "TODO: should accept kwargs too").

Usage: python3 tools/check_firmware_py.py [files...]   (default: every CircuitPython file in the repository)
"""
import ast
import glob
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT = ["firmware/foxlib/*.py", "firmware/safemode.py", "firmware/boot.py", "firmware/templates/*/code.py", "tools/sniffer/code.py"]
STR_METHODS = {"split", "rsplit", "join", "replace", "strip", "lstrip", "rstrip", "startswith", "endswith", "find",
               "rfind", "index", "rindex", "partition", "rpartition", "lower", "upper", "format", "count", "center",
               "splitlines", "decode", "encode", "hex", "isalpha", "isdigit", "isspace", "isupper", "islower"}


def check(path):
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src, path)
    out = []

    def add(node, rule, msg):
        out.append("%s:%d: %s: %s" % (os.path.relpath(path, ROOT), node.lineno, rule, msg))

    for node in ast.walk(tree):
        if isinstance(node, ast.Dict) and any(k is None for k in node.keys):
            add(node, "dict-unpack", "`{**...}` is a SyntaxError in CircuitPython; build the dict and update() it")
        elif hasattr(ast, "Match") and isinstance(node, ast.Match):
            add(node, "match", "CircuitPython has no match statement")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            name = node.func.attr
            if name in ("decode", "encode") and (len(node.args) >= 2 or any(k.arg == "errors" for k in node.keywords)):
                add(node, "decode-errors", "%s(..., errors) is ignored on CircuitPython: invalid UTF-8 raises UnicodeError" % name)
            if name in STR_METHODS and node.keywords:
                add(node, "method-kwargs", "%s() takes positional arguments only on CircuitPython" % name)
    return out


def main(argv):
    files = argv or sorted(f for pat in DEFAULT for f in glob.glob(os.path.join(ROOT, pat)))
    problems = []
    for f in files:
        problems += check(f)
    for p in problems:
        print(p)
    print("firmware python: %d file(s), %d problem(s)" % (len(files), len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
