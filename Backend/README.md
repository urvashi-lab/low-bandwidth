# LUMINEX – System Architecture and Developer Guide

This document explains how the Virtual Classroom works end‑to‑end, how the code is structured, and how to make changes safely. It is written to help any developer quickly onboard and extend the system.

## 1) High‑level Overview

LUMINEX is a low‑bandwidth virtual classroom. Teachers upload slides (PDF/PPTX/images). The server converts them to compressed images, streams events to all clients, and preloads future slides for snappy navigation. A real‑time chat, whiteboard, and audio broadcasting (WebRTC) enable teaching. A service worker caches content and teacher‑shared resources for better offline access.

## 2) Architecture at a Glance

- Runtime: Node.js + Express + Socket.IO
- Frontend: Vanilla HTML/CSS/JS (no framework) served from `public/`
- Media processing: `pdf-poppler` + `sharp`, PPTX→PDF via LibreOffice
- Real‑time: Socket.IO events for classroom state, chat, slides, whiteboard, WebRTC signaling
- Caching/offline: Service Worker

Directory map:

- `src/index.js` – app entry (Express + Socket.IO + static)
- `src/routes/` – HTTP endpoints
  - `upload.js` – accepts uploads and triggers conversion
  - `resources.js` – teacher uploads/list/deletes downloadable resources
  - `slides.js` – manual static route for slide files + diagnostics
- `src/services/conversion.js` – PDF/PPTX processing and compression
- `src/sockets/` – real‑time classroom
  - `index.js` – all socket event handlers
  - `io.js` – Socket.IO instance accessor for routes/services
- `src/middleware/` – Express middleware
  - `uploads.js` – Multer config and file limits
  - `errors.js` – central error handling
- `src/state/classroomState.js` – in‑memory classroom state + connections
- `src/public/sw.js` – service worker, served at `/sw.js`
- `public/` – frontend UI
  - `index.html`, `css/styles.css`, `js/app.js`, `js/whiteboard.js`

## 3) Data & Event Flow

1. Teacher joins as role "teacher" → server marks `isTeacherPresent`.
2. Teacher uploads a file → `POST /upload` (Multer) →
   - If PDF: convert pages to PNG (poppler), then compress to WebP (sharp)
   - If PPTX: LibreOffice → PDF → same PDF pipeline
   - If image: compress directly
   - Emits Socket.IO events progressively: `upload-started` → `total-slides` → `slide-ready` (per page) → `upload-complete`
3. Clients update their UI as slides arrive (first slide displays as soon as ready).
4. Teacher changes slide → emits `change-slide` → all clients display target slide.
5. Whiteboard: teacher draws → emits `whiteboard-update` strokes; students render them in real time. Clear broadcasts via `whiteboard-clear`.
6. Chat: `send-message` → server stamps and broadcasts `new-message`.
7. Audio: teacher creates a WebRTC offer via Socket.IO (`webrtc-offer`), students respond with `webrtc-answer`, ICE flows via `webrtc-ice-candidate`.
8. Resources: teacher uploads files to `/upload-resource`. Clients list resources and ask the SW to cache them.
9. Service worker caches GETs (slides/resources) and serves them offline/faster.

## 4) Backend Modules in Detail

### 4.1 `src/index.js`

- Creates Express app and HTTP server
- Static:
  - `/` → `public/`
  - `/slides` → on‑disk slide folders
  - `/resources` → downloadable files
  - `/sw.js` → service worker from `src/public/sw.js`
- Mounts routes: `slidesRoutes`, `resourceRoutes`, `uploadRoutes`
- Error middleware (Multer/file errors)
- Ensures `uploads/`, `slides/`, `resources/` directories exist
- Initializes Socket.IO via `initSockets(server)`

### 4.2 `src/routes/upload.js`

- `POST /upload` (Multer single `file`) accepts: `.pdf`, `.pptx`, `.png/.jpg/.jpeg`
- Broadcasts progress events and updates `classroomState`
- Uses `convertPdfToImages` and `convertPptToPdf` (see services)
- Produces compressed WebP slides and progressive events so UIs can show slides as they are ready

### 4.3 `src/routes/resources.js`

- `POST /upload-resource` – moves uploaded file to `/resources/:uuid/`
- `DELETE /resources/:id/:name` – deletes a file and (if empty) its directory
- `GET /resources-index` – lists available resources with size/mtime for client rendering and SW pre‑caching
- Emits `resource-added`/`resource-removed`

### 4.4 `src/routes/slides.js`

- `GET /slides/:id/:filename` – manual sendFile with headers/logging for debugging
- `GET /test-slides` – lists slide directories and files for diagnostics

### 4.5 `src/services/conversion.js`

- `convertPdfToImages(pdfPath, outDir, io, classroomId)`
  - Poppler generates per‑page PNGs
  - For each page: sharp resizes → WebP compress → deletes original PNG
  - Emits `total-slides`, `slide-ready` (per page), `slide-preloaded` (first N)
