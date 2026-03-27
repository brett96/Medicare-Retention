#!/usr/bin/env python3
"""
Vercel build step: collectstatic + migrate.

Kept at repo root (not under `scripts/`) because `.vercelignore` excludes `scripts/`
from uploads — a build script there would be missing on Vercel and break deploys.

If this fails, the deployment must not go live without fixing DATABASE_URL / build settings.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MIGRATION_0002 = ROOT / "gateway" / "migrations" / "0002_pkcesession_payer_id.py"


def run(cmd: list[str]) -> None:
    print(f"+ {' '.join(cmd)}", flush=True)
    subprocess.check_call(cmd, cwd=str(ROOT), env={**os.environ})


def main() -> int:
    os.chdir(ROOT)
    if not MIGRATION_0002.is_file():
        print(
            "vercel_build: ERROR — gateway/migrations/0002_pkcesession_payer_id.py is missing "
            "from the deployment bundle. Check .vercelignore and git.",
            file=sys.stderr,
        )
        return 1

    (ROOT / "staticfiles").mkdir(parents=True, exist_ok=True)
    py = sys.executable
    run([py, "manage.py", "collectstatic", "--noinput"])
    run([py, "manage.py", "migrate", "--noinput"])
    run([py, "manage.py", "showmigrations", "--list", "gateway"])
    print("vercel_build: ok", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
