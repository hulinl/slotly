"""
Django email backend backed by Azure Communication Services Email REST SDK.

ACS does *not* offer SMTP. Instead, an authenticated REST call sends the
message; the SDK handles polling for completion. This backend wraps the
SDK so existing send_mail / EmailMessage call sites work unchanged.

Configuration:
    EMAIL_BACKEND = "apps.notifications.acs_email_backend.AzureCommunicationEmailBackend"
    AZURE_COMMUNICATION_CONNECTION_STRING = "endpoint=https://...;accesskey=..."
    DEFAULT_FROM_EMAIL = "DoNotReply@<azure-managed-subdomain>.azurecomm.net"
"""

from __future__ import annotations

import logging
from typing import Any

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend
from django.core.mail.message import EmailMessage

logger = logging.getLogger(__name__)


class AzureCommunicationEmailBackend(BaseEmailBackend):
    def __init__(self, fail_silently: bool = False, **kwargs: Any) -> None:
        super().__init__(fail_silently=fail_silently)
        self._client = None

    def _ensure_client(self):
        if self._client is not None:
            return self._client
        try:
            from azure.communication.email import EmailClient
        except ImportError as exc:  # pragma: no cover — should be in requirements
            if not self.fail_silently:
                raise
            logger.error("azure-communication-email not installed: %s", exc)
            return None
        conn = getattr(settings, "AZURE_COMMUNICATION_CONNECTION_STRING", "")
        if not conn:
            if not self.fail_silently:
                raise RuntimeError("AZURE_COMMUNICATION_CONNECTION_STRING is empty")
            return None
        self._client = EmailClient.from_connection_string(conn)
        return self._client

    def send_messages(self, email_messages: list[EmailMessage]) -> int:
        client = self._ensure_client()
        if client is None:
            return 0
        sent = 0
        for msg in email_messages:
            try:
                payload = {
                    "senderAddress": msg.from_email,
                    "recipients": {"to": [{"address": addr} for addr in msg.to]},
                    "content": {
                        "subject": msg.subject,
                        "plainText": msg.body,
                    },
                }
                # Detect HTML alternatives the same way the SMTP backend would.
                for alt_body, mime in getattr(msg, "alternatives", []):
                    if mime == "text/html":
                        payload["content"]["html"] = alt_body
                        break
                poller = client.begin_send(payload)
                # Wait synchronously — keeps the call site's expectation that
                # send_messages returns a count of accepted messages.
                poller.result()
                sent += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("ACS email send failed: %s", exc)
                if not self.fail_silently:
                    raise
        return sent
