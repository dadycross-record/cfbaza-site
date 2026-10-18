(function () {
  // Отправка заявки без перезагрузки страницы (без JS форма работает обычным POST)
  var form = document.getElementById('lead-form');
  var box = document.getElementById('form-msg');
  function show(cls, text) {
    box.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'form-msg ' + cls;
    p.textContent = text;
    box.appendChild(p);
  }
  if (form && window.fetch && window.FormData) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var phone = form.querySelector('[name=phone]').value.replace(/\D/g, '');
      if (phone.length < 10) { show('error', 'Проверьте номер телефона — нужно не меньше 10 цифр.'); return; }
      if (!form.querySelector('[name=consent]').checked) { show('error', 'Отметьте согласие на обработку персональных данных.'); return; }
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = 'Отправляем…';
      fetch(form.action, { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (res) {
          if (res.ok) {
            form.reset();
            show('ok', 'Спасибо! Мы получили заявку и скоро перезвоним.');
            if (window.ym && window.YM_ID) { try { window.ym(window.YM_ID, 'reachGoal', 'lead'); } catch (e) {} }
          } else {
            show('error', res.error || 'Не получилось отправить. Позвоните нам, пожалуйста.');
          }
        })
        .catch(function () { show('error', 'Нет связи. Попробуйте ещё раз или позвоните нам.'); })
        .finally(function () { btn.disabled = false; btn.textContent = old; });
    });
  }

  // Плавающая кнопка на телефоне прячется, когда видна форма заявки
  var sticky = document.getElementById('sticky-cta');
  var contacts = document.getElementById('contacts');
  var hero = document.getElementById('top');
  if (sticky && contacts && 'IntersectionObserver' in window) {
    var heroVisible = true, contactsVisible = false;
    function update() { sticky.classList.toggle('hide', heroVisible || contactsVisible); }
    new IntersectionObserver(function (en) { contactsVisible = en[0].isIntersecting; update(); }).observe(contacts);
    new IntersectionObserver(function (en) { heroVisible = en[0].isIntersecting; update(); }, { threshold: 0.35 }).observe(hero);
    update();
  }
})();

// Уведомление о cookie: показываем один раз, выбор запоминаем в браузере
(function () {
  var box = document.getElementById('cookie');
  if (!box) return;
  var seen = false;
  try { seen = localStorage.getItem('cfb_cookie_ok') === '1'; } catch (e) {}
  if (seen) return;
  box.hidden = false;
  var sticky = document.getElementById('sticky-cta');
  if (sticky) sticky.style.visibility = 'hidden';
  document.getElementById('cookie-ok').addEventListener('click', function () {
    try { localStorage.setItem('cfb_cookie_ok', '1'); } catch (e) {}
    box.hidden = true;
    if (sticky) sticky.style.visibility = '';
  });
})();

// Просмотр фото турниров на весь экран
(function () {
  const links = Array.from(document.querySelectorAll('[data-lb]'));
  if (!links.length) return;
  const box = document.createElement('div');
  box.className = 'lb'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.innerHTML = '<img alt=""><p></p><button class="lb-x" aria-label="Закрыть">×</button><button class="lb-p" aria-label="Предыдущее">‹</button><button class="lb-n" aria-label="Следующее">›</button>';
  document.body.appendChild(box);
  const img = box.querySelector('img'), cap = box.querySelector('p');
  let i = 0;
  const show = (n) => { i = (n + links.length) % links.length; img.src = links[i].href; img.alt = links[i].title; cap.textContent = links[i].title; };
  const close = () => { box.hidden = true; document.body.style.overflow = ''; };
  links.forEach((a, n) => a.addEventListener('click', (ev) => { ev.preventDefault(); show(n); box.hidden = false; document.body.style.overflow = 'hidden'; }));
  box.addEventListener('click', (ev) => {
    if (ev.target.classList.contains('lb-p')) show(i - 1);
    else if (ev.target.classList.contains('lb-n')) show(i + 1);
    else if (ev.target !== img) close();
  });
  document.addEventListener('keydown', (ev) => {
    if (box.hidden) return;
    if (ev.key === 'Escape') close();
    if (ev.key === 'ArrowLeft') show(i - 1);
    if (ev.key === 'ArrowRight') show(i + 1);
  });
})();
