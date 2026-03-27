### `test_fhir_api.py`

Terminal PKCE + FHIR smoke test for **Elevance** or **Cigna** (same OAuth parameters as Django: scopes, `aud`, PKCE S256). Cigna runs an extra **`$userinfo`** GET after the token exchange to resolve `patient_id`.

**Quick start (PowerShell)**

```powershell
cd "c:\Users\brtom\Documents\Medicare Retention"
.\venv\Scripts\Activate.ps1
# Set payer env vars in .env or export them

# Interactive payer selection (1 = Elevance, 2 = Cigna)
python .\scripts\test_fhir_api.py

# Non-interactive
python .\scripts\test_fhir_api.py --payer 1
python .\scripts\test_fhir_api.py --payer cigna
```

See project root `.env.example` for `ELEVANCE_*` and `CIGNA_*` variable names.
