const {
  getDummyPaymentConfig,
  createDummyPayment,
  payDummyPayment,
  verifyDummyOtp,
  getDummyPayment,
  hasPaidCibilReport,
} = require("../services/dummyPaymentService");

async function getConfig(req, res) {
  try {
    const data = await getDummyPaymentConfig();
    return res.json({
      success: true,
      message: "Dummy payment gateway config for bank demos",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to load dummy payment config",
      error: error.message,
    });
  }
}

async function createPayment(req, res) {
  try {
    const purpose = req.body.purpose || req.body.type;
    const amount = req.body.amount;
    const description = req.body.description || null;
    const meta = req.body.meta || {
      product: req.body.product || null,
      bank_name: req.body.bank_name || req.body.bankName || null,
      credit_check_id: req.body.credit_check_id || req.body.creditCheckId || null,
    };

    const data = await createDummyPayment({
      userId: req.user.id,
      purpose,
      amount,
      description,
      meta,
    });

    return res.status(201).json({
      success: true,
      message: "Dummy payment order created. Submit card, then verify OTP 1234",
      data,
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to create dummy payment",
      code: error.code || undefined,
    });
  }
}

async function pay(req, res) {
  try {
    const orderId = String(req.body.order_id || req.body.orderId || "").trim();
    const cardNumber = req.body.card_number || req.body.cardNumber || req.body.number;
    const cvv = req.body.cvv || req.body.cvc;
    const expiryMonth =
      req.body.expiry_month ||
      req.body.expiryMonth ||
      (String(req.body.expiry || "").includes("/")
        ? String(req.body.expiry).split("/")[0]
        : undefined);
    const expiryYear =
      req.body.expiry_year ||
      req.body.expiryYear ||
      (String(req.body.expiry || "").includes("/")
        ? String(req.body.expiry).split("/")[1]
        : undefined);
    const cardHolder = req.body.card_holder || req.body.cardHolder || req.body.name;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "order_id is required",
        code: "VALIDATION_ERROR",
      });
    }

    const data = await payDummyPayment({
      userId: req.user.id,
      orderId,
      cardNumber,
      cvv,
      expiryMonth,
      expiryYear,
      cardHolder,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({
      success: true,
      message: data.already_paid
        ? "Payment already completed"
        : data.status === "otp_pending"
          ? "Card accepted. Enter dummy OTP 1234 to complete payment"
          : "Dummy payment approved (demo — no real charge)",
      data,
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Dummy payment failed",
      code: error.code || undefined,
    });
  }
}

async function verifyOtp(req, res) {
  try {
    const orderId = String(req.body.order_id || req.body.orderId || "").trim();
    const otp = req.body.otp || req.body.otp_code || req.body.otpCode || req.body.code;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "order_id is required",
        code: "VALIDATION_ERROR",
      });
    }

    const data = await verifyDummyOtp({
      userId: req.user.id,
      orderId,
      otp,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({
      success: true,
      message: data.already_paid
        ? "Payment already completed"
        : "Dummy OTP verified — payment approved (demo)",
      data,
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "OTP verification failed",
      code: error.code || undefined,
    });
  }
}

async function getPayment(req, res) {
  try {
    const orderId = String(req.params.orderId || "").trim();
    const data = await getDummyPayment(req.user.id, orderId);
    if (!data) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch payment",
    });
  }
}

async function cibilUnlockStatus(req, res) {
  try {
    const unlocked = await hasPaidCibilReport(req.user.id);
    return res.json({
      success: true,
      data: {
        unlocked,
        fee: Number(process.env.DUMMY_PAYMENT_CIBIL_FEE || 99),
        require_payment:
          String(process.env.DUMMY_PAYMENT_REQUIRE_CIBIL || "false").toLowerCase() === "true",
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = {
  getConfig,
  createPayment,
  pay,
  verifyOtp,
  getPayment,
  cibilUnlockStatus,
};
