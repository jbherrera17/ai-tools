// ============================================
// HIGGINS BROWSER NOTIFICATIONS
// Fire when a team/workflow run finishes or stalls so JB sees it even if
// the Higgins tab is in the background. Permission is requested once, on
// Approve (a user gesture). Denied → silent fallback to in-page toasts.
// Never nag.
// ============================================
(function (global) {
  const TITLE_DONE = 'Higgins — team finished';
  const TITLE_STALL = 'Higgins';
  const BRIEF_MAX = 120;

  let iconUrl;          // string | '' (skip) | undefined (not yet checked)
  let iconChecked = false;

  function supported() {
    return typeof Notification !== 'undefined';
  }

  function pageIsForeground() {
    try {
      return document.visibilityState === 'visible' && document.hasFocus();
    } catch (_) {
      return true;
    }
  }

  function truncate(text, n) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 1)).trimEnd() + '\u2026';
  }

  function requestPermission() {
    if (!supported()) return Promise.resolve('denied');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    try {
      return Promise.resolve(Notification.requestPermission()).then(function (p) {
        return p || Notification.permission;
      }).catch(function () {
        return Notification.permission;
      });
    } catch (_) {
      return Promise.resolve(Notification.permission);
    }
  }

  function withIcon(cb) {
    if (iconChecked) { cb(iconUrl || undefined); return; }
    // Use the portrait PNG only if it actually exists. SVG is a poor
    // Notification icon in several browsers; skip rather than 404.
    const probe = new Image();
    probe.onload = function () {
      iconChecked = true;
      iconUrl = '/images/higgins.png';
      cb(iconUrl);
    };
    probe.onerror = function () {
      iconChecked = true;
      iconUrl = '';
      cb(undefined);
    };
    probe.src = '/images/higgins.png';
  }

  function show(title, body) {
    if (!supported()) return;
    if (Notification.permission !== 'granted') return;
    if (pageIsForeground()) return;
    withIcon(function (icon) {
      try {
        const opts = { body: body, tag: 'higgins-workflow' };
        if (icon) opts.icon = icon;
        const n = new Notification(title, opts);
        n.onclick = function () {
          try { global.focus(); } catch (_) {}
          try { window.focus(); } catch (_) {}
          try { n.close(); } catch (_) {}
        };
      } catch (err) {
        console.warn('[HigginsNotify] show failed', err);
      }
    });
  }

  function workflowFinished(args) {
    args = args || {};
    const brief = truncate(args.brief, BRIEF_MAX);
    const body = brief || 'Your Synergi team just finished working.';
    show(TITLE_DONE, body);
  }

  function workflowStalled(args) {
    args = args || {};
    const brief = truncate(args.brief, BRIEF_MAX);
    const lead = brief ? ('Team run stalled: ' + brief) : 'Team run stalled.';
    show(TITLE_STALL, lead + '\nOpen Higgins to retry.');
  }

  global.HigginsNotify = {
    requestPermission: requestPermission,
    workflowFinished: workflowFinished,
    workflowStalled: workflowStalled,
  };
})(window);
