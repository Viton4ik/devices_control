'use strict';
// Countdown bar for pending auto-reverts. The authoritative timer is the scheduled task on
// the PC; this bar only shows it and lets you cancel it (keep the device disabled).

const RB = (() => {
  let jobs = [], skew = 0, pollTimer = null, tickTimer = null, shown = '';
  const mine = new Set();   // job ids this page confirmed or reverted itself

  const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const remaining = j => j.endsAt - (Date.now() + skew);
  const overdue = j => remaining(j) < -90000;

  async function poll() {
    if (S.stopped || !S.admin) return;
    try {
      const r = await api('/api/rollbacks');
      if (!r.ok) return;
      skew = r.now - Date.now();
      const before = jobs;
      jobs = r.jobs || [];
      // A job that vanished without us touching it has fired: refresh the device states.
      const fired = before.filter(b => !jobs.some(j => j.id === b.id) && !mine.has(b.id));
      if (fired.length) { fired.forEach(f => toast(t('rbFired', f.name), 'warn')); load(); DASH.noteAction(); }
      render();
    } catch { /* connection lost: the scheduled task does not need us */ }
  }

  function render() {
    const bar = $('#rbBar');
    const sig = S.lang + '|' + jobs.map(j => j.id + (overdue(j) ? '!' : '')).join(',');
    if (sig !== shown) {
      shown = sig;
      bar.innerHTML = jobs.map(j => {
        const over = overdue(j);
        return `<div class="rb-item${over ? ' over' : ''}" data-job="${esc(j.id)}">
          <span class="rb-msg">${over ? esc(t('rbOverdue', j.name)) : `${esc(t('rbCountdown', j.name, '\u0000'))}`.replace('\u0000', '<b class="rb-time"></b>')}</span>
          <span class="rb-actions">
            ${over ? '' : `<button class="btn small success solid" data-rb="keep">${esc(t('rbKeep'))}</button><button class="btn small" data-rb="revert">${esc(t('rbRevert'))}</button>`}
            ${over ? `<button class="btn small" data-rb="revert">${esc(t('rbRevert'))}</button><button class="btn small" data-rb="keep">${esc(t('rbDismiss'))}</button>` : ''}
          </span></div>`;
      }).join('');
    }
    tick();
    if (jobs.length && !tickTimer) tickTimer = setInterval(tick, 1000);
    if (!jobs.length && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function tick() {
    document.querySelectorAll('#rbBar .rb-item').forEach(el => {
      const j = jobs.find(x => x.id === el.dataset.job);
      const tm = el.querySelector('.rb-time');
      if (j && tm) tm.textContent = fmt(remaining(j));
    });
    if (jobs.some(j => remaining(j) < 3000 && remaining(j) > -90000)) poll();   // catch the moment it fires
  }

  async function act(id, what) {
    const j = jobs.find(x => x.id === id);
    if (!j) return;
    mine.add(id);
    const btns = document.querySelectorAll(`#rbBar [data-job="${CSS.escape(id)}"] button`);
    btns.forEach(b => { b.disabled = true; });
    try {
      const r = await api(what === 'keep' ? '/api/rollback/confirm' : '/api/rollback/revert', { job: id });
      if (!r.ok) { mine.delete(id); toast(errText(r), 'err'); btns.forEach(b => { b.disabled = false; }); return; }
      toast(t(what === 'keep' ? 'rbKept' : 'rbReverted', j.name), 'ok');
      jobs = jobs.filter(x => x.id !== id);
      render();
      if (what === 'revert') { load(); DASH.noteAction(); }
    } catch (e) { mine.delete(id); toast(e.message, 'err'); btns.forEach(b => { b.disabled = false; }); }
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('#rbBar [data-rb]');
    if (b && !b.disabled) act(b.closest('[data-job]').dataset.job, b.dataset.rb);
  });

  pollTimer = setInterval(() => { if (!document.hidden) poll(); }, 4000);

  return {
    render, poll,
    add(job) { jobs.push(job); mine.delete(job.id); render(); poll(); },
  };
})();
