// Override via window.GALLERY_API_URL if needed (e.g. injected config.js in docker setup)
const API_URL = window.GALLERY_API_URL || 'http://localhost:4000';

const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const fileLabelText = document.getElementById('file-label-text');
const statusEl = document.getElementById('upload-status');
const galleryEl = document.getElementById('gallery');

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxFrame = document.querySelector('.lightbox-frame');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');
const zoomLevelEl = document.getElementById('zoom-level');
const nativeNoteEl = document.getElementById('native-note');
const rotateBtn = document.getElementById('rotate-btn');
const formatBtns = document.querySelectorAll('.format-btn');

// --- Zoom / pan state ---
// The image is never re-encoded or resized anywhere in the pipeline (MinIO
// stores the original bytes as-is), so zooming is purely a viewing aid to
// inspect the original resolution — nothing is "enhanced".
// Zooming past the point where 1 image pixel = 1 screen pixel can't reveal
// more real detail (the browser would just interpolate/blur), so the max
// zoom is capped per-image at that native-resolution point.
const MIN_SCALE = 1;
const ABSOLUTE_MAX_SCALE = 8; // safety ceiling for tiny/degenerate images
const ZOOM_STEP = 0.25;

let scale = 1;
let posX = 0;
let posY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let maxScaleForImage = ABSOLUTE_MAX_SCALE;
let rotation = 0;
let currentRatio = 'auto';

function applyTransform() {
  lightboxImg.style.transform = `translate(${posX}px, ${posY}px) rotate(${rotation}deg) scale(${scale})`;
  zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
  lightboxImg.style.cursor = scale > 1 ? 'grab' : 'default';
  nativeNoteEl.style.display = scale >= maxScaleForImage - 0.01 ? 'block' : 'none';
  zoomInBtn.disabled = scale >= maxScaleForImage - 0.001;
  zoomOutBtn.disabled = scale <= MIN_SCALE + 0.001;
}

function setScale(next) {
  scale = Math.min(maxScaleForImage, Math.max(MIN_SCALE, next));
  if (scale === MIN_SCALE) { posX = 0; posY = 0; }
  applyTransform();
}

function resetZoom() {
  scale = 1;
  posX = 0;
  posY = 0;
  applyTransform();
}

// Recompute how far THIS image can usefully be zoomed: the scale at which
// one file pixel maps to one screen pixel (its native resolution).
function recalcMaxScale() {
  const fitWidth = lightboxImg.getBoundingClientRect().width || 1;
  const ratio = lightboxImg.naturalWidth / fitWidth;
  maxScaleForImage = Math.max(MIN_SCALE, Math.min(ABSOLUTE_MAX_SCALE, ratio));
  applyTransform();
}

lightboxImg.addEventListener('load', recalcMaxScale);

// --- Frame format (crop-preview) ---
// Lets you preview how a photo would look in a fixed shape (square,
// portrait, widescreen...) instead of always being capped by height, which
// is what makes tall phone photos look small on a wide monitor by default.
function applyFrameRatio() {
  if (currentRatio === 'auto') {
    lightboxFrame.style.width = '';
    lightboxFrame.style.height = '';
    lightboxFrame.classList.remove('fixed-ratio');
    return;
  }
  const maxW = Math.min(window.innerWidth * 0.9, 900);
  const maxH = window.innerHeight * 0.75;
  const [rw, rh] = currentRatio.split('/').map(Number);

  let width = maxW;
  let height = width * (rh / rw);
  if (height > maxH) {
    height = maxH;
    width = height * (rw / rh);
  }

  lightboxFrame.style.width = `${width}px`;
  lightboxFrame.style.height = `${height}px`;
  lightboxFrame.classList.add('fixed-ratio');
}

formatBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    formatBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentRatio = btn.dataset.ratio;
    applyFrameRatio();
  });
});

window.addEventListener('resize', () => {
  if (!lightbox.classList.contains('hidden')) applyFrameRatio();
});

// --- Rotate (fixes sideways phone photos) ---
rotateBtn.addEventListener('click', () => {
  rotation = (rotation + 90) % 360;
  applyTransform();
});

