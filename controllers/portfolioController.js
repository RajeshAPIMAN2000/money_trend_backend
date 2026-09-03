const pool = require("../config/db");
const { sanitizeText, parseDob } = require("../utils/validators");
const { writeAuditLog } = require("../utils/audit");
const {
  investFromWallet,
  settleInvestmentToWallet,
  getCommissionPercent,
  getBalance,
} = require("../services/walletService");

function calcFdMaturity(principal, ratePercent, tenureMonths, compounding = "quarterly") {
  const P = Number(principal);
  const r = Number(ratePercent) / 100;
  const years = Number(tenureMonths) / 12;
  let n = 4;
  if (compounding === "monthly") n = 12;
  if (compounding === "yearly") n = 1;
  if (compounding === "simple") {
    return Math.round((P + P * r * years) * 100) / 100;
  }
  const maturity = P * Math.pow(1 + r / n, n * years);
  return Math.round(maturity * 100) / 100;
}

/** RD maturity (quarterly compounding approximation used by many banks). */
function calcRdMaturity(monthlyAmount, ratePercent, tenureMonths) {
  const R = Number(monthlyAmount);
  const i = Number(ratePercent) / 400; // quarterly
  const n = Number(tenureMonths);
  if (i === 0) return Math.round(R * n * 100) / 100;
  const maturity = R * ((Math.pow(1 + i, n) - 1) / i);
  return Math.round(maturity * 100) / 100;
}

function addMonths(isoDate, months) {
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() + Number(months));
  return d.toISOString().slice(0, 10);
}

async function getFdSummary(req, res) {
  console.log("[FD] summary user:", req.user?.id);
  try {
    const userId = req.user.id;
    const [fds] = await pool.query(
      `SELECT * FROM portfolio_fds WHERE user_id = :userId AND status = 'active' ORDER BY created_at DESC`,
      { userId }
    );

    const invested = fds.reduce((s, r) => s + Number(r.principal_amount || 0), 0);
    const maturity = fds.reduce((s, r) => s + Number(r.maturity_amount || 0), 0);

    return res.json({
      success: true,
      message: "Money Trend FD portfolio summary",
      data: {
        summary: {
          total_fd_count: fds.length,
          total_fd_invested: Math.round(invested * 100) / 100,
          total_fd_maturity_value: Math.round(maturity * 100) / 100,
          expected_interest: Math.round((maturity - invested) * 100) / 100,
        },
        fds,
        note: "FD portfolio only — separate from RD and other apps.",
      },
    });
  } catch (error) {
    console.error("[FD] summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch FD portfolio summary",
      error: error.message,
    });
  }
}

async function getRdSummary(req, res) {
  console.log("[RD] summary user:", req.user?.id);
  try {
    const userId = req.user.id;
    const [rds] = await pool.query(
      `SELECT * FROM portfolio_rds WHERE user_id = :userId AND status = 'active' ORDER BY created_at DESC`,
      { userId }
    );

    const committed = rds.reduce(
      (s, r) => s + Number(r.monthly_amount || 0) * Number(r.tenure_months || 0),
      0
    );
    const maturity = rds.reduce((s, r) => s + Number(r.maturity_amount || 0), 0);

    return res.json({
      success: true,
      message: "Money Trend RD portfolio summary",
      data: {
        summary: {
          total_rd_count: rds.length,
          total_rd_committed: Math.round(committed * 100) / 100,
          total_rd_maturity_value: Math.round(maturity * 100) / 100,
          expected_interest: Math.round((maturity - committed) * 100) / 100,
        },
        rds,
        note: "RD portfolio only — separate from FD and other apps.",
      },
    });
  } catch (error) {
    console.error("[RD] summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch RD portfolio summary",
      error: error.message,
    });
  }
}

async function listFds(req, res) {
  console.log("[FD] list user:", req.user?.id);
  try {
    const [rows] = await pool.query(
      `SELECT * FROM portfolio_fds WHERE user_id = :userId ORDER BY created_at DESC`,
      { userId: req.user.id }
    );
    return res.json({
      success: true,
      message: "FD portfolio fetched",
      data: { count: rows.length, fds: rows },
    });
  } catch (error) {
    console.error("[PORTFOLIO] list FD error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch FD portfolio",
      error: error.message,
    });
  }
}

