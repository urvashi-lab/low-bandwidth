// This script assumes 'socket' and 'window.userRole' are available in the global scope.
// It also depends on Yjs and idb libraries being loaded if available.

// =============================================================================
// Whiteboard Functionality
// =============================================================================

// Helper function to check if user is teacher (robust version)
function isTeacherRobust() {
  // Check multiple sources for role information
  const sources = [
    window.userRole,
    window.localStorage?.getItem?.('role'),
    document.body?.classList?.contains?.('teacher') ? 'teacher' : null
  ];
  
  console.log("Whiteboard role check from multiple sources:", sources);
  
  for (const role of sources) {
    if (role && role.toString().trim().toLowerCase() === "teacher") {
      console.log("✅ Teacher role confirmed for whiteboard from source:", role);
      return true;
    }
  }
  
  console.log("❌ No teacher role found for whiteboard in any source");
  return false;
}

// Whiteboard state
let whiteboardActive = false;
let whiteboardCanvas = null;
let whiteboardCtx = null;
let isDrawing = false;
let currentTool = "brush";
let currentColor = "#000000";
let currentSize = 3;
let lastX = 0;
let lastY = 0;
let whiteboardMode = "off"; // New state: 'off', 'board', or 'overlay'

// Yjs document for collaborative editing
let ydoc = null;
let ymap = null;
let isSyncing = false;

// IndexedDB for offline persistence
let db = null;

// Initialize whiteboard when page loads
function initializeWhiteboard() {
  whiteboardCanvas = document.getElementById("whiteboardCanvas");
  if (!whiteboardCanvas) return;

  whiteboardCtx = whiteboardCanvas.getContext("2d");

  // Set canvas size to match container
  resizeCanvas();

  // Check if Yjs is available (assuming it's loaded via a separate script tag if used)
  if (typeof Y === "undefined") {
    console.error(
      "Yjs library not loaded. Whiteboard will work in a basic online mode."
    );
    showNotification(
      "Collaboration libraries not loaded. Whiteboard is in basic mode.",
      "warning"
    );
    // Initialize without Yjs for basic functionality
    initializeBasicWhiteboard();
  } else {
    // Initialize Yjs document
    initializeYjs();
    // Initialize IndexedDB
    if (typeof idb !== "undefined") {
      initializeIndexedDB();
    }
  }

  // Set up event listeners
  setupWhiteboardEventListeners();

  console.log("Whiteboard initialized");
}

// Resize canvas to match container
function resizeCanvas() {
  if (!whiteboardCanvas) return;

  const container = document.getElementById("whiteboardContainer");
  if (!container) return;

  // Make the canvas drawing buffer size match its display size
  const rect = container.getBoundingClientRect();
  whiteboardCanvas.width = rect.width;
  whiteboardCanvas.height = rect.height;

  // Set default drawing properties
  if (whiteboardCtx) {
    whiteboardCtx.lineCap = "round";
    whiteboardCtx.lineJoin = "round";
    whiteboardCtx.strokeStyle = currentColor;
    whiteboardCtx.lineWidth = currentSize;
  }
}

// Initialize basic whiteboard without Yjs (fallback mode)
function initializeBasicWhiteboard() {
  console.log("Initializing basic whiteboard mode");
}

// Initialize Yjs document for collaborative editing
function initializeYjs() {
  ydoc = new Y.Doc();
  ymap = ydoc.getMap("whiteboard");

  // Listen for changes from other clients
  ymap.observe((event) => {
    if (isSyncing) return; // Prevent infinite loops

    event.changes.keys.forEach((change, key) => {
      if (change.action === "add" || change.action === "update") {
        const drawingData = ymap.get(key);
        if (drawingData) {
          renderDrawing(drawingData);
        }
      } else if (change.action === "delete") {
        clearCanvas();
      }
    });
  });

  // Listen for document updates to sync with server
  ydoc.on("update", (update) => {
    if (socket && window.userRole === "teacher") {
      socket.emit("whiteboard-update", {
        update: Array.from(update),
        timestamp: Date.now(),
      });
    }
  });
}

// Initialize IndexedDB for offline persistence
async function initializeIndexedDB() {
  try {
    db = await idb.openDB("whiteboard-db", 1, {
      upgrade(db) {
        db.createObjectStore("whiteboard-state");
      },
    });
    await loadWhiteboardState();
  } catch (error) {
    console.error("Failed to initialize IndexedDB:", error);
  }
}

