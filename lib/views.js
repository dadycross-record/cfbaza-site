'use strict';
/** HTML-шаблоны сайта и админки. Всё, что пришло из базы, экранируется функцией e(). */
const C = require('../content.json');

const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = (v) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const up = (id) => (!id ? '' : String(id).startsWith('/static/') ? String(id) : `/uploads/${encodeURIComponent(id)}`);
const full = (src) => src.replace(/-thumb(\.\w+)$/, '$1');
// Выделение «карандашом»: до первого «?» включительно, иначе часть после « — »
const markTitle = (t) => {
  t = String(t || '');
  let i = t.indexOf('?');
  if (i !== -1) return `<span class="pencil">${e(t.slice(0, i + 1))}</span>${e(t.slice(i + 1))}`;
  i = t.indexOf(' — ');
  if (i !== -1) return `${e(t.slice(0, i + 3))}<span class="pencil">${e(t.slice(i + 3))}</span>`;
  return `<span class="pencil">${e(t)}</span>`;
};
const pad2 = (n) => String(n).padStart(2, '0');
const V = '24';

const PHONE_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
const USER_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
const ARROW_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
// Шрифты отдаются с нашего сервера (пакеты @fontsource), без обращения к Google: IP посетителей не уходит за рубеж.
const FONTS = ['oswald/500', 'oswald/600', 'oswald/700', 'open-sans/400', 'open-sans/600', 'open-sans/700', 'jetbrains-mono/700', 'caveat/600']
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
<meta property="og:url" content="${e(root)}">
${s.yandex_verification ? `<meta name="yandex-verification" content="${e(s.yandex_verification)}">` : ''}
${s.google_verification ? `<meta name="google-site-verification" content="${e(s.google_verification)}">` : ''}
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
      ${s.program_public ? '<a class="nav-prog" href="/program">Программа</a>' : ''}
      <a href="#start">Как начать</a>
      <a href="#schedule">Расписание</a>
      ${d.coaches.length ? '<a href="#coaches">Тренеры</a>' : ''}
      ${d.evpillars.length || d.evphotos.length ? '<a href="#events">Турниры</a>' : ''}
      <a href="#price">Цены</a>
      ${d.faqs.length ? '<a href="#faq">Вопросы</a>' : ''}
      <a href="#contacts">Контакты</a>
    </nav>
    <div class="header-cta">
      ${s.program_public ? '<a class="prog-link" href="/program">Программа</a>' : ''}
      <a class="cab-link" href="/cabinet" aria-label="Личный кабинет">${USER_SVG}<span>Кабинет</span></a>
      <a class="call" href="tel:${e(s.phone_href)}" data-callbox aria-label="Позвонить: ${e(s.phone)}">${PHONE_SVG}</a>
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
    <div class="sec-head scribble">
      <h2 class="h2-big">${markTitle(s.start_title)}</h2>
      <p><span class="pencil-arrow" aria-hidden="true"></span>${e(s.start_text)}</p>
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
      ${d.photos.length ? `<div class="gallery n${Math.min(d.photos.length, 5)}">${d.photos.slice(0, 5).map((p) => `<a class="gal-ph" href="${e(full(up(p.image)))}" data-lb title="${e(p.caption || 'Зал CF BAZA')}"><img src="${e(up(p.image))}" alt="${e(p.caption || 'Зал CF BAZA')}" loading="lazy"></a>`).join('')}</div>
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
    <div class="sec-head scribble">
      <h2 class="h2-big">${markTitle(s.coaches_title)}</h2>
      <p><span class="pencil-arrow" aria-hidden="true"></span>${e(s.coaches_text)}</p>
    </div>
    <div class="cards">${coaches}</div>
  </div>
</section>` : ''}

