"""GET /api/holidays?year=YYYY[&country=XX] — public-holiday lookup."""

from __future__ import annotations

from datetime import date

import holidays as holidays_lib
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import SUPPORTED_COUNTRIES


class HolidaysView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        try:
            year = int(request.query_params.get("year", date.today().year))
        except (TypeError, ValueError):
            return Response({"detail": "year must be an integer."}, status=400)
        if year < 2000 or year > 2100:
            return Response({"detail": "year out of range."}, status=400)

        # Caller can override their stored country with ?country=XX (debug
        # helper); otherwise use User.country.
        country = (request.query_params.get("country") or request.user.country or "CZ").upper()
        if country not in SUPPORTED_COUNTRIES:
            return Response(
                {"detail": f"Unsupported country '{country}'."}, status=400,
            )

        try:
            entries = holidays_lib.country_holidays(
                country, years=[year], language="en_US",
            )
        except Exception:
            # Some countries don't ship en_US; fall back to default locale.
            entries = holidays_lib.country_holidays(country, years=[year])

        out = [
            {"date": d.isoformat(), "name": name}
            for d, name in sorted(entries.items())
        ]
        return Response({"country": country, "year": year, "results": out})
