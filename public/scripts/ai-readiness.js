/**
 * AI Readiness Assessment — client controller for ai.jbherrera.com.
 *
 * This page has no assessment logic of its own. The question script, scoring
 * rubric, and pricing catalog live in exactly one place: synergi-website's
 * lib/assessment/. This file calls that repo's already-live production API
 * directly from the browser (cross-origin) and owns presentation only.
 *
 * Ported from synergi-website/js/assessment.js — same state machine, same
 * SSE envelope reader, same radar math. Markup/CSS are this repo's own
 * (public/styles/base.css tokens), not synergi-website's assessment.css.
 *
 * New in this repo: Path B, restoring a report from a previously downloaded
 * PDF via this repo's own /api/assessment-import (same-origin, built
 * separately). Path A (fresh assessment) and Path B (import) are rendered by
 * the exact same functions below — renderReport() and everything it calls
 * are pure functions of a report-shaped object, and never branch on where
 * that object came from. See docs/ai-readiness-assessment-technical.md.
 */
(function () {
  'use strict';

  var root = document.getElementById('ha');
  if (!root) return;

  // Base URL for synergi-website's assessment API. Not an env var — this is a
  // public client-side fetch target. To test against a synergi-website
  // preview deployment instead of production, temporarily swap this for the
  // preview URL (e.g. 'https://synergi-website-git-<branch>.vercel.app').
  var SYNERGI_API_BASE = 'https://synergiai.io';
  var LEAD_SOURCE = 'ai-readiness-assessment-ai-tools';

  var TOTAL = 18;
  var STORE_KEY = 'aitools.assessment.v1';
  var RESUME_MAX_AGE = 2 * 60 * 60 * 1000;
  var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

  var el = {
    intro: root.querySelector('[data-ha="intro"]'),
    start: root.querySelector('[data-ha="start"]'),
    upload: root.querySelector('[data-ha="upload"]'),
    uploadStatus: root.querySelector('[data-ha="uploadStatus"]'),
    panel: root.querySelector('[data-ha="panel"]'),
    log: root.querySelector('[data-ha="log"]'),
    replies: root.querySelector('[data-ha="replies"]'),
    form: root.querySelector('[data-ha="compose"]'),
    input: root.querySelector('[data-ha="input"]'),
    send: root.querySelector('[data-ha="send"]'),
    progress: root.querySelector('[data-ha="progress"]'),
    bar: root.querySelector('[data-ha="bar"]'),
    pills: root.querySelectorAll('[data-ha-pill]'),
    report: root.querySelector('[data-ha="report"]'),
    error: root.querySelector('[data-ha="error"]'),
    reportHead: root.querySelector('[data-ha="reportHead"]'),
    reportOrg: root.querySelector('[data-ha="reportOrg"]'),
    reportDate: root.querySelector('[data-ha="reportDate"]'),
    reportIntro: root.querySelector('[data-ha="reportIntro"]'),
    restoredNote: root.querySelector('[data-ha="restoredNote"]'),
    radar: root.querySelector('[data-ha="radar"]'),
    stageName: root.querySelector('[data-ha="stageName"]'),
    scoreNum: root.querySelector('[data-ha="scoreNum"]'),
    headline: root.querySelector('[data-ha="headline"]'),
    areas: root.querySelector('[data-ha="areas"]'),
    gate: root.querySelector('[data-ha="gate"]'),
    peek: root.querySelector('[data-ha="peek"]'),
    gateForm: root.querySelector('[data-ha="gateForm"]'),
    email: root.querySelector('[data-ha="email"]'),
    company: root.querySelector('[data-ha="company"]'),
    steps: root.querySelector('[data-ha="steps"]'),
    stepList: root.querySelector('[data-ha="stepList"]'),
    projects: root.querySelector('[data-ha="projects"]'),
    projectList: root.querySelector('[data-ha="projectList"]'),
    upskill: root.querySelector('[data-ha="upskill"]'),
    upskillPhilosophy: root.querySelector('[data-ha="upskillPhilosophy"]'),
    upskillTracks: root.querySelector('[data-ha="upskillTracks"]'),
    finalActions: root.querySelector('[data-ha="finalActions"]')
  };

  var state = {
    messages: [],
    questionIndex: 0,
    busy: false,
    sealed: null,
    result: null,       // public slice, once scored
    company: '',
    stickToBottom: true
  };

  // ---------------------------------------------------------------- utilities

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showError(msg) {
    if (!el.error) return;
    el.error.textContent = msg;
    el.error.hidden = false;
  }

  function clearError() {
    if (el.error) el.error.hidden = true;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return ''; }
  }

  function scrollDown() {
    if (state.stickToBottom && el.log) el.log.scrollTop = el.log.scrollHeight;
  }

  /**
   * Height of the sticky navbar, published as a CSS variable. Measured
   * rather than trusted as a constant: base.css defines --nav-height as a
   * fixed token today, but a future navbar tweak (e.g. a scrolled-state
   * height change, as synergi-website's has) would silently desync a
   * hardcoded number here. Cheap to measure, so just measure it.
   */
  function syncNavHeight() {
    var nav = document.querySelector('.navbar');
    var h = nav ? Math.round(nav.getBoundingClientRect().height) : 56;
    document.documentElement.style.setProperty('--ha-nav-h', h + 'px');
    return h;
  }

  syncNavHeight();
  window.addEventListener('resize', syncNavHeight);

  /**
   * Put a node's top edge just under the navbar, instantly.
   *
   * base.css sets `html { scroll-behavior: smooth }` globally, so a bare
   * `scrollTop = y` (or scrollIntoView) animates — and a second call before
   * that animation finishes silently cancels the first. Forcing
   * scroll-behavior to 'auto' for the duration of the jump is the reliable
   * form; a deliberate instant reposition reads fine without the animation.
   */
  function anchorToTop(node) {
    if (!node) return;
    var se = document.scrollingElement || document.documentElement;
    var y = node.getBoundingClientRect().top + se.scrollTop - syncNavHeight() - 12;
    var prior = se.style.scrollBehavior;
    se.style.scrollBehavior = 'auto';
    se.scrollTop = Math.max(0, y);
    se.style.scrollBehavior = prior;
  }

  if (el.log) {
    el.log.addEventListener('scroll', function () {
      var atBottom = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 48;
      state.stickToBottom = atBottom;
    });
  }

  // ----------------------------------------------------------------- rendering (chat)

  function addMessage(role, text) {
    var div = document.createElement('div');
    div.className = 'ha-msg ha-msg-' + (role === 'user' ? 'user' : 'bot');
    div.textContent = text;
    el.log.appendChild(div);
    scrollDown();
    return div;
  }

  function addDivider(label) {
    var d = document.createElement('div');
    d.className = 'ha-divider';
    d.textContent = label;
    el.log.appendChild(d);
    scrollDown();
  }

  function addTyping() {
    var w = document.createElement('div');
    w.className = 'ha-msg ha-msg-bot';
    w.innerHTML = '<span class="ha-typing"><i></i><i></i><i></i></span>';
    el.log.appendChild(w);
    scrollDown();
    return w;
  }

  function setProgress(index, axisLabel) {
    var shown = Math.min(index + 1, TOTAL);
    el.progress.textContent = 'Question ' + shown + ' of ' + TOTAL +
      (axisLabel ? ' · ' + axisLabel : '');
    el.bar.style.width = (index / TOTAL) * 100 + '%';

    var current = Math.floor(index / 3);
    Array.prototype.forEach.call(el.pills, function (p, i) {
      p.classList.toggle('is-done', i < current);
      p.classList.toggle('is-active', i === current && index < TOTAL);
    });
  }

  function renderReplies(options) {
    el.replies.innerHTML = '';
    if (!options || !options.length) return;
    options.forEach(function (opt) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ha-reply';
      b.textContent = opt;
      b.addEventListener('click', function () { submit(opt); });
      el.replies.appendChild(b);
    });
  }

  function lockInput(locked) {
    state.busy = locked;
    el.input.disabled = locked;
    el.send.disabled = locked;
    Array.prototype.forEach.call(el.replies.querySelectorAll('button'), function (b) {
      b.disabled = locked;
    });
  }

  // ------------------------------------------------------------------ persist

  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), messages: state.messages }));
    } catch (e) { /* private mode, quota — not worth failing the run over */ }
  }

  function loadSaved() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || Date.now() - data.at > RESUME_MAX_AGE) return null;
      if (!Array.isArray(data.messages) || !data.messages.length) return null;
      return data;
    } catch (e) { return null; }
  }

  function clearSaved() {
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  // ----------------------------------------------------------------- the turn

  function submit(text) {
    var value = String(text || '').trim();
    if (!value || state.busy) return;
    clearError();
    addMessage('user', value);
    state.messages.push({ role: 'user', content: value });
    el.input.value = '';
    save();
    turn();
  }

  function turn() {
    lockInput(true);
    renderReplies([]);
    var typing = addTyping();
    var bubble = null;
    var buffered = '';

    fetch(SYNERGI_API_BASE + '/api/assessment-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.messages })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(
            function (j) { throw new Error(j.error || 'Request failed'); },
            function () { throw new Error('Request failed'); }
          );
        }
        return readStream(res, function (evt) {
          if (evt.type === 'meta') {
            if (typing && typing.parentNode && evt.axisLabel &&
                evt.questionIndex % 3 === 0 && evt.questionIndex > 0) {
              el.log.insertBefore(
                Object.assign(document.createElement('div'), {
                  className: 'ha-divider', textContent: evt.axisLabel
                }),
                typing
              );
            }
            state.questionIndex = evt.questionIndex;
            setProgress(evt.questionIndex, evt.axisLabel);
          } else if (evt.type === 'delta') {
            if (typing) { typing.remove(); typing = null; }
            if (!bubble) bubble = addMessage('bot', '');
            buffered += evt.text;
            bubble.textContent = buffered;
            scrollDown();
          } else if (evt.type === 'replies') {
            renderReplies(evt.options);
          } else if (evt.type === 'failed') {
            throw new Error(evt.message);
          } else if (evt.type === 'done') {
            if (buffered) state.messages.push({ role: 'assistant', content: buffered });
            save();
            if (evt.complete) finish();
          }
        });
      })
      .catch(function (err) {
        if (typing && typing.parentNode) typing.remove();
        showError(err.message || 'Something went wrong. Try again.');
      })
      .finally(function () {
        if (typing && typing.parentNode) typing.remove();
        lockInput(false);
      });
  }

  /** Read our own SSE envelope — assessment-chat's event types only. */
  function readStream(res, onEvent) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';

    return (function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) return;
        buf += decoder.decode(chunk.value, { stream: true });
        var parts = buf.split('\n\n');
        buf = parts.pop();
        parts.forEach(function (part) {
          var line = part.trim();
          if (line.indexOf('data:') !== 0) return;
          try { onEvent(JSON.parse(line.slice(5).trim())); } catch (e) {}
        });
        return pump();
      });
    })();
  }

  // ------------------------------------------------------------------ scoring

  function finish() {
    setProgress(TOTAL, null);
    el.progress.textContent = 'Assessment complete';
    el.bar.style.width = '100%';
    renderReplies([]);
    el.form.hidden = true;

    var typing = addTyping();

    var stages = [
      'Reading back through your answers…',
      'Scoring the six areas…',
      'Working out what to do first…',
      'Mapping your team’s upskilling plan…',
      'Matching AI projects to what you told us…',
      'Writing your report…'
    ];
    var stageEl = document.createElement('p');
    stageEl.className = 'ha-scoring-note';
    stageEl.textContent = stages[0];
    if (typing.parentNode) typing.parentNode.insertBefore(stageEl, typing.nextSibling);
    var si = 0;
    var ticker = setInterval(function () {
      si += 1;
      if (si >= stages.length) { clearInterval(ticker); return; }
      stageEl.textContent = stages[si];
    }, 9000);
    function stopTicker() {
      clearInterval(ticker);
      if (stageEl.parentNode) stageEl.remove();
    }

    fetch(SYNERGI_API_BASE + '/api/assessment-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.messages })
    })
      .then(function (res) {
        return res.json().then(function (j) {
          if (!res.ok) throw new Error(j.error || 'Scoring failed');
          return j;
        });
      })
      .then(function (data) {
        stopTicker();
        typing.remove();
        state.sealed = data.sealed;
        state.result = data.public;
        clearSaved();
        renderReport(publicToReport(data.public), { restored: false });
      })
      .catch(function (err) {
        stopTicker();
        typing.remove();
        showError(err.message || 'We could not score that. Please try again.');
      });
  }

  // ------------------------------------------------------- shape normalisation
  //
  // Everything below this point renders exactly one shape: a "report" object
  // with overall/stage/headline/axes, and OPTIONALLY prioritySequence /
  // upskilling / suggestedProjects when the visitor has earned (or already
  // holds) the full report. Path A supplies that shape in two stages —
  // publicToReport() right after scoring, then a merged version once the
  // email gate unlocks fullSlice(). Path B (PDF import) supplies the whole
  // thing in one call, already shaped this way by /api/assessment-import.
  // renderReport() and everything it calls never branches on which path
  // produced the object it was given.

  /** Public slice (score time) → the common report shape, full fields empty. */
  function publicToReport(pub) {
    return {
      overall: pub.overall,
      stage: pub.stage,
      headline: pub.headline,
      axes: (pub.axes || []).map(function (a) {
        return { key: a.key, label: a.label, score: a.score, verdict: a.verdict, subscores: [], findings: [], recommendations: [] };
      }),
      lockedCounts: pub.lockedCounts,
      upskillingTeaser: pub.upskillingTeaser
    };
  }

  /**
   * Merge the public axis slice (has `verdict`) with the gated one (has
   * findings/recommendations/subscores) into one axis object per key. Ported
   * from synergi-website's assessment.js mergeAxes() — neither slice alone
   * is the full axis.
   */
  function mergeAxes(publicAxes, fullAxes) {
    var byKey = {};
    (fullAxes || []).forEach(function (a) { byKey[a.key] = a; });
    return (publicAxes || []).map(function (p) {
      var f = byKey[p.key] || {};
      return {
        key: p.key,
        label: p.label,
        score: p.score,
        verdict: p.verdict,
        subscores: f.subscores || [],
        findings: f.findings || [],
        recommendations: f.recommendations || []
      };
    });
  }

  function isFullReport(report) {
    return !!(report.prioritySequence && report.prioritySequence.length);
  }

  // ------------------------------------------------------------------- report
  //
  // The single renderer. Called after scoring (public-only), after the gate
  // unlocks (merged full), and after a PDF import (full, one shot). Draws
  // whatever the object has; shows the gate only when full data is absent.

  function renderReport(report, opts) {
    opts = opts || {};
    el.report.hidden = false;
    requestAnimationFrame(function () { anchorToTop(el.report); });

    if (report.company) {
      el.reportOrg.textContent = report.company;
      el.reportHead.hidden = false;
    } else {
      el.reportHead.hidden = true;
    }
    el.reportDate.textContent = report.generatedAt ? 'Generated ' + formatDate(report.generatedAt) : '';

    if (opts.restored) {
      el.restoredNote.hidden = false;
      el.restoredNote.textContent = 'Restored from a report generated on ' +
        (report.generatedAt ? formatDate(report.generatedAt) : 'a previous visit') +
        '. Pricing reflects that date — worth double-checking current pricing before assuming it still holds.';
    } else {
      el.restoredNote.hidden = true;
    }

    el.stageName.innerHTML = 'Stage ' + report.stage.number + ': <em>' + esc(report.stage.name) + '</em>';
    el.scoreNum.textContent = report.overall;
    el.headline.textContent = report.headline || '';

    drawRadar(report.axes);
    renderAreaCards(report.axes);

    var full = isFullReport(report);
    el.reportIntro.hidden = !full;
    el.gate.hidden = full;

    if (!full) {
      renderPeek(report);
      el.steps.hidden = true;
      el.projects.hidden = true;
      el.upskill.hidden = true;
      el.finalActions.hidden = true;
    } else {
      renderSteps(report.prioritySequence);
      renderProjects(report.suggestedProjects);
      renderUpskilling(report.upskilling);
      el.finalActions.hidden = false;
    }

    el.report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAreaCards(axes) {
    var wrap = el.areas;
    wrap.innerHTML = '';
    axes.forEach(function (a) {
      var card = document.createElement('div');
      card.className = 'ha-area';
      card.setAttribute('data-axis', a.key);
      var html =
        '<div class="ha-area-top">' +
          '<span class="ha-area-name">' + esc(a.label) + ' <em>Section</em></span>' +
          '<span class="ha-area-score">' +
            '<span class="ha-area-score-label">Section Score:</span>' +
            '<span class="ha-area-score-num">' + a.score + '</span>' +
          '</span>' +
        '</div>' +
        '<div class="ha-meter"><div class="ha-meter-fill"></div></div>' +
        '<p class="ha-area-verdict">' + esc(a.verdict || '') + '</p>';

      if ((a.findings && a.findings.length) || (a.recommendations && a.recommendations.length)) {
        html += '<div class="ha-area-detail">';
        if (a.findings && a.findings.length) {
          html += '<h5>What we saw</h5><ul>' +
            a.findings.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
        }
        if (a.recommendations && a.recommendations.length) {
          html += '<h5>What to do</h5><ul>' +
            a.recommendations.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
        }
        html += '</div>';
      }

      card.innerHTML = html;
      wrap.appendChild(card);
    });

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        axes.forEach(function (a, i) {
          var fill = wrap.children[i] && wrap.children[i].querySelector('.ha-meter-fill');
          if (fill) fill.style.width = a.score + '%';
        });
      });
    });
  }

  function renderPeek(report) {
    if (!el.peek) return;
    var counts = report.lockedCounts || {};
    var bits = [
      'Your weakest area is ' + weakest(report.axes) + '. ' +
        (counts.findings || 0) + ' specific findings and a ' +
        (counts.actions || 0) + '-step sequence are ready — starting with what to do in the next 30 days, and why that order matters more than the list itself.'
    ];
    if (report.upskillingTeaser) bits.push(report.upskillingTeaser);
    if (counts.projects) {
      bits.push(counts.projects + ' suggested AI project' + (counts.projects === 1 ? '' : 's') +
        ', each with a recommended plan and rough investment, are waiting too…');
    }
    el.peek.textContent = bits.join(' ');
  }

  function weakest(axes) {
    return axes.reduce(function (lo, a) { return a.score < lo.score ? a : lo; }, axes[0]).label;
  }

  function renderSteps(steps) {
    if (!el.steps || !el.stepList) return;
    if (!steps || !steps.length) { el.steps.hidden = true; return; }
    el.stepList.innerHTML = '';
    steps.forEach(function (p, i) {
      var row = document.createElement('div');
      row.className = 'ha-step';
      row.innerHTML =
        '<div class="ha-step-num">' + (i + 1) + '</div>' +
        '<div>' +
          '<div class="ha-step-when">' + esc(p.horizonLabel) + ' · ' + esc(p.axisLabel) + '</div>' +
          '<div class="ha-step-what">' + esc(p.action) + '</div>' +
          '<div class="ha-step-why">' + esc(p.whyNow) + '</div>' +
        '</div>';
      el.stepList.appendChild(row);
    });
    el.steps.hidden = false;
  }

  function planPriceLine(plan, addon) {
    var line = plan ? esc(plan.name) + ' — ' + esc(plan.priceLabel) : '';
    if (addon) line += ' + ' + esc(addon.name) + ' (' + esc(addon.priceLabel) + ')';
    return line;
  }

  function renderProjects(projects) {
    if (!el.projects || !el.projectList) return;
    if (!projects || !projects.length) { el.projects.hidden = true; return; }
    el.projectList.innerHTML = '';
    projects.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'ha-project';
      card.innerHTML =
        '<div class="ha-project-top">' +
          '<span class="ha-project-name">' + esc(p.name) + '</span>' +
          '<span class="ha-project-when">' + esc(p.horizonLabel) + '</span>' +
        '</div>' +
        '<p class="ha-project-line"><strong>Problem:</strong> ' + esc(p.problem) + '</p>' +
        '<p class="ha-project-line"><strong>Approach:</strong> ' + esc(p.approach) + '</p>' +
        '<p class="ha-project-line"><strong>Impact:</strong> ' + esc(p.impact) + '</p>' +
        '<p class="ha-project-plan">' + planPriceLine(p.plan, p.addon) + '</p>' +
        '<p class="ha-project-why">' + esc(p.rationale) + '</p>';
      el.projectList.appendChild(card);
    });
    el.projects.hidden = false;
  }

  function renderUpskilling(upskilling) {
    if (!el.upskill) return;
    if (!upskilling || !((upskilling.tracks && upskilling.tracks.length) || upskilling.philosophy)) {
      el.upskill.hidden = true;
      return;
    }
    if (el.upskillPhilosophy) el.upskillPhilosophy.textContent = upskilling.philosophy || '';
    if (el.upskillTracks) {
      el.upskillTracks.innerHTML = '';
      (upskilling.tracks || []).forEach(function (t) {
        var card = document.createElement('div');
        card.className = 'ha-track';
        card.innerHTML =
          '<div class="ha-track-role">' + esc(t.role) + '</div>' +
          '<p class="ha-track-focus">' + esc(t.focus) + '</p>' +
          (t.modules && t.modules.length
            ? '<ul class="ha-track-modules">' +
                t.modules.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') +
              '</ul>'
            : '') +
          '<p class="ha-track-first"><strong>First step:</strong> ' + esc(t.firstStep) + '</p>';
        el.upskillTracks.appendChild(card);
      });
    }
    el.upskill.hidden = false;
  }

  // -------------------------------------------------------------------- radar

  /**
   * Six-axis radar, drawn by hand — a chart library would render to canvas,
   * which is often blank in print pipelines; inline SVG prints as vector.
   * Ported near-verbatim from synergi-website/js/assessment.js.
   */
  function drawRadar(axes) {
    var svg = el.radar;
    if (!svg) return;

    var SIZE = 400, CX = 200, CY = 196, R = 104;
    var n = axes.length;
    var ns = 'http://www.w3.org/2000/svg';

    function pt(i, ratio) {
      var angle = -Math.PI / 2 + i * ((Math.PI * 2) / n);
      return { x: CX + R * ratio * Math.cos(angle), y: CY + R * ratio * Math.sin(angle) };
    }

    function ring(ratio) {
      var p = [];
      for (var i = 0; i < n; i++) { var q = pt(i, ratio); p.push(q.x.toFixed(1) + ',' + q.y.toFixed(1)); }
      return p.join(' ');
    }

    svg.setAttribute('viewBox', '0 0 ' + SIZE + ' ' + SIZE);
    svg.setAttribute('role', 'img');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.innerHTML = '';

    var title = document.createElementNS(ns, 'title');
    title.textContent = 'AI readiness by area: ' +
      axes.map(function (a) { return a.label + ' ' + a.score + ' out of 100'; }).join(', ');
    svg.appendChild(title);

    var defs = document.createElementNS(ns, 'defs');
    defs.innerHTML =
      '<linearGradient id="haRadarFill" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#77bde0" stop-opacity="0.55"/>' +
      '<stop offset="100%" stop-color="#b78bd3" stop-opacity="0.55"/>' +
      '</linearGradient>';
    svg.appendChild(defs);

    [0.25, 0.5, 0.75, 1].forEach(function (ratio) {
      var g = document.createElementNS(ns, 'polygon');
      g.setAttribute('points', ring(ratio));
      g.setAttribute('fill', 'none');
      g.setAttribute('stroke', '#e5e7eb');
      g.setAttribute('stroke-width', '1');
      svg.appendChild(g);
    });

    for (var i = 0; i < n; i++) {
      var edge = pt(i, 1);
      var spoke = document.createElementNS(ns, 'line');
      spoke.setAttribute('x1', CX); spoke.setAttribute('y1', CY);
      spoke.setAttribute('x2', edge.x.toFixed(1)); spoke.setAttribute('y2', edge.y.toFixed(1));
      spoke.setAttribute('stroke', '#e5e7eb');
      spoke.setAttribute('stroke-width', '1');
      svg.appendChild(spoke);
    }

    var poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('fill', 'url(#haRadarFill)');
    poly.setAttribute('stroke', '#4a9bc7');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('points', ring(0.001));
    svg.appendChild(poly);

    axes.forEach(function (a, i) {
      var p = pt(i, a.score / 100);
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', p.x.toFixed(1)); dot.setAttribute('cy', p.y.toFixed(1));
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', '#4a9bc7');
      svg.appendChild(dot);

      var lp = pt(i, 1.34);
      var anchor = lp.x > CX + 6 ? 'start' : (lp.x < CX - 6 ? 'end' : 'middle');
      var lines = splitLabel(a.label).concat([String(a.score)]);
      var LH = 13.5;

      var top = lp.y < CY - R * 0.8;
      var bottom = lp.y > CY + R * 0.8;
      var y0 = top ? lp.y - (lines.length - 1) * LH : (bottom ? lp.y : lp.y - ((lines.length - 1) * LH) / 2);

      var label = document.createElementNS(ns, 'text');
      label.setAttribute('text-anchor', anchor);
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('font-family', "'Roboto Condensed', sans-serif");
      label.setAttribute('fill', '#374151');
      label.setAttribute('font-size', '12.5');

      lines.forEach(function (line, li) {
        var tspan = document.createElementNS(ns, 'tspan');
        tspan.setAttribute('x', lp.x.toFixed(1));
        tspan.setAttribute('y', (y0 + li * LH).toFixed(1));
        if (li === lines.length - 1) {
          tspan.setAttribute('font-size', '14');
          tspan.setAttribute('font-weight', '700');
          tspan.setAttribute('fill', '#111827');
        }
        tspan.textContent = line;
        label.appendChild(tspan);
      });
      svg.appendChild(label);
    });

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      poly.setAttribute('points', axes.map(function (a, i) {
        var p = pt(i, a.score / 100); return p.x.toFixed(1) + ',' + p.y.toFixed(1);
      }).join(' '));
      return;
    }

    var start = null, DUR = 900;
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / DUR);
      var e = 1 - Math.pow(1 - t, 3);
      poly.setAttribute('points', axes.map(function (a, i) {
        var p = pt(i, (a.score / 100) * e);
        return p.x.toFixed(1) + ',' + p.y.toFixed(1);
      }).join(' '));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /** Break a long axis label across two lines, favouring the ampersand. */
  function splitLabel(label) {
    if (label.length <= 16) return [label];
    var amp = label.indexOf(' & ');
    if (amp > 0) return [label.slice(0, amp), label.slice(amp + 1)];
    var words = label.split(' ');
    if (words.length < 2) return [label];
    var half = Math.ceil(words.length / 2);
    return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
  }

  // --------------------------------------------------------------- email gate

  if (el.gateForm) {
    el.gateForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = el.email.value.trim();
      var company = el.company;
      var btn = el.gateForm.querySelector('button');
      if (!email) return;

      btn.disabled = true;
      var was = btn.textContent;
      btn.textContent = 'Unlocking…';
      clearError();

      fetch(SYNERGI_API_BASE + '/api/assessment-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sealed: state.sealed,
          email: email,
          company: company ? company.value.trim() : '',
          source: LEAD_SOURCE
        })
      })
        .then(function (res) {
          return res.json().then(function (j) {
            if (!res.ok) throw new Error(j.error || 'Could not unlock the report');
            return j;
          });
        })
        .then(function (data) {
          state.company = company ? company.value.trim() : '';
          var combined = {
            overall: state.result.overall,
            stage: state.result.stage,
            headline: state.result.headline,
            company: state.company,
            generatedAt: new Date().toISOString(),
            axes: mergeAxes(state.result.axes, data.report.axes),
            prioritySequence: data.report.prioritySequence,
            upskilling: data.report.upskilling,
            suggestedProjects: data.report.suggestedProjects
          };
          renderReport(combined, { restored: false });
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = was;
          showError(err.message);
        });
    });
  }

  // ---------------------------------------------------------- Path B: import

  function setUploadStatus(msg, isError) {
    if (!el.uploadStatus) return;
    el.uploadStatus.textContent = msg || '';
    el.uploadStatus.classList.toggle('is-error', !!isError);
  }

  function handleImport(file) {
    clearError();
    setUploadStatus('');

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadStatus('That file is larger than 8MB — too big to be a report from this assessment.', true);
      return;
    }

    setUploadStatus('Reading ' + file.name + '…');
    var reader = new FileReader();

    reader.onload = function () {
      var dataUrl = String(reader.result || '');
      var comma = dataUrl.indexOf(',');
      var dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;

      setUploadStatus('Restoring your report…');

      // Same-origin — this endpoint lives in this repo, no CORS involved.
      fetch('/api/assessment-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, dataBase64: dataBase64 })
      })
        .then(function (res) {
          return res.json().then(function (j) { return { ok: res.ok, body: j }; },
            function () { return { ok: false, body: {} }; });
        })
        .then(function (result) {
          if (!result.ok) {
            var code = result.body && result.body.code;
            if (code === 'no-payload') {
              setUploadStatus("We couldn't find assessment data in this PDF. It may have been generated before this feature existed — you're welcome to retake the assessment.", true);
            } else {
              setUploadStatus((result.body && result.body.error) || 'Could not read that file.', true);
            }
            return;
          }
          setUploadStatus('Report restored.');
          el.intro.hidden = true;
          renderReport(result.body.report, { restored: true });
        })
        .catch(function () {
          setUploadStatus('Something went wrong reading that file. Please try again.', true);
        });
    };

    reader.onerror = function () {
      setUploadStatus('Could not read that file. Please try again.', true);
    };

    reader.readAsDataURL(file);
  }

  if (el.upload) {
    el.upload.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) handleImport(file);
      el.upload.value = '';
    });
  }

  // -------------------------------------------------------------------- boot

  function begin(resume) {
    el.intro.hidden = true;
    el.panel.hidden = false;
    clearError();
    anchorToTop(el.panel);

    if (resume) {
      resume.messages.forEach(function (m) {
        if (m.role === 'user') addMessage('user', m.content);
        else addMessage('bot', m.content);
      });
      state.messages = resume.messages.slice();
      state.questionIndex = state.messages.filter(function (m) { return m.role === 'assistant'; }).length;
      setProgress(state.questionIndex, null);
      if (state.messages[state.messages.length - 1].role === 'assistant') {
        state.messages.push({ role: 'user', content: 'Continue' });
      }
      turn();
      return;
    }

    state.messages = [{ role: 'user', content: "Let's begin." }];
    setProgress(0, null);
    turn();
  }

  if (el.start) {
    el.start.addEventListener('click', function () { begin(null); });
  }

  if (el.form) {
    el.form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit(el.input.value);
    });
  }

  // Offer to pick up an interrupted run rather than making them start over.
  var saved = loadSaved();
  if (saved) {
    var answered = saved.messages.filter(function (m) { return m.role === 'assistant'; }).length;
    if (answered > 0 && answered < TOTAL) {
      var note = document.createElement('div');
      note.className = 'ha-hint';
      note.style.marginTop = 'var(--space-4)';
      note.innerHTML = 'You have an assessment in progress — question ' + (answered + 1) +
        ' of ' + TOTAL + '. <button type="button" class="btn btn-ghost btn-sm" data-ha="resume">Pick up where you left off</button>';
      el.intro.appendChild(note);
      note.querySelector('[data-ha="resume"]').addEventListener('click', function () { begin(saved); });
    } else {
      clearSaved();
    }
  }
})();
