# Money Trend — DEMO / UAT Kit (Bank Testing)
# Virtual funds only. No real money, bank, or UPI payouts.

## Prerequisites
- Backend running (`npm start` or PM2)
- MySQL connected (tables auto-migrate on boot)
- `.env`: `DEMO_MODE=true` (default via `DUMMY_PAYMENT_ENABLED=true`)

## Auth
1. Register/login a normal user → JWT
2. Admin login → `POST /api/admin/login` → Admin JWT

Header on all protected routes:
`Authorization: Bearer <token>`

---

## End-to-end DEMO flow (bank UAT)

### 1) Add Demo Money (fast path — recommended for UAT)
```http
POST /api/demo/wallet/add-money
Authorization: Bearer <user_token>
Content-Type: application/json

{ "amount": 10000 }
```
Presets: `1000, 5000, 10000, 25000, 50000, 100000`

Optional card+OTP path (existing, unchanged):
`POST /api/payments/dummy/create` → pay → verify-otp (`OTP: 1234`)

### 2) Check wallet
```http
GET /api/demo/wallet
```
Shows available balance, total added, invested, returns, withdrawn, portfolio value.
Label: **DEMO WALLET — Virtual funds only.**

### 3) List demo products
```http
GET /api/demo/products
```

### 4) Estimate FD
```http
POST /api/demo/fd/estimate
{ "amount": 20000, "interest_rate": 7.5, "tenure_months": 12 }
```

### 5) Invest FD
```http
POST /api/demo/fd
{ "product_code": "DEMO_FD_12", "amount": 5000 }
```
Wallet debited (principal + admin fee). FD status `ACTIVE`. Ref like `FD202609190001`.

### 6) Invest RD
```http
POST /api/demo/rd
{ "product_code": "DEMO_RD_12", "monthly_amount": 2000 }
```
First installment debited. Ref like `RD202609190001`.

### 7) List investments
```http
GET /api/demo/investments
GET /api/demo/investments?type=FD&status=ACTIVE
GET /api/demo/investments/FD/1
```

### 8) Admin — simulate RD installment
```http
POST /api/demo/admin/rd/:id/simulate-installment
Authorization: Bearer <admin_token>
```

### 9) Admin — mark matured (credits wallet once)
```http
POST /api/demo/admin/fd/:id/mature
POST /api/demo/admin/rd/:id/mature
```
Creates `INVESTMENT_RETURN`. Second call fails (duplicate protection).

### 10) Demo withdrawal (no real payout)
```http
POST /api/demo/withdrawals
{
  "amount": 1000,
  "method": "upi",
  "upi_id": "demo@upi"
}
```
Or `"method": "bank"` after `PUT /api/wallet/bank-account`.

Admin process (existing):
```http
PATCH /api/admin/withdrawals/:id
{ "status": "approved" }
{ "status": "paid" }
{ "status": "rejected", "admin_note": "Demo reject" }
```
`paid` = DEMO complete (no NEFT). `rejected`/`failed` refunds wallet.

### 11) Admin overview
```http
GET /api/demo/admin/overview
```

---

## Negative tests (must fail)
| Test | Expected |
|------|----------|
| Invest more than wallet | 400 INSUFFICIENT_BALANCE |
| Withdraw more than wallet | 400 |
| Mature same FD twice | 400 ALREADY_PROCESSED |
| User A access User B investment | 404 / empty |

---

## Dummy card gateway (optional bank demo)
| Card | Result |
|------|--------|
| `4111111111111111` | Success |
| `5555555555554444` | Success |
| `4000000000000002` | Declined |
| OTP | `1234` |

---

## Env
```
DEMO_MODE=true
DUMMY_PAYMENT_ENABLED=true
DUMMY_PAYMENT_OTP=1234
ADMIN_COMMISSION_PERCENT=2.5
PUBLIC_BASE_URL=https://your-api-host
```

## Notes for banks
- All amounts are **virtual**.
- Demo products are **not** real bank deposits.
- Withdrawal “paid” does **not** send money to bank/UPI.
- Existing Razorpay deposit flow is untouched.
- Existing `POST /api/fd` and `POST /api/market/rd` still work (wallet-first).
