/**
 * User financial goals — Dream House, Retirement, Child Education, Emergency Fund.
 * Progress + milestones driven by contributions; market rate used for projections.
 */

const pool = require("../config/db");
const { debitWallet, roundMoney } = require("./walletService");

const GOAL_TYPES = {
  DREAM_HOUSE: {
    code: "DREAM_HOUSE",
    label: "Dream House",
    description: "Save toward a home purchase down payment or property goal.",
    icon: "home",
  },
  RETIREMENT: {
    code: "RETIREMENT",
    label: "Retirement Plans",
    description: "Build a long-term retirement corpus.",
    icon: "retirement",
  },
  CHILD_EDUCATION: {
    code: "CHILD_EDUCATION",
    label: "Child Education",
    description: "Fund education milestones for your child.",
    icon: "education",
  },
  EMERGENCY_FUND: {
    code: "EMERGENCY_FUND",
    label: "Emergency Fund",
    description: "Maintain a safety buffer for unexpected expenses.",
    icon: "shield",
  },
};

const MILESTONE_DEFS = [
  {
    percent: 0,
    stage: 1,
    key: "started",
    label: "Goal Started",
    description: "Goal created — begin investing step by step.",
  },
  {
    percent: 25,
    stage: 2,
    key: "foundation",
    label: "Foundation",
    description: "25% of target accumulated.",
  },
  {
    percent: 50,
    stage: 3,
    key: "halfway",
    label: "Halfway There",
    description: "50% of target reached.",
  },
  {
    percent: 75,
    stage: 4,
    key: "near_goal",
    label: "Near Goal",
    description: "75% of target — final stretch.",
  },
  {
    percent: 100,
    stage: 5,
    key: "achieved",
    label: "Goal Achieved",
    description: "100% of target amount reached.",
  },
];

function normalizeGoalType(raw) {
  const key = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const aliases = {
    DREAM_HOUSE: "DREAM_HOUSE",
    HOUSE: "DREAM_HOUSE",
    HOME: "DREAM_HOUSE",
    DREAM: "DREAM_HOUSE",
    RETIREMENT: "RETIREMENT",
    RETIREMENT_PLANS: "RETIREMENT",
    RETIREMENT_PLAN: "RETIREMENT",
    CHILD_EDUCATION: "CHILD_EDUCATION",
    EDUCATION: "CHILD_EDUCATION",
    CHILD: "CHILD_EDUCATION",
    EMERGENCY_FUND: "EMERGENCY_FUND",
    EMERGENCY: "EMERGENCY_FUND",
  };
  return aliases[key] || null;
}

function defaultTitle(goalType) {
  return GOAL_TYPES[goalType]?.label || "My Goal";
}

function calcProgress(current, target) {
  const t = Number(target) || 0;
  const c = Number(current) || 0;
  if (t <= 0) return 0;
  return Math.min(100, Math.round((c / t) * 10000) / 100);
}

function buildMilestones(currentAmount, targetAmount, createdAt) {
  const progress = calcProgress(currentAmount, targetAmount);
  let currentStage = MILESTONE_DEFS[0];

  const milestones = MILESTONE_DEFS.map((m) => {
    const achieved = progress >= m.percent;
    if (achieved) currentStage = m;
    return {
      ...m,
      achieved,
      amount_required: roundMoney((Number(targetAmount) * m.percent) / 100),
      status: "upcoming",
    };
  });

  milestones.forEach((m) => {
    if (m.percent === currentStage.percent && m.achieved) m.status = "current";
    else if (m.achieved) m.status = "completed";
    else m.status = "upcoming";
  });

  const next = milestones.find((m) => !m.achieved) || null;

  return {
    progress_percent: progress,
    current_stage: {
      stage: currentStage.stage,
      key: currentStage.key,
      label: currentStage.label,
      percent: currentStage.percent,
      description: currentStage.description,
    },
    next_milestone: next
      ? {
          stage: next.stage,
          key: next.key,
          label: next.label,
          percent: next.percent,
          amount_required: next.amount_required,
          amount_remaining: roundMoney(
            next.amount_required - Number(currentAmount || 0)
          ),
        }
      : null,
    milestones,
    started_at: createdAt || null,
  };
}

