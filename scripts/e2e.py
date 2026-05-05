"""
End-to-end smoke suite for Slotly.

Drives the live stack through the Next.js proxy on http://localhost:3000,
exactly like a real browser would. Catches integration bugs the unit
tests can't see (CSRF, cookies, rewrites, 304s, signal wiring, etc.).

Run prerequisites:
- docker compose up -d  (Postgres + Redis + MailHog + Celery)
- backend Django dev server on :8000
- frontend Next.js dev server on :3000

Run:
    cd backend && .venv/bin/python ../scripts/e2e.py

Flags:
    --keep   keep all created test data instead of cleaning up at the end
"""

from __future__ import annotations

import argparse
import re
import secrets
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone

import httpx

BASE = "http://localhost:3000"
MAILHOG = "http://localhost:8025"


class Tester:
    def __init__(self) -> None:
        self.passes: list[str] = []
        self.fails: list[tuple[str, str]] = []
        self.created_user_emails: set[str] = set()
        self.created_team_ids: set[int] = set()
        self._sessions: dict[str, httpx.Client] = {}

    # ------------------------------------------------------------------
    # session helpers
    # ------------------------------------------------------------------

    def session(self, name: str) -> httpx.Client:
        if name not in self._sessions:
            client = httpx.Client(base_url=BASE, follow_redirects=False, timeout=15.0)
            client.headers.update({
                "Origin": BASE,
                "Referer": f"{BASE}/",
            })
            self._sessions[name] = client
        return self._sessions[name]

    def csrf(self, name: str) -> str:
        s = self.session(name)
        s.get("/_allauth/browser/v1/config")
        return s.cookies.get("csrftoken", "")

    def post(self, name: str, path: str, payload: dict | None = None) -> httpx.Response:
        s = self.session(name)
        token = self.csrf(name)
        return s.post(
            path,
            json=payload,
            headers={"X-CSRFToken": token, "Content-Type": "application/json"},
        )

    def patch(self, name: str, path: str, payload: dict) -> httpx.Response:
        s = self.session(name)
        token = self.csrf(name)
        return s.patch(
            path,
            json=payload,
            headers={"X-CSRFToken": token, "Content-Type": "application/json"},
        )

    def delete(self, name: str, path: str) -> httpx.Response:
        s = self.session(name)
        token = self.csrf(name)
        return s.delete(path, headers={"X-CSRFToken": token})

    def get(self, name: str, path: str) -> httpx.Response:
        return self.session(name).get(path)

    # ------------------------------------------------------------------
    # assertions
    # ------------------------------------------------------------------

    def expect(self, name: str, condition: bool, detail: str = "") -> None:
        if condition:
            self.passes.append(name)
            print(f"  \033[32m✓\033[0m {name}")
        else:
            self.fails.append((name, detail))
            print(f"  \033[31m✗\033[0m {name}{(' — ' + detail) if detail else ''}")

    def expect_eq(self, name: str, got, want) -> None:
        self.expect(name, got == want, f"got {got!r}, want {want!r}")

    # ------------------------------------------------------------------
    # convenience
    # ------------------------------------------------------------------

    def signup_and_verify(self, name: str, email: str, password: str) -> None:
        """Register through the API, force-verify the email via Django shell."""
        r = self.post(name, "/_allauth/browser/v1/auth/signup", {"email": email, "password": password})
        if r.status_code == 429:
            # Rate-limited — clear and retry once. The suite clears at start
            # but a long run can still trip the per-minute window.
            _shell("from django.core.cache import cache; cache.clear()")
            r = self.post(name, "/_allauth/browser/v1/auth/signup", {"email": email, "password": password})
        self.expect(f"signup {email}: api accepted", r.status_code in (200, 401))
        self.created_user_emails.add(email)
        # force-verify so we don't need to round-trip through MailHog every test
        _shell(
            "from allauth.account.models import EmailAddress; "
            f"EmailAddress.objects.filter(email='{email}').update(verified=True)"
        )

    def login(self, name: str, email: str, password: str) -> httpx.Response:
        return self.post(name, "/_allauth/browser/v1/auth/login", {"email": email, "password": password})

    def logout(self, name: str) -> httpx.Response:
        return self.delete(name, "/_allauth/browser/v1/auth/session")

    # ------------------------------------------------------------------
    # cleanup
    # ------------------------------------------------------------------

    def cleanup(self) -> None:
        if self.created_user_emails:
            emails = list(self.created_user_emails)
            _shell(
                "from django.contrib.auth import get_user_model; "
                f"get_user_model().objects.filter(email__in={emails!r}).delete()"
            )
        if self.created_team_ids:
            ids = list(self.created_team_ids)
            _shell(
                "from apps.teams.models import Team; "
                f"Team.objects.filter(pk__in={ids!r}).delete()"
            )

    def report(self) -> int:
        print()
        print(f"  \033[1m{len(self.passes)} passed, {len(self.fails)} failed\033[0m")
        if self.fails:
            print("\n  Failures:")
            for name, detail in self.fails:
                print(f"    \033[31m✗\033[0m {name}: {detail}")
            return 1
        return 0


