/**
 * Dummy payment gateway for bank / stakeholder demos.
 * Uses fake card numbers + dummy OTP — never charges a real network.
 */

const crypto = require("crypto");
const pool = require("../config/db");
const { creditWallet, ensureWallet } = require("./walletService");
const { writeAuditLog } = require("../utils/audit");

const PURPOSES = ["wallet_deposit", "cibil_report", "fd_invest", "rd_invest"];

/** Fixed bank-demo OTP (shown to banks / frontend) */
const DEMO_OTP = String(process.env.DUMMY_PAYMENT_OTP || "1234");

/** Demo cards shown to banks — success / decline fixtures */
const DEMO_CARDS = [
  {
    brand: "Visa",
    number: "4111111111111111",
    cvv: "123",
    expiry: "12/30",
    result: "success",
    label: "Always succeeds",
  },
  {
    brand: "Mastercard",
    number: "5555555555554444",
    cvv: "123",
    expiry: "12/30",
    result: "success",
    label: "Always succeeds",
  },
  {
    brand: "RuPay (demo)",
    number: "6074840000000009",
    cvv: "123",
    expiry: "12/30",
    result: "success",
    label: "Always succeeds",
  },
  {
    brand: "Visa",
    number: "4000000000000002",
    cvv: "123",
    expiry: "12/30",
    result: "declined",
    label: "Always declined (demo failure)",
  },
];

function isDummyPaymentEnabled() {
  return String(process.env.DUMMY_PAYMENT_ENABLED || "true").toLowerCase() !== "false";
}

function getPurposeAmount(purpose) {
  const map = {
    cibil_report: Number(process.env.DUMMY_PAYMENT_CIBIL_FEE || 99),
    wallet_deposit: null,
    fd_invest: null,
    rd_invest: null,
  };
  return map[purpose];
}

