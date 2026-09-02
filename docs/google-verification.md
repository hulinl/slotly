# Google OAuth Verification — kompletní postup

Slotly žádá dva **sensitive scopes**:
- `https://www.googleapis.com/auth/calendar.events` (read+write events)
- `https://www.googleapis.com/auth/calendar.readonly` (list calendars, read free/busy)

Sensitive scopes vyžadují Google verifikaci. Bez ní jsou dvě omezení:

| Publishing status | User cap | UX pro nového uživatele |
|---|---|---|
| **Testing** | max 100 test users (whitelist) | Bez warningu, ale musíš přidat email do whitelistu |
| **In production, unverified** | ∞ | Vidí žlutý warning "This app isn't verified" → Advanced → Go to slotly.team |
| **In production, verified** | ∞ | Normální consent screen, žádný warning |

Cíl: dostat se na řádek 3.

---

## Fáze 1 — HNED: Publish App (kolega přestane dostávat 403)

1. Google Cloud Console → **APIs & Services → OAuth consent screen** (v novém UI **Audience**)
2. Ověř že všechna pole jsou vyplněná:
   - App name: `Slotly`
   - User support email: `hulin@bifactory.cz`
   - App logo: **nahraj** PNG 120×120px (viz Fáze 2 co použít)
   - App domain — Homepage: `https://slotly.team`
   - App domain — Privacy policy: `https://slotly.team/privacy`
   - App domain — Terms of service: `https://slotly.team/terms`
   - Authorized domains: `slotly.team`
   - Developer contact information: `hulin@bifactory.cz`
3. Sekce **Scopes** — zkontroluj že máš:
   - `.../auth/calendar.events`
   - `.../auth/calendar.freebusy`
   - `.../auth/calendar.readonly`
   - `openid`, `email`, `profile`
4. Nahoře na consent screen stránce klikni **PUBLISH APP** → potvrdit
5. Status se změní z **Testing** na **In production**

**Ověř**: kolegovi řekni ať zkusí Connect Google znovu. Uvidí warning:

> **This app isn't verified**
> This app hasn't been verified by Google yet. Only proceed if you know and trust the developer.

Uprostřed toho screenu je maličký odkaz **Advanced** (v CZ **Rozšířené**). Klik → objeví se **Go to slotly.team (unsafe)** (v CZ **Přejít na slotly.team (nebezpečné)**). Klik → dostane se na normální consent → povolí → hotovo.

**Není to hezké UX, ale funguje pro všechny.** Verifikace warning odstraní.

---

## Fáze 2 — Verifikaci připravit (asi hodina práce před submissionem)

### 2a. Logo aplikace

Google chce **120×120 PNG** (nebo větší, čtvercové). Vezmi `frontend/public/apple-icon.png` nebo `icon.svg` a vyexportuj:

```bash
# Máš imagemagick? Rychlá cesta:
cd /Users/hulin/3_Dev/slotly/frontend/public
magick apple-icon.png -resize 512x512 slotly-logo-512.png
```

Nahraj v OAuth consent screen → App logo → Upload. Google ho pak reviewuje (obvykle < 1h).

### 2b. Homepage compliance

Landing page (`https://slotly.team` když nejsi přihlášený) už teď obsahuje:
- Popis co Slotly dělá
- Explicitní sekci "How Slotly uses Google user data" s výčtem každého scope
- Odkaz na Limited Use Policy
- Odkazy na `/privacy` a `/terms`

Google reviewer tenhle text zkontroluje. **Nic už neupravuj** — je to psané přesně tak, aby reviewer identifikoval každý scope se svým use casem.

### 2c. Privacy policy compliance

`/privacy` už obsahuje **Limited Use disclosure** větu:

> Slotly's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

+ výčet jak data používáme, nesdílíme, nepoužíváme pro AI. Compliant.

### 2d. Nahrát demo video

**Musíš natočit ~2min video** a nahrát na YouTube (může být **Unlisted** — jen s odkazem, nemusí být veřejné). Storyboard níže.

Cíl: reviewer vidí každý requested scope v akci.

**Storyboard (přesně to natoč):**

| Vteřina | Co je na obrazovce | Co říkáš / píšeš do popisu |
|---|---|---|
| 0:00-0:10 | slotly.team homepage (přihlášený) | "This is Slotly, a group scheduling app for teams. I'll show how we use each Google Calendar scope." |
| 0:10-0:25 | Odhlásíš se → jdeš na `/auth/register` → klikáš **Sign up with Google** | "Users can sign up with Google — a single consent gives us identity and calendar access." |
| 0:25-0:45 | Google consent screen se všemi scopes | "You can see we request calendar.events, calendar.readonly, and calendar.freebusy. Let me show why we need each." |
| 0:45-1:05 | Po consentu skočíš na `/profile`. Otevřeš `/settings/calendars` | "**calendar.readonly** — used here to list the user's calendars so they can pick which one Slotly writes new meetings into." |
| 1:05-1:25 | Jdeš na `/people/<colleague-id>`, zapneš intersection toggle, vidíš zelené sloty | "**calendar.freebusy** — reads only busy intervals from all connected calendars to compute shared free time. Never event titles, attendees, or descriptions." |
| 1:25-1:50 | Klikneš na volný slot, otevře se BookingDialog, vyplníš, kliknete Book, ukáže success | "**calendar.events** — creates the actual calendar event, invites the attendees, and adds a Google Meet link, all in one click." |
| 1:50-2:00 | Ukážeš právě vytvořený event v Google Calendar | "The event lands in the user's Google Calendar. That's every scope we request, each with a single, direct purpose." |