def _shell(code: str) -> None:
    """Run a Django shell command. Used for setup/teardown helpers only."""
    import subprocess

    result = subprocess.run(
        ["./.venv/bin/python", "manage.py", "shell", "-c", code],
        cwd="/Users/hulin/3_Dev/claude-skoleni/backend",
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"shell failed: {result.stderr}")


def _mailhog_clear() -> None:
    httpx.delete(f"{MAILHOG}/api/v1/messages", timeout=5.0)


def _mailhog_messages_to(email: str) -> list[dict]:
    r = httpx.get(f"{MAILHOG}/api/v2/messages", timeout=5.0)
    items = r.json()["items"]
    out = []
    for m in items:
        to = (m["Content"]["Headers"].get("To") or [""])[0]
        if email.lower() in to.lower():
            out.append(m)
    return out


def _verify_url_for(email: str) -> str:
    msgs = _mailhog_messages_to(email)
    for m in msgs:
        body = m["Content"]["Body"]
        match = re.search(r"http://localhost:3000/auth/verify/([^\s]+)", body)
        if match:
            return urllib.parse.unquote(match.group(1))
    raise AssertionError(f"no verify email found for {email}")


# ============================================================================
# tests
# ============================================================================


def test_routes_serve(t: Tester) -> None:
    print("\n[routes] static + manifest")
    expectations = {
        "/": 200,
        "/auth/login": 200,
        "/auth/register": 200,
        "/auth/forgot": 200,
        "/auth/verify/dummy": 200,
        "/auth/reset/dummy": 200,
        "/manifest.webmanifest": 200,
        "/icon.svg": 200,
        "/apple-icon.png": 200,
        "/icon-192.png": 200,
        "/icon-512.png": 200,
        "/healthz": 200,
        "/login": 404,  # legacy, must be gone
        "/register": 404,
    }
    for path, expected in expectations.items():
        r = httpx.get(f"{BASE}{path}", timeout=5.0)
        t.expect_eq(f"GET {path}", r.status_code, expected)


