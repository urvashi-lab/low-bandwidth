const express = require("express");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { upload } = require("../middleware/uploads");
const { getIo } = require("../sockets/io");

const router = express.Router();

router.post("/upload-resource", upload.single("file"), async (req, res) => {
  const io = getIo();
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const resourceId = uuidv4();
    const resourcesBase = path.join(__dirname, "..", "..", "resources", resourceId);
    if (!fs.existsSync(resourcesBase)) fs.mkdirSync(resourcesBase, { recursive: true });

    const originalName = file.originalname;
    const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const targetPath = path.join(resourcesBase, safeName);
    fs.renameSync(file.path, targetPath);

    const url = `/resources/${resourceId}/${safeName}`;
    const stats = fs.statSync(targetPath);
    const payload = {
      id: resourceId,
      name: originalName,
      safeName,
      url,
      size: stats.size,
      mime: req.headers["content-type"] || "application/octet-stream",
      timestamp: Date.now(),
    };
    io.emit("resource-added", payload);
    return res.json({ success: true, resource: payload });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to upload resource" });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
  }
});

router.delete("/resources/:id/:name", (req, res) => {
  const io = getIo();
  try {
    const { id, name } = req.params;
    const dir = path.join(__dirname, "..", "..", "resources", id);
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Resource not found" });

    fs.unlinkSync(filePath);
    try {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) fs.rmdirSync(dir);
    } catch {}

    const url = `/resources/${id}/${name}`;
    io.emit("resource-removed", { id, name, url, timestamp: Date.now() });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to delete resource" });
  }
});

router.get("/resources-index", (req, res) => {
  try {
    const resourcesDir = path.join(__dirname, "..", "..", "resources");
    if (!fs.existsSync(resourcesDir)) return res.json({ resources: [] });
    const dirs = fs.readdirSync(resourcesDir).filter((name) => {
      try { return fs.statSync(path.join(resourcesDir, name)).isDirectory(); } catch { return false; }
    });
    const resources = [];
    dirs.forEach((dir) => {
      const dirPath = path.join(resourcesDir, dir);
      const files = fs.readdirSync(dirPath);
      files.forEach((file) => {
        const filePath = path.join(dirPath, file);
        try {
          const stat = fs.statSync(filePath);
          resources.push({ id: dir, name: file, url: `/resources/${dir}/${file}`, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {}
      });
    });
    resources.sort((a, b) => b.mtimeMs - a.mtimeMs);
    res.json({ resources });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read resources" });
  }
});

module.exports = router;


