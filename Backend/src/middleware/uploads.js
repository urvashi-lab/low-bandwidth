const multer = require("multer");

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".pptx", ".png", ".jpg", ".jpeg"];
    const ext = require("path").extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Unsupported file type"), false);
  },
});

module.exports = { upload };


