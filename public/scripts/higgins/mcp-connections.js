/* ============================================
   MCP CONNECTIONS — connector selectors + custom connector URLs
   --------------------------------------------
   Opened from the Navigate palette ("MCP Connections" module tile).
   Lets JB toggle which MCP connectors Higgins can reach, and configure
   a server URL for custom connectors. State is persisted to localStorage
   so it survives reloads. Standard (non-custom) connectors are managed
   in the claude.ai connectors UI; here we simply record which ones are on.
   ============================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'higgins.mcp.connections.v1';

  // Source of truth for the connector list. Mirrors the connectors shown in
  // the account's connectors panel. `custom: true` connectors expose a URL
  // field so JB can point Higgins at the right MCP server endpoint.
  var CONNECTORS = [
    { id: 'calendly',        name: 'Calendly',           custom: false, mono: 'C',  color: '#006bff' },
    { id: 'composio',        name: 'Composio',           custom: true,  mono: 'Co', color: '#6c47ff', placeholder: 'https://mcp.composio.dev/…' },
    { id: 'fathom',          name: 'Fathom',             custom: false, mono: 'F',  color: '#8b5cf6' },
    { id: 'github',          name: 'GitHub Integration', custom: false, mono: 'GH', color: '#24292f' },
    { id: 'github-mcp',      name: 'github MCP',          custom: true,  mono: 'G',  color: '#24292f', placeholder: 'https://api.githubcopilot.com/mcp/' },
    { id: 'gmail',           name: 'Gmail',              custom: false, mono: 'M',  color: '#ea4335' },
    { id: 'google-calendar', name: 'Google Calendar',    custom: false, mono: 'GC', color: '#1a73e8' },
    { id: 'google-drive',    name: 'Google Drive',       custom: false, mono: 'GD', color: '#1fa463' },
    { id: 'notion',          name: 'Notion',             custom: false, mono: 'N',  color: '#000000' },
    { id: 'open-brain',      name: 'Open Brain',         custom: true,  mono: 'O',  color: '#0ea5e9', placeholder: 'https://…/mcp' },
    { id: 'slack',           name: 'Slack',              custom: false, mono: 'S',  color: '#611f69' },
    { id: 'vercel',          name: 'Vercel',             custom: false, mono: 'V',  color: '#000000' }
  ];

  var state = {}; // { [id]: { enabled: bool, url: string } }

  function loadState() {
    state = {};
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') state = parsed;
      }
    } catch (err) {
      console.error('[higgins] MCP connections: failed to load state', err);
      state = {};
    }
    // Ensure every known connector has an entry.
    CONNECTORS.forEach(function (c) {
      if (!state[c.id] || typeof state[c.id] !== 'object') {
        state[c.id] = { enabled: false, url: '' };
      }
      if (typeof state[c.id].enabled !== 'boolean') state[c.id].enabled = false;
      if (typeof state[c.id].url !== 'string') state[c.id].url = '';
    });
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error('[higgins] MCP connections: failed to persist state', err);
    }
  }

  function isValidUrl(value) {
    if (!value) return false;
    try {
      var u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function connectedCount() {
    return CONNECTORS.filter(function (c) { return state[c.id] && state[c.id].enabled; }).length;
  }

  function updateFooter() {
    var info = document.getElementById('mcpFooterInfo');
    if (info) info.textContent = connectedCount() + ' of ' + CONNECTORS.length + ' connected';
  }

  function render() {
    var body = document.getElementById('mcpBody');
    if (!body) return;

    body.innerHTML = CONNECTORS.map(function (c) {
      var s = state[c.id] || { enabled: false, url: '' };
      var urlRow = '';
      if (c.custom) {
        var invalid = s.enabled && !isValidUrl(s.url);
        urlRow =
          '<div class="mcp-url-row' + (s.enabled ? ' visible' : '') + '" data-url-row="' + esc(c.id) + '">' +
            '<label class="mcp-url-label" for="mcp-url-' + esc(c.id) + '">Server URL</label>' +
            '<input type="url" spellcheck="false" autocomplete="off" ' +
              'class="mcp-url-input' + (invalid ? ' invalid' : '') + '" ' +
              'id="mcp-url-' + esc(c.id) + '" data-url-input="' + esc(c.id) + '" ' +
              'value="' + esc(s.url) + '" ' +
              'placeholder="' + esc(c.placeholder || 'https://…') + '">' +
          '</div>';
      }

      return (
        '<div class="mcp-row" data-conn="' + esc(c.id) + '">' +
          '<div class="mcp-row-main">' +
            '<span class="mcp-badge" style="background:' + esc(c.color) + '">' + esc(c.mono) + '</span>' +
            '<div class="mcp-row-text">' +
              '<div class="mcp-name">' + esc(c.name) + '</div>' +
              '<div class="mcp-tags">' +
                '<span class="mcp-tag">Web</span>' +
                (c.custom ? '<span class="mcp-tag mcp-tag-custom">Custom</span>' : '') +
              '</div>' +
            '</div>' +
            '<button type="button" role="switch" aria-checked="' + (s.enabled ? 'true' : 'false') + '" ' +
              'aria-label="Toggle ' + esc(c.name) + '" ' +
              'class="mcp-toggle' + (s.enabled ? ' on' : '') + '" data-toggle="' + esc(c.id) + '">' +
              '<span class="mcp-toggle-knob"></span>' +
            '</button>' +
          '</div>' +
          urlRow +
        '</div>'
      );
    }).join('');

    // Wire toggles.
    body.querySelectorAll('[data-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-toggle');
        state[id].enabled = !state[id].enabled;
        persist();
        // Update just this row's toggle + url-row visibility without a full re-render,
        // so an in-progress URL edit isn't blown away.
        btn.classList.toggle('on', state[id].enabled);
        btn.setAttribute('aria-checked', state[id].enabled ? 'true' : 'false');
        var urlRow = body.querySelector('[data-url-row="' + CSS.escape(id) + '"]');
        if (urlRow) urlRow.classList.toggle('visible', state[id].enabled);
        refreshValidity(id);
        updateFooter();
      });
    });

    // Wire custom URL inputs.
    body.querySelectorAll('[data-url-input]').forEach(function (input) {
      input.addEventListener('input', function () {
        var id = input.getAttribute('data-url-input');
        state[id].url = input.value.trim();
        persist();
        refreshValidity(id);
      });
    });

    updateFooter();
  }

  // Toggle the invalid styling for a custom connector's URL field.
  function refreshValidity(id) {
    var body = document.getElementById('mcpBody');
    if (!body) return;
    var input = body.querySelector('[data-url-input="' + CSS.escape(id) + '"]');
    if (!input) return;
    var s = state[id];
    var invalid = s.enabled && !isValidUrl(s.url);
    input.classList.toggle('invalid', invalid);
  }

  // ---- Public API (exposed on window for inline onclick handlers) ----

  window.openMcpConnections = function openMcpConnections() {
    loadState();
    var scrim = document.getElementById('mcpScrim');
    if (!scrim) return;
    render();
    scrim.classList.add('open');
  };

  window.closeMcpConnections = function closeMcpConnections(e) {
    if (e && e.target && !e.target.closest('.mcp-scrim')) return;
    var scrim = document.getElementById('mcpScrim');
    if (scrim) scrim.classList.remove('open');
  };

  window.saveMcpConnections = function saveMcpConnections() {
    // Validate: any enabled custom connector must have a valid URL.
    var missing = CONNECTORS.filter(function (c) {
      return c.custom && state[c.id].enabled && !isValidUrl(state[c.id].url);
    });
    persist();
    if (missing.length) {
      missing.forEach(function (c) { refreshValidity(c.id); });
      var names = missing.map(function (c) { return c.name; }).join(', ');
      if (typeof showToast === 'function') {
        showToast('Add a valid URL for: ' + names);
      }
      return;
    }
    if (typeof showToast === 'function') {
      showToast(connectedCount() + ' connector' + (connectedCount() === 1 ? '' : 's') + ' saved');
    }
    window.closeMcpConnections();
  };

  // Esc closes the modal.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var scrim = document.getElementById('mcpScrim');
      if (scrim && scrim.classList.contains('open')) {
        scrim.classList.remove('open');
      }
    }
  });
})();
