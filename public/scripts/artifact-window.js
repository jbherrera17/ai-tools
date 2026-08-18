// Higgins 2.0 — Floating artifact window. REQ-002 Phase 3.
//
// Each artifact gets its own draggable / resizable / minimizable window.
// Multiple windows coexist; cascade-placed on creation, persist size/pos
// in localStorage by id, brought to front on focus.
//
// Public API:
//   ArtifactWindow.openOrUpdate(id, { type, title, content, language, version })
//   ArtifactWindow.close(id)
//   ArtifactWindow.get(id)
//   ArtifactWindow.rehydrate(artifacts)  // called on conversation reload
//
// Reuses CSS tokens from /styles/base.css via /styles/artifact-window.css.

import { renderArtifact } from '/scripts/artifact-renderers.js';

const STORAGE_KEY = 'higgins.artifactBoxes';
const CASCADE_STEP = 32;
const TYPE_LABEL = {
  markdown: 'MARKDOWN',
  code: 'CODE',
  html: 'HTML',
  table: 'TABLE',
  docx: 'DOCX',
  pptx: 'PPTX',
  'remotion-video': 'VIDEO',
};
const TYPE_EXT = {
  markdown: 'md',
  table: 'md',
  html: 'html',
  docx: 'docx',
  pptx: 'pptx',
};

let layerEl = null;
let dockEl = null;
let zCounter = 100;

function getLayer() {
  if (layerEl) return layerEl;
  layerEl = document.getElementById('artifact-layer');
  if (!layerEl) {
    layerEl = document.createElement('div');
    layerEl.id = 'artifact-layer';
    document.body.appendChild(layerEl);
  }
  return layerEl;
}

function getDock() {
  if (dockEl) return dockEl;
  dockEl = document.getElementById('artifact-dock');
  if (!dockEl) {
    dockEl = document.createElement('div');
    dockEl.id = 'artifact-dock';
    document.body.appendChild(dockEl);
  }
  return dockEl;
}

function readBoxes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}
function writeBox(id, box) {
  const all = readBoxes();
  all[id] = box;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch {}
}
function forgetBox(id) {
  const all = readBoxes();
  delete all[id];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch {}
}