async function addFd(req, res) {
  console.log("[PORTFOLIO] add FD body:", req.body);
  try {
    const bankName = sanitizeText(req.body.bank_name || req.body.bankName || req.body.bank, 150);
    const bankCode = sanitizeText(req.body.bank_code || req.body.bankCode || "", 50) || null;
    const fdNumber = sanitizeText(req.body.fd_number || req.body.fdNumber || "", 100) || null;
    const principal = Number(req.body.principal_amount || req.body.principal || req.body.amount);
    const interestRate = Number(req.body.interest_rate || req.body.interestRate || req.body.rate);
    const tenureMonths = Number(req.body.tenure_months || req.body.tenureMonths || req.body.tenure);
    const startRaw = req.body.start_date || req.body.startDate;
    const compounding = sanitizeText(req.body.compounding || "quarterly", 30) || "quarterly";
    const notes = sanitizeText(req.body.notes || "", 500) || null;

    if (!bankName || !principal || !interestRate || !tenureMonths || !startRaw) {
      return res.status(400).json({
        success: false,
        message:
          "bank_name, principal_amount, interest_rate, tenure_months and start_date are required",
      });
    }
    if (principal <= 0 || interestRate <= 0 || tenureMonths <= 0) {
      return res.status(400).json({
        success: false,
        message: "principal_amount, interest_rate and tenure_months must be positive",
      });
    }

    const startParsed = parseDob(startRaw) || {
      iso: String(startRaw).slice(0, 10),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startParsed.iso)) {
      return res.status(400).json({ success: false, message: "Invalid start_date" });
    }

    const maturityDate = addMonths(startParsed.iso, tenureMonths);
    const maturityAmount = calcFdMaturity(principal, interestRate, tenureMonths, compounding);
    const userId = req.user.id;

    const commissionPct = getCommissionPercent();
    const fee = Math.round(((principal * commissionPct) / 100) * 100) / 100;
    const balance = await getBalance(userId);
    if (balance < principal + fee) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Need ₹${principal + fee} (FD ₹${principal} + admin fee ${commissionPct}% ₹${fee})`,
        data: { balance, required: principal + fee, admin_fee_percent: commissionPct },
      });
    }

    const [result] = await pool.query(
      `INSERT INTO portfolio_fds
        (user_id, bank_name, bank_code, fd_number, principal_amount, interest_rate,
         tenure_months, start_date, maturity_date, maturity_amount, compounding, notes, status)
       VALUES
        (:userId, :bankName, :bankCode, :fdNumber, :principal, :interestRate,
         :tenureMonths, :startDate, :maturityDate, :maturityAmount, :compounding, :notes, 'active')`,
      {
        userId,
        bankName,
        bankCode,
        fdNumber,
        principal,
        interestRate,
        tenureMonths,
        startDate: startParsed.iso,
        maturityDate,
        maturityAmount,
        compounding,
        notes,
      }
    );

    let walletResult;
    try {
      walletResult = await investFromWallet({
        userId,
        investAmount: principal,
        productType: "FD",
        productId: result.insertId,
        description: `FD investment at ${bankName}`,
      });
    } catch (walletErr) {
      await pool.query(`DELETE FROM portfolio_fds WHERE id = :id`, { id: result.insertId });
      throw walletErr;
    }

    await writeAuditLog({
      userId,
      action: "PORTFOLIO_FD_ADD",
      entityType: "portfolio_fd",
      entityId: result.insertId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: { bankName, principal, interestRate, commission: walletResult.commission },
    });

    return res.status(201).json({
      success: true,
      message: "FD invested from wallet successfully",
      data: {
        id: result.insertId,
        bank_name: bankName,
        principal_amount: principal,
        interest_rate: interestRate,
        tenure_months: tenureMonths,
        start_date: startParsed.iso,
        maturity_date: maturityDate,
        maturity_amount: maturityAmount,
        product: "FD",
        wallet: {
          debited_investment: walletResult.principal,
          admin_commission_percent: walletResult.commission_percent,
          admin_commission: walletResult.commission,
          total_debited: walletResult.total_debited,
          balance: walletResult.balance,
        },
        regulatory_note:
          "Platform fee 2–3% disclosed at investment. FD interest is taxable; TDS may apply u/s 194A as per Income Tax Act / RBI deposit norms.",
      },
    });
  } catch (error) {
    console.error("[PORTFOLIO] add FD error:", error);
    const status = error.code === "INSUFFICIENT_BALANCE" ? 400 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to add FD",
      error: error.message,
    });
  }
}

async function listRds(req, res) {
  console.log("[PORTFOLIO] list RD user:", req.user?.id);
  try {
    const [rows] = await pool.query(
      `SELECT * FROM portfolio_rds WHERE user_id = :userId ORDER BY created_at DESC`,
      { userId: req.user.id }
    );
    return res.json({
      success: true,
      message: "RD portfolio fetched",
      data: { count: rows.length, rds: rows },
    });
  } catch (error) {
    console.error("[PORTFOLIO] list RD error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch RD portfolio",
      error: error.message,
    });
  }
}

async function addRd(req, res) {
  console.log("[PORTFOLIO] add RD body:", req.body);
  try {
    const bankName = sanitizeText(req.body.bank_name || req.body.bankName || req.body.bank, 150);
    const bankCode = sanitizeText(req.body.bank_code || req.body.bankCode || "", 50) || null;
    const rdNumber = sanitizeText(req.body.rd_number || req.body.rdNumber || "", 100) || null;
    const monthlyAmount = Number(
      req.body.monthly_amount || req.body.monthlyAmount || req.body.amount
    );
    const interestRate = Number(req.body.interest_rate || req.body.interestRate || req.body.rate);
    const tenureMonths = Number(req.body.tenure_months || req.body.tenureMonths || req.body.tenure);
    const startRaw = req.body.start_date || req.body.startDate;
    const notes = sanitizeText(req.body.notes || "", 500) || null;

    if (!bankName || !monthlyAmount || !interestRate || !tenureMonths || !startRaw) {
      return res.status(400).json({
        success: false,
        message:
          "bank_name, monthly_amount, interest_rate, tenure_months and start_date are required",
      });
    }
    if (monthlyAmount <= 0 || interestRate <= 0 || tenureMonths <= 0) {
      return res.status(400).json({
        success: false,
        message: "monthly_amount, interest_rate and tenure_months must be positive",
      });
    }

    const startParsed = parseDob(startRaw) || {
      iso: String(startRaw).slice(0, 10),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startParsed.iso)) {
      return res.status(400).json({ success: false, message: "Invalid start_date" });
    }

    const maturityDate = addMonths(startParsed.iso, tenureMonths);
    const maturityAmount = calcRdMaturity(monthlyAmount, interestRate, tenureMonths);
    const userId = req.user.id;
    // First instalment deducted from wallet at booking (recurring later can be scheduled)
    const investAmount = monthlyAmount;
    const commissionPct = getCommissionPercent();
    const fee = Math.round(((investAmount * commissionPct) / 100) * 100) / 100;
    const balance = await getBalance(userId);
    if (balance < investAmount + fee) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Need ₹${investAmount + fee} (RD instalment ₹${investAmount} + admin fee ${commissionPct}% ₹${fee})`,
        data: { balance, required: investAmount + fee, admin_fee_percent: commissionPct },
      });
    }

    const [result] = await pool.query(
      `INSERT INTO portfolio_rds
        (user_id, bank_name, bank_code, rd_number, monthly_amount, interest_rate,
         tenure_months, start_date, maturity_date, maturity_amount, notes, status)
       VALUES
        (:userId, :bankName, :bankCode, :rdNumber, :monthlyAmount, :interestRate,
         :tenureMonths, :startDate, :maturityDate, :maturityAmount, :notes, 'active')`,
      {
        userId,
        bankName,
        bankCode,
        rdNumber,
        monthlyAmount,
        interestRate,
        tenureMonths,
        startDate: startParsed.iso,
        maturityDate,
        maturityAmount,
        notes,
      }
    );

    let walletResult;
    try {
      walletResult = await investFromWallet({
        userId,
        investAmount,
        productType: "RD",
        productId: result.insertId,
        description: `RD first instalment at ${bankName}`,
      });
    } catch (walletErr) {
      await pool.query(`DELETE FROM portfolio_rds WHERE id = :id`, { id: result.insertId });
      throw walletErr;
    }

    await writeAuditLog({
      userId,
      action: "PORTFOLIO_RD_ADD",
      entityType: "portfolio_rd",
      entityId: result.insertId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: { bankName, monthlyAmount, interestRate, commission: walletResult.commission },
    });

    return res.status(201).json({
      success: true,
      message: "RD invested from wallet successfully",
      data: {
        id: result.insertId,
        bank_name: bankName,
        monthly_amount: monthlyAmount,
        interest_rate: interestRate,
        tenure_months: tenureMonths,
        start_date: startParsed.iso,
        maturity_date: maturityDate,
        maturity_amount: maturityAmount,
        product: "RD",
        wallet: {
          debited_investment: walletResult.principal,
          admin_commission_percent: walletResult.commission_percent,
          admin_commission: walletResult.commission,
          total_debited: walletResult.total_debited,
          balance: walletResult.balance,
        },
        regulatory_note:
          "Platform fee 2–3% disclosed at investment. RD interest is taxable; report in ITR as applicable.",
      },
    });
  } catch (error) {
    console.error("[PORTFOLIO] add RD error:", error);
    const status = error.code === "INSUFFICIENT_BALANCE" ? 400 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to add RD",
      error: error.message,
    });
  }
}

