// handoff.js — one fox leads to another (docs/network-fox-payloads-plan.md, phase J).
//
// `fleet.points_to` names the fox this one leads to: a saved profile's fox number (fleet.number) or its name. Text
// anywhere in the configuration may carry placeholders filled at deploy from that profile:
//   {{to.freq}}      an FM fox's first frequency, MHz to three decimals ("146.565")
//   {{to.name}}      a network fox's name on the air (SSID / BLE name, or its callsign when that is the name)
//   {{to.code}}      its portal code, else its BLE service code, else "major/minor" of its beacon code
//   {{to.number}}    its fox number
//   {{to.callsign}}  its id.callmessage
// The editor keeps the placeholders; what is validated and written to the board is the filled-in text, so a portal
// body "Next: listen on {{to.freq}} MHz" or a Morse message "QSY {{to.name}}" is checked at its real length.
// Nothing here is firmware: both fleets already carry text.

export const PLACEHOLDERS = ['freq', 'name', 'code', 'number', 'callsign'];
const RE = /\{\{\s*to\.([a-z_]+)\s*\}\}/g;

/** The profile `points_to` names: by fox number (fleet.number) first, then by profile name. */
export function targetOf(pointsTo, profiles) {
  if (pointsTo == null || pointsTo === '') return null;
  const s = String(pointsTo).trim();
  const n = Number(s);
  if (s !== '' && Number.isInteger(n)) {
    const byNum = profiles.find(p => p.cfg?.fleet?.number != null && Number(p.cfg.fleet.number) === n);
    if (byNum) return byNum;
  }
  return profiles.find(p => p.name === s) || null;
}

/** What a target offers: the placeholder values from its saved configuration. Missing ones are absent, not ''. */
export function valuesFor(profile) {
  const v = {};
  const c = profile?.cfg;
  if (!c) return v;
  const f = c.plan?.frequencies_mhz;
  if (Array.isArray(f) && f.length && Number.isFinite(f[0])) v.freq = Number(f[0]).toFixed(3);
  if (c.net) {
    const name = c.id?.use_callsign_as_name ? c.id.callmessage : (c.net.kind === 'ble' ? c.net.name : c.net.ssid);
    if (name) v.name = name;
  }
  const cp = c.checkpoint?.enabled ? c.checkpoint : null;
  if (cp?.portal?.enabled && cp.portal.code) v.code = cp.portal.code;
  else if (cp?.ble?.enabled && cp.ble.code) v.code = cp.ble.code;
  else if (c.payload?.enabled && c.payload.code && (c.payload.code.major || c.payload.code.minor)) v.code = `${c.payload.code.major}/${c.payload.code.minor}`;
  if (c.fleet?.number != null && c.fleet.number !== '') v.number = String(c.fleet.number);
  if (c.id?.callmessage) v.callsign = c.id.callmessage;
  return v;
}

/** Every placeholder in the configuration's text (outside `fleet`), with its path. */
export function placeholdersIn(cfg) {
  const out = [];
  const walk = (x, path) => {
    if (typeof x === 'string') { for (const m of x.matchAll(RE)) out.push({ path, key: m[1] }); }
    else if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`));
    else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) { if (path === '' && k === 'fleet') continue; walk(y, path ? `${path}.${k}` : k); }
  };
  walk(cfg, '');
  return out;
}

/**
 * The configuration with its placeholders filled from the target profile. Returns the filled copy (the input is not
 * changed), the target, the values used, and what could not be filled: `unresolved` entries name the path and key and
 * the reason — no target, unknown placeholder, or the target has no such value.
 */
export function resolve(cfg, profiles) {
  const found = placeholdersIn(cfg);
  const pointsTo = cfg?.fleet?.points_to;
  const target = targetOf(pointsTo, profiles);
  const values = target ? valuesFor(target) : {};
  const unresolved = [];
  if (!found.length && !pointsTo) return { cfg, target: null, values: {}, used: [], unresolved };
  if (pointsTo && !target) unresolved.push({ path: 'fleet.points_to', key: '', why: `no saved profile is fox ${pointsTo} (by number or name)` });
  const used = new Set();
  const fill = (x, path) => {
    if (typeof x === 'string') {
      return x.replace(RE, (m, key) => {
        if (!PLACEHOLDERS.includes(key)) { unresolved.push({ path, key, why: `unknown placeholder {{to.${key}}}; one of ${PLACEHOLDERS.map(k => 'to.' + k).join(', ')}` }); return m; }
        if (!target) { unresolved.push({ path, key, why: pointsTo ? `{{to.${key}}} needs the fox this one points to` : `{{to.${key}}} but this fox points to nothing (Fleet record → Points to)` }); return m; }
        if (!(key in values)) { unresolved.push({ path, key, why: `{{to.${key}}}: "${target.name}" has no ${key} (${describeMissing(key)})` }); return m; }
        used.add(key);
        return values[key];
      });
    }
    if (Array.isArray(x)) return x.map((y, i) => fill(y, `${path}[${i}]`));
    if (x && typeof x === 'object') { const o = {}; for (const [k, y] of Object.entries(x)) o[k] = (path === '' && k === 'fleet') ? y : fill(y, path ? `${path}.${k}` : k); return o; }
    return x;
  };
  const filled = fill(cfg, '');
  return { cfg: filled, target, values, used: [...used], unresolved };
}

function describeMissing(key) {
  return { freq: 'an FM fox with a plan', name: 'a network fox with a name', code: 'a portal, BLE service or beacon code', number: 'a fox number on its Fleet record', callsign: 'a callsign' }[key] || key;
}

/** The chain across saved profiles: links, loops and dead ends, for the Fleet tab and the event sheet. */
export function chain(profiles) {
  const label = p => (p.cfg?.fleet?.number != null && p.cfg.fleet.number !== '' ? `#${p.cfg.fleet.number} ` : '') + p.name;
  const links = [], problems = [];
  for (const p of profiles) {
    const to = p.cfg?.fleet?.points_to;
    if (to == null || to === '') continue;
    const t = targetOf(to, profiles);
    if (!t) { problems.push(`${label(p)} points to fox ${to}, which is not a saved profile`); continue; }
    if (t === p) { problems.push(`${label(p)} points to itself`); continue; }
    const r = resolve(p.cfg, profiles);
    links.push({ from: p, to: t, text: `${label(p)} → ${label(t)}`, unresolved: r.unresolved.length });
  }
  // loops: follow each start until it repeats
  for (const p of profiles) {
    const seen = new Set([p]);
    let cur = p;
    for (let i = 0; i < profiles.length + 1; i++) {
      const to = cur.cfg?.fleet?.points_to;
      const t = to != null && to !== '' ? targetOf(to, profiles) : null;
      if (!t) break;
      if (seen.has(t)) { if (t === p) problems.push(`loop: ${[...seen].map(label).join(' → ')} → ${label(t)}`); break; }
      seen.add(t); cur = t;
    }
  }
  return { links, problems: [...new Set(problems)] };
}
