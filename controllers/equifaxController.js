const equifax = require("../services/equifax");

function health(req, res) {
  const snap = equifax.getConfigSnapshot();
  return res.json({
    success: true,
    provider: "Equifax",
    environment: snap.environment,
    configuration: {
      enabled: snap.enabled,
      mockMode: Boolean(snap.mockMode),
      baseUrlConfigured: Boolean(snap.baseUrl),
      enrollmentApiKeyConfigured: snap.auth.enrollmentApiKeyConfigured,
      deliveryApiKeyConfigured: snap.auth.deliveryApiKeyConfigured,
      symmetricKeyConfigured: snap.auth.symmetricKeyConfigured,
      privateKeyConfigured: snap.auth.privateKeyConfigured,
      authMode: snap.auth?.mode || "jwt-bearer",
    },
  });
}

async function testAuth(req, res) {
  try {
    const kind = String(req.body?.kind || req.query?.kind || "enrollment").toLowerCase();
    const tokenKind = kind === "delivery" ? "delivery" : "enrollment";
    await equifax.getEquifaxCredential(tokenKind, { forceRefresh: true });
    const snap = equifax.getEquifaxCredentialSnapshot(tokenKind);
    return res.json({
      success: true,
      provider: "Equifax",
      environment: snap.env,
      kind: tokenKind,
      authenticated: snap.isValid,
    });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function enroll(req, res) {
  try {
    const enrollmentSubject =
      req.body.enrollmentSubject || req.body.enrollment_subject || req.body.consumer || null;
    const rawBody = req.body.rawBody || req.body.equifaxBody || null;

    if (!enrollmentSubject && !rawBody) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message:
          "Provide enrollmentSubject (Equifax EnrollmentSubject schema) or rawBody from API docs. Do not invent PAN/SSN mappings.",
      });
    }

    const result = await equifax.enrollConsumerForUser(req.user.id, {
      enrollmentSubject,
      rawBody,
      customerReferenceNumber: req.body.customerReferenceNumber || req.body.customer_reference_number,
      featureCodes: req.body.featureCodes || req.body.feature_codes,
      force: req.body.force === true,
    });
    return res.status(result.idempotent ? 200 : 201).json({
      success: true,
      message: result.idempotent ? "Existing Equifax enrollment returned" : "Equifax enrollment completed",
      data: result.enrollment,
    });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function getEnrollment(req, res) {
  try {
    const row = await equifax.getStoredEnrollment(req.user.id);
    if (!row) {
      return res.status(404).json({
        success: false,
        provider: "equifax",
        code: "EQUIFAX_ENROLLMENT_REQUIRED",
        message: "No Equifax enrollment for this user",
      });
    }
    return res.json({
      success: true,
      data: {
        id: row.id,
        equifax_enrollment_id: row.equifax_enrollment_id,
        status: row.status,
        features: row.features,
        last_synced_at: row.last_synced_at,
        created_at: row.created_at,
        is_mock: String(row.equifax_enrollment_id || "").startsWith("MOCK-"),
        data_source: String(row.equifax_enrollment_id || "").startsWith("MOCK-")
          ? "MOCK_SANDBOX"
          : "EQUIFAX",
      },
    });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function latestScore(req, res) {
  try {
    const result = await equifax.getLatestCreditScore(req.user.id, {
      scoreType: req.query.scoreType || req.query.creditScoreType,
      featureName: req.headers.featurename || req.query.featureName,
    });
    return res.json({
      success: true,
      data: {
        enrollmentId: result.enrollmentId,
        score: result.score,
        scoreType: result.scoreType,
        featureName: result.featureName,
        creditScoreId: result.creditScoreId,
        scoreDate: result.scoreDate,
        correlationId: result.correlationId,
      },
    });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function scoreHistory(req, res) {
  try {
    const result = await equifax.getCreditScoreHistory(req.user.id, {
      scoreType: req.query.scoreType,
      featureName: req.headers.featurename || req.query.featureName,
      historicalLimit: req.query.historicalLimit,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function requestScore(req, res) {
  try {
    // Alias to latest pull (Equifax score APIs are GET-based in supplied collection)
    const result = await equifax.getLatestCreditScore(req.user.id, {
      scoreType: req.body.scoreType || req.query.scoreType,
      featureName: req.body.featureName || req.query.featureName,
    });
    return res.status(201).json({
      success: true,
      data: {
        score: result.score,
        scoreType: result.scoreType,
        creditScoreId: result.creditScoreId,
        scoreDate: result.scoreDate,
      },
    });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function latestReport(req, res) {
  try {
    const result = await equifax.getLatestCreditReport(req.user.id, {
      reportType: req.query.reportType,
    });
    return res.json({
      success: true,
      data: {
        summary: result.summary,
        report: result.report,
        correlationId: result.correlationId,
      },
    });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function reportSummary(req, res) {
  try {
    const creditReportId = req.query.creditReportId || req.params.creditReportId;
    if (!creditReportId) {
      const latest = await equifax.getLatestCreditReport(req.user.id, {
        reportType: req.query.reportType,
      });
      return res.json({ success: true, data: { summary: latest.summary } });
    }
    const section = await equifax.getCreditReportSection(req.user.id, creditReportId, "summary");
    return res.json({ success: true, data: section });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function reportDetails(req, res) {
  try {
    const creditReportId = req.query.creditReportId || req.params.creditReportId;
    const section = String(req.query.section || "revolvingAccounts");
    if (!creditReportId) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "creditReportId is required for report details",
      });
    }
    const result = await equifax.getCreditReportSection(req.user.id, creditReportId, section);
    return res.json({ success: true, data: result });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function monitoringList(req, res) {
  try {
    const sync = String(req.query.sync || "true").toLowerCase() !== "false";
    if (sync) {
      const result = await equifax.syncMonitoringAlerts(req.user.id);
      return res.json({ success: true, data: result });
    }
    const alerts = await equifax.listStoredAlerts(req.user.id);
    return res.json({ success: true, data: { alerts } });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

async function monitoringAlert(req, res) {
  try {
    const result = await equifax.getMonitoringAlertRemote(req.user.id, req.params.alertId);
    return res.json({ success: true, data: result });
  } catch (error) {
    return equifax.sendEquifaxError(res, error);
  }
}

module.exports = {
  health,
  testAuth,
  enroll,
  getEnrollment,
  latestScore,
  scoreHistory,
  requestScore,
  latestReport,
  reportSummary,
  reportDetails,
  monitoringList,
  monitoringAlert,
  // legacy names
  creditScore: latestScore,
  creditScoreHistory: scoreHistory,
  creditReport: latestReport,
  monitoringGet: monitoringList,
  monitoringChanges: monitoringList,
  monitoringEnroll: monitoringList,
};
