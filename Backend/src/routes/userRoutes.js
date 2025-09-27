const express = require("express");
const router = express.Router();
const { createUser, loginUser, getUser } = require("../controllers/userController");

router.post("/create", createUser);        // Sign up
router.post("/login", loginUser);          // Login
router.get("/:username", getUser);    
router.post("/", loginUser);        // Get user info
router.get("/", (req, res) => {
  res.send("Home Page");
});
module.exports = router;
