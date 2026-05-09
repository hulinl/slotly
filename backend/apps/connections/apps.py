from django.apps import AppConfig


class ConnectionsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.connections"

    def ready(self) -> None:
        # Notification preferences pre-init at signup goes through the
        # notifications app; nothing extra here for now. Hook here later
        # if connection requests start needing a side-effect on creation.
        pass
