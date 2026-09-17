const {
  getConfigSnapshot,
  validateEquifaxReady,
  resolveEquifaxEnv,
  isEquifaxEnabled,
  isEquifaxMockMode,
} = require("./equifaxConfig");
const {
  getEquifaxCredential,
  getEquifaxAccessToken,
  getEquifaxAuthHeaders,
  clearCachedEquifaxCredential,
  getEquifaxCredentialSnapshot,
  invalidateEquifaxAccessToken,
} = require("./equifaxAuth");
const {
  enrollConsumerForUser,
  getStoredEnrollment,
  listAvailableFeatures,
  activateFeature,
} = require("./enrollmentService");
const {
  getLatestCreditScore,
  getCreditScoreHistory,
  getCreditScoreById,
  listCreditScores,
} = require("./creditScoreService");
const {
  getLatestCreditReport,
  getCreditReportById,
  getCreditReportSection,
  listCreditReports,
} = require("./creditReportService");
const {
  syncMonitoringAlerts,
  getMonitoringAlertRemote,
  listStoredAlerts,
} = require("./creditMonitoringService");
const { mapEquifaxError, sendEquifaxError } = require("./equifaxError");
const { equifaxRequest } = require("./equifaxClient");

// Back-compat aliases used by older controller
const getEquifaxConfigSnapshot = getConfigSnapshot;

module.exports = {
  getConfigSnapshot,
  getEquifaxConfigSnapshot,
  validateEquifaxReady,
  resolveEquifaxEnv,
  isEquifaxEnabled,
  isEquifaxMockMode,
  getEquifaxCredential,
  getEquifaxAccessToken,
  getEquifaxAuthHeaders,
  clearCachedEquifaxCredential,
  getEquifaxCredentialSnapshot,
  invalidateEquifaxAccessToken,
  enrollConsumerForUser,
  getStoredEnrollment,
  listAvailableFeatures,
  activateFeature,
  getLatestCreditScore,
  getCreditScoreHistory,
  getCreditScoreById,
  listCreditScores,
  getLatestCreditReport,
  getCreditReportById,
  getCreditReportSection,
  listCreditReports,
  syncMonitoringAlerts,
  getMonitoringAlertRemote,
  listStoredAlerts,
  mapEquifaxError,
  sendEquifaxError,
  equifaxRequest,
};
