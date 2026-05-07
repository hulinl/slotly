from django.urls import path

from .holidays_view import HolidaysView
from .views import (
    DeleteMeView,
    MeView,
    PublicProfileView,
    RegenerateShareTokenView,
    TeammateView,
    TeammatesIndexView,
)

urlpatterns = [
    # Registered without trailing slash to avoid the Next.js (strip slash)
    # ↔ Django APPEND_SLASH (add slash) redirect loop when proxied through
    # the frontend dev server.
    path("me", MeView.as_view(), name="me"),
    path("me/share/regenerate", RegenerateShareTokenView.as_view(), name="me-share-regenerate"),
    path("me/delete", DeleteMeView.as_view(), name="me-delete"),
    path("users", TeammatesIndexView.as_view(), name="teammate-index"),
    path("users/<int:pk>", TeammateView.as_view(), name="teammate"),
    path("holidays", HolidaysView.as_view(), name="holidays"),
    path("public/profile/<uuid:token>", PublicProfileView.as_view(), name="public-profile"),
]