**Nahrávací tipy:**
- macOS: `Cmd+Shift+5` → Record Selected Portion → tvůj browser window
- Zvuk mikrofonu naznač (Google review si přehraje bez zvuku, ale se zvukem to zvýší akceptaci)
- Rozlišení: minimum 720p
- Formát: MP4 (screen recording default)
- Upload na YouTube jako **Unlisted** (odkaz jen pro reviewer)

### 2e. Scope justification texty (copy-paste do Google formuláře)

Až v Google Console klikneš **Prepare for verification**, dostaneš formulář s textovými poli. Vlož přesně tyto texty (jsou napsané ve stylu, který Google akceptuje — konkrétní, uživatelský benefit, minimum scope):

**Field: How will the scopes be used?**
```
Slotly is a group scheduling web application. Users connect their Google
Calendar so Slotly can (1) show them and their colleagues shared free time,
and (2) create the meeting in the calendar with attendees invited.

We request three Calendar scopes, each with a single, narrow purpose:

- calendar.readonly — read the user's calendar list so they can pick which
  specific calendar new meetings from Slotly should be written into (users
  often keep separate calendars for work vs personal). We read the list of
  calendars only; we do not read event contents through this scope.

- calendar.freebusy — read busy intervals only (start/end + free/busy flag,
  no event titles, attendees, or descriptions) from all connected calendars
  to compute the intersection of everyone's availability. This is Slotly's
  core "find a time everyone can meet" feature.

- calendar.events — create calendar events when the user explicitly clicks
  "Book" in Slotly, either from a search result or from someone booking a
  time via their public share link. Attendees are invited and a Google Meet
  link is auto-generated. We only write; we do not read event contents
  through this scope.

We do not use Google user data for training AI/ML models, for advertising,
or share it with third parties for those purposes. Data storage is limited
to encrypted OAuth tokens and cached free/busy intervals; users can delete
their account and all data at any time from Settings → Account.
```

**Field: Why can't you use a narrower scope?**
```
- calendar.readonly is the narrowest scope that lets us list the user's
  calendars via calendarList. calendar.calendarlist.readonly would work
  but is less commonly used and has similar sensitivity; we picked the
  more familiar one.
- calendar.freebusy is the dedicated read-only scope for busy intervals —
  we deliberately don't request calendar.readonly for event contents.
- calendar.events is required to insert events into the user's calendar
  (no less-privileged alternative exists for calendar write).
```

**Field: Demo video URL** — vlož YouTube URL z Fáze 2d.

---

## Fáze 3 — Submit & čekat

1. Google Cloud Console → **OAuth consent screen** → sekce **Verification status** → **Prepare for verification** → **Submit for verification**
2. Přijde e-mail od `oauth-verification@google.com` do několika hodin že přijali submission
3. Za 3-7 dní přijde první odpověď — často "clarification needed" ohledně:
   - **Domain ownership** — pošlou odkaz na Search Console kde musíš verifikovat vlastnictví `slotly.team`. Typicky přidání TXT record do DNS. Máš ownership přes registrátora — trvá to pár minut.
   - **Video re-recording** — pokud ve videu něco chybí, řeknou co doplnit. Znovu nahraj a odešli link.
   - **Privacy policy tweaks** — pokud tam něco chybí (obvykle Limited Use disclosure), doplní ti co konkrétně opravit.
4. Iteruj (obvykle 1-2 rounds) dokud approval nedostaneš
5. **Celkově 4-6 týdnů** od prvního submitu do approvalu je normální

Během čekání app funguje s tím warningem "unverified". Nový uživatelé projdou přes Advanced.

---

## Co dělat, když se blíží 100 unverified user cap

Pro **unverified apps in production** je limit **100 grants**. Když se blížíš, přijde e-mail od Google. Options:
- Rychle dokončit verifikaci
- Rotovat client secret + vytvořit druhý OAuth client (nedoporučuji, snadno se ztratí track)

Ideálně mít verifikaci hotovou dřív než 100. Podle českého trhu to není otázka dnů, ale spíš týdnů-měsíců.

---

## TL;DR co musíš teď udělat

1. **Publish App** v OAuth consent screen (5 kliků) → kolega může okamžitě
2. **Nahrát app logo** (512×512 PNG z `frontend/public/apple-icon.png`)
3. **Natočit video** podle storyboardu v Fázi 2d (~30 min setup + 2 min nahrávání)
4. **Nahrát na YouTube Unlisted**, ulož odkaz
5. **Prepare for verification** → vlož scope justification texty z Fáze 2e + YouTube link → Submit
6. **Čekej** 3-7 dní na první response, pak iteruj

Napiš mi, u kterého kroku váznou pochyby — u ověřování domain, u nahrání videa, u čeho koli. Nebo pošli výsledek Publish App, ať vím že kolega odemčel.
