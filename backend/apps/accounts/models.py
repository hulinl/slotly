from __future__ import annotations

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models

# Per PRD §5.1: default working hours are Mon-Fri 8:00-17:00, weekends unavailable.
# Single window per day in MVP; lunch breaks etc. are out of scope.
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def default_working_hours() -> dict[str, dict[str, str | bool]]:
    weekday_default = {"start": "08:00", "end": "17:00", "available": True}
    weekend_default = {"start": "09:00", "end": "13:00", "available": False}
    return {
        **{day: dict(weekday_default) for day in WEEKDAYS[:5]},
        **{day: dict(weekend_default) for day in WEEKDAYS[5:]},
    }


class UserManager(BaseUserManager):
    """Email-as-identity user manager. Username field is unused."""

    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra_fields):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email: str, password: str | None = None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    """Custom user with email as the unique identifier; no username."""

    username = None
    email = models.EmailField("email address", unique=True)
    first_name = models.CharField(max_length=80, blank=True)
    last_name = models.CharField(max_length=80, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    working_hours = models.JSONField(default=default_working_hours)
    # Per-event × per-channel matrix (PRD §5.6). Initialized at signup via
    # apps.notifications.signals. Empty dict for legacy users; the dispatcher
    # treats a missing event key as "all on", matching the default.
    notification_prefs = models.JSONField(default=dict, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    def __str__(self) -> str:
        return self.email
