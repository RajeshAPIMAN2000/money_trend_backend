-- DigiLocker eKYC verification fields + audit log
-- Preferred: restart API so ensureCoreTables() / addColumnIfMissing applies these safely.
-- Manual MySQL 8+ (skip columns that already exist):

-- ALTER TABLE digilocker_kyc_records ADD COLUMN auth_status VARCHAR(32) NULL;
-- ALTER TABLE digilocker_kyc_records ADD COLUMN aadhaar_status VARCHAR(32) NULL;
-- ALTER TABLE digilocker_kyc_records ADD COLUMN pan_status VARCHAR(32) NULL;
-- ALTER TABLE digilocker_kyc_records ADD COLUMN name_status VARCHAR(32) NULL;
-- ALTER TABLE digilocker_kyc_records ADD COLUMN dob_status VARCHAR(32) NULL;
-- ALTER TABLE digilocker_kyc_records ADD COLUMN address_status VARCHAR(32) NULL;
-- ALTER TABLE digilocker_kyc_records ADD COLUMN overall_status VARCHAR(32) NULL;
-- ALTER TABLE digilocker_kyc_records ADD COLUMN review_reason VARCHAR(500) NULL;
-- ALTER TABLE digilocker_kyc_records ADD COLUMN verification_json JSON NULL;

CREATE TABLE IF NOT EXISTS digilocker_kyc_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  detail_json JSON NULL,
  actor VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_digilocker_audit_user (user_id),
  CONSTRAINT fk_digilocker_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
