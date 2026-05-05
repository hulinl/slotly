from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import (
    RecentSearchDeleteView,
    RecentSearchListView,
    SavedSearchViewSet,
    SearchView,
)

router = SimpleRouter(trailing_slash=False)
router.register(r"saved-searches", SavedSearchViewSet, basename="saved-search")

urlpatterns = router.urls + [
    path("search", SearchView.as_view(), name="search"),
    path("recent-searches", RecentSearchListView.as_view(), name="recent-search-list"),
    path("recent-searches/<int:pk>", RecentSearchDeleteView.as_view(), name="recent-search-delete"),
]
