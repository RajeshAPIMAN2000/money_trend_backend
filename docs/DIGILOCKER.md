# DigiLocker eKYC Integration (MoneyTrend)

## Status

Production-oriented DigiLocker / Meri Pehchaan OAuth 2.0 + PKCE (S256) integration for MoneyTrend Financial Services Platform.

| Item | Value |
| --- | --- |
| Client ID | `BN6CF9DE38` |
| Issuer ID | `in.moneytrend` |
| Application | MoneyTrend Financial Services Platform \| PROD |
| Registered domain / frontend | `https://www.moneytrend.in` (also `https://moneytrend.in`) |
| Local frontend | `http://localhost:5173` |
| Callback | `https://moneytrend.in/api/digilocker/callback` (exact partner portal match) |
| Authorize (partner default) | `/public/oauth2/2/authorize` |
| Token | `/public/oauth2/2/token` |
| User details | `/public/oauth2/1/user` |
| Issued files | `/public/oauth2/2/files/issued` |
| e-Aadhaar XML | `/public/oauth2/3/xml/eaadhaar` |

**Not fully production-certified until** sandbox/UAT with DigiLocker succeeds, JWKS signature verification is enabled, and partner scope/ACR grants for Aadhaar + PAN are confirmed.

## Architecture

1. Authenticated user calls `POST /api/digilocker/start` (alias `POST /api/kyc/digilocker/init`).
2. Backend creates a DB-backed OAuth session (`state`, encrypted `code_verifier`, nonce, expiry).
3. Browser redirects to DigiLocker authorize URL (PKCE S256).
4. DigiLocker redirects to `DIGILOCKER_REDIRECT_URI` → `GET /api/digilocker/callback`.
5. Backend validates `state`, atomically consumes session, exchanges code + verifier, validates `id_token` claims (signature pending JWKS), fetches identity metadata, runs verification scoring, persists KYC.
6. Browser redirects to frontend success/failure URL (no tokens in the URL).

DigiLocker authentication status is stored separately from MoneyTrend final KYC approval (`users.kyc_status`).

## Automatic approval (MoneyTrend journey)

Default: **on** (`DIGILOCKER_AUTO_APPROVE=true`).

| Outcome | When |
| --- | --- |
| **VERIFIED** | DigiLocker consent valid + required Aadhaar evidence + required PAN evidence + name match (+ DOB if required) |
| **PENDING** | Required Aadhaar/PAN/name evidence missing (DigiLocker may not have granted those docs for this consent) |
| **MANUAL_REVIEW** | Identity mismatch, or auto-approve disabled after checks pass |
| **FAILED** | Confirmed invalid / failed verification |

MoneyTrend never handles DigiLocker OTP or PIN. Document selection UI is DigiLocker’s — MoneyTrend does not fabricate a selection screen.

Cryptographic issuer signature verification remains **provider-attested / pending JWKS** until DigiLocker publishes signing keys.

## API

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/digilocker/start` | JWT | Start OAuth; returns `authUrl` |
| POST | `/api/kyc/digilocker/init` | JWT | Alias of start |
| GET | `/api/digilocker/callback` | none (state-bound) | Provider redirect |
| GET | `/api/digilocker/status` | JWT | Own DigiLocker / KYC status + verification checklist |
| GET/POST | `/api/digilocker/documents` | JWT | Issued-doc **metadata** only |
| POST | `/api/digilocker/revoke` | JWT | `501` until partner revoke URL/spec confirmed |
| POST | `/api/kyc/digilocker/complete-stub` | JWT | Dev/UAT stub |

## Environment

See `.env.example` DigiLocker section. Never commit real secrets.

Required for live mode:

- `DIGILOCKER_CLIENT_ID`
- `DIGILOCKER_CLIENT_SECRET`
- `DIGILOCKER_REDIRECT_URI` (must match partner portal exactly)
- `PII_ENCRYPTION_KEY`

## Database

Applied by `ensureCoreTables()`:

- `digilocker_oauth_sessions`
- `digilocker_kyc_records` (+ verification status columns)
- `digilocker_kyc_audit_logs`

Manual SQL reference: `migrations/20260327_digilocker_ekyc.sql`, `migrations/20261117_digilocker_verification_fields.sql`

## Frontend

- Route: `/onboarding/kyc/digilocker`
- Entry: KYC popup → **e-KYC** / Verify with DigiLocker
- Shows authentication, Aadhaar, PAN, name, DOB, address, overall status
- Calls `POST /api/digilocker/start` → redirect to DigiLocker
- After callback: `GET /api/digilocker/status`

## Admin

- Existing KYC list/detail/approve (`PATCH /api/admin/users/:id/kyc-status`)
- DigiLocker users: `kyc_method=digilocker`, verification checklist + masked IDs (no images)

## Unit tests

```bash
cd money_trend_backend
npm test -- tests/digilocker-pkce.test.js tests/digilocker-id-token.test.js tests/digilocker-config.test.js tests/digilocker-callback-guards.test.js tests/digilocker-verification.test.js
```

## Sandbox testing

1. Set DigiLocker credentials from partner portal (rotated secret).
2. Confirm redirect URI `https://moneytrend.in/api/digilocker/callback`.
3. Set `DIGILOCKER_STUB=false` on the API host that receives DigiLocker callbacks.
4. Restart API (`ensureCoreTables` applies schema).
5. Login → KYC → Verify with DigiLocker → complete consent.
6. Confirm success page checklist + `GET /api/digilocker/status`.
7. Admin KYC panel: approve/reject DigiLocker submissions.
8. Negative: cancel consent, reuse `state`, expire session.

Localhost without DigiLocker callback reachability: keep `DIGILOCKER_STUB=true`.

## Production checklist

- [ ] Rotate `DIGILOCKER_CLIENT_SECRET` if ever shared
- [ ] `DIGILOCKER_AUTHORIZE_URL` = `/oauth2/2/authorize` (MoneyTrend partner default)
- [ ] Register production redirect URI
- [ ] Confirm scopes / ACR for Aadhaar + PAN
- [ ] Obtain JWKS URL → set `DIGILOCKER_JWKS_URL` and enable signature verification
- [ ] `DIGILOCKER_STUB=false` with secret present
- [ ] Strong `PII_ENCRYPTION_KEY`
- [ ] HTTPS + `TRUST_PROXY=1`
- [ ] Rate limits + audit monitoring
- [ ] Legal review of retained fields (last4, masked PAN, metadata)
- [ ] Sandbox UAT sign-off before claiming live eKYC

## Outstanding DigiLocker approvals

1. JWKS (or equivalent) for OpenID `id_token` signature verification.
2. Confirm ACR / document scopes enabled for Aadhaar + PAN pulls.
3. Confirm whether binary document download is permitted (currently metadata + e-Aadhaar XML only).
4. Consent revocation API (`DIGILOCKER_REVOKE_URL`) — not enabled until partner confirms.
5. Address claim/document access — currently marked `pending` until partner grants it.
6. Sandbox test DigiLocker accounts for MoneyTrend UAT.
