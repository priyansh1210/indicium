"""Email through an outbox.

`queue_email` writes a message on the caller's connection, so it commits (or not) with the change
that caused it. `send_pending` delivers queued messages; the review worker runs it in a thread.
Several senders can run: each claims rows with `for update skip locked`.

INDICIUM_SMTP_URL picks the transport: smtp://host:port (plain, a local catcher such as Mailpit),
smtp+starttls://user:password@host:587, or smtps://user:password@host:465. Empty: messages are
written to the log instead, which holds their links; that is for development only.
"""

import logging
import smtplib
import threading
from collections.abc import Callable
from email.message import EmailMessage
from urllib.parse import unquote, urlsplit

from psycopg import Connection

from indicium.config import settings

log = logging.getLogger("indicium.mail")
MAX_ATTEMPTS = 8
Transport = Callable[[EmailMessage], None]


def queue_email(conn: Connection, to: str, subject: str, body: str) -> None:
    conn.execute(
        "insert into app.outbox (to_email, subject, body) values (%s, %s, %s)", (to, subject, body)
    )


def link(path: str) -> str:
    """An absolute link to a page of the web app, for an email."""
    return settings().public_url.rstrip("/") + path


def transport_from_settings() -> Transport:
    url = settings().smtp_url.get_secret_value()
    if not url:
        return _log_transport
    parts = urlsplit(url)  # the scheme was checked when the settings were read

    def send(message: EmailMessage) -> None:
        kind = smtplib.SMTP_SSL if parts.scheme == "smtps" else smtplib.SMTP
        port = parts.port or (465 if parts.scheme == "smtps" else 25)
        with kind(parts.hostname or "localhost", port, timeout=10) as smtp:
            if parts.scheme == "smtp+starttls":
                smtp.starttls()
            if parts.username:
                smtp.login(unquote(parts.username), unquote(parts.password or ""))
            smtp.send_message(message)

    return send


def _log_transport(message: EmailMessage) -> None:
    log.info(
        "email not sent (no INDICIUM_SMTP_URL): to=%s subject=%s\n%s",
        message["To"],
        message["Subject"],
        message.get_content(),
    )


def send_pending(pool, transport: Transport, limit: int = 20) -> int:
    """Send up to `limit` due messages. Returns how many were sent."""
    sent = 0
    with pool.connection() as conn:
        rows = conn.execute(
            "select message_id, to_email, subject, body, attempts from app.outbox"
            " where sent_at is null and available_at <= now()"
            " order by message_id limit %s for update skip locked",
            (limit,),
        ).fetchall()
        for row in rows:
            message = EmailMessage()
            message["From"] = settings().mail_from
            message["To"] = row["to_email"]
            message["Subject"] = row["subject"]
            message.set_content(row["body"])
            try:
                transport(message)
            except Exception as error:
                attempts = row["attempts"] + 1
                log.warning("email %s failed (attempt %s): %s", row["message_id"], attempts, error)
                conn.execute(
                    "update app.outbox set attempts = %s, error = %s,"
                    " available_at = case when %s then 'infinity'"
                    "   else now() + make_interval(secs => %s) end"
                    " where message_id = %s",
                    (
                        attempts,
                        str(error)[:1000],
                        attempts >= MAX_ATTEMPTS,  # given up: kept for an operator to see
                        min(30 * 2**attempts, 3600),
                        row["message_id"],
                    ),
                )
                continue
            conn.execute(
                "update app.outbox set sent_at = now(), body = '', error = null"
                " where message_id = %s",
                (row["message_id"],),
            )
            sent += 1
    return sent


def run_sender(pool, stop: threading.Event, poll_seconds: float = 2.0) -> None:
    """Send queued email until stopped. Errors are logged and retried, never raised."""
    transport = transport_from_settings()
    while not stop.is_set():
        try:
            if send_pending(pool, transport):
                continue
        except Exception:
            log.exception("sending email failed; retrying shortly")
        stop.wait(poll_seconds)
