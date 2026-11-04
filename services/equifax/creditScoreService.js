/**
 * Credit Score APIs (delivery_token).
 */

const { equifaxRequest } = require("./equifaxClient");
const { getEnrollmentByUserId, saveScoreSnapshot } = require("./enrollmentRepository");
const { writeAuditLog } = require("../../utils/audit");
const { isEquifaxMockMode } = require("./equifaxConfig");
const { mockScorePayload } = require("./equifaxMock");

async function requireEnrollmentId(userId) {
  const row = await getEnrollmentByUserId(userId);
  if (!row?.equifax_enrollment_id) {
    const err = new Error("No Equifax enrollment found. Call enrollment first.");
    err.code = "EQUIFAX_ENROLLMENT_REQUIRED";
    err.status = 400;
    throw err;
  }
  return row.equifax_enrollment_id;
}

function pickScore(raw) {
  if (!raw || typeof raw !== "object") return { score: null, scoreType: null, id: null, date: null };
  const score =
    raw.score ??
    raw.creditScore ??
    raw.scoreValue ??
    raw.value ??
    raw.data?.score ??
    raw.scores?.[0]?.value ??
    raw.scores?.[0]?.score ??
    null;
  const scoreType =
    raw.scoreType ||
    raw.creditScoreType ||
    raw.type ||
    raw.data?.scoreType ||
    raw.scores?.[0]?.scoreType ||
    null;
  const id =
    raw.creditScoreId ||
    raw.scoreId ||
    raw.id ||
    raw.data?.creditScoreId ||
    raw.scores?.[0]?.creditScoreId ||
    null;
  const date =
    raw.scoreDate ||
    raw.date ||
    raw.asOfDate ||
    raw.data?.scoreDate ||
    raw.scores?.[0]?.scoreDate ||
    null;
  return { score, scoreType, id, date };
}

function safeScorePayload(raw) {
  const picked = pickScore(raw);
  return {
    ...picked,
    keys: raw && typeof raw === "object" ? Object.keys(raw).slice(0, 40) : [],
  };
}

async function getLatestCreditScore(userId, { scoreType, featureName } = {}) {
  const enrollmentId = await requireEnrollmentId(userId);

  if (isEquifaxMockMode()) {
    const mock = mockScorePayload(userId);
    await saveScoreSnapshot({
      userId,
      enrollmentId,
      scoreType: scoreType || mock.scoreType,
      featureName: featureName || mock.scoreType,
      scoreValue: mock.score,
      scoreDate: mock.scoreDate,
      equifaxScoreId: mock.creditScoreId,
      rawSafeJson: { ...mock },
    });
    return {
      enrollmentId,
      score: mock.score,
      scoreType: scoreType || mock.scoreType,
      featureName: featureName || mock.scoreType,
      creditScoreId: mock.creditScoreId,
      scoreDate: mock.scoreDate,
      correlationId: "mock",
      data: mock,
      is_mock: true,
    };
  }

  const headers = {};
  if (featureName) headers.featureName = featureName;

  let path = "/personal/consumer-data-suite/v1/creditScore/latest";
  if (scoreType) {
    path = `/personal/consumer-data-suite/v1/creditScore/latest/${encodeURIComponent(scoreType)}`;
  }

  const result = await equifaxRequest({
    method: "GET",
    path,
    query: scoreType && !path.includes("/latest/") ? { scoreType } : undefined,
    headers,
    tokenKind: "delivery",
    operation: "creditScore.latest",
  });

  const picked = pickScore(result.data);
  await saveScoreSnapshot({
    userId,
    enrollmentId,
    scoreType: picked.scoreType || scoreType || null,
    featureName: featureName || null,
    scoreValue: picked.score,
    scoreDate: picked.date,
    equifaxScoreId: picked.id,
    rawSafeJson: safeScorePayload(result.data),
  });

  await writeAuditLog({
    userId,
    action: "EQUIFAX_CREDIT_SCORE",
    entityType: "equifax_credit_score",
    entityId: picked.id || enrollmentId,
    meta: { scoreType: picked.scoreType, featureName },
  });

  return {
    enrollmentId,
    score: picked.score,
    scoreType: picked.scoreType || scoreType || null,
    featureName: featureName || null,
    creditScoreId: picked.id,
    scoreDate: picked.date,
    correlationId: result.correlationId,
    data: result.data,
  };
}

async function getCreditScoreHistory(userId, { scoreType, featureName, historicalLimit } = {}) {
  await requireEnrollmentId(userId);

  if (isEquifaxMockMode()) {
    const mock = mockScorePayload(userId);
    return {
      history: {
        scores: [
          { ...mock, scoreDate: mock.scoreDate },
          { ...mock, score: mock.score - 8, scoreDate: "2026-06-01" },
        ],
        is_mock: true,
      },
      correlationId: "mock",
    };
  }

  const headers = {};
  if (featureName) headers.featureName = featureName;
  const query = {};
  if (scoreType) query.scoreType = scoreType;
  if (historicalLimit != null) query.historicalLimit = historicalLimit;

  const result = await equifaxRequest({
    method: "GET",
    path: "/personal/consumer-data-suite/v1/creditScore/history",
    query,
    headers,
    tokenKind: "delivery",
    operation: "creditScore.history",
  });

  return {
    history: result.data,
    correlationId: result.correlationId,
  };
}

async function getCreditScoreById(userId, creditScoreId, { featureName } = {}) {
  await requireEnrollmentId(userId);
  const headers = {};
  if (featureName) headers.featureName = featureName;

  const result = await equifaxRequest({
    method: "GET",
    path: `/personal/consumer-data-suite/v1/creditScore/${encodeURIComponent(creditScoreId)}`,
    headers,
    tokenKind: "delivery",
    operation: "creditScore.byId",
  });

  const picked = pickScore(result.data);
  return {
    score: picked.score,
    scoreType: picked.scoreType,
    creditScoreId: picked.id || creditScoreId,
    scoreDate: picked.date,
    correlationId: result.correlationId,
    data: result.data,
  };
}

async function listCreditScores(userId, { scoreType, featureName } = {}) {
  await requireEnrollmentId(userId);
  const headers = {};
  if (featureName) headers.featureName = featureName;
  const query = {};
  if (scoreType) query.scoreType = scoreType;

  const result = await equifaxRequest({
    method: "GET",
    path: "/personal/consumer-data-suite/v1/creditScore",
    query,
    headers,
    tokenKind: "delivery",
    operation: "creditScore.list",
  });

  return { data: result.data, correlationId: result.correlationId };
}

module.exports = {
  getLatestCreditScore,
  getCreditScoreHistory,
  getCreditScoreById,
  listCreditScores,
  pickScore,
};