async function getMarketRateSnapshot() {
  try {
    const [rows] = await pool.query(
      `SELECT AVG(interest_rate) AS avg_rate, MAX(interest_rate) AS max_rate, MIN(interest_rate) AS min_rate
       FROM fd_rd_rates
       WHERE status = 'active'`
    );
    const avg = Number(rows[0]?.avg_rate);
    if (Number.isFinite(avg) && avg > 0) {
      return {
        average_fd_rate: Math.round(avg * 100) / 100,
        max_fd_rate: roundMoney(rows[0].max_rate),
        min_fd_rate: roundMoney(rows[0].min_rate),
        source: "fd_rd_rates",
        as_of: new Date().toISOString().slice(0, 10),
      };
    }
  } catch (_e) {
    /* rates table may differ */
  }

  try {
    const [rows] = await pool.query(
      `SELECT AVG(interest_rate) AS avg_rate FROM portfolio_fds WHERE status = 'active'`
    );
    const avg = Number(rows[0]?.avg_rate);
    if (Number.isFinite(avg) && avg > 0) {
      return {
        average_fd_rate: Math.round(avg * 100) / 100,
        source: "portfolio_fds",
        as_of: new Date().toISOString().slice(0, 10),
      };
    }
  } catch (_e2) {
    /* ignore */
  }

  return {
    average_fd_rate: 7.5,
    source: "default_demo",
    as_of: new Date().toISOString().slice(0, 10),
    note: "Using default market rate — live FD rates unavailable",
  };
}

function projectGoal({ remaining, monthlyContribution, annualRate }) {
  const rem = Math.max(0, Number(remaining) || 0);
  if (rem <= 0) {
    return {
      months_to_goal: 0,
      projected_completion_date: new Date().toISOString().slice(0, 10),
      note: "Goal already funded",
    };
  }
  const monthly = Number(monthlyContribution) || 0;
  const rate = Number(annualRate) || 7.5;
  if (monthly <= 0) {
    return {
      months_to_goal: null,
      projected_completion_date: null,
      note: "Add regular contributions to estimate completion",
      suggested_monthly_for_12_months: roundMoney(rem / 12),
      market_rate_used: rate,
    };
  }

  const monthlyRate = rate / 100 / 12;
  let balance = 0;
  let months = 0;
  const maxMonths = 600;
  while (balance < rem && months < maxMonths) {
    months += 1;
    balance = (balance + monthly) * (1 + monthlyRate);
  }
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return {
    months_to_goal: months,
    projected_completion_date: d.toISOString().slice(0, 10),
    market_rate_used: rate,
    assumed_monthly_contribution: monthly,
  };
}

