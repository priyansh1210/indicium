"""Time-based one-time codes (RFC 6238, the six digits an authenticator app shows)."""

import base64
import hmac
import secrets
import time
from urllib.parse import quote

STEP_SECONDS = 30


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode()


def code_at(secret: str, step: int, digits: int = 6) -> str:
    mac = hmac.new(base64.b32decode(secret), step.to_bytes(8, "big"), "sha1").digest()
    offset = mac[-1] & 0x0F
    value = int.from_bytes(mac[offset : offset + 4], "big") & 0x7FFFFFFF
    return str(value % 10**digits).zfill(digits)


def matching_step(secret: str, code: str, now: float | None = None) -> int | None:
    """The time step the code belongs to, allowing one step of clock drift either way."""
    code = code.strip().replace(" ", "")
    if not (len(code) == 6 and code.isdigit()):
        return None
    current = int((time.time() if now is None else now) // STEP_SECONDS)
    for step in (current - 1, current, current + 1):
        if hmac.compare_digest(code_at(secret, step), code):
            return step
    return None


def provisioning_uri(secret: str, email: str, issuer: str = "Indicium") -> str:
    """What the QR code holds: authenticator apps read the account and issuer from it."""
    return (
        f"otpauth://totp/{quote(issuer)}:{quote(email)}"
        f"?secret={secret}&issuer={quote(issuer)}&digits=6&period={STEP_SECONDS}"
    )
