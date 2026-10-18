'use strict';
/** HTML-шаблоны сайта и админки. Всё, что пришло из базы, экранируется функцией e(). */
const C = require('../content.json');

const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = (v) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const up = (id) => (id ? `/uploads/${encodeURIComponent(id)}` : '');
const pad2 = (n) => String(n).padStart(2, '0');
const V = '10';

const PHONE_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
const ARROW_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
// Шрифты отдаются с нашего сервера (пакеты @fontsource), без обращения к Google: IP посетителей не уходит за рубеж.
const FONTS = ['oswald/500', 'oswald/600', 'oswald/700', 'open-sans/400', 'open-sans/600', 'open-sans/700', 'jetbrains-mono/700']
  .map((f) => `<link rel="stylesheet" href="/vendor/fonts/${f}.css">`).join('');
const ICONS = '<link rel="icon" type="image/png" sizes="32x32" href="/static/img/favicon-32.png"><link rel="apple-touch-icon" href="/static/img/apple-touch-icon.png">';

// ---------------------------------------------------------------------------
// Публичный сайт
// ---------------------------------------------------------------------------
function site(d) {
  const { s, root } = d;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ExerciseGym', name: 'CF BAZA',
    description: s.seo_description, url: root, telephone: s.phone_href,
    address: { '@type': 'PostalAddress', streetAddress: s.address, addressLocality: 'Иркутск', addressCountry: 'RU' },
    image: root + 'static/img/og-v2.jpg',
  }).replace(/</g, '\\u003c');

  const paidTypes = ['race', 'special'];
  const legend = C.SLOT_TYPES.filter(([k]) => d.usedTypes.has(k)).map(([k, l]) => `<li><span class="dot dot-${e(k)}"></span>${e(l)}</li>`).join('');
  const days = d.schedule.map((day) => `
      <div class="day">
        <h3>${e(day.name)}</h3>
        ${day.slots.length ? `<ul class="slots">${day.slots.map((x) => `<li class="slot slot-${e(x.type)}">${e(x.time_short)}${x.type === 'teen' ? ' · 8+' : ''}${x.label ? ' ' + e(x.label) : ''}${paidTypes.includes(x.type) ? '*' : ''}</li>`).join('')}</ul>` : '<p class="day-off">выходной</p>'}
      </div>`).join('');

  const coaches = d.coaches.map((c) => `
      <article class="coach">
        <div class="coach-photo">${c.photo ? `<img src="${up(c.photo)}" alt="${e(c.name)}" loading="lazy">` : `<span class="initial" aria-hidden="true">${e((c.name || '?')[0])}</span>`}</div>
        <div class="coach-body">
          <h3>${e(c.name)}</h3>
          ${c.subtitle ? `<p class="sub">${e(c.subtitle)}</p>` : ''}
          ${lines(c.bullets).length ? `<ul>${lines(c.bullets).map((b) => `<li>${e(b)}</li>`).join('')}</ul>` : ''}
        </div>
      </article>`).join('');

  const plans = d.plans.map((p) => `
      <div class="plan${p.featured ? ' featured' : ''}">
        ${p.badge ? `<span class="pill">${e(p.badge)}</span>` : ''}
        <div class="plan-name">${e(p.name)}</div>
        <div class="plan-price"><b>${e(p.price)}</b>${p.period ? `<span> ${e(p.period)}</span>` : ''}</div>
        <ul>${lines(p.features).map((f) => `<li>${e(f)}</li>`).join('')}</ul>
        <a class="btn ${p.featured ? 'btn-accent' : 'btn-white'}" href="#contacts">Записаться</a>
      </div>`).join('');

  const extras = d.extras.map((x) => `
      <div class="extra">
        <div class="extra-info">
          <div class="extra-title"><h3>${e(x.title)}</h3>${x.badge ? `<span class="pill">${e(x.badge)}</span>` : ''}</div>
          ${x.text ? `<p>${e(x.text)}</p>` : ''}
        </div>
        <div class="extra-prices">
          ${x.price1 ? `<div class="price-box"><b>${e(x.price1)}</b><span>${e(x.price1_note)}</span></div>` : ''}
          ${x.price2 ? `<div class="price-box"><b>${e(x.price2)}</b><span>${e(x.price2_note)}</span></div>` : ''}
        </div>
      </div>`).join('');

  const msgs = (d.sent ? '<p class="form-msg ok">Спасибо! Мы получили заявку и скоро перезвоним.</p>' : '') +
    (d.flash || []).map(([cat, m]) => `<p class="form-msg ${e(cat)}">${e(m)}</p>`).join('');

  const metrika = /^\d+$/.test(s.metrika_id || '') ? `
<script>
window.YM_ID = ${s.metrika_id};
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
ym(${s.metrika_id}, "init", {clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:true});
</script>` : '';

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(s.seo_title)}</title>
<meta name="description" content="${e(s.seo_description)}">
<meta name="theme-color" content="#1F1F1F">
<link rel="canonical" href="${e(root)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${e(s.seo_title)}">
<meta property="og:description" content="${e(s.seo_description)}">
<meta property="og:image" content="${e(root)}static/img/og-v2.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="CF BAZA">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:locale" content="ru_RU">
${ICONS}
${FONTS}
<link rel="stylesheet" href="/static/css/site.css?v=${V}">
<style>:root { --accent: ${e(s.accent)}; }</style>
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<a class="skip" href="#main">К содержимому</a>

