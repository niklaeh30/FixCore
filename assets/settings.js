/* FixCore — account settings page (settings.html).
   Talks to the fixcore-accounts backend (/api/me/...). */
(function(){
  'use strict';

  var API_BASE = 'https://web-production-fae792.up.railway.app';
  var SESSION_KEY = 'fixcore_email_user';
  var DISCORD_CLIENT_ID = '1539670021532422154';
  var DISCORD_REDIRECT_URI = 'https://fixcorepc.com/callback.html';

  function $(id){ return document.getElementById(id); }
  function show(el, on){ el.hidden = !on; }

  // ---------- session ----------
  function readSession(){
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeSession(s){
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  function clearSession(){
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem('fixcore_discord_user'); } catch (e) { /* ignore */ }
  }
  var session = readSession();

  // Keeps the stored login in step with what the server says about the account.
  function syncSession(user, token){
    if (!session) session = {};
    if (token) session.authToken = token;
    session.username = user.username;
    session.email = user.email;
    session.tag = user.email;
    session.avatarUrl = user.avatarUrl || null;
    session.discordLinked = !!user.discordLinked;
    writeSession(session);
    renderNav();
  }

  // ---------- small UI helpers ----------
  var toastTimer;
  function toast(msg){
    var t = $('toast');
    $('toastText').textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 3400);
  }
  function msg(id, text, kind){
    var el = $(id);
    el.textContent = text || '';
    el.className = 'set-msg' + (kind ? ' ' + kind : '');
  }
  function busy(btn, on, label){
    if (on){ btn.dataset.label = btn.textContent; btn.textContent = label || 'Saving…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }
  function initials(name){
    return (name || '?').trim().split(/\s+/).map(function(p){ return p.charAt(0); }).join('').slice(0, 2).toUpperCase() || '?';
  }
  function avatarEl(user){
    var el;
    if (user.avatarUrl){
      el = document.createElement('img');
      el.src = user.avatarUrl; el.alt = '';
    } else {
      el = document.createElement('span');
      el.textContent = initials(user.username);
    }
    el.className = 'avatar';
    return el;
  }

  function renderNav(){
    var box = $('navActions');
    if (!box) return;
    box.textContent = '';
    if (!session || !session.authToken){
      var a = document.createElement('a');
      a.className = 'btn btn-primary'; a.id = 'openLogin'; a.href = 'index.html#account'; a.textContent = 'Log in';
      box.appendChild(a);
      return;
    }
    var chip = document.createElement('a');
    chip.className = 'user-chip'; chip.href = 'index.html#account';
    chip.appendChild(avatarEl(session));
    var name = document.createElement('span'); name.textContent = session.username || 'Account';
    chip.appendChild(name);
    var out = document.createElement('button');
    out.className = 'btn btn-text'; out.type = 'button'; out.textContent = 'Log out';
    out.addEventListener('click', function(){ clearSession(); window.location.href = 'index.html'; });
    box.appendChild(chip); box.appendChild(out);
  }

  // ---------- API ----------
  function api(method, path, body){
    return fetch(API_BASE + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (session && session.authToken) },
      body: body ? JSON.stringify(body) : undefined
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(data){
        if (res.status === 401){ signedOut(); throw new Error('signed-out'); }
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }
  function netError(id){
    return function(err){
      if (err && err.message === 'signed-out') return;
      msg(id, "Couldn't reach FixCore. Check your connection and try again.", 'err');
    };
  }

  function signedOut(){
    clearSession(); session = null; renderNav();
    show($('setLoading'), false); show($('setMain'), false); show($('setSignedOut'), true);
  }

  // ---------- render ----------
  var state = null;

  function render(){
    var u = state.user;
    var slot = $('setAvatar'); slot.textContent = ''; slot.appendChild(avatarEl(u));
    $('setName').textContent = u.username || u.email;
    $('setEmailLine').textContent = u.email;
    if (state.createdAt){
      var d = new Date(state.createdAt);
      if (!isNaN(d)) $('setSince').textContent = 'Member since ' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }
    $('emailNew').placeholder = u.email;

    // Discord
    show($('discordLinked'), u.discordLinked);
    show($('discordMissing'), !u.discordLinked);
    show($('discordUnlinkBtn'), u.discordLinked);
    $('discordLinkBtn').textContent = u.discordLinked ? 'Switch Discord account' : 'Link Discord';
    $('discordLinkBtn').className = u.discordLinked ? 'btn btn-ghost' : 'btn btn-discord';
    $('discordName').textContent = u.username || '';
    $('discordHandle').textContent = state.discordHandle ? '@' + state.discordHandle : '';

    // Two-step login
    var on = !!state.twoFactor;
    $('twofaPill').textContent = on ? 'On' : 'Off';
    $('twofaPill').className = 'set-pill' + (on ? ' on' : '');
    show($('twofaOn'), on); show($('twofaOff'), !on);

    // Payout details
    var p = state.payout;
    setTab(p && p.method === 'bank' ? 'bank' : 'paypal');
    $('ppEmail').value = (p && p.paypalEmail) || '';
    $('bankHolder').value = (p && p.holder) || '';
    $('bankAccount').value = (p && p.account) || '';
    $('bankSwift').value = (p && p.swift) || '';
    show($('payoutClear'), !!p);

    // Delete warning
    var warn = [];
    if (state.balance > 0 || state.pending > 0){
      warn.push('You still have $' + (state.balance + state.pending).toFixed(2) + ' in affiliate money. It will be lost if you delete your account.');
    }
    if (state.hasPendingPayout) warn.push('A payout is on its way. You can delete your account once it has been paid.');
    $('deleteBalance').textContent = warn.join(' ');
    show($('deleteBalance'), warn.length > 0);
  }

  function load(){
    if (!session || !session.authToken){ signedOut(); return; }
    api('GET', '/api/me/settings').then(function(r){
      if (!r.ok){ $('setLoading').querySelector('p').textContent = (r.data && r.data.error) || "Couldn't load your settings. Refresh the page to try again."; return; }
      state = r.data;
      syncSession(state.user);
      render();
      show($('setLoading'), false); show($('setMain'), true);
      if (location.hash){ var t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
    }).catch(function(err){
      if (err && err.message === 'signed-out') return;
      $('setLoading').querySelector('p').textContent = "Couldn't reach FixCore. Check your connection and refresh the page.";
    });
  }

  // ---------- email ----------
  $('emailSave').addEventListener('click', function(){
    var btn = this, email = $('emailNew').value.trim(), pw = $('emailPw').value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ msg('emailMsg', 'Enter a valid email address.', 'err'); return; }
    if (!pw){ msg('emailMsg', 'Enter your current password.', 'err'); return; }
    msg('emailMsg', ''); busy(btn, true);
    api('POST', '/api/me/email', { newEmail: email, password: pw }).then(function(r){
      busy(btn, false);
      if (!r.ok){ msg('emailMsg', r.data.error || "Couldn't change your email.", 'err'); return; }
      state.user = r.data.user; syncSession(r.data.user, r.data.token); render();
      $('emailNew').value = ''; $('emailPw').value = '';
      msg('emailMsg', 'Email changed to ' + r.data.user.email + '.', 'ok');
    }).catch(function(e){ busy(btn, false); netError('emailMsg')(e); });
  });

  // ---------- password ----------
  $('pwSave').addEventListener('click', function(){
    var btn = this, cur = $('pwCurrent').value, nw = $('pwNew').value, rep = $('pwRepeat').value;
    if (!cur){ msg('pwMsg', 'Enter your current password.', 'err'); return; }
    if (nw.length < 8){ msg('pwMsg', 'Your new password must be at least 8 characters.', 'err'); return; }
    if (nw !== rep){ msg('pwMsg', "The new passwords don't match.", 'err'); return; }
    msg('pwMsg', ''); busy(btn, true);
    api('POST', '/api/me/password', { currentPassword: cur, newPassword: nw }).then(function(r){
      busy(btn, false);
      if (!r.ok){ msg('pwMsg', r.data.error || "Couldn't change your password.", 'err'); return; }
      syncSession(r.data.user, r.data.token);
      $('pwCurrent').value = $('pwNew').value = $('pwRepeat').value = '';
      msg('pwMsg', 'Password changed. Other devices have been signed out.', 'ok');
    }).catch(function(e){ busy(btn, false); netError('pwMsg')(e); });
  });

  // ---------- two-step login ----------
  var twofaChallenge = null;
  function resetTwofa(){
    twofaChallenge = null;
    show($('twofaOpen'), true); show($('twofaStep1'), false); show($('twofaStep2'), false);
    show($('twofaOffOpen'), true); show($('twofaOffStep'), false);
    $('twofaPw').value = $('twofaCode').value = $('twofaOffPw').value = '';
    msg('twofaMsg1', ''); msg('twofaMsg2', ''); msg('twofaMsg3', '');
  }
  $('twofaOpen').addEventListener('click', function(){ show(this, false); show($('twofaStep1'), true); $('twofaPw').focus(); });
  $('twofaCancel1').addEventListener('click', resetTwofa);
  $('twofaCancel2').addEventListener('click', resetTwofa);
  $('twofaCancel3').addEventListener('click', resetTwofa);
  $('twofaSend').addEventListener('click', function(){
    var btn = this, pw = $('twofaPw').value;
    if (!pw){ msg('twofaMsg1', 'Enter your current password.', 'err'); return; }
    busy(btn, true, 'Sending…');
    api('POST', '/api/me/2fa/start', { password: pw }).then(function(r){
      busy(btn, false);
      if (!r.ok){ msg('twofaMsg1', r.data.error || "Couldn't send a code.", 'err'); return; }
      twofaChallenge = r.data.challenge;
      $('twofaHint').textContent = r.data.emailHint || 'your email';
      show($('twofaStep1'), false); show($('twofaStep2'), true); $('twofaCode').focus();
    }).catch(function(e){ busy(btn, false); netError('twofaMsg1')(e); });
  });
  $('twofaCode').addEventListener('input', function(){ this.value = this.value.replace(/\D/g, '').slice(0, 6); });
  $('twofaEnable').addEventListener('click', function(){
    var btn = this, code = $('twofaCode').value;
    if (!/^\d{6}$/.test(code)){ msg('twofaMsg2', 'Enter the 6-digit code from the email.', 'err'); return; }
    busy(btn, true, 'Turning on…');
    api('POST', '/api/me/2fa/enable', { challenge: twofaChallenge, code: code }).then(function(r){
      busy(btn, false);
      if (!r.ok){ msg('twofaMsg2', r.data.error || "Couldn't turn on two-step login.", 'err'); return; }
      state.twoFactor = true; resetTwofa(); render();
      toast('Two-step login is on. You\'ll get a code by email when you log in.');
    }).catch(function(e){ busy(btn, false); netError('twofaMsg2')(e); });
  });
  $('twofaOffOpen').addEventListener('click', function(){ show(this, false); show($('twofaOffStep'), true); $('twofaOffPw').focus(); });
  $('twofaDisable').addEventListener('click', function(){
    var btn = this, pw = $('twofaOffPw').value;
    if (!pw){ msg('twofaMsg3', 'Enter your current password.', 'err'); return; }
    busy(btn, true, 'Turning off…');
    api('POST', '/api/me/2fa/disable', { password: pw }).then(function(r){
      busy(btn, false);
      if (!r.ok){ msg('twofaMsg3', r.data.error || "Couldn't turn off two-step login.", 'err'); return; }
      state.twoFactor = false; resetTwofa(); render();
      toast('Two-step login is off.');
    }).catch(function(e){ busy(btn, false); netError('twofaMsg3')(e); });
  });

  // ---------- Discord ----------
  $('discordLinkBtn').addEventListener('click', function(){
    // callback.html links the new Discord account and sends the person back here.
    try {
      sessionStorage.setItem('fixcoreLinkDiscord', '1');
      sessionStorage.setItem('fixcoreLinkReturn', '/settings.html');
    } catch (e) { /* ignore */ }
    var params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: DISCORD_REDIRECT_URI, response_type: 'token', scope: 'identify' });
    if (state && state.user.discordLinked) params.set('prompt', 'consent');
    window.location.href = 'https://discord.com/api/oauth2/authorize?' + params.toString();
  });
  $('discordUnlinkBtn').addEventListener('click', function(){ show($('unlinkConfirm'), true); $('unlinkPw').focus(); });
  $('unlinkCancel').addEventListener('click', function(){ show($('unlinkConfirm'), false); $('unlinkPw').value = ''; msg('unlinkMsg', ''); });
  $('unlinkGo').addEventListener('click', function(){
    var btn = this, pw = $('unlinkPw').value;
    if (!pw){ msg('unlinkMsg', 'Enter your current password.', 'err'); return; }
    busy(btn, true, 'Removing…');
    api('POST', '/api/me/discord/unlink', { password: pw }).then(function(r){
      busy(btn, false);
      if (!r.ok){ msg('unlinkMsg', r.data.error || "Couldn't remove Discord.", 'err'); return; }
      state.user = r.data.user; state.discordHandle = null; syncSession(r.data.user); render();
      show($('unlinkConfirm'), false); $('unlinkPw').value = ''; msg('unlinkMsg', '');
      toast('Discord removed from your account.');
    }).catch(function(e){ busy(btn, false); netError('unlinkMsg')(e); });
  });

  // ---------- payout details ----------
  var method = 'paypal';
  function setTab(m){
    method = m;
    [].forEach.call(document.querySelectorAll('.set-tab'), function(t){
      var on = t.getAttribute('data-method') === m;
      t.classList.toggle('active', on); t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    [].forEach.call(document.querySelectorAll('#sec-payout [data-for]'), function(p){ p.hidden = p.getAttribute('data-for') !== m; });
  }
  [].forEach.call(document.querySelectorAll('.set-tab'), function(t){
    t.addEventListener('click', function(){ setTab(t.getAttribute('data-method')); msg('payoutMsg', ''); });
  });
  $('payoutSave').addEventListener('click', function(){
    var btn = this, body = { method: method };
    if (method === 'paypal'){
      body.paypalEmail = $('ppEmail').value.trim();
      if (!body.paypalEmail){ msg('payoutMsg', 'Enter the email of your PayPal account.', 'err'); return; }
    } else {
      body.holder = $('bankHolder').value.trim();
      body.account = $('bankAccount').value.trim();
      body.swift = $('bankSwift').value.trim();
      if (!body.holder || !body.account){ msg('payoutMsg', 'Enter the account holder and the account number.', 'err'); return; }
    }
    busy(btn, true);
    api('POST', '/api/me/payout-details', body).then(function(r){
      busy(btn, false);
      if (!r.ok){ msg('payoutMsg', r.data.error || "Couldn't save your payout details.", 'err'); return; }
      state.payout = r.data.payout; render();
      msg('payoutMsg', 'Saved. Your next payout request will be filled in with these details.', 'ok');
    }).catch(function(e){ busy(btn, false); netError('payoutMsg')(e); });
  });
  $('payoutClear').addEventListener('click', function(){
    var btn = this; busy(btn, true, 'Removing…');
    api('POST', '/api/me/payout-details', { method: 'none' }).then(function(r){
      busy(btn, false);
      if (!r.ok){ msg('payoutMsg', r.data.error || "Couldn't remove your payout details.", 'err'); return; }
      state.payout = null; render(); msg('payoutMsg', 'Saved payout details removed.', 'ok');
    }).catch(function(e){ busy(btn, false); netError('payoutMsg')(e); });
  });

  // ---------- delete account ----------
  $('deleteOpen').addEventListener('click', function(){ show($('deleteConfirm'), true); show(this, false); $('deleteWord').focus(); });
  $('deleteCancel').addEventListener('click', function(){
    show($('deleteConfirm'), false); show($('deleteOpen'), true);
    $('deleteWord').value = $('deletePw').value = ''; msg('deleteMsg', '');
  });
  $('deleteGo').addEventListener('click', function(){
    var btn = this, word = $('deleteWord').value.trim(), pw = $('deletePw').value;
    if (word.toUpperCase() !== 'DELETE'){ msg('deleteMsg', 'Type DELETE in the first box to confirm.', 'err'); return; }
    if (!pw){ msg('deleteMsg', 'Enter your current password.', 'err'); return; }
    busy(btn, true, 'Deleting…');
    api('POST', '/api/me/delete', { confirm: word, password: pw }).then(function(r){
      busy(btn, false);
      if (!r.ok){ msg('deleteMsg', r.data.error || "Couldn't delete your account.", 'err'); return; }
      clearSession(); session = null; renderNav();
      show($('setMain'), false); show($('setDeleted'), true);
      window.scrollTo(0, 0);
    }).catch(function(e){ busy(btn, false); netError('deleteMsg')(e); });
  });

  // ---------- section nav highlight ----------
  var navLinks = [].slice.call(document.querySelectorAll('.set-nav a'));
  function spy(){
    var y = window.scrollY + 140, cur = navLinks[0];
    navLinks.forEach(function(a){ var t = document.querySelector(a.getAttribute('href')); if (t && t.offsetTop <= y) cur = a; });
    navLinks.forEach(function(a){ a.classList.toggle('is-on', a === cur); });
  }
  window.addEventListener('scroll', spy, { passive: true });

  // ---------- start ----------
  renderNav();
  load();
  spy();
  // Message left by callback.html after linking Discord.
  try {
    var flash = sessionStorage.getItem('fixcoreFlash');
    if (flash){ sessionStorage.removeItem('fixcoreFlash'); toast(flash); }
  } catch (e) { /* ignore */ }
})();
