# Backend image — used by celery-worker and celery-beat in docker-compose.
# Code is bind-mounted at runtime (./backend:/app) so this image only needs
# Python and the dependencies; rebuilding is only required when
# requirements.txt changes.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt
