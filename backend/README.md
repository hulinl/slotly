# Slotly backend

Django 5 + DRF API. Scaffolded incrementally — start with auth in milestone 1.

## Layout (target)

```
backend/
├── manage.py
├── requirements.txt
├── pyproject.toml          # ruff, black, pytest config
├── slotly_api/             # project package
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
└── apps/
    ├── accounts/           # custom User, allauth glue, profile
    ├── teams/              # teams, memberships, invitations
    ├── calendars/          # ICS subscriptions, polling, parser
    └── search/             # availability search engine
```

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```
