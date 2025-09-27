// Global variables
let socket = null;
let currentSlideNumber = 0;
let totalSlides = 0;
let slides = [];
let isAudioStreaming = false;
let localStream = null;
let peerConnections = new Map();

// WebRTC configuration
const rtcConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// Audio constraints
const audioConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 16000,
    sampleSize: 16,
    channelCount: 1,
  },
  video: false,
};

// Helper function to check if user is teacher
function isTeacher() {
  const role = window.userRole;
  console.log("Role check - window.userRole:", role, "Type:", typeof role);
  
  // Enhanced debugging to catch hidden characters/encoding issues
  if (role) {
    console.log("Role length:", role.length);
    console.log("Role char codes:", Array.from(role).map(c => c.charCodeAt(0)));
    console.log("Role JSON:", JSON.stringify(role));
    console.log("Trimmed role:", JSON.stringify(role.trim()));
  }
  
  // Normalize role comparison to handle potential whitespace/encoding issues
  return role && role.toString().trim().toLowerCase() === "teacher";
}

// Helper function to get user role for debugging
function getUserRoleInfo() {
  return {
    role: window.userRole,
    name: window.userName,
    type: typeof window.userRole,
    isTeacher: isTeacher(),
    // Additional debugging info
    roleLength: window.userRole ? window.userRole.length : 0,
    roleCharCodes: window.userRole ? Array.from(window.userRole).map(c => c.charCodeAt(0)) : [],
    roleJSON: JSON.stringify(window.userRole)
  };
}

// Enhanced role validation with better error handling
function validateTeacherRole() {
  if (!window.userRole) {
    console.warn("⚠️ window.userRole is undefined - user may not be logged in yet");
    return false;
  }
  
  const normalizedRole = window.userRole.toString().trim().toLowerCase();
  const isValid = normalizedRole === "teacher";
  
  console.log("Role validation:", {
    original: window.userRole,
    normalized: normalizedRole,
    isValid: isValid,
    charCodes: Array.from(window.userRole).map(c => c.charCodeAt(0))
  });
  
  return isValid;
}

// Initialize connection when page loads
window.onload = function () {
  console.log("Page loaded, initializing application...");
  
  setupChatEnterKey();
  initializeWhiteboard(); // This will call the function from whiteboard.js
  initResourcesIndex();
  
  // Set up event listeners for when user data becomes available
  setupUserDataListeners();
  
  // Also try to setup socket handlers immediately (fallback)
  setTimeout(() => {
    if (window.socket && !socket) {
      console.log("Fallback: Setting up socket handlers immediately");
      socket = window.socket;
      setupSocketEventHandlers();
    }
  }, 1000);
};

// Setup listeners for when user data becomes available
window.setupUserDataListeners = function() {
  console.log("=== SETUP USER DATA LISTENERS ===");
  
  const checkSocketReady = () => {
    if (window.socket && window.socketReady && window.userJoined) {
      console.log("Socket and user data ready, setting up event listeners");
      socket = window.socket;
      setupSocketEventHandlers();
      return true;
    }
    return false;
  };
  
  if (!checkSocketReady()) {
    let attempts = 0;
    const maxAttempts = 100; // Increased from 50 to 100
    
    const checkSocket = setInterval(() => {
      attempts++;
      if (checkSocketReady() || attempts >= maxAttempts) {
        clearInterval(checkSocket);
        if (attempts >= maxAttempts) {
          console.error("Socket setup timeout - attempting to setup anyway");
          // Try to setup anyway even if timeout
          if (window.socket) {
            socket = window.socket;
            setupSocketEventHandlers();
          }
        }
      }
    }, 100);
  }
}

// Setup all socket event handlers
function setupSocketEventHandlers() {
  console.log("=== Setting up socket event handlers in app.js ===");
  console.log("Socket available:", !!socket);
  console.log("Socket connected:", socket?.connected);
  console.log("Socket ID:", socket?.id);
  console.log("User info:", getUserRoleInfo());
  
  if (!socket) {
    console.error("Socket not available for event handler setup");
    return;
  }
  
  // Ensure socket is connected
  if (!socket.connected) {
    console.warn("Socket not connected, waiting for connection...");
    socket.on('connect', () => {
      console.log("Socket connected, re-running setup...");
      setupSocketEventHandlers();
    });
    return;
  }

  socket.on("disconnect", () => {
    updateStatus("disconnected", "Disconnected");
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }
    peerConnections.forEach((pc) => pc.close());
    peerConnections.clear();
  });

  socket.on("upload-started", (data) => {
    console.log("=== UPLOAD STARTED ===");
    console.log("Filename:", data.filename);
    showNotification(`Processing ${data.filename}...`);
    showProgressIndicator(`Processing ${data.filename}...`);
    slides = [];
    totalSlides = 0;
    currentSlideNumber = 0;
    const noSlideMsg = document.getElementById("noSlideMessage");
    const currentSlide = document.getElementById("currentSlide");
    if (noSlideMsg) noSlideMsg.style.display = "block";
    if (currentSlide) currentSlide.classList.add("hidden");
  });

  socket.on("total-slides", (data) => {
    totalSlides = data.totalSlides;
    slides = new Array(totalSlides).fill(null);
    showNotification(`Loading ${totalSlides} slides...`);
  });

  socket.on("slide-ready", (data) => {
    slides[data.index] = data.url;
    if (data.index === 0) {
      currentSlideNumber = 0;
      displaySlide(data.url);
      updateSlideInfo();
      showNotification("First slide ready!");
    }
  });

  socket.on("upload-complete", (data) => {
    console.log("=== UPLOAD COMPLETE ===");
    console.log("Total slides:", data.totalSlides);
    hideProgressIndicator();
    showNotification(`All ${data.totalSlides} slides loaded successfully!`);
    if (slides[0] && currentSlideNumber === 0) {
      displaySlide(slides[0]);
      updateSlideInfo();
    }
  });

  socket.on("slide-changed", (data) => {
    currentSlideNumber = data.slideNumber;
    if (slides[currentSlideNumber]) {
      displaySlide(slides[currentSlideNumber]);
    }
    updateSlideInfo();
    showNotification(`Teacher changed to slide ${currentSlideNumber + 1}`);
  });

  socket.on("new-message", (message) => displayMessage(message));

  socket.on("teacher-left", () => {
    showNotification("Teacher has left the classroom", "warning");
    if (window.userRole === "student" && isAudioStreaming) {
      updateAudioStatus("stopped", "Audio: Teacher disconnected");
      peerConnections.forEach((pc) => pc.close());
      peerConnections.clear();
    }
  });

  socket.on("webrtc-offer", handleWebRTCOffer);
  socket.on("webrtc-answer", handleWebRTCAnswer);
  socket.on("webrtc-ice-candidate", handleWebRTCIceCandidate);
  socket.on("classroom-state", updateClassroomState);
  socket.on("participants-updated", updateParticipantsList);
  socket.on("whiteboard-update", handleWhiteboardUpdate);
  socket.on("whiteboard-state", handleWhiteboardState);
  socket.on("whiteboard-clear", handleWhiteboardClear);
  socket.on("whiteboard-toggle", handleWhiteboardToggle);

  socket.on("resource-added", (resource) => {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "CACHE_RESOURCE_URLS",
        payload: { urls: [resource.url] },
      });
    }
    addResourceToList(resource);
  });

  socket.on("resource-removed", (resource) => {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "DELETE_RESOURCE_URLS",
        payload: { urls: [resource.url] },
      });
    }
    removeResourceFromList(resource);
  });

  console.log("All socket event handlers set up successfully");
  
  // Verify teacher controls are working after socket setup
  if (isTeacher()) {
    console.log("Teacher role detected - verifying controls...");
    setTimeout(() => {
      const teacherControls = document.getElementById("teacherControls");
      const audioControls = document.querySelector(".audio-controls");
      console.log("Teacher controls visible:", teacherControls?.style.display);
      console.log("Audio controls visible:", audioControls?.style.display);
    }, 100);
  }
}

