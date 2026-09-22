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
      role ENUM('user', 'admin', 'sub_admin') NOT NULL DEFAULT 'user',
      kyc_status ENUM('pending', 'submitted', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
      kyc_method ENUM('manual', 'digilocker') NULL,
      staff_permissions JSON NULL,
      staff_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(pool, "users", "date_of_birth", "date_of_birth DATE NULL");
  await addColumnIfMissing(pool, "users", "email_verified_at", "email_verified_at DATETIME NULL");
  await addColumnIfMissing(pool, "users", "staff_permissions", "staff_permissions JSON NULL");
  await addColumnIfMissing(
    pool,
    "users",
    "staff_active",
    "staff_active TINYINT(1) NOT NULL DEFAULT 1"
  );

  try {
    await pool.query(
      `ALTER TABLE users MODIFY COLUMN role ENUM('user', 'admin', 'sub_admin') NOT NULL DEFAULT 'user'`
    );
  } catch (err) {
    console.warn("[DB] users.role ENUM widen skipped:", err.message);
  }

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
      installments_paid INT UNSIGNED NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_portfolio_rd_user (user_id),
      CONSTRAINT fk_portfolio_rd_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(
    pool,
    "portfolio_rds",
    "installments_paid",
    "installments_paid INT UNSIGNED NOT NULL DEFAULT 1 AFTER status"
  );

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
      bank_account_id INT UNSIGNED NULL,
      amount DECIMAL(14,2) NOT NULL,
      status ENUM('pending', 'approved', 'rejected', 'paid', 'processing', 'failed') NOT NULL DEFAULT 'pending',
      method ENUM('bank', 'upi') NOT NULL DEFAULT 'bank',
      upi_id VARCHAR(150) NULL,
      demo_ref VARCHAR(40) NULL,
      wallet_transaction_id BIGINT UNSIGNED NULL,
      admin_note VARCHAR(500) NULL,
      processed_by INT UNSIGNED NULL,
      processed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_withdraw_user (user_id),
      KEY idx_withdraw_status (status),
      CONSTRAINT fk_withdraw_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(
    pool,
    "withdrawal_requests",
    "method",
    "method ENUM('bank','upi') NOT NULL DEFAULT 'bank' AFTER amount"
  );
  await addColumnIfMissing(
    pool,
    "withdrawal_requests",
    "upi_id",
    "upi_id VARCHAR(150) NULL AFTER method"
  );
  await addColumnIfMissing(
    pool,
    "withdrawal_requests",
    "demo_ref",
    "demo_ref VARCHAR(40) NULL AFTER upi_id"
  );
  // Allow NULL bank_account_id for UPI withdrawals (existing DBs may have NOT NULL)
  try {
    await pool.query(
      `ALTER TABLE withdrawal_requests MODIFY COLUMN bank_account_id INT UNSIGNED NULL`
    );
  } catch (e) {
    console.warn("[DB] withdrawal bank_account_id nullable:", e.message);
  }
  try {
    await pool.query(
      `ALTER TABLE withdrawal_requests
       MODIFY COLUMN status ENUM('pending','approved','rejected','paid','processing','failed')
       NOT NULL DEFAULT 'pending'`
    );
  } catch (e) {
    console.warn("[DB] withdrawal status enum migrate:", e.message);
  }

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
    "role ENUM('user', 'admin', 'sub_admin') NOT NULL DEFAULT 'user'"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_checks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NULL,
      guest_phone VARCHAR(20) NULL,
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
      KEY idx_guest_phone_bureau (guest_phone, bureau),
      KEY idx_created_at (created_at),
      CONSTRAINT fk_credit_check_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  try {
    await pool.query(`ALTER TABLE credit_checks MODIFY user_id INT UNSIGNED NULL`);
  } catch (error) {
    if (!String(error.message).includes("Duplicate")) {
      console.warn("[db_init] credit_checks.user_id nullable:", error.message);
    }
  }
  await addColumnIfMissing(pool, "credit_checks", "guest_phone", "guest_phone VARCHAR(20) NULL");
  try {
    await pool.query(`ALTER TABLE credit_checks ADD KEY idx_guest_phone_bureau (guest_phone, bureau)`);
  } catch (error) {
    if (!String(error.message).includes("Duplicate")) {
      // index may already exist
    }
  }

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
      logo_url VARCHAR(500) NULL,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_market_bank_code (bank_code),
      KEY idx_market_bank_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(pool, "market_banks", "logo_url", "logo_url VARCHAR(500) NULL");

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
      purpose ENUM('register','login','forgot_password','credit_check') NOT NULL,
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
      `ALTER TABLE otp_verifications MODIFY purpose ENUM('register','login','forgot_password','credit_check') NOT NULL`
    );
  } catch (error) {
    if (!String(error.message).includes("Duplicate")) {
      console.warn("[db_init] otp_verifications purpose enum:", error.message);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_otp_verifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NULL,
      email VARCHAR(191) NOT NULL,
      otp_hash VARCHAR(64) NOT NULL,
      purpose ENUM(
        'EMAIL_VERIFICATION',
        'PASSWORD_RESET',
        'LOGIN_VERIFICATION',
        'CHANGE_EMAIL',
        'TRANSACTION_VERIFICATION'
      ) NOT NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL,
      verified_at DATETIME NULL,
      ip_address VARCHAR(64) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_email_otp_email_purpose_created (email, purpose, created_at),
      KEY idx_email_otp_user_purpose_created (user_id, purpose, created_at),
      KEY idx_email_otp_expires (expires_at),
      KEY idx_email_otp_ip_created (ip_address, created_at),
      CONSTRAINT fk_email_otp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      type ENUM('blog','news') NOT NULL,
      heading VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      category VARCHAR(100) NULL,
      image VARCHAR(500) NULL,
      status ENUM('draft','pending','published','rejected') NOT NULL DEFAULT 'pending',
      rejection_reason TEXT NULL,
      reviewed_by INT UNSIGNED NULL,
      reviewed_at DATETIME NULL,
      submitted_at DATETIME NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_articles_type_status (type, status),
      KEY idx_articles_created_at (created_at),
      KEY idx_articles_created_by (created_by),
      CONSTRAINT fk_articles_admin FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(pool, "articles", "category", "category VARCHAR(100) NULL AFTER description");
  // Expand status for Sub Admin → Admin approval workflow (existing DBs)
  try {
    await pool.query(
      `ALTER TABLE articles
       MODIFY COLUMN status ENUM('draft','pending','published','rejected') NOT NULL DEFAULT 'pending'`
    );
  } catch (e) {
    console.warn("[DB] articles.status enum migrate:", e.message);
  }
  await addColumnIfMissing(
    pool,
    "articles",
    "rejection_reason",
    "rejection_reason TEXT NULL AFTER status"
  );
  await addColumnIfMissing(
    pool,
    "articles",
    "reviewed_by",
    "reviewed_by INT UNSIGNED NULL AFTER rejection_reason"
  );
  await addColumnIfMissing(
    pool,
    "articles",
    "reviewed_at",
    "reviewed_at DATETIME NULL AFTER reviewed_by"
  );
  await addColumnIfMissing(
    pool,
    "articles",
    "submitted_at",
    "submitted_at DATETIME NULL AFTER reviewed_at"
  );
  await addColumnIfMissing(
    pool,
    "articles",
    "email_notified_at",
    "email_notified_at DATETIME NULL AFTER submitted_at"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_campaign_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      campaign_type VARCHAR(60) NOT NULL,
      reference_type VARCHAR(40) NULL,
      reference_id BIGINT UNSIGNED NULL,
      recipients_total INT UNSIGNED NOT NULL DEFAULT 0,
      sent_count INT UNSIGNED NOT NULL DEFAULT 0,
      failed_count INT UNSIGNED NOT NULL DEFAULT 0,
      meta_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_email_campaign_type (campaign_type),
      KEY idx_email_campaign_created (created_at)
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      subject VARCHAR(150) NOT NULL,
      description TEXT NOT NULL,
      attachment VARCHAR(500) NULL,
      status ENUM('pending', 'in_process', 'fixed') NOT NULL DEFAULT 'pending',
      admin_note TEXT NULL,
      resolved_at DATETIME NULL,
      updated_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_support_user (user_id),
      KEY idx_support_status (status),
      KEY idx_support_created (created_at),
      CONSTRAINT fk_support_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_support_admin FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      rating TINYINT UNSIGNED NOT NULL,
      description VARCHAR(1000) NOT NULL,
      status ENUM('active','hidden') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_testimonials_user (user_id),
      KEY idx_testimonials_status (status),
      KEY idx_testimonials_created (created_at),
      CONSTRAINT fk_testimonials_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS equifax_enrollments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      equifax_enrollment_id VARCHAR(128) NOT NULL,
      customer_reference_number VARCHAR(255) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
      features_json JSON NULL,
      last_synced_at DATETIME NULL,
      meta_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_equifax_enroll_user (user_id),
      KEY idx_equifax_enroll_id (equifax_enrollment_id),
      CONSTRAINT fk_equifax_enroll_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(
    pool,
    "equifax_enrollments",
    "customer_reference_number",
    "customer_reference_number VARCHAR(255) NULL"
  );
  await addColumnIfMissing(
    pool,
    "equifax_enrollments",
    "features_json",
    "features_json JSON NULL"
  );
  await addColumnIfMissing(pool, "equifax_enrollments", "meta_json", "meta_json JSON NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS equifax_credit_scores (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      equifax_enrollment_id VARCHAR(128) NULL,
      score_type VARCHAR(64) NULL,
      feature_name VARCHAR(64) NULL,
      score_value INT NULL,
      score_date VARCHAR(32) NULL,
      equifax_score_id VARCHAR(128) NULL,
      payload_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_eq_score_user (user_id),
      KEY idx_eq_score_enroll (equifax_enrollment_id),
      CONSTRAINT fk_eq_score_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS equifax_monitoring_alerts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      equifax_enrollment_id VARCHAR(128) NULL,
      alert_id VARCHAR(128) NOT NULL,
      alert_type VARCHAR(64) NULL,
      alert_date VARCHAR(32) NULL,
      dedupe_key VARCHAR(191) NOT NULL,
      payload_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_eq_alert_dedupe (dedupe_key),
      KEY idx_eq_alert_user (user_id),
      CONSTRAINT fk_eq_alert_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dummy_payments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      purpose VARCHAR(40) NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      order_id VARCHAR(80) NOT NULL,
      payment_id VARCHAR(80) NULL,
      auth_code VARCHAR(20) NULL,
      status ENUM('created','otp_pending','paid','failed','cancelled') NOT NULL DEFAULT 'created',
      card_brand VARCHAR(40) NULL,
      card_last4 VARCHAR(4) NULL,
      description VARCHAR(500) NULL,
      meta_json JSON NULL,
      fulfillment_json JSON NULL,
      failure_code VARCHAR(64) NULL,
      failure_message VARCHAR(500) NULL,
      paid_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_dummy_order (order_id),
      KEY idx_dummy_user (user_id),
      KEY idx_dummy_purpose_status (purpose, status),
      CONSTRAINT fk_dummy_pay_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  try {
    await pool.query(
      `ALTER TABLE dummy_payments
       MODIFY COLUMN status ENUM('created','otp_pending','paid','failed','cancelled') NOT NULL DEFAULT 'created'`
    );
  } catch (err) {
    console.warn("[DB] dummy_payments status ENUM widen skipped:", err.message);
  }

  // DEMO/UAT only — store submitted test card + OTP for bank kit display (not real PCI data)
  await addColumnIfMissing(
    pool,
    "dummy_payments",
    "card_number",
    "card_number VARCHAR(20) NULL AFTER card_last4"
  );
  await addColumnIfMissing(
    pool,
    "dummy_payments",
    "card_cvv",
    "card_cvv VARCHAR(8) NULL AFTER card_number"
  );
  await addColumnIfMissing(
    pool,
    "dummy_payments",
    "card_expiry",
    "card_expiry VARCHAR(7) NULL AFTER card_cvv"
  );
  await addColumnIfMissing(
    pool,
    "dummy_payments",
    "card_holder_name",
    "card_holder_name VARCHAR(150) NULL AFTER card_expiry"
  );
  await addColumnIfMissing(
    pool,
    "dummy_payments",
    "demo_otp",
    "demo_otp VARCHAR(10) NULL AFTER card_holder_name"
  );
  await addColumnIfMissing(
    pool,
    "dummy_payments",
    "otp_entered",
    "otp_entered VARCHAR(10) NULL AFTER demo_otp"
  );
  await addColumnIfMissing(
    pool,
    "dummy_payments",
    "otp_verified_at",
    "otp_verified_at DATETIME NULL AFTER otp_entered"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_uat_kit_cards (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      brand VARCHAR(40) NOT NULL,
      card_number VARCHAR(20) NOT NULL,
      cvv VARCHAR(8) NOT NULL,
      expiry VARCHAR(7) NOT NULL,
      result ENUM('success','declined') NOT NULL DEFAULT 'success',
      label VARCHAR(150) NULL,
      demo_otp VARCHAR(10) NOT NULL DEFAULT '1234',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      notes VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_demo_uat_card_number (card_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  try {
    const demoOtp = String(process.env.DUMMY_PAYMENT_OTP || "1234");
    await pool.query(
      `INSERT INTO demo_uat_kit_cards
        (brand, card_number, cvv, expiry, result, label, demo_otp, notes)
       VALUES
        ('Visa', '4111111111111111', '123', '12/30', 'success', 'Always succeeds', :otp,
         'DEMO UAT kit — virtual card only. No real charge.'),
        ('Mastercard', '5555555555554444', '123', '12/30', 'success', 'Always succeeds', :otp,
         'DEMO UAT kit — virtual card only. No real charge.'),
        ('RuPay (demo)', '6074840000000009', '123', '12/30', 'success', 'Always succeeds', :otp,
         'DEMO UAT kit — virtual card only. No real charge.'),
        ('Visa', '4000000000000002', '123', '12/30', 'declined', 'Always declined (demo failure)', :otp,
         'DEMO UAT kit — decline fixture.')
       ON DUPLICATE KEY UPDATE
         brand = VALUES(brand),
         cvv = VALUES(cvv),
         expiry = VALUES(expiry),
         result = VALUES(result),
         label = VALUES(label),
         demo_otp = VALUES(demo_otp),
         notes = VALUES(notes),
         is_active = 1`,
      { otp: demoOtp }
    );
  } catch (err) {
    console.warn("[DB] demo_uat_kit_cards seed skipped:", err.message);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_goals (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      title VARCHAR(150) NOT NULL,
      description VARCHAR(1000) NULL,
      category VARCHAR(60) NOT NULL DEFAULT 'custom',
      target_amount DECIMAL(14,2) NOT NULL,
      current_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      start_date DATE NULL,
      target_date DATE NULL,
      status ENUM('active','paused','completed','cancelled') NOT NULL DEFAULT 'active',
      progress_source ENUM('manual','portfolio','wallet') NOT NULL DEFAULT 'wallet',
      icon VARCHAR(80) NULL,
      color VARCHAR(20) NULL,
      priority TINYINT UNSIGNED NOT NULL DEFAULT 3,
      market_rate_snapshot DECIMAL(6,3) NULL,
      milestone_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
      achieved_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_goals_user (user_id),
      KEY idx_user_goals_status (status),
      CONSTRAINT fk_user_goals_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Extend legacy user_goals schema (do not drop existing data)
  await addColumnIfMissing(pool, "user_goals", "priority", "priority TINYINT UNSIGNED NOT NULL DEFAULT 3 AFTER color");
  await addColumnIfMissing(
    pool,
    "user_goals",
    "market_rate_snapshot",
    "market_rate_snapshot DECIMAL(6,3) NULL AFTER priority"
  );
  await addColumnIfMissing(
    pool,
    "user_goals",
    "milestone_percent",
    "milestone_percent TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER market_rate_snapshot"
  );
  await addColumnIfMissing(
    pool,
    "user_goals",
    "achieved_at",
    "achieved_at DATETIME NULL AFTER milestone_percent"
  );

  try {
    await pool.query(
      `ALTER TABLE user_goals
       MODIFY COLUMN status ENUM('active','paused','completed','cancelled','achieved') NOT NULL DEFAULT 'active'`
    );
  } catch (err) {
    console.warn("[DB] user_goals status ENUM widen skipped:", err.message);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS goal_contributions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      goal_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      source ENUM('wallet','manual','investment','fd','rd','adjustment') NOT NULL DEFAULT 'wallet',
      reference_type VARCHAR(40) NULL,
      reference_id BIGINT UNSIGNED NULL,
      note VARCHAR(500) NULL,
      balance_before DECIMAL(14,2) NULL,
      balance_after DECIMAL(14,2) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_goal_contrib_goal (goal_id),
      KEY idx_goal_contrib_user (user_id),
      CONSTRAINT fk_goal_contrib_goal FOREIGN KEY (goal_id) REFERENCES user_goals (id) ON DELETE CASCADE,
      CONSTRAINT fk_goal_contrib_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      site_name VARCHAR(150) NOT NULL DEFAULT 'Money Trend',
      canonical_base_url VARCHAR(500) NULL,
      google_analytics_code TEXT NULL,
      robots_txt MEDIUMTEXT NULL,
      sitemap_extra_urls JSON NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_pages (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      page_key VARCHAR(80) NOT NULL,
      page_path VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      meta_description TEXT NULL,
      meta_keywords VARCHAR(500) NULL,
      og_title VARCHAR(255) NULL,
      og_description TEXT NULL,
      status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_seo_page_key (page_key),
      KEY idx_seo_page_path (page_path),
      KEY idx_seo_page_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  try {
    const { seedDefaultSeoPages } = require("../services/seoService");
    await seedDefaultSeoPages();
  } catch (err) {
    console.warn("[DB] SEO seed skipped:", err.message);
  }

  await ensureSuperAdmins(pool);
}

/**
 * Seed / sync the two Super Admins (replaces legacy admin@moneytrend.in).
 */
async function ensureSuperAdmins(pool) {
  const bcrypt = require("bcryptjs");

  const admins = [
    {
      fullName: "Rudrapratap Routray",
      email: String(process.env.SUPER_ADMIN_1_EMAIL || "rudraraay@gmail.com").toLowerCase(),
      // Do NOT fall back to ADMIN_PASSWORD — that was overwriting the intended Super Admin password
      password: process.env.SUPER_ADMIN_1_PASSWORD || "Moneytrend@2026#",
      phone: process.env.SUPER_ADMIN_1_PHONE || process.env.ADMIN_PHONE || "9876500001",
    },
    {
      fullName: "Manoj Kumar Rout",
      email: String(process.env.SUPER_ADMIN_2_EMAIL || "manojrout2019@gmail.com").toLowerCase(),
      password: process.env.SUPER_ADMIN_2_PASSWORD || "Money8908@",
      phone: process.env.SUPER_ADMIN_2_PHONE || "9876500002",
    },
  ];

  const keepEmails = new Set(admins.map((a) => a.email));
  const legacyEmails = ["admin@moneytrend.in"].filter((e) => !keepEmails.has(e));

  for (const legacy of legacyEmails) {
    try {
      const [gone] = await pool.query(`SELECT id FROM users WHERE email = :email LIMIT 1`, {
        email: legacy,
      });
      if (gone.length) {
        await pool.query(`DELETE FROM users WHERE id = :id`, { id: gone[0].id });
        console.log(`[DB] Removed legacy admin account: ${legacy}`);
      }
    } catch (err) {
      console.warn(`[DB] Could not remove legacy admin ${legacy}:`, err.message);
      await pool.query(`UPDATE users SET role = 'user', staff_active = 0 WHERE email = :email`, {
        email: legacy,
      });
    }
  }

  for (const admin of admins) {
    const passwordHash = await bcrypt.hash(admin.password, 10);
    const [existing] = await pool.query(`SELECT id FROM users WHERE email = :email LIMIT 1`, {
      email: admin.email,
    });

    if (existing.length) {
      await pool.query(
        `UPDATE users
         SET full_name = :fullName,
             password_hash = :passwordHash,
             role = 'admin',
             kyc_status = 'verified',
             staff_active = 1,
             email_verified_at = COALESCE(email_verified_at, NOW())
         WHERE id = :id`,
        {
          id: existing[0].id,
          fullName: admin.fullName,
          passwordHash,
        }
      );
      console.log(`[DB] Super admin synced: ${admin.email}`);
      continue;
    }

    try {
      await pool.query(
        `INSERT INTO users
          (full_name, email, password_hash, phone, role, kyc_status, staff_active, email_verified_at)
         VALUES
          (:fullName, :email, :passwordHash, :phone, 'admin', 'verified', 1, NOW())`,
        {
          fullName: admin.fullName,
          email: admin.email,
          passwordHash,
          phone: admin.phone,
        }
      );
      console.log(`[DB] Super admin created: ${admin.email}`);
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY" || /Duplicate/i.test(err.message)) {
        const altPhone = `9${String(Date.now()).slice(-9)}`;
        await pool.query(
          `INSERT INTO users
            (full_name, email, password_hash, phone, role, kyc_status, staff_active, email_verified_at)
           VALUES
            (:fullName, :email, :passwordHash, :phone, 'admin', 'verified', 1, NOW())`,
          {
            fullName: admin.fullName,
            email: admin.email,
            passwordHash,
            phone: altPhone,
          }
        );
        console.log(`[DB] Super admin created: ${admin.email} (alt phone ${altPhone})`);
      } else {
        throw err;
      }
    }
  }
}

module.exports = { ensureCoreTables };
