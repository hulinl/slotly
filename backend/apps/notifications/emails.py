"""
HTML email helpers. Every branded transactional mail goes through
``html_shell`` — the outer layout stays consistent so mails feel like they
come from the same product, and callers only supply title + inner body
HTML + optional CTA.

Design constraints for email HTML (not web HTML):
- Inline CSS only. Gmail/Outlook strip <style> blocks.
- Tables for layout. Div-based flex/grid render inconsistently in Outlook.
- Web-safe fallback fonts.
- No JS, no external CSS, no @font-face.
- Absolute URLs everywhere (mail clients don't know the base URL).
"""

from __future__ import annotations

from html import escape

from django.conf import settings


def _frontend_base() -> str:
    return getattr(settings, "FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")


def html_shell(
    *,
    title: str,
    intro_html: str,
    cta_label: str = "",
    cta_url: str = "",
    footer_note: str = "",
) -> str:
    """Wrap ``intro_html`` in the shared Slotly email layout.

    ``intro_html`` is inserted verbatim — caller is responsible for escaping
    any user-supplied strings (use ``html.escape`` or ``kv_row`` for
    structured pairs).
    """
    cta_block = (
        f'''
        <tr>
          <td style="padding:0 24px 24px 24px;">
            <a href="{escape(cta_url)}"
               style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;
                      padding:11px 22px;border-radius:8px;font-weight:600;font-size:14px;
                      font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
              {escape(cta_label)}
            </a>
          </td>
        </tr>
        '''
        if cta_label and cta_url
        else ""
    )
    footer_extra = (
        f'<div style="margin-top:6px;">{escape(footer_note)}</div>' if footer_note else ""
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{escape(title)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#f4f4f5;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
             color:#18181b;line-height:1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;
                      overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
          <tr>
            <td style="background:#4f46e5;padding:14px 24px;">
              <div style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:.02em;">
                Slotly
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 24px 8px 24px;">
              <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;color:#18181b;">
                {escape(title)}
              </h1>
              <div style="font-size:15px;color:#3f3f46;">
                {intro_html}
              </div>
            </td>
          </tr>
          {cta_block}
          <tr>
            <td style="border-top:1px solid #f4f4f5;padding:14px 24px;
                       font-size:12px;color:#71717a;">
              Sent by Slotly ·
              <a href="{_frontend_base()}" style="color:#4f46e5;text-decoration:none;">
                slotly.team
              </a>
              {footer_extra}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def kv_rows(pairs: list[tuple[str, str]]) -> str:
    """Render a list of (label, value) pairs as a small definition-list
    table. Escapes both label and value."""
    rows = []
    for label, value in pairs:
        if not value:
            continue
        rows.append(
            f"""
            <tr>
              <td style="padding:4px 0;color:#71717a;font-size:12px;
                         text-transform:uppercase;letter-spacing:.04em;font-weight:600;
                         width:80px;vertical-align:top;">{escape(label)}</td>
              <td style="padding:4px 0;color:#18181b;font-size:14px;
                         vertical-align:top;">{escape(value)}</td>
            </tr>
            """
        )
    if not rows:
        return ""
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="margin-top:8px;">'
        + "".join(rows)
        + "</table>"
    )


def paragraph(text: str, *, muted: bool = False) -> str:
    """A simple <p> with our styling. Text is escaped."""
    color = "#71717a" if muted else "#3f3f46"
    return f'<p style="margin:0 0 12px 0;color:{color};">{escape(text)}</p>'


def blockquote(text: str) -> str:
    """A quoted note (host's rejection reason, visitor's note to host)."""
    return (
        '<div style="margin:12px 0;padding:10px 14px;border-left:3px solid #e4e4e7;'
        'background:#fafafa;color:#52525b;font-style:italic;white-space:pre-wrap;">'
        f"{escape(text)}"
        "</div>"
    )
