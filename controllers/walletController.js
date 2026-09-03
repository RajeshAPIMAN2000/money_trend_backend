const pool = require("../config/db");
const { writeAuditLog } = require("../utils/audit");
const {
  ensureWallet,
  getBalance,
  creditWallet,
  currentFinancialYear,
} = require("../services/walletService");
const { createDepositOrder, verifyPaymentSignature } = require("../services/razorpayService");
const { encryptPii } = require("../utils/security");
const { sanitizeText } = require("../utils/validators");

async function getWallet(req, res) {
  console.log("[WALLET] get balance user:", req.user?.id);
  try {
    const wallet = await ensureWallet(req.user.id);
    const [txs] = await pool.query(
      `SELECT id, direction, category, amount, balance_after, reference_type, reference_id,
              description, created_at
       FROM wallet_transactions
       WHERE user_id = :userId
       ORDER BY id DESC
       LIMIT 20`,
      { userId: req.user.id }
    );

    return res.json({
      success: true,
      message: "Wallet fetched successfully",
      data: {
        balance: Number(wallet.balance),
        currency: wallet.currency,
        status: wallet.status,
        recent_transactions: txs,
        regulatory_note:
          "Wallet is a prepaid balance for FD/RD investments on Money Trend. Deposits via Razorpay. Withdrawals credited to your registered bank account after admin verification (RBI payment guidelines).",
      },
    });
  } catch (error) {
    console.error("[WALLET] get error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallet",
      error: error.message,
    });
  }
}

async function listTransactions(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const [rows] = await pool.query(
      `SELECT id, direction, category, amount, balance_after, reference_type, reference_id,
              description, created_at
       FROM wallet_transactions
       WHERE user_id = :userId
       ORDER BY id DESC
       LIMIT ${limit}`,
      { userId: req.user.id }
    );
    return res.json({
      success: true,
      message: "Wallet transactions fetched",
      data: { count: rows.length, transactions: rows },
    });
  } catch (error) {
    console.error("[WALLET] transactions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
      error: error.message,
    });
  }
}

/** Create Razorpay order to deposit into wallet */
async function createDeposit(req, res) {
  console.log("[WALLET] create deposit:", req.body);
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount < 1) {
      return res.status(400).json({
        success: false,
        message: "Deposit amount must be at least ₹1",
      });
    }
    if (amount > 500000) {
      return res.status(400).json({
        success: false,
        message: "Single deposit limited to ₹5,00,000 (complete KYC / bank channel for higher amounts)",
      });
    }

    await ensureWallet(req.user.id);
    const receipt = `mt_w_${req.user.id}_${Date.now()}`.slice(0, 40);
    const order = await createDepositOrder({
      amountInr: amount,
      receipt,
      notes: { user_id: String(req.user.id), purpose: "wallet_deposit" },
    });

    const [ins] = await pool.query(
      `INSERT INTO wallet_deposits
        (user_id, amount, currency, razorpay_order_id, status, receipt)
       VALUES
        (:userId, :amount, 'INR', :orderId, 'created', :receipt)`,
      {
        userId: req.user.id,
        amount,
        orderId: order.order_id,
        receipt,
      }
    );

    return res.status(201).json({
      success: true,
      message: "Razorpay order created. Complete payment to credit wallet.",
      data: {
        deposit_id: ins.insertId,
        ...order,
      },
    });
  } catch (error) {
    console.error("[WALLET] create deposit error:", error);
    const status = error.code === "RAZORPAY_NOT_CONFIGURED" ? 503 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to create deposit order",
      error: error.message,
    });
  }
}