${d.evpillars.length || d.evphotos.length ? `
<section class="section deep events" id="events">
  <div class="wrap">
    <div class="ev-top">
      <div class="ev-intro">
        <p class="eyebrow">${e(s.events_eyebrow)}</p>
        <h2 class="h2-big">${e(s.events_title)}${s.events_accent ? `<span>${e(s.events_accent)}</span>` : ''}</h2>
        <p class="ev-lead">${e(s.events_text)}</p>
        ${lines(s.events_tags).length ? `<ul class="ev-tags">${lines(s.events_tags).map((t) => `<li>${e(t)}</li>`).join('')}</ul>` : ''}
      </div>
      ${d.evphotos.length ? `<div class="ev-grid n${Math.min(d.evphotos.length, 8)}">${d.evphotos.slice(0, 8).map((p) => { const src = up(p.image); return `<a class="ev-ph" href="${e(full(src))}" data-lb title="${e(p.caption)}"><img src="${e(src)}" alt="${e(p.caption || 'Турнир с участием CF BAZA')}" loading="lazy"></a>`; }).join('')}</div>` : ''}
    </div>
    ${d.evpillars.length ? `<div class="ev-pillars">${d.evpillars.map((x, i) => `<div class="ev-pillar"><span class="ev-num">${pad2(i + 1)}</span><h3>${e(x.title)}</h3><p>${e(x.text)}</p></div>`).join('')}</div>` : ''}
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
<section class="section light reviews">
  <div class="wrap">
    <h2 class="h2">${e(s.reviews_title)}</h2>
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

<div class="callbox" id="callbox" hidden role="dialog" aria-modal="true" aria-labelledby="callbox-t">
  <div class="callbox-card">
    <button class="callbox-x" type="button" aria-label="Закрыть">×</button>
    <div class="callbox-ic">${PHONE_SVG}</div>
    <p class="callbox-t" id="callbox-t">Звоните — ответим и запишем</p>
    <a class="callbox-num" href="tel:${e(s.phone_href)}">${e(s.phone)}</a>
    ${s.call_hours || s.hours ? `<p class="callbox-h">${e(s.call_hours || s.hours)}</p>` : ''}
    <a class="btn btn-accent callbox-go" href="tel:${e(s.phone_href)}">${PHONE_SVG} Позвонить</a>
    <button class="btn btn-white callbox-copy" type="button" data-num="${e(s.phone)}">Скопировать номер</button>
    <a class="callbox-form" href="#contacts">или оставьте заявку — перезвоним сами</a>
  </div>
</div>
<div class="sticky-cta" id="sticky-cta">
  <a class="call" href="tel:${e(s.phone_href)}" data-callbox aria-label="Позвонить: ${e(s.phone)}">${PHONE_SVG}</a>
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
      <a class="brand" href="/admin"><img src="/static/img/logo-text.png" alt="CF BAZA"></a>
      <button class="burger" type="button" onclick="document.getElementById('side').classList.toggle('open')">Меню</button>
    </div>
    <nav>
      ${item('/admin', 'Обзор', path === '/admin' || path === '/admin/')}
      ${item('/admin/leads', 'Заявки', path.startsWith('/admin/leads'), newLeads ? ` <span class="count">${newLeads}</span>` : '')}
      ${item('/admin/crm', 'Клиенты', path.startsWith('/admin/crm'))}
      ${item('/admin/program', 'Программа тренировок', path.startsWith('/admin/program'))}
      ${item('/admin/athletes', 'Атлеты', path.startsWith('/admin/athletes'))}
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
    <td>${l.client_id ? `<a href="/admin/crm/${e(l.client_id)}" title="Карточка клиента">${e(l.name || 'без имени')}</a>` : e(l.name || '—')}</td>
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
<p class="hint">Сюда приходят заявки из формы «Заявка на пробную», копия уходит на почту из раздела «Уведомления о заявках». Позвонили человеку — нажмите «Обработана». Каждая заявка автоматически попадает в раздел «Клиенты»: нажмите на имя, чтобы открыть карточку и вести историю.</p>
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


// ---------------------------------------------------------------------------
// Программа тренировок
// ---------------------------------------------------------------------------
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayLabel = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return { wd: WD[d.getUTCDay()], day: d.getUTCDate(), mon: MONTHS_G[d.getUTCMonth()] }; };
const CHECK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function wodBlocks(blocks) {
  return blocks.map((b) => `<div class="wb">${b.title ? `<h4>${e(b.title)}</h4>` : ''}${b.rows.length ? `<ul>${b.rows.map((r) => `<li${r.rest ? ' class="rest"' : ''}>${e(r.text)}</li>`).join('')}</ul>` : ''}</div>`).join('');
}

function progHead(s, title, canonical) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} — CF BAZA</title>
<meta name="description" content="${e(s.program_text || '')}">
${canonical ? `<link rel="canonical" href="${e(canonical)}">` : ''}
${ICONS}
${FONTS}
<link rel="stylesheet" href="/static/css/site.css?v=${V}">
<style>:root { --accent: ${e(s.accent)}; }</style>
</head>`;
}

function progTop(s, athlete, csrf) {
  return `<header class="header"><div class="wrap header-in"><a class="logo" href="/"><img src="/static/img/logo-text.png" alt="CF BAZA" width="982" height="120"></a><div class="header-cta">
    ${athlete ? `<a class="ath-name" href="/program/me">${e(athlete.name)}</a><button class="btn btn-white" type="button" data-logout>Выйти</button>` : '<a class="btn btn-white" href="/program/me">Мои тренировки</a><button class="btn btn-white" type="button" data-open-login>Войти</button>'}
    <a class="btn btn-accent" href="/#contacts">${e(s.cta_header)}</a></div></div></header>
<meta name="csrf" content="${e(csrf)}">`;
}

function loginBox() {
  return `<div class="callbox" id="loginbox" hidden role="dialog" aria-modal="true" aria-labelledby="login-t">
  <form class="callbox-card login-card" id="loginform" novalidate>
    <button class="callbox-x" type="button" aria-label="Закрыть">×</button>
    <p class="callbox-t" id="login-t" style="font-family:var(--display);font-size:24px;color:var(--text);text-transform:uppercase">Профиль атлета</p>
    <div class="login-tabs"><button type="button" class="on" data-mode="login">Вход</button><button type="button" data-mode="register">Новый профиль</button></div>
    <label class="lf"><span>Имя и фамилия</span><input id="l-name" name="name" autocomplete="name" maxlength="40" placeholder="Например: Ольга Смирнова"></label>
    <label class="lf"><span>PIN-код — 4 цифры</span><input id="l-pin" name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" placeholder="••••"></label>
    <label class="consent reg-only" hidden><input type="checkbox" id="l-consent"> <span>Даю <a href="/consent" target="_blank">согласие на обработку персональных данных</a> и знаком(а) с <a href="/privacy" target="_blank">политикой</a>.</span></label>
    <label class="consent reg-only" hidden><input type="checkbox" id="l-public"> <span>Показывать моё имя и результаты в рейтинге — <a href="/consent-public" target="_blank">согласие на распространение</a> (необязательно).</span></label>
    <p class="login-err" id="l-err" hidden></p>
    <button class="btn btn-accent" type="submit" id="l-go">Войти</button>
    <p class="callbox-h">Профиль сохраняет ваши отметки на любом телефоне и выводит вас в рейтинг. Отметки, сделанные до входа, перенесутся.</p>
  </form>
</div>`;
}

