const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const sharp = require("sharp");
const pdfPoppler = require("pdf-poppler");
const { exec } = require("child_process");
const mongoose = require("mongoose");
const User = require("./src/models/User");
const userRoutes = require("./src/routes/userRoutes");
require('dotenv').config();
const connectedClients = new Map();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error(err));

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});



app.get("/", (req, res) => {
  res.redirect("/login");
});

// CRITICAL: Add these middleware BEFORE your routes
app.use(express.json()); // Parse JSON bodies - THIS IS ESSENTIAL
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Add CORS if needed for frontend requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.static(path.join(__dirname, '../Frontend')));

// Debug middleware to log requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Request body:', req.body);
  }
  next();
});

// Error handling middleware (add at the end)


// Static file serving
app.use("/slides", express.static(path.join(__dirname, "slides")));
app.use("/resources", express.static(path.join(__dirname, "resources")));


// API Routes - MUST come after body parsing middleware
app.use("/api/users", userRoutes);

// Routes


app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "../Frontend/login.html"));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/dashboard.html'));
});

app.get("/classroom", (req, res) => {
  console.log("Serving classroom.html");
  res.sendFile(path.join(__dirname, "../Frontend/classroom.html"));
});

app.get("/slides/:id/:filename", (req, res) => {
  const { id, filename } = req.params;
  const filePath = path.join(__dirname, "slides", id, filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(path.resolve(filePath));
  } else {
    res.status(404).send("File not found");
  }
});



// Rest of your server code (classroom state, socket handlers, etc.)
let classroomState = {
  currentSlide: 0,
  totalSlides: 0,
  slideData: [],
  isTeacherPresent: false,
  participants: [],
  whiteboardMode: "off",
  whiteboardState: null,
};

// ... rest of your existing code ...



const upload = multer({ dest: "uploads/" });






app.post("/upload-resource", upload.single("file"), async (req, res) => {
  // ... (rest of the function is unchanged)
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const resourceId = uuidv4();
    const resourcesBase = path.join(__dirname, "resources", resourceId);
    if (!fs.existsSync(resourcesBase)) {
      fs.mkdirSync(resourcesBase, { recursive: true });
    }

    const originalName = file.originalname;
    const safeName = sanitizeFilename(originalName);
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
    console.error("Upload resource error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to upload resource" });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
    }
  }
});

app.delete("/resources/:id/:name", (req, res) => {
  // ... (rest of the function is unchanged)
  try {
    const { id, name } = req.params;
    const dir = path.join(__dirname, "resources", id);
    const filePath = path.join(dir, name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Resource not found" });
    }

    fs.unlinkSync(filePath);

    try {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) fs.rmdirSync(dir);
    } catch {}

    const url = `/resources/${id}/${name}`;
    io.emit("resource-removed", { id, name, url, timestamp: Date.now() });
    return res.json({ success: true });
  } catch (e) {
    console.error("Delete resource error:", e);
    return res
      .status(500)
      .json({ error: e.message || "Failed to delete resource" });
  }
});