<header class="header">
  <div class="wrap header-in">
    <a class="logo" href="#top" aria-label="CF BAZA — наверх"><img src="/static/img/logo-text.png" alt="CF BAZA" width="982" height="120"></a>
    <nav class="nav" aria-label="Основное меню">
      <a href="#start">Как начать</a>
      <a href="#schedule">Расписание</a>
      ${d.coaches.length ? '<a href="#coaches">Тренеры</a>' : ''}
      <a href="#price">Цены</a>
      ${d.faqs.length ? '<a href="#faq">Вопросы</a>' : ''}
      <a href="#contacts">Контакты</a>
    </nav>
    <div class="header-cta">
      <a class="call" href="tel:${e(s.phone_href)}" aria-label="Позвонить: ${e(s.phone)}">${PHONE_SVG}</a>
      <a class="btn btn-accent" href="#contacts">${e(s.cta_header)}</a>
    </div>
  </div>
</header>

<main id="main">

<section class="hero" id="top">
  <div class="hero-bg" style="background-image: url('${s.hero_image ? up(s.hero_image) : '/static/img/hero.jpg?v=' + V}')"></div>
  <div class="wrap hero-in">
    <p class="eyebrow">${e(s.hero_eyebrow)}</p>
    <h1>${e(s.hero_title)} <span>${e(s.hero_title_accent)}</span></h1>
    <p class="hero-text">${e(s.hero_text)}</p>
    <div class="hero-actions">
      <a class="btn btn-accent btn-lg" href="#contacts">${e(s.cta_primary)} ${ARROW_SVG}</a>
      <a class="btn btn-white btn-lg" href="#schedule">Расписание</a>
    </div>
  </div>
</section>

${d.facts.length ? `<section class="facts" aria-label="Коротко о клубе"><div class="wrap facts-in">${d.facts.map((f) => `<div class="fact"><b>${e(f.value)}</b><span>${e(f.label)}</span></div>`).join('')}</div></section>` : ''}

<section class="section light" id="start">
  <div class="wrap">
    <div class="sec-head">
      <h2 class="h2-big">${e(s.start_title)}</h2>
      <p>${e(s.start_text)}</p>
    </div>
    <ol class="cards">
      ${d.steps.map((st, i) => `<li class="card"><span class="pill">Шаг ${pad2(i + 1)}</span><h3>${e(st.title)}</h3><p>${e(st.text)}</p></li>`).join('')}
    </ol>
  </div>
</section>

