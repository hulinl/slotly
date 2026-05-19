from django.urls import path

from .views import GoogleAccountStatusView, OAuthStartView, oauth_callback

urlpatterns = [
    path("oauth/google/start", OAuthStartView.as_view(), name="google-oauth-start"),
    path("oauth/google/callback", oauth_callback, name="google-oauth-callback"),
    path("google-account", GoogleAccountStatusView.as_view(), name="google-account"),
]
