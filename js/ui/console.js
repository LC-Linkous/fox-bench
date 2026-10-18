// console.js — the console drawer: log, collapsing long replies, Python input with history.
// SPDX-License-Identifier: GPL-2.0-only
// Adapted from nanovna-web.

const COLLAPSE_AFTER = 12, MAX_ENTRIES = 800;

export function initConsole({ log, form, input, handle, drawer, toggle, clearBtn, copyBtn, dlBtn, dlMode }, onSend) {
  const history = []; let hIdx = -1; const entries = [];
  const stamp = () => new Date().toISOString().slice(11, 23);
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const trim = () => { while (log.childElementCount > MAX_ENTRIES) log.firstChild.remove(); };
  function line(text, cls) { const el = document.createElement('div'); if (cls) el.className = cls; el.textContent = text; log.appendChild(el); entries.push({ t: stamp(), type: cls === 'tx' ? 'tx' : cls === 'err' ? 'err' : 'note', text }); trim(); scroll(); }
  function reply(body) {
    const lines = body.split('\n').filter(l => l.length);
    const wrap = document.createElement('div'); wrap.className = 'reply';
    if (lines.length <= COLLAPSE_AFTER) wrap.textContent = lines.join('\n');
    else {
      const head = document.createElement('div'); head.textContent = lines.slice(0, COLLAPSE_AFTER).join('\n');
      const rest = document.createElement('div'); rest.textContent = lines.slice(COLLAPSE_AFTER).join('\n'); rest.hidden = true;
      const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'toggle'; tog.textContent = `… show all ${lines.length} lines`;
      tog.addEventListener('click', () => { rest.hidden = !rest.hidden; tog.textContent = rest.hidden ? `… show all ${lines.length} lines` : 'show less'; });
      wrap.append(head, tog, rest);
    }
    log.appendChild(wrap); entries.push({ t: stamp(), type: 'rx', text: body }); trim(); scroll();
  }
  form.addEventListener('submit', e => { e.preventDefault(); const cmd = input.value.trim(); if (!cmd) return; history.unshift(cmd); if (history.length > 50) history.pop(); hIdx = -1; input.value = ''; line('> ' + cmd, 'tx'); onSend(cmd); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { e.preventDefault(); if (hIdx < history.length - 1) { hIdx++; input.value = history[hIdx]; } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (hIdx > 0) { hIdx--; input.value = history[hIdx]; } else { hIdx = -1; input.value = ''; } }
  });
  clearBtn.addEventListener('click', () => { log.innerHTML = ''; entries.length = 0; });
  dlBtn.addEventListener('click', () => {
    const mode = dlMode.value, lines = [];
    for (const e of entries) { if (e.type === 'tx') lines.push(`${e.t}  ${e.text}`); else if (mode === 'full') lines.push(e.text.split('\n').map(l => `${e.t}      ${l}`).join('\n')); }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' })); a.download = `fox-bench-console-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  copyBtn.addEventListener('click', async () => { try { await navigator.clipboard.writeText(log.innerText); copyBtn.textContent = 'Copied'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); } catch { line('clipboard unavailable', 'err'); } });
  toggle.addEventListener('click', () => { const c = drawer.classList.toggle('collapsed'); toggle.textContent = c ? 'Show' : 'Hide'; toggle.setAttribute('aria-expanded', String(!c)); });
  let dragging = false, startY = 0, startH = 0;
  const saved = parseInt(localStorage.getItem('fox-bench.consoleH') || '', 10); if (saved > 100) log.style.height = saved + 'px';
  handle.addEventListener('pointerdown', e => { dragging = true; startY = e.clientY; startH = log.getBoundingClientRect().height; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', e => { if (!dragging) return; log.style.height = Math.max(100, Math.min(700, startH + (e.clientY - startY))) + 'px'; });
  handle.addEventListener('pointerup', () => { dragging = false; try { localStorage.setItem('fox-bench.consoleH', String(Math.round(log.getBoundingClientRect().height))); } catch {} });
  return { line, reply, recent: (n = 200) => entries.slice(-n), tx: c => line('> ' + c, 'tx'), err: t => line(t, 'err'), dim: t => line(t, 'dim'), setEnabled: on => { input.disabled = !on; form.querySelector('button').disabled = !on; } };
}
