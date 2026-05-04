# Slotly

> Working title. See [`PRD.md`](./PRD.md) for full product spec.

A free web app for finding shared availability across team calendars. Users subscribe to their iCal/ICS URLs (Google, Apple iCloud, Outlook) and the app shows when everyone in a selected group is free.

## Repo layout

```
.
├── PRD.md              Product requirements document — single source of truth
├── backend/            Django + DRF API (Python 3.12)
├── frontend/           Next.js 15 + TypeScript + Tailwind (PWA)
├── docker-compose.yml  Local Postgres 16 + Redis 7 for development
├── .env.example        Template for local environment variables
└── .gitignore
```

## Stack (target)

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + shadcn/ui |
| Backend | Django 5 + Django REST Framework + django-allauth |
| Async | Celery + Celery Beat + Redis |
| Database | PostgreSQL 16 |
| Calendar parsing | `icalendar` + `httpx` (RFC 5545 ICS subscriptions, polled every 5 min) |
| Hosting (prod) | Azure Container Apps (West Europe) + Azure Database for PostgreSQL + Azure Cache for Redis |

## Local development

### Prerequisites

- Python 3.12+
- Node 22+ (Node 24 on the dev machine works fine)
- Docker Desktop (for local Postgres + Redis)
- `gh` CLI (optional, for GitHub workflows)

### First-time setup

```bash
# 1. Start Postgres + Redis in the background
docker compose up -d

# 2. Backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env
python manage.py migrate
python manage.py runserver  # http://localhost:8000

# 3. Frontend (in another terminal)
cd frontend
npm install
npm run dev  # http://localhost:3000
```

> **Note**: `backend/` and `frontend/` are scaffolded in subsequent commits. This README documents the target shape.

## Status

Phase: PRD finalized. Implementation kick-off — auth & onboarding (milestone 1).

Roadmap: see PRD §10.

## License

TBD before public launch.
