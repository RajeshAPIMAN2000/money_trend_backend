/**
 * Bank logo / icon URLs for FD & RD user-panel responses.
 * Served from /uploads/banks/{code}.svg (static via app.js).
 */

const DEFAULT_BANK_LOGOS = {
  sbi: "/uploads/banks/sbi.svg",
  hdfc: "/uploads/banks/hdfc.svg",
  icici: "/uploads/banks/icici.svg",
  axis: "/uploads/banks/axis.svg",
  pnb: "/uploads/banks/pnb.svg",
  bob: "/uploads/banks/bob.svg",
  kotak: "/uploads/banks/kotak.svg",
};

function normalizeBankCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/**
 * Resolve a public logo URL for a bank.
 * Prefers DB logo_url when present; falls back to known bank assets.
 */
function resolveBankLogo({ bankCode, logoUrl } = {}) {
  const custom = logoUrl != null ? String(logoUrl).trim() : "";
  if (custom) {
    if (
      custom.startsWith("http://") ||
      custom.startsWith("https://") ||
      custom.startsWith("/uploads/")
    ) {
      return custom;
    }
    return `/uploads/${custom.replace(/^\/+/, "")}`;
  }

  const code = normalizeBankCode(bankCode);
  if (DEFAULT_BANK_LOGOS[code]) return DEFAULT_BANK_LOGOS[code];
  return "/uploads/banks/default.svg";
}

function attachBankLogoFields(item = {}) {
  const bankCode = item.bankCode || item.bank_code || null;
  const logo =
    item.logo ||
    item.logo_url ||
    item.bank_logo ||
    resolveBankLogo({
      bankCode,
      logoUrl: item.logoUrl || item.logo_url,
    });

  return {
    ...item,
    logo,
    logo_url: logo,
    bank_logo: logo,
    icon: logo,
    icon_url: logo,
  };
}

module.exports = {
  DEFAULT_BANK_LOGOS,
  normalizeBankCode,
  resolveBankLogo,
  attachBankLogoFields,
};
