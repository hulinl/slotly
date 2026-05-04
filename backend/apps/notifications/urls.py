from django.urls import path

from .views import (
    NotificationListView,
    NotificationPrefsView,
    NotificationReadAllView,
    NotificationReadView,
)

urlpatterns = [
    path("notifications", NotificationListView.as_view(), name="notification-list"),
    path("notifications/read-all", NotificationReadAllView.as_view(), name="notification-read-all"),
    path("notifications/<int:pk>/read", NotificationReadView.as_view(), name="notification-read"),
    path("me/notification-prefs", NotificationPrefsView.as_view(), name="notification-prefs"),
]