<section class="section">
  <div class="wrap why">
    <div>
      <p class="eyebrow">${e(s.why_eyebrow)}</p>
      <h2 class="h2">${e(s.why_title)}</h2>
      ${d.whys.map((w, i) => `<div class="why-item"><span class="n">${pad2(i + 1)}</span><div><b>${e(w.title)}</b><p>${e(w.text)}</p></div></div>`).join('')}
    </div>
    <div>
      ${d.photos.length ? `<div class="gallery">${d.photos.slice(0, 5).map((p) => `<figure><img src="${up(p.image)}" alt="${e(p.caption || 'Зал CF BAZA')}" loading="lazy"></figure>`).join('')}</div>
      <p class="equip">${e(s.equipment_text)}</p>` : `<p class="equip-solo">${e(s.equipment_text)}</p>`}
    </div>
  </div>
</section>

<section class="section deep" id="schedule">
  <div class="wrap">
    <p class="eyebrow">Расписание</p>
    <h2 class="h2" style="margin-bottom: 24px">${e(s.schedule_title)}</h2>
    <ul class="legend">${legend}</ul>
    <div class="days">${days}</div>
    <div class="note">
      ${lines(s.schedule_note).map((l) => `<span>${e(l)}</span>`).join('')}
      ${paidTypes.some((t) => d.usedTypes.has(t)) ? '<span>* Оплачивается отдельно от абонемента — цены в разделе «Цены».</span>' : ''}
    </div>
  </div>
</section>

${d.coaches.length ? `
<section class="section light" id="coaches">
  <div class="wrap">
    <div class="sec-head">
      <h2 class="h2-big">${e(s.coaches_title)}</h2>
      <p>${e(s.coaches_text)}</p>
    </div>
    <div class="cards">${coaches}</div>
  </div>
</section>` : ''}

<section class="section" id="price">
  <div class="wrap">
    <p class="eyebrow">Абонементы</p>
    <div class="sec-head" style="margin-bottom: 40px">
      <h2 class="h2">${e(s.price_title)}</h2>
      <p>${e(s.price_text)}</p>
    </div>
    <div class="plans">${plans}</div>
    ${d.extras.length ? `<div class="extras">${extras}</div>` : ''}
  </div>
</section>

${d.reviews.length ? `
<section class="section light">
  <div class="wrap">
    <h2 class="h2" style="margin-bottom: clamp(28px, 4vw, 48px)">${e(s.reviews_title)}</h2>
    <div class="cards">
      ${d.reviews.map((r) => `<figure class="review"><blockquote>«${e(r.text)}»</blockquote><figcaption>${e(r.name)}${r.role ? `<span> · ${e(r.role)}</span>` : ''}</figcaption></figure>`).join('')}
    </div>
  </div>
</section>` : ''}

${d.faqs.length ? `
<section class="section" id="faq">
  <div class="wrap faq">
    <h2 class="h2">${e(s.faq_title)}</h2>
    <div class="faq-list">
      ${d.faqs.map((q) => `<details><summary>${e(q.question)}</summary><p>${e(q.answer)}</p></details>`).join('')}
    </div>
  </div>
</section>` : ''}

<section class="contacts" id="contacts">
  <div class="wrap contacts-in">
    <div class="contacts-info">
      <img class="contacts-logo" src="/static/img/logo-dark.png" alt="Логотип CF BAZA" width="822" height="180">
      <h2>${e(s.contacts_title)}</h2>
      <p>${e(s.contacts_text)}</p>
      <dl>
        <div><dt>Адрес</dt><dd>${e(s.address)}</dd></div>
        <div><dt>Телефон</dt><dd><a href="tel:${e(s.phone_href)}">${e(s.phone)}</a></dd></div>
        <div><dt>Часы</dt><dd>${e(s.hours)}</dd></div>
      </dl>
    </div>
    <form class="form" id="lead-form" action="/lead" method="post" novalidate>
      <h3>Заявка на пробную</h3>
      <div id="form-msg" role="status" aria-live="polite">${msgs}</div>
      <label for="f-name">Имя
        <input id="f-name" name="name" type="text" autocomplete="name" maxlength="80" placeholder="Как к вам обращаться"></label>
      <label for="f-phone">Телефон
        <input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" placeholder="+7" required></label>
      <label for="f-interest">Что интересно
        <select id="f-interest" name="interest">${C.LEAD_INTERESTS.map((i) => `<option>${e(i)}</option>`).join('')}</select></label>
      <div class="hp" aria-hidden="true"><label>Сайт <input name="website" tabindex="-1" autocomplete="off"></label></div>
      <label class="check"><input type="checkbox" name="consent" value="1" required> <span>Даю <a href="/consent" target="_blank">согласие на обработку персональных данных</a> и подтверждаю, что ознакомлен(а) с <a href="/privacy" target="_blank">политикой обработки персональных данных</a></span></label>
      <button class="btn btn-accent" type="submit">Записаться бесплатно</button>
    </form>
  </div>
  ${s.map_embed ? `<div class="wrap map"><iframe src="${e(s.map_embed)}" title="Карта: ${e(s.address)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>` : ''}
