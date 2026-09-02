from django.urls import path

from .views import (
    BookingRequestDecideView,
    BookingRequestListView,
    GoogleAccountStatusView,
    HostBookingListView,
    MeetingCreateView,
    MicrosoftAccountStatusView,
    MicrosoftOAuthStartView,
    MicrosoftWritableCalendarsView,
    OAuthStartView,
    PublicBookingManageView,
    PublicMeetingCreateView,
    WritableCalendarsView,
    microsoft_oauth_callback,
    oauth_callback,
)

urlpatterns = [
    path("oauth/google/start", OAuthStartView.as_view(), name="google-oauth-start"),
    path("oauth/google/callback", oauth_callback, name="google-oauth-callback"),
    path("google-account", GoogleAccountStatusView.as_view(), name="google-account"),
    path(
        "google-account/writable-calendars",
        WritableCalendarsView.as_view(),
        name="google-account-writable-calendars",
    ),
    path("oauth/microsoft/start", MicrosoftOAuthStartView.as_view(), name="microsoft-oauth-start"),
    path("oauth/microsoft/callback", microsoft_oauth_callback, name="microsoft-oauth-callback"),
    path("microsoft-account", MicrosoftAccountStatusView.as_view(), name="microsoft-account"),
    path(
        "microsoft-account/writable-calendars",
        MicrosoftWritableCalendarsView.as_view(),
        name="microsoft-account-writable-calendars",
    ),
    path("meetings", MeetingCreateView.as_view(), name="meetings-create"),
    path(
        "public/meetings/<uuid:token>",
        PublicMeetingCreateView.as_view(),
        name="public-meetings-create",
    ),
    # Single URL, verb-based dispatch: GET returns booking details;
    # POST (with optional {"reason": "..."}) cancels the booking.
    path(
        "public/bookings/<uuid:uuid_>",
        PublicBookingManageView.as_view(),
        name="public-booking-manage",
    ),
    path("booking-requests", BookingRequestListView.as_view(), name="booking-requests-list"),
    path("host-bookings", HostBookingListView.as_view(), name="host-bookings-list"),
    path(
        "booking-requests/<int:pk>/decide",
        BookingRequestDecideView.as_view(),
        name="booking-requests-decide",
    ),
]