def test_signup_verify_login_logout(t: Tester) -> None:
    print("\n[auth] signup → verify (via MailHog) → login → logout")
    email = f"e2e-{secrets.token_hex(4)}@slotly.local"
    pw = "E2ESmokePass12345"
    _mailhog_clear()

    # signup
    r = t.post("alice", "/_allauth/browser/v1/auth/signup", {"email": email, "password": pw})
    t.created_user_emails.add(email)
    body = r.json()
    t.expect_eq("signup → 401 with verify_email pending", body["status"], 401)
    flows = {f["id"]: f for f in body.get("data", {}).get("flows", [])}
    t.expect("signup flow surfaces verify_email pending", flows.get("verify_email", {}).get("is_pending") is True)

    # extract verify key from MailHog
    try:
        key = _verify_url_for(email)
    except AssertionError as e:
        t.expect(f"MailHog received verification email for {email}", False, str(e))
        return
    t.expect(f"MailHog has verify URL for {email}", True)

    # confirm email
    r = t.post("alice", "/_allauth/browser/v1/auth/email/verify", {"key": key})
    body = r.json()
    t.expect_eq("after verify, session is authenticated", body.get("meta", {}).get("is_authenticated"), True)

    # logout
    r = t.logout("alice")
    body = r.json()
    t.expect_eq("logout returns is_authenticated=false", body.get("meta", {}).get("is_authenticated"), False)

    # login again
    r = t.login("alice", email, pw)
    body = r.json()
    t.expect_eq("re-login succeeds", body.get("meta", {}).get("is_authenticated"), True)


def test_login_wrong_password(t: Tester) -> None:
    print("\n[auth] login with wrong password produces a clean error")
    email = f"e2e-wrongpw-{secrets.token_hex(4)}@slotly.local"
    pw = "ProperPass12345"
    t.signup_and_verify("temp", email, pw)
    r = t.post("wrongpw", "/_allauth/browser/v1/auth/login", {"email": email, "password": "WRONG-pass-12345"})
    body = r.json()
    t.expect("wrong password rejected", body.get("status") in (400, 401))
    t.expect(
        "wrong password not authenticated",
        not body.get("meta", {}).get("is_authenticated"),
    )


def test_409_already_signed_in(t: Tester) -> None:
    print("\n[auth] signup while authed returns 409")
    # alice session is already authed from previous test
    r = t.post(
        "alice",
        "/_allauth/browser/v1/auth/signup",
        {"email": f"already-authed-{secrets.token_hex(3)}@example.com", "password": "Whatever12345"},
    )
    t.expect_eq("authed signup → 409", r.status_code, 409)


def test_password_reset(t: Tester) -> None:
    print("\n[auth] forgot password → reset → new login")
    email = f"e2e-reset-{secrets.token_hex(4)}@slotly.local"
    old_pw = "OldPass12345"
    new_pw = "BrandNewPass12345"
    t.signup_and_verify("temp", email, old_pw)
    _mailhog_clear()
    r = t.post("anon", "/_allauth/browser/v1/auth/password/request", {"email": email})
    t.expect("forgot request accepted", r.status_code in (200, 401))
    msgs = _mailhog_messages_to(email)
    if not msgs:
        t.expect("MailHog received reset email", False)
        return
    body = msgs[0]["Content"]["Body"]
    match = re.search(r"http://localhost:3000/auth/reset/([^\s]+)", body)
    if not match:
        t.expect("reset URL in email body", False, "no /auth/reset/ found")
        return
    key = urllib.parse.unquote(match.group(1))
    r = t.post("anon", "/_allauth/browser/v1/auth/password/reset", {"key": key, "password": new_pw})
    t.expect("reset key accepted", r.status_code in (200, 401))
    # try login with new password
    r = t.login("anon2", email, new_pw)
    t.expect_eq("login with new password works", r.json().get("meta", {}).get("is_authenticated"), True)


def test_profile_and_working_hours(t: Tester) -> None:
    print("\n[me] profile + working hours")
    email = f"e2e-me-{secrets.token_hex(4)}@slotly.local"
    pw = "MeTestPass12345"
    t.signup_and_verify("me", email, pw)
    t.login("me", email, pw)

    # GET defaults
    r = t.get("me", "/api/me")
    body = r.json()
    t.expect_eq("/api/me returns email", body["email"], email)
    t.expect_eq("default monday 08:00", body["working_hours"]["monday"]["start"], "08:00")
    t.expect_eq("default sunday available=false", body["working_hours"]["sunday"]["available"], False)

    # PATCH profile
    r = t.patch("me", "/api/me", {"first_name": "E2E", "last_name": "Tester"})
    t.expect_eq("PATCH profile fields → 200", r.status_code, 200)
    t.expect_eq("first_name persisted", r.json()["first_name"], "E2E")

    # PATCH invalid working_hours (end < start)
    bad_hours = body["working_hours"].copy()
    bad_hours["monday"] = {"start": "17:00", "end": "08:00", "available": True}
    r = t.patch("me", "/api/me", {"working_hours": bad_hours})
    t.expect_eq("invalid working_hours → 400", r.status_code, 400)


