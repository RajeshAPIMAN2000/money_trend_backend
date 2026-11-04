ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL;

ALTER TABLE otp_verifications
  MODIFY purpose ENUM('register','login','forgot_password') NOT NULL;
