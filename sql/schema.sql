-- Money Trend MySQL schema (SEBI / FD-RD nominee ready)
-- Database is also auto-created/migrated by config/db_init.js on server start.
--
-- ADMIN STORAGE (no separate admin table):
--   Admin is stored in `users` with role = 'admin'
--   Default seed (via app start / db_init.js):
--     email    = admin@moneytrend.in
--     password = Admin@123  (stored as bcrypt password_hash, never plain text)
--
-- ADMIN APIs:
--   POST  /api/admin/login
--   GET   /api/admin/users              -> list registered users (role = 'user')
--   GET   /api/admin/users/:id          -> one user + KYC + nominee
--   PATCH /api/admin/users/:id/kyc-status
--     Body: { "status": "approved" }  -> users.kyc_status = 'verified', kyc_documents.status = 'verified'
--     Body: { "status": "rejected" }  -> users.kyc_status = 'rejected', kyc_documents.status = 'rejected'
--     Optional: { "reason": "..." } for rejected
--     Works for both manual and digilocker submissions.

CREATE DATABASE IF NOT EXISTS `money_trend`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `money_trend`;

-- Users + Admin share this table (role distinguishes them)
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
  UNIQUE KEY uq_users_phone (phone),
  KEY idx_users_role (role),
  KEY idx_users_kyc_status (kyc_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- KYC documents submitted by users (manual / digilocker). Admin approves via PATCH.
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
  KEY idx_kyc_status (status),
  CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Money Trend FD portfolio (separate from other apps)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Money Trend RD portfolio (separate from other apps)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Default admin row (password must be bcrypt-hashed; prefer app auto-seed)
-- App startup (config/db_init.js) inserts/updates this automatically.
-- Example lookup after seed:
--   SELECT id, email, role, kyc_status FROM users WHERE role = 'admin';
-- ---------------------------------------------------------------------------
-- INSERT INTO users (full_name, email, password_hash, phone, role, kyc_status)
-- VALUES (
--   'Money Trend Admin',
--   'admin@moneytrend.in',
--   '<bcrypt_hash_of_Admin@123>',
--   '9999999999',
--   'admin',
--   'verified'
-- );
