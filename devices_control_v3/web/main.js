'use strict';
// Event wiring and start-up.

document.addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act && !act.disabled) { const d = S.byId.get(act.dataset.id); if (d) openConfirm(d, act.dataset.act); return; }
  const open = e.target.closest('[data-open]');
  if (open) { openDrawer(open.dataset.open); return; }
  const loc = e.target.closest('[data-locate]');
  if (loc) { MAP.locate(loc.dataset.locate); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    if (tab.dataset.tab === 'map' && S.tab === 'map') MAP.reset();   // second click returns to the PC picture
    S.tab = tab.dataset.tab; S.group = ''; store.set('tab', S.tab); hideTip(); renderAll(); return;
  }
  if (e.target.closest('#modeBtn')) { openModeDialog(); return; }
  const lang = e.target.closest('[data-lang]');
  if (lang) { S.lang = lang.dataset.lang; store.set('lang', S.lang); if ($('#modalBg').classList.contains('on')) closeModal(); renderAll(); return; }
  if (e.target.closest('[data-notice]')) { S.noticeOpen = !S.noticeOpen; store.set('noticeOpen', S.noticeOpen ? '1' : '0'); renderNotices(); }
});

$('#modalBg').addEventListener('click', e => { if (e.target.id === 'modalBg' && !$('#mCancel')?.disabled) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('#modalBg').classList.contains('on')) { if (!$('#mCancel')?.disabled) closeModal(); }
  else if (S.drawerId) closeDrawer();
});
$('#drawerClose').addEventListener('click', closeDrawer);

$('#q').addEventListener('input', e => { S.q = e.target.value; renderList(); });
$('#fGroup').addEventListener('change', e => { S.group = e.target.value; renderList(); });
$('#fState').addEventListener('change', e => { S.state = e.target.value; renderList(); });
$('#fRisk').addEventListener('change', e => { S.risk = e.target.value; renderList(); });
$('#fDisc').addEventListener('change', e => { S.showDisc = e.target.checked; store.set('disc', S.showDisc ? '1' : '0'); renderAll(); });

$('#refresh').addEventListener('click', () => { DASH.refresh(); load(); });
$('#stop').addEventListener('click', async () => {
  if (!confirm(t('stopConfirm'))) return;
  try { await api('/api/shutdown'); } catch {}
  S.stopped = true;
  closeDrawer();
  document.querySelector('header.top').remove();
  $('#main').innerHTML = `<div class="stopped"><h2>${esc(t('stopped'))}</h2></div>`;
});

// Dashboard tiles jump to the list with the matching filter.
DASH.bindTiles(kind => {
  S.q = ''; S.group = ''; S.risk = ''; $('#q').value = '';
  if (kind === 'prog') { S.state = ''; S.tab = 'prog'; }
  else {
    S.state = kind;
    if (kind === 'disconnected') S.showDisc = true;
    const prog = S.devices.filter(d => d.state === kind && d.prog).length;
    const other = S.devices.filter(d => d.state === kind && !d.prog).length;
    S.tab = prog >= other ? 'prog' : 'other';
  }
  store.set('tab', S.tab);
  renderAll();
});

MAP.bind();
renderAll();
load();
