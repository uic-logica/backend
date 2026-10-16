# Paused passwordless sign-in

Archived from backend commit `52db941273fec12f8e141b11b4bc97e53678ed8c`.
`auth.ts.txt` and `verify-route.ts.txt` preserve the provider and code redemption implementation outside the build. Their former supporting modules and tests have been deleted; these snapshots are historical reference only.

Passwordless is deliberately disabled: Auth.js registers no email provider and `/api/auth/otp/verify` returns 410. Old emailed links cannot sign a user in. Session reads and sign-out still use Auth.js.

Before restoring it, diagnose delivery and callback handling, test behind the deployed frontend proxy, verify expiry/single-use and persistent limits, and decide explicitly how password and passwordless credentials coexist. Do not simply re-enable the old provider as a fallback.