// Save whiteboard state to IndexedDB
async function saveWhiteboardState() {
  if (!db || !ymap) return;
  try {
    const state = {
      canvasData: whiteboardCanvas.toDataURL(),
      ymapData: Y.encodeStateAsUpdate(ydoc),
      timestamp: Date.now(),
    };
    await db.put("whiteboard-state", state, "current");
  } catch (error) {
    console.error("Failed to save whiteboard state:", error);
  }
}

// Load whiteboard state from IndexedDB
async function loadWhiteboardState() {
  if (!db || !ymap) return;
  try {
    const state = await db.get("whiteboard-state", "current");
    if (state) {
      const img = new Image();
      img.onload = () => {
        if (whiteboardCtx) {
          whiteboardCtx.clearRect(
            0,
            0,
            whiteboardCanvas.width,
            whiteboardCanvas.height
          );
          whiteboardCtx.drawImage(img, 0, 0);
        }
      };
      img.src = state.canvasData;
      if (state.ymapData) {
        Y.applyUpdate(ydoc, new Uint8Array(state.ymapData));
      }
    }
  } catch (error) {
    console.error("Failed to load whiteboard state:", error);
  }
}

// Set up whiteboard event listeners
function setupWhiteboardEventListeners() {
  if (!whiteboardCanvas) return;
  whiteboardCanvas.addEventListener("mousedown", startDrawing);
  whiteboardCanvas.addEventListener("mousemove", draw);
  whiteboardCanvas.addEventListener("mouseup", stopDrawing);
  whiteboardCanvas.addEventListener("mouseout", stopDrawing);
  whiteboardCanvas.addEventListener("touchstart", handleTouch, {
    passive: false,
  });
  whiteboardCanvas.addEventListener("touchmove", handleTouch, {
    passive: false,
  });
  whiteboardCanvas.addEventListener("touchend", stopDrawing);

  document
    .getElementById("brushTool")
    ?.addEventListener("click", () => setTool("brush"));
  document
    .getElementById("eraserTool")
    ?.addEventListener("click", () => setTool("eraser"));
  document
    .getElementById("colorPicker")
    ?.addEventListener("change", (e) => setColor(e.target.value));
  document
    .getElementById("sizeSlider")
    ?.addEventListener("input", (e) => setSize(e.target.value));
  document
    .getElementById("clearBoard")
    ?.addEventListener("click", clearWhiteboard);
  document.addEventListener("keydown", handleKeyboardShortcuts);
  window.addEventListener("resize", resizeCanvas);
}

// Handle touch events
function handleTouch(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const mouseEvent = new MouseEvent(
    e.type === "touchstart"
      ? "mousedown"
      : e.type === "touchmove"
      ? "mousemove"
      : "mouseup",
    { clientX: touch.clientX, clientY: touch.clientY }
  );
  whiteboardCanvas.dispatchEvent(mouseEvent);
}

// Start drawing
function startDrawing(e) {
  if (!isTeacherRobust()) {
    console.log("Drawing access denied - not a teacher");
    return;
  }
  isDrawing = true;
  const rect = whiteboardCanvas.getBoundingClientRect();
  lastX = e.clientX - rect.left;
  lastY = e.clientY - rect.top;
}

// --- ERASER FIX: This function is updated to handle erasing in real-time ---
// Draw
function draw(e) {
  if (!isDrawing || !isTeacherRobust()) return;

  const rect = whiteboardCanvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;

  // Save the current context state
  whiteboardCtx.save();

  // Set the composite operation based on the current tool for erasing
  whiteboardCtx.globalCompositeOperation =
    currentTool === "eraser" ? "destination-out" : "source-over";

  whiteboardCtx.beginPath();
  whiteboardCtx.moveTo(lastX, lastY);
  whiteboardCtx.lineTo(currentX, currentY);
  whiteboardCtx.stroke();

  // Restore the context to its previous state
  whiteboardCtx.restore();

  const drawingData = {
    type: "line",
    startX: lastX,
    startY: lastY,
    endX: currentX,
    endY: currentY,
    color: currentColor,
    size: currentSize,
    tool: currentTool,
    timestamp: Date.now(),
  };

  if (ymap) {
    const key = `drawing_${Date.now()}_${Math.random()}`;
    ymap.set(key, drawingData);
  } else {
    if (socket) {
      socket.emit("whiteboard-update", {
        update: drawingData,
        timestamp: Date.now(),
      });
    }
  }

  lastX = currentX;
  lastY = currentY;
}

// Stop drawing
function stopDrawing() {
  isDrawing = false;
}

