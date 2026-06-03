/**
 * AgentTrace Dashboard Frontend
 * Vanilla JS - fetches from /api/* and renders dark-themed UI
 */
(function () {
  'use strict';

  // State
  var state = {
    stats: null,
    runs: [],
    traces: [],
    selectedRunId: null,
    selectedTraceId: null,
    statusFilter: 'all',
    autoRefreshId: null,
  };

  // Utils
  function $(id) {
    return document.getElementById(id);
  }

  function formatLatency(ms) {
    if (ms == null) return '0ms';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  function formatCost(cost) {
    if (cost == null) return '$0.0000';
    return '$' + Number(cost).toFixed(4);
  }

  function formatPercent(rate) {
    if (rate == null) return '0%';
    return (Number(rate) * 100).toFixed(1) + '%';
  }

  function formatNumber(n) {
    if (n == null) return '0';
    return Number(n).toLocaleString();
  }

  function statusClass(status) {
    if (!status) return '';
    var s = String(status).toLowerCase();
    if (s === 'success') return 'success';
    if (s === 'failure' || s === 'error') return 'failure';
    if (s === 'running') return 'running';
    if (s === 'timeout') return 'timeout';
    return '';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Fetch wrapper
  async function fetchJSON(url) {
    var res = await fetch(url);
    if (!res.ok) {
      var msg = 'Request failed: ' + res.status;
      try {
        var j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  // Data loading
  async function loadStats() {
    var stats = await fetchJSON('/api/stats');
    state.stats = stats;
    renderStats(stats);
    return stats;
  }

  async function loadRuns() {
    var runs = await fetchJSON('/api/runs?limit=200');
    state.runs = Array.isArray(runs) ? runs : [];
    renderRuns();
    return state.runs;
  }

  async function loadTracesForRun(runId) {
    if (!runId) return [];
    var url = '/api/traces?runId=' + encodeURIComponent(runId) + '&limit=200';
    var traces = await fetchJSON(url);
    state.traces = Array.isArray(traces) ? traces : [];
    renderTraces();
    return state.traces;
  }

  async function loadTraceDetail(traceId) {
    if (!traceId) return null;
    try {
      var t = await fetchJSON('/api/traces/' + encodeURIComponent(traceId));
      return t;
    } catch (e) {
      // fall back to local list
      return (
        state.traces.find(function (tr) {
          return tr.id === traceId;
        }) || null
      );
    }
  }

  async function refreshAll(keepSelection) {
    try {
      await loadStats();
      await loadRuns();
      if (keepSelection && state.selectedRunId) {
        // reselect traces for current run
        await loadTracesForRun(state.selectedRunId);
        // reselect trace if any
        if (state.selectedTraceId) {
          var still = state.traces.find(function (t) {
            return t.id === state.selectedTraceId;
          });
          if (still) {
            renderTraceDetails(still);
          }
        }
      }
    } catch (err) {
      console.warn('[AgentTrace] refresh error', err);
    }
  }

  // Rendering
  function renderStats(stats) {
    if (!stats) return;
    var totalEl = $('total-runs');
    var rateEl = $('success-rate');
    var latEl = $('avg-latency');
    var costEl = $('total-cost');

    if (totalEl) totalEl.textContent = formatNumber(stats.totalRuns || 0);
    if (rateEl) rateEl.textContent = formatPercent(stats.successRate || 0);
    if (latEl) latEl.textContent = formatLatency(stats.avgLatencyMs || 0);
    if (costEl) costEl.textContent = formatCost(stats.totalCostUsd || 0);
  }

  function renderRuns() {
    var container = $('runs-list');
    if (!container) return;

    container.innerHTML = '';

    var filtered = state.runs;
    if (state.statusFilter && state.statusFilter !== 'all') {
      filtered = state.runs.filter(function (r) {
        return r.status === state.statusFilter;
      });
    }

    var countEl = $('runs-count');
    if (countEl)
      countEl.textContent = filtered.length + ' run' + (filtered.length === 1 ? '' : 's');

    if (!filtered.length) {
      var empty = el(
        'div',
        'empty',
        state.runs.length ? 'No runs match filter' : 'No runs yet. Start tracing!',
      );
      container.appendChild(empty);
      return;
    }

    filtered.forEach(function (run) {
      var item = el('div', 'run-item');
      item.dataset.runId = run.id;

      if (state.selectedRunId === run.id) {
        item.classList.add('selected');
      }

      // header
      var header = el('div', 'run-header');

      var badge = el('span', 'badge ' + statusClass(run.status), run.status);

      var title = el('span', 'run-title', run.name || run.id);

      header.appendChild(badge);
      header.appendChild(title);

      item.appendChild(header);

      // meta
      var meta = el('div', 'run-meta');

      var started = new Date(run.startedAt || Date.now());
      var timeStr = started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      meta.appendChild(el('span', 'meta-item', (run.traceCount || 0) + ' traces'));
      meta.appendChild(el('span', 'meta-item', formatLatency(run.totalLatencyMs || 0)));
      meta.appendChild(el('span', 'meta-item', formatCost(run.totalCostUsd || 0)));
      meta.appendChild(el('span', 'meta-item', timeStr));

      if (run.errorCount > 0) {
        meta.appendChild(el('span', 'meta-item', run.errorCount + ' errors'));
      }

      item.appendChild(meta);

      // click handler
      item.addEventListener('click', function () {
        selectRun(run.id, item);
      });

      container.appendChild(item);
    });
  }

  function selectRun(runId, clickedEl) {
    state.selectedRunId = runId;
    state.selectedTraceId = null;

    // update selected styles
    document.querySelectorAll('.run-item').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.runId === runId);
    });

    // show traces section
    var tracesSec = $('traces-section');
    var tracesList = $('traces-list');
    var nameEl = $('selected-run-name');

    if (tracesSec) tracesSec.style.display = '';
    if (tracesList) tracesList.innerHTML = '<div class="empty">Loading traces…</div>';

    var run = state.runs.find(function (r) {
      return r.id === runId;
    });
    if (nameEl) nameEl.textContent = run && run.name ? run.name : runId;

    // hide details when switching run
    var detailsSec = $('details-section');
    if (detailsSec) detailsSec.style.display = 'none';

    loadTracesForRun(runId).catch(function (e) {
      if (tracesList) tracesList.innerHTML = '<div class="empty">Failed to load traces</div>';
      console.error(e);
    });
  }

  function renderTraces() {
    var container = $('traces-list');
    var sec = $('traces-section');
    var countEl = $('traces-count');
    if (!container) return;

    container.innerHTML = '';

    if (countEl)
      countEl.textContent = state.traces.length + ' trace' + (state.traces.length === 1 ? '' : 's');

    if (!state.traces.length) {
      container.appendChild(el('div', 'empty', 'No traces for this run'));
      return;
    }

    state.traces.forEach(function (trace) {
      var item = el('div', 'trace-item');
      item.dataset.traceId = trace.id;

      if (state.selectedTraceId === trace.id) {
        item.classList.add('selected');
      }

      var header = el('div', 'trace-header');

      var badge = el('span', 'badge ' + statusClass(trace.status), trace.status);
      var name = el('span', 'trace-name', trace.name || 'trace');

      header.appendChild(badge);
      header.appendChild(name);

      item.appendChild(header);

      var meta = el('div', 'trace-meta');
      meta.textContent =
        formatLatency(trace.latencyMs || 0) +
        ' • ' +
        formatCost(trace.costUsd || 0) +
        ' • ' +
        (trace.tokens && trace.tokens.totalTokens ? trace.tokens.totalTokens + ' tokens' : '');
      item.appendChild(meta);

      // tool call summary
      if (trace.toolCalls && trace.toolCalls.length) {
        var tools = el(
          'div',
          'trace-tools',
          trace.toolCalls.length + ' tool call' + (trace.toolCalls.length > 1 ? 's' : ''),
        );
        tools.style.fontSize = '11px';
        tools.style.color = 'var(--text-muted)';
        item.appendChild(tools);
      }

      item.addEventListener('click', function () {
        selectTrace(trace.id, item, trace);
      });

      container.appendChild(item);
    });

    if (sec) sec.style.display = '';
  }

  function selectTrace(traceId, clickedEl, traceData) {
    state.selectedTraceId = traceId;

    document.querySelectorAll('.trace-item').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.traceId === traceId);
    });

    var detailsSec = $('details-section');
    if (detailsSec) detailsSec.style.display = '';

    if (traceData) {
      renderTraceDetails(traceData);
    } else {
      loadTraceDetail(traceId)
        .then(function (t) {
          if (t) renderTraceDetails(t);
        })
        .catch(function () {
          var det = $('trace-details');
          if (det) det.innerHTML = '<div class="empty">Failed to load trace details</div>';
        });
    }
  }

  function renderTraceDetails(trace) {
    var container = $('trace-details');
    if (!container) return;
    container.innerHTML = '';

    // header row
    var head = el('div', 'trace-header');
    head.appendChild(el('span', 'badge ' + statusClass(trace.status), trace.status));
    head.appendChild(el('span', 'trace-name', trace.name || trace.id));
    container.appendChild(head);

    // key metrics
    var metrics = el('div');
    var rows = [
      ['Latency', formatLatency(trace.latencyMs)],
      ['Cost', formatCost(trace.costUsd)],
      [
        'Tokens',
        (trace.tokens ? trace.tokens.totalTokens : 0) +
          ' (p:' +
          (trace.tokens ? trace.tokens.promptTokens : 0) +
          ' c:' +
          (trace.tokens ? trace.tokens.completionTokens : 0) +
          ')',
      ],
      ['Model', (trace.tokens && trace.tokens.model) || '—'],
      ['Created', trace.createdAt ? new Date(trace.createdAt).toLocaleString() : '—'],
    ];

    rows.forEach(function (r) {
      var row = el('div', 'detail-row');
      row.appendChild(el('span', 'key', r[0]));
      row.appendChild(el('span', 'value', String(r[1])));
      metrics.appendChild(row);
    });
    container.appendChild(metrics);

    // Tool calls
    if (trace.toolCalls && trace.toolCalls.length > 0) {
      container.appendChild(el('h4', '', 'Tool Calls'));
      trace.toolCalls.forEach(function (tc) {
        var tcEl = el('div', 'tool-call');

        var th = el('div', 'tool-header');
        th.appendChild(el('span', '', tc.name));
        th.appendChild(
          el('span', 'badge ' + (tc.success ? 'success' : 'failure'), tc.success ? 'ok' : 'fail'),
        );
        if (tc.latencyMs != null) th.appendChild(el('span', '', formatLatency(tc.latencyMs)));

        tcEl.appendChild(th);

        if (tc.input != null) {
          tcEl.appendChild(el('div', '', 'input:'));
          tcEl.appendChild(el('pre', 'json-block', JSON.stringify(tc.input, null, 2)));
        }
        if (tc.output != null) {
          tcEl.appendChild(el('div', '', 'output:'));
          tcEl.appendChild(el('pre', 'json-block', JSON.stringify(tc.output, null, 2)));
        }
        if (tc.error) {
          var err = el('div', 'value', 'Error: ' + tc.error);
          err.style.color = 'var(--failure)';
          tcEl.appendChild(err);
        }

        container.appendChild(tcEl);
      });
    }

    // Error
    if (trace.error) {
      var errBox = el('div', 'detail-row');
      errBox.appendChild(el('span', 'key', 'Error'));
      var ev = el('span', 'value', trace.error);
      ev.style.color = 'var(--failure)';
      errBox.appendChild(ev);
      container.appendChild(errBox);
    }

    // Input
    container.appendChild(el('h4', '', 'Input'));
    container.appendChild(el('pre', 'json-block', JSON.stringify(trace.input, null, 2)));

    // Output
    container.appendChild(el('h4', '', 'Output'));
    container.appendChild(el('pre', 'json-block', JSON.stringify(trace.output, null, 2)));

    // Tokens raw
    if (trace.tokens) {
      container.appendChild(el('h4', '', 'Token Usage'));
      container.appendChild(el('pre', 'json-block', JSON.stringify(trace.tokens, null, 2)));
    }
  }

  // Filter handling (client side)
  function setupFilters() {
    var group = $('filters');
    if (!group) return;

    group.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.filter-btn');
      if (!btn) return;

      var status = btn.getAttribute('data-status') || 'all';

      // toggle active
      group.querySelectorAll('.filter-btn').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });

      state.statusFilter = status;
      renderRuns(); // re-render with filter
    });
  }

  // Export
  async function doExport(format) {
    try {
      var url = '/api/export?format=' + format;
      var res = await fetch(url);
      if (!res.ok) throw new Error('Export failed');

      var blob = await res.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'agenttrace-export.' + format;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 1000);
    } catch (e) {
      alert('Export failed: ' + e.message);
    }
  }

  function setupExports() {
    var jsonBtn = $('export-json-btn');
    var csvBtn = $('export-csv-btn');

    if (jsonBtn) {
      jsonBtn.addEventListener('click', function () {
        doExport('json');
      });
    }
    if (csvBtn) {
      csvBtn.addEventListener('click', function () {
        doExport('csv');
      });
    }
  }

  function setupRefresh() {
    var btn = $('refresh-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        refreshAll(true);
      });
    }
  }

  function setupCloseDetails() {
    var btn = $('close-details-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        var sec = $('details-section');
        if (sec) sec.style.display = 'none';
        state.selectedTraceId = null;
        document.querySelectorAll('.trace-item').forEach(function (el) {
          el.classList.remove('selected');
        });
      });
    }
  }

  function setupAutoRefresh() {
    if (state.autoRefreshId) {
      clearInterval(state.autoRefreshId);
    }
    // Every 5 seconds
    state.autoRefreshId = setInterval(function () {
      refreshAll(true);
    }, 5000);
  }

  // Main init
  async function initDashboard() {
    setupFilters();
    setupExports();
    setupRefresh();
    setupCloseDetails();
    setupAutoRefresh();

    // Initial data load
    try {
      await loadStats();
      await loadRuns();
    } catch (err) {
      var runsList = $('runs-list');
      if (runsList)
        runsList.innerHTML = '<div class="empty">Failed to load data. Is the server running?</div>';
      console.error('[AgentTrace] init error', err);
    }

    // If no runs, still show empty state handled in render
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }

  // Expose for tests / debugging (optional)
  window.__agenttraceDashboard = {
    state: state,
    refresh: function () {
      return refreshAll(true);
    },
    init: initDashboard,
  };
})();