</section>

</main>

<footer class="footer">
  <div class="wrap footer-in">
    <img src="/static/img/logo-yellow.png" alt="CF BAZA" width="822" height="180">
    <span>Клуб функциональной подготовки · Иркутск · с 2018 года</span>
    <span>© 2018–${new Date().getFullYear()} ${e(s.op_name)}</span>
  </div>
  <div class="wrap footer-legal">
    <p>${e(s.op_name)} · ИНН ${e(s.op_inn)} · ОГРНИП ${e(s.op_ogrnip)}</p>
    <p class="footer-links"><a href="/privacy">Политика обработки персональных данных</a><a href="/consent">Согласие на обработку персональных данных</a><a href="/requisites">Реквизиты</a></p>
    <p>Информация о ценах и услугах на сайте носит справочный характер и не является публичной офертой (ст. 437 ГК РФ). Условия посещения уточняйте у администратора клуба.</p>
  </div>
</footer>

<div class="sticky-cta" id="sticky-cta">
  <a class="call" href="tel:${e(s.phone_href)}" aria-label="Позвонить: ${e(s.phone)}">${PHONE_SVG}</a>
  <a class="btn btn-accent" href="#contacts">${e(s.cta_primary)}</a>
</div>

<div class="cookie" id="cookie" hidden>
  <p>Сайт использует файлы cookie, в том числе сервисов Яндекса. Подробнее — в <a href="/privacy#cookie">политике обработки персональных данных</a>.</p>
  <button type="button" class="btn btn-accent" id="cookie-ok">Понятно</button>
</div>
<script src="/static/js/site.js?v=${V}" defer></script>
${metrika}
</body>
</html>`;
}

function docShell(s, title, inner) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} — CF BAZA</title>
${ICONS}
${FONTS}
<link rel="stylesheet" href="/static/css/site.css?v=${V}">
<style>:root { --accent: ${e(s.accent)}; }</style>
</head>
<body>
<header class="header"><div class="wrap header-in"><a class="logo" href="/"><img src="/static/img/logo-text.png" alt="CF BAZA"></a><div class="header-cta"><a class="btn btn-accent" href="/#contacts">${e(s.cta_header)}</a></div></div></header>
<main class="section"><div class="wrap doc">
  <h1 class="h2">${e(title)}</h1>
  ${inner}
  <p class="doc-nav"><a class="btn btn-white" href="/">На главную</a><a href="/privacy">Политика</a><a href="/consent">Согласие</a><a href="/requisites">Реквизиты</a></p>
</div></main>
</body>
</html>`;
}

function legalDoc(s, doc) {
  const body = doc.blocks.map(([h, paras], i) => {
    const id = /cookie/i.test(h) ? ' id="cookie"' : '';
    let html = h ? `<h2${id}>${e(h)}</h2>` : '';
    let list = [];
    const flush = () => { if (list.length) { html += `<ul>${list.map((x) => `<li>${e(x)}</li>`).join('')}</ul>`; list = []; } };
    for (const p of paras) {
      if (p.startsWith('• ')) list.push(p.slice(2));
      else { flush(); html += `<p>${e(p)}</p>`; }
    }
    flush();
    return html;
  }).join('');
  return docShell(s, doc.title, `<p class="doc-intro">${e(doc.intro)}</p>${body}`);
}

