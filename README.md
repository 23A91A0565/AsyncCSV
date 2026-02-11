# Async CSV Exporter

This project implements a large-scale CSV export service with asynchronous streaming, progress tracking, resumable downloads, and optional gzip compression. It is fully containerized and runs with a single docker-compose command.


## Requirements
- Docker + Docker Compose

## Quick Start


```bash
docker-compose up --build -d
```

The database seeds 10 million rows on first startup (may take several minutes depending on host performance).

## Environment Variables
All required variables are documented in [.env.example](.env.example).

## API Endpoints

### Health
`GET /health`


Response:
```json
{"status":"ok"}
```

### Initiate Export
`POST /exports/csv`

Query parameters (optional):
- `country_code`
- `subscription_tier`
- `min_ltv`
- `columns` (comma-separated list of columns)
- `delimiter` (single char, default `,`)
- `quoteChar` (single char, default `"`)

Response (202):
```json
{"exportId":"uuid","status":"pending"}
```

### Check Status
`GET /exports/{exportId}/status`

Response (200):
```json
{
	"exportId":"uuid",
	"status":"pending|processing|completed|failed|cancelled",
	"progress":{"totalRows":0,"processedRows":0,"percentage":0},
	"error":null,
	"createdAt":"2026-02-07T00:00:00.000Z",
	"completedAt":null
}
```


### Download Export
`GET /exports/{exportId}/download`

Supports:
- Resumable downloads via `Range: bytes=start-end`
- Gzip compression via `Accept-Encoding: gzip`

### Cancel Export
`DELETE /exports/{exportId}`

Response: `204 No Content`

## Project Structure
- [docker-compose.yml](docker-compose.yml): Orchestrates app + database
- [app/Dockerfile](app/Dockerfile): App container
- [app/src/index.js](app/src/index.js): API server
- [app/src/exporter.js](app/src/exporter.js): Streaming export worker
- [seeds/init.sql](seeds/init.sql): Schema + 10M seed

## Notes
- Export files are written to `app/exports` on the host and `/app/exports` in the container.
- Exports are streamed in batches of 1000 rows to keep memory usage low.
- Progress is persisted in the `exports` table.

