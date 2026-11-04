/** Sandbox mock raw responses per bureau.
 * These are NOT real TransUnion/CIBIL/Experian/Equifax reports.
 * Real PAN-based accounts/scores require live bureau credentials (CREDIT_CHECK_MODE=uat|live).
 */

function hashPan(pan) {
  const s = String(pan || "UNKNOWN").toUpperCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic demo score from PAN (not a real bureau score). */
function mockScoreFromPan(pan, base = 620) {
  const h = hashPan(pan);
  // Spread ~560–740 for UI testing; never claim this is TransUnion truth.
  return base + (h % 181);
}

/**
 * Default: empty tradelines so we never invent banks/cards the user does not have.
 * Set CREDIT_CHECK_MOCK_RICH=true only for UI demos with clearly SAMPLE lenders.
 */
function baseAccounts(pan) {
  const rich = String(process.env.CREDIT_CHECK_MOCK_RICH || "false").toLowerCase() === "true";
  if (!rich) return [];

  const h = hashPan(pan);
  return [
    {
      accountType: "Personal Loan",
      lender: "SAMPLE Finance Co",
      status: h % 2 === 0 ? "Active" : "Closed",
      creditLimit: 0,
      currentBalance: h % 2 === 0 ? 45000 : 0,
      overdueAmount: h % 5 === 0 ? 2500 : 0,
      paymentHistory: "000000001000",
      _sample: true,
    },
    {
      accountType: "Credit Card",
      lender: "SAMPLE Bank",
      status: "Active",
      creditLimit: 100000,
      currentBalance: 12000,
      overdueAmount: 0,
      paymentHistory: "000000000000",
      _sample: true,
    },
  ];
}

function baseEnquiries(pan) {
  const rich = String(process.env.CREDIT_CHECK_MOCK_RICH || "false").toLowerCase() === "true";
  if (!rich) return [];
  return [
    {
      date: new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10),
      lender: "SAMPLE Lender",
      purpose: "Personal Loan",
      _sample: true,
    },
  ];
}

function mockMeta(input) {
  return {
    _mock: true,
    _dataSource: "MOCK_SANDBOX",
    _disclaimer:
      "Sandbox mock only — not your real TransUnion CIBIL / bureau report. Enable live bureau APIs for accurate PAN-based score, accounts, loans, and enquiries.",
    pan: input.pan,
  };
}

function mockCibil(input) {
  const score = mockScoreFromPan(input.pan, 610);
  return {
    bureauRefId: `CIBIL-MOCK-${Date.now()}`,
    reportDate: new Date().toISOString().slice(0, 10),
    score,
    scoreMin: 300,
    scoreMax: 900,
    status: "SUCCESS",
    accounts: baseAccounts(input.pan),
    enquiries: baseEnquiries(input.pan),
    ...mockMeta(input),
  };
}

function mockExperian(input) {
  const score = mockScoreFromPan(input.pan, 600);
  const accounts = baseAccounts(input.pan);
  const enquiries = baseEnquiries(input.pan);
  return {
    INProfileResponse: {
      Header: {
        ReportDate: new Date().toISOString().slice(0, 10),
        ReportNumber: `EXP-MOCK-${Date.now()}`,
      },
      SCORE: { BureauScore: score, BureauScoreConfidLevel: "H" },
      CAIS_Account: {
        CAIS_Account_DETAILS: accounts.map((a) => ({
          Account_Type: a.accountType,
          Subscriber_Name: a.lender,
          Account_Status: a.status,
          Credit_Limit_Amount: a.creditLimit,
          Current_Balance: a.currentBalance,
          Amount_Past_Due: a.overdueAmount,
          Payment_History_Profile: a.paymentHistory,
        })),
      },
      CAPS: {
        CAPS_Application_Details: enquiries.map((e) => ({
          Date_of_Request: e.date,
          Subscriber_Name: e.lender,
          Enquiry_Reason: e.purpose,
        })),
      },
    },
    ...mockMeta(input),
  };
}

function mockEquifax(input) {
  return {
    equifaxReportId: `EQF-MOCK-${Date.now()}`,
    generatedOn: new Date().toISOString().slice(0, 10),
    scoreValue: mockScoreFromPan(input.pan, 595),
    scoreRange: { minimum: 300, maximum: 900 },
    tradeLines: baseAccounts(input.pan),
    inquiryHistory: baseEnquiries(input.pan),
    consumer: { pan: input.pan },
    ...mockMeta(input),
  };
}

function mockCrif(input) {
  return {
    reportId: `CRIF-MOCK-${Date.now()}`,
    reportGeneratedDate: new Date().toISOString().slice(0, 10),
    performScore: mockScoreFromPan(input.pan, 590),
    scoreBand: { low: 300, high: 900 },
    loanDetails: baseAccounts(input.pan),
    enquiryList: baseEnquiries(input.pan),
    applicantPan: input.pan,
    ...mockMeta(input),
  };
}

function mockNoHit(bureau) {
  return {
    bureau,
    status: "NO_HIT",
    reportDate: new Date().toISOString().slice(0, 10),
    reportRefId: `${bureau}-NOHIT-${Date.now()}`,
    score: null,
    message: "No credit history found for applicant",
    _mock: true,
    _dataSource: "MOCK_SANDBOX",
  };
}

module.exports = {
  mockCibil,
  mockExperian,
  mockEquifax,
  mockCrif,
  mockNoHit,
};
