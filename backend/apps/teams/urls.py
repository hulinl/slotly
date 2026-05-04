from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import InvitationActionView, MyInvitationsView, TeamViewSet

router = SimpleRouter(trailing_slash=False)
router.register(r"teams", TeamViewSet, basename="team")

urlpatterns = router.urls + [
    path("invitations", MyInvitationsView.as_view(), name="my-invitations"),
    path(
        "invitations/<str:token>/<str:action>",
        InvitationActionView.as_view(),
        name="invitation-action",
    ),
]
