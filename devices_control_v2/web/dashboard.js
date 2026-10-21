'use strict';
// Overview: device counters, live resource charts, system info, problems, history.

const DASH = (() => {
  const POLL_MS = 2000, KEEP = 90;   // 90 samples x 2 s = 3 minutes of history
  const buf = { t: [], cpu: [], mem: [], rx: [], tx: [], dr: [], dw: [] };
  let sys = null, sysLoading = false, history = null, top = [], memTotal = 0, memUsed = 0;
  let timer = null, inflight = false, built = false;

  // ---------------------------------------------------------------- formatting

  function fmtBytes(n, perSec) {
    if (n == null || isNaN(n)) return '—';
    const u = S.lang === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'] : ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i] + (perSec ? (S.lang === 'ru' ? '/с' : '/s') : '');
  }
  function fmtUptime(sec) {
    if (sec == null) return '—';
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    return (d ? `${d} ${t('days')} ` : '') + `${h} ${t('hours')} ${m} ${t('mins')}`;
  }
  const pct = v => v == null ? '—' : Math.round(v) + '%';

  // ---------------------------------------------------------------- line chart (SVG)

  // series: [{ name, color, values }]; values align with buf.t.
  function lineChart(el, series, opts) {
    const W = Math.max(260, Math.floor(el.clientWidth || 520));
    const H = opts.height || 150;
    const m = { l: 44, r: 54, t: 8, b: 20 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = buf.t.length;
    const all = series.flatMap(s => s.values.filter(v => v != null));
    let max = opts.max || Math.max(1, ...all) * 1.15;
    if (!opts.max) { const p = Math.pow(10, Math.floor(Math.log10(max))); max = Math.ceil(max / p) * p; }
    const x = i => m.l + (KEEP <= 1 ? 0 : (i + (KEEP - n)) / (KEEP - 1) * iw);
    const y = v => m.t + ih - (v / max) * ih;

    let g = '';
    for (const f of [0, 0.5, 1]) {
      const yy = y(max * f);
      g += `<line class="${f === 0 ? 'axis-line' : 'grid-line'}" x1="${m.l}" x2="${m.l + iw}" y1="${yy}" y2="${yy}"/>`;
      g += `<text class="tick" x="${m.l - 6}" y="${yy + 3.5}" text-anchor="end">${esc(opts.fmt(max * f, true))}</text>`;
    }
    g += `<text class="tick" x="${m.l}" y="${H - 4}">−3 ${esc(t('mins'))}</text><text class="tick" x="${m.l + iw}" y="${H - 4}" text-anchor="end">${S.lang === 'ru' ? 'сейчас' : 'now'}</text>`;

    for (const s of series) {
      let d = '', started = false;
      s.values.forEach((v, i) => {
        if (v == null) { started = false; return; }
        d += `${started ? 'L' : 'M'}${x(i).toFixed(1)} ${y(Math.min(v, max)).toFixed(1)} `;
        started = true;
      });
      if (!d) continue;
      if (series.length === 1) {
        const firstI = s.values.findIndex(v => v != null);
        g += `<path class="area" style="fill:var(${s.color})" d="${d} L${x(n - 1).toFixed(1)} ${y(0)} L${x(firstI).toFixed(1)} ${y(0)} Z"/>`;
      }
      g += `<path class="line" style="stroke:var(${s.color})" d="${d}"/>`;
      // Direct label at the line end (<= 4 series).
      const last = s.values[n - 1];
      if (last != null) g += `<text class="dlabel" x="${x(n - 1) + 6}" y="${y(Math.min(last, max)) + 4}">${esc(opts.fmt(last))}</text>`;
    }
    g += `<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" style="display:none"/><rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>`;
    el._chart = { series, opts, x, m, iw, n };
  }

  function chartHover(e) {
    const el = e.currentTarget, c = el._chart;
    if (!c || !c.n) return;
    const svg = el.querySelector('svg');
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const off = KEEP - c.n;
    let i = Math.round((px - c.m.l) / c.iw * (KEEP - 1)) - off;
    i = Math.max(0, Math.min(c.n - 1, i));
    const cross = svg.querySelector('.cross');
    cross.setAttribute('x1', c.x(i)); cross.setAttribute('x2', c.x(i)); cross.style.display = '';
    const ago = Math.round((buf.t[c.n - 1] - buf.t[i]) / 1000);
    showTip(`<b>${ago ? ago + ' ' + esc(t('sec')) : (S.lang === 'ru' ? 'сейчас' : 'now')}</b>` +
      c.series.map(s => `<div><span class="sw" style="background:var(${s.color})"></span>${esc(s.name)}: ${esc(c.opts.fmt(s.values[i]))}</div>`).join(''), e.clientX, e.clientY);
  }
  function chartLeave(e) {
    hideTip();
    const cross = e.currentTarget.querySelector('.cross');
    if (cross) cross.style.display = 'none';
  }

  // ---------------------------------------------------------------- skeleton

  function build() {
    const panel = (id, span, titleKey, extra = '') => `<section class="panel ${span}" id="${id}"><h3>${esc(t(titleKey))}${extra}</h3><div class="pb"></div></section>`;
    const chart = (id, titleKey) => `<section class="panel span-6"><div class="chart-head"><h3 style="margin:0">${esc(t(titleKey))}</h3><span class="now" id="${id}Now"></span><span class="unit" id="${id}Unit"></span></div><div class="chart" id="${id}"></div><div class="legend" id="${id}Leg"></div></section>`;
    $('#view-dash').innerHTML = `
      <div class="tiles" id="dTiles" style="margin-bottom:12px"></div>
      <div class="dash">
        ${chart('cCpu', 'dCpu')}
        ${chart('cMem', 'dRam')}
        ${chart('cNet', 'dNet')}
        ${chart('cDisk', 'dDisk')}
        ${panel('pSys', 'span-4', 'dSys')}
        ${panel('pVol', 'span-4', 'dVolumes')}
        ${panel('pTop', 'span-4', 'dTop')}
        ${panel('pGroups', 'span-6', 'dGroups')}
        ${panel('pProblems', 'span-6', 'dProblems')}
        ${panel('pDisabled', 'span-6', 'dDisabledList')}
        ${panel('pHistory', 'span-6', 'dHistory')}
      </div>`;
    for (const id of ['cCpu', 'cMem', 'cNet', 'cDisk']) {
      const el = $('#' + id);
      el.addEventListener('mousemove', chartHover);
      el.addEventListener('mouseleave', chartLeave);
    }
    $('#pGroups').addEventListener('mousemove', e => {
      const row = e.target.closest('[data-grp]');
      if (!row) { hideTip(); return; }
      const key = row.dataset.grp;
      const devs = S.devices.filter(d => d.group === key);
      const c = s => devs.filter(d => d.state === s).length;
      showTip(`<b>${esc(groupName(key))}</b>` + ['ok', 'disabled', 'error', 'disconnected'].map(s =>
        `<div><span class="sw" style="background:var(${STATE_COLOR[s]})"></span>${esc(t('st_' + s))}: ${c(s)}</div>`).join(''), e.clientX, e.clientY);
    });
    $('#pGroups').addEventListener('mouseleave', hideTip);
    built = true;
  }

  const STATE_COLOR = { ok: '--status-good', disabled: '--status-off', error: '--status-critical', disconnected: '--status-none' };

  // ---------------------------------------------------------------- panels

  function renderTiles() {
    const ds = S.devices;
    const c = s => ds.filter(d => d.state === s).length;
    const tile = (label, value, sub, dot, filter) => `<div class="tile${filter ? ' click' : ''}"${filter ? ` data-tile="${filter}"` : ''}>
      <div class="tl">${dot ? `<span class="sdot" style="background:var(${dot})"></span>` : ''}${esc(label)}</div>
      <div class="tv">${value}</div>${sub ? `<div class="ts">${esc(sub)}</div>` : ''}</div>`;
    $('#dTiles').innerHTML = [
      tile(t('dTotal'), ds.length, S.computer, null, ''),
      tile(t('dOk'), c('ok'), '', STATE_COLOR.ok, 'ok'),
      tile(t('dOff'), c('disabled'), '', STATE_COLOR.disabled, 'disabled'),
      tile(t('dErr'), c('error'), '', STATE_COLOR.error, 'error'),
      tile(t('dDisc'), c('disconnected'), '', STATE_COLOR.disconnected, 'disconnected'),
      tile(t('dProg'), ds.filter(d => d.prog && d.state !== 'disconnected').length, '', null, 'prog'),
    ].join('');
  }

  function renderCharts() {
    const cpuNow = buf.cpu[buf.cpu.length - 1];
    const memNow = buf.mem[buf.mem.length - 1];
    $('#cCpuNow').textContent = pct(cpuNow);
    $('#cMemNow').textContent = pct(memNow);
    $('#cMemUnit').textContent = memTotal ? `${fmtBytes(memUsed)} ${t('of')} ${fmtBytes(memTotal)}` : '';
    const lastRx = buf.rx[buf.rx.length - 1], lastTx = buf.tx[buf.tx.length - 1];
    $('#cNetNow').textContent = lastRx == null ? '' : fmtBytes((lastRx || 0) + (lastTx || 0), true);
    const lastR = buf.dr[buf.dr.length - 1], lastW = buf.dw[buf.dw.length - 1];
    $('#cDiskNow').textContent = lastR == null ? '' : fmtBytes((lastR || 0) + (lastW || 0), true);
    for (const id of ['cCpuUnit', 'cNetUnit', 'cDiskUnit']) $('#' + id).textContent = buf.t.length < 2 ? t('dWaiting') : '';

    const pctFmt = (v, axis) => v == null ? '—' : Math.round(v) + '%';
    const bpsFmt = (v, axis) => fmtBytes(v, !axis);
    lineChart($('#cCpu'), [{ name: t('dCpu'), color: '--series-1', values: buf.cpu }], { max: 100, fmt: pctFmt });
    lineChart($('#cMem'), [{ name: t('dRam'), color: '--series-1', values: buf.mem }], { max: 100, fmt: pctFmt });
    lineChart($('#cNet'), [{ name: t('dRx'), color: '--series-1', values: buf.rx }, { name: t('dTx'), color: '--series-2', values: buf.tx }], { fmt: bpsFmt });
    lineChart($('#cDisk'), [{ name: t('dRead'), color: '--series-1', values: buf.dr }, { name: t('dWrite'), color: '--series-2', values: buf.dw }], { fmt: bpsFmt });
    $('#cNetLeg').innerHTML = `<span><i style="background:var(--series-1)"></i>${esc(t('dRx'))}</span><span><i style="background:var(--series-2)"></i>${esc(t('dTx'))}</span>`;
    $('#cDiskLeg').innerHTML = `<span><i style="background:var(--series-1)"></i>${esc(t('dRead'))}</span><span><i style="background:var(--series-2)"></i>${esc(t('dWrite'))}</span>`;
  }

  function renderSys() {
    const el = $('#pSys .pb');
    if (!sys) { el.innerHTML = `<span class="muted"><span class="spin"></span>${esc(t('loading'))}</span>`; return; }
    const row = (k, v) => v ? `<dt>${esc(t(k))}</dt><dd>${esc(v)}</dd>` : '';
    const gpu = (sys.gpus || []).map(g => g.name + (g.ram > 0 ? ` (${fmtBytes(g.ram)})` : '')).join('; ');
    const bat = (sys.battery || []).map(b => `${b.charge}%`).join(', ');
    el.innerHTML = `<dl class="kv">
      ${row('kOs', [sys.os.name, sys.os.build && `build ${sys.os.build}`, sys.os.arch].filter(Boolean).join(' · '))}
      ${row('kPc', [sys.computer.mfr, sys.computer.model].filter(Boolean).join(' '))}
      ${row('kUser', sys.computer.user)}
      ${row('kCpu', sys.cpu.name && `${sys.cpu.name} · ${sys.cpu.cores} ${t('cores')} / ${sys.cpu.threads} ${t('threads')}`)}
      ${row('kRam', sys.memory.total && `${fmtBytes(sys.memory.total)} · ${sys.memory.modules} ${t('modules')}${sys.memory.speed ? ` · ${sys.memory.speed} MT/s` : ''}`)}
      ${row('kGpu', gpu)}
      ${row('kBoard', [sys.board.mfr, sys.board.product].filter(Boolean).join(' '))}
      ${row('kBios', [sys.bios.vendor, sys.bios.version, sys.bios.date].filter(Boolean).join(' · '))}
      ${sys.bios.secureBoot == null ? '' : row('kSecure', t(sys.bios.secureBoot ? 'yes' : 'no'))}
      ${row('kBoot', sys.os.boot)}
      ${row('kUptime', fmtUptime(sys.os.uptime))}
      ${row('kBattery', bat)}
    </dl>`;
  }

  function renderVolumes() {
    const el = $('#pVol .pb');
    if (!sys) { el.innerHTML = ''; return; }
    el.innerHTML = (sys.volumes || []).map(v => {
      const used = v.size ? (v.size - v.free) / v.size : 0;
      return `<div class="meter"><div class="mh"><span>${esc(v.letter)} ${esc(v.label || '')} <span class="muted">${esc(v.fs || '')}</span></span>
        <span class="mv">${esc(fmtBytes(v.free))} ${esc(t('free'))} ${esc(t('of'))} ${esc(fmtBytes(v.size))}</span></div>
        <div class="track"><div class="fill${used > 0.9 ? ' hot' : ''}" style="width:${(used * 100).toFixed(1)}%"></div></div></div>`;
    }).join('') || `<span class="muted">${esc(t('unknown'))}</span>`;
  }

  function renderTop() {
    const el = $('#pTop .pb');
    if (!top.length) { el.innerHTML = `<span class="muted">${esc(t('dWaiting'))}</span>`; return; }
    const max = Math.max(...top.map(p => p.mem));
    el.innerHTML = top.map(p => `<div class="meter"><div class="mh"><span>${esc(p.name)}</span><span class="mv">${esc(fmtBytes(p.mem))}</span></div>
      <div class="track"><div class="fill" style="width:${(p.mem / max * 100).toFixed(1)}%"></div></div></div>`).join('');
  }

  function renderGroups() {
    const rows = GROUPS.map(g => ({ g, devs: S.devices.filter(d => d.group === g.key) })).filter(r => r.devs.length);
    const max = Math.max(1, ...rows.map(r => r.devs.length));
    const order = ['ok', 'disabled', 'error', 'disconnected'];
    $('#pGroups .pb').innerHTML = `<div class="legend" style="margin:0 0 8px">${order.map(s => `<span><i class="box" style="background:var(${STATE_COLOR[s]})"></i>${esc(t('st_' + s))}</span>`).join('')}</div>` +
      rows.map(({ g, devs }) => {
        const segs = order.map(s => [s, devs.filter(d => d.state === s).length]).filter(([, n]) => n);
        return `<div class="hbar-row" data-grp="${g.key}"><span class="hl">${esc(groupName(g.key))}</span>
          <span class="hb" style="width:${(devs.length / max * 100).toFixed(1)}%">${segs.map(([s, n]) => `<span style="flex:${n};background:var(${STATE_COLOR[s]})"></span>`).join('')}</span>
          <span class="hn">${devs.length}</span></div>`;
      }).join('');
  }

  function renderProblems() {
    const errs = S.devices.filter(d => d.state === 'error');
    $('#pProblems .pb').innerHTML = errs.length
      ? `<ul class="mini-list">${errs.map(d => `<li><span class="sdot" style="background:var(--status-critical)"></span>
          <div class="ml"><div class="n1">${esc(d.name)}</div><div class="n2">${esc(stateText(d))} · ${esc(ex(d).func)}</div></div>
          <button class="btn small" data-open="${esc(d.id)}">${esc(t('details'))}</button></li>`).join('')}</ul>`
      : `<span class="muted">${esc(t('dNoProblems'))}</span>`;
  }

  function renderDisabled() {
    const off = S.devices.filter(d => d.state === 'disabled');
    $('#pDisabled .pb').innerHTML = off.length
      ? `<ul class="mini-list">${off.map(d => `<li><span class="sdot" style="background:var(--status-off)"></span>
          <div class="ml"><div class="n1">${esc(d.name)}</div><div class="n2">${esc(ex(d).func)} · ${esc(groupName(d.group))}</div></div>
          <button class="btn small" data-open="${esc(d.id)}">${esc(t('details'))}</button>${actionButton(d, 'small')}</li>`).join('')}</ul>`
      : `<span class="muted">${esc(t('dNoDisabled'))}</span>`;
  }

  // Log lines: "2026-10-20 16:07:42  DISABLE  [name]  id  -> state=disabled code=22 ..."
  //            "2026-10-20 16:07:42  FAILED DISABLE  [name]  id  :: message"
  const LOG_RE = /^(\S+ \S+)\s{2}(FAILED )?(ENABLE|DISABLE)\s{2}\[(.*)\]\s{2}(\S+)\s{2}(?:-> state=(\w+)(?: code=(\d+))?(.*)|:: (.*))$/;

  function renderHistory() {
    const el = $('#pHistory .pb');
    if (!history) { el.innerHTML = `<span class="muted"><span class="spin"></span>${esc(t('loading'))}</span>`; return; }
    const rows = history.map(l => l.match(LOG_RE)).filter(Boolean).reverse();
    if (!rows.length) { el.innerHTML = `<span class="muted">${esc(t('dNoHistory'))}</span>`; return; }
    el.innerHTML = `<div class="hist-wrap"><table class="hist-table"><thead><tr><th>${esc(t('hTime'))}</th><th>${esc(t('hAction'))}</th><th>${esc(t('hDevice'))}</th><th>${esc(t('hResult'))}</th></tr></thead><tbody>${
      rows.map(m => {
        const failed = !!m[2];
        const action = failed ? t('aFailed') : t(m[3] === 'ENABLE' ? 'aEnable' : 'aDisable');
        const dot = failed ? '--status-critical' : m[3] === 'ENABLE' ? '--status-good' : '--status-off';
        const audioDef = (m[8] || '').match(/default=\[(.*)\]/);
        const result = failed ? m[9] : t('st_' + m[6]) + (audioDef && audioDef[1] ? ` · ${S.lang === 'ru' ? 'звук по умолчанию' : 'default audio'}: ${audioDef[1]}` : '');
        const known = S.byId.get(m[5]);
        const name = known ? `<button class="btn link" data-open="${esc(m[5])}">${esc(m[4])}</button>` : esc(m[4]);
        return `<tr><td style="white-space:nowrap">${esc(m[1])}</td><td style="white-space:nowrap"><span class="sdot" style="background:var(${dot})"></span> ${esc(action)}${failed ? ` (${esc(m[3] === 'ENABLE' ? t('enable') : t('disable'))})` : ''}</td><td>${name}</td><td class="muted">${esc(result)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- data

  async function loadSys() {
    if (sysLoading) return;
    sysLoading = true;
    try { const r = await api('/api/sysinfo'); if (r.ok) sys = r; } catch (e) { toast(e.message, 'err'); }
    sysLoading = false;
    if (visible()) { renderSys(); renderVolumes(); }
  }

  async function loadHistory() {
    try { const r = await api('/api/history'); if (r.ok) history = r.log || []; } catch { history = history || []; }
    if (visible()) renderHistory();
  }

  function push(key, v) { buf[key].push(v); if (buf[key].length > KEEP) buf[key].shift(); }

  async function tick() {
    if (!visible()) { stop(); return; }
    if (document.hidden || inflight) return;
    inflight = true;
    try {
      const r = await api('/api/perf');
      if (r.ok) {
        push('t', r.t); push('cpu', r.cpu); push('rx', r.rx); push('tx', r.tx); push('dr', r.diskRead); push('dw', r.diskWrite);
        memTotal = r.memTotal || 0; memUsed = r.memUsed || 0;
        push('mem', memTotal ? memUsed / memTotal * 100 : null);
        top = r.top || [];
        if (visible()) { renderCharts(); renderTop(); }
      }
    } catch { /* server gone - the stop button / toast covers it */ }
    inflight = false;
  }

  function visible() { return S.tab === 'dash' && !S.stopped && built && !$('#view-dash').hidden; }
  function start() { if (!timer) { timer = setInterval(tick, POLL_MS); tick(); } }
  function stop() { clearInterval(timer); timer = null; }

  function render() {
    build();   // rebuilt on every full render so the language switch applies
    if (!S.loaded) { $('#dTiles').innerHTML = `<div class="loading"><span class="spin"></span>${esc(t('loading'))}</div>`; }
    else { renderTiles(); renderGroups(); renderProblems(); renderDisabled(); }
    renderSys(); renderVolumes(); renderTop(); renderHistory(); renderCharts();
    if (!sys) loadSys();
    if (!history) loadHistory();
    start();
  }

  return {
    render,
    refresh() { sys = null; history = null; },
    noteAction() { history = null; },
    bindTiles(handler) { $('#view-dash').addEventListener('click', e => { const tl = e.target.closest('[data-tile]'); if (tl) handler(tl.dataset.tile); }); },
  };
})();