// Render drawing from Yjs data or basic data
function renderDrawing(drawingData) {
  if (!whiteboardCtx) return;
  const { type, startX, startY, endX, endY, color, size, tool } = drawingData;
  if (type === "line") {
    whiteboardCtx.save();
    whiteboardCtx.strokeStyle = color;
    whiteboardCtx.lineWidth = size;
    whiteboardCtx.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
    whiteboardCtx.beginPath();
    whiteboardCtx.moveTo(startX, startY);
    whiteboardCtx.lineTo(endX, endY);
    whiteboardCtx.stroke();
    whiteboardCtx.restore();
  }
}

// Set drawing tool
function setTool(tool) {
  currentTool = tool;
  document
    .querySelectorAll(".whiteboard-tool")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(tool + "Tool")?.classList.add("active");
  // Set eraser cursor style
  whiteboardCanvas.style.cursor = tool === "eraser" ? "cell" : "crosshair";
}

function setColor(color) {
  currentColor = color;
  if (whiteboardCtx) whiteboardCtx.strokeStyle = color;
}

function setSize(size) {
  currentSize = parseInt(size);
  if (whiteboardCtx) whiteboardCtx.lineWidth = size;
}

function clearWhiteboard() {
  if (!isTeacherRobust()) {
    console.log("Clear whiteboard access denied - not a teacher");
    return;
  }
  // Use a custom modal or skip confirm if it causes issues in your environment
  if (confirm("Are you sure you want to clear the whiteboard?")) {
    clearCanvas();
    if (ymap) ymap.clear();
    if (socket) socket.emit("whiteboard-clear");
  }
}

function clearCanvas() {
  if (whiteboardCtx) {
    whiteboardCtx.clearRect(
      0,
      0,
      whiteboardCanvas.width,
      whiteboardCanvas.height
    );
  }
}

// --- REWRITTEN FUNCTIONALITY: Cycles through off -> board -> overlay ---
function toggleWhiteboard() {
  // Cycle through the three modes
  if (whiteboardMode === "off") {
    whiteboardMode = "board";
  } else if (whiteboardMode === "board") {
    whiteboardMode = "overlay";
  } else {
    whiteboardMode = "off";
  }
  applyWhiteboardMode(); // Apply the visual changes

  // Emit the new mode to other clients
  if (socket) {
    socket.emit("whiteboard-toggle", { mode: whiteboardMode });
  }
}

// --- FIXED FUNCTION: Applies visual state without conflicting with other scripts ---
function applyWhiteboardMode() {
  const slideArea = document.getElementById("slideArea");
  const whiteboardContainer = document.getElementById("whiteboardContainer");
  const whiteboardToggle = document.getElementById("whiteboardToggle");
  const whiteboardControls = document.getElementById("whiteboardControls");
  const currentSlide = document.getElementById("currentSlide");
  const noSlideMessage = document.getElementById("noSlideMessage");

  // Prevent errors if elements aren't found
  if (
    !slideArea ||
    !whiteboardContainer ||
    !whiteboardToggle ||
    !whiteboardControls ||
    !currentSlide ||
    !noSlideMessage
  ) {
    console.error("A critical UI element for the whiteboard is missing.");
    return;
  }

  switch (whiteboardMode) {
    case "board":
      whiteboardActive = true;
      slideArea.classList.add("whiteboard-mode");
      whiteboardContainer.classList.remove("hidden");
      whiteboardContainer.style.backgroundColor = "white";

      // Temporarily hide slide content using inline styles
      currentSlide.style.display = "none";
      noSlideMessage.style.display = "none";

      whiteboardToggle.textContent = "🎨 Overlay";
      whiteboardToggle.classList.add("active");
      break;

    case "overlay":
      whiteboardActive = true;
      slideArea.classList.add("whiteboard-mode");
      whiteboardContainer.classList.remove("hidden");
      whiteboardContainer.style.backgroundColor = "transparent";

      // Remove inline style to let CSS classes control visibility again
      currentSlide.style.display = "";
      noSlideMessage.style.display = "";

      whiteboardToggle.textContent = "📋 Slides";
      whiteboardToggle.classList.add("active");
      break;

    case "off":
    default:
      whiteboardActive = false;
      slideArea.classList.remove("whiteboard-mode");
      whiteboardContainer.classList.add("hidden");

      // Remove inline style to let CSS classes control visibility again
      currentSlide.style.display = "";
      noSlideMessage.style.display = "";

      whiteboardToggle.textContent = "🎨 Whiteboard";
      whiteboardToggle.classList.remove("active");
      break;
  }

  if (whiteboardActive) {
    if (isTeacherRobust()) {
      whiteboardControls.classList.remove("hidden");
      whiteboardCanvas.classList.remove("readonly");
      console.log("Whiteboard controls enabled for teacher");
    } else {
      whiteboardCanvas.classList.add("readonly");
      console.log("Whiteboard set to readonly mode for student");
    }
    setTimeout(resizeCanvas, 100);
    initializeAutoSave();
  } else {
    whiteboardControls.classList.add("hidden");
  }
}

