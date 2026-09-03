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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
