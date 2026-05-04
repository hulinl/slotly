from django.urls import path

from .views import MeView

urlpatterns = [
    # Registered without trailing slash to avoid the Next.js (strip slash)
    # ↔ Django APPEND_SLASH (add slash) redirect loop when proxied through
    # the frontend dev server.
    path("me", MeView.as_view(), name="me"),
]
