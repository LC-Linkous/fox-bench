# Security

fox-bench is a static page: no server, no accounts, no telemetry. It talks
to a board on your bench through the browser's Web Serial and File System
Access APIs, after you pick the port or drive in a browser prompt, and it
keeps profiles and the fleet log in your browser's local storage. Nothing
leaves your machine except fetches of the page's own files and, when you
ask for the vendor PicoFox firmware, one fetch from the vendor's GitHub at a
pinned commit, checked against a sha256 in the catalog.

What could go wrong, and what the page does about it:

- **Writing to the wrong device.** A deploy goes only over its board
  family's transport; the flasher checks the detected chip against the
  selected target before erasing; a UF2 copy checks the folder is the
  bootloader drive by its contents; a drive that looks like a folder on
  your computer needs confirming before anything is written.
- **A firmware image that is not what it claims.** Hosted images are
  checked against the site's build fingerprint; the vendor's against the
  pinned sha256; a UF2 against its structure, chip family and, for
  fox-bench's, the version string in the image.
- **A `fox.json` from anywhere.** The firmware's parser and validator are
  fuzzed under sanitizers in CI and clamp or refuse what they do not
  understand; the fox stays silent on a configuration it cannot trust.
- **The fleet CSV in a spreadsheet.** Cells that a spreadsheet would
  evaluate are neutralised on export.

Found something? Open a GitHub issue, or — if it would let someone key a
transmitter they should not, or write to a device they did not pick —
email the maintainer first (the address in the repository's commits) and
give a week before posting details. There is no bounty; there will be a
fix and a thank-you in the changelog.