/** Verify Razorpay payment and credit wallet */
async function verifyDeposit(req, res) {
  console.log("[WALLET] verify deposit:", req.body);
  try {
    const orderId = String(req.body.razorpay_order_id || req.body.order_id || "").trim();
    const paymentId = String(req.body.razorpay_payment_id || req.body.payment_id || "").trim();
    const signature = String(req.body.razorpay_signature || req.body.signature || "").trim();

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({
        success: false,
        message: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required",
      });
    }

    const valid = verifyPaymentSignature({ orderId, paymentId, signature });
    if (!valid) {
      return res.status(400).json({
        success: false,
        message: "Invalid Razorpay payment signature",
      });
    }

    const [rows] = await pool.query(
      `SELECT * FROM wallet_deposits WHERE razorpay_order_id = :orderId AND user_id = :userId LIMIT 1`,
      { orderId, userId: req.user.id }
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Deposit order not found" });
    }

    const deposit = rows[0];
    if (deposit.status === "paid") {
      const balance = await getBalance(req.user.id);
      return res.json({
        success: true,
        message: "Deposit already credited",
        data: { balance, deposit_id: deposit.id },
      });
    }

    const credit = await creditWallet({
      userId: req.user.id,
      amount: deposit.amount,
      category: "razorpay_deposit",
      referenceType: "wallet_deposit",
      referenceId: deposit.id,
      description: `Wallet deposit via Razorpay (${paymentId})`,
      meta: { razorpay_order_id: orderId, razorpay_payment_id: paymentId },
    });

    await pool.query(
      `UPDATE wallet_deposits
       SET status = 'paid',
           razorpay_payment_id = :paymentId,
           razorpay_signature = :signature,
           credited_at = NOW()
       WHERE id = :id`,
      { paymentId, signature, id: deposit.id }
    );

    await writeAuditLog({
      userId: req.user.id,
      action: "WALLET_DEPOSIT_PAID",
      entityType: "wallet_deposit",
      entityId: deposit.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: { amount: deposit.amount, paymentId },
    });

    return res.json({
      success: true,
      message: "Payment verified. Wallet credited successfully.",
      data: {
        deposit_id: deposit.id,
        credited: deposit.amount,
        balance: credit.balance,
        transaction_id: credit.transaction_id,
      },
    });
  } catch (error) {
    console.error("[WALLET] verify deposit error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify deposit",
      error: error.message,
    });
  }
}

async function upsertBankAccount(req, res) {
  console.log("[WALLET] bank account body:", {
    ...req.body,
    account_number: req.body?.account_number ? "***" : undefined,
  });
  try {
    const accountHolder = sanitizeText(
      req.body.account_holder_name || req.body.accountHolderName || req.body.name,
      150
    );
    const bankName = sanitizeText(req.body.bank_name || req.body.bankName, 150);
    const branchName = sanitizeText(req.body.branch_name || req.body.branchName, 150);
    const ifsc = String(req.body.ifsc || req.body.ifsc_code || req.body.ifscCode || "")
      .trim()
      .toUpperCase();
    const accountNumber = String(
      req.body.account_number || req.body.accountNumber || ""
    ).replace(/\s+/g, "");

    if (!accountHolder || !bankName || !branchName || !ifsc || !accountNumber) {
      return res.status(400).json({
        success: false,
        message:
          "account_holder_name, bank_name, branch_name, ifsc and account_number are required",
      });
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      return res.status(400).json({ success: false, message: "Invalid IFSC code" });
    }
    if (!/^\d{9,18}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: "Account number must be 9–18 digits",
      });
    }

    const encryptedAccount = encryptPii(accountNumber);
    const last4 = accountNumber.slice(-4);

    await pool.query(
      `INSERT INTO user_bank_accounts
        (user_id, account_holder_name, bank_name, branch_name, ifsc_code,
         account_number_enc, account_last4, is_primary, status)
       VALUES
        (:userId, :accountHolder, :bankName, :branchName, :ifsc,
         :encryptedAccount, :last4, 1, 'active')
       ON DUPLICATE KEY UPDATE
        account_holder_name = VALUES(account_holder_name),
        bank_name = VALUES(bank_name),
        branch_name = VALUES(branch_name),
        ifsc_code = VALUES(ifsc_code),
        account_number_enc = VALUES(account_number_enc),
        account_last4 = VALUES(account_last4),
        status = 'active'`,
      {
        userId: req.user.id,
        accountHolder,
        bankName,
        branchName,
        ifsc,
        encryptedAccount,
        last4,
      }
    );

    return res.json({
      success: true,
      message: "Bank account saved for withdrawals",
      data: {
        account_holder_name: accountHolder,
        bank_name: bankName,
        branch_name: branchName,
        ifsc_code: ifsc,
        account_number_masked: `XXXXXX${last4}`,
      },
    });
  } catch (error) {
    console.error("[WALLET] bank account error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save bank account",
      error: error.message,
    });
  }
}

