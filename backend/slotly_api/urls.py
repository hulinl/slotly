from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def healthz(_request):
    return JsonResponse({"status": "ok", "service": "slotly-api"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthz),
    path("_allauth/", include("allauth.headless.urls")),
    path("api/", include("apps.accounts.urls")),
    path("api/", include("apps.calendars.urls")),
]