function requisitesPage(s, req) {
  return docShell(s, req.title, `<dl class="req">${req.rows.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>`);
}

// ---------------------------------------------------------------------------
// Админка
// ---------------------------------------------------------------------------
function adminPage({ title, body, path, csrf, newLeads, flash }) {
  const item = (href, label, on, extra = '') => `<a class="item ${on ? 'on' : ''}" href="${href}">${label}${extra}</a>`;
  const settingsLinks = C.SETTINGS_GROUPS.map(([t], i) => item(`/admin/settings/${i}`, e(t), path === `/admin/settings/${i}`)).join('');
  const sectionLinks = C.ADMIN_MENU.map((k) => item(`/admin/c/${k}`, e(C.COLLECTIONS[k].title), path.startsWith(`/admin/c/${k}`))).join('');
  const flashes = (flash || []).map(([cat, m]) => `<div class="flash ${e(cat)}">${e(m)}</div>`).join('');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(title)} — CF BAZA</title>
${ICONS}
<link rel="stylesheet" href="/static/css/admin.css?v=${V}">
</head>
<body>
<div class="layout">
  <aside class="side" id="side">
    <div class="head">
      <a class="brand" href="/admin/leads"><img src="/static/img/logo-text.png" alt="CF BAZA"></a>
      <button class="burger" type="button" onclick="document.getElementById('side').classList.toggle('open')">Меню</button>
    </div>
    <nav>
      ${item('/admin/leads', 'Заявки', path.startsWith('/admin/leads'), newLeads ? ` <span class="count">${newLeads}</span>` : '')}
      <div class="group">Тексты</div>
      ${settingsLinks}
      <div class="group">Разделы сайта</div>
      ${sectionLinks}
      <div class="bottom">
        <a href="/" target="_blank">Открыть сайт ↗</a>
        <a href="/admin/password">Пароль</a>
        <form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${e(csrf)}"><button type="submit">Выйти</button></form>
      </div>
    </nav>
  </aside>
  <main class="main">
    ${flashes}
    ${body}
  </main>
</div>
</body>
</html>`;
}

function login({ csrf, error }) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Вход — CF BAZA</title>
${ICONS}
<link rel="stylesheet" href="/static/css/admin.css?v=${V}">
</head>
<body>
<div class="login">
  <form method="post">
    <img src="/static/img/logo-text.png" alt="CF BAZA">
    <h1>Вход в админку</h1>
    ${error ? `<div class="flash error">${e(error)}</div>` : ''}
    <input type="hidden" name="csrf" value="${e(csrf)}">
    <label class="field"><span>Логин</span><input type="text" name="login" value="admin" autocomplete="username" required></label>
    <label class="field"><span>Пароль</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
    <button class="btn btn-primary" type="submit">Войти</button>
  </form>
</div>
</body>
</html>`;
}

function leads({ rows, show, csrf }) {
  const body = rows.length ? `
<table>
  <thead><tr><th>Дата</th><th>Имя</th><th>Телефон</th><th class="hide-sm">Интерес</th><th>Статус</th><th></th></tr></thead>
  <tbody>
  ${rows.map((l) => `
  <tr>
    <td style="white-space:nowrap">${e(l.created)}</td>
    <td>${e(l.name || '—')}</td>
    <td style="white-space:nowrap"><a href="tel:${e(l.phone)}">${e(l.phone)}</a></td>
    <td class="hide-sm">${e(l.interest || '—')}</td>
    <td>${l.status === 'new' ? '<span class="badge new">новая</span>' : '<span class="badge">обработана</span>'}</td>
    <td class="actions">
      <form method="post"><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="id" value="${e(l.id)}">
        ${l.status === 'new' ? '<button class="btn btn-sm" name="action" value="done">Обработана</button>' : '<button class="btn btn-sm" name="action" value="new">Вернуть в новые</button>'}
        <button class="btn btn-sm btn-danger" name="action" value="delete" onclick="return confirm('Удалить заявку?')">Удалить</button>
      </form>
    </td>
  </tr>`).join('')}
  </tbody>
</table>` : `<p class="empty">${show === 'new' ? 'Новых заявок нет.' : 'Заявок пока нет.'}</p>`;
  return `
<div class="topline">
  <h1>Заявки с сайта</h1>
  <div style="display:flex; gap:8px; flex-wrap:wrap">
    <a class="btn ${show === 'new' ? 'btn-primary' : ''}" href="/admin/leads?show=new">Только новые</a>
    <a class="btn ${show !== 'new' ? 'btn-primary' : ''}" href="/admin/leads">Все</a>
    <a class="btn" href="/admin/leads.csv">Скачать для Excel</a>
  </div>
</div>
<p class="hint">Сюда приходят заявки из формы «Заявка на пробную», копия уходит на почту из раздела «Уведомления о заявках». Позвонили человеку — нажмите «Обработана».</p>
<div class="card table-wrap">${body}</div>`;
}

