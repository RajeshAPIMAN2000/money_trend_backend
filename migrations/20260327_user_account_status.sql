-- Applied automatically by config/db_init.js (addColumnIfMissing).
-- Manual run only when managing schema outside Node bootstrap.
-- Skip any statement if the column already exists.

ALTER TABLE users
  ADD COLUMN account_status ENUM('active','inactive','deactivated') NOT NULL DEFAULT 'active';

ALTER TABLE users
  ADD COLUMN account_status_changed_at DATETIME NULL;

ALTER TABLE users
  ADD COLUMN account_status_reason VARCHAR(255) NULL;