async function getBankAccount(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT account_holder_name, bank_name, branch_name, ifsc_code, account_last4, status, created_at
       FROM user_bank_accounts WHERE user_id = :userId LIMIT 1`,
      { userId: req.user.id }
    );
    if (!rows.length) {
      return res.json({
        success: true,
        message: "No bank account added",
        data: { bank_account: null },
      });
    }
    return res.json({
      success: true,
      message: "Bank account fetched",
      data: {
        bank_account: {
          ...rows[0],
          account_number_masked: `XXXXXX${rows[0].account_last4}`,
        },
      },
    });
  } catch (error) {
    console.error("[WALLET] get bank error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bank account",
      error: error.message,
    });
  }
}

async function requestWithdrawal(req, res) {
  console.log("[WALLET] withdrawal request:", req.body);
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount < 1) {
      return res.status(400).json({ success: false, message: "Valid withdrawal amount is required" });
    }

    const [banks] = await pool.query(
      `SELECT id FROM user_bank_accounts WHERE user_id = :userId AND status = 'active' LIMIT 1`,
      { userId: req.user.id }
    );
    if (!banks.length) {
      return res.status(400).json({
        success: false,
        message: "Add bank account in profile/KYC before withdrawing",
      });
    }

    const { debitWallet } = require("../services/walletService");
    const tx = await debitWallet({
      userId: req.user.id,
      amount,
      category: "withdrawal_hold",
      referenceType: "withdrawal_request",
      description: "Withdrawal requested — pending admin bank transfer",
    });

    const [ins] = await pool.query(
      `INSERT INTO withdrawal_requests
        (user_id, bank_account_id, amount, status, wallet_transaction_id)
       VALUES
        (:userId, :bankId, :amount, 'pending', :txId)`,
      {
        userId: req.user.id,
        bankId: banks[0].id,
        amount,
        txId: tx.transaction_id,
      }
    );

    await pool.query(
      `UPDATE wallet_transactions SET reference_id = :refId WHERE id = :txId`,
      { refId: ins.insertId, txId: tx.transaction_id }
    );

    return res.status(201).json({
      success: true,
      message:
        "Withdrawal requested. Admin will transfer to your registered bank account (Account No / IFSC).",
      data: {
        withdrawal_id: ins.insertId,
        amount,
        status: "pending",
        balance: tx.balance,
      },
    });
  } catch (error) {
    console.error("[WALLET] withdrawal error:", error);
    const status = error.code === "INSUFFICIENT_BALANCE" ? 400 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to request withdrawal",
      error: error.message,
    });
  }
}

async function getTaxReport(req, res) {
  try {
    const fy = String(req.query.financial_year || req.query.fy || currentFinancialYear());
    const [rows] = await pool.query(
      `SELECT id, product_type, product_id, financial_year, principal_amount,
              interest_earned, loss_amount, net_credit, tax_section, remarks, created_at
       FROM tax_investment_records
       WHERE user_id = :userId AND financial_year = :fy
       ORDER BY id DESC`,
      { userId: req.user.id, fy }
    );

    const totalInterest = rows.reduce((s, r) => s + Number(r.interest_earned || 0), 0);
    const totalLoss = rows.reduce((s, r) => s + Number(r.loss_amount || 0), 0);

    return res.json({
      success: true,
      message: "Income-tax investment report for ITR filing",
      data: {
        financial_year: fy,
        total_interest_earned: Math.round(totalInterest * 100) / 100,
        total_loss: Math.round(totalLoss * 100) / 100,
        records: rows,
        note:
          "Use this statement while filing ITR. Interest on bank deposits may attract TDS u/s 194A as per Income Tax Act. This is a platform report — consult a CA for filing.",
      },
    });
  } catch (error) {
    console.error("[WALLET] tax report error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tax report",
      error: error.message,
    });
  }
}

module.exports = {
  getWallet,
  listTransactions,
  createDeposit,
  verifyDeposit,
  upsertBankAccount,
  getBankAccount,
  requestWithdrawal,
  getTaxReport,
};
