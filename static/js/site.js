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
