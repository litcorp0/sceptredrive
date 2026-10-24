/**
 * `auth` — the five signed-out / credential screens.
 *
 * Move map (Phase 8, D8): `routes/{login,forgot-password,reset-password,two-factor}.tsx` and
 * `routes/_authenticated/change-password.tsx` render these pages; the route files keep their
 * `validateSearch` and `beforeLoad` guards (D6) and hold no markup.
 *
 * `lib/auth-client.ts`, `lib/auth-policy.ts` and `lib/session.functions.ts` stay in `lib/`: they
 * are infrastructure the shell uses before any module exists (D5).
 */
export { ChangePasswordPage } from "./pages/change-password-page"
export { ForgotPasswordPage } from "./pages/forgot-password-page"
export { LoginPage } from "./pages/login-page"
export { ResetPasswordPage } from "./pages/reset-password-page"
export { TwoFactorPage } from "./pages/two-factor-page"
