# PRD — Slotly

> **Working title.** Alternatives: Whenly, Convene, Overlap. To be finalized before public launch.

A web application for sharing personal and work calendars across team members and finding shared availability windows for meetings.

---

## 1. Executive Summary

Slotly is a free, web-based scheduling utility for teams. Each user connects their calendars (Google, Microsoft, Apple) and sets working hours. Users form teams, and any team member can pick a subset of teammates, choose a meeting duration, and instantly see all upcoming time windows when *everyone* is free.

Unlike Calendly (one-on-one booking links) or Doodle (poll-based), Slotly focuses on **internal team coordination**: "When can these five people meet for 90 minutes in the next month?"

---

## 2. Goals & Non-Goals

### Goals (MVP)
- Eliminate calendar Tetris when scheduling internal team meetings.
- Aggregate free/busy data across Google, Microsoft, and Apple calendars.
- Respect each person's working hours and personal availability windows.
- Support multiple teams per user; lightweight team management.
- Be free, public, self-serve. No sales touch needed.

### Non-Goals (MVP — explicitly out of scope)
- Booking links / external scheduling (Calendly-style).
- Writing events to calendars (read-only only).
- Multi-timezone teams.
- Paid tiers / billing.
- Mobile native apps (PWA only).
- Advanced AI suggestions ("best slot for energy levels").
- Data export (GDPR portability — deferred).
- Saved-search alerts ("notify me when X is free").

---

## 3. Target Users & Use Cases

### Primary persona
Knowledge worker in a team of 5–25 people who frequently needs to coordinate internal meetings (devs, designers, PMs, leadership). Comfortable with cloud calendars; no admin/IT involvement needed.

### Core use cases
1. **Find a 1-hour slot for me + 4 colleagues in the next 2 weeks.**
2. **Check one specific colleague's availability for the rest of the week.**
3. **Onboard a new hire by adding them to the team and seeing their schedule integrate.**
4. **Run a recurring meeting search for "the dev team" without re-clicking the same names.**

### Team size
Target 10–20 members per team, but no enforced upper limit. Search performance must remain acceptable for teams up to ~50.

---

## 4. Scope: MVP vs. Future

| Area | MVP | Future |
|---|---|---|
| Calendar privacy | Free/busy only (no titles, no details) | Per-calendar configurable visibility (free/busy / titles / full) |
| Calendar connection | ICS URL subscription (user pastes private iCal link) | OAuth (Google, MS) for one-click connect + real-time sync |
| Calendar providers | Google, Apple iCloud, MS 365 (where publishing is enabled), generic ICS | MS 365 corporate (via OAuth), Outlook on-prem (Exchange), CalDAV |
| Sync freshness | Polling every 5 min (worst-case ~15 min before user sees a new event) | Real-time push (seconds) via OAuth webhooks |
| Sign-in | Email + password | Google/Microsoft SSO |
| Search | Strict (everyone must be free) | Flexible ("4 of 5 free"), partial-match scoring |
| Notifications | Pull (user clicks search) | Saved-search alerts ("ping me when slot opens") |
| Timezones | Single TZ assumption | Multi-TZ teams |
| Data export | None | GDPR portability export (JSON) |
| Mobile | PWA (add to home screen) | Native iOS/Android |
| Monetization | Free | Freemium tiers (team size, history, integrations) |
| Booking | Read-only — user creates meeting in their own calendar app | One-click booking that writes events to all attendees |

---

## 5. Feature Specifications

### 5.1 Authentication & Onboarding

**Registration**
- Email + password.
- Email verification required (link with token, expires in 24h).
- Password requirements: min 10 chars, must contain at least 1 letter and 1 digit. Stored hashed (Argon2).
- Optional fields at registration: first name, last name (required for display).

**Login**
- Email + password.
- "Forgot password" flow (email reset link, expires in 1h).
- Session: HTTP-only secure cookie, 30-day rolling expiry.

**Guided onboarding (first login)**
After verifying email, the user is walked through:
1. **Profile** — confirm first/last name; optional: phone, avatar.
2. **Working hours** — confirm or edit defaults (Mon–Fri 8:00–17:00, Sat–Sun unavailable).
3. **Add a calendar** — optional; paste an iCal/ICS URL (provider-specific help on how to find it). User can skip and is treated as fully available within working hours.
4. **Teams** — show pending invitations (if any) and option to create a new team.

