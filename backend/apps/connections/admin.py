from django.contrib import admin

from .models import Connection


@admin.register(Connection)
class ConnectionAdmin(admin.ModelAdmin):
    list_display = ("id", "user_low", "user_high", "status", "requested_by", "created_at")
    list_filter = ("status",)
    search_fields = ("user_low__email", "user_high__email", "requested_by__email")
    readonly_fields = ("created_at", "accepted_at")