function programPage(d) {
  const { s, tracks, track, wods, totals, myTotal, more, today, athlete, csrf } = d;
  const cur = tracks.find((t) => t.slug === track);
  const byDay = [];
  for (const w of wods) { const last = byDay[byDay.length - 1]; if (last && last.date === w.wdate) last.list.push(w); else byDay.push({ date: w.wdate, list: [w] }); }
  const strip = byDay.map((g) => { const L = dayLabel(g.date); return `<a class="pd-chip${g.date === today ? ' today' : ''}" href="#d${g.date}"><span>${L.wd}</span><b>${L.day}</b></a>`; }).join('');
  const resList = (w) => w.results.length ? `<details class="wod-res"><summary>Результаты атлетов · ${w.results.length}</summary><ol>${w.results.map((r) => `<li${r.me ? ' class="me"' : ''}><span>${e(r.name)}</span><b>${e(r.result)}</b><i>${r.scaled ? 'scaled' : 'RX'}</i></li>`).join('')}</ol></details>` : '';
  const days = byDay.map((g) => {
    const L = dayLabel(g.date);
    return `<section class="pday" id="d${g.date}">
      <h2 class="pday-h"><span class="pday-wd">${L.wd}</span> ${L.day} ${L.mon}${g.date === today ? ' <span class="pill">сегодня</span>' : ''}</h2>
      ${g.list.map((w) => `<article class="wod" data-id="${w.id}">
        ${w.blocks.length ? `<div class="wod-body">${wodBlocks(w.blocks)}</div>` : ''}
        ${w.image ? `<a class="wod-img" href="${up(w.image)}" target="_blank" rel="noopener"><img src="${up(w.image)}" alt="Программа на ${L.day} ${L.mon}" loading="lazy"></a>` : ''}
        <div class="wod-foot">
          <button class="done-btn${w.mine ? ' on' : ''}" type="button" data-done="${w.id}" aria-pressed="${w.mine ? 'true' : 'false'}">${CHECK_SVG}<span>${w.mine ? 'Сделал' : 'Отметить «сделал»'}</span></button>
          <span class="done-n" data-n="${w.id}">${w.done ? `Сделали: ${w.done}` : 'Будьте первым'}</span>
          ${w.author ? `<span class="wod-author">${e(w.author)}</span>` : ''}
        </div>
        <form class="res-form" data-res="${w.id}"${w.mine ? '' : ' hidden'}>
          <input name="result" maxlength="80" placeholder="Ваш результат: время, раунды, вес" value="${e(w.mine ? w.mine.result : '')}" aria-label="Результат">
          <label class="sc"><input type="checkbox" name="scaled"${w.mine && w.mine.scaled ? ' checked' : ''}> scaled</label>
          <button class="btn btn-white" type="submit">Сохранить</button>
          ${athlete ? '' : '<small>Чтобы результат попал в рейтинг, <button type="button" class="linkbtn" data-open-login>войдите в профиль</button>.</small>'}
        </form>
        ${resList(w)}
      </article>`).join('')}
    </section>`;
  }).join('');
  return `${progHead(s, (s.program_title || 'Программа тренировок') + (cur ? ' · ' + cur.name : ''), d.root + 'program' + (track !== tracks[0].slug ? '?t=' + track : ''))}
<body class="prog">
${progTop(s, athlete, csrf)}
<main class="section prog-main"><div class="wrap">
  <div class="prog-head">
    <div>
      <p class="eyebrow">CF BAZA</p>
      <h1 class="h2">${e(s.program_title || 'Программа тренировок')}</h1>
      <p class="prog-lead">${e(s.program_text || '')}</p>
    </div>
    <div class="my-total"><b id="myTotal">${myTotal}</b><span>${athlete ? e(athlete.name) + ':<br>' : ''}ваших отметок «сделал»<br><a href="/program/me">мои тренировки</a> · <a href="/program/rating">рейтинг</a></span></div>
  </div>
  <nav class="tracks" aria-label="Направления">${tracks.map((t) => `<a class="track${t.slug === track ? ' on' : ''}" href="/program${t.slug === tracks[0].slug ? '' : '?t=' + t.slug}">${e(t.name)}<span>${totals[t.slug] || 0}</span></a>`).join('')}</nav>
  ${cur ? `<p class="track-about">${e(cur.about)}</p>` : ''}
  ${byDay.length ? `<div class="pd-strip" aria-label="Дни">${strip}</div>${days}` : '<p class="prog-empty">В этом направлении пока нет тренировок.</p>'}
  ${more ? `<p class="prog-more"><a class="btn btn-white" href="/program?${track !== tracks[0].slug ? 't=' + track + '&' : ''}before=${more}">Раньше →</a></p>` : ''}
</div></main>
<footer class="footer"><div class="wrap" style="padding-block:24px"><a href="/" style="color:var(--muted)">← cf-baza.ru</a></div></footer>
${loginBox()}
<script src="/static/js/program.js?v=${V}" defer></script>
${/^\d+$/.test(s.metrika_id || '') ? `<script>window.YM_ID=${s.metrika_id};(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${s.metrika_id},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});</script>` : ''}
</body>
</html>`;
}

