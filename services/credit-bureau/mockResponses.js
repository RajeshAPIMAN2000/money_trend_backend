/** Sandbox mock raw responses per bureau (replace with real API payloads in production). */

function baseAccounts() {
  return [
    {
      accountType: "Credit Card",
      lender: "HDFC Bank",
      status: "Active",
      creditLimit: 200000,
      currentBalance: 15000,
      overdueAmount: 0,
      paymentHistory: "000000000000",
    },
    {
      accountType: "Personal Loan",
      lender: "Bajaj Finserv",
      status: "Closed",
      creditLimit: 0,
      currentBalance: 0,
      overdueAmount: 0,
      paymentHistory: "000000000000",
    },
  ];
}

function baseEnquiries() {
  return [{ date: "2026-08-10", lender: "Bajaj Finserv", purpose: "Personal Loan" }];
}

function mockCibil(input) {
  return {
    bureauRefId: `CIBIL-MOCK-${Date.now()}`,
    reportDate: new Date().toISOString().slice(0, 10),
    score: 742,
    scoreMin: 300,
    scoreMax: 900,
    status: "SUCCESS",
    pan: input.pan,
    accounts: baseAccounts(),
    enquiries: baseEnquiries(),
  };
}

function mockExperian(input) {
  return {
    INProfileResponse: {
      Header: { ReportDate: new Date().toISOString().slice(0, 10), ReportNumber: `EXP-${Date.now()}` },
      SCORE: { BureauScore: 718, BureauScoreConfidLevel: "H" },
      CAIS_Account: {
        CAIS_Account_DETAILS: baseAccounts().map((a) => ({
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
        CAPS_Application_Details: baseEnquiries().map((e) => ({
          Date_of_Request: e.date,
          Subscriber_Name: e.lender,
          Enquiry_Reason: e.purpose,
        })),
      },
    },
    _pan: input.pan,
  };
}

function mockEquifax(input) {
  return {
    equifaxReportId: `EQF-${Date.now()}`,
    generatedOn: new Date().toISOString().slice(0, 10),
    scoreValue: 705,
    scoreRange: { minimum: 300, maximum: 900 },
    tradeLines: baseAccounts(),
    inquiryHistory: baseEnquiries(),
    consumer: { pan: input.pan },
  };
}

function mockCrif(input) {
  return {
    reportId: `CRIF-${Date.now()}`,
    reportGeneratedDate: new Date().toISOString().slice(0, 10),
    performScore: 690,
    scoreBand: { low: 300, high: 900 },
    loanDetails: baseAccounts(),
    enquiryList: baseEnquiries(),
    applicantPan: input.pan,
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
  };
}

module.exports = {
  mockCibil,
  mockExperian,
  mockEquifax,
  mockCrif,
  mockNoHit,
};
