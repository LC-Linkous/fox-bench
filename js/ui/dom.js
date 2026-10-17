// dom.js — tiny helpers shared by the tab modules.
// SPDX-License-Identifier: GPL-2.0-only

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div.card', {onclick}, children…) */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/** replaceChildren that drops null/false like h() does */
export const fill = (el, ...children) => el.replaceChildren(...children.flat(Infinity).filter(c => c != null && c !== false).map(c => c.nodeType ? c : document.createTextNode(String(c))));

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** A labelled field: field('Label', inputEl, hint) */
export const field = (label, input, hint) => h('div.field', {}, h('label', {}, label), input, hint ? h('p.hint', {}, hint) : null);

export function numInput(value, { min, max, step = 'any', onchange, width } = {}) {
  const el = h('input', { type: 'number', value, min, max, step, style: width ? `width:${width}` : null });
  el.addEventListener('change', () => { const v = el.valueAsNumber; if (Number.isFinite(v)) onchange(v); else el.value = value; });
  return el;
}
export function select(options, value, onchange) {
  const el = h('select', {}, options.map(o => { const [v, label] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === value }, label); }));
  el.addEventListener('change', () => onchange(el.value));
  return el;
}
export function check(label, value, onchange, hint) {
  const inp = h('input', { type: 'checkbox', checked: value }); inp.addEventListener('change', () => onchange(inp.checked));
  return h('label.row.check', {}, inp, h('span', {}, label, hint ? h('span.hint', {}, ' ' + hint) : null));
}
export const badge = (text, cls) => h('span.badge' + (cls ? '.' + cls : ''), {}, text);
export const fmtHz = hz => hz >= 1e6 ? (hz / 1e6).toFixed(3) + ' MHz' : hz >= 1e3 ? (hz / 1e3).toFixed(1) + ' kHz' : hz + ' Hz';
