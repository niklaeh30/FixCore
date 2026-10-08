/* FixCore — two-step login (code by email).
   Every page has its own login code inside a hashed inline script, so instead
   of editing those, this file wraps fetch(): when /api/login answers
   "twoFactor", it asks for the emailed code, finishes the login at
   /api/login/verify and hands the page the normal { token, user } answer. */
(function(){
  'use strict';
  if (!window.fetch || window.__fcTwoStep) return;
  window.__fcTwoStep = true;

  var API_BASE = 'https://web-production-fae792.up.railway.app';
  var realFetch = window.fetch.bind(window);

  function isLogin(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    return method === 'POST' && /\/api\/login(\?|$)/.test(url);
  }

  function jsonResponse(status, body){
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  }

  function post(path, body){
    return realFetch(API_BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(data){ return { ok: res.ok, data: data }; });
    });
  }

  var css = '' +
    '.fc2s-ov{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(3,4,12,.78);backdrop-filter:blur(6px);}' +
    '.fc2s-box{width:100%;max-width:400px;padding:30px 28px;border-radius:18px;border:1px solid var(--line-2,rgba(128,142,255,.26));background:linear-gradient(180deg,var(--panel-2,#10152d),var(--panel,#0b0e20));color:var(--text,#eef0ff);text-align:center;}' +
    '.fc2s-box h2{font-size:22px;margin:0 0 8px;}' +
    '.fc2s-box p{color:var(--text-2,#a3aad0);font-size:14.5px;margin:0 0 20px;}' +
    '.fc2s-box b{color:var(--text,#eef0ff);}' +
    '.fc2s-code{width:100%;box-sizing:border-box;text-align:center;font-family:var(--font-mono,Consolas,monospace);font-size:28px;letter-spacing:10px;padding:12px 8px 12px 18px;border-radius:10px;border:1px solid var(--line-2,rgba(128,142,255,.26));background:var(--bg-2,#080a19);color:var(--text,#eef0ff);margin-bottom:12px;}' +
    '.fc2s-code:focus{outline:none;border-color:rgba(0,196,255,.7);box-shadow:0 0 0 3px rgba(0,196,255,.15);}' +
    '.fc2s-box .fc2s-err{color:var(--danger,#ff6b81);font-size:13.5px;min-height:18px;margin:0 0 12px !important;}' +
    '.fc2s-box .fc2s-err.ok{color:var(--ok,#35e08c);}' +
    '.fc2s-links{display:flex;justify-content:center;gap:18px;margin-top:16px;}' +
    '.fc2s-links button{background:none;border:0;color:var(--link,#62b6ff);font:inherit;font-size:13.5px;cursor:pointer;padding:4px;}' +
    '.fc2s-links button:disabled{color:var(--text-3,#6b7399);cursor:default;}';

  function askForCode(challenge, emailHint){
    return new Promise(function(resolve){
      if (!document.getElementById('fc2s-style')){
        var st = document.createElement('style'); st.id = 'fc2s-style'; st.textContent = css;
        document.head.appendChild(st);
      }
      var ov = document.createElement('div');
      ov.className = 'fc2s-ov';
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'fc2sTitle');
      ov.innerHTML =
        '<div class="fc2s-box">' +
          '<h2 id="fc2sTitle">Check your email</h2>' +
          '<p>We sent a 6-digit code to <b class="fc2s-hint"></b>. Enter it to finish logging in.</p>' +
          '<input class="fc2s-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="6-digit code">' +
          '<p class="fc2s-err" role="status"></p>' +
          '<button type="button" class="btn btn-primary form-submit fc2s-go">Log in</button>' +
          '<div class="fc2s-links"><button type="button" class="fc2s-resend">Send a new code</button><button type="button" class="fc2s-cancel">Cancel</button></div>' +
        '</div>';
      ov.querySelector('.fc2s-hint').textContent = emailHint || 'your email';
      document.body.appendChild(ov);

      var input = ov.querySelector('.fc2s-code'), err = ov.querySelector('.fc2s-err');
      var go = ov.querySelector('.fc2s-go'), resend = ov.querySelector('.fc2s-resend');
      var finished = false;
      setTimeout(function(){ input.focus(); }, 30);

      function say(text, ok){ err.textContent = text || ''; err.className = 'fc2s-err' + (ok ? ' ok' : ''); }
      function finish(res){
        if (finished) return;
        finished = true;
        document.removeEventListener('keydown', onKey, true);
        ov.remove();
        resolve(res);
      }
      function cancel(){
        finish(jsonResponse(400, { error: 'Login cancelled. Log in again to get a new code.', code: 'two_step_cancelled' }));
      }
      function onKey(e){ if (e.key === 'Escape'){ e.stopPropagation(); cancel(); } }
      document.addEventListener('keydown', onKey, true);

      function verify(){
        var code = input.value.replace(/\s+/g, '');
        if (!/^\d{6}$/.test(code)){ say('Enter the 6-digit code from the email.'); return; }
        go.disabled = true; go.textContent = 'Checking…'; say('');
        post('/api/login/verify', { challenge: challenge, code: code }).then(function(r){
          go.disabled = false; go.textContent = 'Log in';
          if (r.ok){ finish(jsonResponse(200, r.data)); return; }
          say((r.data && r.data.error) || "That code didn't work. Try again.");
          input.select();
        }).catch(function(){
          go.disabled = false; go.textContent = 'Log in';
          say("Couldn't reach FixCore. Check your connection and try again.");
        });
      }

      go.addEventListener('click', verify);
      input.addEventListener('input', function(){
        input.value = input.value.replace(/\D/g, '').slice(0, 6);
        if (input.value.length === 6) verify();
      });
      input.addEventListener('keydown', function(e){ if (e.key === 'Enter') verify(); });
      ov.querySelector('.fc2s-cancel').addEventListener('click', cancel);
      resend.addEventListener('click', function(){
        resend.disabled = true;
        post('/api/login/resend', { challenge: challenge }).then(function(r){
          if (r.ok){
            challenge = r.data.challenge;
            input.value = '';
            say('New code sent. Codes work for 10 minutes.', true);
            setTimeout(function(){ resend.disabled = false; }, 30000);
          } else {
            resend.disabled = false;
            if (r.data && r.data.code === 'restart'){ finish(jsonResponse(400, { error: r.data.error })); return; }
            say((r.data && r.data.error) || "Couldn't send a new code.");
          }
        }).catch(function(){ resend.disabled = false; say("Couldn't reach FixCore. Try again."); });
      });
    });
  }

  window.fetch = function(input, init){
    var p = realFetch(input, init);
    if (!isLogin(input, init)) return p;
    return p.then(function(res){
      if (!res.ok) return res;
      return res.clone().json().then(function(data){
        if (!data || !data.twoFactor || !data.challenge) return res;
        return askForCode(data.challenge, data.emailHint);
      }, function(){ return res; });
    });
  };
})();
