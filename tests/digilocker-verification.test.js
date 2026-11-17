const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateDigilockerVerification,
  namesMatch,
  dobsMatch,
} = require("../services/digilocker/kycVerification");

test("namesMatch exact and token subset", () => {
  assert.equal(namesMatch("Rahul Sharma", "rahul sharma").matched, true);
  assert.equal(namesMatch("Rahul Kumar Sharma", "Rahul Sharma").matched, true);
  assert.equal(namesMatch("Rahul Sharma", "Amit Verma").matched, false);
});

test("dobsMatch normalizes formats", () => {
  assert.equal(dobsMatch("1992-08-15", "15/08/1992").matched, true);
  assert.equal(dobsMatch("1992-08-15", "1992-08-16").matched, false);
});

test("PENDING when Aadhaar/PAN missing", () => {
  const result = evaluateDigilockerVerification({
    bundle: { name: "Rahul Sharma", issued_docs: [], user_details_fetched: true },
    user: { full_name: "Rahul Sharma", date_of_birth: "1992-08-15" },
    options: { autoApprove: true, requireAadhaar: true, requirePan: true, requireNameMatch: true },
  });
  assert.equal(result.auto_approved, false);
  assert.equal(result.overall_status, "PENDING");
  assert.equal(result.moneytrend_kyc_status, "pending");
  assert.ok(result.failure_codes.includes("aadhaar_incomplete"));
  assert.ok(result.failure_codes.includes("pan_incomplete"));
});

test("MANUAL_REVIEW on name mismatch", () => {
  const result = evaluateDigilockerVerification({
    bundle: {
      name: "Amit Verma",
      pan_number: "ABCDE1234F",
      aadhaar_last4: "3456",
      eaadhaar_fetched: true,
      issued_docs: [{ name: "PAN Card", doctype: "PANCR" }],
    },
    user: { full_name: "Rahul Sharma" },
    options: { autoApprove: true, requireAadhaar: true, requirePan: true, requireNameMatch: true },
  });
  assert.equal(result.overall_status, "MANUAL_REVIEW");
  assert.equal(result.moneytrend_kyc_status, "submitted");
});

test("VERIFIED when all required checks pass", () => {
  const result = evaluateDigilockerVerification({
    bundle: {
      name: "Rahul Sharma",
      dob: "1992-08-15",
      pan_number: "ABCDE1234F",
      aadhaar_last4: "3456",
      eaadhaar_fetched: true,
      eaadhaar: "Y",
      issued_docs: [{ name: "PAN Card", doctype: "PANCR" }],
      user_details_fetched: true,
    },
    user: { full_name: "Rahul Sharma", date_of_birth: "1992-08-15" },
    options: { autoApprove: true, requireAadhaar: true, requirePan: true, requireNameMatch: true },
  });
  assert.equal(result.auto_approved, true);
  assert.equal(result.overall_status, "VERIFIED");
  assert.equal(result.moneytrend_kyc_status, "verified");
  assert.equal(result.aadhaar.status, "passed");
  assert.equal(result.pan.status, "passed");
});

test("auto approve disabled keeps MANUAL_REVIEW even when checks pass", () => {
  const result = evaluateDigilockerVerification({
    bundle: {
      name: "Rahul Sharma",
      pan_number: "ABCDE1234F",
      aadhaar_last4: "3456",
      eaadhaar_fetched: true,
      issued_docs: [],
    },
    user: { full_name: "Rahul Sharma" },
    options: { autoApprove: false, requireAadhaar: true, requirePan: true, requireNameMatch: true },
  });
  assert.equal(result.auto_approved, false);
  assert.equal(result.moneytrend_kyc_status, "submitted");
  assert.equal(result.overall_status, "MANUAL_REVIEW");
});
