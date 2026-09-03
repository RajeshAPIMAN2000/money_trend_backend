const pool = require("../config/db");

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function getCommissionPercent() {
  const pct = Number(process.env.ADMIN_COMMISSION_PERCENT || 2.5);
  if (Number.isNaN(pct) || pct < 2 || pct > 3) return 2.5;
  return pct;
}

async function ensureWallet(userId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT id, user_id, balance, currency, status FROM wallets WHERE user_id = :userId LIMIT 1`,
    { userId }
  );
  if (rows.length) return rows[0];

  await connection.query(
    `INSERT INTO wallets (user_id, balance, currency, status) VALUES (:userId, 0, 'INR', 'active')`,
    { userId }
  );
  const [created] = await connection.query(
    `SELECT id, user_id, balance, currency, status FROM wallets WHERE user_id = :userId LIMIT 1`,
    { userId }
  );
  return created[0];
}

async function getBalance(userId) {
  const wallet = await ensureWallet(userId);
  return roundMoney(wallet.balance);
}

/**
 * Credit or debit wallet inside an optional transaction connection.
 * type: credit | debit
 */
async function mutateWallet({
  userId,
  amount,
  direction, // 'credit' | 'debit'
  category,
  referenceType = null,
  referenceId = null,
  description = null,
  meta = null,
  connection = null,
}) {
  const conn = connection || (await pool.getConnection());
  const ownConnection = !connection;

  try {
    if (ownConnection) await conn.beginTransaction();

    const wallet = await ensureWallet(userId, conn);
    const value = roundMoney(amount);
    if (value <= 0) {
      const err = new Error("Amount must be greater than zero");
      err.code = "INVALID_AMOUNT";
      throw err;
    }

    const current = roundMoney(wallet.balance);
    let next = current;
    if (direction === "credit") {
      next = roundMoney(current + value);
    } else if (direction === "debit") {
      if (current < value) {
        const err = new Error("Insufficient wallet balance");
        err.code = "INSUFFICIENT_BALANCE";
        err.balance = current;
        err.required = value;
        throw err;
      }
      next = roundMoney(current - value);
    } else {
      throw new Error("Invalid wallet direction");
    }

    await conn.query(`UPDATE wallets SET balance = :next WHERE id = :id`, {
      next,
      id: wallet.id,
    });

    const [tx] = await conn.query(
      `INSERT INTO wallet_transactions
        (wallet_id, user_id, direction, category, amount, balance_after,
         reference_type, reference_id, description, meta_json)
       VALUES
        (:walletId, :userId, :direction, :category, :amount, :balanceAfter,
         :referenceType, :referenceId, :description, :metaJson)`,
      {
        walletId: wallet.id,
        userId,
        direction,
        category,
        amount: value,
        balanceAfter: next,
        referenceType,
        referenceId,
        description,
        metaJson: meta ? JSON.stringify(meta) : null,
      }
    );

    if (ownConnection) await conn.commit();

    return {
      transaction_id: tx.insertId,
      balance: next,
      amount: value,
      direction,
      category,
    };
  } catch (error) {
    if (ownConnection) await conn.rollback();
    throw error;
  } finally {
    if (ownConnection) conn.release();
  }
}

async function creditWallet(params) {
  return mutateWallet({ ...params, direction: "credit" });
}

async function debitWallet(params) {
  return mutateWallet({ ...params, direction: "debit" });
}

/**
 * Invest: debit principal from wallet + deduct admin commission (2–3%).
 * Commission is taken from wallet as platform fee (RBI-aligned fee disclosure).
 */
async function investFromWallet({
  userId,
  investAmount,
  productType,
  productId,
  description,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const principal = roundMoney(investAmount);
    const commissionPct = getCommissionPercent();
    const commission = roundMoney((principal * commissionPct) / 100);
    const totalDebit = roundMoney(principal + commission);

    const wallet = await ensureWallet(userId, conn);
    if (roundMoney(wallet.balance) < totalDebit) {
      const err = new Error(
        `Insufficient wallet balance. Need ₹${totalDebit} (investment ₹${principal} + admin fee ${commissionPct}% = ₹${commission})`
      );
      err.code = "INSUFFICIENT_BALANCE";
      err.balance = roundMoney(wallet.balance);
      err.required = totalDebit;
      throw err;
    }

    const investTx = await mutateWallet({
      userId,
      amount: principal,
      direction: "debit",
      category: productType === "FD" ? "fd_invest" : "rd_invest",
      referenceType: productType === "FD" ? "portfolio_fd" : "portfolio_rd",
      referenceId: productId,
      description: description || `${productType} investment`,
      meta: { principal, commission_percent: commissionPct },
      connection: conn,
    });

    const feeTx = await mutateWallet({
      userId,
      amount: commission,
      direction: "debit",
      category: "admin_commission",
      referenceType: productType === "FD" ? "portfolio_fd" : "portfolio_rd",
      referenceId: productId,
      description: `Platform fee ${commissionPct}% on ${productType} investment (disclosed fee)`,
      meta: { commission_percent: commissionPct, on_amount: principal },
      connection: conn,
    });

    await conn.query(
      `INSERT INTO admin_commissions
        (user_id, product_type, product_id, invest_amount, commission_percent, commission_amount, status)
       VALUES
        (:userId, :productType, :productId, :investAmount, :commissionPercent, :commissionAmount, 'collected')`,
      {
        userId,
        productType,
        productId,
        investAmount: principal,
        commissionPercent: commissionPct,
        commissionAmount: commission,
      }
    );

    await conn.commit();
    return {
      principal,
      commission,
      commission_percent: commissionPct,
      total_debited: totalDebit,
      balance: feeTx.balance,
      invest_transaction_id: investTx.transaction_id,
      fee_transaction_id: feeTx.transaction_id,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Break FD/RD:
 * - gain: credit principal + interest
 * - loss: credit principal - lossAmount
 * Also writes income-tax reportable interest (if any).
 */
async function settleInvestmentToWallet({
  userId,
  productType,
  productId,
  principal,
  interestEarned = 0,
  lossAmount = 0,
  financialYear,
  description,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const p = roundMoney(principal);
    const interest = roundMoney(Math.max(interestEarned, 0));
    const loss = roundMoney(Math.max(lossAmount, 0));
    const creditAmount = roundMoney(p + interest - loss);

    if (creditAmount < 0) {
      throw new Error("Settlement amount cannot be negative");
    }

    const category =
      interest > 0
        ? productType === "FD"
          ? "fd_break_credit"
          : "rd_break_credit"
        : loss > 0
          ? productType === "FD"
            ? "fd_break_loss"
            : "rd_break_loss"
          : productType === "FD"
            ? "fd_break_credit"
            : "rd_break_credit";

    const tx = await mutateWallet({
      userId,
      amount: creditAmount,
      direction: "credit",
      category,
      referenceType: productType === "FD" ? "portfolio_fd" : "portfolio_rd",
      referenceId: productId,
      description:
        description ||
        `${productType} break settlement: principal ₹${p}` +
          (interest > 0 ? ` + interest ₹${interest}` : "") +
          (loss > 0 ? ` - loss ₹${loss}` : ""),
      meta: { principal: p, interest, loss, credit_amount: creditAmount },
      connection: conn,
    });

    // Income tax reportable interest (ITR – Interest from deposits / other sources)
    if (interest > 0) {
      const fy = financialYear || currentFinancialYear();
      await conn.query(
        `INSERT INTO tax_investment_records
          (user_id, product_type, product_id, financial_year, principal_amount,
           interest_earned, loss_amount, net_credit, tax_section, remarks)
         VALUES
          (:userId, :productType, :productId, :fy, :principal,
           :interest, :loss, :netCredit, '194A/Interest on deposits', :remarks)`,
        {
          userId,
          productType,
          productId,
          fy,
          principal: p,
          interest,
          loss,
          netCredit: creditAmount,
          remarks:
            "Reportable interest income for ITR under Interest from Savings/Deposits (as applicable). TDS may apply u/s 194A if annual interest exceeds threshold.",
        }
      );
    } else if (loss > 0) {
      const fy = financialYear || currentFinancialYear();
      await conn.query(
        `INSERT INTO tax_investment_records
          (user_id, product_type, product_id, financial_year, principal_amount,
           interest_earned, loss_amount, net_credit, tax_section, remarks)
         VALUES
          (:userId, :productType, :productId, :fy, :principal,
           0, :loss, :netCredit, 'Capital/Deposit settlement', :remarks)`,
        {
          userId,
          productType,
          productId,
          fy,
          principal: p,
          loss,
          netCredit: creditAmount,
          remarks: "Deposit break with loss — net amount credited to wallet for ITR trail.",
        }
      );
    }

    await conn.commit();
    return {
      credited: creditAmount,
      principal: p,
      interest,
      loss,
      balance: tx.balance,
      transaction_id: tx.transaction_id,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function currentFinancialYear(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month >= 4) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

module.exports = {
  roundMoney,
  getCommissionPercent,
  ensureWallet,
  getBalance,
  creditWallet,
  debitWallet,
  investFromWallet,
  settleInvestmentToWallet,
  currentFinancialYear,
};