function mePage({ s, athlete, csrf, stats, rows }) {
  const MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  let cur = ''; let list = '';
  for (const r of rows) {
    const mk = r.wdate.slice(0, 7);
    if (mk !== cur) { if (cur) list += '</ol>'; const [y, m] = mk.split('-'); list += `<h2 class="me-month">${MON[Number(m) - 1]} ${y}</h2><ol class="me-list">`; cur = mk; }
    const L = dayLabel(r.wdate);
    list += `<li><span class="me-d"><b>${L.day}</b> ${L.mon.slice(0, 3)}<br><small>${L.wd}</small></span><span class="me-w"><span class="me-t">${e(r.track)}</span>${e(r.summary || 'Тренировка')}</span><span class="me-r">${r.result ? `<b>${e(r.result)}</b><small>${r.scaled ? 'scaled' : 'RX'}</small>` : '<small>без результата</small>'}</span></li>`;
  }
  if (cur) list += '</ol>';
  const statBox = (n, label) => `<div class="me-stat"><b>${n}</b><span>${label}</span></div>`;
  const weeksWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'неделя' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'недели' : 'недель'));
  return `${progHead(s, 'Мои тренировки', '')}
<body class="prog">
${progTop(s, athlete, csrf)}
<main class="section prog-main"><div class="wrap">
  <p class="eyebrow"><a href="/program" style="color:inherit">← Программа тренировок</a></p>
  <h1 class="h2">${athlete ? e(athlete.name) : 'Мои тренировки'}</h1>
  ${athlete ? '' : '<p class="prog-lead">Сейчас отметки хранятся только в этом браузере. <button type="button" class="linkbtn" data-open-login>Войдите или создайте профиль</button> — история сохранится на любом телефоне, а результаты попадут в рейтинг.</p>'}
  <div class="me-stats">${statBox(stats.total, 'тренировок всего')}${statBox(stats.month, 'в этом месяце')}${statBox(stats.streak, `${weeksWord(stats.streak)} подряд с тренировками`)}${statBox(stats.results, 'с записанным результатом')}</div>
  ${rows.length ? list : '<p class="prog-empty">Пока нет отметок. Откройте <a href="/program">программу</a>, сделайте тренировку и нажмите «Отметить „сделал“».</p>'}
  ${athlete ? `<section class="me-settings">
    <h2 class="h2" style="font-size:24px">Настройки профиля</h2>
    <label class="consent"><input type="checkbox" id="p-public"${athlete.public ? ' checked' : ''}> <span>Показывать моё имя и результаты в рейтинге (<a href="/consent-public" target="_blank">согласие на распространение</a>)</span></label>
    <form class="me-pin" id="pinform" novalidate>
      <input name="old_pin" inputmode="numeric" maxlength="4" placeholder="Текущий PIN" autocomplete="off" aria-label="Текущий PIN">
      <input name="pin" inputmode="numeric" maxlength="4" placeholder="Новый PIN" autocomplete="off" aria-label="Новый PIN">
      <button class="btn btn-white" type="submit">Сменить PIN</button>
    </form>
    <p class="login-err" id="p-msg" hidden></p>
    <p><button class="linkbtn" type="button" id="p-delete">Удалить профиль и все отметки</button></p>
  </section>` : ''}
</div></main>
${loginBox()}
<script src="/static/js/program.js?v=${V}" defer></script>
</body>
</html>`;
}

function ratingPage({ s, month, list, prev, next, athlete, csrf }) {
  const [y, m] = month.split('-');
  const MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  return `${progHead(s, 'Рейтинг атлетов', '')}
<body class="prog">
${progTop(s, athlete, csrf)}
<main class="section prog-main"><div class="wrap">
  <p class="eyebrow"><a href="/program" style="color:inherit">← Программа тренировок</a></p>
  <h1 class="h2">Рейтинг атлетов</h1>
  <p class="prog-lead">Сколько тренировок из программы атлеты отметили «сделал» за месяц. В рейтинг попадают участники с профилем, которые разрешили показывать своё имя.</p>
  <div class="rate-nav"><a class="btn btn-white" href="/program/rating?m=${prev}">←</a><b>${MON[Number(m) - 1]} ${y}</b>${next ? `<a class="btn btn-white" href="/program/rating?m=${next}">→</a>` : '<span></span>'}</div>
  ${list.length ? `<ol class="rate">${list.map((r, i) => `<li${r.me ? ' class="me"' : ''}><span class="pos">${i + 1}</span><span class="nm">${e(r.name)}</span><b>${r.n}</b><small>${r.r ? `с результатом: ${r.r}` : ''}</small></li>`).join('')}</ol>` : '<p class="prog-empty">В этом месяце ещё нет отметок от атлетов с профилем. Войдите и отметьте первую тренировку.</p>'}
  ${athlete ? '' : '<p style="margin-top:20px"><button class="btn btn-accent" type="button" data-open-login>Войти или создать профиль</button></p>'}
</div></main>
${loginBox()}
<script src="/static/js/program.js?v=${V}" defer></script>
</body>
</html>`;
}

function adminAthletes({ rows, csrf }) {
  return `
<div class="topline"><h1>Атлеты</h1><a class="btn" href="/program/rating" target="_blank">Рейтинг на сайте ↗</a></div>
<p class="hint">Профили атлетов из раздела «Программа тренировок»: имя и PIN-код. «В рейтинге» — атлет дал согласие показывать имя на сайте. Если атлет забыл PIN — нажмите «Новый PIN»: код покажется вверху страницы, передайте его атлету.</p>
<div class="card table-wrap">${rows.length ? `<table><thead><tr><th>Имя</th><th>Создан</th><th>Отметок</th><th>В рейтинге</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td style="font-weight:700">${e(r.name)}</td><td>${e(r.created || '')}</td><td>${r.n}</td><td>${r.public ? 'да' : 'нет'}</td><td class="actions"><form method="post"><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="id" value="${r.id}"><button class="btn btn-sm" name="action" value="pin">Новый PIN</button> <button class="btn btn-sm btn-danger" name="action" value="delete" onclick="return confirm('Удалить профиль и все его отметки?')">Удалить</button></form></td></tr>`).join('')}</tbody></table>` : '<p class="empty">Пока никто не создал профиль.</p>'}</div>`;
}

function adminProgram({ tracks, track, q, page, today, totals, rows, hasMore, csrf }) {
  const tname = Object.fromEntries(tracks.map((t) => [t.slug, t.name]));
  const opts = (sel) => tracks.map((t) => `<option value="${t.slug}"${t.slug === sel ? ' selected' : ''}>${e(t.name)}</option>`).join('');
  const qs = (extra) => { const p = new URLSearchParams(); if (track) p.set('t', track); if (q) p.set('q', q); for (const [k, v] of Object.entries(extra)) p.set(k, v); const x = p.toString(); return x ? '?' + x : ''; };
  return `