function maskCard(number) {
  const digits = String(number || "").replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function detectBrand(digits) {
  if (/^4/.test(digits)) return "Visa";
  if (/^5[1-5]/.test(digits)) return "Mastercard";
  if (/^6/.test(digits)) return "RuPay/Discover";
  return "Card";
}

function luhnOk(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function evaluateDummyCard({ number, cvv, expiryMonth, expiryYear, cardHolder }) {
  const digits = String(number || "").replace(/\D/g, "");
  const cvvClean = String(cvv || "").replace(/\D/g, "");
  const mm = String(expiryMonth || "").padStart(2, "0");
  const yy = String(expiryYear || "").replace(/^20/, "").slice(-2);

  if (!cardHolder || String(cardHolder).trim().length < 2) {
    return { ok: false, code: "INVALID_CARDHOLDER", message: "Card holder name is required" };
  }
  if (digits.length < 13 || digits.length > 19) {
    return { ok: false, code: "INVALID_CARD_NUMBER", message: "Enter a valid dummy card number" };
  }
  if (!luhnOk(digits) && String(process.env.DUMMY_PAYMENT_STRICT_LUNH || "false").toLowerCase() === "true") {
    return { ok: false, code: "INVALID_CARD_NUMBER", message: "Invalid card number checksum" };
  }
  if (cvvClean.length < 3 || cvvClean.length > 4) {
    return { ok: false, code: "INVALID_CVV", message: "Invalid CVV" };
  }
  if (!/^(0[1-9]|1[0-2])$/.test(mm) || !/^\d{2}$/.test(yy)) {
    return { ok: false, code: "INVALID_EXPIRY", message: "Invalid expiry (MM / YY)" };
  }

  const fixture = DEMO_CARDS.find((c) => c.number === digits);
  if (fixture?.result === "declined") {
    return {
      ok: false,
      code: "CARD_DECLINED",
      message: "Dummy bank declined this card (demo failure card)",
      brand: fixture.brand,
    };
  }

  return {
    ok: true,
    brand: fixture?.brand || detectBrand(digits),
    last4: digits.slice(-4),
    masked: maskCard(digits),
  };
}

function makeIds() {
  const orderId = `dummy_ord_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const paymentId = `dummy_pay_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const authCode = String(Math.floor(100000 + Math.random() * 900000));
  return { orderId, paymentId, authCode };
}

function getDemoOtpInfo() {
  return {
    otp_required: true,
    demo_otp: DEMO_OTP,
    otp_length: DEMO_OTP.length,
    otp_hint: `Enter dummy OTP ${DEMO_OTP} for bank demo (no SMS is sent)`,
    verify_endpoint: "POST /api/payments/dummy/verify-otp",
  };
}

async function loadUatKitCardsFromDb() {
  try {
    const [rows] = await pool.query(
      `SELECT brand, card_number AS number, cvv, expiry, result, label, demo_otp
       FROM demo_uat_kit_cards
       WHERE is_active = 1
       ORDER BY id ASC`
    );
    if (rows.length) {
      return rows.map((r) => ({
        brand: r.brand,
        number: r.number,
        cvv: r.cvv,
        expiry: r.expiry,
        result: r.result,
        label: r.label,
        demo_otp: r.demo_otp || DEMO_OTP,
      }));
    }
  } catch (_e) {
    /* table may not exist yet on first boot */
  }
  return DEMO_CARDS.map((c) => ({ ...c, demo_otp: DEMO_OTP }));
}

function buildStoredCardPayload(row) {
  if (!row) return null;
  const expiry = row.card_expiry || null;
  return {
    brand: row.card_brand || null,
    number: row.card_number || null,
    last4: row.card_last4 || null,
    masked: row.card_last4 ? `************${row.card_last4}` : null,
    cvv: row.card_cvv || null,
    expiry,
    holder: row.card_holder_name || null,
    demo_otp: row.demo_otp || DEMO_OTP,
    otp_entered: row.otp_entered || null,
    otp_verified_at: row.otp_verified_at || null,
    uat_note: "DEMO UAT — stored test card/OTP for bank kit display. Not a real card.",
  };
}

async function createDummyPayment({
  userId,
  purpose,
  amount,
  currency = "INR",
  meta = {},
  description = null,
}) {
  if (!isDummyPaymentEnabled()) {
    const err = new Error("Dummy payment gateway is disabled");
    err.code = "DUMMY_PAYMENT_DISABLED";
    err.status = 503;
    throw err;
  }

  const safePurpose = String(purpose || "").toLowerCase();
  if (!PURPOSES.includes(safePurpose)) {
    const err = new Error(`Invalid purpose. Allowed: ${PURPOSES.join(", ")}`);
    err.code = "VALIDATION_ERROR";
    err.status = 400;
    throw err;
  }

  let payAmount = Number(amount);
  const fixed = getPurposeAmount(safePurpose);
  if (fixed != null && Number.isFinite(fixed)) {
    payAmount = fixed;
  }

  if (!payAmount || payAmount < 1) {
    const err = new Error("amount must be at least ₹1");
    err.code = "VALIDATION_ERROR";
    err.status = 400;
    throw err;
  }
  if (payAmount > 500000) {
    const err = new Error("Dummy payment limited to ₹5,00,000 per transaction");
    err.code = "VALIDATION_ERROR";
    err.status = 400;
    throw err;
  }

  const { orderId } = makeIds();
  const [ins] = await pool.query(
    `INSERT INTO dummy_payments
      (user_id, purpose, amount, currency, order_id, status, description, meta_json, demo_otp)
     VALUES
      (:userId, :purpose, :amount, :currency, :orderId, 'created', :description, :meta, :demoOtp)`,
    {
      userId,
      purpose: safePurpose,
      amount: payAmount,
      currency,
      orderId,
      description:
        description ||
        (safePurpose === "cibil_report"
          ? "CIBIL / credit report download fee (demo)"
          : safePurpose === "fd_invest"
            ? "Wallet top-up for FD (demo) — invest separately"
            : safePurpose === "rd_invest"
              ? "Wallet top-up for RD (demo) — invest separately"
              : "Wallet deposit (demo)"),
      meta: JSON.stringify(meta || {}),
      demoOtp: DEMO_OTP,
    }
  );

  const uatCards = await loadUatKitCardsFromDb();

  return {
    payment_id: ins.insertId,
    order_id: orderId,
    purpose: safePurpose,
    amount: payAmount,
    currency,
    status: "created",
    gateway: "dummy",
    mode: "demo",
    next_step: "POST /api/payments/dummy/pay with card details, then verify OTP",
    demo_note:
      "Dummy payment gateway for bank demonstration. No real money is charged. Card/OTP/CVV/expiry are stored for UAT kit display only.",
    demo_cards: uatCards,
    otp: getDemoOtpInfo(),
  };
}

async function fulfillPayment(row, { paymentId, authCode, cardMeta }) {
  let fulfillment = { type: row.purpose };

  if (row.purpose === "wallet_deposit" || row.purpose === "fd_invest" || row.purpose === "rd_invest") {
    await ensureWallet(row.user_id);
    // Payment NEVER creates an FD/RD — it only credits the wallet.
    // User must call POST /api/fd or POST /api/market/rd to invest (debit wallet).
    const credit = await creditWallet({
      userId: row.user_id,
      amount: row.amount,
      category: "wallet_deposit",
      referenceType: "dummy_payment",
      referenceId: row.id,
      description: `Wallet top-up via dummy payment (${row.purpose}) — not invested yet`,
      meta: {
        order_id: row.order_id,
        payment_id: paymentId,
        purpose: row.purpose,
        card_last4: cardMeta.last4,
        invested: false,
        note: "Funds sit in wallet until user presses Invest",
      },
    });
    fulfillment = {
      type: "wallet_credit_only",
      purpose: row.purpose,
      invested: false,
      wallet_credited: Number(row.amount),
      wallet_balance: credit.balance,
      wallet_transaction_id: credit.transaction_id,
      message:
        "Money added to wallet only. It is NOT invested yet. Call the invest API to deduct from wallet.",
      next_step:
        row.purpose === "rd_invest" || row.purpose === "wallet_deposit"
          ? "Retry invest: POST /api/fd or POST /api/market/rd (deducts wallet)"
          : "Retry invest: POST /api/fd (deducts wallet)",
    };
  } else if (row.purpose === "cibil_report") {
    fulfillment = {
      type: "cibil_report",
      report_unlocked: true,
      unlock_expires_at: null,
      next_step: "Download via GET /api/credit-check/report/latest or /api/credit-check/:id/report",
    };
  }

  await pool.query(
    `UPDATE dummy_payments
     SET status = 'paid',
         payment_id = :paymentId,
         auth_code = :authCode,
         card_brand = :brand,
         card_last4 = :last4,
         paid_at = NOW(),
         fulfillment_json = :fulfillment
     WHERE id = :id`,
    {
      paymentId,
      authCode,
      brand: cardMeta.brand,
      last4: cardMeta.last4,
      fulfillment: JSON.stringify(fulfillment),
      id: row.id,
    }
  );

  return fulfillment;
}

/**
 * Step 1: submit card → moves order to otp_pending (bank OTP screen).
 */
async function payDummyPayment({
  userId,
  orderId,
  cardNumber,
  cvv,
  expiryMonth,
  expiryYear,
  cardHolder,
  ipAddress,
  userAgent,
}) {
  if (!isDummyPaymentEnabled()) {
    const err = new Error("Dummy payment gateway is disabled");
    err.code = "DUMMY_PAYMENT_DISABLED";
    err.status = 503;
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT * FROM dummy_payments WHERE order_id = :orderId AND user_id = :userId LIMIT 1`,
    { orderId, userId }
  );
  if (!rows.length) {
    const err = new Error("Dummy payment order not found");
    err.code = "NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const row = rows[0];
  if (row.status === "paid") {
    return {
      already_paid: true,
      order_id: row.order_id,
      payment_id: row.payment_id,
      status: "paid",
      amount: Number(row.amount),
      purpose: row.purpose,
      fulfillment:
        typeof row.fulfillment_json === "string"
          ? JSON.parse(row.fulfillment_json || "{}")
          : row.fulfillment_json,
    };
  }

  if (row.status === "otp_pending") {
    return {
      already_paid: false,
      gateway: "dummy",
      mode: "demo",
      order_id: row.order_id,
      status: "otp_pending",
      amount: Number(row.amount),
      currency: row.currency,
      purpose: row.purpose,
      card: buildStoredCardPayload(row),
      otp: getDemoOtpInfo(),
      next_step: "Enter dummy OTP and call POST /api/payments/dummy/verify-otp",
      demo_note: `Bank OTP screen — use OTP ${DEMO_OTP}`,
    };
  }

  const evaluated = evaluateDummyCard({
    number: cardNumber,
    cvv,
    expiryMonth,
    expiryYear,
    cardHolder,
  });

  if (!evaluated.ok) {
    await pool.query(
      `UPDATE dummy_payments SET status = 'failed', failure_code = :code, failure_message = :msg WHERE id = :id`,
      { code: evaluated.code, msg: evaluated.message, id: row.id }
    );
    const err = new Error(evaluated.message);
    err.code = evaluated.code;
    err.status = 402;
    throw err;
  }

  const digits = String(cardNumber || "").replace(/\D/g, "");
  const cvvClean = String(cvv || "").replace(/\D/g, "");
  const mm = String(expiryMonth || "").padStart(2, "0");
  const yy = String(expiryYear || "").replace(/^20/, "").slice(-2);
  const expiry = `${mm}/${yy}`;
  const holder = String(cardHolder).trim();

  const existingMeta =
    typeof row.meta_json === "string"
      ? JSON.parse(row.meta_json || "{}")
      : row.meta_json || {};

  const otpMeta = {
    ...existingMeta,
    card_holder: holder,
    card_brand: evaluated.brand,
    card_last4: evaluated.last4,
    card_masked: evaluated.masked,
    card_number: digits,
    card_cvv: cvvClean,
    card_expiry: expiry,
    demo_otp: DEMO_OTP,
    otp_pending_at: new Date().toISOString(),
    uat_stored: true,
  };

  await pool.query(
    `UPDATE dummy_payments
     SET status = 'otp_pending',
         card_brand = :brand,
         card_last4 = :last4,
         card_number = :cardNumber,
         card_cvv = :cardCvv,
         card_expiry = :cardExpiry,
         card_holder_name = :holder,
         demo_otp = :demoOtp,
         meta_json = :meta,
         failure_code = NULL,
         failure_message = NULL
     WHERE id = :id`,
    {
      brand: evaluated.brand,
      last4: evaluated.last4,
      cardNumber: digits,
      cardCvv: cvvClean,
      cardExpiry: expiry,
      holder,
      demoOtp: DEMO_OTP,
      meta: JSON.stringify(otpMeta),
      id: row.id,
    }
  );

  await writeAuditLog({
    userId,
    action: "DUMMY_PAYMENT_OTP_SENT",
    entityType: "dummy_payment",
    entityId: row.id,
    ipAddress,
    userAgent,
    meta: {
      purpose: row.purpose,
      amount: row.amount,
      card_last4: evaluated.last4,
      demo_otp: DEMO_OTP,
      uat_card_stored: true,
    },
  });

  return {
    already_paid: false,
    gateway: "dummy",
    mode: "demo",
    order_id: row.order_id,
    status: "otp_pending",
    amount: Number(row.amount),
    currency: row.currency,
    purpose: row.purpose,
    card: {
      brand: evaluated.brand,
      number: digits,
      last4: evaluated.last4,
      masked: evaluated.masked,
      cvv: cvvClean,
      expiry,
      holder,
      demo_otp: DEMO_OTP,
      uat_note: "DEMO UAT — card/OTP/CVV/expiry saved for bank kit display.",
    },
    otp: getDemoOtpInfo(),
    next_step: "Show OTP screen, then POST /api/payments/dummy/verify-otp",
    bank_demo: {
      acquirer: "MoneyTrend Dummy Acquirer",
      response_code: "OTP_REQUIRED",
      response_message: "Enter OTP sent to registered mobile (demo)",
    },
    demo_note: `Card accepted and stored for UAT. Enter dummy OTP ${DEMO_OTP} to complete payment. No real SMS is sent.`,
  };
}

/**
 * Step 2: verify dummy OTP → marks paid + fulfills wallet/cibil.
 */
async function verifyDummyOtp({
  userId,
  orderId,
  otp,
  ipAddress,
  userAgent,
}) {
  if (!isDummyPaymentEnabled()) {
    const err = new Error("Dummy payment gateway is disabled");
    err.code = "DUMMY_PAYMENT_DISABLED";
    err.status = 503;
    throw err;
  }

  const otpClean = String(otp || "").replace(/\s+/g, "").trim();
  if (!otpClean) {
    const err = new Error("OTP is required");
    err.code = "OTP_REQUIRED";
    err.status = 400;
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT * FROM dummy_payments WHERE order_id = :orderId AND user_id = :userId LIMIT 1`,
    { orderId, userId }
  );
  if (!rows.length) {
    const err = new Error("Dummy payment order not found");
    err.code = "NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const row = rows[0];
  if (row.status === "paid") {
    return {
      already_paid: true,
      order_id: row.order_id,
      payment_id: row.payment_id,
      status: "paid",
      amount: Number(row.amount),
      purpose: row.purpose,
      fulfillment:
        typeof row.fulfillment_json === "string"
          ? JSON.parse(row.fulfillment_json || "{}")
          : row.fulfillment_json,
    };
  }

  if (row.status !== "otp_pending") {
    const err = new Error("Submit card details first via POST /api/payments/dummy/pay");
    err.code = "CARD_STEP_REQUIRED";
    err.status = 400;
    throw err;
  }

  if (otpClean !== DEMO_OTP) {
    await pool.query(
      `UPDATE dummy_payments
       SET failure_code = 'INVALID_OTP',
           failure_message = 'Invalid dummy OTP',
           otp_entered = :otpEntered
       WHERE id = :id`,
      { id: row.id, otpEntered: otpClean }
    );
    const err = new Error(`Invalid OTP. For bank demo use ${DEMO_OTP}`);
    err.code = "INVALID_OTP";
    err.status = 402;
    throw err;
  }

  const meta =
    typeof row.meta_json === "string"
      ? JSON.parse(row.meta_json || "{}")
      : row.meta_json || {};

  const cardMeta = {
    brand: row.card_brand || meta.card_brand || "Card",
    last4: row.card_last4 || meta.card_last4 || "0000",
    masked: meta.card_masked || (row.card_last4 ? `************${row.card_last4}` : "****"),
  };

  await pool.query(
    `UPDATE dummy_payments
     SET otp_entered = :otpEntered,
         otp_verified_at = NOW(),
         demo_otp = :demoOtp
     WHERE id = :id`,
    { otpEntered: otpClean, demoOtp: DEMO_OTP, id: row.id }
  );

  const { paymentId, authCode } = makeIds();
  const fulfillment = await fulfillPayment(row, {
    paymentId,
    authCode,
    cardMeta,
  });

  await writeAuditLog({
    userId,
    action: "DUMMY_PAYMENT_PAID",
    entityType: "dummy_payment",
    entityId: row.id,
    ipAddress,
    userAgent,
    meta: {
      purpose: row.purpose,
      amount: row.amount,
      card_last4: cardMeta.last4,
      paymentId,
      otp_verified: true,
      otp_entered: otpClean,
    },
  });

  return {
    already_paid: false,
    gateway: "dummy",
    mode: "demo",
    order_id: row.order_id,
    payment_id: paymentId,
    auth_code: authCode,
    status: "paid",
    amount: Number(row.amount),
    currency: row.currency,
    purpose: row.purpose,
    card: {
      brand: cardMeta.brand,
      number: row.card_number || meta.card_number || null,
      last4: cardMeta.last4,
      masked: cardMeta.masked,
      cvv: row.card_cvv || meta.card_cvv || null,
      expiry: row.card_expiry || meta.card_expiry || null,
      holder: row.card_holder_name || meta.card_holder || null,
      demo_otp: DEMO_OTP,
      otp_entered: otpClean,
      uat_note: "DEMO UAT — payment card/OTP recorded for bank kit.",
    },
    otp_verified: true,
    bank_demo: {
      acquirer: "MoneyTrend Dummy Acquirer",
      response_code: "00",
      response_message: "Approved after OTP (dummy)",
      rrn: `DUMMY${authCode}${Date.now().toString().slice(-4)}`,
    },
    fulfillment,
    demo_note: "OTP verified. Simulated payment complete — no real charge occurred.",
  };
}

async function getDummyPayment(userId, orderId) {
  const [rows] = await pool.query(
    `SELECT id, purpose, amount, currency, order_id, payment_id, status,
            card_brand, card_last4, card_number, card_cvv, card_expiry, card_holder_name,
            demo_otp, otp_entered, otp_verified_at,
            auth_code, description, fulfillment_json, failure_code, failure_message, created_at, paid_at
     FROM dummy_payments
     WHERE order_id = :orderId AND user_id = :userId
     LIMIT 1`,
    { orderId, userId }
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...row,
    amount: Number(row.amount),
    card: buildStoredCardPayload(row),
    fulfillment:
      typeof row.fulfillment_json === "string"
        ? JSON.parse(row.fulfillment_json || "{}")
        : row.fulfillment_json,
    otp: row.status === "otp_pending" ? getDemoOtpInfo() : undefined,
  };
}

async function hasPaidCibilReport(userId) {
  const [rows] = await pool.query(
    `SELECT id FROM dummy_payments
     WHERE user_id = :userId AND purpose = 'cibil_report' AND status = 'paid'
     ORDER BY id DESC LIMIT 1`,
    { userId }
  );
  return rows.length > 0;
}

async function getDummyPaymentConfig() {
  const uatCards = await loadUatKitCardsFromDb();
  return {
    enabled: isDummyPaymentEnabled(),
    gateway: "dummy",
    mode: "demo",
    currency: "INR",
    purposes: PURPOSES,
    fees: {
      cibil_report: Number(process.env.DUMMY_PAYMENT_CIBIL_FEE || 99),
    },
    demo_cards: uatCards,
    uat_kit: {
      source: "demo_uat_kit_cards",
      note: "DEMO UAT kit credentials from database. Use these card numbers, CVV, expiry and OTP for bank testing.",
      cards: uatCards,
      demo_otp: DEMO_OTP,
    },
    otp: getDemoOtpInfo(),
    flow: [
      "1. POST /api/payments/dummy/create { purpose: wallet_deposit, amount }",
      "2. POST /api/payments/dummy/pay (card_number, cvv, expiry_month, expiry_year, card_holder)",
      `3. POST /api/payments/dummy/verify-otp with otp=${DEMO_OTP}`,
      "4. Wallet credited — then invest via POST /api/demo/fd or /api/fd",
    ],
    demo_note:
      "Use dummy cards, then enter OTP 1234 on the bank OTP screen. Card/CVV/expiry/OTP are stored in DB for UAT display. No real SMS or charge.",
  };
}

module.exports = {
  PURPOSES,
  DEMO_CARDS,
  DEMO_OTP,
  isDummyPaymentEnabled,
  getDummyPaymentConfig,
  createDummyPayment,
  payDummyPayment,
  verifyDummyOtp,
  getDummyPayment,
  hasPaidCibilReport,
  evaluateDummyCard,
  loadUatKitCardsFromDb,
};
