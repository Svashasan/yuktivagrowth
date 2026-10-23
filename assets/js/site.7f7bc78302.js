/* Yuktiva Growth: shared site script (vanilla JS, no dependencies).
   Reads the per-page config that the build inlines as window.YG.
   Every storage call is wrapped in try/catch so private browsing or blocked storage never breaks the page. */
(function () {
  'use strict';

  var Y = window.YG || {};
  var doc = document, body = doc.body, html = doc.documentElement;
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var store = {
    get: function (area, k) { try { return window[area].getItem(k); } catch (e) { return null; } },
    set: function (area, k, v) { try { window[area].setItem(k, v); return true; } catch (e) { return false; } },
    del: function (area, k) { try { window[area].removeItem(k); } catch (e) {} }
  };

  /* ---------------- Currency ---------------- */
  var ALL_CUR = ['USD', 'AED', 'SAR', 'QAR', 'GBP', 'EUR', 'INR'];
  function tzCurrency() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (tz === 'Asia/Dubai') return 'AED';
    if (tz === 'Asia/Riyadh') return 'SAR';
    if (tz === 'Asia/Qatar') return 'QAR';
    if (tz === 'Europe/London') return 'GBP';
    if (tz.indexOf('Europe/') === 0) return 'EUR';
    if (tz.indexOf('America/') === 0) return 'USD';
    if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'INR';
    return 'USD';
  }
  /* Priority: the visitor's explicit choice this session > the page's market currency > time zone. */
  function preferredCurrency(allowed) {
    allowed = allowed || ALL_CUR;
    var pick = function (c) { return c && allowed.indexOf(c) >= 0 ? c : null; };
    return pick(store.get('sessionStorage', 'yg_currency')) || pick(body.getAttribute('data-currency')) ||
      pick(tzCurrency()) || (allowed.indexOf('USD') >= 0 ? 'USD' : allowed[0]);
  }
  var activeCurrency = preferredCurrency();

  /* ---------------- dataLayer ---------------- */
  window.dataLayer = window.dataLayer || [];
  function track(event, params) {
    var p = { event: event, page: location.pathname, market: body.getAttribute('data-market') || 'global', currency: activeCurrency };
    if (params) for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k];
    window.dataLayer.push(p);
  }

  /* ---------------- Consent ---------------- */
  var C = Y.consent || {};
  var KEY = C.key || 'yg_consent';
  function readConsent() {
    try {
      var c = JSON.parse(store.get('localStorage', KEY) || 'null');
      if (!c || c.v !== C.version) return null;
      if (Date.now() - c.t > (C.repromptDays || 365) * 864e5) return null;
      return c;
    } catch (e) { return null; }
  }
  function storageAllowed() { var c = readConsent(); return !!(c && (c.a || c.m)); }

  var banner = $('#consent');
  function applyConsent(a, m, source) {
    var c = { v: C.version, t: Date.now(), a: !!a, m: !!m };
    store.set('localStorage', KEY, JSON.stringify(c));
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        analytics_storage: a ? 'granted' : 'denied',
        ad_storage: m ? 'granted' : 'denied',
        ad_user_data: m ? 'granted' : 'denied',
        ad_personalization: m ? 'granted' : 'denied'
      });
    }
    track('consent_update', { consent_analytics: a ? 'granted' : 'denied', consent_ads: m ? 'granted' : 'denied', consent_source: source });
    if (a || m) persistAttribution(); else store.del('sessionStorage', 'yg_attr');
    closeBanner();
  }
  function openBanner(withSettings, moveFocus) {
    if (!banner) return;
    var c = readConsent();
    var a = $('#consent-analytics'), m = $('#consent-ads');
    if (a) a.checked = !!(c && c.a);
    if (m) m.checked = !!(c && c.m);
    $('#consent-settings').hidden = !withSettings;
    $('#consent-save').hidden = !withSettings;
    banner.hidden = false;
    body.classList.add('consent-open');
    if (moveFocus) { var h = $('#consent-title'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } }
  }
  function closeBanner() { if (banner) banner.hidden = true; body.classList.remove('consent-open'); }
  if (banner) {
    $('#consent-accept').addEventListener('click', function () { applyConsent(true, true, 'accept_all'); });
    $('#consent-reject').addEventListener('click', function () { applyConsent(false, false, 'reject_all'); });
    $('#consent-toggle').addEventListener('click', function () {
      var s = $('#consent-settings'), open = s.hidden;
      s.hidden = !open; $('#consent-save').hidden = !open;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $('#consent-save').addEventListener('click', function () {
      applyConsent($('#consent-analytics').checked, $('#consent-ads').checked, 'settings');
    });
    var wantBanner = C.banner === 'always' || (C.banner === 'auto' && C.gtmActive);
    if (wantBanner && !readConsent()) openBanner(false, false);
  }
  $$('[data-consent-open]').forEach(function (b) {
    b.addEventListener('click', function () { openBanner(true, true); });
  });

  /* ---------------- Attribution (UTM, click IDs, landing page, referrer) ----------------
     Read from the URL on every page. Kept in sessionStorage only after the visitor has accepted
     analytics or advertising, so nothing is stored on the device without consent. */
  var ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  var attribution = (function () {
    var fromUrl = {}, hasUrl = false;
    try {
      var sp = new URLSearchParams(location.search);
      ATTR_KEYS.forEach(function (k) { var v = sp.get(k); if (v) { fromUrl[k] = v.slice(0, 200); hasUrl = true; } });
    } catch (e) {}
    var saved = null;
    try { saved = JSON.parse(store.get('sessionStorage', 'yg_attr') || 'null'); } catch (e) {}
    if (hasUrl || !saved) {
      fromUrl.landing_page = location.href.slice(0, 500);
      fromUrl.referrer = (doc.referrer || '').slice(0, 500);
      return fromUrl;
    }
    return saved;
  })();
  function persistAttribution() { store.set('sessionStorage', 'yg_attr', JSON.stringify(attribution)); }
  if (storageAllowed()) persistAttribution();
  $$('input[data-attr]').forEach(function (i) { i.value = attribution[i.name] || ''; });

  /* ---------------- Click events ---------------- */
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var where = a.closest('footer') ? 'footer' : a.closest('header') ? 'header' : 'page';
    if (href.indexOf('zohobookings') > -1) track('booking_click', { link_location: where });
    else if (href.indexOf('mailto:') === 0) track('email_click', { link_location: where });
  });
  var caseId = body.getAttribute('data-case');
  if (caseId) track('case_study_view', { case_id: caseId });

  /* ---------------- Mobile navigation ---------------- */
  var nav = $('#nav'), tog = $('.nav__toggle'), cls = $('.nav__close');
  if (nav && tog) {
    var setNav = function (open) {
      nav.classList.toggle('is-open', open);
      tog.setAttribute('aria-expanded', open ? 'true' : 'false');
      body.style.overflow = open ? 'hidden' : '';
      if (open && cls) cls.focus(); else if (!open) tog.focus();
    };
    tog.addEventListener('click', function () { setNav(true); });
    if (cls) cls.addEventListener('click', function () { setNav(false); });
    $$('a', nav).forEach(function (l) { l.addEventListener('click', function () { if (nav.classList.contains('is-open')) setNav(false); }); });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('is-open')) setNav(false); });
  }

  /* ---------------- Counters: the final value is already in the HTML.
     Animate from 0 only once the element is in view, and never under reduced motion. ---------------- */
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var countIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target, finalText = el.textContent;
        countIO.unobserve(el);
        var end = parseFloat(el.getAttribute('data-count')), dec = +el.getAttribute('data-decimals') || 0;
        var pre = el.getAttribute('data-prefix') || '', suf = el.getAttribute('data-suffix') || '', t0 = null;
        requestAnimationFrame(function step(t) {
          t0 = t0 || t;
          var p = Math.min((t - t0) / 1200, 1);
          el.textContent = p < 1 ? pre + (end * (1 - Math.pow(1 - p, 3))).toFixed(dec) + suf : finalText;
          if (p < 1) requestAnimationFrame(step);
        });
      });
    }, { threshold: 0.6 });
    $$('[data-count]').forEach(function (el) { countIO.observe(el); });
  }

  /* ---------------- Money formatting ---------------- */
  function money(n, cur) {
    try { return new Intl.NumberFormat(html.lang || 'en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n); }
    catch (e) { return cur + ' ' + Math.round(n).toLocaleString(); }
  }

  /* ---------------- Ad-spend calculator ---------------- */
  var cf = $('#calc-form');
  if (cf) {
    var cur = $('#c-cur'), spend = $('#c-spend'), leads = $('#c-leads'), qual = $('#c-qual');
    var out = $('#calc-out'), err = $('#c-err'), sum = $('#calc-summary');
    var opts = $$('option', cur).map(function (o) { return o.value; });
    cur.value = preferredCurrency(opts);
    var reported = false, timer = null;
    var num = function (el) { var v = el.value.trim(); return v === '' ? null : Number(v); };
    var calc = function () {
      var s = num(spend), l = num(leads), q = num(qual), c = cur.value;
      err.textContent = '';
      [spend, leads, qual].forEach(function (f) { f.removeAttribute('aria-invalid'); });
      if (s === null || l === null || q === null) { out.setAttribute('data-state', 'empty'); sum.textContent = ''; return; }
      var bad = null;
      if (!(s > 0)) bad = [spend, 'Enter your monthly ad spend as a number above zero.'];
      else if (!(l > 0) || Math.floor(l) !== l) bad = [leads, 'Enter the number of leads as a whole number above zero.'];
      else if (q < 0 || Math.floor(q) !== q) bad = [qual, 'Enter the number of qualified leads as a whole number, zero or more.'];
      else if (q > l) bad = [qual, 'Qualified leads cannot be more than total leads.'];
      if (bad) { bad[0].setAttribute('aria-invalid', 'true'); err.textContent = bad[1]; out.setAttribute('data-state', 'empty'); sum.textContent = ''; return; }
      var pct = (l - q) / l, waste = s * pct;
      $('#c-waste').textContent = money(waste, c);
      $('#c-bar').style.width = (pct * 100).toFixed(1) + '%';
      $('#c-pct').textContent = Math.round(pct * 100) + '% of your leads did not qualify.';
      $('#c-cpl').textContent = money(s / l, c);
      $('#c-cpql').textContent = q > 0 ? money(s / q, c) : 'No qualified leads yet';
      $('#c-year').textContent = money(waste * 12, c);
      out.setAttribute('data-state', 'result');
      sum.textContent = 'Estimated monthly spend on unqualified leads: ' + money(waste, c) + '.';
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (reported) return;
        reported = true;
        track('calculator_complete', { currency: c, unqualified_share: Math.round(pct * 100) });
      }, 900);
    };
    cur.addEventListener('change', function () {
      activeCurrency = cur.value;
      store.set('sessionStorage', 'yg_currency', cur.value);
      calc();
    });
    [spend, leads, qual].forEach(function (f) { f.addEventListener('input', calc); });
    cf.addEventListener('submit', function (e) { e.preventDefault(); calc(); });
  }

  /* ---------------- Pricing currency toggle ---------------- */
  $$('[data-currency-toggle]').forEach(function (group) {
    var btns = $$('button[data-cur]', group);
    var allowed = btns.map(function (b) { return b.getAttribute('data-cur'); });
    var show = function (c, save) {
      btns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-cur') === c ? 'true' : 'false'); });
      $$('[data-cur-show]').forEach(function (el) { el.hidden = el.getAttribute('data-cur-show') !== c; });
      activeCurrency = c;
      if (save) store.set('sessionStorage', 'yg_currency', c);
    };
    btns.forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-cur'), true); }); });
    show(preferredCurrency(allowed), false);
  });

  /* ---------------- Working hours in the visitor's own time zone ---------------- */
  $$('[data-local-hours]').forEach(function (el) {
    var s = el.getAttribute('data-start'), e2 = el.getAttribute('data-end');
    if (!s || !e2) return;
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      var toLocal = function (hm) {
        var p = hm.split(':'), d = new Date();
        var utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +p[0], +p[1]) - 330 * 60000; /* IST = UTC+5:30 */
        return new Intl.DateTimeFormat(html.lang || 'en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(utc));
      };
      el.textContent = (el.getAttribute('data-label') || 'In your time zone') + ' (' + tz + '): ' + toLocal(s) + '–' + toLocal(e2);
      el.hidden = false;
    } catch (x) {}
  });

  /* ---------------- Forms: validation, submission, success and error states ---------------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var SITE_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;
  $$('form[data-form]').forEach(function (form) {
    var kind = form.getAttribute('data-form');
    var status = $('[data-status]', form);
    var submit = $('button[type="submit"]', form);
    var done = form.id ? doc.getElementById(form.id + '-done') : null;
    var msg = function (type, text) { status.setAttribute('data-type', type); status.innerHTML = text; };
    var setErr = function (field, text) {
      var errEl = doc.getElementById(field.getAttribute('aria-describedby') ? field.getAttribute('aria-describedby').split(' ')[0] : '');
      if (text) field.setAttribute('aria-invalid', 'true'); else field.removeAttribute('aria-invalid');
      if (errEl) errEl.textContent = text || '';
    };
    var check = function (field) {
      var v = field.type === 'checkbox' ? field.checked : field.value.trim();
      var label = field.getAttribute('data-label') || 'This field';
      if (field.required && !v) return field.type === 'checkbox' ? 'Please tick this box to continue.' : label + ' is required.';
      if (v && field.type === 'email' && !EMAIL_RE.test(v)) return 'Enter an email address like name@company.com.';
      if (v && field.getAttribute('data-kind') === 'url' && !SITE_RE.test(v)) return 'Enter a website address like yourcompany.com.';
      return '';
    };
    var fields = $$('input:not([type="hidden"]):not([name="company_fax"]), select, textarea', form);
    fields.forEach(function (f) {
      f.addEventListener('blur', function () { if (f.getAttribute('aria-invalid')) setErr(f, check(f)); });
      f.addEventListener('change', function () { if (f.getAttribute('aria-invalid')) setErr(f, check(f)); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.textContent = ''; status.removeAttribute('data-type');
      var first = null;
      fields.forEach(function (f) { var t = check(f); setErr(f, t); if (t && !first) first = f; });
      if (first) { msg('error', 'Please fix the highlighted fields.'); first.focus(); return; }
      var hp = $('[name="company_fax"]', form);
      if (hp && hp.value) { showDone(); return; } /* bots get a fake success */

      var fd = new FormData(form);
      fd.delete('company_fax');
      fd.append('form_id', kind);
      fd.append('page_market', body.getAttribute('data-market') || 'global');
      fd.append('submitted_at', new Date().toISOString());
      var evt = kind === 'enquiry' ? 'generate_lead' : 'teardown_request';
      var evtParams = { form_id: kind, country: fd.get('country') || '', budget_band: fd.get('budget') || '', service_goal: fd.get('goal') || '' };

      if (!Y.endpoint) {
        var lines = [];
        fd.forEach(function (val, k) { if (k !== 'consent' && val) lines.push(k + ': ' + val); });
        var subject = (kind === 'enquiry' ? 'Enquiry from ' : 'Free teardown request from ') + (fd.get('name') || '');
        evtParams.method = 'mailto';
        track(evt, evtParams);
        location.href = 'mailto:' + Y.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
        msg('info', 'Your email app should now open with your message filled in. Please press send there. If nothing opened, email <a href="mailto:' + Y.email + '">' + Y.email + '</a>.');
        return;
      }
      submit.setAttribute('aria-busy', 'true'); submit.disabled = true;
      msg('info', 'Sending…');
      fetch(Y.endpoint, { method: 'POST', body: fd, headers: { Accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); evtParams.method = 'endpoint'; track(evt, evtParams); showDone(); })
        .catch(function () {
          msg('error', 'Sorry, that did not send. Your details are still here, so please try again, or email <a href="mailto:' + Y.email + '">' + Y.email + '</a>.');
        })
        .then(function () { submit.removeAttribute('aria-busy'); submit.disabled = false; });
    });
    function showDone() {
      if (!done) { msg('success', 'Thanks, your message has been sent.'); return; }
      form.hidden = true; done.classList.add('is-shown'); done.focus();
    }
  });
})();