<div class="topline"><h1>Программа тренировок</h1><a class="btn" href="/program" target="_blank">Открыть на сайте ↗</a></div>
<p class="hint">Вставьте тренировки текстом — можно сразу на неделю: каждая строка с датой (например «06.11» или «Пн 06.11.26») начинает новый день. Или загрузите таблицу Excel: колонки «Дата», «Направление», «Тренировка». Скриншот можно приложить к тренировке — он покажется под текстом. На сайте всё оформляется в одном стиле автоматически.</p>
<div class="card" style="padding:20px; margin-bottom:24px">
  <form class="edit" method="post" enctype="multipart/form-data">
    <input type="hidden" name="csrf" value="${e(csrf)}">
    <div style="display:flex; flex-wrap:wrap; gap:16px">
      <label class="field" style="flex:1 1 200px"><span>Направление</span><select name="track">${opts(track || tracks[0].slug)}</select></label>
      <label class="field" style="flex:1 1 160px"><span>Дата (если в тексте нет дат)</span><input type="date" name="wdate" value="${e(today)}"></label>
      <label class="field" style="flex:1 1 200px"><span>Тренер (необязательно)</span><input type="text" name="author" placeholder="Например: Галина Красникова"></label>
    </div>
    <label class="field"><span>Текст тренировки</span><textarea name="body" rows="12" placeholder="06.11.26&#10;Сила 20'&#10;Присед на спине 5×5 70–80%&#10;&#10;Амрап 15'&#10;10 трастеров 30/42,5&#10;10 подтягиваний&#10;&#10;07.11.26&#10;…"></textarea></label>
    <label class="field check"><input type="checkbox" name="split" value="1" checked> <span>Делить текст на дни по датам в начале строки</span></label>
    <div style="display:flex; flex-wrap:wrap; gap:16px">
      <label class="field" style="flex:1 1 260px"><span>Таблица Excel или CSV</span><input type="file" name="table" accept=".xlsx,.csv"><small>Первая строка — заголовки: Дата, Направление, Тренировка. Направление можно не указывать.</small></label>
      <label class="field" style="flex:1 1 260px"><span>Скриншот программы</span><input type="file" name="image" id="shot" accept="image/jpeg,image/png,image/webp"><small>Нажмите «Распознать» — текст со скриншота появится в поле выше, его можно поправить. Сам скриншот прикрепится к тренировке, если не снять галочку.</small>
        <span style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:6px"><button class="btn btn-sm" type="button" id="ocr">Распознать текст со скриншота</button><span id="ocr-st" style="color:var(--muted); font-size:13px"></span></span>
        <label style="display:flex; gap:8px; align-items:center; font-size:14px"><input type="checkbox" name="keep_image" value="1" checked> прикрепить скриншот к тренировке</label></label>
    </div>
    <div class="form-actions"><button class="btn btn-primary" type="submit">Добавить в программу</button></div>
  </form>
</div>
<script>
(function () {
  const btn = document.getElementById('ocr'); const st = document.getElementById('ocr-st'); const inp = document.getElementById('shot');
  const ta = document.querySelector('textarea[name=body]');
  function load() { return new Promise((ok, bad) => { if (window.Tesseract) return ok(); const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; sc.onload = ok; sc.onerror = () => bad(new Error('Не удалось загрузить распознавание. Проверьте интернет.')); document.head.appendChild(sc); }); }
  btn.addEventListener('click', async () => {
    const f = inp.files && inp.files[0];
    if (!f) { st.textContent = 'Сначала выберите скриншот.'; return; }
    btn.disabled = true; st.textContent = 'Загружаю распознавание…';
    try {
      await load();
      const r = await Tesseract.recognize(f, 'rus+eng', { logger: (m) => { if (m.status === 'recognizing text') st.textContent = 'Распознаю… ' + Math.round(m.progress * 100) + '%'; } });
      const text = r.data.text.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      ta.value = (ta.value.trim() ? ta.value.trim() + '\\n\\n' : '') + text;
      st.textContent = 'Готово. Проверьте текст: цифры и сокращения иногда распознаются с ошибками.';
      ta.focus();
    } catch (e) { st.textContent = e.message || 'Не получилось распознать.'; }
    btn.disabled = false;
  });
})();
</script>
<form method="get" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; align-items:center">
  <a class="btn btn-sm${track ? '' : ' btn-primary'}" href="/admin/program${q ? '?q=' + encodeURIComponent(q) : ''}">Все</a>
  ${tracks.map((t) => `<a class="btn btn-sm${t.slug === track ? ' btn-primary' : ''}" href="/admin/program?t=${t.slug}${q ? '&q=' + encodeURIComponent(q) : ''}">${e(t.name)} · ${totals[t.slug] || 0}</a>`).join('')}
  ${track ? `<input type="hidden" name="t" value="${e(track)}">` : ''}
  <input type="search" name="q" value="${e(q)}" placeholder="Поиск по тексту" style="min-height:32px; padding:0 10px; border:1px solid var(--line); border-radius:8px">