// Status and UI update functions
window.updateStatus = function(status, text) {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.className = `status ${status}`;
    statusEl.textContent = text;
  }
}

window.updateClassroomState = function(state) {
  currentSlideNumber = state.currentSlide || 0;
  totalSlides = state.totalSlides || 0;
  if (state.slideData && Array.isArray(state.slideData)) {
    slides = state.slideData.map((slide) => slide.url || slide);
  }
  if (slides.length > 0 && slides[currentSlideNumber]) {
    displaySlide(slides[currentSlideNumber]);
  }
  updateSlideInfo();
  if (state.participants) updateParticipantsList(state.participants);

  // When joining, sync the whiteboard to the current state
  if (state.whiteboardMode && typeof whiteboardMode !== 'undefined' && state.whiteboardMode !== whiteboardMode) {
    whiteboardMode = state.whiteboardMode;
    if (typeof applyWhiteboardMode === 'function') {
      applyWhiteboardMode();
    }
  }
}

window.updateParticipantsList = function(participants) {
  console.log("=== UPDATE PARTICIPANTS LIST ===");
  console.log("Received participants:", participants);
  console.log("Participants count:", participants?.length || 0);
  
  const listEl = document.getElementById("participantsList");
  const countEl = document.getElementById("participantCount");
  
  console.log("DOM elements found:", {
    participantsList: !!listEl,
    participantCount: !!countEl
  });
  
  if (!participants || !Array.isArray(participants)) {
    console.warn("Invalid participants data:", participants);
    return;
  }
  
  if (listEl) {
    listEl.innerHTML = "";
    console.log("Cleared participants list");
  }
  
  if (countEl) {
    countEl.textContent = participants.length;
    console.log("Updated participant count to:", participants.length);
  }

  participants.forEach((p, index) => {
    console.log(`Adding participant ${index + 1}:`, p);
    const div = document.createElement("div");
    div.className = `participant ${p.role}`;
    div.textContent = `${p.role === "teacher" ? "👨‍🏫" : "👨‍🎓"} ${p.name}`;
    if (listEl) listEl.appendChild(div);
  });
  
  console.log("Participants list update completed");
}

window.updateSlideInfo = function() {
  const el = document.getElementById("slideInfo");
  if (el) {
    el.textContent = `Slide ${currentSlideNumber + 1} of ${totalSlides || 1}`;
  }
}

window.displaySlide = function (slideUrl) {
  const slideImg = document.getElementById("currentSlide");
  const noSlideMsg = document.getElementById("noSlideMessage");
  
  console.log("Displaying slide:", slideUrl, "at index:", currentSlideNumber);
  
  if (!slideUrl) {
    if (slideImg) slideImg.classList.add("hidden");
    if (noSlideMsg) noSlideMsg.style.display = "block";
    return;
  }
  
  if (slideImg) {
    // Show loading state
    slideImg.classList.add("loading");
    
    slideImg.onload = () => {
      console.log("Slide loaded successfully:", slideUrl);
      slideImg.classList.remove("loading");
      slideImg.classList.remove("hidden");
      if (noSlideMsg) noSlideMsg.style.display = "none";
      
      // Preload next 2 slides for better performance
      preloadNextSlides(currentSlideNumber + 1, 2);
    };
    
    slideImg.onerror = function () {
      console.error("Failed to load slide:", slideUrl);
      this.classList.add("hidden");
      this.classList.remove("loading");
      if (noSlideMsg) noSlideMsg.style.display = "block";
    };
    
    slideImg.src = slideUrl;
  }
}

