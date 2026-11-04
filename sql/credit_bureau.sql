-- Credit Bureau Check module (run manually or via db_init on server start)

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_check_enquiries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  credit_check_id BIGINT UNSIGNED NOT NULL,
  enquiry_date DATE NULL,
  lender VARCHAR(150) NULL,
  purpose VARCHAR(150) NULL,
  PRIMARY KEY (id),
  KEY idx_credit_check_enquiries_check (credit_check_id),
  CONSTRAINT fk_credit_check_enquiries_check FOREIGN KEY (credit_check_id) REFERENCES credit_checks (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
