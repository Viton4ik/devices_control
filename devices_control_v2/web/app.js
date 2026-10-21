'use strict';
// Core: state, API, notices, device list, detail drawer, confirm dialog.

const store = {
  get(k) { try { return localStorage.getItem('dc_' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('dc_' + k, v); } catch {} },
};

const TABS = ['dash', 'map', 'prog', 'other'];
const S = {
  lang: store.get('lang') === 'en' ? 'en' : 'ru',
  tab: TABS.includes(store.get('tab')) ? store.get('tab') : 'dash',
  devices: [], byId: new Map(), kids: new Map(),
  q: '', group: '', state: '', risk: '', showDisc: store.get('disc') === '1',
  noticeOpen: store.get('noticeOpen') !== '0',
  admin: true, rdp: false, native: true, computer: '', stopped: false, loaded: false,
  drawerId: null,
};

const TOKEN = (() => {
  const fromUrl = new URLSearchParams(location.search).get('t');
  if (fromUrl) {
    try { sessionStorage.setItem('dc_token', fromUrl); } catch {}
    history.replaceState(null, '', '/');
    return fromUrl;
  }
  try { return sessionStorage.getItem('dc_token'); } catch { return null; }
})();

const $ = s => document.querySelector(s);
const t = (k, ...a) => { const v = I18N[S.lang][k]; return typeof v === 'function' ? v(...a) : (v ?? k); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const li = () => S.lang === 'ru' ? 0 : 1;
const reasonText = r => (REASONS[r] ? REASONS[r][S.lang] : r);

async function api(path, body) {
  let r;
  try {
    r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': TOKEN || '' }, body: JSON.stringify(body || {}) });
  } catch { throw new Error(t('errNet')); }
  if (r.status === 403) throw new Error(t('errToken'));
  return r.json().catch(() => ({ ok: false, error: 'server', message: 'HTTP ' + r.status }));
}

function errText(res) {
  const k = 'e_' + res.error;
  const known = !!I18N[S.lang][k];
  return (known ? t(k) : t('err') + ': ') + (res.message || (known ? '' : res.error || ''));
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' || kind === 'warn' ? 9000 : 5000);
}

// ------------------------------------------------------------------ tooltip

function showTip(html, x, y) {
  const tip = $('#tooltip');
  tip.innerHTML = html;
  tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
function hideTip() { $('#tooltip').classList.remove('on'); }

// ------------------------------------------------------------------ data

function ingest(devices) {
  S.devices = devices;
  S.byId = new Map(devices.map(d => [d.id, d]));
  S.kids = new Map();
  for (const d of devices) {
    d.group = groupOf(d);
    d._ex = null;
    if (d.parent && S.byId.has(d.parent)) {
      if (!S.kids.has(d.parent)) S.kids.set(d.parent, []);
      S.kids.get(d.parent).push(d.id);
    }
  }
}

function replaceDevice(nd) {
  const old = S.byId.get(nd.id);
  const i = S.devices.indexOf(old);
  nd.group = groupOf(nd);
  nd._ex = null;
  if (i >= 0) S.devices[i] = nd; else S.devices.push(nd);
  S.byId.set(nd.id, nd);
}

function ex(d) {
  if (!d._ex || d._ex.lang !== S.lang) d._ex = { lang: S.lang, v: explain(d) };
  return d._ex.v;
}

function descendantsOf(id, limit = 2000) {
  const out = [];
  const queue = [id];
  const seen = new Set([id]);
  while (queue.length && out.length < limit) {
    for (const k of S.kids.get(queue.shift()) || []) {
      if (!seen.has(k)) { seen.add(k); out.push(k); queue.push(k); }
    }
  }
  return out;
}

async function load() {
  $('#refresh').disabled = true;
  try {
    const res = await api('/api/devices');
    if (!res.ok) throw new Error(errText(res));
    S.admin = !!res.admin; S.rdp = !!res.rdp; S.native = res.native !== false; S.computer = res.computer || '';
    ingest(res.devices || []);
    S.loaded = true;
    renderAll();
  } catch (e) {
    $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    toast(e.message, 'err');
  } finally {
    $('#refresh').disabled = false;
  }
}

// ------------------------------------------------------------------ chrome

function applyStatic() {
  document.documentElement.lang = S.lang;
  document.title = t('title');
  document.querySelectorAll('[data-i]').forEach(el => { el.textContent = t(el.dataset.i); });
  document.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === S.lang));
  document.querySelectorAll('[data-tab]').forEach(b => {
    const on = b.dataset.tab === S.tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
  $('#q').placeholder = t('search');
  $('#fDisc').checked = S.showDisc;
  $('#host').textContent = S.computer;
}

function renderNotices() {
  let h = '';
  if (S.rdp) h += `<div class="notice danger"><b>${esc(t('rdpTitle'))}</b> ${esc(t('rdpText'))}</div>`;
  if (S.loaded && !S.admin) h += `<div class="notice danger"><b>${esc(t('noAdminTitle'))}</b> ${esc(t('noAdminText'))}</div>`;
  const items = I18N[S.lang].noticeItems;
  h += `<div class="notice warn"><div class="nh"><b>⚠ ${esc(t('noticeTitle'))}</b>
    <button class="btn link" data-notice>${esc(t(S.noticeOpen ? 'collapse' : 'expand'))}</button></div>
    ${S.noticeOpen
      ? `<ul>${items.map(([cls, txt]) => `<li class="${cls}">${esc(txt)}</li>`).join('')}</ul>`
      : `<div>${esc(t('noticeShort'))}</div>`}</div>`;
  $('#notices').innerHTML = h;
}

function tabCount(tab) {
  return S.devices.filter(d => ((tab === 'prog') === !!d.prog) && (S.showDisc || d.state !== 'disconnected')).length;
}

function renderAll() {
  if (S.stopped) return;
  applyStatic();
  renderNotices();
  $('#nProg').textContent = S.loaded ? tabCount('prog') : '';
  $('#nOther').textContent = S.loaded ? tabCount('other') : '';
  const view = S.tab === 'prog' || S.tab === 'other' ? 'list' : S.tab;
  for (const v of ['dash', 'map', 'list']) $('#view-' + v).hidden = v !== view;
  if (view === 'list') renderList();
  else if (view === 'map') MAP.render();
  else DASH.render();
  if (S.drawerId) renderDrawer();
}

// ------------------------------------------------------------------ list view

function inTab(d) { return (S.tab === 'prog') === !!d.prog; }
function visibleByDisc(d) { return S.showDisc || d.state !== 'disconnected' || S.state === 'disconnected'; }

function haystack(d) {
  const e = ex(d);
  return [d.name, e.func, d.cls, d.mfr, e.vendor && e.vendor.name, d.id, d.service, ...(d.hwids || []), groupName(d.group)].join(' ').toLowerCase();
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  return S.devices.filter(d => inTab(d) && visibleByDisc(d)
    && (!S.group || d.group === S.group)
    && (!S.state || d.state === S.state)
    && (S.risk === '' || d.risk === +S.risk)
    && (!q || haystack(d).includes(q)));
}

function renderFilters() {
  const pool = S.devices.filter(d => inTab(d) && visibleByDisc(d));
  const groups = GROUPS.filter(g => pool.some(d => d.group === g.key));
  if (S.group && !groups.some(g => g.key === S.group)) S.group = '';
  $('#fGroup').innerHTML = `<option value="">${esc(t('allGroups'))}</option>` +
    groups.map(g => `<option value="${g.key}"${g.key === S.group ? ' selected' : ''}>${esc(groupName(g.key))} (${pool.filter(d => d.group === g.key).length})</option>`).join('');
  $('#fState').innerHTML = `<option value="">${esc(t('allStates'))}</option>` +
    ['ok', 'disabled', 'error', 'disconnected'].map(s => `<option value="${s}"${s === S.state ? ' selected' : ''}>${esc(t('st_' + s))}</option>`).join('');
  $('#fRisk').innerHTML = `<option value="">${esc(t('allRisks'))}</option>` +
    [0, 1, 2, 3].map(r => `<option value="${r}"${String(r) === S.risk ? ' selected' : ''}>${esc(t('risk' + r))}</option>`).join('');
}

function stateText(d) {
  let txt = t('st_' + d.state);
  if (d.state === 'error' && d.code) {
    const p = PROBLEMS[d.code];
    txt += ` (${t('code')} ${d.code}${p ? ': ' + p[li()] : ''})`;
  }
  return txt;
}
function stateBadge(d) { return `<span class="badge st-${d.state}${d.state === 'error' ? ' wrap' : ''}">${esc(stateText(d))}</span>`; }

function hwHtml(list, first = 1) {
  if (!list || !list.length) return esc(t('unknown'));
  const head = list.slice(0, first).map(h => `<div><code>${esc(h)}</code></div>`).join('');
  const rest = list.slice(first);
  return head + (rest.length ? `<details><summary>${esc(t('more', rest.length))}</summary>${rest.map(h => `<div><code>${esc(h)}</code></div>`).join('')}</details>` : '');
}

function explHtml(e) {
  return `<p class="expl">${e.guess ? `<span class="guess">${esc(t('guess'))}</span>` : ''}${esc(e.text)}</p>`;
}

function riskHtml(d) {
  const reasons = (d.reasons || []).map(r => `<li>${esc(reasonText(r))}</li>`).join('');
  return d.risk > 0 || reasons
    ? `<div class="risk"><span class="lvl rl${d.risk}">${esc(t('risk' + d.risk))}</span>${reasons ? `<ul>${reasons}</ul>` : ''}</div>`
    : `<div class="risk muted">${esc(t('risk0'))}</div>`;
}

// One place decides whether the device can be toggled and why not.
function actionInfo(d) {
  const can = S.admin && !S.stopped;
  if (d.state === 'disabled') return { act: 'enable', enabled: can, hint: can ? '' : t('hintReadOnly') };
  if (d.state === 'disconnected') return { act: null, enabled: false, hint: t('hintDisc') };
  if (d.disableable === false) return { act: 'disable', enabled: false, hint: t('hintNotDisableable') };
  return { act: 'disable', enabled: can, hint: can ? '' : t('hintReadOnly') };
}

function actionButton(d, extraClass = '') {
  const a = actionInfo(d);
  if (!a.act) return `<button class="btn ${extraClass}" disabled>${esc(t('disable'))}</button>`;
  const cls = a.act === 'enable' ? 'success' : 'danger';
  return `<button class="btn ${cls} ${extraClass}" data-act="${a.act}" data-id="${esc(d.id)}"${a.enabled ? '' : ' disabled'}>${esc(t(a.act))}</button>`;
}

function card(d) {
  const e = ex(d);
  const a = actionInfo(d);
  const mfr = d.mfr || t('unknown');
  const vendorLine = e.vendor && !(d.mfr || '').toLowerCase().includes(e.vendor.name.split(/[ (/]/)[0].toLowerCase())
    ? `<dt>${esc(t('vendorBy'))}</dt><dd>${esc(e.vendor.name)} <span class="muted">(${esc(e.vendor.by)})</span></dd>` : '';
  return `<article class="card risk${d.risk}">
    <div class="head"><div class="titles"><h3>${esc(d.name)}</h3><div class="func">${esc(e.func)}</div></div>${stateBadge(d)}</div>
    <dl>
      <dt>${esc(t('cls'))}</dt><dd>${esc(d.cls || t('noClass'))}</dd>
      <dt>${esc(t('mfr'))}</dt><dd>${esc(mfr)}</dd>
      ${vendorLine}
      <dt>${esc(t('hwid'))}</dt><dd>${hwHtml(d.hwids)}</dd>
      <dt>${esc(t('inst'))}</dt><dd><code>${esc(d.id)}</code></dd>
    </dl>
    ${explHtml(e)}
    ${e.access ? `<div class="access"><b>${esc(t('access'))}:</b> ${e.access}</div>` : ''}
    ${riskHtml(d)}
    <div class="foot"><span class="hint">${esc(a.hint)}</span><button class="btn small" data-open="${esc(d.id)}">${esc(t('details'))}</button>${actionButton(d)}</div>
  </article>`;
}

function renderList() {
  renderFilters();
  if (!S.loaded) return;
  const list = filtered();
  const pool = S.devices.filter(d => inTab(d) && visibleByDisc(d));
  $('#stats').textContent = [t('shown', list.length, pool.length),
    t('nDisabled', list.filter(d => d.state === 'disabled').length),
    t('nError', list.filter(d => d.state === 'error').length)].join(' · ');

  if (!list.length) { $('#list').innerHTML = `<div class="empty">${esc(t('empty'))}</div>`; return; }

  const groups = new Map();
  for (const d of list) {
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group).push(d);
  }
  const keys = [...groups.keys()].sort((a, b) => (GROUP_BY_KEY[a]?.order ?? 99) - (GROUP_BY_KEY[b]?.order ?? 99));
  $('#list').innerHTML = keys.map(k => {
    const items = groups.get(k).sort((a, b) => a.name.localeCompare(b.name));
    return `<section class="group"><h2>${esc(groupName(k))} · ${items.length}</h2><p class="gdesc">${esc(groupDesc(k))}</p><div class="grid">${items.map(card).join('')}</div></section>`;
  }).join('');
}

// ------------------------------------------------------------------ drawer (device detail)

function openDrawer(id) {
  if (!S.byId.has(id)) return;
  S.drawerId = id;
  renderDrawer();
  $('#drawer').classList.add('on');
  $('#drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  S.drawerId = null;
  $('#drawer').classList.remove('on');
  $('#drawer').setAttribute('aria-hidden', 'true');
}

function devLink(d) {
  return `<button class="btn link" data-open="${esc(d.id)}">${esc(d.name)}</button> <span class="muted">· ${esc(ex(d).func)} · ${esc(t('st_' + d.state))}</span>`;
}

function renderDrawer() {
  const d = S.byId.get(S.drawerId);
  if (!d) { closeDrawer(); return; }
  const e = ex(d);
  const a = actionInfo(d);
  const parent = d.parent && S.byId.get(d.parent);
  const kids = (S.kids.get(d.id) || []).map(k => S.byId.get(k)).filter(Boolean);
  const desc = descendantsOf(d.id);
  const drv = d.drv;

  $('#drawerCrumb').textContent = `${groupName(d.group)} › ${d.name}`;
  $('#drawerBody').innerHTML = `
    <div><h2>${esc(d.name)}</h2><div class="func">${esc(e.func)}</div></div>
    <div>${stateBadge(d)}</div>
    ${explHtml(e)}
    ${e.access ? `<div class="access"><b>${esc(t('access'))}:</b> ${e.access}</div>` : ''}
    ${riskHtml(d)}
    <div class="foot" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${actionButton(d)}
      <button class="btn" data-locate="${esc(d.id)}">${esc(t('showInTree'))}</button>
      <span class="muted" style="font-size:12px">${esc(a.hint)}</span>
    </div>
    <dl>
      <dt>${esc(t('func'))}</dt><dd>${esc(groupName(d.group))}</dd>
      <dt>${esc(t('cls'))}</dt><dd>${esc(d.cls || t('noClass'))}</dd>
      <dt>${esc(t('mfr'))}</dt><dd>${esc(d.mfr || t('unknown'))}</dd>
      ${e.vendor ? `<dt>${esc(t('vendorBy'))}</dt><dd>${esc(e.vendor.name)} <span class="muted">(${esc(e.vendor.by)})</span></dd>` : ''}
      ${d.service ? `<dt>${esc(t('service'))}</dt><dd>${esc(d.service)}</dd>` : ''}
      ${drv && drv.ver ? `<dt>${esc(t('driver'))}</dt><dd>${esc([drv.provider, drv.ver, drv.date, drv.inf].filter(Boolean).join(' · '))}</dd>` : ''}
      ${d.net ? `<dt>Net</dt><dd>${esc(d.net)}</dd>` : ''}
      <dt>${esc(t('inst'))}</dt><dd><code>${esc(d.id)}</code></dd>
      <dt>${esc(t('hwid'))}</dt><dd>${hwHtml(d.hwids, 3)}</dd>
      <dt>${esc(t('compat'))}</dt><dd>${hwHtml(d.compat, 2)}</dd>
    </dl>
    <div><h4>${esc(t('parent'))}</h4><div class="rel">${parent ? devLink(parent) : `<span class="muted">${esc(t('unknown'))}</span>`}</div></div>
    <div><h4>${esc(t('children'))} · ${desc.length}</h4><div class="rel">${kids.length ? kids.slice(0, 40).map(k => `<div>${devLink(k)}</div>`).join('') : `<span class="muted">${esc(t('unknown'))}</span>`}</div></div>`;
}

// ------------------------------------------------------------------ confirm dialog

let modalToken = 0;

function closeModal() { modalToken++; $('#modalBg').classList.remove('on'); }

function openConfirm(d, action) {
  const my = ++modalToken;
  const m = $('#modal');
  const isDisable = action === 'disable';
  const baseWarns = (d.reasons || []).map(r => ({ r, crit: !!(REASONS[r] && REASONS[r].crit) }));
  const needTyped0 = isDisable && d.risk >= 3;

  const draw = (impact, loading) => {
    if (my !== modalToken) return;
    const warns = [...baseWarns];
    const extra = [];
    if (impact) {
      for (const r of impact.reasons || []) if (!warns.some(w => w.r === r)) warns.push({ r, crit: !!(REASONS[r] && REASONS[r].crit) });
      for (const g of ['input', 'storage', 'net', 'display', 'audio']) {
        const names = (impact.children && impact.children[g]) || [];
        if (names.length) extra.push(`${t('ch_' + g)}: ${names.join(', ')}`);
      }
    }
    const blocked = isDisable && impact && (impact.reasons || []).includes('notDisableable');
    const strong = isDisable && (needTyped0 || warns.some(w => w.crit));
    const needAck = isDisable && !strong && d.risk >= 1;

    let body = '';
    if (isDisable) {
      body += warns.length
        ? `<ul class="warns">${warns.map(w => `<li class="${w.crit ? 'crit' : ''}">${esc(reasonText(w.r))}</li>`).join('')}${extra.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
        : (loading ? '' : `<p>${esc(t('noWarns'))}</p>`);
      if (loading) body += `<p><span class="spin"></span>${esc(t('checking'))}</p>`;
      else if (impact && impact.descendants) body += `<p class="sub">${esc(t('descendants', impact.descendants))}</p>`;
      if (blocked) body += `<p style="color:var(--danger);font-weight:600">${esc(t('cantDisable'))}</p>`;
      if (!loading && !blocked && strong) body += `<div class="typed"><label>${esc(t('typeWord', t('word')))}<input id="typed" autocomplete="off"></label></div>`;
      if (!loading && !blocked && needAck) body += `<label class="chk" style="margin-top:10px;align-items:flex-start"><input type="checkbox" id="ack"><span>${esc(t('ack'))}</span></label>`;
    } else {
      body += `<p>${esc(t('enableNote'))}</p>`;
    }

    m.innerHTML = `
      <h2>${esc(t(isDisable ? 'confirmDisable' : 'confirmEnable'))}</h2>
      <div class="dev">${esc(d.name)}</div>
      <div class="sub">${esc(ex(d).func)} · ${esc(d.cls || t('noClass'))} · ${esc(d.id)}</div>
      ${body}
      <div class="actions">
        <button class="btn" id="mCancel">${esc(t('cancel'))}</button>
        <button class="btn ${isDisable ? 'danger' : 'success'} solid" id="mOk" disabled>${esc(t(isDisable ? 'doDisable' : 'doEnable'))}</button>
      </div>`;

    const ok = $('#mOk');
    const update = () => {
      let allowed = !loading && !blocked;
      if (allowed && strong) allowed = ($('#typed')?.value || '').trim().toUpperCase() === t('word');
      if (allowed && needAck) allowed = !!$('#ack')?.checked;
      ok.disabled = !allowed;
    };
    $('#typed')?.addEventListener('input', update);
    $('#ack')?.addEventListener('change', update);
    $('#mCancel').onclick = closeModal;
    ok.onclick = () => doAction(d, action, strong, my);
    update();
    ($('#typed') || $('#mCancel')).focus();
  };

  $('#modalBg').classList.add('on');
  draw(null, isDisable);
  if (isDisable) {
    api('/api/impact', { id: d.id })
      .then(res => draw(res.ok ? res : null, false))
      .catch(e => { toast(e.message, 'err'); draw(null, false); });
  }
}

async function doAction(d, action, force, my) {
  const ok = $('#mOk');
  ok.disabled = true; $('#mCancel').disabled = true;
  ok.innerHTML = `<span class="spin"></span>${esc(t('working'))}`;
  try {
    const res = await api('/api/set', { id: d.id, action, force });
    if (!res.ok) { toast(errText(res), 'err'); return; }
    if (res.device) replaceDevice(res.device);
    toast(t(action === 'disable' ? 'okDisabled' : 'okEnabled', d.name), 'ok');
    if (res.audio) {
      if (action === 'disable' && res.audio.state === 1) toast(t('audioStill'), 'warn');
      else if (action === 'disable' && res.audio.defaultName && !res.audio.isDefault) toast(t('audioNowDefault', res.audio.defaultName), 'warn');
      else if (action === 'disable' && !res.audio.defaultName) toast(t('audioNoDefault'), 'warn');
    }
    if (res.pnpWarning) toast(t('pnpWarn', res.pnpWarning), 'warn');
    else if (res.needsRestart) toast(t('restart'), 'warn');
    DASH.noteAction();
    renderAll();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    if (my === modalToken) closeModal();
  }
}