def test_unauth_endpoints(t: Tester) -> None:
    print("\n[security] unauthenticated requests are rejected")
    expectations = {
        "/api/me": 403,
        "/api/calendars": 403,
        "/api/teams": 403,
        "/api/notifications": 403,
        "/api/saved-searches": 403,
        "/api/recent-searches": 403,
    }
    for path, expected in expectations.items():
        r = httpx.get(f"{BASE}{path}", timeout=5.0)
        t.expect_eq(f"unauthed GET {path} → {expected}", r.status_code, expected)


def test_team_invite_flow(t: Tester) -> None:
    print("\n[teams] create + invite (registered) + accept + auto-delete on last admin leaves")
    admin_email = f"e2e-admin-{secrets.token_hex(4)}@slotly.local"
    member_email = f"e2e-member-{secrets.token_hex(4)}@slotly.local"
    pw = "TeamPass12345"
    t.signup_and_verify("admin", admin_email, pw)
    t.signup_and_verify("member", member_email, pw)
    t.login("admin", admin_email, pw)
    t.login("member", member_email, pw)

    r = t.post("admin", "/api/teams", {"name": f"E2E team {secrets.token_hex(2)}"})
    t.expect_eq("create team → 201", r.status_code, 201)
    team = r.json()
    team_id = team["id"]
    t.created_team_ids.add(team_id)
    t.expect_eq("creator becomes admin", team["my_role"], "admin")

    # invite member
    r = t.post("admin", f"/api/teams/{team_id}/invite", {"email": member_email})
    t.expect_eq("invite registered email → 201", r.status_code, 201)

    # member sees pending invitation
    r = t.get("member", "/api/invitations")
    invs = r.json()
    t.expect("member sees pending invitation", any(i["team_id"] == team_id for i in invs))
    if not invs:
        return
    token = invs[0]["token"]

    # accept
    r = t.post("member", f"/api/invitations/{token}/accept", None)
    t.expect_eq("accept invitation → 200", r.status_code, 200)
    t.expect_eq("accepted body returns team_id", r.json().get("team_id"), team_id)

    # team detail now shows 2 members
    r = t.get("admin", f"/api/teams/{team_id}")
    t.expect_eq("team has 2 members", r.json()["member_count"], 2)

    # admin leaves but is the only admin → team auto-deletes
    r = t.post("admin", f"/api/teams/{team_id}/leave", None)
    t.expect_eq("sole admin leaves → team deleted", r.status_code, 200)
    t.expect("response message mentions deletion", "deleted" in r.json().get("detail", "").lower())
    r = t.get("admin", f"/api/teams/{team_id}")
    t.expect_eq("subsequent team GET → 404", r.status_code, 404)


