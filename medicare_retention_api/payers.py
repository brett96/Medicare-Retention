"""
Multi-payer SMART on FHIR configuration loaded from environment variables.

Uses the same `_env` pattern as `settings.py` (values from `.env` / Vercel env).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
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
    """If True, use GET {fhir_base}/Patient?_id=... instead of Patient/{id}."""
    patient_lookup_mode: PatientLookupMode


DEFAULT_SCOPE = "launch/patient patient/*.read openid fhirUser"


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
    )


def _cigna_payer() -> PayerConfig:
    return PayerConfig(
        payer_id="cigna",
        client_id=_require_env("CIGNA_CLIENT_ID"),
        client_secret=_env("CIGNA_CLIENT_SECRET"),
        redirect_uri=_require_env("CIGNA_REDIRECT_URI"),
        auth_url=_require_env("CIGNA_AUTH_URL"),
        token_url=_require_env("CIGNA_TOKEN_URL"),
        fhir_base_url=_require_env("CIGNA_FHIR_BASE_URL"),
        scope=_env("CIGNA_SCOPE", DEFAULT_SCOPE) or DEFAULT_SCOPE,
        requires_userinfo=True,
        userinfo_url=_require_env("CIGNA_USERINFO_URL"),
        patient_lookup_mode="id_search",
    )


_BUILDERS = {
    "elevance": _elevance_payer,
    "cigna": _cigna_payer,
}


def list_registered_payer_ids() -> list[str]:
    return sorted(_BUILDERS.keys())


def get_payer_config(payer_id: str) -> PayerConfig:
    key = (payer_id or "").strip().lower()
    if key not in _BUILDERS:
        raise KeyError(f"Unknown payer_id: {payer_id!r}")
    return _BUILDERS[key]()
