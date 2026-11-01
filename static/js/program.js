// Программа тренировок: отметка «сделал», результат, профиль атлета
(function () {
  const csrf = (document.querySelector('meta[name=csrf]') || {}).content || '';
  const total = document.getElementById('myTotal');
  const post = async (url, data) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, csrf }) });
    let j = {};
    try { j = await r.json(); } catch (e) { /* пусто */ }
    if (!r.ok || !j.ok) throw new Error(j.error || 'Не получилось, попробуйте ещё раз.');
    return j;
  };
  const setCount = (id, j) => {
    const n = document.querySelector(`[data-n="${id}"]`);
    if (n) n.textContent = j.count ? `Сделали: ${j.count}` : 'Будьте первым';
    if (total && typeof j.total === 'number') total.textContent = j.total;
  };

  // ---- отметка и результат
  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-done]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.done;
    const on = !btn.classList.contains('on');
    const form = document.querySelector(`[data-res="${id}"]`);
    btn.disabled = true;
    try {
      const j = await post('/program/done', { id: Number(id), on, result: on && form ? form.result.value : '', scaled: on && form ? form.scaled.checked : false });
      btn.classList.toggle('on', j.on);
      btn.setAttribute('aria-pressed', j.on ? 'true' : 'false');
      btn.querySelector('span').textContent = j.on ? 'Сделал' : 'Отметить «сделал»';
      if (form) { form.hidden = !j.on; if (j.on) form.result.focus(); }
      setCount(id, j);
      if (j.on && window.ym && window.YM_ID) window.ym(window.YM_ID, 'reachGoal', 'wod_done');
    } catch (e) {
      const n = document.querySelector(`[data-n="${id}"]`);
      if (n) n.textContent = e.message;
    } finally { btn.disabled = false; }
  });

  document.addEventListener('submit', async (ev) => {
    const form = ev.target.closest('[data-res]');
    if (!form) return;
    ev.preventDefault();
    const id = form.dataset.res;
    const b = form.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      const j = await post('/program/done', { id: Number(id), on: true, result: form.result.value, scaled: form.scaled.checked });
      setCount(id, j);
      b.textContent = 'Сохранено ✓';
      setTimeout(() => { b.textContent = 'Сохранить'; }, 1800);
    } catch (e) { b.textContent = e.message; setTimeout(() => { b.textContent = 'Сохранить'; }, 2500); }
    b.disabled = false;
  });

  // ---- профиль атлета
  const box = document.getElementById('loginbox');
  if (!box) return;
  const f = document.getElementById('loginform');
  const err = document.getElementById('l-err');
  const go = document.getElementById('l-go');
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    box.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === m));
    box.querySelectorAll('.reg-only').forEach((x) => { x.hidden = m !== 'register'; });
    go.textContent = m === 'register' ? 'Создать профиль' : 'Войти';
    err.hidden = true;
  };
  const open = () => { box.hidden = false; document.body.style.overflow = 'hidden'; setTimeout(() => document.getElementById('l-name').focus(), 50); };
  const close = () => { box.hidden = true; document.body.style.overflow = ''; };
  document.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-open-login]')) { ev.preventDefault(); open(); return; }
    if (ev.target.closest('[data-logout]')) { try { await post('/program/logout', {}); } catch (e) { /* всё равно перезагрузим */ } location.reload(); return; }
    const m = ev.target.closest('[data-mode]');
    if (m) { setMode(m.dataset.mode); return; }
    if (!box.hidden && (ev.target === box || ev.target.closest('.callbox-x'))) close();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !box.hidden) close(); });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    go.disabled = true;
    try {
      await post('/program/' + mode, { name: f.elements.name.value, pin: f.elements.pin.value, consent: document.getElementById('l-consent').checked, public: document.getElementById('l-public').checked });
      location.reload();
    } catch (e) { err.textContent = e.message; err.hidden = false; }
    go.disabled = false;
  });
})();