function defaultBox(index) {
  // Anchor to the right portion of the workspace, clear of the Higgins
  // card (top-left, up to ~720px wide). Cascade with a column wrap so
  // many open artifacts don't pile up under each other.
  // Top is relative to #artifact-layer, which already starts below the site nav.
  const HIGGINS_CLEARANCE = 560;
  const baseLeft = Math.max(HIGGINS_CLEARANCE, window.innerWidth - 580);
  const baseTop = 16;
  const wrap = Math.floor((index * CASCADE_STEP) / 280);
  return {
    left: Math.max(HIGGINS_CLEARANCE, baseLeft - wrap * 60),
    top: baseTop + (index * CASCADE_STEP) % 280,
    width: 520,
    height: 420,
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slugFilename(title, id) {
  const raw = String(title || id || 'artifact');
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'artifact';
}

const ICON = {
  min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="14" x2="18" y2="14"/></svg>',
  max: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="8" width="12" height="12" rx="1"/><path d="M8 8V5h12v12h-3"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
};

export class ArtifactWindow {
  static registry = new Map();

  /**
   * Open a new window or update an existing one (same `id` slug).
   * @returns {ArtifactWindow}
   */
  static openOrUpdate(id, opts) {
    const existing = ArtifactWindow.registry.get(id);
    if (existing) {
      existing.update(opts);
      existing.bringToFront();
      return existing;
    }
    return new ArtifactWindow(id, opts);
  }

  static get(id) { return ArtifactWindow.registry.get(id); }

  static close(id) {
    const w = ArtifactWindow.registry.get(id);
    if (w) w.close();
  }

  /**
   * Re-create windows from a list of artifact rows pulled from the API
   * (used on page load / conversation switch).
   */
  static rehydrate(artifacts) {
    for (const a of artifacts) {
      ArtifactWindow.openOrUpdate(a.slug, {
        type: a.type,
        title: a.title,
        content: a.content,
        language: a.language,
        version: a.current_version,
        blobUrl: a.blob_url,
      });
    }
  }

  constructor(id, opts) {
    this.id = id;
    this.type = opts.type || 'markdown';
    this.title = opts.title || 'Artifact';
    this.content = opts.content ?? '';
    this.language = opts.language;
    this.version = opts.version || 1;
    this.blobUrl = opts.blobUrl ?? null;
    this.minimized = false;

    const box = readBoxes()[id] || defaultBox(ArtifactWindow.registry.size);

    this.el = document.createElement('div');
    this.el.className = 'artifact-window';
    this.el.style.left = box.left + 'px';
    this.el.style.top = Math.max(0, box.top) + 'px';
    this.el.style.width = box.width + 'px';
    this.el.style.height = box.height + 'px';
    this.el.style.zIndex = String(++zCounter);
    this.el.dataset.artifactId = id;

    this.el.innerHTML = `
      <div class="aw-titlebar" data-aw-drag>
        <span class="aw-type-badge">${escapeHtml(TYPE_LABEL[this.type] || this.type.toUpperCase())}</span>
        <span class="aw-title">${escapeHtml(this.title)}</span>
        <span class="aw-version" data-aw-version>v${this.version}</span>
        <div class="aw-controls">
          <button class="aw-btn" data-aw-copy title="Copy source">${ICON.copy}</button>
          <button class="aw-btn" data-aw-download title="Download file">${ICON.download}</button>
          <button class="aw-btn" data-aw-min title="Minimize">${ICON.min}</button>
          <button class="aw-btn" data-aw-max title="Maximize">${ICON.max}</button>
          <button class="aw-btn" data-aw-close title="Close">${ICON.close}</button>
        </div>
      </div>
      <div class="aw-body" data-aw-body></div>
      <div class="aw-resize right" title="Drag to resize width"></div>
      <div class="aw-resize bottom" title="Drag to resize height"></div>
      <div class="aw-resize corner" title="Drag to resize"></div>
    `;

    this.bodyEl = this.el.querySelector('[data-aw-body]');
    this.versionEl = this.el.querySelector('[data-aw-version]');

    getLayer().appendChild(this.el);
    ArtifactWindow.registry.set(id, this);

    this._wire();
    this._render();

    // Slight delay so the CSS transition triggers.
    requestAnimationFrame(() => this.el.classList.add('entered'));
    this.bringToFront();
  }

  update({ type, title, content, language, patch, version, blobUrl }) {
    if (type) this.type = type;
    if (title) this.title = title;
    if (language) this.language = language;
    if (version) this.version = version;
    if (blobUrl !== undefined) this.blobUrl = blobUrl;

    if (patch) {
      if (patch.mode === 'replace') this.content = patch.content;
      else if (patch.mode === 'append') this.content = (this.content || '') + patch.content;
    } else if (content !== undefined) {
      this.content = content;
    }

    // Bump version if not explicitly provided
    if (!version) this.version += 1;

    this.el.querySelector('.aw-title').textContent = this.title;
    this.el.querySelector('.aw-type-badge').textContent = TYPE_LABEL[this.type] || this.type.toUpperCase();
    this.versionEl.textContent = 'v' + this.version;
    this._render();
  }

  _sourceText() {
    if (typeof this.content === 'string') return this.content;
    if (this.content && typeof this.content === 'object') {
      return String(this.content.body ?? '');
    }
    return '';
  }

  _downloadName() {
    const base = slugFilename(this.title, this.id);
    if (this.type === 'code') {
      const lang = String(this.language || '').trim().toLowerCase();
      const ext = lang || 'txt';
      return `${base}.${ext}`;
    }
    return `${base}.${TYPE_EXT[this.type] || 'txt'}`;
  }

  async copySource() {
    const text = this._sourceText();
    const btn = this.el.querySelector('[data-aw-copy]');
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        btn.title = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.title = 'Copy source';
          btn.classList.remove('copied');
        }, 1600);
      }
      if (typeof showToast === 'function') showToast('Copied Markdown source');
    } catch (err) {
      console.warn('[higgins/artifact] clipboard write failed', err);
      if (typeof showToast === 'function') showToast('Copy failed');
    }
  }

  downloadSource() {
    if ((this.type === 'docx' || this.type === 'pptx') && this.blobUrl) {
      const a = document.createElement('a');
      a.href = this.blobUrl;
      a.download = this._downloadName();
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const text = this._sourceText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this._downloadName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  _render() {
    renderArtifact(this.bodyEl, this.type, {
      content: this.content,
      language: this.language,
      blobUrl: this.blobUrl,
      slug: this.id,
      version: this.version,
    });
  }

  close() {
    ArtifactWindow.registry.delete(this.id);
    forgetBox(this.id);
    this._removeChip();
    this.el.classList.remove('entered');
    setTimeout(() => this.el.remove(), 200);
  }

  minimize() {
    if (this.minimized) return;
    this.minimized = true;
    this.el.classList.add('minimized');
    this._addChip();
  }
  restore() {
    if (!this.minimized) return;
    this.minimized = false;
    this.el.classList.remove('minimized');
    this._removeChip();
    this.bringToFront();
  }
  toggleMaximize() {
    const maxed = this.el.classList.toggle('maximized');
    const btn = this.el.querySelector('[data-aw-max]');
    if (btn) {
      btn.innerHTML = maxed ? ICON.restore : ICON.max;
      btn.title = maxed ? 'Restore size' : 'Maximize';
    }
  }

  _addChip() {
    if (this.chipEl) return;
    const chip = document.createElement('div');
    chip.className = 'aw-chip';
    chip.dataset.artifactId = this.id;
    chip.innerHTML = `
      <span class="aw-chip-badge">${escapeHtml(TYPE_LABEL[this.type] || this.type.toUpperCase())}</span>
      <span class="aw-chip-title">${escapeHtml(this.title)}</span>
      <button class="aw-chip-close" title="Close artifact">${ICON.close}</button>
    `;
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.aw-chip-close')) return;
      this.restore();
    });
    chip.querySelector('.aw-chip-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    getDock().appendChild(chip);
    this.chipEl = chip;
  }
  _removeChip() {
    if (this.chipEl) {
      this.chipEl.remove();
      this.chipEl = null;
    }
  }

  bringToFront() {
    this.el.style.zIndex = String(++zCounter);
    for (const w of ArtifactWindow.registry.values()) {
      w.el.classList.toggle('focused', w === this);
    }
  }

  _saveBox() {
    writeBox(this.id, {
      left: this.el.offsetLeft,
      top: this.el.offsetTop,
      width: this.el.offsetWidth,
      height: this.el.offsetHeight,
    });
  }

  _wire() {
    this.el.addEventListener('mousedown', () => this.bringToFront(), true);
    this.el.querySelector('[data-aw-copy]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.copySource();
    });
    this.el.querySelector('[data-aw-download]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.downloadSource();
    });
    this.el.querySelector('[data-aw-min]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.minimize();
    });
    this.el.querySelector('[data-aw-max]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMaximize();
    });
    this.el.querySelector('[data-aw-close]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    // Double-click titlebar also toggles maximize (familiar OS pattern).
    this.el.querySelector('[data-aw-drag]').addEventListener('dblclick', (e) => {
      if (e.target.closest('.aw-btn')) return;
      this.toggleMaximize();
    });

    // Selecting the rendered preview copies HTML; put the Markdown (or
    // other source) on the clipboard instead so a .md reader keeps syntax.
    this.bodyEl.addEventListener('copy', (e) => {
      const raw = this._sourceText();
      if (!raw) return;
      e.preventDefault();
      if (e.clipboardData) e.clipboardData.setData('text/plain', raw);
      else if (navigator.clipboard) navigator.clipboard.writeText(raw);
    });

    // Drag from titlebar. Layer starts below the site nav, so y=0 is already clear.
    const titlebar = this.el.querySelector('[data-aw-drag]');
    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.aw-btn')) return;
      const startX = e.clientX, startY = e.clientY;
      const startLeft = this.el.offsetLeft, startTop = this.el.offsetTop;
      const onMove = (ev) => {
        this.el.style.left = (startLeft + ev.clientX - startX) + 'px';
        this.el.style.top = Math.max(0, startTop + ev.clientY - startY) + 'px';
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        this._saveBox();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });

    // Resize
    const setupResize = (handleSel, dirs) => {
      const handle = this.el.querySelector(handleSel);
      if (!handle) return;
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const startX = e.clientX, startY = e.clientY;
        const startW = this.el.offsetWidth, startH = this.el.offsetHeight;
        const onMove = (ev) => {
          if (dirs.includes('x')) this.el.style.width = Math.max(280, startW + ev.clientX - startX) + 'px';
          if (dirs.includes('y')) this.el.style.height = Math.max(200, startH + ev.clientY - startY) + 'px';
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          this._saveBox();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        e.preventDefault();
      });
    };
    setupResize('.aw-resize.right', ['x']);
    setupResize('.aw-resize.bottom', ['y']);
    setupResize('.aw-resize.corner', ['x', 'y']);
  }
}
