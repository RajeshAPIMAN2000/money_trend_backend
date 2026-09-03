const mysql = require("mysql2/promise");
require("dotenv").config();

async function ensureDatabaseExists() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  });

  const dbName = process.env.DB_NAME || "money_trend";
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.end();
}

async function columnExists(pool, tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND COLUMN_NAME = :columnName`,
    { tableName, columnName }
  );
  return Number(rows[0]?.cnt || 0) > 0;
}

async function addColumnIfMissing(pool, tableName, columnName, definition) {
  const exists = await columnExists(pool, tableName, columnName);
  if (!exists) {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`);
  }
}

async function ensureCoreTables() {
  await ensureDatabaseExists();

  const pool = require("./db");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      full_name VARCHAR(150) NOT NULL,
      email VARCHAR(191) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      profile_image VARCHAR(500) NULL,
      role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
      kyc_status ENUM('pending', 'submitted', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
      kyc_method ENUM('manual', 'digilocker') NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(pool, "users", "date_of_birth", "date_of_birth DATE NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kyc_documents (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      method ENUM('manual', 'digilocker') NOT NULL DEFAULT 'manual',
      pan_number VARCHAR(20) NOT NULL,
      pan_full_name VARCHAR(150) NOT NULL,
      pan_image VARCHAR(500) NULL,
      aadhaar_number VARCHAR(20) NOT NULL,
      aadhaar_image VARCHAR(500) NULL,
      digilocker_ref VARCHAR(191) NULL,
      status ENUM('pending', 'submitted', 'verified', 'rejected') NOT NULL DEFAULT 'submitted',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kyc_user (user_id),
      CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nominees (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      nominee_name VARCHAR(150) NOT NULL,
      relationship VARCHAR(100) NOT NULL,
      date_of_birth DATE NOT NULL,
      mobile VARCHAR(20) NOT NULL,
      email VARCHAR(191) NOT NULL,
      address VARCHAR(500) NOT NULL,
      pan_number VARCHAR(255) NOT NULL,
      aadhaar_number VARCHAR(255) NOT NULL,
      pan_image VARCHAR(500) NULL,
      aadhaar_image VARCHAR(500) NULL,
      allocation_percent DECIMAL(5,2) NOT NULL DEFAULT 100.00,
      is_minor TINYINT(1) NOT NULL DEFAULT 0,
      guardian_name VARCHAR(150) NULL,
      guardian_relationship VARCHAR(100) NULL,
      status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_nominee_user (user_id),
      CONSTRAINT fk_nominee_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migrate older nominee schema safely
  await addColumnIfMissing(pool, "nominees", "mobile", "mobile VARCHAR(20) NULL");
  await addColumnIfMissing(pool, "nominees", "email", "email VARCHAR(191) NULL");
  await addColumnIfMissing(pool, "nominees", "address", "address VARCHAR(500) NULL");
  await addColumnIfMissing(pool, "nominees", "pan_image", "pan_image VARCHAR(500) NULL");
  await addColumnIfMissing(pool, "nominees", "aadhaar_image", "aadhaar_image VARCHAR(500) NULL");
  await addColumnIfMissing(
    pool,
    "nominees",
    "allocation_percent",
    "allocation_percent DECIMAL(5,2) NOT NULL DEFAULT 100.00"
  );
  await addColumnIfMissing(pool, "nominees", "is_minor", "is_minor TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing(pool, "nominees", "guardian_name", "guardian_name VARCHAR(150) NULL");
  await addColumnIfMissing(
    pool,
    "nominees",
    "guardian_relationship",
    "guardian_relationship VARCHAR(100) NULL"
  );
  await addColumnIfMissing(
    pool,
    "nominees",
    "status",
    "status ENUM('active', 'inactive') NOT NULL DEFAULT 'active'"
  );

  // Widen PAN/Aadhaar columns for encrypted storage
  try {
    await pool.query(`ALTER TABLE nominees MODIFY pan_number VARCHAR(255) NOT NULL`);
    await pool.query(`ALTER TABLE nominees MODIFY aadhaar_number VARCHAR(255) NOT NULL`);
  } catch (_e) {
    // ignore if already matching
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_refresh_user (user_id),
      CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(100) NOT NULL,
      entity_id INT UNSIGNED NULL,
      ip_address VARCHAR(64) NULL,
      user_agent VARCHAR(500) NULL,
      meta_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_audit_user (user_id),
      KEY idx_audit_action (action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_fds (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      bank_name VARCHAR(150) NOT NULL,
      bank_code VARCHAR(50) NULL,
      fd_number VARCHAR(100) NULL,
      principal_amount DECIMAL(14,2) NOT NULL,
      interest_rate DECIMAL(6,3) NOT NULL,
      tenure_months INT UNSIGNED NOT NULL,
      start_date DATE NOT NULL,
      maturity_date DATE NOT NULL,
      maturity_amount DECIMAL(14,2) NOT NULL,
      compounding VARCHAR(30) NOT NULL DEFAULT 'quarterly',
      notes VARCHAR(500) NULL,
      status ENUM('active', 'matured', 'closed') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_portfolio_fd_user (user_id),
      CONSTRAINT fk_portfolio_fd_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_rds (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      bank_name VARCHAR(150) NOT NULL,
      bank_code VARCHAR(50) NULL,
      rd_number VARCHAR(100) NULL,
      monthly_amount DECIMAL(14,2) NOT NULL,
      interest_rate DECIMAL(6,3) NOT NULL,
      tenure_months INT UNSIGNED NOT NULL,
      start_date DATE NOT NULL,
      maturity_date DATE NOT NULL,
      maturity_amount DECIMAL(14,2) NOT NULL,
      notes VARCHAR(500) NULL,
      status ENUM('active', 'matured', 'closed') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_portfolio_rd_user (user_id),
      CONSTRAINT fk_portfolio_rd_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      status ENUM('active', 'frozen') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_wallet_user (user_id),
      CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      wallet_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      direction ENUM('credit', 'debit') NOT NULL,
      category VARCHAR(50) NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      balance_after DECIMAL(14,2) NOT NULL,
      reference_type VARCHAR(50) NULL,
      reference_id INT UNSIGNED NULL,
      description VARCHAR(500) NULL,
      meta_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_wtx_user (user_id),
      KEY idx_wtx_category (category),
      CONSTRAINT fk_wtx_wallet FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE CASCADE,
      CONSTRAINT fk_wtx_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_deposits (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      razorpay_order_id VARCHAR(100) NOT NULL,
      razorpay_payment_id VARCHAR(100) NULL,
      razorpay_signature VARCHAR(255) NULL,
      receipt VARCHAR(100) NULL,
      status ENUM('created', 'paid', 'failed') NOT NULL DEFAULT 'created',
      credited_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_deposit_order (razorpay_order_id),
      KEY idx_deposit_user (user_id),
      CONSTRAINT fk_deposit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_bank_accounts (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      account_holder_name VARCHAR(150) NOT NULL,
      bank_name VARCHAR(150) NOT NULL,
      branch_name VARCHAR(150) NOT NULL,
      ifsc_code VARCHAR(20) NOT NULL,
      account_number_enc VARCHAR(500) NOT NULL,
      account_last4 VARCHAR(4) NOT NULL,
      is_primary TINYINT(1) NOT NULL DEFAULT 1,
      status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_bank_user (user_id),
      CONSTRAINT fk_bank_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      bank_account_id INT UNSIGNED NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      status ENUM('pending', 'approved', 'rejected', 'paid') NOT NULL DEFAULT 'pending',
      wallet_transaction_id BIGINT UNSIGNED NULL,
      admin_note VARCHAR(500) NULL,
      processed_by INT UNSIGNED NULL,
      processed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_withdraw_user (user_id),
      KEY idx_withdraw_status (status),
      CONSTRAINT fk_withdraw_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_withdraw_bank FOREIGN KEY (bank_account_id) REFERENCES user_bank_accounts (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_commissions (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      product_type ENUM('FD', 'RD') NOT NULL,
      product_id INT UNSIGNED NOT NULL,
      invest_amount DECIMAL(14,2) NOT NULL,
      commission_percent DECIMAL(5,2) NOT NULL,
      commission_amount DECIMAL(14,2) NOT NULL,
      status ENUM('collected', 'refunded') NOT NULL DEFAULT 'collected',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_comm_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_investment_records (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      product_type ENUM('FD', 'RD') NOT NULL,
      product_id INT UNSIGNED NOT NULL,
      financial_year VARCHAR(20) NOT NULL,
      principal_amount DECIMAL(14,2) NOT NULL,
      interest_earned DECIMAL(14,2) NOT NULL DEFAULT 0,
      loss_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      net_credit DECIMAL(14,2) NOT NULL,
      tax_section VARCHAR(100) NULL,
      remarks VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tax_user_fy (user_id, financial_year),
      CONSTRAINT fk_tax_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(
    pool,
    "users",
    "role",
    "role ENUM('user', 'admin') NOT NULL DEFAULT 'user'"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_checks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      bureau ENUM('CIBIL','EXPERIAN','EQUIFAX','CRIF') NOT NULL,
      pan_number VARCHAR(255) NOT NULL,
      score INT NULL,
      score_min INT NULL,
      score_max INT NULL,
      status ENUM('SUCCESS','NO_HIT','FAILED','PENDING') NOT NULL DEFAULT 'PENDING',
      report_ref_id VARCHAR(100) NULL,
      report_date DATE NULL,
      normalized_report JSON NULL,
      raw_response TEXT NULL,
      error_message VARCHAR(500) NULL,
      requested_by ENUM('USER','ADMIN','SYSTEM') NOT NULL DEFAULT 'USER',
      consent_given TINYINT(1) NOT NULL DEFAULT 0,
      consent_timestamp TIMESTAMP NULL,
      consent_ip VARCHAR(45) NULL,
      consent_version VARCHAR(20) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_bureau (user_id, bureau),
      KEY idx_created_at (created_at),
      CONSTRAINT fk_credit_check_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_check_accounts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      credit_check_id BIGINT UNSIGNED NOT NULL,
      account_type VARCHAR(100) NULL,
      lender VARCHAR(150) NULL,
      status VARCHAR(50) NULL,
      credit_limit DECIMAL(15,2) NULL,
      current_balance DECIMAL(15,2) NULL,
      overdue_amount DECIMAL(15,2) NULL,
      payment_history VARCHAR(200) NULL,
      PRIMARY KEY (id),
      KEY idx_credit_check_accounts_check (credit_check_id),
      CONSTRAINT fk_credit_check_accounts_check FOREIGN KEY (credit_check_id) REFERENCES credit_checks (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_check_enquiries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      credit_check_id BIGINT UNSIGNED NOT NULL,
      enquiry_date DATE NULL,
      lender VARCHAR(150) NULL,
      purpose VARCHAR(150) NULL,
      PRIMARY KEY (id),
      KEY idx_credit_check_enquiries_check (credit_check_id),
      CONSTRAINT fk_credit_check_enquiries_check FOREIGN KEY (credit_check_id) REFERENCES credit_checks (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_rd_rates (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      bank_name VARCHAR(150) NOT NULL,
      bank_code VARCHAR(50) NOT NULL,
      product_type ENUM('FD','RD') NOT NULL,
      interest_rate DECIMAL(6,3) NOT NULL,
      tenure INT UNSIGNED NOT NULL,
      tenure_unit ENUM('days','months','years') NOT NULL DEFAULT 'years',
      tenure_label VARCHAR(50) NOT NULL,
      min_deposit DECIMAL(15,2) NULL,
      max_deposit DECIMAL(15,2) NULL,
      customer_category ENUM('regular','senior-citizen') NOT NULL DEFAULT 'regular',
      senior_citizen_extra DECIMAL(4,2) NULL,
      effective_date DATE NOT NULL,
      expiry_date DATE NULL,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      source ENUM('bank_api','fallback','admin') NOT NULL DEFAULT 'bank_api',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_fd_rd_rate_identity (bank_code, product_type, tenure_label, customer_category),
      KEY idx_product_status_rate (product_type, status, interest_rate),
      KEY idx_bank_name (bank_name),
      KEY idx_effective_date (effective_date),
      KEY idx_status_expiry (status, expiry_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_banks (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      bank_code VARCHAR(50) NOT NULL,
      bank_name VARCHAR(150) NOT NULL,
      bank_type VARCHAR(50) NULL,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_market_bank_code (bank_code),
      KEY idx_market_bank_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fd_rd_rate_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      bank_code VARCHAR(50) NOT NULL,
      product_type ENUM('FD','RD') NOT NULL,
      tenure_label VARCHAR(50) NOT NULL,
      interest_rate DECIMAL(6,3) NOT NULL,
      customer_category ENUM('regular','senior-citizen') NOT NULL DEFAULT 'regular',
      snapshot_date DATE NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT 'bank_api',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_rate_history_identity
        (bank_code, product_type, tenure_label, customer_category, snapshot_date),
      KEY idx_history_bank_date (bank_code, snapshot_date),
      KEY idx_history_product (bank_code, product_type, snapshot_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const { seedMarketBanks } = require("../services/marketBankService");
  await seedMarketBanks();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_verifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      phone VARCHAR(20) NOT NULL,
      purpose ENUM('register','login','forgot_password') NOT NULL,
      otp_hash VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      verified TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_otp_phone_purpose (phone, purpose, verified),
      KEY idx_otp_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  try {
    await pool.query(
      `ALTER TABLE otp_verifications MODIFY purpose ENUM('register','login','forgot_password') NOT NULL`
    );
  } catch (error) {
    if (!String(error.message).includes("Duplicate")) {
      console.warn("[db_init] otp_verifications purpose enum:", error.message);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      type ENUM('blog','news') NOT NULL,
      heading VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      image VARCHAR(500) NULL,
      status ENUM('draft','published') NOT NULL DEFAULT 'published',
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_articles_type_status (type, status),
      KEY idx_articles_created_at (created_at),
      CONSTRAINT fk_articles_admin FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS banners (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      image VARCHAR(500) NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_banners_created_at (created_at),
      CONSTRAINT fk_banners_admin FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureDefaultAdmin(pool);
}

async function ensureDefaultAdmin(pool) {
  const bcrypt = require("bcryptjs");
  const adminEmail = process.env.ADMIN_EMAIL || "admin@moneytrend.in";
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123";
  const adminPhone = process.env.ADMIN_PHONE || "9999999999";

  const [existing] = await pool.query(
    `SELECT id FROM users WHERE email = :email OR role = 'admin' LIMIT 1`,
    { email: adminEmail }
  );

  if (existing.length) {
    await pool.query(`UPDATE users SET role = 'admin' WHERE id = :id`, { id: existing[0].id });
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await pool.query(
    `INSERT INTO users (full_name, email, password_hash, phone, role, kyc_status)
     VALUES (:fullName, :email, :passwordHash, :phone, 'admin', 'verified')`,
    {
      fullName: "Money Trend Admin",
      email: adminEmail,
      passwordHash,
      phone: adminPhone,
    }
  );
}

module.exports = { ensureCoreTables };