async function breakFd(req, res) {
  console.log("[FD] break:", req.params.id, req.body);
  try {
    const id = Number(req.params.id);
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT * FROM portfolio_fds WHERE id = :id AND user_id = :userId AND status = 'active' LIMIT 1`,
      { id, userId }
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Active FD not found" });
    }

    const fd = rows[0];
    const principal = Number(fd.principal_amount);
    const interestEarned = Number(req.body.interest_earned ?? req.body.interestEarned ?? 0);
    const lossAmount = Number(req.body.loss_amount ?? req.body.lossAmount ?? 0);

    if (interestEarned < 0 || lossAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "interest_earned and loss_amount cannot be negative",
      });
    }
    if (interestEarned > 0 && lossAmount > 0) {
      return res.status(400).json({
        success: false,
        message: "Provide either interest_earned (gain) or loss_amount (loss), not both",
      });
    }

    const settlement = await settleInvestmentToWallet({
      userId,
      productType: "FD",
      productId: id,
      principal,
      interestEarned,
      lossAmount,
      description: `FD #${id} break settlement`,
    });

    await pool.query(`UPDATE portfolio_fds SET status = 'closed' WHERE id = :id`, { id });

    await writeAuditLog({
      userId,
      action: "PORTFOLIO_FD_BREAK",
      entityType: "portfolio_fd",
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: settlement,
    });

    return res.json({
      success: true,
      message: "FD broken. Settlement credited to wallet.",
      data: {
        fd_id: id,
        settlement,
        rule:
          lossAmount > 0
            ? "Loss case: (invested - loss) credited to wallet"
            : "Gain/maturity case: (invested + interest) credited to wallet",
      },
    });
  } catch (error) {
    console.error("[FD] break error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to break FD",
      error: error.message,
    });
  }
}

