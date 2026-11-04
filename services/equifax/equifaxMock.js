/**
 * Local sandbox fixtures for frontend testing when Equifax keys are not configured.
 * Never used for EQUIFAX_ENV=test|live.
 */

function mockEnrollmentId(userId) {
  return `MOCK-ENR-${userId}-${Date.now()}`;
}

function mockScorePayload(userId) {
  const score = 600 + (Number(userId) % 120);
  return {
    score,
    scoreType: "ONE_B_VANTAGE_SCORE_4",
    creditScoreId: `MOCK-SCORE-${userId}`,
    scoreDate: new Date().toISOString().slice(0, 10),
    is_mock: true,
  };
}

function mockReportPayload(userId) {
  return {
    creditReportId: `MOCK-RPT-${userId}`,
    reportType: "US_EFX",
    reportDate: new Date().toISOString().slice(0, 10),
    bureau: "EQUIFAX",
    is_mock: true,
    revolvingAccounts: [],
    installmentAccounts: [],
    inquiries: [],
    collections: [],
  };
}

function mockMonitoringAlerts(userId) {
  return [
    {
      alertId: `MOCK-ALERT-INQUIRY-${userId}`,
      alertType: "INQUIRY",
      alertDate: new Date().toISOString().slice(0, 10),
    },
    {
      alertId: `MOCK-ALERT-ADDRESS-${userId}`,
      alertType: "ADDRESS",
      alertDate: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    },
  ];
}

module.exports = {
  mockEnrollmentId,
  mockScorePayload,
  mockReportPayload,
  mockMonitoringAlerts,
};
