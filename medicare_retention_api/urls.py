from __future__ import annotations

from django.contrib import admin
from django.http import JsonResponse
from django.urls import path

from medicare_retention_api.auth_views import (
    authorize_legacy,
    callback_legacy,
    exchange_code,
    oauth_authorize,
    oauth_callback,
    oauth_debug_config,
    proxy_coverage,
    proxy_dailymed,
    proxy_encounter,
    proxy_eob,
    proxy_fhir,
    proxy_patient,
)


def health(request):
    return JsonResponse({"ok": True})


def root(request):
    return JsonResponse(
        {
            "service": "medicare_retention_api",
            "message": "Django API gateway is running.",
            "endpoints": {
                "health": "/health/",
                "authorize_legacy": "/authorize/ → HTML picker → /api/auth/<payer_id>/authorize/",
                "oauth_authorize": "/api/auth/<payer_id>/authorize/",
                "oauth_callback": "/api/auth/<payer_id>/callback/",
                "callback_legacy": "/callback/ → Elevance (backward compatible)",
                "token_exchange": "/api/auth/exchange/",
                "fhir_proxy": "/api/fhir/<payer_id>/<resource_type>/?patient_id=<id>",
                "fhir_legacy_elevance": "/api/fhir/patient/ … /eob/ (Elevance shorthand)",
                "dailymed_proxy": "/api/drugs/?name=<query>",
                "admin": "/admin/",
                "oauth_debug": "/api/debug/oauth/?payer=elevance (requires OAUTH_DEBUG=1)",
            },
        }
    )


urlpatterns = [
    path("", root),
    path("admin/", admin.site.urls),
    path("health/", health),
    path("authorize", authorize_legacy),
    path("authorize/", authorize_legacy),
    path("callback", callback_legacy),
    path("callback/", callback_legacy),
    path("api/auth/<str:payer_id>/authorize/", oauth_authorize),
    path("api/auth/<str:payer_id>/callback/", oauth_callback),
    path("api/auth/exchange/", exchange_code),
    path("api/debug/oauth/", oauth_debug_config),
    path("api/fhir/<str:payer_id>/<str:resource_type>/", proxy_fhir),
    path("api/fhir/patient/", proxy_patient),
    path("api/fhir/coverage/", proxy_coverage),
    path("api/fhir/encounter/", proxy_encounter),
    path("api/fhir/eob/", proxy_eob),
    path("api/drugs/", proxy_dailymed),
]
