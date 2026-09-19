# FixCore Accounts API

E-post + passord-konto for FixCore, som et helt eget lite Flask-API.
Ingen e-post sendes noe sted — bare enkel registrering/innlogging.

## Hva den gjør

- `POST /api/register` — oppretter konto (email + passord, min. 8 tegn),
  returnerer en innloggingstoken
- `POST /api/login` — logger inn med email + passord, returnerer token
- `GET /api/me` — henter brukerinfo fra en gyldig token
- Passord lagres aldri i klartekst (bcrypt)
- Token er en JWT som er gyldig i 30 dager, lagres i nettleseren

## 1. Kjør lokalt (for å teste)

```bash
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
copy .env.example .env
```

Åpne `.env` og lim inn en tilfeldig verdi for `JWT_SECRET` (hva som
helst, bare gjør den lang).

```bash
python app.py
```

Serveren kjører nå på `http://localhost:5000`. `index.html` og
`callback.html` peker allerede på denne adressen (`API_BASE`), så du
kan bare åpne `index.html` i nettleseren og teste "Sign Up"/"Sign In"
direkte — ingen GitHub eller Railway nødvendig for dette.

**NB:** La terminalvinduet med `python app.py` stå åpent mens du
tester — lukker du det, stopper serveren, og "Could not reach the
server" dukker opp igjen i login-modalen.

## 2. Deploy til Railway (når du er klar for det ekte nettstedet)

Samme mønster som redeem-boten din:

1. Push denne mappen til et nytt privat GitHub-repo, f.eks. `fixcore-accounts`
2. Railway → **New Project** → **Deploy from GitHub repo** → velg repoet
3. Under **Variables**, legg inn:
   - `JWT_SECRET` (generer med `python -c "import secrets; print(secrets.token_hex(32))"`)
   - `ALLOWED_ORIGINS` → `https://fixcorepc.com`
4. Under **Settings → Deploy**, sett start-kommandoen til:
   ```
   gunicorn app:app
   ```
5. Railway gir deg en offentlig URL, f.eks. `fixcore-accounts-production.up.railway.app`
   — den bruker du i frontend-koden (se under).

**NB:** SQLite-filen (`fixcore_accounts.db`) lagres på disken til
Railway-tjenesten, som nullstilles ved redeploy med mindre du legger til
en **Volume** i Railway under **Settings → Volumes** og peker
`DATABASE_PATH` dit. Grei nok å starte uten, men verdt å sette opp før
du har mange brukere.

## 3. Koble til nettsiden

Bytt ut `API_BASE` i `<script>`-delen av login-modalen (i `index.html`
og `callback.html`) med Railway-URL-en din når du deployer:

```js
var API_BASE = 'https://fixcore-accounts-production.up.railway.app';
```

Akkurat nå peker den på `http://localhost:5000` for lokal testing.
De andre sidene (`download.html`, `privacy.html`, `terms.html`,
`products.html`) har foreløpig bare Discord-innlogging — si ifra når
du vil ha samme e-post/passord-skjema kopiert inn der også.