function field(key, label, ftype, opts, value) {
  if (ftype === 'bool') {
    return `<label class="field check"><input type="checkbox" name="${e(key)}" value="1" ${value ? 'checked' : ''}> <span>${e(label)}</span></label>`;
  }
  let input;
  if (ftype === 'textarea' || ftype === 'lines') {
    input = `<textarea name="${e(key)}" rows="${ftype === 'lines' ? 6 : 4}">${e(value)}</textarea>${ftype === 'lines' ? '<small>Каждая строка — отдельный пункт списка.</small>' : ''}`;
  } else if (ftype === 'select') {
    input = `<select name="${e(key)}">${(opts || []).map(([v, l]) => `<option value="${e(v)}" ${v === value ? 'selected' : ''}>${e(l)}</option>`).join('')}</select>`;
  } else if (ftype === 'color') {
    input = `<span style="display:flex; gap:10px; align-items:center">
      <input type="color" value="${e(value)}" oninput="this.nextElementSibling.value=this.value.toUpperCase()" style="width:56px; height:40px; padding:2px; border:1px solid #CFCFC8; border-radius:8px">
      <input type="text" name="${e(key)}" value="${e(value)}" pattern="#[0-9A-Fa-f]{6}" style="max-width:140px"></span>
      <small>Фирменный жёлтый — #FECC00.</small>`;
  } else if (ftype === 'image') {
    input = `<span class="img-field">
      ${value ? `<img src="${up(value)}" alt="">` : ''}
      <span style="display:flex; flex-direction:column; gap:8px">
        <input type="file" name="${e(key)}" accept="image/jpeg,image/png,image/webp">
        ${value ? `<label style="display:flex; gap:8px; align-items:center"><input type="checkbox" name="${e(key)}__remove" value="1"> Удалить фото</label>` : ''}
        <small>JPG, PNG или WEBP до 15 МБ. Большие фото уменьшатся автоматически.</small>
      </span></span>`;
  } else {
    input = `<input type="${ftype === 'url' ? 'url' : 'text'}" name="${e(key)}" value="${e(value)}">`;
  }
  return `<label class="field"><span>${e(label)}</span>${input}</label>`;
}

function settingsPage({ title, fields, s, csrf }) {
  return `
<div class="topline"><h1>${e(title)}</h1><a class="btn" href="/" target="_blank">Посмотреть на сайте ↗</a></div>
<div class="card">
  <form class="edit" method="post" enctype="multipart/form-data">
    <input type="hidden" name="csrf" value="${e(csrf)}">
    ${fields.map(([k, l, t]) => field(k, l, t, null, s[k] ?? '')).join('')}
    <div class="form-actions"><button class="btn btn-primary" type="submit">Сохранить</button></div>
  </form>
</div>`;
}

