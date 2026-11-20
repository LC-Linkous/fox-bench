# Example catalog pack

A catalog pack is a directory another site serves, laid out like this
repository, with a `pack.json` naming its entries:

```
pack.json                                   {"name", "version", "hardware": [ids], "boards": [ids], "templates": [ids], "modules": [ids]}
hardware/<id>.json                          physical boards (same fields as this repository's)
boards/<id>.json                            targets: hardware + firmware + family
firmware/templates/<template>/defaults/<target>.json
                                            defaults for the pack's targets — also for templates the pack does not
                                            re-publish (this example adds a XIAO C3 clone and gives it defaults for
                                            the built-in FM templates)
firmware/templates/<id>/template.json       a template of the pack's own (optional; with its defaults/ and code.py)
modules/<id>.json                           radio modules (optional)
```

The page loads packs from `?pack=<url>` (comma-separated for several) or the
list saved on the Board tab, merges them over the built-in catalog (a pack
entry with a built-in id replaces it), marks every entry with the pack's
name, and lints the result the way `tools/check_catalog.py --pack DIR` does.
A pack carries descriptors only: the page never loads code from one.

This example is what the smoke test loads (`tests/page/smoke.mjs`, "catalog
pack"); `python3 tools/check_catalog.py --pack tests/fixtures/pack` lints it.
