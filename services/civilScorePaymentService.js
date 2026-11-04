const crypto = require("crypto");
const Razorpay = require("razorpay");
const pool = require("../config/db");

const EXPECTED_AMOUNT_PAISA = 9900;
const EXPECTED_CURRENCY = "INR";

function getRazorpayEnv() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !keySecret) {
    const err = new Error(
      "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env"
    );
    err.code = "RAZORPAY_NOT_CONFIGURED";
    err.status = 503;
    throw err;
  }
  return {
    keyId,
    keySecret,
    webhookSecret,
    client: new Razorpay({ key_id: keyId, key_secret: keySecret }),
  };
}

function getExpectedOrderAmount() {
  return Number(process.env.CIBIL_REPORT_AMOUNT_PAISA || EXPECTED_AMOUNT_PAISA);
}

function verifySignature({ orderId, paymentId, signature, secret }) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac("sha256", secret || "")
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const actual = String(signature).trim();
  if (expected.length !== actual.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  } catch (_error) {
    return expected === actual;
  }
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = String(signature).trim();
  if (!/^[a-f\d]{64}$/i.test(actual) || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

async function findOwnershipCheck({ userId, reportRefId = null, checkId = null }) {
  const clauses = [];
  const params = { userId };

  if (checkId) {
    clauses.push("id = :checkId");
    params.checkId = Number(checkId);
  }
  if (reportRefId) {
    clauses.push("report_ref_id = :reportRefId");
    params.reportRefId = String(reportRefId).trim();
  }

  if (!clauses.length) {
    const err = new Error("report_ref or check_id is required");
    err.code = "VALIDATION_ERROR";
    err.status = 400;
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT id, user_id, report_ref_id, bureau, status, score
     FROM credit_checks
     WHERE user_id = :userId AND (${clauses.join(" AND ")})
     ORDER BY id DESC LIMIT 1`,
    params
  );

  if (!rows.length) {
    const err = new Error("This report does not belong to the current user");
    err.code = "REPORT_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const row = rows[0];
  if (Number(row.user_id) !== Number(userId)) {
    const err = new Error("Access denied for this report");
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }

  return row;
}

async function getLatestUserPayment(userId, reportRefId) {
  const [rows] = await pool.query(
    `SELECT *
     FROM civil_score_payments
     WHERE user_id = :userId AND report_ref = :reportRef
     ORDER BY id DESC LIMIT 1`,
    { userId, reportRef: String(reportRefId || "").trim() }
  );
  return rows[0] || null;
}

async function createCivilScoreOrder({ userId, checkId = null, reportRefId = null }) {
  const { keyId, client } = getRazorpayEnv();
  const check = await findOwnershipCheck({ userId, reportRefId, checkId });
  const reportRef = String(check.report_ref_id || reportRefId || check.id || "civil-report").trim();
  const amountPaise = getExpectedOrderAmount();
  const existingPayment = await getLatestUserPayment(userId, reportRef);
  if (
    existingPayment &&
    existingPayment.payment_status === "success" &&
    existingPayment.verification_status === "verified"
  ) {
    const err = new Error("This report has already been unlocked");
    err.code = "REPORT_ALREADY_UNLOCKED";
    err.status = 409;
    throw err;
  }

  const [inserted] = await pool.query(
    `INSERT INTO civil_score_payments
      (user_id, report_ref, provider, amount_paise, currency, payment_status, verification_status, failure_reason)
     VALUES
      (:userId, :reportRef, 'TransUnion CIBIL', :amountPaise, :currency, 'created', 'pending', NULL)`,
    {
      userId,
      reportRef,
      amountPaise,
      currency: EXPECTED_CURRENCY,
    }
  );

  const receipt = `cibil_${userId}_${inserted.insertId}`;
  const order = await client.orders.create({
    amount: amountPaise,
    currency: EXPECTED_CURRENCY,
    receipt: String(receipt).slice(0, 40),
    notes: {
      user_id: String(userId),
      report_ref: reportRef,
      purpose: "cibil_report_unlock",
      check_id: String(check.id),
      provider: "TransUnion CIBIL",
    },
    payment_capture: 1,
  });

  await pool.query(
    `UPDATE civil_score_payments
     SET razorpay_order_id = :orderId,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = :id`,
    { orderId: order.id, id: inserted.insertId }
  );

  return {
    payment_id: inserted.insertId,
    order_id: order.id,
    amount: amountPaise,
    currency: EXPECTED_CURRENCY,
    key_id: keyId,
    report_ref: reportRef,
    receipt: order.receipt,
    provider: "TransUnion CIBIL",
  };
}

async function createCivilScoreQr({ userId, checkId = null, reportRefId = null }) {
  const { client } = getRazorpayEnv();
  const check = await findOwnershipCheck({ userId, reportRefId, checkId });
  const reportRef = String(check.report_ref_id || reportRefId || check.id || "civil-report").trim();
  const amountPaise = getExpectedOrderAmount();
  const existingPayment = await getLatestUserPayment(userId, reportRef);
  if (
    existingPayment &&
    existingPayment.payment_status === "success" &&
    existingPayment.verification_status === "verified"
  ) {
    const err = new Error("This report has already been unlocked");
    err.code = "REPORT_ALREADY_UNLOCKED";
    err.status = 409;
    throw err;
  }

  const [activeRows] = await pool.query(
    `SELECT id, amount_paise, currency, razorpay_qr_code_id, qr_code_image_url, qr_code_expires_at
     FROM civil_score_payments
     WHERE user_id = :userId AND report_ref = :reportRef
       AND payment_status IN ('created', 'pending')
       AND razorpay_qr_code_id IS NOT NULL
       AND qr_code_expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    { userId, reportRef }
  );
  if (activeRows.length) {
    const active = activeRows[0];
    return {
      payment_id: active.id,
      qr_code_id: active.razorpay_qr_code_id,
      image_url: active.qr_code_image_url,
      amount: Number(active.amount_paise),
      currency: active.currency,
      expires_at: new Date(active.qr_code_expires_at).toISOString(),
    };
  }

  const [inserted] = await pool.query(
    `INSERT INTO civil_score_payments
      (user_id, report_ref, provider, amount_paise, currency, payment_status, verification_status, failure_reason)
     VALUES
      (:userId, :reportRef, 'TransUnion CIBIL', :amountPaise, :currency, 'created', 'pending', NULL)`,
    { userId, reportRef, amountPaise, currency: EXPECTED_CURRENCY }
  );

  const closeBy = Math.floor(Date.now() / 1000) + 15 * 60;
  try {
    const qrCode = await client.qrCode.create({
      type: "upi_qr",
      name: "CIBIL Report Payment",
      usage: "single_use",
      fixed_amount: true,
      payment_amount: amountPaise,
      description: "MoneyTrend CIBIL report unlock",
      close_by: closeBy,
      notes: {
        purpose: "cibil_report_unlock",
        civil_score_payment_id: String(inserted.insertId),
        report_ref: reportRef,
      },
    });

    await pool.query(
      `UPDATE civil_score_payments
       SET razorpay_qr_code_id = :qrCodeId,
           qr_code_image_url = :imageUrl,
           qr_code_expires_at = FROM_UNIXTIME(:closeBy),
           payment_status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      {
        qrCodeId: qrCode.id,
        imageUrl: qrCode.image_url,
        closeBy,
        id: inserted.insertId,
      }
    );

    return {
      payment_id: inserted.insertId,
      qr_code_id: qrCode.id,
      image_url: qrCode.image_url,
      amount: amountPaise,
      currency: EXPECTED_CURRENCY,
      expires_at: new Date(closeBy * 1000).toISOString(),
    };
  } catch (error) {
    await pool.query(
      `UPDATE civil_score_payments
       SET payment_status = 'failed', verification_status = 'rejected',
           failure_reason = :reason, updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { reason: error?.error?.description || error.message || "QR creation failed", id: inserted.insertId }
    );
    throw error;
  }
}

async function getCivilScoreQrStatus({ userId, paymentId }) {
  const [rows] = await pool.query(
    `SELECT id, amount_paise, currency, payment_status, verification_status,
            razorpay_qr_code_id, qr_code_expires_at
     FROM civil_score_payments
     WHERE id = :paymentId AND user_id = :userId
     LIMIT 1`,
    { paymentId: Number(paymentId), userId }
  );
  if (!rows.length || !rows[0].razorpay_qr_code_id) {
    const err = new Error("QR payment was not found");
    err.code = "QR_PAYMENT_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const payment = rows[0];
  if (payment.payment_status === "success" && payment.verification_status === "verified") {
    return { payment_id: payment.id, status: "paid", paid: true };
  }

  const { client } = getRazorpayEnv();
  const result = await client.qrCode.fetchAllPayments(payment.razorpay_qr_code_id, { count: 100 });
  const capturedPayment = (result.items || []).find(
    (item) =>
      String(item.status || "").toLowerCase() === "captured" &&
      Number(item.amount) === Number(payment.amount_paise) &&
      String(item.currency || "").toUpperCase() === String(payment.currency).toUpperCase()
  );

  if (capturedPayment) {
    await pool.query(
      `UPDATE civil_score_payments
       SET razorpay_payment_id = :razorpayPaymentId,
           payment_status = 'success', verification_status = 'verified',
           verified_at = NOW(), failure_reason = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { razorpayPaymentId: capturedPayment.id, id: payment.id }
    );
    return { payment_id: payment.id, status: "paid", paid: true };
  }

  const expired = payment.qr_code_expires_at && new Date(payment.qr_code_expires_at).getTime() <= Date.now();
  if (expired) {
    await pool.query(
      `UPDATE civil_score_payments
       SET payment_status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE id = :id AND payment_status IN ('created', 'pending')`,
      { id: payment.id }
    );
  }
  return { payment_id: payment.id, status: expired ? "expired" : "pending", paid: false };
}

async function finalizePaymentStatus({ orderId, paymentId, signature, userId, reportRefId = null }) {
  const { keySecret } = getRazorpayEnv();
  if (!verifySignature({ orderId, paymentId, signature, secret: keySecret })) {
    const err = new Error("Invalid Razorpay payment signature");
    err.code = "INVALID_SIGNATURE";
    err.status = 400;
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT *
     FROM civil_score_payments
     WHERE razorpay_order_id = :orderId
     ORDER BY id DESC LIMIT 1`,
    { orderId }
  );

  if (!rows.length) {
    const err = new Error("Payment order not found");
    err.code = "ORDER_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const row = rows[0];
  if (Number(row.user_id) !== Number(userId)) {
    const err = new Error("This payment does not belong to the current user");
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }

  if (reportRefId && String(row.report_ref || "").trim() !== String(reportRefId).trim()) {
    const err = new Error("Payment does not match the selected report");
    err.code = "REPORT_MISMATCH";
    err.status = 403;
    throw err;
  }

  const { client } = getRazorpayEnv();
  const razorpayPayment = await client.payments.fetch(paymentId);

  if (String(razorpayPayment.order_id || "") !== String(orderId)) {
    const err = new Error("Payment order mismatch");
    err.code = "ORDER_MISMATCH";
    err.status = 400;
    throw err;
  }
  if (Number(razorpayPayment.amount || 0) !== getExpectedOrderAmount()) {
    const err = new Error("Unexpected payment amount");
    err.code = "INVALID_AMOUNT";
    err.status = 400;
    throw err;
  }
  if (String(razorpayPayment.currency || "").toUpperCase() !== EXPECTED_CURRENCY) {
    const err = new Error("Unexpected payment currency");
    err.code = "INVALID_CURRENCY";
    err.status = 400;
    throw err;
  }

  if (String(razorpayPayment.status || "").toLowerCase() === "captured") {
    await pool.query(
      `UPDATE civil_score_payments
       SET razorpay_payment_id = :paymentId,
           razorpay_signature = :signature,
           payment_status = 'success',
           verification_status = 'verified',
           verified_by = :userId,
           verified_at = NOW(),
           failure_reason = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { paymentId, signature, userId, id: row.id }
    );
    return {
      success: true,
      payment_status: "success",
      verification_status: "verified",
      order_id: orderId,
      payment_id: paymentId,
      amount: Number(razorpayPayment.amount || getExpectedOrderAmount()),
      currency: EXPECTED_CURRENCY,
      report_ref: row.report_ref,
      provider: row.provider,
      message: "Payment verified and report unlocked.",
      already_verified: row.payment_status === "success" && row.verification_status === "verified",
    };
  }

  if (String(razorpayPayment.status || "").toLowerCase() === "authorized") {
    await pool.query(
      `UPDATE civil_score_payments
       SET razorpay_payment_id = :paymentId,
           razorpay_signature = :signature,
           payment_status = 'authorized',
           verification_status = 'pending',
           failure_reason = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { paymentId, signature, id: row.id }
    );
    return {
      success: false,
      payment_status: "authorized",
      verification_status: "pending",
      message: "Payment is authorized but not yet captured. The report remains locked until capture is confirmed.",
    };
  }

  const failureReason = razorpayPayment.error_description || razorpayPayment.status || "Payment failed";
  await pool.query(
    `UPDATE civil_score_payments
     SET razorpay_payment_id = :paymentId,
         razorpay_signature = :signature,
         payment_status = :paymentStatus,
         verification_status = 'rejected',
         failure_reason = :failureReason,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = :id`,
    {
      paymentId,
      signature,
      paymentStatus: String(razorpayPayment.status || "failed").toLowerCase(),
      failureReason,
      id: row.id,
    }
  );

  return {
    success: false,
    payment_status: String(razorpayPayment.status || "failed").toLowerCase(),
    verification_status: "rejected",
    message: "Payment was not captured. The report remains locked.",
  };
}

async function getCivilScoreUnlockStatus({ userId, reportRefId = null, checkId = null }) {
  const check = await findOwnershipCheck({ userId, reportRefId, checkId });
  const [rows] = await pool.query(
    `SELECT *
     FROM civil_score_payments
     WHERE user_id = :userId AND report_ref = :reportRef
     ORDER BY id DESC LIMIT 1`,
    { userId, reportRef: String(check.report_ref_id || reportRefId || check.id) }
  );

  const payment = rows[0];
  const unlocked = Boolean(
    payment && payment.payment_status === "success" && payment.verification_status === "verified"
  );

  return {
    unlocked,
    report_ref: String(check.report_ref_id || reportRefId || check.id),
    payment_status: payment?.payment_status || "none",
    verification_status: payment?.verification_status || "pending",
    amount_paise: Number(payment?.amount_paise || 9900),
    currency: payment?.currency || EXPECTED_CURRENCY,
    razorpay_order_id: payment?.razorpay_order_id || null,
    razorpay_payment_id: payment?.razorpay_payment_id || null,
    message: payment ? payment.failure_reason || null : null,
  };
}

async function ensureUnlockedReportAccess({ userId, reportRefId = null, checkId = null }) {
  const status = await getCivilScoreUnlockStatus({ userId, reportRefId, checkId });
  if (!status.unlocked) {
    const err = new Error("Payment verification is required to unlock this report");
    err.code = "PAYMENT_REQUIRED";
    err.status = 402;
    throw err;
  }
  return status;
}

async function recordDownload({ userId, reportRefId = null, checkId = null }) {
  const check = await findOwnershipCheck({ userId, reportRefId, checkId });
  const reportRef = String(check.report_ref_id || reportRefId || check.id).trim();
  const [rows] = await pool.query(
    `SELECT *
     FROM civil_score_payments
     WHERE user_id = :userId AND report_ref = :reportRef
       AND payment_status = 'success' AND verification_status = 'verified'
     ORDER BY id DESC LIMIT 1`,
    { userId, reportRef }
  );

  if (!rows.length) {
    const err = new Error("Payment verification is required before downloading this report");
    err.code = "PAYMENT_REQUIRED";
    err.status = 402;
    throw err;
  }

  const payment = rows[0];
  await pool.query(
    `UPDATE civil_score_payments
     SET report_downloaded = 1,
         download_count = IFNULL(download_count, 0) + 1,
         first_downloaded_at = COALESCE(first_downloaded_at, NOW()),
         last_downloaded_at = NOW(),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = :id`,
    { id: payment.id }
  );

  return {
    success: true,
    unlocked: true,
    report_ref: reportRef,
    payment_id: payment.id,
    download_count: Number(payment.download_count || 0) + 1,
    message: "Payment verified. This backend does not host a provider PDF; use the existing approved report download flow or provider-delivered PDF when configured.",
  };
}

async function handleWebhookEvent(event) {
  if (!event || typeof event !== "object") return { processed: false };
  const payment = event.payload && event.payload.payment ? event.payload.payment : event.payload || null;
  const entity = payment?.entity || payment || null;
  if (!entity || !entity.order_id || !entity.id) {
    return { processed: false, reason: "No payment entity" };
  }

  const [rows] = await pool.query(
    `SELECT *
     FROM civil_score_payments
     WHERE razorpay_order_id = :orderId OR razorpay_payment_id = :paymentId
     ORDER BY id DESC LIMIT 1`,
    {
      orderId: entity.order_id,
      paymentId: entity.id,
    }
  );

  if (!rows.length) {
    return { processed: false, reason: "Payment record not found" };
  }

  const paymentRow = rows[0];
  if (
    paymentRow.payment_status === "success" &&
    paymentRow.verification_status === "verified"
  ) {
    return { processed: true, status: "success", already_processed: true };
  }

  if (
    Number(entity.amount || 0) !== Number(paymentRow.amount_paise) ||
    String(entity.currency || "").toUpperCase() !== String(paymentRow.currency || "").toUpperCase()
  ) {
    return { processed: false, reason: "Payment amount or currency mismatch" };
  }

  const status = String(entity.status || "").toLowerCase();
  if (status === "captured") {
    await pool.query(
      `UPDATE civil_score_payments
       SET razorpay_payment_id = :paymentId,
           payment_status = 'success',
           verification_status = 'verified',
           verified_at = NOW(),
           failure_reason = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { paymentId: entity.id, id: paymentRow.id }
    );
    return { processed: true, status: "success" };
  }

  if (status === "authorized") {
    await pool.query(
      `UPDATE civil_score_payments
       SET razorpay_payment_id = :paymentId,
           payment_status = 'authorized',
           verification_status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { paymentId: entity.id, id: paymentRow.id }
    );
    return { processed: true, status: "authorized" };
  }

  if (status === "failed" || status === "cancelled") {
    await pool.query(
      `UPDATE civil_score_payments
       SET razorpay_payment_id = COALESCE(:paymentId, razorpay_payment_id),
           payment_status = :status,
           verification_status = 'rejected',
           failure_reason = :reason,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      {
        paymentId: entity.id,
        status: status === "failed" ? "failed" : "cancelled",
        reason: entity.error_description || status,
        id: paymentRow.id,
      }
    );
  }

  return { processed: true, status };
}

module.exports = {
  EXPECTED_AMOUNT_PAISA,
  EXPECTED_CURRENCY,
  createCivilScoreOrder,
  createCivilScoreQr,
  getCivilScoreQrStatus,
  finalizePaymentStatus,
  getCivilScoreUnlockStatus,
  ensureUnlockedReportAccess,
  recordDownload,
  handleWebhookEvent,
  verifyWebhookSignature,
};
