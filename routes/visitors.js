const express = require("express");
const { getVisitors, recordVisitor } = require("../controllers/visitorController");

const router = express.Router();

router.get("/", getVisitors);
router.post("/", recordVisitor);

module.exports = router;