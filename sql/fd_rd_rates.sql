-- FD/RD interest rate ticker table (synced from bank APIs + admin-managed)

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