User can revisit any step from settings. Onboarding can be skipped at any point.

### 5.2 Calendar Connection (ICS URL subscription)

**Approach**
Slotly reads each user's calendar by **subscribing to its iCalendar (ICS) URL**. The user retrieves a private/secret iCal URL from their calendar provider and pastes it into Slotly. Slotly polls the URL every 5 minutes, parses the response (RFC 5545), and stores **only** start/end/status fields used for free-busy computation. No OAuth flow is involved in MVP.

This trade-off was chosen explicitly to ship MVP fast (days vs. weeks), avoid Google OAuth verification, and treat all three providers uniformly. OAuth integration is planned for v1.1 (real-time sync, smoother onboarding, corporate-tenant compatibility).

**Supported providers (in-app instructions per provider)**
- **Google Calendar** — Settings → calendar of choice → *Integrate calendar* → "Secret address in iCal format". One URL per Google calendar.
- **Apple iCloud** — In iCloud web (icloud.com/calendar) or macOS Calendar.app, share calendar publicly → copy URL. Convert any `webcal://` prefix to `https://` (Slotly handles both).
- **Microsoft 365 / Outlook.com** — Outlook Web → Calendar → *Sharing and permissions* → *Publish calendar* → copy ICS link. **Note**: many corporate tenants disable calendar publishing by admin policy; affected users cannot connect Microsoft calendars in v1.0 and must wait for v1.1 OAuth.
- **Generic CalDAV / ICS** — any HTTPS URL returning valid iCalendar data is accepted ("Other ICS URL" option).

**Adding a calendar**
1. User clicks "Add calendar" in settings.
2. Picks provider (or "Other"). Provider-specific help screen with screenshots is shown.
3. Pastes URL and gives it a friendly name (default: extracted from `X-WR-CALNAME` if present, otherwise the host).
4. Slotly fetches the URL once synchronously: must return HTTP 200 and parse as valid ICS. On success, calendar is saved; first events are visible immediately. On failure, an actionable error message is shown.
5. URL is encrypted at rest (Azure Key Vault-backed envelope encryption). It is treated as a secret and never logged.

**Multiple calendars**
- A user may add unlimited URLs (e.g. work Google + personal Google + iCloud + a public holidays feed).
- Each subscribed calendar has an "Include in busy time" toggle. Default: on. Useful for excluding holiday/sport calendars.

**Privacy enforcement (free/busy filter)**
On every parse, Slotly extracts only:
- `DTSTART`, `DTEND` (or `DURATION`)
- `STATUS` (CONFIRMED / TENTATIVE / CANCELLED)
- `TRANSP` (OPAQUE = busy, TRANSPARENT = free)
- `RRULE`, `RDATE`, `EXDATE` (recurrence)
- `ATTENDEE PARTSTAT` matching the user's account email — to detect declined events (best-effort; not always present in published ICS)

**All other fields are discarded immediately** during parse: `SUMMARY` (title), `DESCRIPTION`, `LOCATION`, `ATTENDEE` list, `ORGANIZER`, `CATEGORIES`, `URL`, `X-*` extensions. They never enter the database. Enforced by an explicit field whitelist in the parser plus a unit test suite using fixture ICS payloads (Google, Apple, Outlook, edge cases).

**Disconnecting**
- User clicks "Remove" on a calendar. The URL and all parsed events from it are deleted from the cache within 5 minutes.

**Errors and stale URLs**
- If a poll returns 4xx/5xx or times out for **3 consecutive attempts** (~15 min), the calendar is marked "Sync failing" in the UI. Last-known events are retained.
- After **24 hours** of continuous failure, an email + in-app notification is sent ("Reconnect: calendar 'Work' is no longer reachable"). Last-known events expire after 7 days of failure.
- If a parse succeeds but ICS is malformed, last-known events are kept; user is notified after 3 consecutive parse failures.
- Users can edit the URL in place (e.g. after regenerating their secret address).

