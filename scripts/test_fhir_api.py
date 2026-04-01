"""
Multi-payer SMART on FHIR PKCE terminal tester.

Supports Elevance (token returns `patient`) and Cigna (`$userinfo` discovery).

Configuration is via environment variables (same keys as `medicare_retention_api/payers.py`).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
import textwrap
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

import requests

try:
    from dotenv import load_dotenv

    _PROJECT_ROOT = Path(__file__).resolve().parent.parent
    load_dotenv(_PROJECT_ROOT / ".env")
except ImportError:
    pass


DEFAULT_SCOPE = "launch/patient patient/*.read openid fhirUser"


def _http_timeout() -> Union[float, Tuple[float, float]]:
    legacy = os.environ.get("ELEVANCE_HTTP_TIMEOUT_S") or os.environ.get("FHIR_HTTP_TIMEOUT_S")
    if legacy and legacy.strip():
        return float(legacy.strip())
    connect = float(os.environ.get("FHIR_HTTP_CONNECT_TIMEOUT_S", os.environ.get("ELEVANCE_HTTP_CONNECT_TIMEOUT_S", "20")))
    read = float(os.environ.get("FHIR_HTTP_READ_TIMEOUT_S", os.environ.get("ELEVANCE_HTTP_READ_TIMEOUT_S", "90")))
    return (connect, read)


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v.strip()


class ConfigError(RuntimeError):
    pass


class OAuthFlowError(RuntimeError):
    pass


@dataclass(frozen=True)
class PayerTestConfig:
    payer_id: str
    client_id: str
    client_secret: Optional[str]
    redirect_uri: str
    auth_url: str
    token_url: str
    fhir_base_url: str
    scope: str
    requires_userinfo: bool
    userinfo_url: Optional[str]
    # SMART authorize `aud` when different from FHIR base (Aetna).
    oauth_audience: Optional[str] = None


def _require(name: str) -> str:
    v = _env(name)
    if not v:
        raise ConfigError(f"Missing required env var: {name}")
    return v


def load_elevance_config() -> PayerTestConfig:
    return PayerTestConfig(
        payer_id="elevance",
        client_id=_require("ELEVANCE_CLIENT_ID"),
        client_secret=_env("ELEVANCE_CLIENT_SECRET"),
        redirect_uri=_require("ELEVANCE_REDIRECT_URI"),
        auth_url=_require("ELEVANCE_AUTH_URL"),
        token_url=_require("ELEVANCE_TOKEN_URL"),
        fhir_base_url=_require("ELEVANCE_FHIR_BASE_URL"),
        scope=_env("ELEVANCE_SCOPE", DEFAULT_SCOPE) or DEFAULT_SCOPE,
        requires_userinfo=False,
        userinfo_url=None,
    )


def load_aetna_config() -> PayerTestConfig:
    default_auth = "https://vteapif1.aetna.com/fhirdemo/v1/fhirserver_auth/oauth2/authorize"
    default_token = "https://vteapif1.aetna.com/fhirdemo/v1/fhirserver_auth/oauth2/token"
    default_fhir = "https://vteapif1.aetna.com/fhirdemo/v2/patientaccess"
    default_aud = "https://vteapif1.aetna.com/fhirdemo"
    default_scope = "launch/patient patient/*.read"
    userinfo = _env("AETNA_USERINFO_URL")
    return PayerTestConfig(
        payer_id="aetna",
        client_id=_require("AETNA_CLIENT_ID"),
        client_secret=_require("AETNA_CLIENT_SECRET"),
        redirect_uri=_require("AETNA_REDIRECT_URI"),
        auth_url=_env("AETNA_AUTH_URL", default_auth) or default_auth,
        token_url=_env("AETNA_TOKEN_URL", default_token) or default_token,
        fhir_base_url=_env("AETNA_FHIR_BASE_URL", default_fhir) or default_fhir,
        scope=_env("AETNA_SCOPE", default_scope) or default_scope,
        requires_userinfo=bool(userinfo),
        userinfo_url=userinfo,
        oauth_audience=_env("AETNA_AUD", default_aud) or default_aud,
    )


def load_cigna_config() -> PayerTestConfig:
    # Match medicare_retention_api/payers.py sandbox defaults when URLs omitted.
    default_auth = "https://r-hi2.cigna.com/mga/sps/oauth/oauth20/authorize"
    default_token = "https://r-hi2.cigna.com/mga/sps/oauth/oauth20/token"
    default_fhir = "https://p-hi2.digitaledge.cigna.com/ConsumerAccess/v1-devportal"
    default_userinfo = "https://r-hi2.cigna.com/mga/sps/oauth/oauth20/userinfo"
    return PayerTestConfig(
        payer_id="cigna",
        client_id=_require("CIGNA_CLIENT_ID"),
        client_secret=_env("CIGNA_CLIENT_SECRET"),
        redirect_uri=_require("CIGNA_REDIRECT_URI"),
        auth_url=_env("CIGNA_AUTH_URL", default_auth) or default_auth,
        token_url=_env("CIGNA_TOKEN_URL", default_token) or default_token,
        fhir_base_url=_env("CIGNA_FHIR_BASE_URL", default_fhir) or default_fhir,
        scope=_env("CIGNA_SCOPE", DEFAULT_SCOPE) or DEFAULT_SCOPE,
        requires_userinfo=True,
        userinfo_url=_env("CIGNA_USERINFO_URL", default_userinfo) or default_userinfo,
    )


def generate_pkce_pair() -> Tuple[str, str]:
    verifier_bytes = os.urandom(32)
    code_verifier = base64.urlsafe_b64encode(verifier_bytes).rstrip(b"=").decode("utf-8")
    challenge_bytes = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    code_challenge = base64.urlsafe_b64encode(challenge_bytes).rstrip(b"=").decode("utf-8")
    return code_verifier, code_challenge


def build_authorize_url(cfg: PayerTestConfig, code_challenge: str, state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": cfg.client_id,
        "redirect_uri": cfg.redirect_uri,
        "scope": cfg.scope,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "aud": cfg.fhir_base_url,
    }
    return f"{cfg.auth_url}?{urllib.parse.urlencode(params)}"


def prompt_redirected_url() -> str:
    print(
        textwrap.dedent(
            """
            Paste the FULL redirected URL from the browser address bar.
            Example:
              https://your-redirect/callback?code=...&state=...
            """
        ).strip()
    )
    return input("\nRedirected URL: ").strip()


def extract_code_and_state(redirected_url: str) -> Tuple[str, Optional[str]]:
    parsed = urllib.parse.urlparse(redirected_url)
    query = urllib.parse.parse_qs(parsed.query)
    code = query.get("code", [None])[0]
    state = query.get("state", [None])[0]
    if not code:
        raise OAuthFlowError("Redirect URL did not contain a `code` query parameter.")
    return code, state


def _pretty(obj: Any) -> str:
    try:
        return json.dumps(obj, indent=2, sort_keys=True)
    except Exception:
        return repr(obj)


def exchange_code_for_token(
    cfg: PayerTestConfig,
    *,
    code: str,
    code_verifier: str,
    timeout: Union[float, Tuple[float, float]] | None = None,
    max_retries: int = 2,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg.redirect_uri,
        "client_id": cfg.client_id,
        "code_verifier": code_verifier,
    }
    if cfg.client_secret:
        payload["client_secret"] = cfg.client_secret

    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    timeout = timeout if timeout is not None else _http_timeout()

    for attempt in range(max_retries + 1):
        try:
            if cfg.client_secret:
                resp = requests.post(
                    cfg.token_url,
                    data=payload,
                    auth=requests.auth.HTTPBasicAuth(cfg.client_id, cfg.client_secret),
                    headers=headers,
                    timeout=timeout,
                )
            else:
                resp = requests.post(cfg.token_url, data=payload, headers=headers, timeout=timeout)
            break
        except requests.Timeout as e:
            if attempt < max_retries:
                wait = 2 * (attempt + 1)
                print(
                    f"[WARN] Token request timed out; retrying in {wait}s...",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue
            raise OAuthFlowError(f"Token request timed out: {e}") from e
        except requests.RequestException as e:
            raise OAuthFlowError(f"Token request failed (network): {e}") from e

    content_type = resp.headers.get("Content-Type", "")
    is_json = "json" in content_type.lower()
    body: Any
    if is_json:
        try:
            body = resp.json()
        except ValueError:
            body = resp.text
    else:
        body = resp.text

    if resp.status_code != 200:
        raise OAuthFlowError(f"Token exchange failed ({resp.status_code}). Response:\n{_pretty(body)}")

    if not isinstance(body, dict):
        raise OAuthFlowError(f"Token response was not JSON object. Response:\n{_pretty(body)}")

    if "access_token" not in body:
        raise OAuthFlowError(f"Token response missing access_token. Response:\n{_pretty(body)}")

    return body


def fetch_userinfo_patient_id(cfg: PayerTestConfig, access_token: str) -> Optional[str]:
    if not cfg.userinfo_url:
        return None
    try:
        resp = requests.get(
            cfg.userinfo_url,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            timeout=_http_timeout(),
        )
    except requests.RequestException as e:
        print(f"[WARN] userinfo request failed: {e}", file=sys.stderr)
        return None
    try:
        data = resp.json()
    except ValueError:
        print(f"[WARN] userinfo not JSON: {resp.text[:500]}", file=sys.stderr)
        return None
    if resp.status_code != 200 or not isinstance(data, dict):
        print(f"[WARN] userinfo HTTP {resp.status_code}: {_pretty(data)}", file=sys.stderr)
        return None

    print("\n--- $userinfo response (redacted) ---")
    redacted = {k: v for k, v in data.items() if k not in ()}
    print(_pretty(redacted))

    p = data.get("patient")
    if p is not None and str(p).strip():
        return str(p).strip()
    for key in ("fhirUser", "fhir_user"):
        fu = data.get(key)
        if isinstance(fu, str) and fu.strip():
            s = fu.strip()
            return s.rsplit("/", 1)[-1] if "/" in s else s
    sub = data.get("sub")
    if sub is not None and str(sub).strip():
        return str(sub).strip()
    return None


def _patient_id_from_jwt_access_token(access_token: str) -> Optional[str]:
    parts = access_token.split(".")
    if len(parts) < 2:
        return None
    payload_b64 = parts[1]
    pad = (-len(payload_b64)) % 4
    if pad:
        payload_b64 += "=" * pad
    try:
        raw = base64.urlsafe_b64decode(payload_b64.encode("ascii"))
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    p = data.get("patient")
    if p is not None and str(p).strip():
        return str(p).strip()
    for key in ("fhirUser", "fhir_user"):
        fu = data.get(key)
        if isinstance(fu, str) and fu.strip():
            s = fu.strip()
            return s.rsplit("/", 1)[-1] if "/" in s else s
    sub = data.get("sub")
    if sub is not None and str(sub).strip():
        return str(sub).strip()
    return None


def resolve_patient_id(cfg: PayerTestConfig, token: Dict[str, Any]) -> Optional[str]:
    if cfg.requires_userinfo:
        at = token.get("access_token")
        if isinstance(at, str) and at:
            return fetch_userinfo_patient_id(cfg, at)
        return None
    raw = token.get("patient") if token.get("patient") is not None else token.get("patient_id")
    if raw is not None:
        s = str(raw).strip()
        if s:
            return s
    at = token.get("access_token")
    if isinstance(at, str) and at.strip():
        return _patient_id_from_jwt_access_token(at.strip())
    return None


def fetch_eob(cfg: PayerTestConfig, *, access_token: str, patient_id: str) -> Dict[str, Any]:
    url = f"{cfg.fhir_base_url.rstrip('/')}/ExplanationOfBenefit?patient={urllib.parse.quote(patient_id)}"
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/fhir+json"}
    resp = requests.get(url, headers=headers, timeout=_http_timeout())
    if resp.status_code != 200:
        raise RuntimeError(f"FHIR EOB failed ({resp.status_code}):\n{resp.text}")
    try:
        data = resp.json()
    except ValueError as e:
        raise RuntimeError(f"FHIR response was not JSON:\n{resp.text}") from e
    if not isinstance(data, dict):
        raise RuntimeError(f"FHIR response JSON was not an object:\n{_pretty(data)}")
    return data


def fetch_fhir_bundle(
    cfg: PayerTestConfig,
    *,
    access_token: str,
    patient_id: str,
    resource_path: str,
    label: str,
) -> Optional[Dict[str, Any]]:
    """GET {base}/{resource_path}?patient=... — logs non-200 as warning, returns None."""
    url = f"{cfg.fhir_base_url.rstrip('/')}/{resource_path}?patient={urllib.parse.quote(patient_id)}"
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/fhir+json"}
    resp = requests.get(url, headers=headers, timeout=_http_timeout())
    if resp.status_code != 200:
        print(
            f"[WARN] FHIR {label} HTTP {resp.status_code} (may be unsupported in this environment):\n{resp.text[:800]}",
            file=sys.stderr,
        )
        return None
    try:
        data = resp.json()
    except ValueError:
        print(f"[WARN] {label} response not JSON:\n{resp.text[:500]}", file=sys.stderr)
        return None
    if isinstance(data, dict):
        return data
    print(f"[WARN] {label} JSON was not an object.", file=sys.stderr)
    return None


def _interactive_payer_choice() -> str:
    print("\nSelect payer to test:")
    print("  1) Elevance")
    print("  2) Cigna")
    print("  3) Aetna")
    choice = input("Enter 1, 2, or 3: ").strip()
    if choice == "1":
        return "elevance"
    if choice == "2":
        return "cigna"
    if choice == "3":
        return "aetna"
    print("Invalid choice; defaulting to Elevance.", file=sys.stderr)
    return "elevance"


def main() -> int:
    parser = argparse.ArgumentParser(description="SMART on FHIR PKCE + FHIR smoke test (multi-payer).")
    parser.add_argument(
        "--payer",
        choices=("1", "2", "3", "elevance", "cigna", "aetna"),
        default=None,
        help="1=Elevance, 2=Cigna, 3=Aetna (if omitted, prompts interactively)",
    )
    args = parser.parse_args()

    if args.payer in (None, ""):
        payer_key = _interactive_payer_choice()
    elif args.payer in ("1", "elevance"):
        payer_key = "elevance"
    elif args.payer in ("2", "cigna"):
        payer_key = "cigna"
    else:
        payer_key = "aetna"

    try:
        if payer_key == "elevance":
            cfg = load_elevance_config()
        elif payer_key == "cigna":
            cfg = load_cigna_config()
        else:
            cfg = load_aetna_config()
    except ConfigError as e:
        print(f"[CONFIG ERROR] {e}", file=sys.stderr)
        print(
            textwrap.dedent(
                """
                Set payer-specific variables in .env (see .env.example):
                  Elevance: ELEVANCE_CLIENT_ID, ELEVANCE_REDIRECT_URI, ELEVANCE_AUTH_URL, ...
                  Cigna: CIGNA_CLIENT_ID, CIGNA_REDIRECT_URI (optional URL overrides: CIGNA_AUTH_URL, …)
                  Aetna: AETNA_CLIENT_ID, AETNA_CLIENT_SECRET, AETNA_REDIRECT_URI (optional: AETNA_AUD, AETNA_FHIR_BASE_URL, …)
                """
            ).strip(),
            file=sys.stderr,
        )
        return 2

    code_verifier, code_challenge = generate_pkce_pair()
    state = secrets.token_urlsafe(24)
    auth_url = build_authorize_url(cfg, code_challenge, state)

    print(f"--- {cfg.payer_id.upper()} SMART on FHIR PKCE Tester ---\n")
    print("[STEP 1] Open this URL in your browser and authenticate/approve:")
    print("-" * 80)
    print(auth_url)
    print("-" * 80)

    redirected_url = prompt_redirected_url()
    try:
        code, returned_state = extract_code_and_state(redirected_url)
    except OAuthFlowError as e:
        print(f"[OAUTH ERROR] {e}", file=sys.stderr)
        return 3

    if returned_state and returned_state != state:
        print(
            f"[OAUTH ERROR] State mismatch.\n  expected={state}\n  returned={returned_state}",
            file=sys.stderr,
        )
        return 4

    print("\n[STEP 2] Exchanging code for tokens...")
    t0 = time.time()
    try:
        token = exchange_code_for_token(cfg, code=code, code_verifier=code_verifier)
    except OAuthFlowError as e:
        print(f"[OAUTH ERROR] {e}", file=sys.stderr)
        return 5
    dt = time.time() - t0

    access_token = token.get("access_token")
    print(f"[SUCCESS] Token received in {dt:.2f}s")
    print("\n--- Raw token response (excluding access_token) ---")
    redacted = {k: v for k, v in token.items() if k != "access_token"}
    print(_pretty(redacted))

    patient_id = resolve_patient_id(cfg, token)
    if not patient_id:
        print(
            "[WARN] Could not resolve patient id from token"
            + (" or $userinfo" if cfg.requires_userinfo else "")
            + "."
        )
        manual = input("Patient ID (empty to skip FHIR): ").strip()
        patient_id = manual or None

    if patient_id and access_token:
        print(f"\n[STEP 3] Fetching ExplanationOfBenefit for patient={patient_id} ...")
        try:
            eob = fetch_eob(cfg, access_token=str(access_token), patient_id=patient_id)
        except Exception as e:
            print(f"[FHIR ERROR] {e}", file=sys.stderr)
            return 6
        print("[SUCCESS] FHIR EOB retrieved.")
        print(_pretty(eob))

        print("\n[STEP 4] Optional: MedicationRequest / MedicationStatement / MedicationDispense / Claim …")
        for path, label in (
            ("MedicationRequest", "MedicationRequest"),
            ("MedicationStatement", "MedicationStatement"),
            ("MedicationDispense", "MedicationDispense"),
            ("Claim", "Claim"),
        ):
            bundle = fetch_fhir_bundle(
                cfg,
                access_token=str(access_token),
                patient_id=patient_id,
                resource_path=path,
                label=label,
            )
            if bundle is not None:
                print(f"\n--- {label} (HTTP 200) ---")
                print(_pretty(bundle))
    else:
        print("\n[SKIP] No patient id — FHIR request not sent.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
