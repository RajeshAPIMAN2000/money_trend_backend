const {
  createCivilScoreOrder,
  createCivilScoreQr,
  getCivilScoreQrStatus,
  finalizePaymentStatus,
  getCivilScoreUnlockStatus: fetchCivilScoreUnlockStatus,
  recordDownload,
  handleWebhookEvent,
  verifyWebhookSignature,
} = require("../services/civilScorePaymentService");

async function createCivilScoreQrCode(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const { report_ref, reportRef, check_id, checkId } = req.body || {};
    const result = await createCivilScoreQr({
      userId,
      reportRefId: report_ref || reportRef || null,
      checkId: check_id || checkId || null,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const providerMessage = error?.error?.description || error.message || "Failed to create QR payment";
    const qrUnavailable = /feature request|not enabled|not available|not supported/i.test(providerMessage);
    return res.status(error.status || (qrUnavailable ? 503 : 500)).json({
      success: false,
      message: qrUnavailable
        ? "UPI QR payments are not enabled for this Razorpay account. Ask Razorpay Support to activate UPI QR Codes."
        : providerMessage,
      code: qrUnavailable ? "RAZORPAY_QR_NOT_ENABLED" : error.code || undefined,
    });
  }
}

async function getCivilScoreQrPaymentStatus(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const result = await getCivilScoreQrStatus({ userId, paymentId: req.params.paymentId });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to verify QR payment status",
      code: error.code || undefined,
    });
  }
}

async function createCivilScorePaymentOrder(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { report_ref, reportRef, check_id, checkId } = req.body || {};
    const result = await createCivilScoreOrder({
      userId,
      reportRefId: report_ref || reportRef || null,
      checkId: check_id || checkId || null,
    });

    return res.status(201).json({
      success: true,
      message: "Razorpay order created for CIBIL report unlock",
      data: result,
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to create report unlock order",
      code: error.code || undefined,
    });
  }
}

async function verifyCivilScorePayment(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const orderId = String(req.body?.razorpay_order_id || req.body?.order_id || "").trim();
    const paymentId = String(req.body?.razorpay_payment_id || req.body?.payment_id || "").trim();
    const signature = String(req.body?.razorpay_signature || req.body?.signature || "").trim();
    const reportRefId = String(req.body?.report_ref || req.body?.reportRef || "").trim() || null;

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({
        success: false,
        message: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required",
      });
    }

    const result = await finalizePaymentStatus({
      orderId,
      paymentId,
      signature,
      userId,
      reportRefId,
    });

    return res.json({ success: true, message: result.message || "Payment result processed", data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to verify payment",
      code: error.code || undefined,
    });
  }
}

async function getCivilScoreUnlockStatus(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const reportRef = String(req.query.report_ref || req.query.reportRef || "").trim() || null;
    const checkId = req.query.check_id || req.query.checkId || null;
    const status = await fetchCivilScoreUnlockStatus({ userId, reportRefId: reportRef, checkId });
    return res.json({ success: true, data: status });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to fetch unlock status",
      code: error.code || undefined,
    });
  }
}

async function downloadCivilScoreReport(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const reportRef = String(req.query.report_ref || req.query.reportRef || "").trim() || null;
    const checkId = req.query.check_id || req.query.checkId || null;
    const result = await recordDownload({ userId, reportRefId: reportRef, checkId });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to authorize report download",
      code: error.code || undefined,
    });
  }
}

async function handleCivilScoreWebhook(req, res) {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""));
    const signature = String(req.headers["x-razorpay-signature"] || "").trim();
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return res.status(500).json({ success: false, message: "RAZORPAY_WEBHOOK_SECRET is not configured" });
    }

    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      return res.status(400).json({ success: false, message: "Invalid Razorpay webhook signature" });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8") || "{}");
    } catch (_error) {
      return res.status(400).json({ success: false, message: "Invalid webhook JSON payload" });
    }
    const event = payload.event || null;
    const result = await handleWebhookEvent({ event, payload });

    return res.json({ success: true, received: true, event, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Webhook processing failed",
      code: error.code || undefined,
    });
  }
}

module.exports = {
  createCivilScoreQrCode,
  getCivilScoreQrPaymentStatus,
  createCivilScorePaymentOrder,
  verifyCivilScorePayment,
  getCivilScoreUnlockStatus,
  downloadCivilScoreReport,
  handleCivilScoreWebhook,
};
