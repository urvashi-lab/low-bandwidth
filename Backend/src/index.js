const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { initSockets } = require("./sockets");
const slidesRoutes = require("./routes/slides");
const resourceRoutes = require("./routes/resources");
const uploadRoutes = require("./routes/upload");
const { errorMiddleware } = require("./middleware/errors");
const fsPromises = require("fs/promises");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const userRoutes = require("./routes/userRoutes");

dotenv.config();
connectDB();

const app = express();
app.use(express.json());
const server = http.createServer(app);

// Static file serving
app.use("/api/users", userRoutes);
app.use("/slides", express.static(path.join(__dirname, "..", "slides")));
app.use("/resources", express.static(path.join(__dirname, "..", "resources")));
// Serve static files from Backend public folder
app.use(express.static(path.join(__dirname, "..", "public")));
// Serve service worker from backend path to root scope
app.get("/sw.js", async (req, res) => {
  try {
    const swPath = path.join(__dirname, "public", "sw.js");
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(swPath);
  } catch (e) {
    res.status(404).end();
  }
});

// Routes
app.use(slidesRoutes);
app.use(resourceRoutes);
app.use(uploadRoutes);

// Errors
app.use(errorMiddleware);

// Create necessary directories
["uploads", "slides", "resources"].forEach((dir) => {
  const full = path.join(__dirname, "..", dir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

// Sockets
initSockets(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(
    `🚀 Virtual Classroom Server running on http://localhost:${PORT}`
  );
});
