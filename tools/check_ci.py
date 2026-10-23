#!/usr/bin/env python3
"""check_ci.py — parse .github/workflows/ci.yml strictly: duplicate mapping keys are an error.

    python3 tools/check_ci.py [path]

PyYAML's default loader keeps the last of two duplicate keys silently; GitHub refuses the whole workflow
("Invalid workflow file") — which happened once, after a merge left two `if:` lines on one job, and showed up only
as no run at all. Also checks the job graph fox-bench relies on: deploy and release need the three test jobs.
"""
import sys, os
import yaml

class Strict(yaml.SafeLoader): pass
def _map(loader, node):
    seen = {}
    for k, _ in node.value:
        key = loader.construct_object(k)
        if key in seen: raise yaml.constructor.ConstructorError(None, None, f"duplicate key {key!r}", k.start_mark)
        seen[key] = True
    return yaml.SafeLoader.construct_mapping(loader, node)
Strict.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _map)

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".github/workflows/ci.yml")
    try: wf = yaml.load(open(path), Loader=Strict)
    except yaml.YAMLError as e: print(f"check_ci: {path}: {e}"); return 1
    jobs = wf.get("jobs", {}); problems = []
    tests = {"page", "sim", "foxlib-c"}
    for j in ("deploy", "release"):
        need = set(jobs.get(j, {}).get("needs", []) or [])
        if not tests <= need: problems.append(f"job {j} needs {sorted(need)}; must include {sorted(tests)}")
    for j, body in jobs.items():
        if "runs-on" not in body: problems.append(f"job {j}: no runs-on")
    if problems:
        for p in problems: print("check_ci: " + p)
        return 1
    print(f"ci ok: {len(jobs)} jobs ({', '.join(jobs)}), no duplicate keys"); return 0

if __name__ == "__main__": sys.exit(main())