- `convertPptToPdf(inputPath, outputPath)`
  - Uses LibreOffice (Windows path fallback + `soffice` in PATH) with a timeout

### 4.6 `src/sockets/index.js`

- Handles:
  - `join-classroom` → registers role/name, emits `classroom-state`, `participants-updated`
  - Slide change: `change-slide` (teacher‑only) → emits `slide-changed`
  - Auto‑preloading notifications (optional helper)
  - Chat: `send-message` → emits `new-message`
  - WebRTC signaling: `webrtc-offer` / `webrtc-answer` / `webrtc-ice-candidate`
  - Whiteboard: `whiteboard-update`, `whiteboard-clear`, `whiteboard-toggle`
  - Disconnect: updates participants; when teacher leaves clears slides and resets state
- Periodic cleanup of old slide folders (24h+)

### 4.7 `src/state/classroomState.js`

- In‑memory shape:

```
{
  currentSlide: number,
  totalSlides: number,
  slideData: Array<{url,name,index}>,
  isTeacherPresent: boolean,
  participants: Array<{role,name,socketId,joinedAt}>,
  preloadedSlides: Set<number>,
  preloadBuffer: number,
  isPreloading: boolean,
  whiteboardActive: boolean,
  whiteboardState: any
}
```

- `connectedClients: Map<socketId, {role,name,...}>`

## 5) Frontend Modules in Detail

### 5.1 `public/index.html`

- Single page UI with join form, main classroom layout, slide area, whiteboard container, chat, and resources panel.
- Loads:
  - Socket.IO client (CDN)
  - `css/styles.css`
  - `js/app.js` (classroom logic)
  - `js/whiteboard.js` (whiteboard tools & sync)

### 5.2 `public/js/app.js`

- Boot sequence on `window.onload`:
  - `initializeSocket()` sets up listeners and exposes `window.socket`
  - `initializeWhiteboard()` from whiteboard module
  - `initResourcesIndex()` and SW registration
- Maintains UI state: slides array, current slide index, participants, chat
- Handles all Socket.IO events to update DOM
- Slide upload flow for teacher (fetch `/upload`)
- Real‑time chat via `send-message`
- Audio broadcasting (WebRTC) offer/answer/ICE handlers

### 5.3 `public/js/whiteboard.js`

- Tools: brush/eraser, color picker, size slider, clear
- Toggle logic:
  - `toggleWhiteboard()` computes next desired state and applies it idempotently
  - `handleWhiteboardToggle({active})` sets state from server broadcasts
- Drawing:
  - Teacher draws lines; module emits `whiteboard-update` strokes
  - Students receive and render those strokes
  - Clear emits `whiteboard-clear`
- Drawings persist even when toggling off/on (no auto‑clear)

### 5.4 `src/public/sw.js` (served as `/sw.js`)

- Installation: caches shell files
- Fetch: cache‑first for `/resources/` GETs; network‑then‑cache for others (GET only)
- Message API: `CACHE_RESOURCE_URLS` and `DELETE_RESOURCE_URLS` to manage resource caching on demand

## 6) Making Common Changes

- Add a new HTTP endpoint → create file in `src/routes/`, mount in `src/index.js`.
- Add a new socket feature → add event handlers in `src/sockets/index.js`.
- Change upload limits or types → edit `src/middleware/uploads.js`.
- Add a new media pipeline → add function in `src/services/` and call it from routes.
- UI changes → edit `public/index.html` and related CSS/JS.
- Whiteboard behavior → tweak `public/js/whiteboard.js` (tools, size, persistence).
- SW behavior → edit `src/public/sw.js` and bump cache names.

## 7) Local Development & Setup

Prereqs:

- Node.js 18+
- For PPTX: LibreOffice installed (Windows path or `soffice` in PATH)

Run:

```
npm install
npm run dev
```

Open `http://localhost:3000/`.

First time (or after SW changes): DevTools → Application → Service Workers → Unregister → Hard reload.

## 8) Troubleshooting Cheatsheet

- Whiteboard doesn’t draw → ensure you joined as teacher; hard reload; check console for `whiteboard-update` errors.
- Whiteboard flips off immediately → confirm client uses `handleWhiteboardToggle` and server emits the same boolean state (already implemented).
- PPTX upload fails → install LibreOffice; verify `soffice` path; read server logs for exact cause.
- Slides 404 → open `/test-slides` to inspect generated directories & files.
- “DELETE unsupported in cache” → unregister old SW; caches now only handle GET.

## 9) Extending Further (Ideas)

- Persist whiteboard strokes per slide (map slideIndex → strokes) and restore when returning to a slide.
- Save classroom state in a DB (e.g., Redis/Postgres) for resilience.
- Add authentication/rooms and role‑based access control.
- Add HLS/Opus streaming for audio with SFU if scaling is needed.

---

If you need a change plan or code pointers for a specific feature, open an issue describing the workflow, and follow the module boundaries outlined above.
