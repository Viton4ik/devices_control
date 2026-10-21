'use strict';
// "PC map": an illustrated PC whose parts are hot zones (one per functional group),
// and a drill-down tree of the devices in a zone, with dependants highlighted on hover.

const MAP = (() => {
  let zone = null;          // functional group key shown as a tree, or null for the PC picture
  let pendingLocate = null; // device id to scroll to after the tree renders
  let touchMode = false;    // last interaction was a tap: browsers then fire emulated mouse events we must ignore

  const STATUS_VAR = { ok: '--status-good', disabled: '--status-off', error: '--status-critical', disconnected: '--status-none' };

  // ---------------------------------------------------------------- PC illustration
  // Each part: [zone key, highlight box x,y,w,h, inner SVG]. A zone may have several parts.
  const P = (zone, x, y, w, h, art) => ({ zone, x, y, w, h, art });

  const keys = (x, y) => {
    let s = '';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 13; c++) s += `<rect class="m-key" x="${x + 8 + c * 24}" y="${y + 8 + r * 16}" width="20" height="12" rx="2"/>`;
    return s + `<rect class="m-key" x="${x + 80}" y="${y + 8 + 4 * 16}" width="150" height="10" rx="2"/>`;
  };
  const speaker = (x) => `<rect class="m-dark" x="${x}" y="150" width="55" height="150" rx="8"/><circle class="m-cone" cx="${x + 27.5}" cy="190" r="14"/><circle class="m-cone" cx="${x + 27.5}" cy="255" r="20"/><circle class="m-dark" cx="${x + 27.5}" cy="255" r="6"/>`;

  const PARTS = [
    // monitor (display) with the Windows desktop inside (software devices)
    P('display', 92, 24, 416, 318, `<rect class="m-dark" x="100" y="30" width="400" height="258" rx="10"/><rect class="m-dark" x="276" y="288" width="48" height="40"/><rect class="m-dark" x="220" y="326" width="160" height="10" rx="4"/>`),
    P('software', 114, 54, 372, 220, `<rect class="m-screen" x="114" y="54" width="372" height="220" rx="3"/>
      <rect class="m-win" x="140" y="80" width="150" height="96" rx="4"/><rect class="m-winbar" x="140" y="80" width="150" height="14" rx="4"/>
      <rect class="m-win" x="250" y="130" width="170" height="110" rx="4"/><rect class="m-winbar" x="250" y="130" width="170" height="14" rx="4"/>
      <rect class="m-task" x="114" y="258" width="372" height="16"/><rect class="m-start" x="292" y="261" width="16" height="10" rx="2"/>`),
    P('camera', 280, 30, 40, 22, `<rect class="m-cam" x="286" y="33" width="28" height="15" rx="7"/><circle class="m-lens" cx="300" cy="40.5" r="4.5"/>`),
    P('audio', 24, 144, 67, 162, speaker(30)),
    P('audio', 509, 144, 67, 162, speaker(515)),
    P('input', 104, 364, 342, 104, `<rect class="m-case" x="110" y="370" width="330" height="92" rx="8"/>${keys(110, 370)}`),
    P('input', 462, 370, 56, 84, `<ellipse class="m-case" cx="490" cy="412" rx="24" ry="38"/><line class="m-line" x1="490" y1="378" x2="490" y2="404"/>`),
    P('input', 352, 524, 106, 72, `<path class="m-case" d="M372 540 h66 a20 20 0 0 1 18 26 l-6 18 a10 10 0 0 1 -16 4 l-10 -10 h-38 l-10 10 a10 10 0 0 1 -16 -4 l-6 -18 a20 20 0 0 1 18 -26 z"/><circle class="m-key" cx="384" cy="558" r="6"/><circle class="m-key" cx="426" cy="552" r="4"/><circle class="m-key" cx="436" cy="562" r="4"/>`),
    P('bluetooth', 24, 364, 76, 100, `<path class="m-line-thick" d="M36 420 v-16 a26 26 0 0 1 52 0 v16"/><rect class="m-dark" x="30" y="414" width="16" height="30" rx="6"/><rect class="m-dark" x="78" y="414" width="16" height="30" rx="6"/><path class="m-bt" d="M56 430 l12 10 l-6 5 v-22 l6 5 l-12 10"/>`),
    P('print', 24, 494, 142, 112, `<rect class="m-case" x="50" y="500" width="90" height="26" rx="3"/><rect class="m-dark" x="30" y="524" width="130" height="56" rx="8"/><rect class="m-paper" x="54" y="568" width="82" height="34" rx="2"/><circle class="m-led" cx="146" cy="538" r="4"/>`),
    P('portable', 186, 494, 58, 108, `<rect class="m-dark" x="190" y="498" width="50" height="100" rx="9"/><rect class="m-screen" x="195" y="508" width="40" height="76" rx="3"/>`),
    P('storage', 262, 532, 80, 44, `<rect class="m-dark" x="268" y="540" width="52" height="28" rx="5"/><rect class="m-port" x="320" y="546" width="16" height="16" rx="1"/>`),
    P('comm', 472, 494, 122, 96, `<rect class="m-pcb" x="478" y="500" width="110" height="82" rx="5"/><rect class="m-chip" x="520" y="526" width="34" height="24" rx="2"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect class="m-pin" x="${486 + i * 12}" y="504" width="6" height="6"/>`).join('')}<rect class="m-port" x="478" y="556" width="18" height="16" rx="2"/><text class="m-txt" x="560" y="575">COM</text>`),

    // tower
    P('usb', 690, 94, 46, 84, [0, 1, 2, 3].map(i => `<rect class="m-port" x="696" y="${100 + i * 19}" width="34" height="12" rx="2"/><rect class="m-portin" x="700" y="${103 + i * 19}" width="26" height="4"/>`).join('')),
    P('net', 690, 184, 46, 36, `<rect class="m-port" x="696" y="190" width="34" height="24" rx="2"/><rect class="m-portin" x="704" y="196" width="18" height="12"/>`),
    P('audio', 690, 226, 46, 70, `<circle class="m-jack-g" cx="713" cy="240" r="8"/><circle class="m-jack-p" cx="713" cy="261" r="8"/><circle class="m-jack-b" cx="713" cy="282" r="8"/>`),
    P('comm', 690, 302, 46, 30, `<path class="m-port" d="M696 308 h34 l-4 18 h-26 z"/>${[0, 1, 2, 3].map(i => `<circle class="m-portin" cx="${704 + i * 6}" cy="315" r="1.6"/>`).join('')}`),
    P('net', 1000, 0, 60, 30, `<rect class="m-dark" x="1012" y="0" width="7" height="28" rx="3"/><rect class="m-dark" x="1040" y="0" width="7" height="28" rx="3"/>`),
    P('cpu', 772, 82, 106, 106, `<rect class="m-chip" x="780" y="90" width="90" height="90" rx="6"/><rect class="m-chip-in" x="796" y="106" width="58" height="58" rx="4"/><text class="m-txt m-txt-c" x="825" y="140">CPU</text>`),
    P('storage', 784, 204, 132, 30, `<rect class="m-dark" x="790" y="210" width="120" height="18" rx="2"/><rect class="m-chip" x="812" y="213" width="30" height="12"/><rect class="m-chip" x="848" y="213" width="30" height="12"/><text class="m-txt" x="884" y="223">M.2</text>`),
    P('display', 694, 244, 262, 58, `<rect class="m-dark" x="700" y="250" width="250" height="46" rx="5"/><circle class="m-fan" cx="770" cy="273" r="18"/><circle class="m-fan" cx="880" cy="273" r="18"/><rect class="m-gold" x="720" y="296" width="140" height="5"/>`),
    P('net', 754, 314, 66, 36, `<rect class="m-chip" x="760" y="320" width="56" height="24" rx="3"/><text class="m-txt" x="767" y="336">Wi-Fi</text>`),
    P('bluetooth', 820, 314, 36, 36, `<rect class="m-chip" x="824" y="320" width="28" height="24" rx="3"/><path class="m-bt" d="M832 326 l10 8 l-5 4 v-16 l5 4 l-10 8"/>`),
    P('board', 832, 362, 76, 66, `<rect class="m-chip" x="840" y="370" width="60" height="50" rx="4"/><rect class="m-chip-in" x="852" y="380" width="36" height="30" rx="2"/><text class="m-txt m-txt-c m-txt-b" x="870" y="436">PCH</text>`),
    P('board', 752, 462, 44, 32, `<rect class="m-chip" x="758" y="468" width="32" height="20" rx="2"/><text class="m-txt m-txt-b" x="757" y="502">BIOS</text>`),
    P('security', 694, 462, 52, 34, `<rect class="m-chip" x="700" y="468" width="40" height="22" rx="2"/><text class="m-txt" x="706" y="483">TPM</text>`),
    P('sensors', 914, 462, 46, 44, `<rect class="m-chip" x="922" y="470" width="30" height="30" rx="4"/><path class="m-line" d="M930 478 q7 7 0 14 M937 474 q11 11 0 22"/>`),
    P('usb', 1032, 52, 40, 70, [0, 1, 2].map(i => `<rect class="m-port" x="1040" y="${60 + i * 18}" width="24" height="10" rx="2"/>`).join('') + `<rect class="m-port" x="1044" y="114" width="16" height="6" rx="3"/>`),
    P('storage', 994, 374, 72, 132, `<rect class="m-dark" x="1000" y="380" width="60" height="120" rx="4"/><rect class="m-drive" x="1006" y="390" width="48" height="44" rx="3"/><rect class="m-drive" x="1006" y="444" width="48" height="44" rx="3"/>`),
    P('power', 674, 544, 312, 82, `<rect class="m-dark" x="680" y="550" width="300" height="70" rx="6"/><circle class="m-fan" cx="760" cy="585" r="26"/><text class="m-txt m-txt-light" x="820" y="590">PSU / Battery</text>`),
    P('other', 994, 536, 72, 72, `<rect class="m-case-2" x="1000" y="542" width="60" height="60" rx="8"/><text class="m-q" x="1030" y="583">?</text>`),
  ];

  const RAM = `<g class="ram" data-ram>${[0, 1, 2, 3].map(i => `<rect class="m-ram" x="${896 + i * 16}" y="80" width="10" height="130" rx="2"/>`).join('')}<rect x="890" y="74" width="66" height="142" fill="transparent"/></g>`;

  function zoneStats(key) {
    const devs = S.devices.filter(d => d.group === key && (S.showDisc || d.state !== 'disconnected'));
    return {
      devs,
      prog: devs.filter(d => d.prog).length,
      err: devs.filter(d => d.state === 'error').length,
      off: devs.filter(d => d.state === 'disabled').length,
    };
  }

  function renderPicture() {
    const stats = Object.fromEntries(GROUPS.map(g => [g.key, zoneStats(g.key)]));
    const firstPart = {};
    const parts = PARTS.map((p, i) => {
      const g = GROUP_BY_KEY[p.zone];
      const st = stats[p.zone];
      if (!(p.zone in firstPart)) firstPart[p.zone] = i;
      const cls = ['zone', g.prog ? 'prog' : 'sys', st.devs.length ? '' : 'empty'].join(' ');
      return `<g class="${cls}" data-zone="${p.zone}">${p.art}<rect class="hl" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8"/></g>`;
    }).join('');

    // One count badge per zone, on its first part.
    const badges = Object.entries(firstPart).map(([key, i]) => {
      const p = PARTS[i];
      const st = stats[key];
      if (!st.devs.length) return '';
      const fill = st.err ? 'var(--status-critical)' : GROUP_BY_KEY[key].prog ? 'var(--accent)' : 'var(--faint)';
      const cx = p.x + p.w - 4, cy = p.y + 4;
      const n = st.devs.length;
      const r = n > 99 ? 13 : 11;
      return `<g class="badge-g" pointer-events="none"><circle cx="${cx}" cy="${cy}" r="${r}" style="fill:${fill};stroke:var(--panel);stroke-width:2"/><text class="cnt" x="${cx}" y="${cy + 4}" text-anchor="middle">${n}</text>${st.off ? `<circle cx="${cx - r - 4}" cy="${cy}" r="5" style="fill:var(--status-off);stroke:var(--panel);stroke-width:1.5"/>` : ''}</g>`;
    }).join('');

    $('#view-map').innerHTML = `
      <div class="map-head">
        <div class="crumbs"><span class="cur">${esc(t('mapRoot'))}${S.computer ? ' ' + esc(S.computer) : ''}</span></div>
        <div class="map-legend">
          <span><i style="background:var(--accent)"></i>${esc(t('legProg'))}</span>
          <span><i style="background:var(--faint)"></i>${esc(t('legSys'))}</span>
          <span><i style="background:var(--status-critical)"></i>${esc(t('legErr'))}</span>
          <span><i style="background:var(--status-off);border-radius:50%;width:10px"></i>${esc(t('legOff'))}</span>
        </div>
      </div>
      <div class="map-wrap">
        <svg class="map-svg" viewBox="0 0 1100 640" role="img" aria-label="${esc(t('tabMap'))}">
          <rect class="m-case" x="640" y="20" width="440" height="616" rx="14"/>
          <rect class="m-board" x="680" y="60" width="300" height="470" rx="6"/>
          <path class="m-trace" d="M736 140 H780 M870 135 H890 M825 180 V250 M825 296 V320 M870 344 V370 M790 420 H840 M740 480 H758 M900 395 H950 V470"/>
          ${RAM}
          ${parts}
          ${badges}
        </svg>
      </div>
      <p class="map-hint">${esc(t('mapHint'))}</p>`;
  }

  function zoneTip(key) {
    const st = zoneStats(key);
    const top = st.devs.slice().sort((a, b) => (b.state === 'error') - (a.state === 'error') || a.name.localeCompare(b.name)).slice(0, 6);
    if (!st.devs.length) return `<b>${esc(groupName(key))}</b><div class="tl">${esc(t('zoneEmpty'))}</div>`;
    return `<b>${esc(groupName(key))}</b><div class="tl">${esc(groupDesc(key))}</div>
      <div style="margin-top:4px">${esc(t('zoneDevices', st.devs.length))} · ${esc(t('zoneProg', st.prog))}${st.err ? ' · ' + esc(t('zoneErr', st.err)) : ''}${st.off ? ' · ' + esc(t('zoneOff', st.off)) : ''}</div>
      <div style="margin-top:4px">${top.map(d => `<div><span class="sw" style="background:var(${STATUS_VAR[d.state]})"></span>${esc(d.name)}</div>`).join('')}${st.devs.length > top.length ? `<div class="tl">${esc(t('more', st.devs.length - top.length))}</div>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- zone tree

  const NODE_W = 236, NODE_H = 40, COL_W = 290, ROW_H = 48, PAD = 14, MAX_NODES = 320;

  function shorten(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function buildTree(key) {
    const visible = d => S.showDisc || d.state !== 'disconnected';
    const base = S.devices.filter(d => d.group === key && visible(d));
    const inSet = new Map();           // id -> 'base' | 'desc' | 'ctx'
    for (const d of base) inSet.set(d.id, 'base');
    for (const d of base) {
      for (const k of descendantsOf(d.id, 400)) {
        const kd = S.byId.get(k);
        if (kd && visible(kd) && !inSet.has(k)) inSet.set(k, 'desc');
      }
    }
    // Up to two ancestors outside the group, for context.
    for (const d of base) {
      let p = d.parent, hops = 0;
      while (p && hops < 2 && S.byId.has(p) && !inSet.has(p)) { inSet.set(p, 'ctx'); p = S.byId.get(p).parent; hops++; }
    }
    let ids = [...inSet.keys()];
    let truncated = false;
    if (ids.length > MAX_NODES) { ids = ids.slice(0, MAX_NODES); truncated = true; }
    const set = new Set(ids);

    const children = new Map();
    const roots = [];
    for (const id of ids) {
      const p = S.byId.get(id).parent;
      if (p && set.has(p)) {
        if (!children.has(p)) children.set(p, []);
        children.get(p).push(id);
      } else roots.push(id);
    }
    const byName = (a, b) => S.byId.get(a).name.localeCompare(S.byId.get(b).name);
    roots.sort(byName);
    for (const c of children.values()) c.sort(byName);

    // Tidy left-to-right layout: leaves stacked, parents centred on their children.
    const pos = new Map();
    let row = 0, maxDepth = 0;
    const place = (id, depth) => {
      maxDepth = Math.max(maxDepth, depth);
      const kids = children.get(id) || [];
      let y;
      if (!kids.length) y = row++;
      else {
        const ys = kids.map(k => place(k, depth + 1));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      pos.set(id, { x: depth, y });
      return y;
    };
    const rootYs = roots.map(r => place(r, 1));
    const virtualY = rootYs.length ? (rootYs[0] + rootYs[rootYs.length - 1]) / 2 : 0;
    return { ids, kind: inSet, children, roots, pos, rows: Math.max(row, 1), maxDepth, virtualY, truncated, baseCount: base.length };
  }

  function nodeXY(p) { return { x: PAD + p.x * COL_W, y: PAD + p.y * ROW_H }; }

  function renderTree() {
    const key = zone;
    const st = zoneStats(key);
    const tree = buildTree(key);
    const W = PAD * 2 + (tree.maxDepth + 1) * COL_W - (COL_W - NODE_W);
    const H = PAD * 2 + tree.rows * ROW_H - (ROW_H - NODE_H);

    const vroot = { x: PAD, y: PAD + tree.virtualY * ROW_H };
    let edges = '', nodes = '';
    const edge = (x1, y1, x2, y2, child) => {
      const mx = (x1 + x2) / 2;
      return `<path class="edge" data-child="${esc(child)}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`;
    };
    for (const r of tree.roots) {
      const c = nodeXY(tree.pos.get(r));
      edges += edge(vroot.x + NODE_W, vroot.y + NODE_H / 2, c.x, c.y + NODE_H / 2, r);
    }
    for (const [p, kids] of tree.children) {
      const a = nodeXY(tree.pos.get(p));
      for (const k of kids) {
        const b = nodeXY(tree.pos.get(k));
        edges += edge(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2, k);
      }
    }
    for (const id of tree.ids) {
      const d = S.byId.get(id);
      const { x, y } = nodeXY(tree.pos.get(id));
      const kind = tree.kind.get(id);
      const cls = ['node', d.prog && d.state !== 'disconnected' ? 'prog' : '', kind === 'ctx' ? 'ctx' : ''].join(' ');
      nodes += `<g class="${cls}" data-node="${esc(id)}" transform="translate(${x},${y})">
        <rect width="${NODE_W}" height="${NODE_H}" rx="7"/>
        <circle class="dot" cx="13" cy="${NODE_H / 2}" r="5.5" style="fill:var(${STATUS_VAR[d.state]})"/>
        <text class="t1" x="26" y="16">${esc(shorten(d.name, 29))}</text>
        <text class="t2" x="26" y="31">${esc(shorten(ex(d).func, 36))}</text>
      </g>`;
    }
    nodes += `<g class="node rootv" transform="translate(${vroot.x},${vroot.y})"><rect width="${NODE_W}" height="${NODE_H}" rx="7"/><text class="t1" x="12" y="16">${esc(shorten(groupName(key), 34))}</text><text class="t2" x="12" y="31">${esc(t('zoneDevices', st.devs.length))}</text></g>`;

    $('#view-map').innerHTML = `
      <div class="map-head">
        <div class="crumbs"><button data-map-root>${esc(t('mapRoot'))}</button><span>›</span><span class="cur">${esc(groupName(key))}</span></div>
        <div class="map-legend">
          <span><i style="background:var(--status-good)"></i>${esc(t('st_ok'))}</span>
          <span><i style="background:var(--status-off)"></i>${esc(t('st_disabled'))}</span>
          <span><i style="background:var(--status-critical)"></i>${esc(t('st_error'))}</span>
          <span><i style="background:transparent;border:2px solid var(--accent)"></i>${esc(t('legProg'))}</span>
        </div>
      </div>
      <p class="zone-summary"><span>${esc(groupDesc(key))}</span><span>${esc(t('zoneDevices', st.devs.length))} · ${esc(t('zoneProg', st.prog))}${st.err ? ' · ' + esc(t('zoneErr', st.err)) : ''}${st.off ? ' · ' + esc(t('zoneOff', st.off)) : ''}</span>${tree.truncated ? `<span>${esc(t('treeTrunc', MAX_NODES))}</span>` : ''}</p>
      <div class="tree-wrap" id="treeWrap">
        ${st.devs.length
          ? `<svg class="tree-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${edges}${nodes}</svg>`
          : `<div class="empty">${esc(t('zoneEmpty'))}</div>`}
      </div>
      <p class="map-hint">${esc(t('mapTreeHint'))}</p>`;

    if (pendingLocate) {
      const el = document.querySelector(`[data-node="${CSS.escape(pendingLocate)}"]`);
      if (el) {
        el.classList.add('hit');
        const wrap = $('#treeWrap');
        const m = el.getCTM();
        if (m) { wrap.scrollLeft = Math.max(0, m.e - 60); wrap.scrollTop = Math.max(0, m.f - wrap.clientHeight / 2); }
      }
      pendingLocate = null;
    }
  }

  function highlightSubtree(id, on) {
    const svg = document.querySelector('.tree-svg');
    if (!svg) return;
    svg.querySelectorAll('.hit, .hit-sub').forEach(el => el.classList.remove('hit', 'hit-sub'));
    if (!on) return;
    svg.querySelector(`[data-node="${CSS.escape(id)}"]`)?.classList.add('hit');
    for (const k of descendantsOf(id)) {
      svg.querySelector(`[data-node="${CSS.escape(k)}"]`)?.classList.add('hit-sub');
      svg.querySelector(`.edge[data-child="${CSS.escape(k)}"]`)?.classList.add('hit-sub');
    }
  }

  function nodeTip(d) {
    const n = descendantsOf(d.id).length;
    return `<b>${esc(d.name)}</b><div class="tl">${esc(ex(d).func)} · ${esc(d.cls || t('noClass'))}</div>
      <div><span class="sw" style="background:var(${STATUS_VAR[d.state]})"></span>${esc(stateText(d))}</div>
      <div>${esc(t('impactHover', n))}</div>`;
  }

  // ---------------------------------------------------------------- events (delegated once)

  function bind() {
    const root = $('#view-map');
    root.addEventListener('mousemove', e => {
      if (Date.now() - lastTouchAt < 800) return;   // emulated mouse events after a tap
      touchMode = false;
      const z = e.target.closest('[data-zone]');
      const ram = e.target.closest('[data-ram]');
      const n = e.target.closest('[data-node]');
      if (z) {
        const key = z.dataset.zone;
        root.querySelectorAll('.zone.hover').forEach(el => { if (el.dataset.zone !== key) el.classList.remove('hover'); });
        root.querySelectorAll(`.zone[data-zone="${key}"]`).forEach(el => el.classList.add('hover'));
        showTip(zoneTip(key), e.clientX, e.clientY);
      } else if (ram) {
        root.querySelectorAll('.zone.hover').forEach(el => el.classList.remove('hover'));
        showTip(`<b>RAM</b><div class="tl">${esc(t('memDecor'))}</div>`, e.clientX, e.clientY);
      } else if (n) {
        const d = S.byId.get(n.dataset.node);
        if (d) { showTip(nodeTip(d), e.clientX, e.clientY); if (!n.classList.contains('hit')) highlightSubtree(d.id, true); }
      } else {
        root.querySelectorAll('.zone.hover').forEach(el => el.classList.remove('hover'));
        if (document.querySelector('.tree-svg .hit')) highlightSubtree(null, false);
        hideTip();
      }
    });
    root.addEventListener('mouseleave', () => { if (touchMode || Date.now() - lastTouchAt < 800) return; hideTip(); highlightSubtree(null, false); });
    root.addEventListener('click', e => {
      const touch = isTouch(e);
      touchMode = touch;
      const z = e.target.closest('[data-zone]');
      if (z && !z.classList.contains('empty')) {
        const key = z.dataset.zone;
        if (touch) {
          // First tap shows what is there (no hover on a phone), the sheet button opens it.
          root.querySelectorAll('.zone.hover').forEach(el => el.classList.remove('hover'));
          root.querySelectorAll(`.zone[data-zone="${key}"]`).forEach(el => el.classList.add('hover'));
          root.querySelector('.map-wrap')?.scrollIntoView({ block: 'start', behavior: 'smooth' });   // keep the picture above the sheet
          showSheet(zoneTip(key), [{ label: t('shOpen'), cls: 'primary', onClick: () => { hideSheet(); zone = key; render(); } }, { label: t('shClose'), onClick: hideSheet }]);
          return;
        }
        zone = key; hideTip(); render(); return;
      }
      if (e.target.closest('[data-map-root]')) { hideSheet(); zone = null; render(); return; }
      const n = e.target.closest('[data-node]');
      if (n) {
        const d = S.byId.get(n.dataset.node);
        if (touch && d) {
          // The red subtree is the whole point of the tree, so a tap must show it.
          highlightSubtree(d.id, true);
          const wrap = $('#treeWrap');
          if (wrap) {
            wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });   // keep the tree above the sheet
            const m = n.getCTM();
            if (m) { wrap.scrollLeft = Math.max(0, m.e - 24); wrap.scrollTop = Math.max(0, m.f - wrap.clientHeight / 2); }
          }
          showSheet(nodeTip(d), [{ label: t('shDetails'), cls: 'primary', onClick: () => { hideSheet(); openDrawer(d.id); } }, { label: t('shClose'), onClick: () => { hideSheet(); highlightSubtree(null, false); } }]);
          return;
        }
        hideTip(); openDrawer(n.dataset.node); return;
      }
      if (touch) { hideSheet(); root.querySelectorAll('.zone.hover').forEach(el => el.classList.remove('hover')); highlightSubtree(null, false); }
    });
  }

  function render() {
    hideSheet();
    if (!S.loaded) { $('#view-map').innerHTML = `<div class="loading"><span class="spin"></span>${esc(t('loading'))}</div>`; return; }
    if (zone) renderTree(); else renderPicture();
  }

  function locate(id) {
    const d = S.byId.get(id);
    if (!d) return;
    zone = d.group;
    pendingLocate = id;
    if (d.state === 'disconnected' && !S.showDisc) { S.showDisc = true; store.set('disc', '1'); }
    S.tab = 'map';
    store.set('tab', 'map');
    renderAll();
  }

  return { render, bind, locate, reset() { zone = null; } };
})();
