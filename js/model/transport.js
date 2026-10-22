// transport.js — which connected device may receive a deploy for which family.
// SPDX-License-Identifier: GPL-2.0-only
//
// The top bar's "connected" is not enough: the device that is open speaks one family's protocol
// (the CircuitPython REPL, a USB drive, the foxlib-c serial console), and the board selected in the
// form may since have changed to another family. A deploy over the wrong transport writes one
// firmware's files onto another's board. These checks are what the deploy modules ask before writing.

/** Transports that can carry a deploy for a family: the REPL (or the in-memory demo board) for foxlib, the drive otherwise. */
export function deployTransports(family) { return family === 'foxlib' ? ['repl', 'memory'] : family === 'compiled' ? [] : ['drive']; }

const name = t => t === 'repl' ? 'the CircuitPython REPL' : t === 'console' ? 'the serial console' : t === 'drive' ? 'a USB drive' : t === 'memory' ? 'the demo board' : t;

/**
 * Null when `device` can take a deploy for `board`; otherwise the reason, in words.
 * device: { transport, kind, board? }  board: the selected board descriptor  onBoard: { listening }
 */
export function deployBlocker({ device, board, onBoard }) {
  const family = board.family || 'foxlib';
  if (family === 'compiled') return 'kitsune foxes are not written from the page yet: the configuration is compiled into their firmware. Export the header on this tab.';
  if (!device) return 'not connected';
  if (!deployTransports(family).includes(device.transport)) return `the connected device is ${name(device.transport)}; ${board.name} is deployed over ${family === 'foxlib' ? 'the REPL' : 'its drive'}. Disconnect, then connect the ${board.name} the right way.`;
  if (device.kind === 'demo' && device.board && device.board.id !== board.id) return `the demo board is a ${device.board.name}; start the demo again for ${board.name}.`;
  if (onBoard?.listening) return 'Listen only: the board has not been identified. Connect (or Re-read board) first.';
  if (device.transport === 'drive' && device.looksRight === false && !device.confirmedFolder) return `"${device.handle?.name || 'the folder picked'}" has none of the files a ${board.name} drive carries (${(board.drive?.files || []).join(', ')}): it may be a folder on your computer. Confirm it is the fox's drive to write there.`;
  return null;
}
