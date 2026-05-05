from django.urls import path

from .views import DeleteMeView, MeView, TeammateView, TeammatesIndexView

urlpatterns = [
    # Registered without trailing slash to avoid the Next.js (strip slash)
    # ↔ Django APPEND_SLASH (add slash) redirect loop when proxied through
    # the frontend dev server.
    path("me", MeView.as_view(), name="me"),
    path("me/delete", DeleteMeView.as_view(), name="me-delete"),
    path("users", TeammatesIndexView.as_view(), name="teammate-index"),
    path("users/<int:pk>", TeammateView.as_view(), name="teammate"),
]
