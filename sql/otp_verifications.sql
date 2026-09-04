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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- If table already exists, run:
-- ALTER TABLE otp_verifications MODIFY purpose ENUM('register','login','forgot_password','credit_check') NOT NULL;
