const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  listFds,
  addFd,
  deleteFd,
  getFdSummary,
  breakFd,
} = require("../controllers/portfolioController");

const router = express.Router();

router.use(authenticate);

router.get("/", listFds);
router.get("/summary", getFdSummary);
router.post("/", addFd);
router.post("/:id/break", breakFd);
router.delete("/:id", deleteFd);

module.exports = router;
