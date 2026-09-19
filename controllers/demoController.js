const {
  DEMO_CREDIT_PRESETS,
  DEMO_NOTICE,
  isDemoModeEnabled,
  getDemoWalletSummary,
  listDemoTransactions,
  addDemoMoney,
  listDemoProducts,
  estimateFd,
  estimateRd,
  createDemoFd,
  createDemoRd,
  listUserInvestments,
  getUserInvestment,
  matureFd,
  matureRd,
  simulateRdInstallment,
  formatDemoWdId,
  demoEnvelope,
} = require("../services/demoInvestmentService");
const pool = require("../config/db");
const { debitWallet } = require("../services/walletService");
const { sanitizeText } = require("../utils/validators");

function handleDemoError(res, error, fallback) {
  if (error.code === "NOT_FOUND") {
    return res.status(404).json({ success: false, message: error.message, demo_mode: true });
  }
  if (
    error.code === "VALIDATION_ERROR" ||
    error.code === "INVALID_AMOUNT" ||
    error.code === "INSUFFICIENT_BALANCE" ||
    error.code === "ALREADY_PROCESSED" ||
    error.code === "DEMO_DISABLED"
  ) {
    return res.status(400).json({
      success: false,
      message: error.message,
      code: error.code,
      data: error.data || null,
      demo_mode: true,
      demo_notice: DEMO_NOTICE,
    });
  }
  console.error(fallback, error);
  return res.status(500).json({
    success: false,
    message: fallback,
    error: error.message,
    demo_mode: true,
  });
}

async function demoConfig(_req, res) {
  return res.json({
    success: true,
    data: demoEnvelope({
      enabled: isDemoModeEnabled(),
      add_money_presets: DEMO_CREDIT_PRESETS,
      dummy_card_gateway: {
        enabled: String(process.env.DUMMY_PAYMENT_ENABLED || "true").toLowerCase() !== "false",
        create: "POST /api/payments/dummy/create",
        note: "Optional card+OTP path for banks; DEMO_CREDIT is the fast UAT path",
      },
      flow: [
        "1. POST /api/demo/wallet/add-money — credit virtual funds",
        "2. POST /api/demo/fd or /api/demo/rd — invest from wallet",
        "3. Admin POST .../mature — credit maturity to wallet",
        "4. POST /api/demo/withdrawals — request demo withdrawal (no real payout)",
      ],
    }),
  });
}

