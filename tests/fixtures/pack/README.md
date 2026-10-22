# Example catalog pack

A catalog pack is a directory another site serves, laid out like this
repository, with a `pack.json` naming its entries:

```
pack.json                                   {"name", "version", "hardware": [ids], "boards": [ids], "templates": [ids], "modules": [ids]}
hardware/<id>.json                          physical boards (same fields as this repository's)
boards/<id>.json                            targets: hardware + firmware + family
firmware/templates/<template>/defaults/<target>.json
                                            defaults for the pack's targets — also for templates the pack does not
                                            re-publish (this example adds an Atom clone and gives it defaults for the
                                            built-in kitsune templates)
firmware/templates/<id>/template.json       a template of the pack's own (optional; with its defaults/ and code.py)
modules/<id>.json                           radio modules (optional)
```

The page loads packs from `?pack=<url>` (comma-separated for several) or the
list saved on the Board tab, merges them over the built-in catalog (a pack
entry with a built-in id replaces it), marks every entry with the pack's
name, and resolves a target's `firmware.image` / `build_info` relative to
the pack. Packs are data only: a target may name one of this page's vendor
models, but no code is loaded from a pack. Lint a pack as the page will see
it with `python3 tools/check_catalog.py --pack <dir>`.

This one is a fixture for the page smoke test; the ids are invented.
