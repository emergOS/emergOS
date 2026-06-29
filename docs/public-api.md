# Public Partner API

Trusted partners can use `/api/v1/*` endpoints with a bearer token created in Admin -> Partner API.

## Authentication

Send either header:

```http
Authorization: Bearer <token>
```

or:

```http
x-emergos-api-token: <token>
```

Tokens are stored hashed in D1 and can be revoked from the admin dashboard.

## Scopes

- `reports:read`
- `pets:read`
- `resources:read`
- `organizations:read`
- `updates:read`
- `map:read`

## Endpoints

- `GET /api/v1/openapi.json`
- `GET /api/v1/reports`
- `GET /api/v1/reports/:slug`
- `GET /api/v1/pets`
- `GET /api/v1/resources`
- `GET /api/v1/organizations`
- `GET /api/v1/updates`
- `GET /api/v1/map-features`

Responses use:

```json
{
  "data": [],
  "nextCursor": null,
  "generatedAt": "2026-06-29T00:00:00.000Z"
}
```

Protected resource locations are redacted from public and partner map/resource responses.