</form>
<div class="card table-wrap">
${rows.length ? `<table><thead><tr><th>Дата</th><th>Направление</th><th>Тренировка</th><th>Сделали</th><th></th></tr></thead><tbody>${rows.map((w) => `
<tr class="${w.active ? '' : 'off'}">
  <td style="white-space:nowrap">${e(w.wdate.split('-').reverse().join('.'))}</td>
  <td>${e(tname[w.track] || w.track)}</td>
  <td><a href="/admin/program/${w.id}" style="font-weight:700">${e(w.summary || (w.image ? 'Скриншот' : '—'))}</a>${w.image ? ' <span class="badge">фото</span>' : ''}${w.active ? '' : ' <span class="badge off">скрыто</span>'}${w.author ? `<br><small style="color:var(--muted)">${e(w.author)}</small>` : ''}</td>
  <td>${w.done || ''}</td>
  <td class="actions"><form method="post" action="/admin/program${qs({})}"><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="id" value="${w.id}">
    <a class="btn btn-sm" href="/admin/program/${w.id}">Изменить</a>
    <button class="btn btn-sm" name="action" value="toggle">${w.active ? 'Скрыть' : 'Показать'}</button>
    <button class="btn btn-sm btn-danger" name="action" value="delete" onclick="return confirm('Удалить тренировку?')">Удалить</button></form></td>
</tr>`).join('')}</tbody></table>` : '<p class="empty">Тренировок не найдено.</p>'}
</div>
<p style="display:flex; gap:8px; margin-top:12px">${page > 0 ? `<a class="btn btn-sm" href="/admin/program${qs({ p: page - 1 })}">← Новее</a>` : ''}${hasMore ? `<a class="btn btn-sm" href="/admin/program${qs({ p: page + 1 })}">Старее →</a>` : ''}</p>`;
}

function adminProgramEdit({ w, tracks, csrf }) {
  return `
<div class="topline"><h1>Тренировка ${e(w.wdate.split('-').reverse().join('.'))}</h1><a class="btn" href="/admin/program">← К программе</a></div>
<div style="display:flex; flex-wrap:wrap; gap:20px; align-items:flex-start">
<div class="card" style="flex:1 1 420px; padding:20px">
  <form class="edit" method="post" enctype="multipart/form-data">
    <input type="hidden" name="csrf" value="${e(csrf)}">
    <div style="display:flex; flex-wrap:wrap; gap:16px">
      <label class="field" style="flex:1 1 180px"><span>Направление</span><select name="track">${tracks.map((t) => `<option value="${t.slug}"${t.slug === w.track ? ' selected' : ''}>${e(t.name)}</option>`).join('')}</select></label>
      <label class="field" style="flex:1 1 160px"><span>Дата</span><input type="date" name="wdate" value="${e(w.wdate)}"></label>
    </div>
    <label class="field"><span>Тренер</span><input type="text" name="author" value="${e(w.author)}"></label>
    <label class="field"><span>Текст тренировки</span><textarea name="body" rows="16">${e(w.body)}</textarea><small>Заголовки блоков («Сила 20'», «Амрап 15'», «Часть А», «Разминка:») выделяются на сайте автоматически.</small></label>
    ${field('image', 'Скриншот', 'image', null, w.image)}
    <label class="field check"><input type="checkbox" name="active" value="1" ${w.active ? 'checked' : ''}> <span>Показывать на сайте</span></label>
    <div class="form-actions"><button class="btn btn-primary" type="submit">Сохранить</button></div>
  </form>
</div>
<div class="card" style="flex:1 1 320px; padding:20px">
  <p style="margin:0 0 10px; font-weight:700">Так это выглядит на сайте</p>
  <div class="wod-preview">${wodBlocks(w.blocks) || '<p style="color:var(--muted)">Нет текста</p>'}</div>
</div>
</div>`;
}


// ---------------------------------------------------------------------------
// Личный кабинет (публичная заглушка)
// ---------------------------------------------------------------------------
function cabinetPage({ s }) {
  return `${progHead(s, 'Личный кабинет', '')}
<body class="prog cab">
<header class="header"><div class="wrap header-in"><a class="logo" href="/"><img src="/static/img/logo-text.png" alt="CF BAZA" width="982" height="120"></a><div class="header-cta">
  <a class="btn btn-accent" href="/#contacts">${e(s.cta_header)}</a></div></div></header>
<main class="cab-main"><div class="wrap">
  <p class="eyebrow">Личный кабинет</p>
  <h1 class="h2">Скоро здесь будет <span class="accent">ваш кабинет</span></h1>
  <div class="cab-card">
    <span class="cab-badge">В разработке</span>
    <p>Мы делаем личный кабинет для атлетов CF BAZA.</p>
    <div class="cab-actions"><a class="btn btn-accent" href="/#contacts">${e(s.cta_header)}</a><a class="btn btn-white" href="/">На главную</a></div>
  </div>
  <p class="cab-staff"><a href="/admin/login">Вход для администратора →</a></p>
</div></main>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Админка: обзор и CRM
// ---------------------------------------------------------------------------
const fmtDate = (d) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');
const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c));