// Preload next slides for better performance
function preloadNextSlides(startIndex, count) {
  for (let i = 0; i < count; i++) {
    const slideIndex = startIndex + i;
    if (slides && slides[slideIndex]) {
      const preload = new Image();
      preload.src = slides[slideIndex];
      console.log(`Preloading slide ${slideIndex + 1}:`, slides[slideIndex]);
    }
  }
}

// Slide navigation functions
window.nextSlide = function () {
  console.log("Next slide requested - User info:", getUserRoleInfo());
  
  if (!isTeacher()) {
    console.log("Access denied - not a teacher");
    return;
  }
  
  if (currentSlideNumber < totalSlides - 1) {
    currentSlideNumber++;
    if (slides[currentSlideNumber]) displaySlide(slides[currentSlideNumber]);
    updateSlideInfo();
    socket.emit("change-slide", { slideNumber: currentSlideNumber });
    console.log("Moved to slide:", currentSlideNumber + 1);
  }
}

window.previousSlide = function () {
  console.log("Previous slide requested - User info:", getUserRoleInfo());
  
  if (!isTeacher()) {
    console.log("Access denied - not a teacher");
    return;
  }
  
  if (currentSlideNumber > 0) {
    currentSlideNumber--;
    if (slides[currentSlideNumber]) displaySlide(slides[currentSlideNumber]);
    updateSlideInfo();
    socket.emit("change-slide", { slideNumber: currentSlideNumber });
    console.log("Moved to slide:", currentSlideNumber + 1);
  }
}

// File upload functions
window.triggerFileUpload = function () {
  console.log("=== TRIGGER FILE UPLOAD ===");
  console.log("Function called at:", new Date().toISOString());
  console.log("User info:", getUserRoleInfo());
  
  if (!isTeacher()) {
    const userInfo = getUserRoleInfo();
    console.log("Access denied - User info:", userInfo);
    alert(`Only teachers can upload slides. Current role: ${userInfo.role || 'undefined'}`);
    return;
  }
  
  console.log("Access granted - triggering file upload");
  const uploadInput = document.getElementById("slideUpload");
  console.log("Upload input element:", uploadInput);
  
  if (uploadInput) {
    console.log("Clicking upload input...");
    uploadInput.click();
    console.log("Upload input clicked successfully");
  } else {
    console.error("Upload input element not found");
    alert("Upload button not found. Please refresh the page.");
  }
}

window.handleFileUpload = function(event) {
  console.log("=== HANDLE FILE UPLOAD ===");
  console.log("Function called at:", new Date().toISOString());
  console.log("User info:", getUserRoleInfo());
  console.log("Event:", event);
  console.log("Event target:", event.target);
  console.log("Event target files:", event.target.files);
  
  const file = event.target.files[0];
  if (!file) {
    console.log("No file selected");
    return;
  }
  
  console.log("File selected:", file.name);
  console.log("File size:", (file.size / 1024 / 1024).toFixed(2), "MB");
  
  if (!isTeacher()) {
    const userInfo = getUserRoleInfo();
    console.log("Access denied - User info:", userInfo);
    alert(`Access denied. Current role: ${userInfo.role || 'undefined'}. Only teachers can upload slides.`);
    return;
  }
  
  console.log("Access granted - proceeding with file upload...");
  
  // Show immediate feedback
  showNotification("Starting upload...", "info");
  showProgressIndicator(`Uploading ${file.name}...`);
  
  const formData = new FormData();
  formData.append("file", file);
  
  // Use XMLHttpRequest for progress tracking
  const xhr = new XMLHttpRequest();
  
  // Track upload progress
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const percentComplete = Math.round((e.loaded / e.total) * 100);
      updateProgressIndicator(percentComplete, `Uploading ${file.name}... ${percentComplete}%`);
    }
  });
  
  xhr.addEventListener('load', () => {
    hideProgressIndicator();
    if (xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText);
        console.log("Upload response:", data);
        
        if (data.slides && Array.isArray(data.slides)) {
          slides = data.slides.map((s) => s.url || s);
          currentSlideNumber = 0;
          totalSlides = slides.length;
          if (slides.length > 0) {
            displaySlide(slides[0]);
            updateSlideInfo();
            showNotification("Slides uploaded successfully!");
          } else {
            throw new Error("No slides in response");
          }
        } else {
          throw new Error("Invalid response format");
        }
      } catch (e) {
        console.error("Failed to parse response:", e);
        showNotification("Upload completed but response parsing failed", "warning");
      }
    } else {
      console.error("Upload failed with status:", xhr.status);
      showNotification(`Upload failed: HTTP ${xhr.status}`, "error");
    }
  });
  
  xhr.addEventListener('error', () => {
    hideProgressIndicator();
    console.error("Upload error: Network error");
    showNotification("Upload failed: Network error", "error");
  });
  
  xhr.addEventListener('timeout', () => {
    hideProgressIndicator();
    console.error("Upload error: Timeout");
    showNotification("Upload failed: Timeout", "error");
  });
  
  xhr.open("POST", "/upload");
  xhr.timeout = 120000; // 2 minute timeout for large files
  xhr.send(formData);
  
  // Clear the input after starting upload
  if (event.target) event.target.value = "";
}

// Chat functions
window.sendMessage = function() {
  console.log("=== SEND MESSAGE CALLED ===");
  
  const chatInput = document.getElementById("chatInput");
  if (!chatInput) {
    console.error("Chat input element not found");
    return;
  }
  
  const message = chatInput.value.trim();
  if (!message) {
    console.log("Empty message, not sending");
    return;
  }
  
  console.log("Message to send:", message);
  console.log("Socket status:", {
    exists: !!socket,
    connected: socket?.connected,
    id: socket?.id
  });
  console.log("User info:", getUserRoleInfo());
  
  if (!socket) {
    console.error("Cannot send message - socket not available");
    alert("Cannot send message: Socket not connected");
    return;
  }
  
  if (!socket.connected) {
    console.error("Cannot send message - socket not connected");
    alert("Cannot send message: Socket not connected");
    return;
  }
  
  if (!window.userName) {
    console.error("Cannot send message - username not set");
    alert("Cannot send message: Username not set");
    return;
  }
  
  const messageData = {
    text: message,
    sender: window.userName,
    role: window.userRole,
    timestamp: Date.now()
  };
  
  console.log("Emitting send-message with data:", messageData);
  socket.emit("send-message", messageData);
  chatInput.value = "";
  console.log("Message sent successfully");
}

