const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../config/db");
const { signAccessToken, signRefreshToken } = require("../utils/jwt");
const { writeAuditLog } = require("../utils/audit");
const { getAdminDashboard } = require("../services/adminDashboardService");
const { listExportTypes, exportAdminData } = require("../services/adminExportService");
const investmentService = require("../services/adminInvestmentService");
const {
  getFundPerformanceComparison,
  getFundPerformanceByBankId,
} = require("../services/marketBankService");
const {
  decryptPii,
  maskAadhaar,
  maskPan,
  maskEmail,
  maskMobile,
} = require("../utils/security");
const {
  getLatestScores,
  getLatestScoresMapForUsers,
} = require("../services/creditCheckService");

async function storeRefreshToken(userId, refreshToken) {
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (:userId, :tokenHash, :expiresAt)`,
    { userId, tokenHash, expiresAt }
  );
}

function issueAdminTokens(admin, res) {
  const payload = { sub: admin.id, email: admin.email, role: "admin" };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return { accessToken, refreshToken };
}

function mapNominee(row) {
  if (!row) {
    return { added: false, message: "Nominee not added" };
  }
  const pan = decryptPii(row.pan_number) || row.pan_number;
  const aadhaar = decryptPii(row.aadhaar_number) || row.aadhaar_number;
  return {
    added: true,
    message: "Nominee added",
    nominee_name: row.nominee_name,
    relationship: row.relationship,
    date_of_birth: row.date_of_birth,
    mobile: maskMobile(row.mobile) || row.mobile,
    email: maskEmail(row.email) || row.email,
    address: row.address,
    pan_number: maskPan(pan),
    aadhaar_number: maskAadhaar(aadhaar),
    pan_image: row.pan_image,
    aadhaar_image: row.aadhaar_image,
    allocation_percent: row.allocation_percent,
    is_minor: Boolean(row.is_minor),
    guardian_name: row.guardian_name,
    guardian_relationship: row.guardian_relationship,
    status: row.status,
  };
}

function mapKyc(row) {
  if (!row) {
    return {
      submitted: false,
      message: "KYC not submitted",
    };
  }
  return {
    submitted: true,
    method: row.method,
    status: row.status,
    pan_number: maskPan(row.pan_number) || row.pan_number,
    pan_full_name: row.pan_full_name,
    pan_image: row.pan_image,
    aadhaar_number: maskAadhaar(row.aadhaar_number) || row.aadhaar_number,
    aadhaar_image: row.aadhaar_image,
    digilocker_ref: row.digilocker_ref,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function adminLogin(req, res) {
  console.log("[ADMIN] login body:", { email: req.body?.email, password: req.body?.password ? "***" : undefined });
  try {
    const email = String(req.body.email || req.body.user_id || req.body.userId || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Admin email/user id and password are required",
      });
    }

    const [rows] = await pool.query(
      `SELECT id, full_name, email, phone, password_hash, role
       FROM users WHERE email = :email LIMIT 1`,
      { email }
    );

    if (!rows.length || rows[0].role !== "admin") {
      return res.status(401).json({ success: false, message: "Invalid admin credentials" });
    }

    const admin = rows[0];
    const matched = await bcrypt.compare(password, admin.password_hash);
    if (!matched) {
      return res.status(401).json({ success: false, message: "Invalid admin credentials" });
    }

    const tokens = issueAdminTokens(admin, res);
    await storeRefreshToken(admin.id, tokens.refreshToken);

    await writeAuditLog({
      userId: admin.id,
      action: "ADMIN_LOGIN",
      entityType: "admin",
      entityId: admin.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({
      success: true,
      message: "Admin login successful",
      data: {
        admin: {
          id: admin.id,
          full_name: admin.full_name,
          email: admin.email,
          phone: admin.phone,
          role: "admin",
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  } catch (error) {
    console.error("[ADMIN] login error:", error);
    return res.status(500).json({
      success: false,
      message: "Admin login failed",
      error: error.message,
    });
  }
}

async function listUsers(req, res) {
  console.log("[ADMIN] list users by:", req.user?.id);
  try {
    const status = String(req.query.kyc_status || req.query.status || "").trim().toLowerCase();
    const params = {};
    let where = `WHERE u.role = 'user'`;

    if (status && ["pending", "submitted", "verified", "rejected"].includes(status)) {
      where += ` AND u.kyc_status = :status`;
      params.status = status;
    }

    const [rows] = await pool.query(
      `SELECT
         u.id, u.full_name, u.email, u.phone, u.profile_image, u.role,
         u.kyc_status, u.kyc_method, u.created_at, u.updated_at,
         k.method AS kyc_doc_method, k.status AS kyc_doc_status,
         k.pan_number, k.pan_full_name, k.pan_image,
         k.aadhaar_number, k.aadhaar_image, k.digilocker_ref,
         k.created_at AS kyc_submitted_at,
         n.nominee_name, n.relationship, n.date_of_birth AS nominee_dob,
         n.mobile AS nominee_mobile, n.email AS nominee_email, n.address AS nominee_address,
         n.pan_number AS nominee_pan, n.aadhaar_number AS nominee_aadhaar,
         n.pan_image AS nominee_pan_image, n.aadhaar_image AS nominee_aadhaar_image,
         n.allocation_percent, n.is_minor, n.guardian_name, n.guardian_relationship,
         n.status AS nominee_status
       FROM users u
       LEFT JOIN kyc_documents k ON k.user_id = u.id
       LEFT JOIN nominees n ON n.user_id = u.id
       ${where}
       ORDER BY u.created_at DESC`,
      params
    );

    const usersBase = rows.map((row) => ({
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      profile_image: row.profile_image,
      role: row.role,
      kyc_status: row.kyc_status,
      kyc_method: row.kyc_method,
      created_at: row.created_at,
      updated_at: row.updated_at,
      kyc: mapKyc(
        row.pan_number
          ? {
              method: row.kyc_doc_method,
              status: row.kyc_doc_status,
              pan_number: row.pan_number,
              pan_full_name: row.pan_full_name,
              pan_image: row.pan_image,
              aadhaar_number: row.aadhaar_number,
              aadhaar_image: row.aadhaar_image,
              digilocker_ref: row.digilocker_ref,
              created_at: row.kyc_submitted_at,
            }
          : null
      ),
      nominee: mapNominee(
        row.nominee_name
          ? {
              nominee_name: row.nominee_name,
              relationship: row.relationship,
              date_of_birth: row.nominee_dob,
              mobile: row.nominee_mobile,
              email: row.nominee_email,
              address: row.nominee_address,
              pan_number: row.nominee_pan,
              aadhaar_number: row.nominee_aadhaar,
              pan_image: row.nominee_pan_image,
              aadhaar_image: row.nominee_aadhaar_image,
              allocation_percent: row.allocation_percent,
              is_minor: row.is_minor,
              guardian_name: row.guardian_name,
              guardian_relationship: row.guardian_relationship,
              status: row.nominee_status,
            }
          : null
      ),
    }));

    const scoreMap = await getLatestScoresMapForUsers(usersBase.map((u) => u.id));
    const users = usersBase.map((u) => ({
      ...u,
      credit_score: scoreMap[u.id] || {
        cibil_score: null,
        experian_score: null,
        primary_score: null,
      },
    }));

    return res.json({
      success: true,
      message: "Registered users fetched successfully",
      data: {
        count: users.length,
        users,
      },
    });
  } catch (error) {
    console.error("[ADMIN] list users error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
}

async function getUserById(req, res) {
  console.log("[ADMIN] get user:", req.params.id);
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      return res.status(400).json({ success: false, message: "Valid user id is required" });
    }

    const [rows] = await pool.query(
      `SELECT id, full_name, email, phone, profile_image, role, kyc_status, kyc_method, created_at, updated_at
       FROM users WHERE id = :userId AND role = 'user' LIMIT 1`,
      { userId }
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = rows[0];

    const [kycRows] = await pool.query(
      `SELECT method, status, pan_number, pan_full_name, pan_image, aadhaar_number, aadhaar_image,
              digilocker_ref, created_at, updated_at
       FROM kyc_documents WHERE user_id = :userId LIMIT 1`,
      { userId }
    );

    const [nomineeRows] = await pool.query(
      `SELECT nominee_name, relationship, date_of_birth, mobile, email, address,
              pan_number, aadhaar_number, pan_image, aadhaar_image, allocation_percent,
              is_minor, guardian_name, guardian_relationship, status
       FROM nominees WHERE user_id = :userId LIMIT 1`,
      { userId }
    );

    const creditScores = await getLatestScores(userId);

    return res.json({
      success: true,
      message: "User details fetched successfully",
      data: {
        user,
        kyc: mapKyc(kycRows[0] || null),
        nominee: mapNominee(nomineeRows[0] || null),
        credit_score: {
          primary_score: creditScores.primary_score,
          cibil_score: creditScores.cibil_score,
          scores_by_bureau: creditScores.scores_by_bureau,
          latest_checks: creditScores.latest_checks,
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN] get user error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user",
      error: error.message,
    });
  }
}

async function updateUserKycStatus(req, res) {
  console.log("[ADMIN] update kyc status:", req.params.id, "body:", req.body);
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      return res.status(400).json({ success: false, message: "Valid user id is required" });
    }

    const rawStatus = String(req.body?.status || "").trim().toLowerCase();
    const reason = String(req.body?.reason || "").trim() || null;

    let kycStatus = null;
    if (rawStatus === "approved" || rawStatus === "approve" || rawStatus === "verified") {
      kycStatus = "verified";
    } else if (rawStatus === "rejected" || rawStatus === "reject") {
      kycStatus = "rejected";
    } else {
      return res.status(400).json({
        success: false,
        message: 'status must be "approved" or "rejected"',
      });
    }

    const [users] = await pool.query(
      `SELECT id, full_name, email, kyc_status, kyc_method
       FROM users WHERE id = :userId AND role = 'user' LIMIT 1`,
      { userId }
    );

    if (!users.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const [kycRows] = await pool.query(
      `SELECT id, method, status FROM kyc_documents WHERE user_id = :userId LIMIT 1`,
      { userId }
    );

    if (!kycRows.length) {
      return res.status(400).json({
        success: false,
        message: "User has not submitted KYC documents yet",
      });
    }

    if (users[0].kyc_status === kycStatus && kycRows[0].status === kycStatus) {
      return res.json({
        success: true,
        message: kycStatus === "verified"
          ? "User documents already approved"
          : "User documents already rejected",
        data: {
          user_id: userId,
          status: kycStatus === "verified" ? "approved" : "rejected",
          kyc_status: kycStatus,
          kyc_method: kycRows[0].method,
        },
      });
    }

    await pool.query(
      `UPDATE kyc_documents SET status = :kycStatus WHERE user_id = :userId`,
      { userId, kycStatus }
    );

    if (kycStatus === "verified") {
      await pool.query(
        `UPDATE users SET kyc_status = 'verified', kyc_method = :method WHERE id = :userId`,
        { userId, method: kycRows[0].method }
      );
    } else {
      await pool.query(
        `UPDATE users SET kyc_status = 'rejected' WHERE id = :userId`,
        { userId }
      );
    }

    await writeAuditLog({
      userId: req.user.id,
      action: kycStatus === "verified" ? "ADMIN_APPROVE_USER_KYC" : "ADMIN_REJECT_USER_KYC",
      entityType: "user",
      entityId: userId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: {
        user_email: users[0].email,
        kyc_method: kycRows[0].method,
        status: kycStatus === "verified" ? "approved" : "rejected",
        reason,
      },
    });

    return res.json({
      success: true,
      message: kycStatus === "verified"
        ? "User documents approved successfully"
        : "User documents rejected",
      data: {
        user_id: userId,
        full_name: users[0].full_name,
        email: users[0].email,
        status: kycStatus === "verified" ? "approved" : "rejected",
        kyc_status: kycStatus,
        kyc_method: kycRows[0].method,
        reason: kycStatus === "rejected" ? reason : null,
        updated_by: req.user.email,
      },
    });
  } catch (error) {
    console.error("[ADMIN] update kyc status error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update KYC status",
      error: error.message,
    });
  }
}

async function listWithdrawals(req, res) {
  console.log("[ADMIN] list withdrawals");
  try {
    const status = String(req.query.status || "").trim().toLowerCase();
    const params = {};
    let where = "WHERE 1=1";
    if (status && ["pending", "approved", "rejected", "paid"].includes(status)) {
      where += " AND w.status = :status";
      params.status = status;
    }

    const [rows] = await pool.query(
      `SELECT w.id, w.user_id, w.amount, w.status, w.admin_note, w.created_at, w.processed_at,
              u.full_name, u.email, u.phone,
              b.account_holder_name, b.bank_name, b.branch_name, b.ifsc_code,
              b.account_number_enc, b.account_last4
       FROM withdrawal_requests w
       JOIN users u ON u.id = w.user_id
       JOIN user_bank_accounts b ON b.id = w.bank_account_id
       ${where}
       ORDER BY w.created_at DESC
       LIMIT 200`,
      params
    );

    const { decryptPii } = require("../utils/security");
    const withdrawals = rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      full_name: r.full_name,
      email: r.email,
      phone: r.phone,
      amount: r.amount,
      status: r.status,
      admin_note: r.admin_note,
      created_at: r.created_at,
      processed_at: r.processed_at,
      bank: {
        account_holder_name: r.account_holder_name,
        bank_name: r.bank_name,
        branch_name: r.branch_name,
        ifsc_code: r.ifsc_code,
        account_number: decryptPii(r.account_number_enc) || null,
        account_last4: r.account_last4,
      },
    }));

    return res.json({
      success: true,
      message: "Withdrawal requests fetched",
      data: { count: withdrawals.length, withdrawals },
    });
  } catch (error) {
    console.error("[ADMIN] list withdrawals error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list withdrawals",
      error: error.message,
    });
  }
}

async function processWithdrawal(req, res) {
  console.log("[ADMIN] process withdrawal:", req.params.id, req.body);
  try {
    const id = Number(req.params.id);
    const status = String(req.body.status || "").trim().toLowerCase();
    const adminNote = String(req.body.admin_note || req.body.note || "").trim() || null;

    if (!["approved", "rejected", "paid"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status must be "approved", "paid" or "rejected"',
      });
    }

    const [rows] = await pool.query(
      `SELECT * FROM withdrawal_requests WHERE id = :id LIMIT 1`,
      { id }
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Withdrawal not found" });
    }

    const w = rows[0];
    if (["paid", "rejected"].includes(w.status)) {
      return res.status(400).json({
        success: false,
        message: `Withdrawal already ${w.status}`,
      });
    }

    if (status === "rejected") {
      // Refund hold back to wallet
      const { creditWallet } = require("../services/walletService");
      await creditWallet({
        userId: w.user_id,
        amount: w.amount,
        category: "withdrawal_refund",
        referenceType: "withdrawal_request",
        referenceId: id,
        description: "Withdrawal rejected — amount returned to wallet",
      });
    }

    await pool.query(
      `UPDATE withdrawal_requests
       SET status = :status,
           admin_note = :adminNote,
           processed_by = :adminId,
           processed_at = NOW()
       WHERE id = :id`,
      { status, adminNote, adminId: req.user.id, id }
    );

    await writeAuditLog({
      userId: req.user.id,
      action: "ADMIN_WITHDRAWAL_PROCESS",
      entityType: "withdrawal_request",
      entityId: id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      meta: { status, amount: w.amount, user_id: w.user_id },
    });

    return res.json({
      success: true,
      message:
        status === "paid"
          ? "Marked paid — ensure NEFT/IMPS to user bank account is completed"
          : status === "approved"
            ? "Withdrawal approved — process bank transfer then mark paid"
            : "Withdrawal rejected and amount refunded to wallet",
      data: { withdrawal_id: id, status },
    });
  } catch (error) {
    console.error("[ADMIN] process withdrawal error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process withdrawal",
      error: error.message,
    });
  }
}

async function getUserBankAccountAdmin(req, res) {
  try {
    const userId = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT b.*, u.full_name, u.email, u.phone
       FROM user_bank_accounts b
       JOIN users u ON u.id = b.user_id
       WHERE b.user_id = :userId LIMIT 1`,
      { userId }
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Bank account not found for user" });
    }
    const { decryptPii } = require("../utils/security");
    const r = rows[0];
    return res.json({
      success: true,
      message: "User bank account (admin view)",
      data: {
        user: { id: userId, full_name: r.full_name, email: r.email, phone: r.phone },
        bank: {
          account_holder_name: r.account_holder_name,
          bank_name: r.bank_name,
          branch_name: r.branch_name,
          ifsc_code: r.ifsc_code,
          account_number: decryptPii(r.account_number_enc),
          account_last4: r.account_last4,
          status: r.status,
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN] get bank error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bank account",
      error: error.message,
    });
  }
}

