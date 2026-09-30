/* FixCore — shared page shell (header, mobile menu, active link, fallbacks).
   Page-specific logic (login, Discord, checkout) stays inside each page. */
(function(){
  'use strict';

  // Don't let other sites show this page inside an invisible frame (clickjacking).
  if (window.top !== window.self){
    try { window.top.location = window.location.href; }
    catch (e) { document.documentElement.style.display = 'none'; }
    return;
  }

  var header = document.getElementById('siteHeader');
  function onScroll(){ if (header) header.classList.toggle('scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- mobile menu ----------
  var ham = document.getElementById('hamburger');
  var list = document.getElementById('navLinks');
  function setMenu(open){
    if (!ham || !list) return;
    list.classList.toggle('open', open);
    ham.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (ham && list){
    ham.addEventListener('click', function(e){
      e.stopPropagation();
      setMenu(!list.classList.contains('open'));
    });
    list.addEventListener('click', function(e){ if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('click', function(e){
      if (list.classList.contains('open') && !e.target.closest('.nav')) setMenu(false);
    });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', function(){ if (window.innerWidth > 1200) setMenu(false); });
  }

  // ---------- active nav link (page + scroll position) ----------
  if (list){
    var links = [].slice.call(list.querySelectorAll('a'));
    var ALIAS = { 'fixcore-2-1.html': 'products.html', 'nettboost.html': 'products.html', 'callback.html': 'index.html', '': 'index.html' };
    var norm = function(n){ n = (n || '').toLowerCase(); return ALIAS[n] || n; };
    var page = norm(location.pathname.split('/').pop());
    var fileOf = function(href){ var p = href.split('#')[0]; return p === '' ? page : norm(p.split('/').pop()); };
    var setActive = function(el){ links.forEach(function(a){ a.classList.toggle('is-active', a === el); }); };
    var pageLink = null, spy = [];
    links.forEach(function(a){
      var href = a.getAttribute('href') || '';
      var hash = href.indexOf('#') > -1 ? href.split('#')[1] : '';
      if (fileOf(href) !== page) return;
      if (hash && hash !== 'top'){
        var t = document.getElementById(hash);
        if (t) spy.push({ a: a, t: t });
      } else if (!pageLink) pageLink = a;
    });
    if (!spy.length){ if (pageLink) setActive(pageLink); }
    else {
      var update = function(){
        var y = window.scrollY + 160, cur = pageLink, best = -1;
        spy.forEach(function(s){
          if (s.t.offsetParent === null) return;
          var top = s.t.getBoundingClientRect().top + window.scrollY;
          if (top <= y && top > best){ best = top; cur = s.a; }
        });
        setActive(cur);
      };
      window.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      update();
    }
  }

  // ---------- cart drawer (pages without their own cart logic) ----------
  var cartBtn = document.querySelector('[data-fc-cart]');
  var cartOverlay = document.getElementById('cartOverlay');
  if (cartBtn && cartOverlay){
    var openCart = function(){ cartOverlay.classList.add('open'); document.body.style.overflow = 'hidden'; };
    var closeCart = function(){ cartOverlay.classList.remove('open'); document.body.style.overflow = ''; };
    cartBtn.addEventListener('click', openCart);
    var cartClose = document.getElementById('cartClose');
    if (cartClose) cartClose.addEventListener('click', closeCart);
    cartOverlay.addEventListener('click', function(e){ if (e.target === cartOverlay) closeCart(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeCart(); });
  }

  // ---------- account button (pages without an account panel) ----------
  var profileBtn = document.querySelector('[data-fc-profile]');
  if (profileBtn){
    profileBtn.addEventListener('click', function(){
      var signedIn = false;
      try { signedIn = !!(localStorage.getItem('fixcore_email_user') || localStorage.getItem('fixcore_discord_user')); } catch (e) { /* ignore */ }
      if (signedIn){ window.location.href = 'index.html#account'; return; }
      var login = document.getElementById('openLogin');
      if (login) login.click();
    });
  }

  // ---------- hero preview: product switch + screenshots ----------
  var hp = document.getElementById('heroPreview');
  if (hp){
    var hpImg = document.getElementById('heroPreviewImg');
    var hpSpot = document.getElementById('heroSpotlight');
    var hpPrev = document.getElementById('heroPreviewPrev');
    var hpNext = document.getElementById('heroPreviewNext');
    var hpTitle = hp.querySelector('[data-hp-title]');
    var hpVer = hp.querySelector('[data-hp-ver]');
    var hpNote = hp.querySelector('[data-hp-note]');
    var tabs = [].slice.call(hp.querySelectorAll('.ps-btn'));
    var groups = [].slice.call(hp.querySelectorAll('.app-thumbs[data-product]'));
    var product = 'fixcore', idx = 0;
    var shots = function(p){ return [].slice.call(hp.querySelectorAll('.app-thumbs[data-product="' + p + '"] .app-thumb')); };
    var show = function(i){
      var list = shots(product);
      if (!list.length) return;
      idx = (i + list.length) % list.length;
      var btn = list[idx];
      list.forEach(function(t, k){ t.classList.toggle('active', k === idx); t.setAttribute('aria-pressed', k === idx ? 'true' : 'false'); });
      var src = btn.getAttribute('data-src');
      hpImg.alt = btn.getAttribute('data-alt') || '';
      if (hpImg.getAttribute('src') === src) return;
      hpImg.classList.add('is-swapping');
      var pre = new Image();
      pre.onload = pre.onerror = function(){ hpImg.src = src; hpImg.classList.remove('is-swapping'); };
      pre.src = src;
    };
    var setProduct = function(p, focus){
      var tab = tabs.filter(function(t){ return t.getAttribute('data-product') === p; })[0];
      if (!tab) return;
      product = p;
      hp.setAttribute('data-product', p);
      tabs.forEach(function(t){
        var on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      if (focus) tab.focus();
      groups.forEach(function(g){ g.hidden = g.getAttribute('data-product') !== p; });
      if (hpTitle) hpTitle.textContent = tab.getAttribute('data-title');
      if (hpVer) hpVer.textContent = tab.getAttribute('data-ver');
      if (hpNote) hpNote.textContent = tab.getAttribute('data-note');
      var has = shots(p).length > 0;
      hpImg.hidden = !has; hpPrev.hidden = !has; hpNext.hidden = !has;
      if (hpSpot) hpSpot.hidden = has;
      if (has) show(0);
    };
    tabs.forEach(function(t){
      t.addEventListener('click', function(){ setProduct(t.getAttribute('data-product')); });
      t.addEventListener('keydown', function(e){
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var k = (tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        setProduct(tabs[k].getAttribute('data-product'), true);
      });
    });
    groups.forEach(function(g){
      g.addEventListener('click', function(e){
        var b = e.target.closest('.app-thumb');
        if (b) show(shots(product).indexOf(b));
      });
    });
    hpNext.addEventListener('click', function(){ show(idx + 1); });
    hpPrev.addEventListener('click', function(){ show(idx - 1); });
    setProduct('fixcore');
  }

  // ---------- reveal on scroll ----------
  var reveal = document.querySelectorAll('[data-reveal]');
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reveal.length && 'IntersectionObserver' in window && !calm){
    document.documentElement.classList.add('has-reveal');
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if (en.isIntersecting){ en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    [].forEach.call(reveal, function(el){ io.observe(el); });
  }

  // ---------- launch offer countdown (config: window.FC_PROMO in <head>) ----------
  var promo = window.FC_PROMO;
  if (promo){
    var root = document.documentElement;
    var promoEnd = Date.parse(promo.endsAt);
    var pad = function(n){ return (n < 10 ? '0' : '') + n; };
    var fmtLeft = function(ms){
      var s = Math.max(0, Math.floor(ms / 1000));
      var d = Math.floor(s / 86400); s %= 86400;
      var h = Math.floor(s / 3600); s %= 3600;
      var m = Math.floor(s / 60); s %= 60;
      return (d ? d + 'd ' : '') + pad(h) + 'h ' + pad(m) + 'm ' + pad(s) + 's';
    };
    var promoTimer = null;
    var promoTick = function(){
      var left = promoEnd - Date.now();
      if (!(left > 0)){
        if (!root.classList.contains('promo-ended')){
          root.classList.add('promo-ended');
          document.dispatchEvent(new CustomEvent('fc:promo-ended'));
        }
        if (promoTimer) clearInterval(promoTimer);
        return;
      }
      var txt = fmtLeft(left);
      [].forEach.call(document.querySelectorAll('[data-promo-countdown]'), function(el){ el.textContent = txt; });
    };
    promoTick();
    if (!root.classList.contains('promo-ended')) promoTimer = setInterval(promoTick, 1000);
  }

  // ---------- footer year ----------
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
