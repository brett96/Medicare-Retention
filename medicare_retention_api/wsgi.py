from __future__ import annotations

import logging
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "medicare_retention_api.settings")

application = get_wsgi_application()

logger = logging.getLogger(__name__)

# Opt-in: apply migrations on cold start when build-time migrate cannot reach Postgres
# (e.g. DATABASE_URL was not exposed to the Vercel *build* environment). Set
# RUN_MIGRATE_ON_STARTUP=1 for one deploy, confirm logs, then unset to avoid extra latency.
_MIGRATE_LOCK_ID = 9_876_543_210_987_654


def _maybe_migrate_on_startup() -> None:
    if os.environ.get("RUN_MIGRATE_ON_STARTUP", "").strip() != "1":
        return
    from django.conf import settings
    from django.core.management import call_command
    from django.db import connection

    engine = settings.DATABASES["default"].get("ENGINE", "")
    try:
        if "postgresql" in engine:
            with connection.cursor() as c:
                c.execute("SELECT pg_advisory_lock(%s)", [_MIGRATE_LOCK_ID])
            call_command("migrate", "--noinput", verbosity=1)
            logger.warning("RUN_MIGRATE_ON_STARTUP: migrate finished (disable env after schema is current).")
        else:
            call_command("migrate", "--noinput", verbosity=1)
    except Exception:
        logger.exception("RUN_MIGRATE_ON_STARTUP failed")
        raise
    finally:
        if "postgresql" in engine:
            try:
                with connection.cursor() as c:
                    c.execute("SELECT pg_advisory_unlock(%s)", [_MIGRATE_LOCK_ID])
            except Exception:
                logger.exception("RUN_MIGRATE_ON_STARTUP: unlock failed")


_maybe_migrate_on_startup()

# Vercel Python runtime expects a top-level "app" for WSGI.
app = application