async function demoWalletSummary(req, res) {
  try {
    const data = await getDemoWalletSummary(req.user.id);
    return res.json({ success: true, message: "Demo wallet summary", data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to fetch demo wallet");
  }
}

async function demoWalletTransactions(req, res) {
  try {
    const items = await listDemoTransactions(req.user.id, { limit: req.query.limit });
    return res.json({
      success: true,
      message: "Demo wallet transactions",
      data: demoEnvelope({ count: items.length, transactions: items }),
    });
  } catch (error) {
    return handleDemoError(res, error, "Failed to list transactions");
  }
}

async function demoAddMoney(req, res) {
  try {
    const amount = Number(req.body.amount);
    const data = await addDemoMoney(req.user.id, amount);
    return res.status(201).json({ success: true, message: data.message, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to add demo money");
  }
}

async function demoProducts(_req, res) {
  return res.json({ success: true, data: listDemoProducts() });
}

async function demoEstimateFd(req, res) {
  try {
    const data = estimateFd(req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to estimate FD");
  }
}

async function demoEstimateRd(req, res) {
  try {
    const data = estimateRd(req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to estimate RD");
  }
}

async function demoCreateFd(req, res) {
  try {
    const data = await createDemoFd(req.user.id, req.body || {});
    return res.status(201).json({ success: true, message: data.message, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to create demo FD");
  }
}

async function demoCreateRd(req, res) {
  try {
    const data = await createDemoRd(req.user.id, req.body || {});
    return res.status(201).json({ success: true, message: data.message, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to create demo RD");
  }
}

async function demoListInvestments(req, res) {
  try {
    const data = await listUserInvestments(req.user.id, {
      type: req.query.type,
      status: req.query.status,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to list investments");
  }
}

async function demoGetInvestment(req, res) {
  try {
    const data = await getUserInvestment(req.user.id, req.params.type, Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, message: "Investment not found", demo_mode: true });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to fetch investment");
  }
}

async function demoCreateWithdrawal(req, res) {
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount < 1) {
      return res.status(400).json({
        success: false,
        message: "Valid withdrawal amount is required",
        demo_mode: true,
      });
    }

    const method = String(req.body.method || "bank").toLowerCase() === "upi" ? "upi" : "bank";
    let bankAccountId = null;
    let upiId = null;

    if (method === "upi") {
      upiId = sanitizeText(req.body.upi_id || req.body.upi || "", 150);
      if (!upiId || !upiId.includes("@")) {
        return res.status(400).json({
          success: false,
          message: "Valid UPI ID is required (e.g. name@upi)",
          demo_mode: true,
        });
      }
    } else {
      const [banks] = await pool.query(
        `SELECT id FROM user_bank_accounts WHERE user_id = :userId AND status = 'active' LIMIT 1`,
        { userId: req.user.id }
      );
      if (!banks.length) {
        return res.status(400).json({
          success: false,
          message: "Add a bank account first (PUT /api/wallet/bank-account) or use method=upi",
          demo_mode: true,
        });
      }
      bankAccountId = banks[0].id;
    }

    const tx = await debitWallet({
      userId: req.user.id,
      amount,
      category: "withdrawal_hold",
      referenceType: "withdrawal_request",
      description: "DEMO withdrawal requested — no real bank/UPI payout",
      meta: { demo: true, method },
    });

    const [ins] = await pool.query(
      `INSERT INTO withdrawal_requests
        (user_id, bank_account_id, amount, status, method, upi_id, wallet_transaction_id)
       VALUES
        (:userId, :bankId, :amount, 'pending', :method, :upiId, :txId)`,
      {
        userId: req.user.id,
        bankId: bankAccountId,
        amount,
        method,
        upiId,
        txId: tx.transaction_id,
      }
    );

    const demoRef = formatDemoWdId(ins.insertId);
    await pool.query(
      `UPDATE withdrawal_requests SET demo_ref = :demoRef WHERE id = :id`,
      { demoRef, id: ins.insertId }
    );
    await pool.query(
      `UPDATE wallet_transactions SET reference_id = :refId WHERE id = :txId`,
      { refId: ins.insertId, txId: tx.transaction_id }
    );

    return res.status(201).json({
      success: true,
      message: "Demo withdrawal request submitted successfully. No real money will be paid out.",
      data: demoEnvelope({
        withdrawal_id: ins.insertId,
        demo_ref: demoRef,
        amount,
        method,
        status: "PENDING",
        balance: tx.balance,
      }),
    });
  } catch (error) {
    return handleDemoError(res, error, "Failed to create demo withdrawal");
  }
}

async function demoListWithdrawals(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, amount, status, method, upi_id, demo_ref, admin_note, created_at, processed_at
       FROM withdrawal_requests WHERE user_id = :userId ORDER BY id DESC LIMIT 50`,
      { userId: req.user.id }
    );
    return res.json({
      success: true,
      data: demoEnvelope({
        withdrawals: rows.map((w) => ({
          ...w,
          demo_ref: w.demo_ref || formatDemoWdId(w.id),
          status: String(w.status).toUpperCase(),
        })),
      }),
    });
  } catch (error) {
    return handleDemoError(res, error, "Failed to list withdrawals");
  }
}

// ——— Admin ———

async function adminMatureFd(req, res) {
  try {
    const data = await matureFd(Number(req.params.id), req.user.id);
    return res.json({ success: true, message: data.message, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to mature FD");
  }
}

async function adminMatureRd(req, res) {
  try {
    const data = await matureRd(Number(req.params.id), req.user.id);
    return res.json({ success: true, message: data.message, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to mature RD");
  }
}

async function adminSimulateRdInstallment(req, res) {
  try {
    const data = await simulateRdInstallment(Number(req.params.id), req.user.id);
    return res.json({ success: true, message: data.message, data });
  } catch (error) {
    return handleDemoError(res, error, "Failed to simulate RD installment");
  }
}

async function adminDemoOverview(_req, res) {
  try {
    const [[w]] = await pool.query(`SELECT COALESCE(SUM(balance),0) AS total FROM wallets`);
    const [[credits]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM wallet_transactions
       WHERE direction='credit' AND category IN ('DEMO_CREDIT','wallet_deposit','razorpay_deposit','dummy_payment')`
    );
    const [[fd]] = await pool.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(principal_amount),0) AS amt FROM portfolio_fds WHERE status='active'`
    );
    const [[rd]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM portfolio_rds WHERE status='active'`
    );
    const [[pendingWd]] = await pool.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS amt FROM withdrawal_requests WHERE status='pending'`
    );
    const [[users]] = await pool.query(`SELECT COUNT(*) AS cnt FROM users WHERE role='user'`);

    return res.json({
      success: true,
      data: demoEnvelope({
        total_users: Number(users.cnt || 0),
        total_demo_wallet_balance: Number(w.total || 0),
        total_demo_money_added: Number(credits.total || 0),
        active_fd_count: Number(fd.cnt || 0),
        active_fd_principal: Number(fd.amt || 0),
        active_rd_count: Number(rd.cnt || 0),
        pending_withdrawals: Number(pendingWd.cnt || 0),
        pending_withdrawal_amount: Number(pendingWd.amt || 0),
      }),
    });
  } catch (error) {
    return handleDemoError(res, error, "Failed to load demo overview");
  }
}

module.exports = {
  demoConfig,
  demoWalletSummary,
  demoWalletTransactions,
  demoAddMoney,
  demoProducts,
  demoEstimateFd,
  demoEstimateRd,
  demoCreateFd,
  demoCreateRd,
  demoListInvestments,
  demoGetInvestment,
  demoCreateWithdrawal,
  demoListWithdrawals,
  adminMatureFd,
  adminMatureRd,
  adminSimulateRdInstallment,
  adminDemoOverview,
};
