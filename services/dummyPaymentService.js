/**
 * Dummy payment gateway for bank / stakeholder demos.
 * Uses fake card numbers only — never charges a real network.
 */

const crypto = require("crypto");
const pool = require("../config/db");
const { creditWallet, ensureWallet } = require("./walletService");
const { writeAuditLog } = require("../utils/audit");

const PURPOSES = ["wallet_deposit", "cibil_report", "fd_invest", "rd_invest"];

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
    wallet_deposit: null, // amount from request
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

  // Any other card succeeds in dummy mode (for flexible demos)
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
      (user_id, purpose, amount, currency, order_id, status, description, meta_json)
     VALUES
      (:userId, :purpose, :amount, :currency, :orderId, 'created', :description, :meta)`,
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
            ? "FD investment payment (demo)"
            : safePurpose === "rd_invest"
              ? "RD investment payment (demo)"
              : "Wallet deposit (demo)"),
      meta: JSON.stringify(meta || {}),
    }
  );

  return {
    payment_id: ins.insertId,
    order_id: orderId,
    purpose: safePurpose,
    amount: payAmount,
    currency,
    status: "created",
    gateway: "dummy",
    mode: "demo",
    demo_note:
      "Dummy payment gateway for bank demonstration. No real money is charged.",
    demo_cards: DEMO_CARDS.map((c) => ({
      brand: c.brand,
      number: c.number,
      cvv: c.cvv,
      expiry: c.expiry,
      result: c.result,
      label: c.label,
    })),
  };
}

async function fulfillPayment(row, { paymentId, authCode, cardMeta }) {
  const meta =
    typeof row.meta_json === "string"
      ? JSON.parse(row.meta_json || "{}")
      : row.meta_json || {};

  let fulfillment = { type: row.purpose };

  if (row.purpose === "wallet_deposit" || row.purpose === "fd_invest" || row.purpose === "rd_invest") {
    await ensureWallet(row.user_id);
    const credit = await creditWallet({
      userId: row.user_id,
      amount: row.amount,
      category: "dummy_payment",
      referenceType: "dummy_payment",
      referenceId: row.id,
      description: `Dummy gateway credit for ${row.purpose} (${paymentId})`,
      meta: {
        order_id: row.order_id,
        payment_id: paymentId,
        purpose: row.purpose,
        card_last4: cardMeta.last4,
      },
    });
    fulfillment = {
      type: row.purpose,
      wallet_credited: Number(row.amount),
      wallet_balance: credit.balance,
      wallet_transaction_id: credit.transaction_id,
      next_step:
        row.purpose === "fd_invest"
          ? "Call POST /api/fd with FD details (wallet already funded)"
          : row.purpose === "rd_invest"
            ? "Call POST /api/market/rd with RD details (wallet already funded)"
            : "Wallet balance updated",
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

  const { paymentId, authCode } = makeIds();
  const fulfillment = await fulfillPayment(row, {
    paymentId,
    authCode,
    cardMeta: evaluated,
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
      card_last4: evaluated.last4,
      paymentId,
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
      brand: evaluated.brand,
      last4: evaluated.last4,
      masked: evaluated.masked,
      holder: String(cardHolder).trim(),
    },
    bank_demo: {
      acquirer: "MoneyTrend Dummy Acquirer",
      response_code: "00",
      response_message: "Approved (dummy)",
      rrn: `DUMMY${authCode}${Date.now().toString().slice(-4)}`,
    },
    fulfillment,
    demo_note: "This is a simulated payment for bank demonstration. No real charge occurred.",
  };
}

async function getDummyPayment(userId, orderId) {
  const [rows] = await pool.query(
    `SELECT id, purpose, amount, currency, order_id, payment_id, status, card_brand, card_last4,
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
    fulfillment:
      typeof row.fulfillment_json === "string"
        ? JSON.parse(row.fulfillment_json || "{}")
        : row.fulfillment_json,
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

function getDummyPaymentConfig() {
  return {
    enabled: isDummyPaymentEnabled(),
    gateway: "dummy",
    mode: "demo",
    currency: "INR",
    purposes: PURPOSES,
    fees: {
      cibil_report: Number(process.env.DUMMY_PAYMENT_CIBIL_FEE || 99),
    },
    demo_cards: DEMO_CARDS,
    demo_note:
      "Use the listed dummy card numbers for bank demos. Payments never hit a live card network.",
  };
}

module.exports = {
  PURPOSES,
  DEMO_CARDS,
  isDummyPaymentEnabled,
  getDummyPaymentConfig,
  createDummyPayment,
  payDummyPayment,
  getDummyPayment,
  hasPaidCibilReport,
  evaluateDummyCard,
};