function adminDash({ leads, days, funnel, interests, clients, due, prog, metrika, status }) {
  const tile = (n, label, href, hot) => `<a class="tile${hot ? ' hot' : ''}" href="${href}"><b>${n}</b><span>${label}</span></a>`;
  const max = Math.max(1, ...days.map((x) => x.n));
  const bars = days.map((x) => `<div class="bar" title="${fmtDate(x.d)}: ${x.n}"><i style="height:${Math.round((x.n / max) * 100)}%"></i>${x.n ? `<em>${x.n}</em>` : ''}</div>`).join('');
  const fmax = Math.max(1, ...Object.keys(status).map((k) => funnel[k] || 0));
  const fun = Object.entries(status).map(([k, name]) => `<a class="frow" href="/admin/crm?st=${k}"><span>${e(name)}</span><span class="fbar"><i class="st-${k}" style="width:${Math.max(2, Math.round(((funnel[k] || 0) / fmax) * 100))}%"></i></span><b>${funnel[k] || 0}</b></a>`).join('');
  const imax = Math.max(1, ...interests.map((x) => x.n));
  const ints = interests.length ? interests.map((x) => `<div class="frow"><span>${e(x.name)}</span><span class="fbar"><i style="width:${Math.round((x.n / imax) * 100)}%"></i></span><b>${x.n}</b></div>`).join('') : '<p class="muted">Заявок пока нет.</p>';
  const dueList = due.length ? `<ul class="due">${due.map((c) => `<li><a href="/admin/crm/${c.id}"><b>${e(c.name || c.phone)}</b> <span>${e(status[c.status] || '')}</span></a><small>${fmtDate(c.next_date)}</small></li>`).join('')}</ul>` : '<p class="muted">На сегодня напоминаний нет. Дату следующего контакта можно поставить в карточке клиента.</p>';
  return `
<div class="topline"><h1>Обзор</h1><div style="display:flex; gap:8px; flex-wrap:wrap"><a class="btn" href="/" target="_blank">Сайт ↗</a>${metrika ? `<a class="btn" href="https://metrika.yandex.ru/dashboard?id=${e(metrika)}" target="_blank" rel="noopener">Посещаемость в Метрике ↗</a>` : ''}</div></div>
<div class="tiles">
  ${tile(leads.fresh, 'необработанных ' + plural(leads.fresh, 'заявка', 'заявки', 'заявок'), '/admin/leads?show=new', leads.fresh > 0)}
  ${tile(leads.today, 'заявок сегодня', '/admin/leads')}
  ${tile(leads.week, 'за 7 дней', '/admin/leads')}
  ${tile(leads.month, 'за 30 дней', '/admin/leads')}
  ${tile(clients.all, 'клиентов в базе', '/admin/crm')}
  ${tile(clients.becameMembers, 'купили абонемент за 30 дней', '/admin/crm?st=member')}
</div>
<div class="dash-grid">
  <section class="card pad"><h2>Заявки за 30 дней</h2><div class="bars">${bars}</div><div class="bars-axis"><span>${fmtDate(days[0].d)}</span><span>сегодня</span></div><p class="muted">Всего заявок за всё время: ${leads.all}.</p></section>
  <section class="card pad"><h2>Позвонить сегодня</h2>${dueList}</section>
  <section class="card pad"><h2>Воронка клиентов</h2><div class="funnel">${fun}</div><p class="muted">Новых клиентов за 30 дней: ${clients.month}. Нажмите на этап, чтобы увидеть список.</p></section>
  <section class="card pad"><h2>Что интересует (90 дней)</h2><div class="funnel">${ints}</div></section>
  <section class="card pad"><h2>Программа тренировок</h2><div class="tiles sm">${tile(prog.athletes, 'атлетов с профилем', '/admin/athletes')}${tile(prog.marks, 'отметок «сделал» за 7 дней', '/admin/program')}</div></section>
</div>`;
}

function stBadge(k, status) { return `<span class="badge st-${e(k)}">${e(status[k] || k)}</span>`; }

function adminCrm({ rows, st, q, counts, status, source, today, csrf }) {
  const total = Object.keys(status).reduce((a, k) => a + (counts[k] || 0), 0);
  const tab = (k, name, n) => `<a class="${st === k ? 'on' : ''}" href="/admin/crm${k ? '?st=' + k : ''}">${e(name)} · ${n}</a>`;
  const opts = (map, sel) => Object.entries(map).map(([k, v]) => `<option value="${e(k)}"${k === sel ? ' selected' : ''}>${e(v)}</option>`).join('');
  const body = rows.length ? `<table>
  <thead><tr><th>Клиент</th><th>Телефон</th><th>Этап</th><th class="hide-sm">Источник</th><th class="hide-sm">Связаться</th><th class="hide-sm">Обновлён</th></tr></thead>
  <tbody>${rows.map((c) => `<tr>
    <td><a href="/admin/crm/${c.id}" style="font-weight:700">${e(c.name || 'без имени')}</a>${c.note ? `<br><small class="muted">${e(c.note.slice(0, 80))}${c.note.length > 80 ? '…' : ''}</small>` : ''}</td>
    <td style="white-space:nowrap">${c.phone ? `<a href="tel:${e(c.phone)}">${e(c.phone)}</a>` : '—'}</td>
    <td>${stBadge(c.status, status)}</td>
    <td class="hide-sm">${e(source[c.source] || c.source)}</td>
    <td class="hide-sm" style="white-space:nowrap">${c.next_date ? `<span class="${c.next_date <= today && !['member', 'lost'].includes(c.status) ? 'overdue' : ''}">${fmtDate(c.next_date)}</span>` : '—'}</td>
    <td class="hide-sm" style="white-space:nowrap">${fmtDate(c.updated)}</td>
  </tr>`).join('')}</tbody></table>` : `<p class="empty">${q || st ? 'Никого не нашли.' : 'Клиентов пока нет. Они появятся с первой заявкой с сайта — или добавьте вручную.'}</p>`;
  return `
<div class="topline"><h1>Клиенты</h1><div style="display:flex; gap:8px; flex-wrap:wrap"><a class="btn" href="/admin/crm.csv">Скачать для Excel</a><button class="btn btn-primary" type="button" onclick="document.getElementById('addc').hidden=!document.getElementById('addc').hidden">+ Добавить клиента</button></div></div>
<p class="hint">Клиентская база копится сама: каждая заявка с сайта создаёт карточку (или добавляется к существующей по номеру телефона). Тех, кто позвонил или пришёл в зал, добавляйте вручную. Двигайте клиента по этапам и ставьте дату следующего контакта — она появится в «Обзоре».</p>
<form class="card edit addc" id="addc" method="post" hidden>
  <input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="action" value="add">
  <div class="row2"><label class="field"><span>Имя</span><input type="text" name="name" maxlength="80"></label><label class="field"><span>Телефон</span><input type="text" name="phone" maxlength="40" inputmode="tel"></label></div>
  <div class="row2"><label class="field"><span>Откуда</span><select name="source">${opts(source, 'call')}</select></label><label class="field"><span>Этап</span><select name="status">${opts(status, 'new')}</select></label></div>
  <label class="field"><span>Заметка</span><textarea name="note" rows="2"></textarea></label>
  <div class="form-actions"><button class="btn btn-primary">Добавить</button></div>
</form>
<form class="search" method="get"><input type="text" name="q" value="${e(q)}" placeholder="Поиск по имени или телефону">${st ? `<input type="hidden" name="st" value="${e(st)}">` : ''}<button class="btn">Найти</button></form>
<nav class="tabs">${tab('', 'Все', total)}${counts.due ? `<a class="${st === 'due' ? 'on' : ''} due-tab" href="/admin/crm?st=due">Связаться сегодня · ${counts.due}</a>` : ''}${Object.entries(status).map(([k, v]) => tab(k, v, counts[k] || 0)).join('')}</nav>
<div class="card table-wrap">${body}</div>`;
}

