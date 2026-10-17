/* FixCore admin page (admin.html). */
(function(){
  "use strict";
  if (window.top !== window.self){ document.documentElement.style.display = 'none'; return; }
  var API_BASE = 'https://web-production-fae792.up.railway.app';
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(n){ return '$' + Number(n || 0).toFixed(2); }
  // Sign-in: straight through Discord (no FixCore login needed). If you've used
  // FixCore's Discord login before, Discord sends you right back without asking.
  var DISCORD_CLIENT_ID = '1539670021532422154';
  function store(key, value){ try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch (e) {} }
  function read(key){ try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  var discordToken = read('fixcoreAdminDiscordToken');
  var authError = read('fixcoreAdminAuthError');
  store('fixcoreAdminAuthError', null);
  function signInWithDiscord(auto){
    store('fixcoreAdminAuth', '1');
    if (auto) store('fixcoreAdminAutoTried', '1');
    var q = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: 'https://fixcorepc.com/callback.html',
      response_type: 'token', scope: 'identify guilds.members.read', prompt: 'none' });
    window.location.href = 'https://discord.com/api/oauth2/authorize?' + q.toString();
  }
  function headers(){ return { 'Content-Type': 'application/json', 'X-Discord-Token': discordToken || '' }; }
  function api(path, opts){
    opts = opts || {};
    opts.headers = headers();
    return fetch(API_BASE + path, opts).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(d){ return { ok: res.ok, status: res.status, d: d }; });
    });
  }
  var who = document.getElementById('adminWho');
  var gate = document.getElementById('adminGate');
  var gateText = document.getElementById('adminGateText');
  var gateBtn = document.getElementById('adminGateBtn');
  var app = document.getElementById('adminApp');
  function showGate(text, btnText, action){
    who.textContent = 'This page is only for FixCore admins.';
    gateText.textContent = text;
    gateBtn.hidden = !btnText;
    if (btnText){
      gateBtn.textContent = btnText;
      gateBtn.onclick = function(e){
        if (typeof action === 'function'){ e.preventDefault(); action(); }
      };
      gateBtn.href = typeof action === 'string' ? action : '#';
    }
    gate.hidden = false; app.hidden = true;
  }
  function discordGate(text){ showGate(text, 'Sign in with Discord', function(){ signInWithDiscord(false); }); }

  // ---------- overview ----------
  function loadOverview(){
    api('/api/admin/overview').then(function(r){
      if (!r.ok) return;
      var o = r.d;
      var cards = [
        [o.accounts, 'Accounts'], [o.newAccounts7d || 0, 'New accounts (7 days)'], [o.discordLinked, 'With Discord linked'],
        [o.affiliates, 'Affiliates'], [o.blocked || 0, 'Blocked accounts', (o.blocked || 0) > 0],
        [o.sales, 'Affiliate sales'], [money(o.salesRevenue), 'Revenue from affiliate sales'], [money(o.commission), 'Commission earned'],
        [o.pendingPayouts + ' · ' + money(o.pendingPayoutAmount), 'Payouts waiting', o.pendingPayouts > 0],
        [money(o.paidOut), 'Paid out'], [money(o.creditsUsed), 'Turned into discount codes'], [money(o.owedAvailable), 'Available in all balances']
      ];
      document.getElementById('adminStats').innerHTML = cards.map(function(c){
        return '<div class="admin-stat' + (c[2] ? ' hot' : '') + '"><b>' + esc(c[0]) + '</b><span>' + esc(c[1]) + '</span></div>';
      }).join('');
    });
  }

  // ---------- payouts ----------
  var filter = document.getElementById('adminFilter');
  var list = document.getElementById('adminList');
  var msg = document.getElementById('adminMsg');
  function row(label, value){ return value ? '<dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd>' : ''; }
  function loadPayouts(){
    msg.textContent = 'Loading…'; list.innerHTML = '';
    api('/api/admin/payouts?status=' + encodeURIComponent(filter.value)).then(function(r){
      if (!r.ok){ msg.textContent = (r.d && r.d.error) || 'Could not load payouts.'; return; }
      var items = r.d.payouts || [];
      msg.textContent = items.length ? items.length + ' request' + (items.length === 1 ? '' : 's') : 'Nothing here.';
      list.innerHTML = items.map(function(p){
        var det = p.details || {};
        var dl = p.method === 'paypal' ? row('PayPal', det.paypalEmail)
          : row('Holder', det.holder) + row('Account', det.account) + row('SWIFT/BIC', det.swift);
        var actions = p.status === 'pending'
          ? '<div class="payout-actions"><button class="btn btn-primary" data-id="' + p.id + '" data-status="paid" type="button">Mark as paid</button>' +
            '<button class="btn btn-ghost" data-id="' + p.id + '" data-status="rejected" type="button">Reject</button></div>' : '';
        return '<div class="payout-card"><div class="payout-top"><span class="amt">' + money(p.amount) + '</span>' +
          '<span class="who">#' + p.id + ' · ' + esc(p.code || p.username) + ' · ' + esc(p.email) + ' · ' + esc((p.created_at || '').slice(0, 10)) + '</span>' +
          '<span class="aff-status s-' + esc(p.status) + '">' + esc(p.status) + '</span></div>' +
          '<dl class="payout-details">' + row('Method', p.method === 'paypal' ? 'PayPal' : 'Bank transfer') + dl + '</dl>' + actions + '</div>';
      }).join('');
    }).catch(function(){ msg.textContent = 'Could not reach the server.'; });
  }
  list.addEventListener('click', function(e){
    var btn = e.target.closest('button[data-id]');
    if (!btn) return;
    var status = btn.getAttribute('data-status');
    if (!window.confirm(status === 'paid' ? 'Mark this payout as paid? Only do this after you have sent the money.' : 'Reject this payout? The amount goes back to their balance.')) return;
    btn.disabled = true;
    api('/api/admin/payouts/' + btn.getAttribute('data-id'), { method: 'POST', body: JSON.stringify({ status: status }) })
      .then(function(r){ if (!r.ok) window.alert((r.d && r.d.error) || 'Could not update.'); loadPayouts(); loadOverview(); })
      .catch(function(){ window.alert('Could not reach the server.'); btn.disabled = false; });
  });
  filter.addEventListener('change', loadPayouts);

  // ---------- accounts ----------
  var acctList = document.getElementById('acctList');
  var acctMsg = document.getElementById('acctMsg');
  var acctSearch = document.getElementById('acctSearch');
  var acctFilter = document.getElementById('acctFilter');
  var acctCache = {};
  function day(iso){ return (iso || '').slice(0, 10); }
  function loadAccounts(){
    acctMsg.textContent = 'Loading…'; acctList.innerHTML = '';
    api('/api/admin/accounts?q=' + encodeURIComponent(acctSearch.value.trim()) + '&filter=' + encodeURIComponent(acctFilter.value)).then(function(r){
      if (!r.ok){ acctMsg.textContent = (r.d && r.d.error) || 'Could not load accounts.'; return; }
      var items = r.d.accounts || [];
      acctCache = {};
      items.forEach(function(a){ acctCache[a.id] = a; });
      acctMsg.textContent = items.length ? 'Showing ' + items.length + ' account' + (items.length === 1 ? '' : 's') + '.' : 'No accounts match that.';
      acctList.innerHTML = items.map(function(a){
        var name = esc(a.discord_username || a.username);
        var badges = (a.disabled ? '<span class="acct-badge bad">Blocked</span>' : '') +
                     (a.discordLinked ? '' : '<span class="acct-badge">No Discord</span>');
        var grantHtml = a.discordLinked
          ? '<div class="acct-grant"><input type="number" min="0.01" step="0.01" placeholder="Amount $" aria-label="Amount in dollars">' +
            '<input type="text" maxlength="200" placeholder="Note they will see (optional)" aria-label="Note">' +
            '<button class="btn btn-primary" type="button" data-act="grant" data-sign="1" data-id="' + a.id + '">Add money</button>' +
            '<button class="btn btn-ghost" type="button" data-act="grant" data-sign="-1" data-id="' + a.id + '">Remove</button></div>'
          : '<p class="acct-note">Money can be added once Discord is linked.</p>';
        return '<div class="acct-card" id="acct-' + a.id + '"><div class="acct-top"><b>' + name + '</b>' + badges + '<span>' + esc(a.email) + '</span>' +
          (a.code ? '<span>code: ' + esc(a.code) + '</span>' : '') + '<span>joined ' + esc(day(a.created_at)) + '</span></div>' +
          '<div class="acct-stats"><span>Available <b>' + money(a.available) + '</b></span><span>Pending <b>' + money(a.pending) + '</b></span><span>Earned <b>' + money(a.earned) + '</b></span></div>' +
          grantHtml +
          '<div class="acct-actions">' +
            '<button type="button" class="acct-act" data-act="details" data-id="' + a.id + '">Details</button>' +
            '<button type="button" class="acct-act" data-act="reset-pw" data-id="' + a.id + '">Send password reset</button>' +
            (a.discordLinked ? '<button type="button" class="acct-act" data-act="reset-aff" data-id="' + a.id + '">Reset affiliate data</button>' : '') +
            '<button type="button" class="acct-act" data-act="block" data-id="' + a.id + '">' + (a.disabled ? 'Unblock' : 'Block') + '</button>' +
            '<button type="button" class="acct-act danger" data-act="delete" data-id="' + a.id + '">Delete account</button>' +
          '</div><div class="acct-details" hidden></div></div>';
      }).join('');
    }).catch(function(){ acctMsg.textContent = 'Could not reach the server.'; });
  }
  function post(path, body){ return api(path, { method: 'POST', body: JSON.stringify(body || {}) }); }
  function done(r, okText){
    if (!r.ok){ window.alert((r.d && r.d.error) || 'That didn’t work.'); return false; }
    if (okText) window.alert(okText);
    loadAccounts(); loadOverview(); loadPayouts(); loadSales();
    return true;
  }
  function showDetails(id, box){
    if (!box.hidden){ box.hidden = true; return; }
    box.hidden = false; box.innerHTML = '<p class="acct-note">Loading…</p>';
    api('/api/admin/accounts/' + id).then(function(r){
      if (!r.ok){ box.innerHTML = '<p class="acct-note">' + esc((r.d && r.d.error) || 'Could not load details.') + '</p>'; return; }
      var d = r.d;
      var owned = d.owned ? (d.owned.length ? d.owned.map(esc).join(', ') : 'Nothing') : esc(d.rolesError || (d.discordLinked ? 'Unknown' : 'No Discord linked'));
      var yn = function(b){ return b ? 'Yes' : 'No'; };
      var notif = d.notifications ? [d.notifications.updates ? 'new versions' : '', d.notifications.offers ? 'offers' : ''].filter(Boolean).join(', ') || 'None' : '—';
      var logins = (d.logins || []).length ? '<ul class="mini-list">' + d.logins.map(function(l){
        return '<li>' + esc((l.at || '').slice(0, 16).replace('T', ' ')) + ' · ' + esc(l.device) + (l.ip ? ' · ' + esc(l.ip) : '') + '</li>'; }).join('') + '</ul>' : 'None recorded yet';
      var orders = (d.orders || []).length ? '<ul class="mini-list">' + d.orders.map(function(o){
        return '<li>' + esc(day(o.date)) + ' · ' + esc(o.product) + ' · ' + esc(o.total) + (o.refunded ? '<span class="tag-bad">Refunded</span>' : '') + '</li>'; }).join('') + '</ul>' : 'None with this email';
      var rows = [['Discord', d.discordLinked ? esc(d.discordUsername || 'linked') : 'Not linked'], ['Owns', owned],
                  ['Email verified', yn(d.emailVerified)], ['Two-step login', d.twoFactor ? 'On' : 'Off'], ['Email updates', esc(notif)],
                  ['Joined', esc(day(d.createdAt))], ['Referral clicks', d.clicks || 0], ['Referred sales', d.salesCount || 0],
                  ['Last logins', logins], ['Orders', orders], ['Give / remove', productButtons(d)]];
      var extra = '<div class="acct-actions">' +
        (d.twoFactor ? '<button type="button" class="acct-act" data-act="twofa-off" data-id="' + d.id + '">Turn off two-step login</button>' : '') +
        '<button type="button" class="acct-act" data-act="logout-all" data-id="' + d.id + '">Log out everywhere</button></div>';
      var hist = (d.history || []).map(function(h){
        var what = h.kind === 'credit' ? 'Discount code ' + esc(h.code || '') : h.kind === 'payout' ? 'Payout (' + esc(h.method) + ')'
                 : h.kind === 'grant' ? 'Added by admin' + (h.note ? ': ' + esc(h.note) : '') : 'Removed by admin' + (h.note ? ': ' + esc(h.note) : '');
        return '<tr><td>' + esc(day(h.createdAt)) + '</td><td>' + what + '</td><td>' + money(h.amount) + '</td><td>' + esc(h.status) + '</td></tr>';
      }).join('');
      var sales = (d.sales || []).map(function(x){ return '<tr><td>' + esc(day(x.createdAt)) + '</td><td>Referred sale</td><td>' + money(x.amount) + '</td><td>+' + money(x.commission) + '</td></tr>'; }).join('');
      box.innerHTML = extra + '<dl class="payout-details">' + rows.map(function(rw){ return '<dt>' + rw[0] + '</dt><dd>' + rw[1] + '</dd>'; }).join('') + '</dl>' +
        ((hist || sales) ? '<div class="table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>What</th><th>Amount</th><th>Status</th></tr></thead><tbody>' + hist + sales + '</tbody></table></div>'
                         : '<p class="acct-note">No affiliate activity yet.</p>') +
        '<div class="notes"><p class="acct-note">Loading notes…</p></div>';
      loadNotes(d.id);
    }).catch(function(){ box.innerHTML = '<p class="acct-note">Could not reach the server.</p>'; });
  }
  acctList.addEventListener('click', function(e){
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = btn.getAttribute('data-id'), act = btn.getAttribute('data-act'), a = acctCache[id] || {};
    var label = (a.discord_username || a.username || a.email || 'this account');
    if (act === 'details'){ showDetails(id, document.querySelector('#acct-' + id + ' .acct-details')); return; }
    if (act === 'twofa-off'){
      if (!window.confirm('Turn off two-step login for ' + label + '?\n\nOnly do this if they have lost access to their email and you are sure it is them.')) return;
      btn.disabled = true;
      post('/api/admin/accounts/' + id + '/twofa-off').then(function(r){ btn.disabled = false; if (done(r, r.ok ? 'Two-step login turned off.' : null)) {} });
      return;
    }
    if (act === 'logout-all'){
      if (!window.confirm('Log ' + label + ' out on every device?')) return;
      btn.disabled = true;
      post('/api/admin/accounts/' + id + '/logout-all').then(function(r){ btn.disabled = false; done(r, r.ok ? 'Logged out everywhere. They need to log in again.' : null); });
      return;
    }
    if (act === 'grant'){
      var box = btn.parentNode, sign = Number(btn.getAttribute('data-sign'));
      var amount = parseFloat(box.querySelector('input[type=number]').value), note = box.querySelector('input[type=text]').value.trim();
      if (!(amount > 0)){ window.alert('Enter an amount, like 5 or 2.50.'); return; }
      if (!window.confirm((sign > 0 ? 'Add ' + money(amount) + ' to ' : 'Remove ' + money(amount) + ' from ') + label + '?')) return;
      btn.disabled = true;
      post('/api/admin/accounts/' + id + '/grant', { amount: sign * amount, note: note }).then(function(r){ if (!done(r)) btn.disabled = false; });
      return;
    }
    if (act === 'reset-pw'){
      if (!window.confirm('Email a password reset link to ' + a.email + '?')) return;
      btn.disabled = true;
      post('/api/admin/accounts/' + id + '/send-reset').then(function(r){ btn.disabled = false; done(r, 'Reset link sent to ' + a.email + '.'); });
      return;
    }
    if (act === 'reset-aff'){
      if (!window.confirm('Reset ALL affiliate data for ' + label + '?\n\nTheir balance, history and referred sales are wiped, and unused discount codes stop working. This can’t be undone.')) return;
      btn.disabled = true;
      post('/api/admin/accounts/' + id + '/reset-affiliate').then(function(r){ btn.disabled = false; done(r, r.ok ? 'Affiliate data reset.' + (r.d.codesDisabled ? ' ' + r.d.codesDisabled + ' discount code(s) turned off.' : '') : null); });
      return;
    }
    if (act === 'block'){
      var blocking = !a.disabled;
      if (!window.confirm((blocking ? 'Block ' : 'Unblock ') + label + '?' + (blocking ? '\n\nThey are signed out and can’t log in until you unblock them.' : ''))) return;
      btn.disabled = true;
      post('/api/admin/accounts/' + id + '/block', { blocked: blocking }).then(function(r){ btn.disabled = false; done(r); });
      return;
    }
    if (act === 'delete'){
      var typed = window.prompt('This permanently deletes ' + label + ' and all its data.\n\nType the account’s email (' + a.email + ') to confirm:');
      if (typed === null) return;
      btn.disabled = true;
      post('/api/admin/accounts/' + id + '/delete', { confirm: typed }).then(function(r){ btn.disabled = false; done(r, r.ok ? 'Account deleted.' : null); });
    }
  });
  document.getElementById('acctSearchBtn').addEventListener('click', loadAccounts);
  acctFilter.addEventListener('change', loadAccounts);
  acctSearch.addEventListener('keydown', function(e){ if (e.key === 'Enter') loadAccounts(); });

  // ---------- recent sales ----------
  function loadSales(){
    var body = document.getElementById('salesBody');
    var sMsg = document.getElementById('salesMsg');
    api('/api/admin/sales').then(function(r){
      if (!r.ok){ sMsg.textContent = 'Could not load sales.'; return; }
      var items = r.d.sales || [];
      sMsg.textContent = items.length ? '' : 'No affiliate sales yet.';
      body.innerHTML = items.map(function(x){
        return '<tr><td>' + esc((x.createdAt || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(x.code) + '</td><td>' + money(x.amount) + '</td><td>' + money(x.commission) + '</td></tr>';
      }).join('');
    });
  }

  // ---------- website switches ----------
  function drawFeatures(list){
    document.getElementById('featList').innerHTML = list.map(function(f){
      return '<div class="feat' + (f.on ? '' : ' off') + '"><span>' + esc(f.label) + (f.on ? '' : ' \u2014 OFF') + '</span>' +
        '<button type="button" class="sw' + (f.on ? ' on' : '') + '" role="switch" aria-checked="' + f.on + '" aria-label="' + esc(f.label) + '" data-feat="' + esc(f.key) + '"></button></div>';
    }).join('');
  }
  function loadFeatures(){
    api('/api/admin/features').then(function(r){
      if (r.ok) drawFeatures(r.d.features);
      else document.getElementById('featMsg').textContent = (r.d && r.d.error) || 'Could not load.';
    });
  }
  document.getElementById('featList').addEventListener('click', function(e){
    var b = e.target.closest('button[data-feat]');
    if (!b) return;
    var turnOn = !b.classList.contains('on'), m = document.getElementById('featMsg');
    var label = b.getAttribute('aria-label');
    if (!turnOn && !window.confirm('Turn OFF: ' + label + '?')) return;
    b.disabled = true; m.textContent = 'Saving…';
    post('/api/admin/features', { key: b.getAttribute('data-feat'), on: turnOn }).then(function(r){
      if (!r.ok){ b.disabled = false; m.textContent = (r.d && r.d.error) || 'Could not change it.'; return; }
      drawFeatures(r.d.features);
      m.textContent = label + ' is now ' + (turnOn ? 'ON' : 'OFF') + '.' + (r.d.note ? ' ' + r.d.note : '');
    }).catch(function(){ b.disabled = false; m.textContent = 'Could not reach the server.'; });
  });

  // ---------- announcement banner ----------
  function banPreview(){
    var t = document.getElementById('banText').value.trim(), p = document.getElementById('banPreview');
    p.hidden = !t;
    p.className = 'ban-preview ' + document.getElementById('banStyle').value;
    p.textContent = t;
    var lt = document.getElementById('banLinkText').value.trim();
    if (t && document.getElementById('banLink').value.trim()){ var b = document.createElement('b'); b.textContent = lt || 'Learn more'; p.appendChild(b); }
  }
  ['banText', 'banLink', 'banLinkText', 'banStyle'].forEach(function(id){
    document.getElementById(id).addEventListener('input', banPreview);
    document.getElementById(id).addEventListener('change', banPreview);
  });
  function showBannerState(b){
    document.getElementById('banOff').hidden = !b.on;
    document.getElementById('banSave').textContent = b.on ? 'Update banner' : 'Show banner';
    if (b.on){
      document.getElementById('banText').value = b.text || '';
      document.getElementById('banLink').value = b.link || '';
      document.getElementById('banLinkText').value = b.linkText || '';
      document.getElementById('banStyle').value = b.style || 'info';
    }
    document.getElementById('banMsg').textContent = b.on ? 'The banner is showing on the website.' : 'No banner is showing.';
    banPreview();
  }
  function loadBanner(){ api('/api/admin/banner').then(function(r){ if (r.ok) showBannerState(r.d); }); }
  function saveBanner(on){
    var m = document.getElementById('banMsg');
    m.textContent = 'Saving…';
    post('/api/admin/banner', {
      on: on, text: document.getElementById('banText').value, link: document.getElementById('banLink').value,
      linkText: document.getElementById('banLinkText').value, style: document.getElementById('banStyle').value
    }).then(function(r){
      if (!r.ok){ m.textContent = (r.d && r.d.error) || 'Could not save.'; return; }
      showBannerState(r.d);
      m.textContent = on ? 'Saved. Visitors see it within 30 seconds.' : 'Banner hidden.';
    }).catch(function(){ m.textContent = 'Could not reach the server.'; });
  }
  document.getElementById('banSave').addEventListener('click', function(){ saveBanner(true); });
  document.getElementById('banOff').addEventListener('click', function(){ saveBanner(false); });

  // ---------- statistics (simple SVG charts, no libraries) ----------
  function chart(title, rows, key, opts){
    opts = opts || {};
    var vals = rows.map(function(r){ return r[key] || 0; });
    var max = Math.max.apply(null, vals.concat([1]));
    var total = vals.reduce(function(a, b){ return a + b; }, 0);
    var w = 600, h = 130, n = vals.length, gap = n > 60 ? 1 : 2, bw = (w - gap * (n - 1)) / n;
    var bars = vals.map(function(v, i){
      var bh = v ? Math.max(2, (v / max) * (h - 6)) : 0;
      return '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) +
        '" rx="2" fill="' + (opts.color || 'var(--cyan)') + '"><title>' + esc(rows[i].day) + ': ' + (opts.money ? '$' + v.toFixed(2) : v) + '</title></rect>';
    }).join('');
    var first = rows[0] ? rows[0].day.slice(5) : '', last = rows.length ? rows[rows.length - 1].day.slice(5) : '';
    return '<div class="chart"><h3>' + esc(title) + '<small>' + (opts.money ? '$' + total.toFixed(2) : total) + ' total</small></h3>' +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(title) + '">' +
      '<line x1="0" y1="' + h + '" x2="' + w + '" y2="' + h + '" stroke="var(--line-2)"/>' + bars + '</svg>' +
      '<div class="axis"><span>' + esc(first) + '</span><span>max ' + (opts.money ? '$' + max.toFixed(2) : max) + '/day</span><span>' + esc(last) + '</span></div></div>';
  }
  function loadStats(){
    var days = document.getElementById('statDays').value;
    api('/api/admin/stats?days=' + days).then(function(r){
      if (!r.ok){ document.getElementById('statCharts').innerHTML = '<p class="admin-msg">' + esc((r.d && r.d.error) || 'Could not load.') + '</p>'; return; }
      var t = r.d.totals, rows = r.d.days;
      document.getElementById('statTotals').innerHTML = [
        ['Visitors', t.visitors], ['Page views', t.views], ['New accounts', t.accounts], ['Orders', t.orders], ['Revenue', '$' + Number(t.revenue).toFixed(2)]
      ].map(function(x){ return '<div class="stat-total"><b>' + esc(x[1]) + '</b><small>' + esc(x[0]) + '</small></div>'; }).join('');
      document.getElementById('statCharts').innerHTML =
        chart('Visitors', rows, 'visitors') + chart('Revenue', rows, 'revenue', { money: true, color: '#a855f7' }) +
        chart('Orders', rows, 'orders', { color: '#21c27a' }) + chart('New accounts', rows, 'accounts', { color: '#f59e0b' });
    }).catch(function(){ document.getElementById('statCharts').innerHTML = '<p class="admin-msg">Could not reach the server.</p>'; });
  }
  document.getElementById('statDays').addEventListener('change', loadStats);

  // ---------- Discord alerts ----------
  var alertLabels = {};
  function drawAlerts(d){
    alertLabels = d.labels || {};
    document.getElementById('alertInfo').textContent = d.configured
      ? 'Posts to your private Discord channel when something happens. Choose what to get:'
      : 'Not set up yet. In Discord: channel settings \u2192 Integrations \u2192 Webhooks \u2192 New webhook \u2192 Copy URL. Add it on Railway (fixcore-accounts) as ADMIN_ALERT_WEBHOOK.';
    document.getElementById('alertList').innerHTML = Object.keys(alertLabels).map(function(k){
      var on = !!(d.settings || {})[k];
      return '<div class="feat"><span>' + esc(alertLabels[k]) + '</span><button type="button" class="sw' + (on ? ' on' : '') +
        '" role="switch" aria-checked="' + on + '" aria-label="' + esc(alertLabels[k]) + '" data-alert="' + esc(k) + '"></button></div>';
    }).join('');
    document.getElementById('alertTest').disabled = !d.configured;
    document.getElementById('alertTestPing').disabled = !d.configured || !d.ping;
    if (document.activeElement !== document.getElementById('alertPing')){
      var ping = d.ping || '', isUser = ping.indexOf('user:') === 0;
      document.getElementById('alertPing').value = isUser ? ping.slice(5) : ping;
      document.getElementById('alertPingType').value = isUser ? 'user' : 'role';
    }
  }
  function loadAlerts(){ api('/api/admin/alerts').then(function(r){ if (r.ok) drawAlerts(r.d); }); }
  document.getElementById('alertList').addEventListener('click', function(e){
    var b = e.target.closest('button[data-alert]');
    if (!b) return;
    b.classList.toggle('on');
    var body = {};
    [].forEach.call(document.querySelectorAll('#alertList button[data-alert]'), function(x){ body[x.getAttribute('data-alert')] = x.classList.contains('on'); });
    post('/api/admin/alerts', body).then(function(r){
      document.getElementById('alertMsg').textContent = r.ok ? 'Saved.' : ((r.d && r.d.error) || 'Could not save.');
      if (r.ok) drawAlerts(r.d);
    });
  });
  function testAlert(ping){
    var m = document.getElementById('alertMsg');
    m.textContent = 'Sending…';
    post('/api/admin/alerts', { test: true, ping: ping }).then(function(r){
      m.textContent = r.ok ? 'Sent' + (ping ? ' with a ping' : '') + '. Check your Discord channel.' : ((r.d && r.d.error) || 'Could not send.');
    });
  }
  document.getElementById('alertTest').addEventListener('click', function(){ testAlert(false); });
  document.getElementById('alertTestPing').addEventListener('click', function(){ testAlert(true); });
  document.getElementById('alertPingSave').addEventListener('click', function(){
    var m = document.getElementById('alertMsg'), v = document.getElementById('alertPing').value.trim();
    post('/api/admin/alerts', { ping: v, pingType: document.getElementById('alertPingType').value }).then(function(r){
      if (!r.ok){ m.textContent = (r.d && r.d.error) || 'Could not save.'; return; }
      drawAlerts(r.d);
      m.textContent = v ? 'Saved. Important alerts will ping that role or person.' : 'Saved. Important alerts won\u2019t ping anyone.';
    });
  });

  // ---------- account: products and notes ----------
  var PRODUCTS = [['fixcore', 'FixCore 2.1'], ['nettboost', 'NettBoost'], ['ultimate', 'FixCore Ultimate'], ['freetweaks', 'Free Tweaks']];
  function productButtons(d){
    if (!d.discordLinked) return '<p class="acct-note">Link Discord to give or remove products.</p>';
    var owned = d.owned || [];
    return '<div class="prod-btns">' + PRODUCTS.map(function(p){
      var has = owned.indexOf(p[1]) !== -1 || (p[0] === 'freetweaks' && owned.indexOf('FixCore Free Tweaks') !== -1);
      return '<button type="button" class="acct-act' + (has ? ' danger' : '') + '" data-act="product" data-id="' + d.id + '" data-product="' + p[0] +
        '" data-give="' + (has ? '0' : '1') + '" data-name="' + esc(p[1]) + '">' + (has ? 'Remove ' : 'Give ') + esc(p[1]) + '</button>';
    }).join('') + '</div>';
  }
  function drawNotes(box, id, notes){
    box.innerHTML = '<h4>Notes <small class="opt">(only admins see these here, but they are included if the customer downloads their data)</small></h4>' +
      (notes.length ? notes.map(function(n){
        return '<div class="note"><div>' + esc(n.text) + '<small>' + esc((n.author || 'admin') + ' \u00b7 ' + (n.at || '').slice(0, 16).replace('T', ' ')) +
          '</small></div><button type="button" title="Delete note" data-note="' + n.id + '" data-acct="' + id + '">\u00d7</button></div>';
      }).join('') : '<p class="acct-note">No notes yet.</p>') +
      '<div class="note-add"><input type="text" maxlength="1000" placeholder="Add a note, like \u201cRefunded once before\u201d" data-note-input="' + id + '">' +
      '<button type="button" class="acct-act" data-act="note-add" data-id="' + id + '">Add</button></div>';
  }
  function loadNotes(id){
    var box = document.querySelector('#acct-' + id + ' .notes');
    if (!box) return;
    api('/api/admin/accounts/' + id + '/notes').then(function(r){ if (r.ok) drawNotes(box, id, r.d.notes); });
  }
  acctList.addEventListener('click', function(e){
    var del = e.target.closest('button[data-note]');
    if (del){
      if (!window.confirm('Delete this note?')) return;
      api('/api/admin/notes/' + del.getAttribute('data-note'), { method: 'DELETE' }).then(function(){ loadNotes(del.getAttribute('data-acct')); });
      return;
    }
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = btn.getAttribute('data-id'), act = btn.getAttribute('data-act');
    if (act === 'note-add'){
      var input = document.querySelector('[data-note-input="' + id + '"]');
      var text = input.value.trim();
      if (!text) return;
      btn.disabled = true;
      post('/api/admin/accounts/' + id + '/notes', { text: text }).then(function(r){
        btn.disabled = false;
        if (!r.ok){ window.alert((r.d && r.d.error) || 'Could not save the note.'); return; }
        drawNotes(document.querySelector('#acct-' + id + ' .notes'), id, r.d.notes);
      });
    }
    if (act === 'product'){
      var give = btn.getAttribute('data-give') === '1', name = btn.getAttribute('data-name');
      if (!window.confirm((give ? 'Give ' : 'Remove ') + name + (give ? ' to' : ' from') + ' this account?\n\nThis changes their Discord role right away.')) return;
      btn.disabled = true;
      post('/api/admin/accounts/' + id + '/product', { product: btn.getAttribute('data-product'), give: give }).then(function(r){
        btn.disabled = false;
        if (!r.ok){ window.alert((r.d && r.d.error) || 'That didn\u2019t work.'); return; }
        var box = document.querySelector('#acct-' + id + ' .acct-details');
        box.hidden = true; showDetails(id, box);   // reload the details with the new roles
      });
    }
  });

  // ---------- desktop app control ----------
  function drawAppCfg(d){
    if (document.activeElement !== document.getElementById('appMinVer')) document.getElementById('appMinVer').value = d.min_version || '';
    if (document.activeElement !== document.getElementById('appMinMsg')) document.getElementById('appMinMsg').value = d.message || '';
    document.getElementById('appFeatList').innerHTML = (d.features || []).map(function(f){
      return '<div class="feat' + (f.on ? '' : ' off') + '"><span>' + esc(f.label) + (f.on ? '' : ' \u2014 OFF') + '</span>' +
        '<button type="button" class="sw' + (f.on ? ' on' : '') + '" role="switch" aria-checked="' + f.on + '" aria-label="' + esc(f.label) + '" data-appfeat="' + esc(f.key) + '"></button></div>';
    }).join('');
  }
  function loadAppCfg(){ api('/api/admin/app-config?app=ultimate').then(function(r){ if (r.ok) drawAppCfg(r.d); }); }
  document.getElementById('appMinSave').addEventListener('click', function(){
    var m = document.getElementById('appMinMsgOut'), v = document.getElementById('appMinVer').value.trim();
    if (v && !window.confirm('Make everyone below ' + v + ' update before they can use FixCore?\n\nOnly do this when the ' + v + ' installer is already uploaded.')) return;
    m.textContent = 'Saving…';
    post('/api/admin/app-config', { app: 'ultimate', min_version: v, message: document.getElementById('appMinMsg').value }).then(function(r){
      if (!r.ok){ m.textContent = (r.d && r.d.error) || 'Could not save.'; return; }
      drawAppCfg(r.d);
      m.textContent = v ? 'Saved. Everyone below ' + v + ' must update.' : 'Saved. No version is required.';
    });
  });
  document.getElementById('appFeatList').addEventListener('click', function(e){
    var b = e.target.closest('button[data-appfeat]');
    if (!b) return;
    var on = !b.classList.contains('on'), m = document.getElementById('appFeatMsg'), label = b.getAttribute('aria-label');
    if (!on && !window.confirm('Turn OFF "' + label + '" in every copy of FixCore Ultimate?')) return;
    b.disabled = true;
    post('/api/admin/app-config', { app: 'ultimate', feature: b.getAttribute('data-appfeat'), on: on }).then(function(r){
      if (!r.ok){ b.disabled = false; m.textContent = (r.d && r.d.error) || 'Could not change it.'; return; }
      drawAppCfg(r.d);
      m.textContent = label + ' is ' + (on ? 'on' : 'OFF') + ' for everyone (within 10 minutes).';
    });
  });

  // ---------- emergency shutdown ----------
  function sinceText(iso){
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var min = Math.max(0, Math.round((Date.now() - t) / 60000));
    return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) +
      ' (' + (min < 1 ? 'just now' : min < 60 ? min + ' min ago' : Math.round(min / 60) + ' h ago') + ')';
  }
  function showEmergency(d){
    var block = document.getElementById('emgBlock');
    block.classList.toggle('is-down', !!d.on);
    document.getElementById('emgOff').hidden = !!d.on;
    document.getElementById('emgOn').hidden = !d.on;
    document.getElementById('emgState').textContent = d.on ? 'THE WEBSITE IS OFFLINE' : 'The website is open for customers.';
    if (d.on){
      document.getElementById('emgOnText').textContent = 'Shut down ' + sinceText(d.since) + (d.by ? ' by ' + d.by : '') + '.' +
        (d.message ? ' Visitors see: \u201c' + d.message + '\u201d' : ' No message for visitors.');
    }
  }
  function loadEmergency(){
    api('/api/admin/emergency').then(function(r){
      if (r.ok) showEmergency(r.d);
      else document.getElementById('emgState').textContent = (r.d && r.d.error) || 'Could not check.';
    }).catch(function(){ document.getElementById('emgState').textContent = 'Could not reach the server.'; });
  }
  document.getElementById('emgShut').addEventListener('click', function(){
    var btn = this, m = document.getElementById('emgResult');
    var typed = window.prompt('This takes fixcorepc.com offline for everyone right now.\n\nType SHUTDOWN to confirm.');
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'SHUTDOWN'){ m.textContent = 'Not shut down. You have to type SHUTDOWN.'; return; }
    btn.disabled = true; m.textContent = 'Shutting down…';
    post('/api/admin/emergency', { on: true, message: document.getElementById('emgMsg').value.trim() }).then(function(r){
      btn.disabled = false;
      if (!r.ok){ m.textContent = (r.d && r.d.error) || 'Could not shut down.'; return; }
      m.textContent = 'The website is offline. Visitors see the emergency screen within 30 seconds.';
      loadEmergency(); loadStatus();
    }).catch(function(){ btn.disabled = false; m.textContent = 'Could not reach the server.'; });
  });
  document.getElementById('emgOpen').addEventListener('click', function(){
    var btn = this, m = document.getElementById('emgResult');
    if (!window.confirm('Open the website for customers again?')) return;
    btn.disabled = true; m.textContent = 'Opening…';
    post('/api/admin/emergency', { on: false }).then(function(r){
      btn.disabled = false;
      if (!r.ok){ m.textContent = (r.d && r.d.error) || 'Could not open the website.'; return; }
      document.getElementById('emgMsg').value = '';
      m.textContent = 'The website is back online.';
      loadEmergency(); loadStatus();
    }).catch(function(){ btn.disabled = false; m.textContent = 'Could not reach the server.'; });
  });

  // ---------- system status (checks itself every 5 seconds while the tab is open) ----------
  var STATUS_EVERY_MS = 5000;
  var statusBusy = false, statusTimer = null, baseTitle = document.title;
  function statusCard(name, ok, detail){
    return '<div class="status-item' + (ok ? ' ok' : '') + '"><span class="status-dot"></span><div><b>' + esc(name) + '</b><small>' + esc(detail) + '</small></div></div>';
  }
  function showStatus(checks, note){
    var bad = checks.filter(function(c){ return !c.ok; }).length;
    document.getElementById('statusList').innerHTML = checks.map(function(c){ return statusCard(c.name, c.ok, c.detail); }).join('');
    var t = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var sum = document.getElementById('statusSummary');
    sum.textContent = (bad ? bad + ' problem' + (bad === 1 ? '' : 's') : 'Everything is working') + ' · checked ' + t + (note ? ' · ' + note : '');
    sum.className = 'status-summary' + (bad ? ' bad' : '');
    document.title = bad ? '(' + bad + ' down) ' + baseTitle : baseTitle;
  }
  function loadStatus(){
    if (statusBusy) return;   // the last check hasn't answered yet
    statusBusy = true;
    api('/api/admin/status').then(function(r){
      statusBusy = false;
      if (!r.ok){ showStatus([{ name: 'Accounts backend', ok: false, detail: (r.d && r.d.error) || ('Answered ' + r.status) }]); return; }
      showStatus(r.d.checks || []);
    }).catch(function(){
      statusBusy = false;
      showStatus([{ name: 'Accounts backend', ok: false, detail: 'Not answering. Railway may be down or redeploying.' }]);
    });
  }
  function startStatus(){
    loadStatus();
    clearInterval(statusTimer);
    statusTimer = setInterval(function(){ if (!document.hidden) loadStatus(); }, STATUS_EVERY_MS);
  }
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) loadStatus(); });
  document.getElementById('statusBtn').addEventListener('click', loadStatus);

  // ---------- orders ----------
  var orderSearch = document.getElementById('orderSearch');
  function loadOrders(){
    var body = document.getElementById('orderBody'), m = document.getElementById('orderMsg');
    m.textContent = 'Loading…'; body.innerHTML = '';
    api('/api/admin/orders?q=' + encodeURIComponent(orderSearch.value.trim())).then(function(r){
      if (!r.ok){ m.textContent = (r.d && r.d.error) || 'Could not load orders.'; return; }
      var items = r.d.orders || [];
      m.textContent = r.d.count + ' order' + (r.d.count === 1 ? '' : 's') + ' in total · ' + r.d.revenue + ' revenue' +
        (r.d.refunded ? ' · ' + r.d.refunded + ' refunded' : '') + (orderSearch.value.trim() ? ' · ' + items.length + ' match' : '');
      body.innerHTML = items.length ? items.map(function(o){
        return '<tr><td>' + esc((o.date || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(o.email) + '</td><td>' + esc(o.product) + '</td><td>' +
          esc(o.total) + (o.discount ? ' <small>(−' + esc(o.discount) + ')</small>' : '') + (o.refunded ? '<span class="tag-bad">Refunded</span>' : '') +
          '</td><td><code>' + esc(o.order) + '</code></td></tr>';
      }).join('') : '<tr><td colspan="5">No orders' + (orderSearch.value.trim() ? ' match that.' : ' yet.') + '</td></tr>';
    }).catch(function(){ m.textContent = 'Could not reach the server.'; });
  }
  document.getElementById('orderSearchBtn').addEventListener('click', loadOrders);
  orderSearch.addEventListener('keydown', function(e){ if (e.key === 'Enter') loadOrders(); });

  // ---------- discount codes (products + exact start/end) ----------
  function when(sec){
    if (!sec) return '';
    return new Date(sec * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  var promoProductsDrawn = false;
  function drawPromoProducts(products){
    if (promoProductsDrawn || !products) return;
    promoProductsDrawn = true;
    document.getElementById('promoProducts').innerHTML = products.map(function(p){
      return '<label class="' + (p.available ? '' : 'off') + '" title="' + (p.available ? '' : 'Add ' + esc(p.env) + ' on Railway to use this') + '">' +
        '<input type="checkbox" value="' + esc(p.key) + '"' + (p.available ? '' : ' disabled') + '> ' + esc(p.name) + '</label>';
    }).join('');
  }
  function loadPromos(){
    var body = document.getElementById('promoBody'), m = document.getElementById('promoMsg');
    api('/api/admin/promo-codes').then(function(r){
      if (!r.ok){ m.textContent = (r.d && r.d.error) || 'Could not load codes.'; body.innerHTML = ''; return; }
      drawPromoProducts(r.d.products);
      var items = r.d.codes || [];
      body.innerHTML = items.length ? items.map(function(c){
        var tag = c.status === 'scheduled' ? '<span class="tag-soon">Starts later</span>' : '';
        return '<tr><td><code>' + esc(c.code) + '</code>' + tag + '</td><td>' + esc(c.off) + '</td><td>' + esc((c.products || []).join(', ')) +
          '</td><td>' + esc(when(c.starts) || 'Now') + '</td><td>' + esc(when(c.ends) || 'Never') + '</td><td>' + esc(c.used) + (c.max ? ' / ' + esc(c.max) : '') +
          '</td><td><button type="button" class="acct-act danger" data-promo="' + esc(c.id) + '" data-code="' + esc(c.code) + '">Turn off</button></td></tr>';
      }).join('') : '<tr><td colspan="7">No active or upcoming codes.</td></tr>';
    }).catch(function(){ m.textContent = 'Could not reach the server.'; });
  }
  document.getElementById('promoBody').addEventListener('click', function(e){
    var btn = e.target.closest('button[data-promo]');
    if (!btn) return;
    if (!window.confirm('Turn off ' + btn.getAttribute('data-code') + '? Nobody can use it after this.')) return;
    btn.disabled = true;
    post('/api/admin/promo-codes/' + encodeURIComponent(btn.getAttribute('data-promo')) + '/deactivate').then(function(r){
      if (!r.ok){ window.alert((r.d && r.d.error) || 'Could not turn it off.'); btn.disabled = false; return; }
      loadPromos();
    });
  });
  function toUnix(id){
    var v = document.getElementById(id).value;   // local time from the date picker
    if (!v) return null;
    var t = new Date(v).getTime();
    return isNaN(t) ? NaN : Math.floor(t / 1000);
  }
  document.getElementById('promoCreate').addEventListener('click', function(){
    var btn = this, m = document.getElementById('promoMsg');
    var starts = toUnix('promoStart'), ends = toUnix('promoEnd');
    var products = [].map.call(document.querySelectorAll('#promoProducts input:checked'), function(x){ return x.value; });
    var body = {
      code: document.getElementById('promoCode').value.trim().toUpperCase(),
      type: document.getElementById('promoType').value,
      value: document.getElementById('promoValue').value,
      maxUses: document.getElementById('promoMax').value || null,
      startsAt: starts, endsAt: ends, products: products
    };
    if (!body.code || !body.value){ m.textContent = 'Fill in the code and how much it takes off.'; return; }
    if (isNaN(starts) || isNaN(ends)){ m.textContent = 'The start or end time isn\u2019t valid.'; return; }
    if (starts && ends && ends <= starts){ m.textContent = 'The end has to be after the start.'; return; }
    var what = (products.length ? 'for ' + products.length + ' product' + (products.length === 1 ? '' : 's') : 'for all products') +
      ', ' + (starts && starts * 1000 > Date.now() ? 'starting ' + when(starts) : 'starting now') + (ends ? ', ending ' + when(ends) : ', never ending');
    if (!window.confirm('Create ' + body.code + ' ' + what + '?')) return;
    btn.disabled = true; m.textContent = 'Creating…';
    post('/api/admin/promo-codes', body).then(function(r){
      btn.disabled = false;
      if (!r.ok){ m.textContent = (r.d && r.d.error) || 'Could not create the code.'; return; }
      m.textContent = r.d.scheduled ? r.d.code + ' is ready and turns on by itself at ' + when(starts) + '.' : r.d.code + ' is live. Customers can use it at checkout now.';
      ['promoCode', 'promoValue', 'promoMax', 'promoStart', 'promoEnd'].forEach(function(id){ document.getElementById(id).value = ''; });
      [].forEach.call(document.querySelectorAll('#promoProducts input'), function(x){ x.checked = false; });
      loadPromos();
    }).catch(function(){ btn.disabled = false; m.textContent = 'Could not reach the server.'; });
  });

  // ---------- newsletter ----------
  var nlCounts = {};
  var nlAudience = document.getElementById('nlAudience');
  function nlLabel(){
    var n = nlCounts[nlAudience.value];
    document.getElementById('nlSend').textContent = n == null ? 'Send' : 'Send to ' + n + ' ' + (n === 1 ? 'person' : 'people');
  }
  function loadNewsletterCounts(){
    api('/api/admin/newsletter').then(function(r){ if (r.ok){ nlCounts = r.d; nlLabel(); } });
  }
  nlAudience.addEventListener('change', nlLabel);
  function nlBody(test){
    return { audience: nlAudience.value, subject: document.getElementById('nlSubject').value.trim(),
             body: document.getElementById('nlBody').value.trim(), testEmail: test || '' };
  }
  document.getElementById('nlTestBtn').addEventListener('click', function(){
    var btn = this, m = document.getElementById('nlMsg'), to = document.getElementById('nlTest').value.trim();
    if (!to){ m.textContent = 'Enter an email to send the test to.'; return; }
    btn.disabled = true; m.textContent = 'Sending test…';
    post('/api/admin/newsletter', nlBody(to)).then(function(r){
      btn.disabled = false;
      m.textContent = r.ok ? 'Test sent to ' + to + '. Check how it looks before you send it for real.' : ((r.d && r.d.error) || 'Could not send the test.');
    }).catch(function(){ btn.disabled = false; m.textContent = 'Could not reach the server.'; });
  });
  document.getElementById('nlSend').addEventListener('click', function(){
    var btn = this, m = document.getElementById('nlMsg'), b = nlBody(), n = nlCounts[b.audience];
    if (!b.subject || !b.body){ m.textContent = 'Write a subject and some text first.'; return; }
    if (!window.confirm('Send "' + b.subject + '" to ' + (n == null ? 'everyone in this group' : n + ' people') + '?\n\nThis can\u2019t be stopped once it starts.')) return;
    btn.disabled = true; m.textContent = 'Starting…';
    post('/api/admin/newsletter', b).then(function(r){
      btn.disabled = false;
      m.textContent = r.ok ? 'Sending to ' + r.d.recipients + ' people in the background. It takes about a second per email.' : ((r.d && r.d.error) || 'Could not send.');
    }).catch(function(){ btn.disabled = false; m.textContent = 'Could not reach the server.'; });
  });

  // ---------- access check: Discord admin role ----------
  if (!discordToken){
    if (!authError && !read('fixcoreAdminAutoTried')){
      who.textContent = 'Checking your Discord…';
      signInWithDiscord(true);
      return;
    }
    discordGate(authError ? "Discord sign-in was cancelled or didn't finish. Try again." : 'Sign in with Discord to open the admin page.');
    return;
  }
  api('/api/admin/me').then(function(r){
    if (r.ok){
      who.innerHTML = 'Signed in as <b>' + esc(r.d.name) + '</b> · <a href="#" id="adminSignOut" class="link-btn">Sign out</a>';
      document.getElementById('adminSignOut').addEventListener('click', function(e){
        e.preventDefault(); store('fixcoreAdminDiscordToken', null); window.location.reload();
      });
      gate.hidden = true; app.hidden = false;
      loadOverview(); loadPayouts(); loadAccounts(); loadSales();
      loadEmergency(); loadAppCfg(); loadFeatures(); loadBanner(); loadStats(); loadAlerts(); startStatus(); loadOrders(); loadPromos(); loadNewsletterCounts();
      return;
    }
    var code = r.d && r.d.code;
    if (r.status === 401){ store('fixcoreAdminDiscordToken', null); discordGate('Your Discord sign-in has expired. Sign in again.'); }
    else if (code === 'role') showGate("Your Discord account doesn't have the admin role, so you can't open this page.", 'Back to FixCore', 'index.html');
    else showGate((r.d && r.d.error) || 'Could not check your access right now. Try again in a minute.', 'Try again', 'admin.html');
  }).catch(function(){
    showGate('Could not reach the server. Try again in a minute.', 'Try again', 'admin.html');
  });
})();
