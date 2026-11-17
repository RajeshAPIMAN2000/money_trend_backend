-- DigiLocker eKYC OAuth sessions + KYC records
-- Applied automatically by config/db_init.js ensureCoreTables() on server start.
-- Run manually only if you manage schema outside the Node bootstrap:

CREATE TABLE IF NOT EXISTS digilocker_oauth_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  state VARCHAR(128) NOT NULL,
  code_verifier VARCHAR(512) NOT NULL,
  nonce VARCHAR(128) NULL,
  status ENUM('pending','consumed','completed','expired','failed') NOT NULL DEFAULT 'pending',
  redirect_uri VARCHAR(500) NOT NULL,
  scope VARCHAR(255) NULL,
  digilocker_id VARCHAR(64) NULL,
  result_meta_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_digilocker_state (state),
  KEY idx_digilocker_user_status (user_id, status),
  KEY idx_digilocker_expires (expires_at),
  CONSTRAINT fk_digilocker_session_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS digilocker_kyc_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  digilocker_id VARCHAR(64) NULL,
  full_name_enc VARCHAR(512) NULL,
  dob_enc VARCHAR(512) NULL,
  gender VARCHAR(8) NULL,
  aadhaar_last4 CHAR(4) NULL,
  pan_masked VARCHAR(20) NULL,
  eaadhaar_available TINYINT(1) NOT NULL DEFAULT 0,
  issued_docs_json JSON NULL,
  consent_meta_json JSON NULL,
  status ENUM('submitted','verified','rejected') NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_digilocker_kyc_user (user_id),
  KEY idx_digilocker_kyc_session (session_id),
  CONSTRAINT fk_digilocker_kyc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
