const jwt = require("jsonwebtoken");

function getAccessSecret() {
  return process.env.JWT_ACCESS_SECRET || "dev_access_secret_min_32_characters_long";
}

function getRefreshSecret() {
  return process.env.JWT_REFRESH_SECRET || "dev_refresh_secret_min_32_characters_long";
}

function signAccessToken(payload) {
  return jwt.sign(payload, getAccessSecret(), {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || "15m",
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, getRefreshSecret(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || "7d",
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, getAccessSecret());
}

function verifyRefreshToken(token) {
  return jwt.verify(token, getRefreshSecret());
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
