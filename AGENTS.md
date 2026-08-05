# AGENTS.md

## Must-follow constraints

- Use `bun` only. Do not use `npm` or `pnpm`.
- Do not start the dev server (`bun run dev`); assume it is already running.
- If you change `prisma/schema.prisma`, run `bun run db:generate`.
- In App Router dynamic routes, keep `params` typed as `Promise<...>` and `await params` in handlers/pages.

## Validation before finishing

- Run `bun run check`.

## Repo-specific conventions

- Use `auth()` from `@/lib/auth` for server-side session reads.
- Use `checkProjectAccess()` / `checkWorkspaceAccess()` for authorization instead of ad-hoc role checks.
- For API responses, use `successResponse` / `apiErrors` from `@/lib/api-response`.
- Keep API and UI imports on `@/` aliases when available.
- In Prisma raw SQL, use `$executeRaw` for statements that return no rows (e.g. `pg_advisory_xact_lock`). Using `$queryRaw` on void-returning functions causes a Prisma deserialization error (`Failed to deserialize column of type 'void'`).

## Important locations

- Custom SQL managed by Prisma migrations: `prisma/migrations/*/migration.sql`.
- Shared API response helpers: `lib/api-response.ts`.
- Auth + access-control helpers: `lib/auth.ts`.
- Nightly backup cron service: `backup/` (own Railway service, `rootDir: backup/`).
- Transcode worker: `transcode/` (own Railway service, `rootDir: transcode/`).

## Proxy renditions (transcode worker)

Each self-hosted cut gets 4K/1080/720 proxies. Review playback streams a proxy
instead of the master, and the download menu offers each ready rung.

- Queue rows: `VideoProxy` (`lib/video-proxy.ts`), created on every cut commit.
- Worker: `transcode/worker.py` — claims one job, ffmpeg-encodes it, PUTs the
  result straight to storage. It needs `KK_BASE_URL` + `TRANSCODE_API_KEY`
  (matching the app's own `TRANSCODE_API_KEY`). Any box with ffmpeg can run it;
  set `FFMPEG_VIDEO_ARGS` to an NVENC recipe on a GPU machine.
- Worker API: `POST /api/agent/transcode/claim`, `POST /api/agent/transcode/{id}`.
- Media bytes must never pass through this app (a piped 500MB cut OOM'd the
  container in July 2026). Both routes only hand out presigned URLs.

## Change safety rules

- Prefer backward-compatible API changes unless explicitly asked to break contracts.
- For multi-step DB writes, use Prisma transactions.
