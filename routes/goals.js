const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  getGoalTypes,
  createUserGoal,
  listUserGoals,
  getUserGoal,
  updateUserGoal,
  deleteUserGoal,
  contributeUserGoal,
} = require("../controllers/goalController");

const router = express.Router();

router.get("/types", getGoalTypes);

router.use(authenticate);

router.get("/", listUserGoals);
router.post("/", createUserGoal);
router.get("/:id", getUserGoal);
router.put("/:id", updateUserGoal);
router.patch("/:id", updateUserGoal);
router.delete("/:id", deleteUserGoal);
router.post("/:id/contribute", contributeUserGoal);

module.exports = router;
