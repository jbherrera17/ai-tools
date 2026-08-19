/* ============================================
   CHAT ATTACHMENTS — "+" button file upload for Higgins
   --------------------------------------------
   Lets JB attach images, PDFs, and text/CSV files to a chat turn. Files are
   uploaded to Vercel Blob via /api/upload; the returned URL is sent with the
   chat request, and the backend feeds the file to Claude (images/PDFs
   natively, text inlined). Images are downscaled client-side before upload to
   keep them well under the request-body limit and cheap for the model.

   Depends on globals from chat.js: authHeaders(), showToast(), toggleSend().
   Exposes window.triggerAttach() and window.HigginsAttachments.
   ============================================ */
(function () {
  'use strict';

  // Media types the backend accepts (mirrors api/lib/attachments.ts).
  var KIND_BY_TYPE = {
    'image/png': 'image', 'image/jpeg': 'image', 'image/gif': 'image', 'image/webp': 'image',
    'application/pdf': 'pdf',
    'text/plain': 'text', 'text/markdown': 'text', 'text/csv': 'text',
    'application/json': 'text', 'text/javascript': 'text', 'application/javascript': 'text',
    'text/html': 'text', 'text/css': 'text', 'text/x-python': 'text',
  };
  // Fallbacks for files the OS reports with an empty/odd MIME type, keyed by extension.
  var TYPE_BY_EXT = {
    md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', csv: 'text/csv',
    json: 'application/json', js: 'text/javascript', ts: 'text/plain', py: 'text/x-python',
    html: 'text/html', css: 'text/css', log: 'text/plain', yml: 'text/plain', yaml: 'text/plain',
  };

  var NON_IMAGE_MAX_BYTES = 3 * 1024 * 1024; // keeps base64 body under the platform limit
  var IMAGE_MAX_DIM = 1568;                  // Claude's optimal max image edge
  var MAX_ATTACHMENTS = 5;

  var pending = []; // { id, name, mediaType, kind, size, url, status }
  var seq = 0;

  function resolveMediaType(file) {
    var t = (file.type || '').toLowerCase();
    if (KIND_BY_TYPE[t]) return t;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    return TYPE_BY_EXT[ext] || t;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function humanSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function iconFor(kind) {
    if (kind === 'image') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
    if (kind === 'pdf') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
  }

  // Downscale an image File to a JPEG/PNG Blob within IMAGE_MAX_DIM. Falls back
  // to the original file if anything fails (still capped by the server).
  function maybeDownscaleImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || file.type === 'image/gif') { resolve(file); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, IMAGE_MAX_DIM / Math.max(w, h));
          if (scale >= 1 && file.size <= 1.5 * 1024 * 1024) { URL.revokeObjectURL(url); resolve(file); return; }
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          var outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            resolve(blob || file);
          }, outType, 0.85);
        } catch (e) { URL.revokeObjectURL(url); resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || '');
        resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
      };
      reader.onerror = function () { reject(reader.error || new Error('read failed')); };
      reader.readAsDataURL(blob);
    });
  }

  function headers() {
    return (typeof authHeaders === 'function') ? authHeaders() : { 'Content-Type': 'application/json' };
  }

  function toast(msg) { if (typeof showToast === 'function') showToast(msg); }

  function syncSendButton() { if (typeof toggleSend === 'function') toggleSend(); }

  async function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    for (var i = 0; i < files.length; i++) {
      if (pending.length >= MAX_ATTACHMENTS) { toast('Up to ' + MAX_ATTACHMENTS + ' files per message'); break; }
      var file = files[i];
      var mediaType = resolveMediaType(file);
      var kind = KIND_BY_TYPE[mediaType];
      if (!kind) { toast('Unsupported file: ' + file.name); continue; }
      if (kind !== 'image' && file.size > NON_IMAGE_MAX_BYTES) {
        toast(file.name + ' is too large (max ' + (NON_IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0) + 'MB)');
        continue;
      }
      var item = {
        id: 'att-' + (++seq),
        name: file.name || 'file',
        mediaType: mediaType,
        kind: kind,
        size: file.size,
        url: null,
        status: 'uploading',
      };
      pending.push(item);
      render();
      syncSendButton();
      uploadItem(item, file); // fire-and-forget; render updates on settle
    }
  }

  async function uploadItem(item, file) {
    try {
      var blob = await maybeDownscaleImage(file);
      var uploadType = (blob && blob.type && KIND_BY_TYPE[blob.type]) ? blob.type : item.mediaType;
      var dataBase64 = await toBase64(blob);
      var res = await fetch('/api/upload', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name: item.name, mediaType: uploadType, dataBase64: dataBase64 }),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.error || ('HTTP ' + res.status));
      }
      var data = await res.json();
      item.url = data.url;
      item.mediaType = data.mediaType || uploadType;
      item.kind = data.kind || item.kind;
      item.size = data.size || item.size;
      item.status = 'ready';
    } catch (e) {
      console.error('[higgins] attachment upload failed', e);
      item.status = 'error';
      item.error = e && e.message ? e.message : 'upload failed';
      toast('Upload failed: ' + item.name);
    }
    render();
    syncSendButton();
  }

  function removeAttachment(id) {
    pending = pending.filter(function (a) { return a.id !== id; });
    render();
    syncSendButton();
  }

  function render() {
    var row = document.getElementById('attachmentRow');
    if (!row) return;
    if (!pending.length) { row.hidden = true; row.innerHTML = ''; return; }
    row.hidden = false;
    row.innerHTML = pending.map(function (a) {
      var cls = 'attach-chip' + (a.status === 'error' ? ' error' : '') + (a.status === 'uploading' ? ' uploading' : '');
      var meta = a.status === 'uploading' ? 'Uploading…'
        : a.status === 'error' ? (a.error || 'Failed')
        : humanSize(a.size);
      return '<span class="' + cls + '" data-id="' + esc(a.id) + '">' +
        '<span class="attach-chip-icon">' + iconFor(a.kind) + '</span>' +
        '<span class="attach-chip-body">' +
          '<span class="attach-chip-name">' + esc(a.name) + '</span>' +
          '<span class="attach-chip-meta">' + esc(meta) + '</span>' +
        '</span>' +
        '<button type="button" class="attach-chip-remove" data-remove="' + esc(a.id) + '" title="Remove" aria-label="Remove ' + esc(a.name) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</span>';
    }).join('');
    row.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () { removeAttachment(btn.getAttribute('data-remove')); });
    });
  }

  // Render read-only chips (a sent user message, or replayed history) into a
  // message bubble element.
  function renderChipsInto(bubbleEl, items) {
    if (!bubbleEl || !Array.isArray(items) || !items.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'message-attachments';
    wrap.innerHTML = items.map(function (a) {
      var kind = a.kind || 'text';
      var inner =
        '<span class="attach-chip-icon">' + iconFor(kind) + '</span>' +
        '<span class="attach-chip-body"><span class="attach-chip-name">' + esc(a.name || 'file') + '</span></span>';
      return a.url
        ? '<a class="attach-chip static" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + inner + '</a>'
        : '<span class="attach-chip static">' + inner + '</span>';
    }).join('');
    bubbleEl.appendChild(wrap);
  }

  // ---- Public API ----
  window.triggerAttach = function triggerAttach() {
    var input = document.getElementById('higginsFileInput');
    if (input) input.click();
  };

  window.HigginsAttachments = {
    // Ready-to-send attachments (uploaded) as the chat body expects.
    getReady: function () {
      return pending
        .filter(function (a) { return a.status === 'ready' && a.url; })
        .map(function (a) { return { name: a.name, mediaType: a.mediaType, url: a.url, kind: a.kind }; });
    },
    hasPending: function () { return pending.length > 0; },
    hasReady: function () { return pending.some(function (a) { return a.status === 'ready' && a.url; }); },
    isUploading: function () { return pending.some(function (a) { return a.status === 'uploading'; }); },
    clear: function () { pending = []; render(); syncSendButton(); },
    renderChipsInto: renderChipsInto,
  };

  // Wire the hidden file input once the DOM is ready.
  function wire() {
    var input = document.getElementById('higginsFileInput');
    if (!input) return;
    input.addEventListener('change', function () {
      handleFiles(input.files);
      input.value = ''; // allow re-selecting the same file
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
