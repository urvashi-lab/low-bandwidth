const classroomState = {
  currentSlide: 0,
  totalSlides: 0,
  slideData: [],
  isTeacherPresent: false,
  participants: [],
  preloadedSlides: new Set(),
  preloadQueue: [],
  preloadBuffer: 3,
  isPreloading: false,
  whiteboardActive: false,
  whiteboardState: null,
};

const connectedClients = new Map();

module.exports = {
  classroomState,
  connectedClients,
};


