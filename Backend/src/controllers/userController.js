const User = require("../models/User");
const bcrypt = require("bcrypt");

// Sign Up
const createUser = async (req, res) => {
  try {
    const { username, password, fullName, role } = req.body;

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({ username, password: hashedPassword, fullName, role });
    await newUser.save();

    res.status(201).json({ message: "User created successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Login
const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    res.status(200).json({ 
      message: "Login successful", 
      user: { username: user.username, fullName: user.fullName, role: user.role } 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get user details
const getUser = async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ 
      username: user.username, 
      fullName: user.fullName, 
      role: user.role 
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = { createUser, loginUser, getUser };