app.get("/resources-index", (req, res) => {
  // ... (rest of the function is unchanged)
  try {
    const resourcesDir = path.join(__dirname, "resources");
    if (!fs.existsSync(resourcesDir)) return res.json({ resources: [] });

    const dirs = fs.readdirSync(resourcesDir).filter((name) => {
      try {
        return fs.statSync(path.join(resourcesDir, name)).isDirectory();
      } catch {
        return false;
      }
    });

    const resources = [];
    dirs.forEach((dir) => {
      const dirPath = path.join(resourcesDir, dir);
      const files = fs.readdirSync(dirPath);
      files.forEach((file) => {
        const filePath = path.join(dirPath, file);
        try {
          const stat = fs.statSync(filePath);
          resources.push({
            id: dir,
            name: file,
            url: `/resources/${dir}/${file}`,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch {}
      });
    });

    resources.sort((a, b) => b.mtimeMs - a.mtimeMs);
    res.json({ resources });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to read resources" });
  }
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const id = uuidv4();
    const outDir = path.join(__dirname, "slides", id);

    io.emit("upload-started", {
      classroomId: id,
      filename: file.originalname,
      timestamp: Date.now(),
    });

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    let images = [];

    try {
      if (ext === ".pdf") {
        images = await convertPdfToImages(file.path, outDir, io, id);
      } else if (ext === ".pptx") {
        const pdfPath = file.path + ".pdf";
        await convertPptToPdf(file.path, pdfPath);
        images = await convertPdfToImages(pdfPath, outDir, io, id);
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      } else if ([".png", ".jpg", ".jpeg"].includes(ext)) {
        const outPath = path.join(outDir, `slide-1.webp`);
        await sharp(file.path)
          .resize(1280, null, { withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(outPath);

        io.emit("total-slides", { classroomId: id, totalSlides: 1 });
        const slideUrl = `/slides/${id}/slide-1.webp`;
        io.emit("slide-ready", { classroomId: id, url: slideUrl, index: 0 });
        images = [{ url: slideUrl, name: "slide-1.webp", index: 0 }];
      } else {
        throw new Error(`Unsupported file type: ${ext}`);
      }

      if (images.length === 0) {
        throw new Error("No slides generated from file");
      }

      classroomState.slideData = images;
      classroomState.totalSlides = images.length;
      classroomState.currentSlide = 0;

      io.emit("upload-complete", {
        classroomId: id,
        totalSlides: images.length,
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        slides: images,
        totalSlides: images.length,
        classroomId: id,
      });
    } catch (processingError) {
      console.error("File processing error:", processingError);
      if (fs.existsSync(outDir)) {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
      throw processingError;
    }
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({
      error: err.message || "File processing failed",
    });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9.-]/g, "_");
}

async function convertPdfToImages(pdfPath, outDir, io, classroomId) {
  // ... (rest of the function is unchanged)
  try {
    const opts = {
      format: "png",
      out_dir: outDir,
      out_prefix: "page",
      page: null,
    };

    await pdfPoppler.convert(pdfPath, opts);

    let files = fs
      .readdirSync(outDir)
      .filter((f) => f.toLowerCase().endsWith(".png"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
        return numA - numB;
      });

    if (!files.length) throw new Error(`No slides generated from ${pdfPath}`);

    io.emit("total-slides", { classroomId, totalSlides: files.length });

    const images = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.join(outDir, file);
      const outputFilename = `slide-${i + 1}.webp`;
      const outPath = path.join(outDir, outputFilename);

      await sharp(filePath)
        .resize({ width: 1280, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(outPath);

      fs.unlinkSync(filePath);

      const slideData = {
        url: `/slides/${classroomId}/${outputFilename}`,
        name: outputFilename,
        index: i,
      };
      images.push(slideData);

      io.emit("slide-ready", {
        classroomId,
        url: slideData.url,
        index: i,
      });
    }
    return images;
  } catch (err) {
    console.error("PDF conversion failed:", err);
    throw err;
  }
}

function convertPptToPdf(inputPath, outputPath) {
  // ... (rest of the function is unchanged)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("LibreOffice conversion timeout"));
    }, 30000);

    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const command = `soffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;

    exec(command, (err, stdout, stderr) => {
      clearTimeout(timeout);

      if (err) {
        console.error("LibreOffice error:", err);
        console.error("LibreOffice stderr:", stderr);
        reject(new Error(`PPTX conversion failed: ${err.message}`));
        return;
      }

      const inputBaseName = path.basename(inputPath, path.extname(inputPath));
      const generatedPdfPath = path.join(outputDir, inputBaseName + ".pdf");

      setTimeout(() => {
        if (fs.existsSync(generatedPdfPath)) {
          if (generatedPdfPath !== outputPath) {
            try {
              fs.renameSync(generatedPdfPath, outputPath);
            } catch (renameErr) {
              reject(new Error(`Failed to rename PDF: ${renameErr.message}`));
              return;
            }
          }
          resolve();
        } else {
          reject(
            new Error(
              `PDF not generated at expected location: ${generatedPdfPath}`
            )
          );
        }
      }, 1000);
    });
  });
}

function clearSlidesDirectory() {
  const slidesDir = path.join(__dirname, "slides");
  if (fs.existsSync(slidesDir)) {
    fs.rmSync(slidesDir, { recursive: true, force: true });
    fs.mkdirSync(slidesDir); // Recreate the directory
  }
}



io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // --- JOIN CLASSROOM ---
  socket.on("join-classroom", async (data) => {
    try {
      console.log("Join classroom request:", data);
      
      if (!data || !data.username) {
        socket.emit("join-error", { message: "Username required" });
        return;
      }

      const user = await User.findOne({ username: data.username });
      if (!user) {
        console.log("User not found:", data.username);
        socket.emit("join-error", { message: "User not found" });
        return;
      }

      console.log(`User found: ${user.fullName} (${user.role})`);

      // Store client info with proper user data
      connectedClients.set(socket.id, {
        id: socket.id,
        username: user.username,
        name: user.fullName,
        role: user.role,
        socketId: socket.id
      });

      // Update teacher presence
      if (user.role === "teacher") {
        classroomState.isTeacherPresent = true;
        console.log("Teacher joined classroom");
      } else {
        console.log("Student joined classroom");
      }

      // Update participants list
      classroomState.participants = Array.from(connectedClients.values());
      
      console.log("Current participants:", classroomState.participants.map(p => `${p.name} (${p.role})`));

      // Send current classroom state to the joining user
      const stateToSend = {
        ...classroomState,
        userRole: user.role,
        userName: user.fullName
      };

      socket.emit("classroom-joined", stateToSend);
      console.log(`Sent classroom state to ${user.fullName}`);

      // Notify ALL clients (including the one who just joined) about updated participants
      io.emit("participants-updated", classroomState.participants);
      console.log("Broadcasted participants update to all clients");

    } catch (err) {
      console.error("Join classroom error:", err);
      socket.emit("join-error", { message: "Server error during join" });
    }
  });

  

  socket.on("change-slide", (data) => {
    const client = connectedClients.get(socket.id);
    if (client && client.role === "teacher") {
      classroomState.currentSlide = data.slideNumber;
      io.emit("slide-changed", { slideNumber: data.slideNumber });
    }
  });

  socket.on("send-message", (data) => {
    io.emit("new-message", data);
  });

  // --- WHITEBOARD EVENT FIXES START HERE ---

  // Handle whiteboard toggle
  socket.on("whiteboard-toggle", (data) => {
    const client = connectedClients.get(socket.id);
    if (!client) return;

    // Update classroom state with the new mode
    classroomState.whiteboardMode = data.mode;

    // FIX 1: Broadcast to OTHER clients only to prevent the loop
    socket.broadcast.emit("whiteboard-toggle", {
      mode: data.mode, // FIX 2: Send the 'mode' string, not 'active'
      triggeredBy: client.name,
    });

    console.log(
      `Whiteboard mode changed to '${data.mode}' by ${client.role} ${client.name}`
    );
  });

  // Handle whiteboard updates (teacher only)
  socket.on("whiteboard-update", (data) => {
    const client = connectedClients.get(socket.id);
    if (client && client.role === "teacher") {
      classroomState.whiteboardState = data.update;
      // Broadcast to students only
      socket.broadcast.emit("whiteboard-update", data);
    }
  });

  // Handle whiteboard clear (teacher only)
  socket.on("whiteboard-clear", () => {
    const client = connectedClients.get(socket.id);
    if (client && client.role === "teacher") {
      classroomState.whiteboardState = null;
      // Broadcast to students only
      socket.broadcast.emit("whiteboard-clear");
    }
  });

  // --- WHITEBOARD EVENT FIXES END HERE ---

  socket.on("webrtc-offer", (data) => {
    socket.broadcast.emit("webrtc-offer", {
      offer: data.offer,
      senderId: socket.id,
    });
  });

  socket.on("webrtc-answer", (data) => {
    io.to(data.targetId).emit("webrtc-answer", {
      answer: data.answer,
      senderId: socket.id,
    });
  });

  socket.on("webrtc-ice-candidate", (data) => {
    if (data.targetId) {
      io.to(data.targetId).emit("webrtc-ice-candidate", data);
    } else {
      socket.broadcast.emit("webrtc-ice-candidate", data);
    }
  });

  socket.on("disconnect", () => {
    const client = connectedClients.get(socket.id);
    if (client) {
      if (client.role === "teacher") {
        classroomState.isTeacherPresent = false;
        classroomState.slideData = [];
        classroomState.totalSlides = 0;
        classroomState.currentSlide = 0;
        classroomState.whiteboardMode = "off"; // FIX 3: Reset mode on disconnect
        classroomState.whiteboardState = null;

        clearSlidesDirectory();

        // Notify everyone that the teacher left and whiteboard is off
        socket.broadcast.emit("teacher-left");
        socket.broadcast.emit("whiteboard-toggle", { mode: "off" });
      }
      connectedClients.delete(socket.id);
      classroomState.participants = Array.from(connectedClients.values());
      io.emit("participants-updated", classroomState.participants);
    }
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  console.error('Stack:', err.stack);
  res.status(500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(
    `🚀 Virtual Classroom Server running on http://localhost:${PORT}`
  );
  const dirs = ["uploads", "slides", "resources"];
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
});