**Sync behavior**
- **Polling cadence**: every 5 minutes per URL, with up to 30s jitter to spread load.
- **Conditional GET**: `If-Modified-Since` and `If-None-Match` headers used when the provider returns `Last-Modified`/`ETag`, to reduce bandwidth.
- **Nightly full reconciliation**: each URL is force-refetched once per day (cache headers ignored) to defend against stale CDN caches at the provider end.
- **Sync window**: Slotly retains parsed events from `now − 1 day` to `now + 3 months` per calendar. Older/farther events are not stored.
- **Last-synced indicator**: each calendar in settings shows "Last synced: 2 min ago". Slot-search UI shows a global "Data may be up to ~5 min stale" tooltip.

### 5.3 Teams & Invitations

**Team creation**
- Any user can create a team. Required: team name. Optional: description.
- Creator becomes the first admin.

**Membership**
- A user can belong to any number of teams (no limit).
- A team can have any number of members (no enforced upper limit; soft cap warning at 100).

**Roles**
- **Admin** — can invite, remove members, promote/demote admins, edit team name/description, delete team.
- **Member** — can view team roster, view profiles of teammates, run availability searches.
- A team can have multiple admins simultaneously.

**Inviting members**
- Admin enters an email address (no public user search).
- If email belongs to an existing Slotly user: they receive an in-app + email invitation. Must accept to join.
- If email is *not* a registered user: they receive an email with a registration link. After registering and verifying email, they are automatically added to the team. The pending invitation is tied to the email; if a different email registers, the invite is unaffected.
- Invitations expire after 30 days.
- Admin can re-send or cancel a pending invitation.

**Accepting/rejecting**
- Invited user sees pending invites in the app and via email. Can accept or reject.
- Acceptance is required to view team or be searchable within it.

**Leaving / removal**
- Member can leave a team at any time (one-click, with confirmation).
- Admin can remove any member (including other admins, but not themselves while they are the only remaining admin).
- After leaving or being removed: clean cut. The user no longer appears in the team, can't see other members, and other members can't see them. No history retained for the user.

**Team deletion**
- Explicit deletion by an admin (with confirmation).
- **Implicit deletion**: if all admins leave or are demoted such that zero admins remain, the team is automatically deleted and all members are notified by email + in-app.
- If the only admin leaves a team, the system blocks the action and prompts: "Promote another member to admin first, or delete the team."

### 5.4 Availability Search (core feature)

**Inputs**
- **Team** (one team selected at a time).
- **Members** (multi-select from the team roster; at least 2, including or excluding self).
- **Duration** — choose preset (15 / 30 / 45 / 60 / 90 / 120 min, half-day, full-day) or enter a custom value in minutes.
- **Search window**:
  - Start: default = now (rounded up to next 15-min step). Editable.
  - End: default = now + 3 months. Editable.
- **Buffer** (optional): default 15 min before/after each existing event. User can change to 0 / 5 / 10 / 15 / 30 min.

**Matching rules**
- A slot is valid if **all selected members are free** for the entire slot duration (strict match in MVP).
- A member is "free" at time `t` if:
  - `t` falls within their working hours for that day of week, AND
  - No event in any of their selected calendars overlaps `[t − buffer, t + duration + buffer]`, AND
  - The day is not marked as "unavailable" in their working-hours settings.
- If a member has no calendar connected, they are treated as **free during their working hours**.
- Slots start at 15-minute increments (e.g. 09:00, 09:15, 09:30 …).

