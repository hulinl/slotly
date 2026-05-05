"""
Browser-level smoke for Slotly. Loads every page in headless Chromium and
asserts no pageerror events fire and no `console.error` lands in the
console — which is what catches React hydration mismatches and DOM
nesting violations (e.g. block elements inside <p>).

The HTTP-level suite at scripts/e2e.py covers the API contract; this
script complements it by verifying that the rendered UI doesn't blow up.

Run:
    cd backend && .venv/bin/python ../scripts/smoke_browser.py

Prerequisites:
    .venv/bin/pip install playwright
    .venv/bin/playwright install chromium
"""

from __future__ import annotations

import os
import sys
from typing import NamedTuple

import httpx
from playwright.sync_api import ConsoleMessage, Page, sync_playwright

BASE = "http://localhost:3000"
SUPERUSER_EMAIL = os.environ.get("SLOTLY_E2E_USER", "hulin@bifactory.cz")
SUPERUSER_PASSWORD = os.environ.get("SLOTLY_E2E_PASSWORD", "DevAdmin12345")

# Pages anyone can hit.
GUEST_PAGES = [
    "/",
    "/auth/login",
    "/auth/register",
    "/auth/forgot",
    # /auth/verify and /auth/reset accept any path segment, render an
    # error UI when the token is invalid — that's a fine smoke target.
    "/auth/verify/dummy",
    "/auth/reset/dummy",
]

# Pages that require an authenticated session.
AUTHED_PAGES = [
    "/",
    "/search",
    "/people",
    "/notifications",
    "/settings",
    "/settings/calendars",
    "/settings/teams",
    "/settings/notifications",
    "/settings/account",
]


class Result(NamedTuple):
    path: str
    errors: list[str]


# Console messages we deliberately ignore (Next.js HMR, React devtools tip,
# Service-worker registration noise in dev — none of which signal product bugs).
_NOISE_PATTERNS = (
    "Download the React DevTools",
    "[HMR]",
    "[Fast Refresh]",
    "[next-",
    "service worker",
    "Service Worker",
    # Non-passive scroll listener warnings come from dev tooling.
    "non-passive event listener",
    # The app intentionally probes /api/me on guest pages (to detect
    # already-signed-in users); 4xx/network failures are app-handled.
    "Failed to load resource",
)


def _is_noise(text: str) -> bool:
    return any(pat in text for pat in _NOISE_PATTERNS)


def _login_via_api() -> dict[str, str]:
    """Authenticate via the backend and return the cookies the browser will reuse."""
    with httpx.Client(base_url=BASE, follow_redirects=False, timeout=10.0) as c:
        c.headers.update({"Origin": BASE, "Referer": f"{BASE}/"})
        c.get("/_allauth/browser/v1/config")
        csrf = c.cookies.get("csrftoken", "")
        r = c.post(
            "/_allauth/browser/v1/auth/login",
            json={"email": SUPERUSER_EMAIL, "password": SUPERUSER_PASSWORD},
            headers={"X-CSRFToken": csrf, "Content-Type": "application/json"},
        )
        if r.json().get("meta", {}).get("is_authenticated") is not True:
            raise RuntimeError(f"Could not log in as {SUPERUSER_EMAIL!r} — got {r.status_code} {r.text[:200]}")
        return {k: v for k, v in c.cookies.items()}


def _check_page(page: Page, path: str) -> Result:
    errors: list[str] = []

    def on_pageerror(exc: Exception) -> None:
        errors.append(f"pageerror: {exc}")

    def on_console(msg: ConsoleMessage) -> None:
        if msg.type != "error":
            return
        text = msg.text
        if _is_noise(text):
            return
        errors.append(f"console.error: {text}")

    page.on("pageerror", on_pageerror)
    page.on("console", on_console)

    page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
    # Give React time to hydrate; networkidle ensures any client-side fetch
    # has either resolved or stabilized.
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass

    return Result(path=path, errors=errors)


def main() -> int:
    print(f"Slotly UI smoke — base {BASE}\n")

    try:
        cookies = _login_via_api()
    except Exception as exc:
        print(f"\033[31mLogin failed: {exc}\033[0m")
        print("(Check Docker, runserver, Next.js dev server, and superuser credentials.)")
        return 2

    failures = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            # Guest pass: anonymous context.
            print("Guest pages (anonymous):")
            ctx = browser.new_context()
            for path in GUEST_PAGES:
                page = ctx.new_page()
                result = _check_page(page, path)
                page.close()
                if result.errors:
                    failures += 1
                    print(f"  \033[31m✗\033[0m {path}")
                    for e in result.errors:
                        print(f"      {e}")
                else:
                    print(f"  \033[32m✓\033[0m {path}")
            ctx.close()

            # Authed pass: context pre-loaded with cookies from the API login.
            print("\nAuthed pages:")
            ctx = browser.new_context()
            ctx.add_cookies([
                {
                    "name": k,
                    "value": v,
                    "domain": "localhost",
                    "path": "/",
                    "httpOnly": False,
                    "secure": False,
                    "sameSite": "Lax",
                }
                for k, v in cookies.items()
            ])
            for path in AUTHED_PAGES:
                page = ctx.new_page()
                result = _check_page(page, path)
                page.close()
                if result.errors:
                    failures += 1
                    print(f"  \033[31m✗\033[0m {path}")
                    for e in result.errors:
                        print(f"      {e}")
                else:
                    print(f"  \033[32m✓\033[0m {path}")
            ctx.close()
        finally:
            browser.close()

    total = len(GUEST_PAGES) + len(AUTHED_PAGES)
    if failures:
        print(f"\n\033[31m{failures}/{total} pages had errors.\033[0m")
        return 1
    print(f"\n\033[32mAll {total} pages clean.\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
