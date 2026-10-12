/* FixCore — emergency shutdown screen.
   Loaded in the <head> of every public page. When the emergency button on the
   admin page is on, the page is replaced by a "something is wrong" screen.
   If the server can't be reached, the site stays as it is. */
(function(){
  'use strict';
  var API = 'https://web-production-fae792.up.railway.app/api/site-status';
  var CACHE_KEY = 'fixcoreEmergency';
  var CHECK_EVERY_MS = 30000;
  var html = document.documentElement;
  var shown = false, timer = null;

  var css = '' +
    'html.fc-down,html.fc-down body{overflow:hidden !important;}' +
    'html.fc-down body > *:not(#fc-down){display:none !important;}' +
    '#fc-down{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:28px 20px;' +
      'background:radial-gradient(ellipse 70% 55% at 50% 0%,rgba(255,59,92,.22),transparent 70%),radial-gradient(ellipse 60% 50% at 50% 110%,rgba(255,59,92,.12),transparent 70%),#06060d;' +
      'color:#f2f2fb;font-family:var(--font-body,"Inter",system-ui,-apple-system,"Segoe UI",sans-serif);text-align:center;overflow:auto;}' +
    '#fc-down::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.35;' +
      'background-image:linear-gradient(rgba(255,80,110,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,80,110,.07) 1px,transparent 1px);background-size:44px 44px;' +
      '-webkit-mask-image:radial-gradient(ellipse 60% 60% at 50% 40%,#000,transparent 75%);mask-image:radial-gradient(ellipse 60% 60% at 50% 40%,#000,transparent 75%);}' +
    '.fcd-box{position:relative;max-width:640px;width:100%;}' +
    '.fcd-logo{height:34px;width:auto;margin:0 auto 34px;display:block;opacity:.95;}' +
    '.fcd-badge{display:inline-flex;align-items:center;gap:10px;padding:8px 16px 8px 13px;border-radius:999px;border:1px solid rgba(255,77,106,.55);' +
      'background:rgba(255,59,92,.12);color:#ff8a9d;font-size:12.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-bottom:26px;}' +
    '.fcd-dot{width:9px;height:9px;border-radius:50%;background:#ff3b5c;box-shadow:0 0 0 0 rgba(255,59,92,.7);animation:fcdPulse 1.6s infinite;}' +
    '@keyframes fcdPulse{0%{box-shadow:0 0 0 0 rgba(255,59,92,.65);}70%{box-shadow:0 0 0 12px rgba(255,59,92,0);}100%{box-shadow:0 0 0 0 rgba(255,59,92,0);}}' +
    '.fcd-box h1{font-family:var(--font-display,inherit);font-size:clamp(30px,5.4vw,46px);line-height:1.08;margin:0 0 16px;letter-spacing:-.01em;}' +
    '.fcd-box h1 span{color:#ff4d6a;}' +
    '.fcd-lead{color:#b4b6cf;font-size:16.5px;line-height:1.6;margin:0 auto 26px;max-width:470px;}' +
    '.fcd-note{text-align:left;border:1px solid rgba(255,77,106,.35);border-left:3px solid #ff3b5c;background:rgba(255,59,92,.07);' +
      'border-radius:12px;padding:14px 18px;margin:0 0 26px;font-size:14.5px;line-height:1.55;color:#e6e7f5;}' +
    '.fcd-note b{display:block;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:#ff8a9d;margin-bottom:4px;}' +
    '.fcd-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:22px;}' +
    '.fcd-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:46px;padding:0 22px;border-radius:10px;font:inherit;font-size:14.5px;font-weight:600;cursor:pointer;text-decoration:none;transition:transform .15s,background .15s,border-color .15s;}' +
    '.fcd-btn:hover{transform:translateY(-1px);}' +
    '.fcd-btn:focus-visible{outline:2px solid #ff8a9d;outline-offset:3px;}' +
    '.fcd-primary{border:0;background:linear-gradient(135deg,#ff3b5c,#c3214a);color:#fff;box-shadow:0 8px 28px -8px rgba(255,59,92,.6);}' +
    '.fcd-ghost{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.03);color:#e6e7f5;}' +
    '.fcd-ghost:hover{border-color:rgba(255,255,255,.3);}' +
    '.fcd-meta{color:#7d7f9c;font-size:13px;}' +
    '@media (prefers-reduced-motion:reduce){.fcd-dot{animation:none;}.fcd-btn{transition:none;}}' +
    /* announcement banner */
    '#fc-banner{position:fixed;left:50%;bottom:18px;transform:translate(-50%,24px);opacity:0;z-index:2147483000;display:flex;align-items:center;gap:14px;' +
      'max-width:min(760px,calc(100% - 24px));width:max-content;padding:11px 12px 11px 18px;border-radius:14px;color:#fff;font-family:var(--font-body,system-ui,sans-serif);font-size:14.5px;line-height:1.4;' +
      'box-shadow:0 18px 40px -12px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px);transition:transform .35s ease,opacity .35s ease;}' +
    '#fc-banner.show{transform:translate(-50%,0);opacity:1;}' +
    '#fc-banner.info{background:linear-gradient(135deg,rgba(0,150,220,.92),rgba(70,90,240,.92));}' +
    '#fc-banner.sale{background:linear-gradient(135deg,rgba(168,85,247,.94),rgba(236,72,153,.94));}' +
    '#fc-banner.warning{background:linear-gradient(135deg,rgba(245,158,11,.95),rgba(234,88,12,.95));}' +
    '#fc-banner .fcb-text{flex:1;min-width:0;}' +
    '#fc-banner a.fcb-link{flex-shrink:0;color:#111;background:#fff;border-radius:9px;padding:7px 13px;font-weight:700;font-size:13.5px;text-decoration:none;white-space:nowrap;}' +
    '#fc-banner a.fcb-link:hover{background:#f1f1f6;}' +
    '#fc-banner button.fcb-x{flex-shrink:0;width:30px;height:30px;border:0;border-radius:8px;background:rgba(255,255,255,.16);color:#fff;font-size:18px;line-height:1;cursor:pointer;}' +
    '#fc-banner button.fcb-x:hover{background:rgba(255,255,255,.28);}' +
    '@media (max-width:560px){#fc-banner{width:calc(100% - 20px);bottom:10px;font-size:13.5px;gap:10px;}}' +
    '@media (prefers-reduced-motion:reduce){#fc-banner{transition:none;}}' +
    /* products that are switched off */
    '.fc-closed{opacity:.55 !important;cursor:not-allowed !important;filter:grayscale(.6);}';

  function addStyle(){
    if (document.getElementById('fc-down-style')) return;
    var st = document.createElement('style');
    st.id = 'fc-down-style';
    st.textContent = css;
    (document.head || html).appendChild(st);
  }

  function ago(iso){
    var t = new Date(iso).getTime();
    if (!iso || isNaN(t)) return '';
    var min = Math.max(0, Math.round((Date.now() - t) / 60000));
    var clock = new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    var rel = min < 1 ? 'just now' : min < 60 ? min + ' min ago' : Math.round(min / 60) + ' h ago';
    return 'Offline since ' + clock + ' (' + rel + ')';
  }

  function render(state){
    addStyle();
    html.classList.add('fc-down');
    var box = document.getElementById('fc-down');
    if (!box){
      if (!document.body){ document.addEventListener('DOMContentLoaded', function(){ render(state); }); return; }
      box = document.createElement('div');
      box.id = 'fc-down';
      box.setAttribute('role', 'alert');
      box.innerHTML =
        '<div class="fcd-box">' +
          '<img class="fcd-logo" src="assets/fixcore-logo.svg" alt="FixCore">' +
          '<div class="fcd-badge"><span class="fcd-dot"></span>Temporarily offline</div>' +
          '<h1>Something\u2019s not right.<br><span>We\u2019re on it.</span></h1>' +
          '<p class="fcd-lead">We\u2019ve paused fixcorepc.com while we look into a problem. There\u2019s nothing you need to do \u2014 the site will be back as soon as it\u2019s fixed.</p>' +
          '<div class="fcd-note" hidden><b>Update from the team</b><span class="fcd-msg"></span></div>' +
          '<div class="fcd-actions">' +
            '<button type="button" class="fcd-btn fcd-primary fcd-retry">Check again</button>' +
            '<a class="fcd-btn fcd-ghost" href="https://discord.gg/xCGN2hXY8J" target="_blank" rel="noopener">Get help on Discord</a>' +
          '</div>' +
          '<p class="fcd-meta"><span class="fcd-since"></span><span class="fcd-auto"> \u00b7 This page checks again by itself.</span></p>' +
        '</div>';
      document.body.appendChild(box);
      box.querySelector('.fcd-retry').addEventListener('click', function(){
        var b = this; b.disabled = true; b.textContent = 'Checking\u2026';
        check(function(){ b.disabled = false; b.textContent = 'Still offline \u2014 check again'; });
      });
    }
    var note = box.querySelector('.fcd-note');
    note.hidden = !state.message;
    box.querySelector('.fcd-msg').textContent = state.message || '';
    box.querySelector('.fcd-since').textContent = ago(state.since);
    document.title = 'Temporarily offline \u2014 FixCore';
    shown = true;
  }

  function clear(){
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
    if (!shown){ html.classList.remove('fc-down'); return; }
    window.location.reload();   // the site is back: show the real page
  }

  // ---------- announcement banner ----------
  var BANNER_HIDE_KEY = 'fixcoreBannerHidden';
  function showBanner(b){
    var old = document.getElementById('fc-banner');
    if (!b || !b.text){ if (old) old.remove(); return; }
    try { if (localStorage.getItem(BANNER_HIDE_KEY) === b.id){ if (old) old.remove(); return; } } catch (e) { /* ignore */ }
    if (old && old.getAttribute('data-id') === b.id) return;
    if (old) old.remove();
    if (!document.body){ document.addEventListener('DOMContentLoaded', function(){ showBanner(b); }); return; }
    addStyle();
    var bar = document.createElement('div');
    bar.id = 'fc-banner';
    bar.className = b.style || 'info';
    bar.setAttribute('role', 'status');
    bar.setAttribute('data-id', b.id);
    var text = document.createElement('span'); text.className = 'fcb-text'; text.textContent = b.text; bar.appendChild(text);
    if (b.link){
      var a = document.createElement('a'); a.className = 'fcb-link'; a.href = b.link; a.textContent = b.linkText || 'Learn more';
      if (/^https:\/\//.test(b.link) && b.link.indexOf('fixcorepc.com') === -1){ a.target = '_blank'; a.rel = 'noopener'; }
      bar.appendChild(a);
    }
    var x = document.createElement('button'); x.type = 'button'; x.className = 'fcb-x'; x.setAttribute('aria-label', 'Hide this message'); x.textContent = '\u00d7';
    x.addEventListener('click', function(){
      try { localStorage.setItem(BANNER_HIDE_KEY, b.id); } catch (e) { /* ignore */ }
      bar.classList.remove('show'); setTimeout(function(){ bar.remove(); }, 400);
    });
    bar.appendChild(x);
    document.body.appendChild(bar);
    setTimeout(function(){ bar.classList.add('show'); }, 60);
  }

  // ---------- products switched off on the admin page ----------
  function closeLinks(urls){
    if (!urls || !urls.length) return;
    var apply = function(){
      [].forEach.call(document.querySelectorAll('[data-stripe-url], a[href^="https://buy.stripe.com/"]'), function(el){
        var url = el.getAttribute('data-stripe-url') || el.getAttribute('href');
        if (urls.indexOf(url) === -1 || el.classList.contains('fc-closed')) return;
        el.classList.add('fc-closed');
        el.setAttribute('aria-disabled', 'true');
        if ('disabled' in el) el.disabled = true;
        el.textContent = 'Not available right now';
        el.addEventListener('click', function(e){ e.preventDefault(); e.stopImmediatePropagation(); }, true);
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
  }

  var firstCheck = true;
  function check(done){
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function(){ if (ctrl) ctrl.abort(); }, 5000);
    var url = API + (firstCheck ? '?v=1' : '');   // ?v=1 counts one page view for the stats
    firstCheck = false;
    fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        clearTimeout(t);
        if (!d) return;   // server problem: keep whatever is showing
        showBanner(d.banner);
        closeLinks(d.closedLinks);
        if (d.emergency){
          try { localStorage.setItem(CACHE_KEY, JSON.stringify({ message: d.message, since: d.since })); } catch (e) { /* ignore */ }
          render(d);
        } else {
          clear();
        }
      })
      .catch(function(){ clearTimeout(t); })
      .then(function(){ if (done) done(); });
  }

  // Shut down last time? Hide the page straight away, before it flashes.
  try {
    var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached){ addStyle(); html.classList.add('fc-down'); render(cached); }
  } catch (e) { /* ignore */ }

  check();
  timer = setInterval(function(){ if (!document.hidden) check(); }, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) check(); });
})();
