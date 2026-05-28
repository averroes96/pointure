# ShoeDZ / Pointure — License Server

A self-contained Django service that issues and validates software license keys
for the Pointure / ShoeDZ self-hosted product.

---

## Quick start (Docker Compose)

```bash
# 1. Clone / copy this directory to your server
cd license-server

# 2. Create your env file
cp .env.example .env
# Edit .env — set SECRET_KEY, DB_PASSWORD, ALLOWED_HOSTS, ADMIN_URL

# 3. Build and start
docker compose up -d --build

# 4. Run migrations & create a superuser
docker compose exec web python manage.py migrate
docker compose exec web python manage.py createsuperuser

# 5. Collect static files (admin CSS)
docker compose exec web python manage.py collectstatic --noinput
```

The admin panel is available at `http://localhost:8001/<ADMIN_URL>/`
(default path is `admin/`).

---

## Creating a license

1. Open the admin panel and log in.
2. Go to **Licenses → Add license**.
3. Fill in client name, email, plan, and optionally an expiry date.
4. A key in `SHDZ-XXXX-XXXX-XXXX` format is pre-generated — you may edit it.
5. Save and copy the key to your client.

---

## API endpoints

All endpoints return JSON.  No `Authorization` header is required — the
license key itself is the credential.

### POST `/api/activate/`

Called when the client application starts for the first time on a machine.

**Request**
```json
{
  "license_key": "SHDZ-AB12-CD34-EF56",
  "machine_id": "550e8400-e29b-41d4-a716-446655440000",
  "hostname": "DESKTOP-ABC123",
  "app_version": "1.2.0"
}
```

**Success response**
```json
{
  "valid": true,
  "plan": "pro_retail",
  "expires_at": "2027-01-01T00:00:00Z",
  "client_name": "Boutique Amina"
}
```
`expires_at` is `null` for perpetual licenses.

**Error response**
```json
{ "valid": false, "error": "machine_limit_exceeded" }
```

Possible `error` values: `invalid_key`, `suspended`, `expired`,
`machine_limit_exceeded`.

---

### POST `/api/heartbeat/`

Called periodically (e.g. every 30 minutes) while the app is running to
confirm the license is still valid and update the last-seen timestamp.

**Request**
```json
{
  "license_key": "SHDZ-AB12-CD34-EF56",
  "machine_id": "550e8400-e29b-41d4-a716-446655440000",
  "app_version": "1.2.0"
}
```

Response format is identical to `/api/activate/`.  An additional error code
`not_activated` is returned if the machine was never registered (the client
should then call `/api/activate/`).

---

### GET `/api/version/`

Returns the current published version of the application.

**Response**
```json
{
  "latest": "1.2.0",
  "minimum": "1.2.0",
  "changelog_url": "https://github.com/averroes96/pointure/releases"
}
```

Update `APP_VERSION` in `.env` whenever you release a new build.

---

## Admin actions

From the **Licenses** list view you can select licenses and apply:

- **Suspend selected licenses** — immediately blocks all activations.
- **Activate selected licenses** — restores access.
- **Regenerate key for selected licenses** — issues a new `SHDZ-…` key.
  Remember to share the new key with the client.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | yes | Django secret key (50+ random chars) |
| `DATABASE_URL` | yes | Full Postgres connection string |
| `ALLOWED_HOSTS` | yes | Comma-separated hostnames |
| `DB_NAME` | no | Postgres database name (default: `licenses`) |
| `DB_USER` | no | Postgres user (default: `licenses`) |
| `DB_PASSWORD` | yes | Postgres password |
| `ADMIN_URL` | no | Path for the admin panel (default: `admin/`) |
| `APP_VERSION` | no | Current app version returned by `/api/version/` |
| `DEBUG` | no | Set `True` only in development |

---

## Reverse proxy (nginx example)

```nginx
server {
    listen 443 ssl;
    server_name licenses.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
