from django.urls import include, path
from rest_framework.routers import SimpleRouter

from .views import CalendarViewSet

router = SimpleRouter(trailing_slash=False)
router.register(r"calendars", CalendarViewSet, basename="calendar")

urlpatterns = [
    path("", include(router.urls)),
]