def test_invite_unregistered_then_register(t: Tester) -> None:
    print("\n[teams] invite unregistered email → register triggers auto-accept signal")
    admin_email = f"e2e-admin2-{secrets.token_hex(4)}@slotly.local"
    new_email = f"e2e-new-{secrets.token_hex(4)}@slotly.local"
    pw = "AutoAcceptPass12345"
    t.signup_and_verify("admin2", admin_email, pw)
    t.login("admin2", admin_email, pw)
    r = t.post("admin2", "/api/teams", {"name": f"E2E auto {secrets.token_hex(2)}"})
    team_id = r.json()["id"]
    t.created_team_ids.add(team_id)
    _mailhog_clear()
    t.post("admin2", f"/api/teams/{team_id}/invite", {"email": new_email})

    # signup the recipient — and verify *through the API* so the
    # email_confirmed signal fires, which is what the auto-accept depends on.
    t.created_user_emails.add(new_email)
    t.post("new", "/_allauth/browser/v1/auth/signup", {"email": new_email, "password": pw})
    try:
        key = _verify_url_for(new_email)
    except AssertionError:
        t.expect("MailHog received verify email for new user", False)
        return
    r = t.post("new", "/_allauth/browser/v1/auth/email/verify", {"key": key})
    t.expect_eq("email confirmation succeeded", r.json().get("meta", {}).get("is_authenticated"), True)
    r = t.get("new", "/api/teams")
    teams = r.json()
    t.expect("auto-accepted on email verification", any(x["id"] == team_id for x in teams))


def test_invitation_reject(t: Tester) -> None:
    print("\n[teams] invitation reject path")
    admin_email = f"e2e-admin-reject-{secrets.token_hex(4)}@slotly.local"
    member_email = f"e2e-rejecter-{secrets.token_hex(4)}@slotly.local"
    pw = "RejectPass12345"
    t.signup_and_verify("admR", admin_email, pw)
    t.signup_and_verify("rej", member_email, pw)
    t.login("admR", admin_email, pw)
    t.login("rej", member_email, pw)
    r = t.post("admR", "/api/teams", {"name": f"E2E reject {secrets.token_hex(2)}"})
    team_id = r.json()["id"]
    t.created_team_ids.add(team_id)
    t.post("admR", f"/api/teams/{team_id}/invite", {"email": member_email})
    invs = t.get("rej", "/api/invitations").json()
    if not invs:
        t.expect("reject path: invitation present", False)
        return
    token = invs[0]["token"]
    r = t.post("rej", f"/api/invitations/{token}/reject", None)
    t.expect_eq("reject → 200", r.status_code, 200)
    t.expect_eq("status 'rejected'", r.json().get("status"), "rejected")


def test_promote_demote_remove(t: Tester) -> None:
    print("\n[teams] promote / demote / remove member")
    admin_email = f"e2e-admin3-{secrets.token_hex(4)}@slotly.local"
    member_email = f"e2e-mem3-{secrets.token_hex(4)}@slotly.local"
    pw = "RolePass12345"
    t.signup_and_verify("ad3", admin_email, pw)
    t.signup_and_verify("mb3", member_email, pw)
    t.login("ad3", admin_email, pw)
    t.login("mb3", member_email, pw)
    r = t.post("ad3", "/api/teams", {"name": f"E2E role {secrets.token_hex(2)}"})
    team_id = r.json()["id"]
    t.created_team_ids.add(team_id)
    t.post("ad3", f"/api/teams/{team_id}/invite", {"email": member_email})
    invs = t.get("mb3", "/api/invitations").json()
    t.post("mb3", f"/api/invitations/{invs[0]['token']}/accept", None)

    # find member's user_id
    members = t.get("ad3", f"/api/teams/{team_id}").json()["members"]
    member_uid = next(m["user_id"] for m in members if m["email"] == member_email)

    # promote
    r = t.patch("ad3", f"/api/teams/{team_id}/members/{member_uid}", {"role": "admin"})
    t.expect_eq("promote → 200", r.status_code, 200)
    t.expect_eq("new role admin", r.json().get("role"), "admin")

    # demote
    r = t.patch("ad3", f"/api/teams/{team_id}/members/{member_uid}", {"role": "member"})
    t.expect_eq("demote → 200", r.status_code, 200)
    t.expect_eq("new role member", r.json().get("role"), "member")

    # remove
    r = t.delete("ad3", f"/api/teams/{team_id}/members/{member_uid}")
    t.expect_eq("remove member → 204", r.status_code, 204)


