const BUREAU_SCORE_RANGES = {
  CIBIL: { min: 300, max: 900 },
  EXPERIAN: { min: 300, max: 900 },
  EQUIFAX: { min: 300, max: 900 },
  CRIF: { min: 300, max: 900 },
};

function normalizeAccounts(accounts = []) {
  return accounts.map((a) => ({
    accountType: a.accountType || a.Account_Type || a.account_type || "Unknown",
    lender: a.lender || a.Subscriber_Name || a.lenderName || "Unknown",
    status: a.status || a.Account_Status || a.accountStatus || "Unknown",
    creditLimit: Number(a.creditLimit ?? a.Credit_Limit_Amount ?? a.credit_limit ?? 0),
    currentBalance: Number(a.currentBalance ?? a.Current_Balance ?? a.current_balance ?? 0),
    overdueAmount: Number(a.overdueAmount ?? a.Amount_Past_Due ?? a.overdue_amount ?? 0),
    paymentHistory:
      a.paymentHistory || a.Payment_History_Profile || a.payment_history || "",
  }));
}

function normalizeEnquiries(enquiries = []) {
  return enquiries.map((e) => ({
    date: e.date || e.Date_of_Request || e.enquiry_date || e.enquiryDate || null,
    lender: e.lender || e.Subscriber_Name || e.lenderName || "Unknown",
    purpose: e.purpose || e.Enquiry_Reason || e.enquiryPurpose || "Unknown",
  }));
}

function normalizeCibil(raw) {
  if (raw.status === "NO_HIT") {
    return {
      bureau: "CIBIL",
      score: null,
      scoreRange: BUREAU_SCORE_RANGES.CIBIL,
      reportDate: raw.reportDate,
      reportRefId: raw.reportRefId,
      status: "NO_HIT",
      accounts: [],
      enquiries: [],
      rawResponse: raw,
    };
  }
  return {
    bureau: "CIBIL",
    score: raw.score ?? null,
    scoreRange: BUREAU_SCORE_RANGES.CIBIL,
    reportDate: raw.reportDate,
    reportRefId: raw.bureauRefId || raw.reportRefId,
    status: "SUCCESS",
    accounts: normalizeAccounts(raw.accounts || []),
    enquiries: normalizeEnquiries(raw.enquiries || []),
    rawResponse: raw,
  };
}

function normalizeExperian(raw) {
  const profile = raw.INProfileResponse || raw;
  const scoreBlock = profile.SCORE || {};
  const score = scoreBlock.BureauScore ?? null;
  const header = profile.Header || {};
  const accountsRaw =
    profile.CAIS_Account?.CAIS_Account_DETAILS ||
    profile.accounts ||
    [];
  const enquiriesRaw =
    profile.CAPS?.CAPS_Application_Details ||
    profile.enquiries ||
    [];

  if (raw.status === "NO_HIT" || score === null) {
    return {
      bureau: "EXPERIAN",
      score: null,
      scoreRange: BUREAU_SCORE_RANGES.EXPERIAN,
      reportDate: header.ReportDate || raw.reportDate,
      reportRefId: header.ReportNumber || raw.reportRefId,
      status: raw.status === "NO_HIT" ? "NO_HIT" : "SUCCESS",
      accounts: [],
      enquiries: [],
      rawResponse: raw,
    };
  }

  return {
    bureau: "EXPERIAN",
    score: Number(score),
    scoreRange: BUREAU_SCORE_RANGES.EXPERIAN,
    reportDate: header.ReportDate || new Date().toISOString().slice(0, 10),
    reportRefId: header.ReportNumber || `EXP-${Date.now()}`,
    status: "SUCCESS",
    accounts: normalizeAccounts(Array.isArray(accountsRaw) ? accountsRaw : [accountsRaw]),
    enquiries: normalizeEnquiries(Array.isArray(enquiriesRaw) ? enquiriesRaw : [enquiriesRaw]),
    rawResponse: raw,
  };
}

function normalizeEquifax(raw) {
  if (raw.status === "NO_HIT") {
    return {
      bureau: "EQUIFAX",
      score: null,
      scoreRange: BUREAU_SCORE_RANGES.EQUIFAX,
      reportDate: raw.reportDate,
      reportRefId: raw.reportRefId,
      status: "NO_HIT",
      accounts: [],
      enquiries: [],
      rawResponse: raw,
    };
  }
  const range = raw.scoreRange || BUREAU_SCORE_RANGES.EQUIFAX;
  return {
    bureau: "EQUIFAX",
    score: raw.scoreValue ?? raw.score ?? null,
    scoreRange: { min: range.minimum ?? range.min ?? 300, max: range.maximum ?? range.max ?? 900 },
    reportDate: raw.generatedOn || raw.reportDate,
    reportRefId: raw.equifaxReportId || raw.reportRefId,
    status: "SUCCESS",
    accounts: normalizeAccounts(raw.tradeLines || raw.accounts || []),
    enquiries: normalizeEnquiries(raw.inquiryHistory || raw.enquiries || []),
    rawResponse: raw,
  };
}

function normalizeCrif(raw) {
  if (raw.status === "NO_HIT") {
    return {
      bureau: "CRIF",
      score: null,
      scoreRange: BUREAU_SCORE_RANGES.CRIF,
      reportDate: raw.reportDate,
      reportRefId: raw.reportRefId,
      status: "NO_HIT",
      accounts: [],
      enquiries: [],
      rawResponse: raw,
    };
  }
  const band = raw.scoreBand || BUREAU_SCORE_RANGES.CRIF;
  return {
    bureau: "CRIF",
    score: raw.performScore ?? raw.score ?? null,
    scoreRange: { min: band.low ?? band.min ?? 300, max: band.high ?? band.max ?? 900 },
    reportDate: raw.reportGeneratedDate || raw.reportDate,
    reportRefId: raw.reportId || raw.reportRefId,
    status: "SUCCESS",
    accounts: normalizeAccounts(raw.loanDetails || raw.accounts || []),
    enquiries: normalizeEnquiries(raw.enquiryList || raw.enquiries || []),
    rawResponse: raw,
  };
}

function normalize(bureau, raw) {
  const key = String(bureau || "").toUpperCase();
  switch (key) {
    case "CIBIL":
      return normalizeCibil(raw);
    case "EXPERIAN":
      return normalizeExperian(raw);
    case "EQUIFAX":
      return normalizeEquifax(raw);
    case "CRIF":
      return normalizeCrif(raw);
    default:
      throw new Error(`Unknown bureau for normalization: ${bureau}`);
  }
}

module.exports = {
  BUREAU_SCORE_RANGES,
  normalize,
  normalizeAccounts,
  normalizeEnquiries,
};