**Event treatment edge cases**
| Event type | Treated as |
|---|---|
| Confirmed event (`STATUS:CONFIRMED` or absent) | Busy |
| Tentative / "Maybe" (`STATUS:TENTATIVE`) | Busy |
| All-day event (`DTSTART;VALUE=DATE`) | Busy entire day |
| Transparent event (`TRANSP:TRANSPARENT`) | Free (e.g. "out of office" set to free) |
| Cancelled (`STATUS:CANCELLED`) | Free |
| Declined by user (`PARTSTAT=DECLINED` for the user's email) | Free (best-effort; ICS may omit `PARTSTAT`) |
| Recurring (`RRULE`) | Each instance evaluated; `EXDATE` exclusions honoured |

**Outputs**
- View toggle: **List** (default) and **Calendar grid**.
- **List**: chronological, e.g. "Mon May 5, 14:00–15:00", "Tue May 6, 10:00–11:00", grouped by day. Pagination at 25 results per page.
- **Calendar grid**: weekly view with green stripes on free windows; hover to see start/end. Navigate week by week.
- "Copy slot" — copy a human-readable string to clipboard (e.g. `Mon May 5, 14:00–15:00 CET`).
- Empty state: if no slots in the window, display the closest 3 *flexible* matches (e.g. "Closest match: 4 of 5 free at Mon 14:00 — [Name] busy") to guide the user. *Marked future scope, but consider for MVP if cheap.*

**Saved Searches**
- User can save a search with a name (e.g. "Devs weekly", "Leadership 1h").
- Saved search stores: team, member list, duration, buffer, default window.
- Pinned to sidebar for one-click re-run.
- Recent searches: last 10 are auto-saved and accessible from a dropdown.
- Saved searches are **per-user, private** (not shared with team) in MVP.

### 5.5 Member Profile

**Own profile (settings)**
- First name, last name (editable).
- Email (login identity; change requires re-verification).
- Phone number (optional, free-text, no validation in MVP).
- Avatar (uploaded image, max 2MB; fallback = initials on coloured background).
- Working hours (per day of week; each day can be marked unavailable).
- Connected calendars (list with selected sub-calendars and disconnect option).
- Notification preferences (see 5.6).
- Password change.
- Delete account (see 5.7).

**Viewing another user's profile**
- Available only when both users share at least one team. Otherwise the profile is not accessible.
- Visible info: first name, last name, avatar, phone (if set), email, working hours, "currently available / busy" status (based on their free/busy data and current time).
- An inline mini-search lets the viewer find the user's free windows for any duration without going through the full team search UI.

**Privacy**
- A user is never visible or searchable to non-team-members.
- Email and phone are visible to teammates by default (no per-field hiding in MVP).

### 5.6 Notifications

**Channels**
- **Email** — delivered via Azure Communication Services (or equivalent transactional provider).
- **In-app** — bell icon in the app header with an unread badge and a list of recent notifications. Click to mark read; auto-purge after 90 days.

**Events that trigger notifications**
| Event | Default |
|---|---|
| You received a team invitation | On |
| Your invitation was accepted | On |
| Your invitation was rejected | On |
| You were promoted to admin | On |
| You were demoted from admin | On |
| You were removed from a team | On |
| A team you belong to was deleted | On |
| A new member joined your team | On |
| A calendar connection failed (token expired, sync error >24h) | On |
| Email verification / password reset | Always on, not toggleable |

**User control**
- Each notification type has independent toggles for **email** and **in-app**.
- Defaults: all on except where noted.
- Settings page presents them as a matrix (rows = events, columns = email / in-app).

**No-op for MVP**
- Saved-search alerts.
- Daily/weekly digest emails.
- SMS / push.

### 5.7 Account Management

**Delete account**
- One-click in settings, requires password confirmation.
- Effects, applied immediately:
  - User is removed from all teams.
  - For each team where the user is the sole admin: that team is deleted (per 5.3 rules), members notified.
  - All subscribed calendar URLs are deleted; cached events from those URLs purged.
  - All saved searches, notifications, profile data deleted.
  - Email is freed up (a new account can register with the same email afterward).
- No grace period. No 30-day soft delete in MVP. (Consider future feature.)

**Data export**
- Not in MVP.

### 5.8 PWA

- Web app must include a Web App Manifest, icons (192/512), and a service worker enabling "Add to Home Screen" on iOS Safari and Android Chrome.
- Offline mode is not in scope; the service worker provides shell caching only.
- Push notifications via Web Push are not in MVP (iOS PWA push has limited support and complicates the build).

---

## 6. Functional Rules / Edge Cases

- **No timezone handling**: client uses browser-local timezone for display. Working hours are interpreted in browser-local TZ. The app **assumes all team members are in the same timezone**. Documented limitation for MVP.
- **Calendar event timezones**: ICS events carry their own `TZID`; the parser uses the bundled `VTIMEZONE` blocks (or IANA name) and normalizes to UTC for storage; display is in the user's browser TZ.
- **Sync delays**: each ICS URL is polled every 5 min (with jitter). Provider-side caching may add additional staleness (Google iCal feed in particular can lag minutes-to-hours behind real-time changes). UI shows "Last synced X min ago" per calendar and a global tooltip warning that data may be stale by ~5 min.
- **URL invalidation**: if the user regenerates a secret iCal URL at the provider, polling will start failing. After 24h of failure, an email + in-app notification prompts the user to update the URL in Slotly settings.
- **Floating times**: ICS events without an explicit timezone are treated as floating local time (interpreted in browser TZ), per RFC 5545.
- **Search cap**: maximum 100 results per search; if more exist, paginate. Search execution should complete in <2 s for 10 members and a 3-month window (cached events queried in-memory).
- **Concurrency**: changes to a team's roster mid-search don't invalidate the result; results are a snapshot.
- **Email deliverability**: from-address must be on a verified domain (e.g. `noreply@slotly.app`). SPF/DKIM/DMARC configured.

---

## 7. Non-Functional Requirements

### Performance
- p95 page load: <2 s on broadband.
- p95 availability search: <2 s for teams up to 25 members over 3-month window.
- Sync latency target: ICS polled every 5 min; user-visible staleness budget is ~5 min plus provider-side caching.

### Security & Privacy
- TLS 1.3 everywhere.
- ICS subscription URLs encrypted at rest (Azure Key Vault-backed envelope encryption); treated as secrets, never logged.
- Argon2 password hashing.
- Rate limiting on auth endpoints (5 attempts / 15 min per IP).
- CSRF protection (Django built-in).
- Content Security Policy headers.
- Audit log of admin actions (invites, removals, role changes) — internal, not user-facing in MVP.
- All compute and storage in EU region (Azure West Europe = Amsterdam).
- GDPR: data minimization (no analytics PII), right to delete (account deletion = full erase), DPA-ready posture.

### Availability
- Target uptime: 99.5% (allows ~3.6h/month downtime — appropriate for free tier).
- Daily automated DB backups, retained 14 days.

### Browser support
- Chrome, Edge, Firefox, Safari — last 2 major versions.
- Mobile: iOS Safari 16+, Chrome Android last 2.

### Accessibility
- WCAG 2.1 AA target. Keyboard navigation, screen-reader labels, sufficient contrast.

---

## 8. Technical Architecture

### Phase-1 production target: ≤ €20 / month on Azure

The user-funded budget for the first deployment (internal use, ~10 users)
is **€20 / month all-in**. The reference architecture below trades the
"big SaaS" defaults for cost-aware Azure primitives. The full Container
Apps + Cache for Redis stack remains the upgrade path once usage justifies
it.

| Component | Phase-1 (≤ €20/mo) | Phase-2 (scale-out) |
|---|---|---|
| Frontend | **Azure Static Web Apps Free** (Next.js, 100 GB bandwidth) — €0 | Container Apps |
| Backend API | **Azure Container Apps** (Consumption plan, scale-to-zero) — ~€0–5 with low traffic; the free monthly grant (180k vCPU-sec, 360k GiB-sec, 2M requests) covers it | Same, Dedicated plan |
| Background sync | **Azure Container Apps Job** triggered every 5 min (cron), runs `manage.py poll_calendars` — pay-per-execution, ~€0–2 | Celery worker + Beat as long-running services |
| Database | **Azure Database for PostgreSQL Flexible Server, B1ms (1 vCPU, 2 GiB) burstable** — €12–15 | Same tier, then GP_Standard_D2s |
| Cache + Broker | **Skip Redis.** Use Django DB cache; the scheduled Job replaces the Celery broker | Azure Cache for Redis Basic C0 |
| Email (transactional) | **Azure Communication Services Email**, pay-per-message ~$0.0008/email — ~€0–2 | Same |
| DNS + TLS | webglobe.cz keeps `slotly.team`; Static Web Apps + Container Apps issue managed certs | Same |
| **Total** | **~€15–22 / month** | scales linearly |

**Rationale for Phase-1 simplifications:**

- **Static Web Apps Free** handles SSR for our small page count and gives
  HTTPS + CDN out of the box.
- **Consumption Container Apps** are billed by vCPU-seconds + memory-seconds
  + requests. With a tiny user base the monthly free grant (180k vCPU-sec ≈
  50 hours of one vCPU) is plenty.
- **Container Apps Jobs** instead of a long-running Celery worker. A
  `manage.py poll_calendars` job runs every 5 min, syncs all enabled
  calendars in-process, exits. Same business outcome, no broker needed.
  Total wall time stays well under the free grant.
- **No Redis.** Caching falls back to Django's `DatabaseCache` backend; rate
  limits move to the same. Only mandatory loss is sub-second cache hits
  (negligible at this scale).
- **Postgres B1ms is the floor.** It's the single largest line item but
  unavoidable for a managed Postgres on Azure. Self-hosted Postgres in a
  Container App could be cheaper (~€5/mo for the storage + compute) at the
  cost of operational headache; we accept B1ms's price for managed backups
  + HA-readiness.

**Code changes required for Phase-1 (deferred to M14 deploy work):**

1. Add a `poll_calendars` management command that calls
   `apps.calendars.tasks.sync_all_due` synchronously.
2. Move Django cache + ratelimit storage from Redis to `db_cache`.
3. Document the Container Apps Jobs cron in `docker-compose.prod.yml` /
   Bicep / Terraform.
4. Wire ACS email backend in production settings.

### Recommended stack

**Frontend**
- **Next.js 15 (App Router)** with React 19 — server components for shell, client components for interactive parts (search UI, calendar grid).
- **TypeScript**.
- **Tailwind CSS** + **shadcn/ui** for design system.
- **TanStack Query** for API data fetching/caching.
- **Luxon** or `date-fns-tz` for date/time math.
- **next-pwa** plugin for manifest + service worker.
- Hosting: **Azure Static Web Apps** (Next.js SSR-compatible plan) or **Azure Container Apps** (Docker).

**Backend**
- **Django 5.x** with **Django REST Framework**.
- **django-allauth** for email/password auth + verification flows.
- **Celery** + **Celery Beat** + **Redis** for background jobs (ICS polling, email sending, slot precomputation).
- Calendar parsing:
  - `httpx` for HTTPS fetch with conditional GET (`If-Modified-Since` / `If-None-Match`).
  - `icalendar` (RFC 5545 parser) — used with a strict whitelist wrapper that drops everything except start/end/status/transp/recurrence fields.
  - `python-dateutil` for recurrence expansion.
- Hosting: **Azure Container Apps** (Django web + Celery worker + Celery beat as separate revisions, scaled independently).

**Database**
- **PostgreSQL 16** on **Azure Database for PostgreSQL Flexible Server**, single region (West Europe), zone-redundant HA optional post-launch.

**Cache / queue**
- **Azure Cache for Redis** (Standard tier, ~1 GB initially).

**Storage**
- **Azure Blob Storage** for avatars (private container, signed URLs).

**Secrets**
- **Azure Key Vault** for the data-encryption key (DEK) used to encrypt subscription URLs at the application layer, plus third-party API keys (email provider, Sentry).

**Email**
- **Azure Communication Services** (preferred — same vendor) or **Postmark** (better deliverability, fallback option).

**Region**
- **Azure West Europe** (Netherlands, Amsterdam) — EU/GDPR-aligned, low latency for CZ users.

**Observability**
- **Azure Application Insights** for APM and logs.
- **Sentry** for error tracking.

### High-level diagram

```
Browser (PWA) ── HTTPS ──▶ Next.js (Azure Container Apps)
                              │
                              │ REST/JSON
                              ▼
                          Django + DRF (Azure Container Apps)
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
       Postgres          Redis           Celery worker
      (users, teams,    (cache, queue,        +  Celery beat
       calendars,        rate-limit)      (5-min ICS polls,
       parsed events)                      email, slot precomp)
                                                  │
                                                  │ HTTPS GET (.ics)
                                                  ▼
                                  Google iCal feeds / iCloud webcal /
                                   Outlook published feeds / generic ICS
```

### Sync flow (ICS subscription)
1. User adds a calendar URL → Django validates (HTTP 200 + parses as ICS) → URL is encrypted and persisted; a `Calendar` row is created.
2. **Celery Beat** schedules a per-calendar poll every 5 min (with up to 30s jitter to spread load). It also runs a nightly full-refresh job per calendar to defeat upstream caches.
3. **Celery worker** picks up the job, sends a conditional GET (`If-Modified-Since` / `If-None-Match`), and on `200` parses the ICS, expands recurrences, and upserts events into Postgres. On `304` it just bumps `last_synced_at`.
4. Failed polls trigger a backoff and, after 24h of continuous failure, a notification to the user to re-paste the URL.
5. UI reflects changes on the next slot search (no real-time socket push to the browser in MVP).

---

## 9. Risks & Open Questions

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Onboarding friction: users must dig into provider settings to copy an iCal URL (vs. one-click OAuth) | Lower activation rate | Clear provider-specific in-app guides with screenshots; v1.1 OAuth path |
| R2 | ~~OAuth webhook renewal stale data~~ N/A — no webhooks in MVP | — | — |
| R3 | ~~Google verification for OAuth scopes~~ N/A — no OAuth in MVP | — | — |
| R4 | Team size scales to 100+ members and search becomes slow | Poor UX, complaints | Precompute per-user busy bitmap; bitmap AND across selected members for O(n × time-slots) |
| R5 | Free tier abuse (spam invites) | Reputation, deliverability | Rate-limit invites per user (e.g. 50/day); CAPTCHA on registration |
| R6 | Single-TZ assumption breaks for distributed teams | Wrong slot results across TZ | Document clearly; add per-team TZ setting in v1.1 |
| R7 | Trademark sensitivity around provider names ("Apple", "Microsoft", "Google") and logos | TM dispute | Use plain text labels, follow each provider's branding guidelines, no logos until reviewed |
| R8 | Many corporate Microsoft 365 tenants disable calendar publishing by admin policy | Corporate users cannot connect MS calendars in v1.0 | Detect & explain in-UI ("Your tenant does not allow publishing — wait for OAuth in v1.1 or use a personal Outlook.com account"); prioritise OAuth path in v1.1 |
| R9 | Stale ICS data window (5–15 min, plus provider-side caching) leads to scheduling conflicts on freshly-added events | Embarrassing scheduling collisions | Show "Last synced X min ago" + global staleness warning; offer "Sync now" manual trigger with rate limit; emphasise OAuth in v1.1 messaging |
| R10 | User regenerates their secret iCal URL at the provider, breaking sync without warning | Silent staleness or empty data | Detect 4xx responses; after 3 failures show "Sync failing" badge; after 24h send notification to re-paste URL |
| R11 | Privacy bug: a parser regression could leak event titles/descriptions to the DB despite free/busy promise | Reputation, GDPR | Field whitelist in parser; unit tests on real-world ICS fixtures; nightly job scans event rows for non-empty disallowed columns |

### Open questions
- **Q1.** Final app name and domain. Slotly is a placeholder.
- **Q2.** Should the calendar grid view be the default for power users, or is the list always default?
- **Q3.** Should we ship the "closest non-strict match" UX in MVP, or hold for v1.1? It significantly improves empty-state UX.
- **Q4.** Visual / brand direction (logo, palette, tone). Suggest a brief design sprint after PRD sign-off.
- **Q5.** Soft-delete grace period for accounts (currently: hard delete) — revisit after first user feedback.

---

## 10. Future Roadmap (Post-MVP, indicative)

**v1.1 (3–6 months after launch)**
- Per-calendar privacy configuration (titles vs busy-only).
- Multi-timezone team support.
- Saved-search alerts ("notify me when 3+ of these people have a 1-hour overlap").
- One-click meeting creation (write event to all attendees' calendars, send invites).
- Calendar grid as default view option.
- "Closest non-strict match" suggestions on empty results.

**v1.2+**
- SSO with Google/Microsoft for sign-in (not just calendar connection).
- Native mobile apps (iOS / Android) with push.
- Integrations: Slack ("/slotly when can A, B, C meet for 1h?"), Microsoft Teams.
- Public booking links (Calendly-style) — opens new market.
- Paid tier (larger teams, history, priority sync, integrations).
- Data export (GDPR portability).
- Audit log UI for team admins.

---

## Appendix A — Glossary

- **Slot**: a contiguous time window during which all selected members are free.
- **Working hours**: the per-user, per-weekday windows when the user considers themselves available for meetings.
- **Free/busy**: a privacy-respecting representation of a calendar that exposes only whether a user is busy at a given time, with no event details.
- **Buffer**: padding added before and after existing events to prevent back-to-back meetings.
- **Strict match**: a slot is returned only if 100% of selected members are free.

## Appendix B — Open name shortlist

- **Slotly** — short, friendly, slot-focused. Domains: `slotly.app`, `slotly.io`, `slotly.team`.
- **Whenly** — conversational, "when can we meet". Domains: `whenly.app`, `whenly.io`.
- **Convene** — premium/B2B flavour, "to gather together". Domains: `convene.team` (likely available variants).
- **Overlap** — descriptive of the core feature. Often taken as a brand; needs availability check.