function adminCrmCard({ c, log, leads, status, source, today, csrf }) {
  const KIND = { lead: 'Заявка', status: 'Этап', call: 'Звонок', visit: 'Визит', note: 'Заметка', pay: 'Оплата' };
  const opts = (map, sel) => Object.entries(map).map(([k, v]) => `<option value="${e(k)}"${k === sel ? ' selected' : ''}>${e(v)}</option>`).join('');
  const hid = `<input type="hidden" name="csrf" value="${e(csrf)}">`;
  const steps = Object.entries(status).map(([k, v]) => `<button class="step st-${k}${k === c.status ? ' on' : ''}" name="status" value="${k}">${e(v)}</button>`).join('');
  return `
<div class="topline"><h1>${e(c.name || 'Без имени')}</h1><a class="btn" href="/admin/crm">← Все клиенты</a></div>
<div class="crm-quick">
  ${c.phone ? `<a class="btn btn-primary" href="tel:${e(c.phone)}">📞 ${e(c.phone)}</a>` : ''}
  <span class="muted">${e(source[c.source] || c.source)} · в базе с ${fmtDate(c.created)}</span>
</div>
<form class="steps" method="post">${hid}<input type="hidden" name="action" value="status">${steps}</form>
<div class="crm-grid">
  <section class="card pad">
    <h2>История</h2>
    <form class="logform" method="post">${hid}<input type="hidden" name="action" value="log">
      <div class="row2"><select name="kind"><option value="call">Звонок</option><option value="note">Заметка</option><option value="visit">Визит</option><option value="pay">Оплата</option></select>
      <label class="next"><span>Связаться</span><input type="date" name="next_date" value="${e(c.next_date)}" min="${today}"></label></div>
      <textarea name="text" rows="2" placeholder="Что обсудили, договорённости…"></textarea>
      <div class="form-actions"><button class="btn btn-primary">Добавить</button></div>
    </form>
    ${log.length ? `<ol class="log">${log.map((x) => `<li class="k-${e(x.kind)}"><small>${e(x.created || '')} · ${e(KIND[x.kind] || x.kind)}</small><div>${e(x.text)}</div></li>`).join('')}</ol>` : '<p class="muted">Записей пока нет.</p>'}
  </section>
  <section class="card pad">
    <h2>Данные клиента</h2>
    <form class="edit flat" method="post">${hid}<input type="hidden" name="action" value="save">
      <label class="field"><span>Имя</span><input type="text" name="name" value="${e(c.name)}" maxlength="80"></label>
      <label class="field"><span>Телефон</span><input type="text" name="phone" value="${e(c.phone)}" maxlength="40"></label>
      <div class="row2"><label class="field"><span>Этап</span><select name="status">${opts(status, c.status)}</select></label><label class="field"><span>Откуда</span><select name="source">${opts(source, c.source)}</select></label></div>
      <label class="field"><span>Следующий контакт</span><input type="date" name="next_date" value="${e(c.next_date)}"></label>
      <label class="field"><span>Заметка о клиенте</span><textarea name="note" rows="4" placeholder="Цели, ограничения по здоровью, удобное время…">${e(c.note)}</textarea></label>
      <div class="form-actions"><button class="btn btn-primary">Сохранить</button></div>
    </form>
    ${leads.length ? `<h3>Заявки с сайта</h3><ul class="due">${leads.map((l) => `<li><span>${e(l.interest || 'без уточнения')}</span><small>${e(l.created)}</small></li>`).join('')}</ul>` : ''}
    <form method="post" style="margin-top:20px">${hid}<input type="hidden" name="action" value="delete"><button class="btn btn-sm btn-danger" onclick="return confirm('Удалить клиента и всю историю? Это нельзя отменить.')">Удалить клиента</button></form>
  </section>
</div>`;
}

module.exports = { cabinetPage, adminDash, adminCrm, adminCrmCard, mePage, programPage, ratingPage, adminAthletes, adminProgram, adminProgramEdit, site, legalDoc, requisitesPage, adminPage, login, leads, settingsPage, listPage, formPage, passwordPage, e };
