from django.apps import AppConfig


class TeamsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.teams"
    label = "teams"

    def ready(self) -> None:
        # Wire up the email_confirmed → auto-accept signal.
        from . import signals  # noqa: F401
