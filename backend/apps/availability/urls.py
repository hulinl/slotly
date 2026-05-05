from rest_framework.routers import SimpleRouter

from .views import UnavailabilityViewSet

router = SimpleRouter(trailing_slash=False)
router.register(r"unavailabilities", UnavailabilityViewSet, basename="unavailability")

urlpatterns = router.urls
