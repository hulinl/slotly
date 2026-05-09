from django.urls import path

from .views import (
    ConnectionAcceptView,
    ConnectionDetailView,
    ConnectionListView,
    ConnectionRejectView,
    ConnectionRequestView,
)

urlpatterns = [
    path("connections", ConnectionListView.as_view(), name="connection-list"),
    path("connections/request", ConnectionRequestView.as_view(), name="connection-request"),
    path("connections/<int:pk>", ConnectionDetailView.as_view(), name="connection-detail"),
    path("connections/<int:pk>/accept", ConnectionAcceptView.as_view(), name="connection-accept"),
    path("connections/<int:pk>/reject", ConnectionRejectView.as_view(), name="connection-reject"),
]