async function formatGoal(row, { includeContributions = false, market = null } = {}) {
  const target = roundMoney(row.target_amount);
  const current = roundMoney(row.current_amount);
  const remaining = roundMoney(Math.max(0, target - current));
  const goalType =
    normalizeGoalType(row.category || row.goal_type) || String(row.category || "").toUpperCase();
  const typeMeta = GOAL_TYPES[goalType] || {
    code: goalType,
    label: row.title || goalType,
    icon: row.icon || "goal",
  };
  const milestoneInfo = buildMilestones(current, target, row.created_at);
  const marketInfo = market || (await getMarketRateSnapshot());

  let monthlyEst = 0;
  try {
    const [agg] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM goal_contributions
       WHERE goal_id = :goalId AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      { goalId: row.id }
    );
    monthlyEst = roundMoney(Number(agg[0]?.total || 0) / 3);
  } catch (_e) {
    monthlyEst = 0;
  }

  const projection = projectGoal({
    remaining,
    monthlyContribution: monthlyEst,
    annualRate: Number(row.market_rate_snapshot) || marketInfo.average_fd_rate,
  });

  const rawStatus = String(row.status || "active").toLowerCase();
  const apiStatus =
    rawStatus === "completed" || rawStatus === "achieved"
      ? "ACHIEVED"
      : rawStatus.toUpperCase();

  const payload = {
    id: row.id,
    user_id: row.user_id,
    goal_type: goalType,
    goal_type_label: typeMeta.label,
    category: goalType,
    title: row.title,
    target_amount: target,
    target_amount_display: `₹${target.toLocaleString("en-IN")}`,
    current_amount: current,
    current_amount_display: `₹${current.toLocaleString("en-IN")}`,
    remaining_amount: remaining,
    remaining_amount_display: `₹${remaining.toLocaleString("en-IN")}`,
    currency: row.currency || "INR",
    start_date: row.start_date || null,
    target_date: row.target_date,
    status: apiStatus,
    priority: Number(row.priority || 3),
    notes: row.description || row.notes || null,
    icon: row.icon || typeMeta.icon || null,
    color: row.color || null,
    progress_source: row.progress_source || "wallet",
    market: {
      ...marketInfo,
      rate_snapshot:
        row.market_rate_snapshot != null
          ? Number(row.market_rate_snapshot)
          : marketInfo.average_fd_rate,
    },
    achievement: {
      ...milestoneInfo,
      is_achieved:
        current >= target || rawStatus === "completed" || rawStatus === "achieved",
      achieved_at: row.achieved_at,
    },
    projection,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (includeContributions) {
    const [contribs] = await pool.query(
      `SELECT id, amount, source, reference_type, reference_id, note,
              balance_before, balance_after, created_at
       FROM goal_contributions WHERE goal_id = :goalId ORDER BY id DESC LIMIT 50`,
      { goalId: row.id }
    );
    payload.contributions = contribs.map((c) => ({
      id: c.id,
      amount: roundMoney(c.amount),
      source: c.source,
      reference_type: c.reference_type,
      reference_id: c.reference_id,
      note: c.note,
      balance_before: c.balance_before != null ? roundMoney(c.balance_before) : null,
      balance_after: c.balance_after != null ? roundMoney(c.balance_after) : null,
      created_at: c.created_at,
    }));
  }

  return payload;
}

function listGoalTypes() {
  return Object.values(GOAL_TYPES).map((t) => ({
    ...t,
    milestones: MILESTONE_DEFS,
  }));
}