function updateSyncStatus(status) {
  const indicator = document.getElementById("syncIndicator");
  const text = document.getElementById("syncText");
  if (indicator) indicator.className = `whiteboard-sync-indicator ${status}`;
  if (text)
    text.textContent =
      { synced: "Synced", syncing: "Syncing...", error: "Sync Error" }[
        status
      ] || "Unknown";
}

function handleWhiteboardUpdate(data) {
  if (isTeacherRobust()) return;
  try {
    isSyncing = true;
    updateSyncStatus("syncing");
    if (ydoc && data.update && Array.isArray(data.update)) {
      Y.applyUpdate(ydoc, new Uint8Array(data.update));
    } else if (data.update && !Array.isArray(data.update)) {
      renderDrawing(data.update);
    }
    saveWhiteboardState();
    updateSyncStatus("synced");
  } catch (error) {
    console.error("Failed to handle whiteboard update:", error);
    updateSyncStatus("error");
  } finally {
    isSyncing = false;
  }
}

function handleWhiteboardState(data) {
  try {
    isSyncing = true;
    updateSyncStatus("syncing");
    if (ydoc && data.state) {
      Y.applyUpdate(ydoc, new Uint8Array(data.state));
    }
    updateSyncStatus("synced");
  } catch (error) {
    console.error("Failed to handle whiteboard state:", error);
    updateSyncStatus("error");
  } finally {
    isSyncing = false;
  }
}

function handleWhiteboardClear() {
  clearCanvas();
  if (ymap) ymap.clear();
  showNotification("Whiteboard cleared by teacher");
}

// --- UPDATED FUNCTION: Handles receiving the specific mode from other clients ---
function handleWhiteboardToggle(data) {
  if (data.mode !== whiteboardMode) {
    whiteboardMode = data.mode;
    applyWhiteboardMode();
  }
}

function handleKeyboardShortcuts(e) {
  if (!whiteboardActive || !isTeacherRobust()) return;
  if (e.ctrlKey && e.key === "z") {
    e.preventDefault();
    showNotification("Undo coming soon!");
  }
  if (e.ctrlKey && e.key === "e") {
    e.preventDefault();
    setTool("eraser");
  }
  if (e.ctrlKey && e.key === "b") {
    e.preventDefault();
    setTool("brush");
  }
  if (e.ctrlKey && e.key === "Delete") {
    e.preventDefault();
    clearWhiteboard();
  }
}

function startAutoSave() {
  setInterval(() => {
    if (whiteboardActive && ydoc) saveWhiteboardState();
  }, 30000); // Save every 30 seconds
}

function initializeAutoSave() {
  if (!window.whiteboardAutoSaveInitialized) {
    startAutoSave();
    window.whiteboardAutoSaveInitialized = true;
  }
}

// Global debug function for whiteboard role validation
window.debugWhiteboardRole = function() {
  console.log("=== WHITEBOARD ROLE DEBUG (Backend) ===");
  console.log("Window userRole:", window.userRole);
  console.log("Window userName:", window.userName);
  console.log("Window userJoined:", window.userJoined);
  
  console.log("Whiteboard role validation tests:");
  console.log("- isTeacherRobust():", isTeacherRobust());
  
  console.log("Multiple role sources:");
  console.log("- window.userRole:", window.userRole);
  console.log("- localStorage role:", localStorage.getItem('role'));
  console.log("- body class teacher:", document.body.classList.contains('teacher'));
  
  console.log("Whiteboard state:");
  console.log("- whiteboardActive:", whiteboardActive);
  console.log("- whiteboardMode:", whiteboardMode);
  console.log("- whiteboardCanvas:", !!whiteboardCanvas);
  
  return {
    userRole: window.userRole,
    userName: window.userName,
    userJoined: window.userJoined,
    isTeacherRobust: isTeacherRobust(),
    whiteboardActive: whiteboardActive,
    whiteboardMode: whiteboardMode
  };
};

window.toggleWhiteboard = toggleWhiteboard;
