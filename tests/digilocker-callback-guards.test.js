const test = require("node:test");
const assert = require("node:assert/strict");
const {
  handleDigilockerCallback,
  AppError,
} = require("../services/digilocker/digilockerService");

test("callback rejects missing code/state", async () => {
  await assert.rejects(
    () => handleDigilockerCallback({ code: null, state: null }),
    (err) => err.code === "DIGILOCKER_CALLBACK_INVALID"
  );
});

test("callback rejects provider denial without inventing success", async () => {
  await assert.rejects(
    () =>
      handleDigilockerCallback({
        error: "access_denied",
        errorDescription: "User cancelled",
      }),
    (err) => err.code === "DIGILOCKER_DENIED" && /cancelled|denied|access_denied/i.test(err.message)
  );
});

test("AppError carries status and code", () => {
  const err = AppError("boom", 400, "DIGILOCKER_REPLAY");
  assert.equal(err.status, 400);
  assert.equal(err.code, "DIGILOCKER_REPLAY");
});
