const multer = require("multer");

function errorMiddleware(error, req, res, next) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 50MB." });
    }
  }
  res.status(500).json({ error: error.message });
}

module.exports = { errorMiddleware };