async function listCommissions(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, u.full_name, u.email
       FROM admin_commissions c
       JOIN users u ON u.id = c.user_id
       ORDER BY c.id DESC
       LIMIT 200`
    );
    const total = rows.reduce((s, r) => s + Number(r.commission_amount || 0), 0);
    return res.json({
      success: true,
      message: "Admin commission ledger (2–3% of invested amount)",
      data: {
        commission_percent_config: Number(process.env.ADMIN_COMMISSION_PERCENT || 2.5),
        total_collected: Math.round(total * 100) / 100,
        count: rows.length,
        commissions: rows,
      },
    });
  } catch (error) {
    console.error("[ADMIN] commissions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list commissions",
      error: error.message,
    });
  }
}

async function getDashboard(req, res) {
  try {
    const data = await getAdminDashboard(req.query);
    return res.json({
      success: true,
      message: "Admin dashboard data fetched",
      data,
    });
  } catch (error) {
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("[ADMIN] dashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin dashboard",
      error: error.message,
    });
  }
}

function handleInvestmentError(res, error, fallback) {
  console.error(fallback, error.message);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

async function listAdminFixedDeposits(req, res) {
  try {
    const data = await investmentService.listFixedDeposits(req.query);
    return res.json({ success: true, message: "Fixed deposits fetched", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch fixed deposits");
  }
}

async function getAdminFixedDepositById(req, res) {
  try {
    const item = await investmentService.getFixedDepositById(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: "Fixed deposit not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch fixed deposit");
  }
}

async function listAdminRecurringDeposits(req, res) {
  try {
    const data = await investmentService.listRecurringDeposits(req.query);
    return res.json({ success: true, message: "Recurring deposits fetched", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch recurring deposits");
  }
}

async function getAdminRecurringDepositById(req, res) {
  try {
    const item = await investmentService.getRecurringDepositById(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: "Recurring deposit not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch recurring deposit");
  }
}

async function listAdminPortfolios(req, res) {
  try {
    const data = await investmentService.listPortfolios(req.query);
    return res.json({ success: true, message: "User portfolios fetched", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch portfolios");
  }
}

async function getAdminPortfolioByUserId(req, res) {
  try {
    const data = await investmentService.getPortfolioByUserId(Number(req.params.userId));
    if (!data) return res.status(404).json({ success: false, message: "User portfolio not found" });
    return res.json({ success: true, message: "User portfolio details", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch user portfolio");
  }
}

async function listAdminDeposits(req, res) {
  try {
    const data = await investmentService.listDeposits(req.query);
    return res.json({ success: true, message: "Deposits fetched", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch deposits");
  }
}

async function getAdminDepositById(req, res) {
  try {
    const item = await investmentService.getDepositById(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: "Deposit not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch deposit");
  }
}

async function getAdminUserDepositSummary(req, res) {
  try {
    const data = await investmentService.getUserDepositSummary(Number(req.params.userId));
    if (!data) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, message: "User deposit summary", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch user deposit summary");
  }
}

async function getAdminWithdrawalById(req, res) {
  try {
    const item = await investmentService.getWithdrawalById(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: "Withdrawal not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch withdrawal");
  }
}

async function listAdminOrders(req, res) {
  try {
    const data = await investmentService.listOrders(req.query);
    return res.json({ success: true, message: "Investment orders fetched", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch orders");
  }
}

async function getAdminOrderById(req, res) {
  try {
    const item = await investmentService.getOrderById(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: "Order not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch order");
  }
}

async function listAdminTransactionHistory(req, res) {
  try {
    const data = await investmentService.listTransactionHistory(req.query);
    return res.json({ success: true, message: "Transaction history fetched", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch transaction history");
  }
}

async function getAdminTransactionById(req, res) {
  try {
    const item = await investmentService.getTransactionById(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: "Transaction not found" });
    return res.json({ success: true, data: item });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch transaction");
  }
}

function parseFundPerformanceQuery(query) {
  const bankIds = String(query.bank_ids || query.bankIds || "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter(Boolean);

  return {
    period: query.period || "1_year",
    tenure: query.tenure || query.tenure_label || "1_year",
    category: query.category || "regular",
    productType: query.type || query.productType || "FD",
    principal: query.principal || query.fd_principal || 100000,
    monthlyAmount: query.monthly_amount || query.monthlyAmount || 5000,
    bankIds: bankIds.length ? bankIds : undefined,
  };
}

async function getAdminFundPerformance(req, res) {
  try {
    const [comparison, platformStats] = await Promise.all([
      getFundPerformanceComparison(parseFundPerformanceQuery(req.query)),
      investmentService.getPlatformInvestmentByBank(),
    ]);

    return res.json({
      success: true,
      message: "Fund performance comparison fetched",
      data: {
        ...comparison,
        platform_investments: platformStats,
      },
    });
  } catch (error) {
    if (error.code === "VALIDATION_ERROR" || error.code === "NOT_FOUND") {
      return res.status(error.code === "NOT_FOUND" ? 404 : 400).json({
        success: false,
        message: error.message,
      });
    }
    return handleInvestmentError(res, error, "Failed to fetch fund performance");
  }
}

async function getAdminFundPerformanceByBankId(req, res) {
  try {
    const data = await getFundPerformanceByBankId(
      Number(req.params.bankId),
      parseFundPerformanceQuery(req.query)
    );
    return res.json({
      success: true,
      message: `Fund performance for ${data.bank.bankName}`,
      data,
    });
  } catch (error) {
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleInvestmentError(res, error, "Failed to fetch bank fund performance");
  }
}

async function getAdminFdAssetAllocation(req, res) {
  try {
    const data = await investmentService.getFdAssetAllocation(req.query);
    return res.json({ success: true, message: "FD asset allocation fetched", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch FD asset allocation");
  }
}

async function getAdminRdAssetAllocation(req, res) {
  try {
    const data = await investmentService.getRdAssetAllocation(req.query);
    return res.json({ success: true, message: "RD asset allocation fetched", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch RD asset allocation");
  }
}

async function getAdminAssetAllocation(req, res) {
  try {
    const data = await investmentService.getAssetAllocationOverview(req.query);
    return res.json({ success: true, message: "Asset allocation overview fetched", data });
  } catch (error) {
    return handleInvestmentError(res, error, "Failed to fetch asset allocation");
  }
}

async function listExports(req, res) {
  try {
    const types = listExportTypes();
    const grouped = types.reduce((acc, item) => {
      if (!acc[item.group]) acc[item.group] = [];
      acc[item.group].push(item);
      return acc;
    }, {});

    return res.json({
      success: true,
      message: "Available admin export types",
      data: { types, grouped },
    });
  } catch (error) {
    console.error("[ADMIN] list exports error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list export types",
      error: error.message,
    });
  }
}

async function downloadExport(req, res) {
  try {
    const result = await exportAdminData(req.params.type, req.query);

    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.setHeader("Content-Type", result.mimeType);

    if (result.format === "xlsx") {
      return res.send(result.buffer);
    }

    return res.send(result.content);
  } catch (error) {
    if (error.code === "INVALID_TYPE" || error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("[ADMIN] export error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export data",
      error: error.message,
    });
  }
}

module.exports = {
  adminLogin,
  getDashboard,
  listExports,
  downloadExport,
  listAdminFixedDeposits,
  getAdminFixedDepositById,
  listAdminRecurringDeposits,
  getAdminRecurringDepositById,
  listAdminPortfolios,
  getAdminPortfolioByUserId,
  listAdminDeposits,
  getAdminDepositById,
  getAdminUserDepositSummary,
  getAdminWithdrawalById,
  listAdminOrders,
  getAdminOrderById,
  listAdminTransactionHistory,
  getAdminTransactionById,
  getAdminFundPerformance,
  getAdminFundPerformanceByBankId,
  getAdminFdAssetAllocation,
  getAdminRdAssetAllocation,
  getAdminAssetAllocation,
  listUsers,
  getUserById,
  updateUserKycStatus,
  listWithdrawals,
  processWithdrawal,
  getUserBankAccountAdmin,
  listCommissions,
};