async function breakRd(req, res) {
  console.log("[RD] break:", req.params.id, req.body);
  try {
    const id = Number(req.params.id);
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT * FROM portfolio_rds WHERE id = :id AND user_id = :userId AND status = 'active' LIMIT 1`,
      { id, userId }
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Active RD not found" });
    }

    const rd = rows[0];
    // Principal for RD break = instalments paid so far (default: monthly * tenure for full; override via body)
    const principal = Number(
      req.body.principal_amount ||
        req.body.invested_amount ||
        Number(rd.monthly_amount) * Number(rd.tenure_months)
    );
    const interestEarned = Number(req.body.interest_earned ?? req.body.interestEarned ?? 0);
    const lossAmount = Number(req.body.loss_amount ?? req.body.lossAmount ?? 0);

    if (interestEarned < 0 || lossAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "interest_earned and loss_amount cannot be negative",
      });
    }
    if (interestEarned > 0 && lossAmount > 0) {
      return res.status(400).json({
        success: false,
        message: "Provide either interest_earned (gain) or loss_amount (loss), not both",
      });
    }

    const settlement = await settleInvestmentToWallet({
      userId,
      productType: "RD",
      productId: id,
      principal,
      interestEarned,
      lossAmount,
      description: `RD #${id} break settlement`,
    });

    await pool.query(`UPDATE portfolio_rds SET status = 'closed' WHERE id = :id`, { id });

    await writeAuditLog({
      userId,
      action: "PORTFOLIO_RD_BREAK",
      entityType: "portfolio_rd",
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: settlement,
    });

    return res.json({
      success: true,
      message: "RD broken. Settlement credited to wallet.",
      data: {
        rd_id: id,
        settlement,
        rule:
          lossAmount > 0
            ? "Loss case: (invested - loss) credited to wallet"
            : "Gain/maturity case: (invested + interest) credited to wallet",
      },
    });
  } catch (error) {
    console.error("[RD] break error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to break RD",
      error: error.message,
    });
  }
}

async function deleteFd(req, res) {
  // Prefer break endpoint; soft-close without wallet credit kept for compatibility
  return breakFd(req, res);
}

async function deleteRd(req, res) {
  return breakRd(req, res);
}

module.exports = {
  getFdSummary,
  getRdSummary,
  listFds,
  addFd,
  listRds,
  addRd,
  deleteFd,
  deleteRd,
  breakFd,
  breakRd,
};
