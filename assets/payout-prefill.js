/* FixCore — fills the affiliate payout form (index.html) with the payout
   details saved on settings.html. Separate file so index.html's inline
   script (and its CSP hash) stays untouched. */
(function(){
  'use strict';
  var API_BASE = 'https://web-production-fae792.up.railway.app';
  var btn = document.getElementById('affPayoutBtn');
  if (!btn) return;
  var done = false;
  btn.addEventListener('click', function(){
    if (done) return;
    var s = null;
    try { s = JSON.parse(localStorage.getItem('fixcore_email_user') || 'null'); } catch (e) { /* ignore */ }
    if (!s || !s.authToken) return;
    fetch(API_BASE + '/api/me/payout-details', { headers: { 'Authorization': 'Bearer ' + s.authToken } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        var p = data && data.payout;
        if (!p) return;
        done = true;
        var fill = function(id, v){ var el = document.getElementById(id); if (el && !el.value && v) el.value = v; };
        if (p.method === 'bank'){
          var tab = document.querySelector('.aff-tab[data-method="bank"]');
          if (tab) tab.click();
          fill('affBankHolder', p.holder); fill('affBankAccount', p.account); fill('affBankSwift', p.swift);
        } else {
          fill('affPaypalEmail', p.paypalEmail);
        }
      })
      .catch(function(){ /* the form still works without it */ });
  });
})();
