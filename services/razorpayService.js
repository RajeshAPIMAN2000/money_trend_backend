const Razorpay = require("razorpay");
const crypto = require("crypto");

function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const err = new Error(
      "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env"
    );
    err.code = "RAZORPAY_NOT_CONFIGURED";
    throw err;
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function createDepositOrder({ amountInr, receipt, notes = {} }) {
  const razorpay = getRazorpayClient();
  const amountPaise = Math.round(Number(amountInr) * 100);
  if (amountPaise < 100) {
    const err = new Error("Minimum deposit is ₹1");
    err.code = "INVALID_AMOUNT";
    throw err;
  }

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt: String(receipt).slice(0, 40),
    notes,
    payment_capture: 1,
  });

  return {
    order_id: order.id,
    amount: amountInr,
    amount_paise: amountPaise,
    currency: order.currency,
    key_id: process.env.RAZORPAY_KEY_ID,
    receipt: order.receipt,
  };
}

function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
    .update(body)
    .digest("hex");
  return expected === signature;
}

module.exports = {
  getRazorpayClient,
  createDepositOrder,
  verifyPaymentSignature,
};