function listPage({ kind, meta, items, csrf }) {
  const typeLabels = Object.fromEntries(C.SLOT_TYPES);
  const fieldLabel = (f) => { const x = meta.fields.find((q) => q[0] === f); return x ? x[1].split(' (')[0].split(' —')[0] : f; };
  const short = (v) => { const t = String(v ?? ''); return t ? (t.length > 80 ? t.slice(0, 80) + '…' : t) : '—'; };
  const thumbCol = kind === 'coach' || kind === 'photo';
  const rows = items.map((it) => `
  <tr class="${it.active ? '' : 'off'}">
    ${thumbCol ? `<td style="width:60px">${(it.photo || it.image) ? `<img class="thumb" src="${up(it.photo || it.image)}" alt="">` : '<span class="thumb"></span>'}</td>` : ''}
    ${meta.list_fields.map((f, i) => `<td>${i === 0 ? `<a href="/admin/c/${kind}/${it.id}" style="font-weight:700">` : ''}${f === 'type' ? e(typeLabels[it[f]] || it[f]) : e(short(it[f]))}${i === 0 ? '</a>' : ''}${i === 0 && !it.active ? ' <span class="badge off">скрыто</span>' : ''}</td>`).join('')}
    <td class="actions">
      <form method="post"><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="id" value="${e(it.id)}">
        ${kind !== 'slot' ? '<button class="btn btn-sm" name="action" value="up" title="Выше" aria-label="Выше">↑</button> <button class="btn btn-sm" name="action" value="down" title="Ниже" aria-label="Ниже">↓</button>' : ''}
        <a class="btn btn-sm" href="/admin/c/${kind}/${it.id}">Изменить</a>
        <button class="btn btn-sm" name="action" value="toggle">${it.active ? 'Скрыть' : 'Показать'}</button>
        <button class="btn btn-sm btn-danger" name="action" value="delete" onclick="return confirm('Удалить безвозвратно?')">Удалить</button>
      </form>
    </td>
  </tr>`).join('');
  return `
<div class="topline">
  <h1>${e(meta.title)}</h1>
  <a class="btn btn-primary" href="/admin/c/${kind}/new">+ Добавить ${e(meta.one)}</a>
</div>
<p class="hint">${kind === 'slot' ? 'Занятия на сайте сами сортируются по дням и времени. Скрытые занятия не показываются.' : 'Порядок на сайте — как в этом списке, меняйте стрелками. «Скрыть» убирает с сайта без удаления.'}</p>
<div class="card table-wrap">
${items.length ? `<table><thead><tr>${thumbCol ? '<th></th>' : ''}${meta.list_fields.map((f) => `<th>${e(fieldLabel(f))}</th>`).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">Пока пусто. Нажмите «Добавить ${e(meta.one)}».</p>`}
</div>`;
}

function formPage({ kind, meta, item, csrf }) {
  return `
<div class="topline">
  <h1>${item.id ? 'Изменить' : 'Добавить'} ${e(meta.one)}</h1>
  <a class="btn" href="/admin/c/${kind}">← Назад к списку</a>
</div>
<div class="card">
  <form class="edit" method="post" enctype="multipart/form-data">
    <input type="hidden" name="csrf" value="${e(csrf)}">
    ${meta.fields.map(([k, l, t, o]) => field(k, l, t, o, item[k] ?? '')).join('')}
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">Сохранить</button>
      ${item.id ? '' : '<button class="btn" type="submit" name="and_new" value="1">Сохранить и добавить ещё</button>'}
    </div>
  </form>
</div>`;
}

function passwordPage({ csrf }) {
  return `
<div class="topline"><h1>Смена пароля</h1></div>
<div class="card">
  <form class="edit" method="post">
    <input type="hidden" name="csrf" value="${e(csrf)}">
    <label class="field"><span>Текущий пароль</span><input type="password" name="old" autocomplete="current-password" required></label>
    <label class="field"><span>Новый пароль</span><input type="password" name="new" autocomplete="new-password" minlength="8" required><small>Минимум 8 символов.</small></label>
    <label class="field"><span>Новый пароль ещё раз</span><input type="password" name="new2" autocomplete="new-password" minlength="8" required></label>
    <div class="form-actions"><button class="btn btn-primary" type="submit">Сменить пароль</button></div>
  </form>
</div>`;
}

module.exports = { site, legalDoc, requisitesPage, adminPage, login, leads, settingsPage, listPage, formPage, passwordPage, e };
