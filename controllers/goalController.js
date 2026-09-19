const {
  listGoalTypes,
  createGoal,
  listGoals,
  getGoal,
  updateGoal,
  deleteGoal,
  contributeToGoal,
  listGoalsAdmin,
} = require("../services/goalService");

function handleGoalError(res, error, fallback) {
  if (error.code === "NOT_FOUND") {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (
    error.code === "VALIDATION_ERROR" ||
    error.code === "INVALID_AMOUNT" ||
    error.code === "INSUFFICIENT_BALANCE"
  ) {
    return res.status(400).json({
      success: false,
      message: error.message,
      code: error.code,
      data: error.data || null,
    });
  }
  console.error(fallback, error);
  return res.status(500).json({
    success: false,
    message: fallback,
    error: error.message,
  });
}

async function getGoalTypes(_req, res) {
  return res.json({
    success: true,
    message: "Available goal types",
    data: { types: listGoalTypes() },
  });
}

async function createUserGoal(req, res) {
  try {
    const data = await createGoal(req.user.id, req.body || {});
    return res.status(201).json({
      success: true,
      message: "Goal created successfully",
      data,
    });
  } catch (error) {
    return handleGoalError(res, error, "Failed to create goal");
  }
}

async function listUserGoals(req, res) {
  try {
    const data = await listGoals(req.user.id, {
      status: req.query.status,
      goal_type: req.query.goal_type || req.query.type,
    });
    return res.json({ success: true, message: "Goals fetched", data });
  } catch (error) {
    return handleGoalError(res, error, "Failed to list goals");
  }
}

async function getUserGoal(req, res) {
  try {
    const data = await getGoal(req.user.id, Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }
    return res.json({ success: true, message: "Goal details", data });
  } catch (error) {
    return handleGoalError(res, error, "Failed to fetch goal");
  }
}

async function updateUserGoal(req, res) {
  try {
    const data = await updateGoal(req.user.id, Number(req.params.id), req.body || {});
    return res.json({ success: true, message: "Goal updated", data });
  } catch (error) {
    return handleGoalError(res, error, "Failed to update goal");
  }
}

async function deleteUserGoal(req, res) {
  try {
    const data = await deleteGoal(req.user.id, Number(req.params.id));
    return res.json({ success: true, message: "Goal deleted", data });
  } catch (error) {
    return handleGoalError(res, error, "Failed to delete goal");
  }
}

async function contributeUserGoal(req, res) {
  try {
    const amount = req.body.amount;
    const data = await contributeToGoal(req.user.id, Number(req.params.id), amount, {
      note: req.body.note || req.body.description,
      source: req.body.source || "wallet",
    });
    return res.status(201).json({
      success: true,
      message: data.message,
      data,
    });
  } catch (error) {
    return handleGoalError(res, error, "Failed to contribute to goal");
  }
}

async function adminListGoals(req, res) {
  try {
    const data = await listGoalsAdmin({
      userId: req.query.user_id || req.query.userId,
      status: req.query.status,
      goal_type: req.query.goal_type || req.query.type,
      search: req.query.search || req.query.q,
      limit: req.query.limit,
    });
    return res.json({ success: true, message: "Admin goals overview", data });
  } catch (error) {
    return handleGoalError(res, error, "Failed to list admin goals");
  }
}

async function adminListUserGoals(req, res) {
  try {
    const userId = Number(req.params.id || req.params.userId);
    if (!userId) {
      return res.status(400).json({ success: false, message: "Valid user id required" });
    }
    const data = await listGoals(userId, {
      status: req.query.status,
      goal_type: req.query.goal_type || req.query.type,
    });
    return res.json({
      success: true,
      message: "User goals",
      data: { user_id: userId, ...data },
    });
  } catch (error) {
    return handleGoalError(res, error, "Failed to fetch user goals");
  }
}

async function adminGetGoal(req, res) {
  try {
    const goalId = Number(req.params.id);
    const pool = require("../config/db");
    const [rows] = await pool.query(`SELECT user_id FROM user_goals WHERE id = :id LIMIT 1`, {
      id: goalId,
    });
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }
    const data = await getGoal(rows[0].user_id, goalId);
    return res.json({ success: true, message: "Goal details", data });
  } catch (error) {
    return handleGoalError(res, error, "Failed to fetch goal");
  }
}

module.exports = {
  getGoalTypes,
  createUserGoal,
  listUserGoals,
  getUserGoal,
  updateUserGoal,
  deleteUserGoal,
  contributeUserGoal,
  adminListGoals,
  adminListUserGoals,
  adminGetGoal,
};
