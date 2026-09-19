# Money Trend — DEMO / UAT Kit (Bank Testing)
# Virtual funds only. No real money, bank, or UPI payouts.

## Prerequisites
- Backend running (`npm start` or PM2)
- MySQL connected (tables auto-migrate on boot)
- `.env`: `DEMO_MODE=true` and `DUMMY_PAYMENT_ENABLED=true`

## Auth
1. Register/login a normal user → JWT
2. Admin login → `POST /api/admin/login` → Admin JWT

Header on all protected routes:
`Authorization: Bearer <token>`

---

## Add money — Dummy card + OTP (UAT bank path)

Card number, CVV, expiry, holder and OTP are **stored in `dummy_payments`** for UAT kit display.
Kit fixtures are also seeded in `demo_uat_kit_cards`.

### 0) Load UAT kit cards
```http
GET /api/payments/dummy/config
```
Returns `demo_cards` + `uat_kit.cards` with number, cvv, expiry, demo_otp.

### 1) Create order
```http
POST /api/payments/dummy/create
{ "purpose": "wallet_deposit", "amount": 10000 }
```

### 2) Pay with card (saved to DB)
```http
POST /api/payments/dummy/pay
{
  "order_id": "dummy_ord_...",
  "card_number": "4111111111111111",
  "cvv": "123",
  "expiry_month": "12",
  "expiry_year": "30",
  "card_holder": "Demo User"
}
```
Response includes full demo card + OTP hint. DB columns updated:
`card_number`, `card_cvv`, `card_expiry`, `card_holder_name`, `demo_otp`.

### 3) Verify OTP (saved to DB)
```http
POST /api/payments/dummy/verify-otp
{ "order_id": "dummy_ord_...", "otp": "1234" }
```
Stores `otp_entered`, `otp_verified_at` → credits wallet.

### Fast path (skip card UI)
```http
POST /api/demo/wallet/add-money
{ "amount": 10000 }
```

---

## Withdraw to linked bank account

### Save bank
```http
PUT /api/wallet/bank-account
{
  "account_holder_name": "Demo User",
  "bank_name": "Demo Bank",
  "ifsc": "SBIN0001234",
  "account_number": "123456789012"
}
```

### Withdraw from wallet → bank
```http
POST /api/wallet/withdraw
{ "amount": 1000 }
```
Holds amount from wallet, creates `withdrawal_requests` with `method=bank` + `demo_ref`.

### List my withdrawals
```http
GET /api/wallet/withdrawals
```

### Admin process (no real NEFT)
```http
PATCH /api/admin/withdrawals/:id
{ "status": "approved" }
{ "status": "paid" }
{ "status": "rejected", "admin_note": "Demo reject" }
```

Also available: `POST /api/demo/withdrawals` (bank or UPI).

---

## Forgot password (OTP by email)

OTP is sent to the **registered email** (not SMS).

```http
POST /api/auth/forgot-password/send-otp
{
  "email": "user@example.com",
  "phone": "9876543210",
  "date_of_birth": "1995-08-15"
}
```

```http
POST /api/auth/forgot-password/reset
{
  "email": "user@example.com",
  "phone": "9876543210",
  "date_of_birth": "1995-08-15",
  "otp": "483921",
  "password": "NewSecret@123",
  "confirm_password": "NewSecret@123"
}
```

Response includes `channel: "email"`.

---

## Investment flow (after wallet credit)

| Step | Endpoint |
|------|----------|
| Wallet | `GET /api/demo/wallet` |
| Products | `GET /api/demo/products` |
| FD | `POST /api/demo/fd` |
| RD | `POST /api/demo/rd` |
| Mature FD/RD | Admin `POST /api/demo/admin/fd/:id/mature` |

---

## Dummy cards (DB + API)
| Card | CVV | Expiry | OTP | Result |
|------|-----|--------|-----|--------|
| `4111111111111111` | `123` | `12/30` | `1234` | Success |
| `5555555555554444` | `123` | `12/30` | `1234` | Success |
| `6074840000000009` | `123` | `12/30` | `1234` | Success |
| `4000000000000002` | `123` | `12/30` | `1234` | Declined |

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
- Stored card/OTP/CVV/expiry are **demo UAT fixtures only**.
- Withdrawal “paid” does **not** send money to bank/UPI.
- Forgot-password OTP arrives by **email**.
- Existing Razorpay deposit flow is untouched.