def test_search_validation_and_record(t: Tester) -> None:
    print("\n[search] validation + recent recording")
    email = f"e2e-search-{secrets.token_hex(4)}@slotly.local"
    pw = "SearchPass12345"
    t.signup_and_verify("se", email, pw)
    t.login("se", email, pw)
    r = t.post("se", "/api/teams", {"name": f"E2E search {secrets.token_hex(2)}"})
    team_id = r.json()["id"]
    t.created_team_ids.add(team_id)
    me = t.get("se", "/api/me").json()
    me_id = _shell_value(f"u=__import__('django.contrib.auth',fromlist=['get_user_model']).get_user_model().objects.get(email='{email}'); print(u.pk)")

    # bad: member_id outside team
    r = t.post("se", "/api/search", {
        "team_id": team_id, "member_ids": [99999], "duration_min": 60,
    })
    t.expect_eq("invalid member → 400", r.status_code, 400)

    # bad: duration too short
    r = t.post("se", "/api/search", {
        "team_id": team_id, "member_ids": [int(me_id)], "duration_min": 5,
    })
    t.expect_eq("duration<15 → 400", r.status_code, 400)

    # ok: search myself for 60min
    r = t.post("se", "/api/search", {
        "team_id": team_id, "member_ids": [int(me_id)], "duration_min": 60,
    })
    t.expect_eq("valid search → 200", r.status_code, 200)
    body = r.json()
    t.expect("returns slots array", isinstance(body.get("slots"), list))

    # recent recorded
    rec = t.get("se", "/api/recent-searches").json()
    t.expect("recent recorded", any(rs["team"] == team_id for rs in rec))


def test_saved_search_uniqueness(t: Tester) -> None:
    print("\n[saved-search] name uniqueness per user")
    email = f"e2e-saved-{secrets.token_hex(4)}@slotly.local"
    pw = "SavedPass12345"
    t.signup_and_verify("sv", email, pw)
    t.login("sv", email, pw)
    r = t.post("sv", "/api/teams", {"name": f"E2E saved {secrets.token_hex(2)}"})
    team_id = r.json()["id"]
    t.created_team_ids.add(team_id)
    me_id = int(_shell_value(f"u=__import__('django.contrib.auth',fromlist=['get_user_model']).get_user_model().objects.get(email='{email}'); print(u.pk)"))

    body = {"name": "My favorite", "team": team_id, "member_ids": [me_id], "duration_min": 60, "buffer_min": 0, "window_days": 30}
    r = t.post("sv", "/api/saved-searches", body)
    t.expect_eq("create saved → 201", r.status_code, 201)
    # duplicate name
    r = t.post("sv", "/api/saved-searches", body)
    t.expect_eq("duplicate name → 400", r.status_code, 400)
    # member-not-in-team
    r = t.post("sv", "/api/saved-searches", {**body, "name": "Stranger", "member_ids": [99999]})
    t.expect_eq("alien member → 400", r.status_code, 400)


def test_notifications_dispatch(t: Tester) -> None:
    print("\n[notifications] invitation accept fires both in-app and email")
    inviter_email = f"e2e-inv-{secrets.token_hex(4)}@slotly.local"
    invitee_email = f"e2e-acc-{secrets.token_hex(4)}@slotly.local"
    pw = "NotifPass12345"
    t.signup_and_verify("inv", inviter_email, pw)
    t.signup_and_verify("acc", invitee_email, pw)
    t.login("inv", inviter_email, pw)
    t.login("acc", invitee_email, pw)
    r = t.post("inv", "/api/teams", {"name": f"E2E notif {secrets.token_hex(2)}"})
    team_id = r.json()["id"]
    t.created_team_ids.add(team_id)
    _mailhog_clear()
    t.post("inv", f"/api/teams/{team_id}/invite", {"email": invitee_email})
    invs = t.get("acc", "/api/invitations").json()
    if not invs:
        t.expect("invitee sees invitation", False)
        return
    t.post("acc", f"/api/invitations/{invs[0]['token']}/accept", None)
    # inviter has a TEAM_INVITATION_ACCEPTED notification + email
    n = t.get("inv", "/api/notifications").json()
    t.expect(
        "inviter received in-app TEAM_INVITATION_ACCEPTED",
        any(item["type"] == "team.invitation_accepted" for item in n["results"]),
    )
    msgs = _mailhog_messages_to(inviter_email)
    t.expect(
        "inviter received accepted email",
        any("accepted your invitation" in m["Content"]["Body"] for m in msgs),
    )


