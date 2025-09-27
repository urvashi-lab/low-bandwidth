const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Manual file route for slides
router.get("/slides/:id/:filename", (req, res) => {
  const { id, filename } = req.params;
  const filePath = path.join(__dirname, "..", "..", "slides", id, filename);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") res.setHeader("Content-Type", "image/jpeg");
    else if (ext === ".png") res.setHeader("Content-Type", "image/png");
    else if (ext === ".webp") res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(path.resolve(filePath));
  } else {
    const dirPath = path.join(__dirname, "..", "..", "slides", id);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      res.status(404).json({ error: "File not found", requested: filename, directory: id, availableFiles: files });
    } else {
      const slidesDir = path.join(__dirname, "..", "..", "slides");
      const availableDirs = fs.existsSync(slidesDir) ? fs.readdirSync(slidesDir) : [];
      res.status(404).json({ error: "Directory not found", requested: id, availableDirectories: availableDirs });
    }
  }
});

// Diagnostic route
router.get("/test-slides", (req, res) => {
  const slidesDir = path.join(__dirname, "..", "..", "slides");
  if (!fs.existsSync(slidesDir)) return res.json({ error: "Slides directory does not exist" });
  try {
    const directories = fs.readdirSync(slidesDir).filter((item) => fs.statSync(path.join(slidesDir, item)).isDirectory());
    const result = {};
    directories.forEach((dir) => {
      const dirPath = path.join(slidesDir, dir);
      result[dir] = fs.readdirSync(dirPath);
    });
    res.json({ success: true, slidesDirectory: slidesDir, slideDirectories: result, totalDirectories: directories.length });
  } catch (error) {
    res.json({ error: error.message, slidesDirectory: slidesDir });
  }
});

module.exports = router;