window.setupChatEnterKey = function() {
  const chatInput = document.getElementById("chatInput");
  if (chatInput) {
    chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendMessage();
      }
    });
  }
}

window.displayMessage = function(message) {
  console.log("=== DISPLAY MESSAGE CALLED ===");
  console.log("Received message:", message);
  
  const messagesEl = document.getElementById("chatMessages");
  if (!messagesEl) {
    console.error("Chat messages element not found");
    return;
  }
  
  console.log("Adding message to chat:", {
    sender: message.sender,
    role: message.role,
    text: message.text
  });
  
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${message.role}`;
  messageDiv.innerHTML = `<div class="message-header">${message.sender} (${message.role})</div><div class="message-content">${escapeHtml(message.text)}</div>`;
  messagesEl.appendChild(messageDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  
  console.log("Message displayed successfully");
}

window.escapeHtml = function(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Notification function
window.showNotification = function(text, type = "info") {
  const notification = document.createElement("div");
  notification.className = "toast-notification";
  notification.textContent = text;
  notification.classList.add(type);
  document.body.appendChild(notification);
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 3000);
}

// Audio streaming functions
window.startAudio = async function() {
  console.log("=== START AUDIO ===");
  console.log("User info:", getUserRoleInfo());
  
  if (!isTeacher()) {
    const userInfo = getUserRoleInfo();
    console.log("Access denied - User info:", userInfo);
    return alert("Only teacher can start audio streaming");
  }
  
  if (isAudioStreaming) {
    console.log("Audio already streaming");
    return;
  }
  
  try {
    console.log("Requesting microphone access...");
    localStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
    
    const startBtn = document.getElementById("startAudioBtn");
    const stopBtn = document.getElementById("stopAudioBtn");
    
    if (startBtn) startBtn.classList.add("hidden");
    if (stopBtn) stopBtn.classList.remove("hidden");
    
    updateAudioStatus("streaming", "Audio: Streaming 🔴");
    isAudioStreaming = true;
    
    await createPeerConnectionsForStudents();
    console.log("Audio streaming started successfully");
    
  } catch (error) {
    console.error("Error accessing microphone:", error);
    alert("Could not access microphone. Please check permissions.");
    updateAudioStatus("error", "Audio: Error accessing microphone");
  }
}

window.stopAudio = function() {
  console.log("Stopping audio stream");
  
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  
  peerConnections.forEach((pc) => pc.close());
  peerConnections.clear();
  
  const startBtn = document.getElementById("startAudioBtn");
  const stopBtn = document.getElementById("stopAudioBtn");
  
  if (startBtn) startBtn.classList.remove("hidden");
  if (stopBtn) stopBtn.classList.add("hidden");
  
  updateAudioStatus("stopped", "Audio: Stopped");
  isAudioStreaming = false;
  
  if (socket) {
    socket.emit("audio-stopped");
  }
}

function updateAudioStatus(status, text) {
  const statusEl = document.getElementById("audioStatus");
  if (statusEl) {
    statusEl.className = `audio-status ${status}`;
    statusEl.textContent = text;
  }
}

// WebRTC functions
async function createPeerConnectionsForStudents() {
  if (!localStream) return;
  
  try {
    const pc = new RTCPeerConnection(rtcConfiguration);
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    
    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit("webrtc-ice-candidate", { candidate: e.candidate });
      }
    };
    
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        updateAudioStatus("error", "Audio: Connection failed");
      }
    };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    if (socket) {
      socket.emit("webrtc-offer", { offer });
    }
    
    peerConnections.set("broadcast", pc);
  } catch (error) {
    console.error("Error creating peer connection:", error);
    updateAudioStatus("error", "Audio: Failed to create connection");
  }
}

async function handleWebRTCOffer(data) {
  if (window.userRole !== "student") return;
  
  try {
    const pc = new RTCPeerConnection(rtcConfiguration);
    
    pc.ontrack = (event) => {
      const remoteAudio = new Audio();
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.autoplay = true;
      remoteAudio.play().catch((e) => console.error("Audio play error:", e));
      updateAudioStatus("receiving", "Audio: Receiving 🔊");
    };
    
    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit("webrtc-ice-candidate", {
          candidate: e.candidate,
          targetId: data.senderId,
        });
      }
    };
    
    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed"].includes(pc.connectionState)) {
        updateAudioStatus("stopped", "Audio: Connection lost");
      }
    };
    
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    if (socket) {
      socket.emit("webrtc-answer", { answer, targetId: data.senderId });
    }
    
    peerConnections.set(data.senderId || "teacher", pc);
  } catch (error) {
    console.error("Error handling WebRTC offer:", error);
    updateAudioStatus("error", "Audio: Connection error");
  }
}

async function handleWebRTCAnswer(data) {
  if (!isTeacher()) return;
  
  try {
    const pc = peerConnections.get("broadcast");
    if (pc && pc.signalingState !== "stable") {
      await pc.setRemoteDescription(data.answer);
    }
  } catch (error) {
    console.error("Error handling WebRTC answer:", error);
  }
}

async function handleWebRTCIceCandidate(data) {
  if (!data.candidate) return;
  
  try {
    const pc = isTeacher() 
      ? peerConnections.get("broadcast")
      : peerConnections.get(data.senderId || "teacher");
    
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(data.candidate);
    }
  } catch (error) {
    console.error("Error adding ICE candidate:", error);
  }
}

// Resource management functions
window.triggerResourceUpload = function() {
  console.log("=== TRIGGER RESOURCE UPLOAD ===");
  console.log("Function called at:", new Date().toISOString());
  console.log("User info:", getUserRoleInfo());
  
  if (!isTeacher()) {
    const userInfo = getUserRoleInfo();
    console.log("Access denied - User info:", userInfo);
    alert("Only teachers can upload resources");
    return;
  }
  
  console.log("Access granted - triggering resource upload");
  const uploadInput = document.getElementById("resourceUpload");
  console.log("Resource upload input element:", uploadInput);
  
  if (uploadInput) {
    console.log("Clicking resource upload input...");
    uploadInput.click();
    console.log("Resource upload input clicked successfully");
  } else {
    console.error("Resource upload input not found");
    alert("Resource upload button not found. Please refresh the page.");
  }
}

window.handleResourceUpload = function(event) {
  console.log("=== HANDLE RESOURCE UPLOAD ===");
  console.log("Function called at:", new Date().toISOString());
  console.log("Event:", event);
  console.log("Event target:", event.target);
  console.log("Event target files:", event.target.files);
  
  const file = event.target.files && event.target.files[0];
  if (!file) {
    console.log("No file selected");
    return;
  }
  
  console.log("Uploading resource:", file.name);
  console.log("File size:", (file.size / 1024 / 1024).toFixed(2), "MB");
  
  // Show progress indicator
  showProgressIndicator(`Uploading ${file.name}...`);
  
  const formData = new FormData();
  formData.append("file", file);
  
  // Create XMLHttpRequest for progress tracking
  const xhr = new XMLHttpRequest();
  
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const percentComplete = Math.round((e.loaded / e.total) * 100);
      updateProgressIndicator(percentComplete, `Uploading ${file.name}... ${percentComplete}%`);
    }
  });
  
  xhr.addEventListener('load', () => {
    hideProgressIndicator();
    if (xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText);
        const resource = data && data.resource;
        if (resource) {
          addResourceToList(resource);
          if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: "CACHE_RESOURCE_URLS",
              payload: { urls: [resource.url] },
            });
          }
          showNotification("Resource uploaded successfully!");
        }
      } catch (e) {
        console.error("Failed to parse response:", e);
        showNotification(`Resource uploaded but response parsing failed`);
      }
    } else {
      console.error("Upload failed with status:", xhr.status);
      showNotification(`Failed to upload resource: HTTP ${xhr.status}`);
    }
  });
  
  xhr.addEventListener('error', () => {
    hideProgressIndicator();
    console.error("Resource upload error: Network error");
    showNotification(`Failed to upload resource: Network error`);
  });
  
  xhr.addEventListener('timeout', () => {
    hideProgressIndicator();
    console.error("Resource upload error: Timeout");
    showNotification(`Failed to upload resource: Timeout`);
  });
  
  xhr.open("POST", "/upload-resource");
  xhr.timeout = 60000; // 60 second timeout
  xhr.send(formData);
  
  // Clear the input after starting upload
  if (event.target) event.target.value = "";
}

function initResourcesIndex() {
  console.log("=== INIT RESOURCES INDEX ===");
  console.log("User role:", window.userRole);
  console.log("Is teacher:", isTeacher());
  
  fetch("/resources-index")
    .then((response) => response.json())
    .then((data) => {
      console.log("Resources data received:", data);
      const resources = (data && data.resources) || [];
      const container = document.getElementById("resourcesList");
      if (container) container.innerHTML = "";
      
      console.log("Loading", resources.length, "resources");
      resources.forEach(addResourceToList);
      
      const urls = resources.map((resource) => resource.url).filter(Boolean);
      if (urls.length && navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "CACHE_RESOURCE_URLS",
          payload: { urls },
        });
      }
    })
    .catch((error) => {
      console.error("Failed to load resources index:", error);
    });
}

function addResourceToList(resource) {
  console.log("=== ADD RESOURCE TO LIST ===");
  console.log("Resource:", resource);
  console.log("Is teacher:", isTeacher());
  
  const list = document.getElementById("resourcesList");
  if (!list) {
    console.error("Resources list element not found");
    return;
  }
  
  if (!resource) {
    console.error("No resource data provided");
    return;
  }
  
  const key = `${resource.id || ""}:${resource.name || resource.safeName || resource.url}`;
  
  // Check if resource already exists
  if (Array.from(list.children).some((node) => node.dataset?.key === key)) {
    console.log("Resource already exists, ensuring teacher actions");
    if (isTeacher()) ensureTeacherActionsOnResources();
    return;
  }
  
  const row = document.createElement("div");
  row.className = "resource-row";
  row.dataset.key = key;
  if (resource.id) row.dataset.id = resource.id;
  if (resource.name || resource.safeName) row.dataset.name = resource.name || resource.safeName;
  if (resource.url) row.dataset.url = resource.url;

  const nameEl = document.createElement("div");
  nameEl.className = "resource-name";
  nameEl.textContent = resource.name || resource.safeName || resource.url;

  const actions = document.createElement("div");
  actions.className = "resource-actions";
  actions.dataset.actions = "true";

  const downloadBtn = document.createElement("a");
  downloadBtn.href = resource.url;
  downloadBtn.textContent = "Download";
  downloadBtn.className = "resource-button";
  downloadBtn.setAttribute("download", resource.safeName || "");

  actions.appendChild(downloadBtn);
  
  // Always add remove button for teachers
  if (isTeacher()) {
    console.log("Adding remove button for teacher");
    appendRemoveButton(actions, resource);
  } else {
    console.log("Not a teacher, skipping remove button");
  }

  row.appendChild(nameEl);
  row.appendChild(actions);
  list.appendChild(row);
  
  console.log("Resource added to list successfully");
}

function removeResourceFromList(resource) {
  const list = document.getElementById("resourcesList");
  if (!list || !resource) return;
  
  const key = `${resource.id || ""}:${resource.name || resource.safeName || resource.url}`;
  const existingRow = Array.from(list.children).find((node) => node.dataset?.key === key);
  if (existingRow) {
    existingRow.remove();
  }
}

function deleteResource(resource) {
  if (!resource.id || !resource.name) {
    try {
      const parts = (resource.url || "").split("/").filter(Boolean);
      const resourcesIndex = parts.indexOf("resources");
      resource.id = resource.id || parts[resourcesIndex + 1];
      resource.name = resource.name || parts[resourcesIndex + 2];
    } catch (error) {
      console.error("Error parsing resource URL:", error);
    }
  }
  
  if (!resource.id || !resource.name) {
    return alert("Invalid resource - cannot delete");
  }

  const url = `/resources/${encodeURIComponent(resource.id)}/${encodeURIComponent(resource.name)}`;
  
  fetch(url, { method: "DELETE" })
    .then((response) => {
      if (!response.ok) throw new Error("Delete failed");
      
      removeResourceFromList(resource);
      
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "DELETE_RESOURCE_URLS",
          payload: { urls: [resource.url] },
        });
      }
      
      showNotification("Resource deleted successfully!");
    })
    .catch((error) => {
      console.error("Delete resource error:", error);
      alert("Failed to delete resource: " + error.message);
    });
}

function appendRemoveButton(actionsEl, resource) {
  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.className = "resource-button remove";
  removeBtn.onclick = () => deleteResource(resource);
  actionsEl.appendChild(removeBtn);
}

function ensureTeacherActionsOnResources() {
  if (!isTeacher()) return;
  
  const list = document.getElementById("resourcesList");
  if (!list) return;
  
  Array.from(list.children).forEach((row) => {
    const actions = row.querySelector('[data-actions="true"]');
    if (!actions) return;
    
    const hasRemoveButton = Array.from(actions.children).some(
      (element) => element.tagName === "BUTTON"
    );
    
    if (!hasRemoveButton) {
      const resource = {
        id: row.dataset.id,
        name: row.dataset.name,
        url: row.dataset.url,
      };
      appendRemoveButton(actions, resource);
    }
  });
}

// Clean up on page unload
window.addEventListener("beforeunload", () => {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }
  peerConnections.forEach((pc) => pc.close());
  if (socket) {
    socket.disconnect();
  }
});

// Debug functions for troubleshooting
window.debugChatAndParticipants = function() {
  console.log("=== DEBUG CHAT AND PARTICIPANTS ===");
  
  // Check socket status
  console.log("Socket status:", {
    connected: socket?.connected,
    id: socket?.id,
    readyState: socket?.io?.readyState
  });
  
  // Check DOM elements
  const chatContainer = document.getElementById("chatContainer");
  const messageInput = document.getElementById("messageInput");
  const participantsList = document.getElementById("participantsList");
  const participantCount = document.getElementById("participantCount");
  
  console.log("DOM elements:", {
    chatContainer: !!chatContainer,
    messageInput: !!messageInput,
    participantsList: !!participantsList,
    participantCount: !!participantCount
  });
  
  // Test message sending
  if (socket && socket.connected) {
    console.log("Testing message send...");
    socket.emit("send-message", {
      message: "Test message from debug function",
      timestamp: Date.now()
    });
  } else {
    console.warn("Socket not connected, cannot test message sending");
  }
  
  // Check current participants
  console.log("Current participants:", window.participants || "Not set");
  
  // Test participants update manually
  console.log("Testing participants update with sample data...");
  const testParticipants = [
    { name: "Test Teacher", role: "teacher" },
    { name: "Test Student", role: "student" }
  ];
  updateParticipantsList(testParticipants);
  
  console.log("=== END DEBUG ===");
}

// Debug function specifically for participants
window.debugParticipants = function() {
  console.log("=== DEBUG PARTICIPANTS ONLY ===");
  
  // Check if socket event handlers are registered
  console.log("Socket event listeners:", {
    hasParticipantsUpdated: socket?.listeners?.("participants-updated")?.length > 0,
    hasClassroomState: socket?.listeners?.("classroom-state")?.length > 0
  });
  
  // Check current state
  console.log("Current state:", {
    userRole: window.userRole,
    socketConnected: socket?.connected,
    participantsListElement: !!document.getElementById("participantsList"),
    participantCountElement: !!document.getElementById("participantCount")
  });
  
  // Force emit a test participants update
  if (socket && socket.connected) {
    console.log("Emitting test participants-updated event...");
    socket.emit("test-participants-update");
  }
  
  console.log("=== END PARTICIPANTS DEBUG ===");
}

// Comprehensive debug function for all issues
window.debugAllIssues = function() {
  console.log("=== COMPREHENSIVE DEBUG ===");
  
  // 1. Check socket status
  console.log("1. SOCKET STATUS:");
  console.log("   - Socket exists:", !!socket);
  console.log("   - Socket connected:", socket?.connected);
  console.log("   - Socket ID:", socket?.id);
  console.log("   - Socket ready state:", socket?.io?.readyState);
  
  // 2. Check user data
  console.log("2. USER DATA:");
  console.log("   - Username:", window.userName);
  console.log("   - User role:", window.userRole);
  console.log("   - Role type:", typeof window.userRole);
  console.log("   - Is teacher:", isTeacher());
  
  // 3. Check DOM elements
  console.log("3. DOM ELEMENTS:");
  const elements = {
    chatInput: document.getElementById("chatInput"),
    chatMessages: document.getElementById("chatMessages"),
    participantsList: document.getElementById("participantsList"),
    participantCount: document.getElementById("participantCount"),
    resourcesList: document.getElementById("resourcesList"),
    currentSlide: document.getElementById("currentSlide"),
    noSlideMessage: document.getElementById("noSlideMessage")
  };
  
  Object.entries(elements).forEach(([name, element]) => {
    console.log(`   - ${name}:`, !!element);
  });
  
  // 4. Check socket event listeners
  console.log("4. SOCKET EVENT LISTENERS:");
  if (socket) {
    const events = ['participants-updated', 'new-message', 'send-message', 'slide-ready', 'upload-complete'];
    events.forEach(event => {
      const listeners = socket.listeners?.(event) || [];
      console.log(`   - ${event}: ${listeners.length} listeners`);
    });
  }
  
  // 5. Test participants update
  console.log("5. TESTING PARTICIPANTS UPDATE:");
  const testParticipants = [
    { name: "Test Teacher", role: "teacher" },
    { name: "Test Student", role: "student" }
  ];
  updateParticipantsList(testParticipants);
  
  // 6. Test chat functionality
  console.log("6. TESTING CHAT:");
  if (socket && socket.connected) {
    console.log("   - Emitting test message...");
    socket.emit("send-message", {
      text: "Test message from debug",
      sender: window.userName || "Debug User",
      role: window.userRole || "student",
      timestamp: Date.now()
    });
  } else {
    console.log("   - Cannot test chat: socket not connected");
  }
  
  // 7. Test resource functionality
  console.log("7. RESOURCE FUNCTIONALITY:");
  console.log("   - Resources list element:", !!document.getElementById("resourcesList"));
  console.log("   - Is teacher (for remove buttons):", isTeacher());
  
  // 8. Test slide functionality
  console.log("8. SLIDE FUNCTIONALITY:");
  console.log("   - Current slide number:", currentSlideNumber);
  console.log("   - Total slides:", totalSlides);
  console.log("   - Slides array length:", slides?.length || 0);
  
  console.log("=== END COMPREHENSIVE DEBUG ===");
}

// Debug function specifically for resources
window.debugResources = function() {
  console.log("=== DEBUG RESOURCES ===");
  
  // Check user role
  console.log("1. USER ROLE:");
  console.log("   - window.userRole:", window.userRole);
  console.log("   - isTeacher():", isTeacher());
  
  // Check DOM elements
  console.log("2. DOM ELEMENTS:");
  const resourcesList = document.getElementById("resourcesList");
  console.log("   - resourcesList element:", !!resourcesList);
  if (resourcesList) {
    console.log("   - resourcesList children count:", resourcesList.children.length);
    console.log("   - resourcesList innerHTML length:", resourcesList.innerHTML.length);
  }
  
  // Check existing resources
  console.log("3. EXISTING RESOURCES:");
  if (resourcesList) {
    Array.from(resourcesList.children).forEach((row, index) => {
      console.log(`   - Resource ${index + 1}:`, {
        key: row.dataset.key,
        id: row.dataset.id,
        name: row.dataset.name,
        url: row.dataset.url,
        hasRemoveButton: !!row.querySelector('.remove')
      });
    });
  }
  
  // Test adding a resource
  console.log("4. TESTING RESOURCE ADDITION:");
  const testResource = {
    id: "test-id",
    name: "test-file.pdf",
    safeName: "test-file.pdf",
    url: "/resources/test-id/test-file.pdf"
  };
  addResourceToList(testResource);
  
  // Force refresh resources
  console.log("5. REFRESHING RESOURCES:");
  initResourcesIndex();
  
  console.log("=== END RESOURCES DEBUG ===");
}

// Function to refresh resources after role is set
window.refreshResourcesForRole = function() {
  console.log("=== REFRESH RESOURCES FOR ROLE ===");
  console.log("Current role:", window.userRole);
  console.log("Is teacher:", isTeacher());
  
  // Re-initialize resources to ensure remove buttons are added
  initResourcesIndex();
  
  // Also ensure teacher actions on existing resources
  if (isTeacher()) {
    ensureTeacherActionsOnResources();
  }
  
  console.log("Resources refreshed for role");
}

// Emergency debug function to test all critical functionality
window.emergencyDebug = function() {
  console.log("🚨 EMERGENCY DEBUG - TESTING ALL CRITICAL FUNCTIONS 🚨");
  
  // 1. Test basic setup
  console.log("1. BASIC SETUP:");
  console.log("   - window.userRole:", window.userRole);
  console.log("   - window.userName:", window.userName);
  console.log("   - window.socketReady:", window.socketReady);
  console.log("   - window.userJoined:", window.userJoined);
  console.log("   - socket exists:", !!socket);
  console.log("   - socket connected:", socket?.connected);
  
  // 2. Test isTeacher function
  console.log("2. TEACHER ROLE CHECK:");
  console.log("   - isTeacher():", isTeacher());
  console.log("   - window.userRole === 'teacher':", window.userRole === "teacher");
  
  // 3. Test DOM elements
  console.log("3. DOM ELEMENTS:");
  const elements = {
    slideUpload: document.getElementById("slideUpload"),
    resourceUpload: document.getElementById("resourceUpload"),
    participantsList: document.getElementById("participantsList"),
    participantCount: document.getElementById("participantCount"),
    teacherControls: document.getElementById("teacherControls")
  };
  
  Object.entries(elements).forEach(([name, element]) => {
    console.log(`   - ${name}:`, !!element);
    if (element) {
      console.log(`     - display: ${element.style.display || 'not set'}`);
      console.log(`     - visibility: ${element.style.visibility || 'not set'}`);
    }
  });
  
  // 4. Test function availability
  console.log("4. FUNCTION AVAILABILITY:");
  const functions = {
    triggerFileUpload: window.triggerFileUpload,
    handleFileUpload: window.handleFileUpload,
    triggerResourceUpload: window.triggerResourceUpload,
    handleResourceUpload: window.handleResourceUpload,
    updateParticipantsList: window.updateParticipantsList,
    sendMessage: window.sendMessage
  };
  
  Object.entries(functions).forEach(([name, func]) => {
    console.log(`   - ${name}:`, typeof func === 'function' ? "✅ Available" : "❌ Missing");
  });
  
  // 5. Test socket event listeners
  console.log("5. SOCKET EVENT LISTENERS:");
  if (socket) {
    const events = ['participants-updated', 'new-message', 'slide-ready', 'upload-complete'];
    events.forEach(event => {
      const listeners = socket.listeners?.(event) || [];
      console.log(`   - ${event}: ${listeners.length} listeners`);
    });
  }
  
  // 6. Test upload functionality manually
  console.log("6. TESTING UPLOAD FUNCTIONALITY:");
  if (isTeacher()) {
    console.log("   - Teacher role confirmed, testing upload triggers...");
    
    // Test if file input exists and is accessible
    const slideInput = document.getElementById("slideUpload");
    const resourceInput = document.getElementById("resourceUpload");
    
    if (slideInput) {
      console.log("   - Slide upload input: ✅ Found");
      console.log("   - Slide input type:", slideInput.type);
      console.log("   - Slide input accept:", slideInput.accept);
    } else {
      console.log("   - Slide upload input: ❌ Missing");
    }
    
    if (resourceInput) {
      console.log("   - Resource upload input: ✅ Found");
      console.log("   - Resource input type:", resourceInput.type);
    } else {
      console.log("   - Resource upload input: ❌ Missing");
    }
  } else {
    console.log("   - Not a teacher, upload functions should be restricted");
  }
  
  // 7. Test participants functionality
  console.log("7. TESTING PARTICIPANTS:");
  const participantsList = document.getElementById("participantsList");
  if (participantsList) {
    console.log("   - Participants list element: ✅ Found");
    console.log("   - Current participants count:", participantsList.children.length);
  } else {
    console.log("   - Participants list element: ❌ Missing");
  }
  
  // 8. Force test participants update
  console.log("8. FORCE TESTING PARTICIPANTS UPDATE:");
  const testParticipants = [
    { name: "Test Teacher", role: "teacher" },
    { name: "Test Student", role: "student" }
  ];
  updateParticipantsList(testParticipants);
  
  console.log("🚨 EMERGENCY DEBUG COMPLETE 🚨");
}

// Function to manually trigger socket setup (for emergency fixes)
window.forceSocketSetup = function() {
  console.log("🔧 FORCE SOCKET SETUP - EMERGENCY FIX 🔧");
  
  // Force setup socket event handlers
  if (socket) {
    console.log("Setting up socket event handlers...");
    setupSocketEventHandlers();
  } else {
    console.log("No socket available, cannot setup event handlers");
  }
  
  // Force setup user data listeners
  console.log("Setting up user data listeners...");
  setupUserDataListeners();
  
  // Force refresh resources
  console.log("Refreshing resources...");
  if (typeof refreshResourcesForRole === 'function') {
    refreshResourcesForRole();
  }
  
  console.log("🔧 FORCE SOCKET SETUP COMPLETE 🔧");
}

// Function to test upload functionality manually
window.testUploads = function() {
  console.log("🧪 TESTING UPLOAD FUNCTIONALITY 🧪");
  
  if (!isTeacher()) {
    console.log("❌ Not a teacher, cannot test uploads");
    return;
  }
  
  console.log("✅ Teacher role confirmed, testing uploads...");
  
  // Test slide upload trigger
  console.log("Testing slide upload trigger...");
  try {
    triggerFileUpload();
    console.log("✅ Slide upload trigger executed");
  } catch (error) {
    console.error("❌ Slide upload trigger failed:", error);
  }
  
  // Test resource upload trigger
  console.log("Testing resource upload trigger...");
  try {
    triggerResourceUpload();
    console.log("✅ Resource upload trigger executed");
  } catch (error) {
    console.error("❌ Resource upload trigger failed:", error);
  }
  
  console.log("🧪 UPLOAD TESTING COMPLETE 🧪");
}

// Simple test function to check if buttons are working
window.testUploadButtons = function() {
  console.log("🔘 TESTING UPLOAD BUTTONS 🔘");
  
  // Test if buttons exist and are clickable
  const slideUploadBtn = document.querySelector('button[onclick="triggerFileUpload()"]');
  const resourceUploadBtn = document.querySelector('button[onclick="triggerResourceUpload()"]');
  
  console.log("Slide upload button:", slideUploadBtn);
  console.log("Resource upload button:", resourceUploadBtn);
  
  if (slideUploadBtn) {
    console.log("✅ Slide upload button found");
    console.log("Button text:", slideUploadBtn.textContent);
    console.log("Button onclick:", slideUploadBtn.getAttribute('onclick'));
  } else {
    console.log("❌ Slide upload button not found");
  }
  
  if (resourceUploadBtn) {
    console.log("✅ Resource upload button found");
    console.log("Button text:", resourceUploadBtn.textContent);
    console.log("Button onclick:", resourceUploadBtn.getAttribute('onclick'));
  } else {
    console.log("❌ Resource upload button not found");
  }
  
  // Test if file inputs exist
  const slideInput = document.getElementById("slideUpload");
  const resourceInput = document.getElementById("resourceUpload");
  
  console.log("Slide input element:", slideInput);
  console.log("Resource input element:", resourceInput);
  
  if (slideInput) {
    console.log("✅ Slide input found");
    console.log("Input type:", slideInput.type);
    console.log("Input accept:", slideInput.accept);
  } else {
    console.log("❌ Slide input not found");
  }
  
  if (resourceInput) {
    console.log("✅ Resource input found");
    console.log("Input type:", resourceInput.type);
  } else {
    console.log("❌ Resource input not found");
  }
  
  console.log("🔘 UPLOAD BUTTON TESTING COMPLETE 🔘");
}