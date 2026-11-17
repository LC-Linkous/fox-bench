// shellgame.js — the shell game across a fleet (docs/network-fox-payloads-plan.md, phase H).
//
// Every fox in the game carries the same list of identities {name, mac} and the same period; the fox in seat i shows
// identities[(i + floor(clock / period)) % n]. With n identities and up to n seats no two foxes show the same name at
// the same time, and every fox has worn every name after n periods. The firmware side is netstealth._shell_game; this
// file is the page's half: the helper on the Fleet tab, the rotation table on the sheet, and the MAC generator.

/** The identity index seat `seat` shows at `tSeconds` (seconds since 2000-01-01, the board clock's epoch). */
export function identityAt(n, seat, periodS, tSeconds) {
  return (seat + Math.floor(tSeconds / periodS)) % n;
}

/** Rows = the n consecutive periods from a start, columns = seats: which name each seat shows when. */
export function table(identities, periodS, seats, startSeconds = 0) {
  const n = identities.length;
  const base = Math.floor(startSeconds / periodS);
  return Array.from({ length: n }, (_, k) => ({
    period: k,
    from: (base + k) * periodS,
    names: seats.map(seat => identities[identityAt(n, seat, periodS, (base + k) * periodS)].name),
  }));
}

/** True when no two seats share a name in any period (seats distinct and fewer than or equal to identities). */
export function collisionFree(identities, seats) {
  const n = identities.length;
  if (new Set(seats).size !== seats.length || seats.length > n) return false;
  return table(identities, 60, seats).every(row => new Set(row.names).size === row.names.length);
}

/** A locally administered unicast MAC (first byte: bit 1 set, bit 0 clear), from Math.random unless `rnd` is given. */
export function randomMac(rnd = Math.random) {
  const b = Array.from({ length: 6 }, () => Math.floor(rnd() * 256));
  b[0] = (b[0] | 0x02) & 0xFE;
  return b.map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

/** Seconds since 2000-01-01 as the board counts them: the page sets the board clock to local wall-clock components
 *  and the firmware sums them zone-less, so the same sum is taken here from the local components. */
export function boardSeconds(date) {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()) - Date.UTC(2000, 0, 1)) / 1000);
}
