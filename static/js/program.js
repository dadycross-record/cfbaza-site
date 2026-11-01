// Отметка «сделал» на странице программы тренировок
(function () {
  const total = document.getElementById('myTotal');
  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-done]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.done;
    const on = !btn.classList.contains('on');
    btn.disabled = true;
    try {
      const r = await fetch('/program/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: Number(id), on }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Ошибка');
      btn.classList.toggle('on', j.on);
      btn.setAttribute('aria-pressed', j.on ? 'true' : 'false');
      btn.querySelector('span').textContent = j.on ? 'Сделал' : 'Отметить «сделал»';
      const n = document.querySelector(`[data-n="${id}"]`);
      if (n) n.textContent = j.count ? `Сделали: ${j.count}` : 'Будьте первым';
      if (total) total.textContent = j.total;
      if (j.on && window.ym && window.YM_ID) window.ym(window.YM_ID, 'reachGoal', 'wod_done');
    } catch (e) {
      const n = document.querySelector(`[data-n="${id}"]`);
      if (n) n.textContent = 'Не получилось, попробуйте ещё раз';
    } finally { btn.disabled = false; }
  });
})();