zoomInBtn.addEventListener('click', () => setScale(scale + ZOOM_STEP));
zoomOutBtn.addEventListener('click', () => setScale(scale - ZOOM_STEP));
zoomResetBtn.addEventListener('click', resetZoom);

lightboxFrame.addEventListener('wheel', (e) => {
  e.preventDefault();
  setScale(scale + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}, { passive: false });

lightboxImg.addEventListener('dblclick', () => {
  setScale(scale > 1 ? 1 : Math.min(2, maxScaleForImage));
});

lightboxImg.addEventListener('pointerdown', (e) => {
  if (scale <= 1) return;
  isDragging = true;
  dragStartX = e.clientX - posX;
  dragStartY = e.clientY - posY;
  lightboxImg.setPointerCapture(e.pointerId);
  lightboxImg.style.cursor = 'grabbing';
});

lightboxImg.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  posX = e.clientX - dragStartX;
  posY = e.clientY - dragStartY;
  applyTransform();
});

function endDrag() {
  isDragging = false;
  if (scale > 1) lightboxImg.style.cursor = 'grab';
}
lightboxImg.addEventListener('pointerup', endDrag);
lightboxImg.addEventListener('pointercancel', endDrag);

async function loadFiles() {
  try {
    const res = await fetch(`${API_URL}/api/files`);
    const files = await res.json();
    renderGallery(files);
  } catch (err) {
    galleryEl.innerHTML = `<p class="empty">Не удалось загрузить галерею: ${err.message}</p>`;
  }
}

function renderGallery(files) {
  if (files.length === 0) {
    galleryEl.innerHTML = '<p class="empty">Пока пусто — загрузите первое изображение</p>';
    return;
  }

  galleryEl.innerHTML = '';
  files.forEach((file) => {
    const card = document.createElement('div');
    card.className = 'card';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'card-image-wrap';
    imgWrap.addEventListener('click', () => openLightbox(file));

    const img = document.createElement('img');
    img.src = file.url;
    img.alt = file.name;
    imgWrap.appendChild(img);
    card.appendChild(imgWrap);

    const info = document.createElement('div');
    info.className = 'card-info';

    const name = document.createElement('span');
    name.textContent = file.name;
    info.appendChild(name);

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = 'удалить';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFile(file.id);
    });
    info.appendChild(delBtn);

    card.appendChild(info);
    galleryEl.appendChild(card);
  });
}

function openLightbox(file) {
  lightboxImg.src = file.url;
  lightboxImg.alt = file.name;
  lightboxCaption.textContent = file.name;
  rotation = 0;
  currentRatio = 'auto';
  formatBtns.forEach((b) => b.classList.toggle('active', b.dataset.ratio === 'auto'));
  applyFrameRatio();
  resetZoom();
  lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.classList.add('hidden');
  lightboxImg.src = '';
  document.body.style.overflow = '';
  resetZoom();
}

lightboxClose.addEventListener('click', closeLightbox);

// Close when clicking the dark backdrop, but not the image/frame itself
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});

document.addEventListener('keydown', (e) => {
  if (lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === '+' || e.key === '=') setScale(scale + ZOOM_STEP);
  if (e.key === '-') setScale(scale - ZOOM_STEP);
  if (e.key === '0') resetZoom();
});

async function deleteFile(id) {
  try {
    await fetch(`${API_URL}/api/files/${id}`, { method: 'DELETE' });
    loadFiles();
  } catch (err) {
    console.error('Delete failed', err);
  }
}

fileInput.addEventListener('change', () => {
  fileLabelText.textContent = fileInput.files[0]?.name || 'Выбрать изображение';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  statusEl.textContent = 'загрузка...';
  form.querySelector('button').disabled = true;

  try {
    const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('upload failed');
    statusEl.textContent = 'готово';
    fileInput.value = '';
    fileLabelText.textContent = 'Выбрать изображение';
    loadFiles();
  } catch (err) {
    statusEl.textContent = 'ошибка загрузки: ' + err.message;
  } finally {
    form.querySelector('button').disabled = false;
  }
});

loadFiles();
