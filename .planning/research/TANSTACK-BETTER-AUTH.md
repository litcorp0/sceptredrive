# Research — TanStack Start + Better Auth + Hono

**Researched:** 2026-10-17
**Sources:** `better-auth.com/docs/integrations/tanstack`, `better-auth.com/docs/integrations/hono`,
`tanstack.com/start/latest/docs/framework/react/guide/hosting`, `tanstack.com/start` release notes

## Stack status

- TanStack Start reached 1.0 in October 2026. The existing scaffold uses
  `@tanstack/react-start` 1.169.3 with Vite 8 and the Nitro plugin (Nitro is still beta).
  Pin scaffold versions; keep server functions thin.
- TanStack Start builds a Node server via Nitro (`.output/server/index.mjs`). The admin
  deploys as a container behind Caddy.

## Better Auth in TanStack Start

- `tanstackStartCookies()` must be the **last** plugin; it writes auth cookies onto responses.
- Read sessions server-side with `auth.api.getSession({ headers: getRequestHeaders() })`
  wrapped in a `createServerFn` so client-side navigation can call it too.
- `beforeLoad` guards control navigation only — they are **not** a security boundary.
- Every server function and API endpoint that touches private data must authorize itself.
- `baseURL` must be a fully qualified URL; `trustedOrigins` drives CSRF protection;
  `useSecureCookies` in production.

## Better Auth on Hono

- Both use Web Standards; mount with `app.all("/api/auth/*", (c) => auth.handler(c.req.raw))`.
- CORS must be registered before the auth route, with an explicit origin and
  `credentials: true`; the same origin must be in `trustedOrigins`.
- Session middleware can read `auth.api.getSession({ headers: c.req.raw.headers })`
  and put user/session on Hono context.
- Cross-subdomain cookies are supported (`advanced.crossSubDomainCookies`); otherwise use
  same-origin requests (proxy `/api` under the admin domain).

## Chosen architecture for Sceptre Drive

- The **API is the only auth provider**. Better Auth lives in `api/`.
- The admin uses the Better Auth client against the API:
  - Production: same-origin `/api/*` via Caddy, so cookies are first-party and `SameSite=Lax`.
  - Development: Vite dev proxy from the admin origin to the API, or explicit CORS.
- Admin route `beforeLoad` calls a TanStack Start server function that forwards cookies to
  the API session endpoint; the returned session drives navigation only.
- Every admin data call goes to the API, which re-checks role and branch scope.
- The desktop POS does **not** use browser sessions: it exchanges an enrollment code for a
  device token, uses offline PIN login, and calls the API with a bearer device token.
- 2FA (TOTP) is provided by the Better Auth two-factor plugin and can be required by policy
  for Admin/Manager accounts.

## Implications for Sceptre Drive

- Phase 1 must prove the admin → API cookie session round trip in dev and in the container
  topology (admin and API behind one Caddy origin).
- Keep all authorization and business rules in the API; the admin never becomes the boundary.
- Session cookies are httpOnly/secure; logins and PIN attempts are rate-limited.
