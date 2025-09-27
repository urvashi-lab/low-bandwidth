const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");
const { classroomState, connectedClients } = require("../state/classroomState");
const { setIo } = require("./io");

async function autoPreloadSlides(currentSlide, classroomId, io) {
  if (classroomState.isPreloading) return;
  classroomState.isPreloading = true;
  try {
    const slidesToPreload = [];
    for (let i = 1; i <= classroomState.preloadBuffer; i++) {
      const nextSlideIndex = currentSlide + i;
      if (
        nextSlideIndex < classroomState.totalSlides &&
        !classroomState.preloadedSlides.has(nextSlideIndex)
      ) {
        slidesToPreload.push(nextSlideIndex);
      }
    }
    for (const slideIndex of slidesToPreload) {
      const slideData = classroomState.slideData[slideIndex];
      if (!slideData) continue;
      const slidePath = path.join(
        __dirname,
        "..",
        "..",
        "slides",
        classroomId,
        slideData.name
      );
      if (!fs.existsSync(slidePath)) continue;
      classroomState.preloadedSlides.add(slideIndex);
      io.emit("slide-preloaded", {
        classroomId,
        slideIndex,
        url: slideData.url,
        fileSize: fs.statSync(slidePath).size,
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    classroomState.isPreloading = false;
  }
}

function clearSlidesDirectory() {
  try {
    const slidesDir = path.join(__dirname, "..", "..", "slides");
    if (!fs.existsSync(slidesDir)) return;
    const entries = fs.readdirSync(slidesDir);
    entries.forEach((entry) => {
      const p = path.join(slidesDir, entry);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      } catch (e) {}
    });
  } catch (e) {}
}

function cleanupOldSlides() {
  const slidesDir = path.join(__dirname, "..", "..", "slides");
  if (!fs.existsSync(slidesDir)) return;
  const dirs = fs.readdirSync(slidesDir);
  const cutoffTime = Date.now() - 24 * 60 * 60 * 1000;
  dirs.forEach((dir) => {
    const dirPath = path.join(slidesDir, dir);
    try {
      const stats = fs.statSync(dirPath);
      if (stats.isDirectory() && stats.mtime.getTime() < cutoffTime) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch {}
  });
}

function initSockets(server) {
  const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });
  setIo(io);

  io.on("connection", (socket) => {
    socket.on("join-classroom", (data) => {
      const { role, name } = data;
      if (!role || !name) {
        socket.emit("error", { message: "Role and name are required" });
        return;
      }
      connectedClients.set(socket.id, {
        role,
        name,
        socketId: socket.id,
        joinedAt: Date.now(),
      });
      if (role === "teacher") classroomState.isTeacherPresent = true;
      classroomState.participants = Array.from(connectedClients.values());
      socket.emit("classroom-state", classroomState);
      io.emit("participants-updated", classroomState.participants);
    });

    socket.on("teacher-slide-change", (data) => {
      const { classroomId, currentSlide, totalSlides } = data;
      classroomState.currentSlide = currentSlide;
      socket.broadcast.emit("slide-changed", {
        classroomId,
        currentSlide,
        totalSlides,
        timestamp: Date.now(),
      });
      setTimeout(() => autoPreloadSlides(currentSlide, classroomId, io), 100);
    });

    socket.on("trigger-preload", (data) => {
      const { classroomId, currentSlide } = data;
      autoPreloadSlides(currentSlide, classroomId, io);
    });

    socket.on("change-slide", (data) => {
      const client = connectedClients.get(socket.id);
      if (!client || client.role !== "teacher") {
        socket.emit("error", { message: "Only teachers can change slides" });
        return;
      }
      const slideNumber = parseInt(data.slideNumber);
      if (
        isNaN(slideNumber) ||
        slideNumber < 0 ||
        slideNumber >= classroomState.totalSlides
      ) {
        socket.emit("error", { message: "Invalid slide number" });
        return;
      }
      classroomState.currentSlide = slideNumber;
      io.emit("slide-changed", { slideNumber, timestamp: Date.now() });
    });

    socket.on("send-message", (data) => {
      const client = connectedClients.get(socket.id);
      if (!client) return;
      if (!data.text || data.text.trim().length === 0) {
        socket.emit("error", { message: "Message cannot be empty" });
        return;
      }
      const messageText = data.text.trim().substring(0, 500);
      const message = {
        id: Date.now(),
        sender: client.name,
        role: client.role,
        text: messageText,
        timestamp: Date.now(),
      };
      io.emit("new-message", message);
    });

    socket.on("webrtc-offer", (data) => {
      const client = connectedClients.get(socket.id);
      if (client && client.role === "teacher") {
        socket.broadcast.emit("webrtc-offer", {
          offer: data.offer,
          senderId: socket.id,
        });
      }
    });
    socket.on("webrtc-answer", (data) => {
      if (data.targetId && connectedClients.has(data.targetId)) {
        io.to(data.targetId).emit("webrtc-answer", {
          answer: data.answer,
          senderId: socket.id,
        });
      }
    });
    socket.on("webrtc-ice-candidate", (data) => {
      if (data.targetId && connectedClients.has(data.targetId)) {
        io.to(data.targetId).emit("webrtc-ice-candidate", {
          candidate: data.candidate,
          senderId: socket.id,
        });
      } else {
        socket.broadcast.emit("webrtc-ice-candidate", {
          candidate: data.candidate,
          senderId: socket.id,
        });
      }
    });

    socket.on("whiteboard-update", (data) => {
      const client = connectedClients.get(socket.id);
      if (!client || client.role !== "teacher") {
        socket.emit("error", {
          message: "Only teachers can update whiteboard",
        });
        return;
      }
      if (Array.isArray(data.update))
        classroomState.whiteboardState = data.update;
      else {
        if (!classroomState.whiteboardState)
          classroomState.whiteboardState = [];
        classroomState.whiteboardState.push(data.update);
      }
      socket.broadcast.emit("whiteboard-update", {
        update: data.update,
        timestamp: data.timestamp,
      });
    });

    socket.on("whiteboard-clear", () => {
      const client = connectedClients.get(socket.id);
      if (!client || client.role !== "teacher") {
        socket.emit("error", { message: "Only teachers can clear whiteboard" });
        return;
      }
      classroomState.whiteboardState = null;
      socket.broadcast.emit("whiteboard-clear");
    });

    socket.on("whiteboard-toggle", (data) => {
      const client = connectedClients.get(socket.id);
      if (!client) return;
      classroomState.whiteboardActive = data.active;
      io.emit("whiteboard-toggle", {
        active: data.active,
        triggeredBy: client.name,
      });
    });

    socket.on("disconnect", () => {
      const client = connectedClients.get(socket.id);
      if (client) {
        if (client.role === "teacher") {
          classroomState.isTeacherPresent = false;
          classroomState.whiteboardActive = false;
          classroomState.whiteboardState = null;
          socket.broadcast.emit("teacher-left");
          socket.broadcast.emit("whiteboard-toggle", { active: false });
          classroomState.slideData = [];
          classroomState.totalSlides = 0;
          classroomState.currentSlide = 0;
          classroomState.preloadedSlides = new Set();
          clearSlidesDirectory();
          io.emit("slides-cleared", { timestamp: Date.now() });
        }
        connectedClients.delete(socket.id);
        classroomState.participants = Array.from(connectedClients.values());
        io.emit("participants-updated", classroomState.participants);
      }
    });
  });

  // periodic cleanup
  setInterval(cleanupOldSlides, 60 * 60 * 1000);
}

module.exports = { initSockets };
