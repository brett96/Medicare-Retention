"""
Multi-payer SMART on FHIR configuration loaded from environment variables.

Uses the same `_env` pattern as `settings.py` (values from `.env` / Vercel env).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal, Optional

def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v.strip()


PatientLookupMode = Literal["path", "id_search"]


@dataclass(frozen=True)
class PayerConfig:
    payer_id: str
    client_id: str
    client_secret: str | None
    redirect_uri: str
    auth_url: str
    token_url: str
    fhir_base_url: str
    scope: str
    requires_userinfo: bool
    userinfo_url: str | None
    # If "id_search", use GET {fhir_base}/Patient?_id=... instead of Patient/{id}.
    patient_lookup_mode: PatientLookupMode
    # Normalized resource types (auth_views._normalize_fhir_resource_type); never proxied — empty Bundle returned.
    fhir_unsupported_resources: frozenset[str] = field(default_factory=frozenset)


DEFAULT_SCOPE = "launch/patient patient/*.read openid fhirUser"

# Elevance TotalView: MedicationStatement is not in the sandbox supported resource list (invalid_scope if called).
_ELEVANCE_FHIR_UNSUPPORTED = frozenset(
    {
        "medicationstatement",
    }
)

# Cigna Patient Access FHIR does not expose these resource types (OperationOutcome not-supported).
_CIGNA_FHIR_UNSUPPORTED = frozenset(
    {
        "medicationstatement",
        "medicationdispense",
        "claim",
        "claimresponse",
    }
)

# Cigna Patient Access — sandbox defaults when optional CIGNA_* URLs are unset.
# Override all of these for production or if Cigna updates their developer docs:
# https://developer.cigna.com/docs/service-apis/patient-access/sandbox
DEFAULT_CIGNA_AUTH_URL = "https://r-hi2.cigna.com/mga/sps/oauth/oauth20/authorize"
DEFAULT_CIGNA_TOKEN_URL = "https://r-hi2.cigna.com/mga/sps/oauth/oauth20/token"
DEFAULT_CIGNA_FHIR_BASE_URL = "https://p-hi2.digitaledge.cigna.com/ConsumerAccess/v1-devportal"
DEFAULT_CIGNA_USERINFO_URL = "https://r-hi2.cigna.com/mga/sps/oauth/oauth20/userinfo"


def _require_env(name: str) -> str:
    v = _env(name)
    if not v:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return v


def _elevance_payer() -> PayerConfig:
    return PayerConfig(
        payer_id="elevance",
        client_id=_require_env("ELEVANCE_CLIENT_ID"),
        client_secret=_env("ELEVANCE_CLIENT_SECRET"),
        redirect_uri=_require_env("ELEVANCE_REDIRECT_URI"),
        auth_url=_require_env("ELEVANCE_AUTH_URL"),
        token_url=_require_env("ELEVANCE_TOKEN_URL"),
        fhir_base_url=_require_env("ELEVANCE_FHIR_BASE_URL"),
        scope=_env("ELEVANCE_SCOPE", DEFAULT_SCOPE) or DEFAULT_SCOPE,
        requires_userinfo=False,
        userinfo_url=None,
        patient_lookup_mode="path",
        fhir_unsupported_resources=_ELEVANCE_FHIR_UNSUPPORTED,
    )


def _cigna_payer() -> PayerConfig:
    # Public PKCE client: CIGNA_CLIENT_SECRET is optional (omit when not issued at registration).
    return PayerConfig(
        payer_id="cigna",
        client_id=_require_env("CIGNA_CLIENT_ID"),
        client_secret=_env("CIGNA_CLIENT_SECRET"),
        redirect_uri=_require_env("CIGNA_REDIRECT_URI"),
        auth_url=_env("CIGNA_AUTH_URL", DEFAULT_CIGNA_AUTH_URL) or DEFAULT_CIGNA_AUTH_URL,
        token_url=_env("CIGNA_TOKEN_URL", DEFAULT_CIGNA_TOKEN_URL) or DEFAULT_CIGNA_TOKEN_URL,
        fhir_base_url=_env("CIGNA_FHIR_BASE_URL", DEFAULT_CIGNA_FHIR_BASE_URL) or DEFAULT_CIGNA_FHIR_BASE_URL,
        scope=_env("CIGNA_SCOPE", DEFAULT_SCOPE) or DEFAULT_SCOPE,
        requires_userinfo=True,
        userinfo_url=_env("CIGNA_USERINFO_URL", DEFAULT_CIGNA_USERINFO_URL) or DEFAULT_CIGNA_USERINFO_URL,
        patient_lookup_mode="id_search",
        fhir_unsupported_resources=_CIGNA_FHIR_UNSUPPORTED,
    )


_BUILDERS = {
    "elevance": _elevance_payer,
    "cigna": _cigna_payer,
}

# Human-readable labels for the /authorize picker (extend when adding payers).
PAYER_DISPLAY_NAMES: dict[str, str] = {
    "elevance": "Elevance",
    "cigna": "Cigna — Patient Access",
}


def list_registered_payer_ids() -> list[str]:
    return sorted(_BUILDERS.keys())


def list_configured_payers() -> list[tuple[str, str]]:
    """
    Payers whose env vars are complete enough for get_payer_config to succeed.

    Returns list of (payer_id, display_label) sorted by payer_id.
    """
    out: list[tuple[str, str]] = []
    for pid in list_registered_payer_ids():
        try:
            get_payer_config(pid)
        except (KeyError, RuntimeError):
            continue
        label = PAYER_DISPLAY_NAMES.get(pid, pid.replace("_", " ").title())
        out.append((pid, label))
    return out


def get_payer_config(payer_id: str) -> PayerConfig:
    key = (payer_id or "").strip().lower()
    if key not in _BUILDERS:
        raise KeyError(f"Unknown payer_id: {payer_id!r}")
    return _BUILDERS[key]()