async function createGoal(userId, body) {
  const goalType = normalizeGoalType(body.goal_type || body.type || body.category);
  if (!goalType || !GOAL_TYPES[goalType]) {
    const err = new Error(
      `Invalid goal_type. Allowed: ${Object.keys(GOAL_TYPES).join(", ")}`
    );
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const target = roundMoney(body.target_amount || body.amount || body.goal_amount);
  if (!target || target < 1000) {
    const err = new Error("target_amount must be at least ₹1,000");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (target > 100000000) {
    const err = new Error("target_amount is too large");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const title = String(body.title || defaultTitle(goalType)).trim().slice(0, 150);
  const notes = body.notes || body.description
    ? String(body.notes || body.description).trim().slice(0, 1000)
    : null;
  const priority = Math.min(5, Math.max(1, Number(body.priority) || 3));
  let targetDate = body.target_date || body.targetDate || null;
  if (targetDate) {
    const d = new Date(targetDate);
    if (Number.isNaN(d.getTime())) targetDate = null;
    else targetDate = d.toISOString().slice(0, 10);
  }

  const initial = roundMoney(body.current_amount || body.initial_amount || 0);
  if (initial < 0 || initial > target) {
    const err = new Error("current_amount must be between 0 and target_amount");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const market = await getMarketRateSnapshot();
  const milestonePercent = buildMilestones(initial, target).current_stage.percent;
  const status = initial >= target ? "completed" : "active";
  const icon = body.icon || GOAL_TYPES[goalType].icon;
  const color = body.color || null;
  const startDate = new Date().toISOString().slice(0, 10);

  const [ins] = await pool.query(
    `INSERT INTO user_goals
      (user_id, title, description, category, target_amount, current_amount,
       start_date, target_date, status, progress_source, icon, color,
       priority, market_rate_snapshot, milestone_percent, achieved_at)
     VALUES
      (:userId, :title, :description, :category, :target, :current,
       :startDate, :targetDate, :status, 'wallet', :icon, :color,
       :priority, :rate, :milestone, :achievedAt)`,
    {
      userId,
      title,
      description: notes,
      category: goalType,
      target,
      current: initial,
      startDate,
      targetDate,
      status,
      icon,
      color,
      priority,
      rate: market.average_fd_rate,
      milestone: milestonePercent,
      achievedAt: status === "completed" ? new Date() : null,
    }
  );

  if (initial > 0) {
    await pool.query(
      `INSERT INTO goal_contributions
        (goal_id, user_id, amount, source, note, balance_before, balance_after)
       VALUES (:goalId, :userId, :amount, 'manual', :note, 0, :after)`,
      {
        goalId: ins.insertId,
        userId,
        amount: initial,
        note: "Initial amount at goal creation",
        after: initial,
      }
    );
  }

  const [rows] = await pool.query(`SELECT * FROM user_goals WHERE id = :id LIMIT 1`, {
    id: ins.insertId,
  });
  return formatGoal(rows[0], { includeContributions: true, market });
}

async function listGoals(userId, { status, goal_type } = {}) {
  const market = await getMarketRateSnapshot();
  let sql = `SELECT * FROM user_goals WHERE user_id = :userId`;
  const params = { userId };
  if (status) {
    const s = String(status).toLowerCase();
    if (s === "achieved" || s === "completed") {
      sql += ` AND status IN ('completed','achieved')`;
    } else {
      sql += ` AND status = :status`;
      params.status = s;
    }
  }
  if (goal_type) {
    const t = normalizeGoalType(goal_type);
    if (t) {
      sql += ` AND category = :goalType`;
      params.goalType = t;
    }
  }
  sql += ` ORDER BY FIELD(status,'active','paused','completed','achieved','cancelled'), COALESCE(priority,3) ASC, id DESC`;

  const [rows] = await pool.query(sql, params);
  const items = [];
  for (const row of rows) {
    items.push(await formatGoal(row, { market }));
  }

  const active = items.filter((g) => g.status === "ACTIVE");
  const totalTarget = roundMoney(active.reduce((s, g) => s + g.target_amount, 0));
  const totalSaved = roundMoney(active.reduce((s, g) => s + g.current_amount, 0));

  return {
    market,
    summary: {
      total_goals: items.length,
      active_goals: active.length,
      achieved_goals: items.filter((g) => g.status === "ACHIEVED").length,
      total_target_amount: totalTarget,
      total_saved_amount: totalSaved,
      overall_progress_percent: calcProgress(totalSaved, totalTarget),
    },
    goal_types: listGoalTypes(),
    items,
  };
}

async function getGoal(userId, goalId) {
  const [rows] = await pool.query(
    `SELECT * FROM user_goals WHERE id = :id AND user_id = :userId LIMIT 1`,
    { id: goalId, userId }
  );
  if (!rows.length) return null;
  return formatGoal(rows[0], { includeContributions: true });
}

async function updateGoal(userId, goalId, body) {
  const [rows] = await pool.query(
    `SELECT * FROM user_goals WHERE id = :id AND user_id = :userId LIMIT 1`,
    { id: goalId, userId }
  );
  if (!rows.length) {
    const err = new Error("Goal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const existing = rows[0];
  if (existing.status === "cancelled") {
    const err = new Error("Cancelled goals cannot be edited");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  let goalType = normalizeGoalType(existing.category) || existing.category;
  if (body.goal_type || body.type || body.category) {
    const t = normalizeGoalType(body.goal_type || body.type || body.category);
    if (!t) {
      const err = new Error("Invalid goal_type");
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    goalType = t;
  }

  const title =
    body.title != null ? String(body.title).trim().slice(0, 150) : existing.title;
  const target =
    body.target_amount != null || body.amount != null
      ? roundMoney(body.target_amount || body.amount)
      : roundMoney(existing.target_amount);

  if (!target || target < 1000) {
    const err = new Error("target_amount must be at least ₹1,000");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const current = roundMoney(existing.current_amount);
  if (target < current) {
    const err = new Error("target_amount cannot be less than already saved amount");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  let targetDate = existing.target_date;
  if (body.target_date !== undefined || body.targetDate !== undefined) {
    const raw = body.target_date ?? body.targetDate;
    if (!raw) targetDate = null;
    else {
      const d = new Date(raw);
      targetDate = Number.isNaN(d.getTime()) ? existing.target_date : d.toISOString().slice(0, 10);
    }
  }

  let notes = existing.description;
  if (body.notes !== undefined || body.description !== undefined) {
    const raw = body.notes !== undefined ? body.notes : body.description;
    notes = raw ? String(raw).trim().slice(0, 1000) : null;
  }
  const priority =
    body.priority != null
      ? Math.min(5, Math.max(1, Number(body.priority) || 3))
      : existing.priority || 3;

  let status = existing.status;
  if (body.status) {
    let s = String(body.status).toLowerCase();
    if (s === "achieved") s = "completed";
    if (!["active", "paused", "completed", "cancelled"].includes(s)) {
      const err = new Error("Invalid status");
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    status = s;
  }
  if (current >= target) status = "completed";

  const milestonePercent = buildMilestones(current, target).current_stage.percent;
  const achievedAt = status === "completed" ? existing.achieved_at || new Date() : null;
  const icon = body.icon != null ? body.icon : existing.icon || GOAL_TYPES[goalType]?.icon;

  await pool.query(
    `UPDATE user_goals SET
       category = :category,
       title = :title,
       description = :description,
       target_amount = :target,
       target_date = :targetDate,
       status = :status,
       priority = :priority,
       icon = :icon,
       milestone_percent = :milestone,
       achieved_at = :achievedAt
     WHERE id = :id AND user_id = :userId`,
    {
      category: goalType,
      title,
      description: notes,
      target,
      targetDate,
      status,
      priority,
      icon,
      milestone: milestonePercent,
      achievedAt,
      id: goalId,
      userId,
    }
  );

  return getGoal(userId, goalId);
}

async function deleteGoal(userId, goalId) {
  const [rows] = await pool.query(
    `SELECT id FROM user_goals WHERE id = :id AND user_id = :userId LIMIT 1`,
    { id: goalId, userId }
  );
  if (!rows.length) {
    const err = new Error("Goal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  await pool.query(`DELETE FROM user_goals WHERE id = :id AND user_id = :userId`, {
    id: goalId,
    userId,
  });
  return { deleted: true, goal_id: goalId };
}

/**
 * Contribute toward a goal from wallet (step-by-step investing into the goal).
 */
async function contributeToGoal(userId, goalId, amountRaw, { note, source } = {}) {
  const amount = roundMoney(amountRaw);
  if (!amount || amount < 1) {
    const err = new Error("Contribution amount must be at least ₹1");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const [check] = await pool.query(
    `SELECT * FROM user_goals WHERE id = :id AND user_id = :userId LIMIT 1`,
    { id: goalId, userId }
  );
  if (!check.length) {
    const err = new Error("Goal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const goal = check[0];
  if (!["active", "paused"].includes(goal.status)) {
    const err = new Error(`Cannot contribute to a ${goal.status} goal`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const before = roundMoney(goal.current_amount);
  const target = roundMoney(goal.target_amount);
  const remaining = roundMoney(Math.max(0, target - before));
  if (remaining <= 0) {
    const err = new Error("Goal target already reached");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (amount > remaining) {
    const err = new Error(
      `Contribution exceeds remaining goal amount (₹${remaining.toLocaleString("en-IN")})`
    );
    err.code = "VALIDATION_ERROR";
    err.data = { remaining };
    throw err;
  }

  const contribSource =
    String(source || "wallet").toLowerCase() === "manual" ? "manual" : "wallet";
  let walletResult = null;

  if (contribSource === "wallet") {
    walletResult = await debitWallet({
      userId,
      amount,
      category: "goal_contribution",
      referenceType: "user_goal",
      referenceId: goalId,
      description: `Goal contribution: ${goal.title}`,
      meta: { goal_type: goal.category, goal_id: goalId },
    });
  }

  const after = roundMoney(before + amount);
  const milestonePercent = buildMilestones(after, target).current_stage.percent;
  const status = after >= target ? "completed" : goal.status === "paused" ? "active" : goal.status;

  await pool.query(
    `UPDATE user_goals SET
       current_amount = :after,
       milestone_percent = :milestone,
       status = :status,
       achieved_at = CASE WHEN :statusAchieved = 1 THEN COALESCE(achieved_at, NOW()) ELSE achieved_at END
     WHERE id = :id`,
    {
      after,
      milestone: milestonePercent,
      status,
      statusAchieved: status === "completed" ? 1 : 0,
      id: goalId,
    }
  );

  const [ins] = await pool.query(
    `INSERT INTO goal_contributions
      (goal_id, user_id, amount, source, reference_type, reference_id, note, balance_before, balance_after)
     VALUES
      (:goalId, :userId, :amount, :source, :refType, :refId, :note, :before, :after)`,
    {
      goalId,
      userId,
      amount,
      source: contribSource,
      refType: contribSource === "wallet" ? "wallet_transaction" : "manual",
      refId: walletResult?.transaction_id || null,
      note: note || `Step contribution toward ${goal.title}`,
      before,
      after,
    }
  );

  const formatted = await getGoal(userId, goalId);
  return {
    message:
      status === "completed"
        ? "Contribution added — goal achieved!"
        : "Contribution added toward your goal",
    contribution_id: ins.insertId,
    amount,
    goal_balance_before: before,
    goal_balance_after: after,
    wallet_balance: walletResult?.balance ?? null,
    goal: formatted,
  };
}

async function listGoalsAdmin({ userId, status, goal_type, search, limit = 50 } = {}) {
  const market = await getMarketRateSnapshot();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  let sql = `
    SELECT g.*, u.full_name, u.email, u.phone
    FROM user_goals g
    JOIN users u ON u.id = g.user_id
    WHERE 1=1`;
  const params = {};
  if (userId) {
    sql += ` AND g.user_id = :userId`;
    params.userId = Number(userId);
  }
  if (status) {
    const s = String(status).toLowerCase();
    if (s === "achieved" || s === "completed") {
      sql += ` AND g.status IN ('completed','achieved')`;
    } else {
      sql += ` AND g.status = :status`;
      params.status = s;
    }
  }
  if (goal_type) {
    const t = normalizeGoalType(goal_type);
    if (t) {
      sql += ` AND g.category = :goalType`;
      params.goalType = t;
    }
  }
  if (search) {
    sql += ` AND (u.email LIKE :q OR u.full_name LIKE :q OR g.title LIKE :q)`;
    params.q = `%${String(search).trim()}%`;
  }
  sql += ` ORDER BY g.id DESC LIMIT ${safeLimit}`;

  const [rows] = await pool.query(sql, params);
  const items = [];
  for (const row of rows) {
    const goal = await formatGoal(row, { market });
    items.push({
      ...goal,
      user: {
        id: row.user_id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
      },
    });
  }

  const [[stats]] = await pool.query(
    `SELECT
       COUNT(*) AS total_goals,
       SUM(status = 'active') AS active_goals,
       SUM(status IN ('completed','achieved')) AS achieved_goals,
       COALESCE(SUM(target_amount), 0) AS total_target,
       COALESCE(SUM(current_amount), 0) AS total_saved
     FROM user_goals`
  );

  return {
    market,
    summary: {
      total_goals: Number(stats.total_goals || 0),
      active_goals: Number(stats.active_goals || 0),
      achieved_goals: Number(stats.achieved_goals || 0),
      total_target_amount: roundMoney(stats.total_target),
      total_saved_amount: roundMoney(stats.total_saved),
    },
    items,
  };
}

async function getGoalsForHome(userId) {
  const data = await listGoals(userId, { status: "active" });
  return {
    summary: data.summary,
    market: data.market,
    items: data.items.map((g) => ({
      id: g.id,
      goal_type: g.goal_type,
      goal_type_label: g.goal_type_label,
      title: g.title,
      target_amount: g.target_amount,
      current_amount: g.current_amount,
      remaining_amount: g.remaining_amount,
      progress_percent: g.achievement.progress_percent,
      current_stage: g.achievement.current_stage,
      next_milestone: g.achievement.next_milestone,
      status: g.status,
    })),
  };
}

module.exports = {
  GOAL_TYPES,
  MILESTONE_DEFS,
  listGoalTypes,
  createGoal,
  listGoals,
  getGoal,
  updateGoal,
  deleteGoal,
  contributeToGoal,
  listGoalsAdmin,
  getGoalsForHome,
  getMarketRateSnapshot,
  normalizeGoalType,
};
