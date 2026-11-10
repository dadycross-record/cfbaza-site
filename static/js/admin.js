'use strict';
document.addEventListener('click', event => {
  const button = event.target.closest('[data-confirm], [data-toggle]');
  if (!button) return;
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) { event.preventDefault(); return; }
  const id = button.dataset.toggle;
  if (id === 'side') document.getElementById(id).classList.toggle('open');
  if (id === 'addc') { const el = document.getElementById(id); el.hidden = !el.hidden; }
});