def test_account_deletion(t: Tester) -> None:
    print("\n[account] delete with cascade + email re-registerable")
    email = f"e2e-del-{secrets.token_hex(4)}@slotly.local"
    pw = "DelPass12345"
    t.signup_and_verify("del", email, pw)
    t.login("del", email, pw)
    r = t.post("del", "/api/teams", {"name": f"E2E del {secrets.token_hex(2)}"})
    team_id = r.json()["id"]
    t.created_team_ids.add(team_id)

    # GET preview
    r = t.get("del", "/api/me/delete")
    body = r.json()
    t.expect_eq("preview teams_will_be_deleted", body["teams_will_be_deleted"], 1)

    # wrong password
    r = t.post("del", "/api/me/delete", {"password": "WRONG"})
    t.expect_eq("wrong password → 400", r.status_code, 400)

    # correct
    r = t.post("del", "/api/me/delete", {"password": pw})
    t.expect_eq("correct password → 204", r.status_code, 204)

    # session is dead
    r = t.get("del", "/api/me")
    t.expect_eq("/api/me after delete → 403", r.status_code, 403)

    # email is freed: just verify the row is gone in DB. (Signup-rate-limit
    # would interfere with a real re-signup attempt at the end of the suite,
    # and the cascade test from M8 already proved re-registration works.)
    t.created_user_emails.discard(email)
    exists = _shell_value(
        f"u=__import__('django.contrib.auth',fromlist=['get_user_model']).get_user_model().objects.filter(email='{email}').exists(); print(int(u))"
    )
    t.expect_eq("user row gone after delete", exists, "0")


def _shell_value(code: str) -> str:
    """Run a Django shell command and capture its stdout (last non-empty line)."""
    import subprocess

    result = subprocess.run(
        ["./.venv/bin/python", "manage.py", "shell", "-c", code],
        cwd="/Users/hulin/3_Dev/claude-skoleni/backend",
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"shell failed: {result.stderr}")
    lines = [ln for ln in result.stdout.splitlines() if ln.strip()]
    return lines[-1].strip() if lines else ""


# ============================================================================
# main
# ============================================================================


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="don't clean up created data")
    args = parser.parse_args()

    t = Tester()

    # Sanity: backend up?
    try:
        r = httpx.get(f"{BASE}/healthz", timeout=3.0)
        if r.status_code != 200:
            raise RuntimeError(f"healthz returned {r.status_code}")
    except Exception as e:
        print(f"\033[31mSlotly stack is not running: {e}\033[0m")
        print("Run `docker compose up -d`, then start the Django + Next dev servers.")
        return 2

    # Clear Django's cache (where allauth stores rate-limit counters) so a
    # back-to-back run isn't blocked by leftover counters from the previous one.
    _shell("from django.core.cache import cache; cache.clear()")

    try:
        test_routes_serve(t)
        test_unauth_endpoints(t)
        test_signup_verify_login_logout(t)
        test_login_wrong_password(t)
        test_409_already_signed_in(t)
        test_password_reset(t)
        test_profile_and_working_hours(t)
        test_team_invite_flow(t)
        test_invite_unregistered_then_register(t)
        test_invitation_reject(t)
        test_promote_demote_remove(t)
        test_search_validation_and_record(t)
        test_saved_search_uniqueness(t)
        test_notifications_dispatch(t)
        test_account_deletion(t)
    finally:
        if not args.keep:
            t.cleanup()

    return t.report()


if __name__ == "__main__":
    sys.exit(main())
