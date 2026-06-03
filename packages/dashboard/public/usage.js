/**
 * AgentTrace Usage Dashboard Frontend (vanilla JS)
 * Real-time via SSE + polling fallback. Dark theme consistent with main dashboard.
 */
(function () {
  'use strict';

  var state = {
    active: [],
    todayStats: null,
    recent: [],
    topAgents: [],
    feed: [],
    sseConnected: false,
    autoRefreshId: null,
    es: null,
  };

  function $(id) { return document.getElementById(id); }

  function formatCost(cost) {
    if (cost == null) return '$0.0000';
    return '$' + Number(cost).toFixed(4);
  }

  function formatNumber(n) {
    if (n == null) return '0';
    return Number(n).toLocaleString();
  }

  function formatTokens(n) {
    if (n == null) return '0';
    var v = Number(n);
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return v.toLocaleString();
  }

  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatDay(d) {
    // d is 'YYYY-MM-DD' or Date
    if (typeof d === 'string') return d.slice(5); // MM-DD
    return d.toISOString().slice(5, 10);
  }

  function getTodayStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function get7DaysAgoStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 6); // include today -> 7 days
    return d.getTime();
  }

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

  async function loadActive() {
    state.active = await fetchJSON('/api/usage/active');
    return state.active;
  }

  async function loadTodayStats() {
    var from = getTodayStart();
    var stats = await fetchJSON('/api/usage/stats?fromDate=' + from);
    state.todayStats = stats;
    return stats;
  }

  async function loadRecent() {
    state.recent = await fetchJSON('/api/usage?limit=50');
    return state.recent;
  }

  async function loadGlobalTop() {
    // Use stats without date range to get overall top agents (by actions desc, cost tiebreak)
    var stats = await fetchJSON('/api/usage/stats');
    state.topAgents = stats && stats.topAgents ? stats.topAgents : [];
    return state.topAgents;
  }

  async function load7dUsageForLine() {
    var from = get7DaysAgoStart();
    var recs = await fetchJSON('/api/usage?fromDate=' + from + '&limit=2000');
    return recs || [];
  }

  async function refreshAll(alsoLine) {
    try {
      await Promise.all([
        loadActive(),
        loadTodayStats(),
        loadRecent(),
        loadGlobalTop(),
      ]);
      renderSummaryCards();
      renderBarChart();
      renderTopAgentsTable();
      renderRecentTable();
      if (alsoLine) {
        var recs = await load7dUsageForLine();
        renderLineChart(recs);
      }
    } catch (e) {
      console.warn('[AgentTrace Usage] refresh error', e);
    }
  }

  // Summary cards per requirements
  function renderSummaryCards() {
    // Active last 30min: count from active list
    var now = Date.now();
    var THIRTY = 30 * 60 * 1000;
    var active30 = (state.active || []).filter(function (a) {
      var last = Date.parse(a.lastActive || 0) || 0;
      return now - last <= THIRTY;
    }).length;

    var actEl = $('active-agents');
    if (actEl) actEl.textContent = String(active30);

    var t = state.todayStats || { totalActions: 0, totalCostUsd: 0, totalTokens: 0 };
    var aEl = $('actions-today');
    if (aEl) aEl.textContent = formatNumber(t.totalActions || 0);

    var cEl = $('cost-today');
    if (cEl) cEl.textContent = formatCost(t.totalCostUsd || 0);

    var tokEl = $('tokens-today');
    if (tokEl) tokEl.textContent = formatTokens(t.totalTokens || 0);
  }

  // Bar chart: actions by type today (CSS div bars)
  function renderBarChart() {
    var container = $('bar-chart');
    if (!container) return;
    container.innerHTML = '';

    var byType = (state.todayStats && state.todayStats.actionsByType) || {};
    var entries = Object.keys(byType).map(function (k) {
      return { type: k, count: byType[k] || 0 };
    });
    entries.sort(function (a, b) { return b.count - a.count; });
    entries = entries.slice(0, 8); // top 8

    if (!entries.length) {
      container.appendChild(el('div', 'empty small', 'No actions today'));
      return;
    }

    var max = 0;
    entries.forEach(function (e) { if (e.count > max) max = e.count; });
    if (max === 0) max = 1;

    var wrap = el('div', 'bar-chart');

    entries.forEach(function (e) {
      var pct = Math.max(6, Math.round((e.count / max) * 100)); // min height for visibility
      var b = el('div', 'bar');
      b.style.height = pct + '%';
      b.style.width = Math.max(22, Math.floor(140 / entries.length)) + 'px';

      var val = el('div', 'bar-value', String(e.count));
      b.appendChild(val);

      var lbl = el('div', 'bar-label', e.type);
      b.appendChild(lbl);

      wrap.appendChild(b);
    });

    container.appendChild(wrap);
  }

  // Line chart: cost over last 7 days (SVG)
  function renderLineChart(recs7d) {
    var container = $('line-chart');
    if (!container) return;
    container.innerHTML = '';

    // Aggregate cost per calendar day (local)
    var byDay = {};
    (recs7d || []).forEach(function (r) {
      var d = new Date(r.createdAt || Date.now());
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      byDay[key] = (byDay[key] || 0) + (r.costUsd || 0);
    });

    // Build last 7 days labels (oldest -> newest)
    var days = [];
    var base = new Date();
    base.setHours(0, 0, 0, 0);
    for (var i = 6; i >= 0; i--) {
      var dt = new Date(base);
      dt.setDate(base.getDate() - i);
      var k = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
      days.push({ key: k, label: formatDay(dt), cost: byDay[k] || 0 });
    }

    var maxCost = 0;
    days.forEach(function (d) { if (d.cost > maxCost) maxCost = d.cost; });
    if (maxCost <= 0) maxCost = 0.0001;

    // SVG
    var W = 520, H = 140, PADL = 32, PADR = 8, PADT = 10, PADB = 20;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'line-chart');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    // axes
    var axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    axis.setAttribute('x1', PADL); axis.setAttribute('y1', H - PADB);
    axis.setAttribute('x2', W - PADR); axis.setAttribute('y2', H - PADB);
    axis.setAttribute('stroke', '#30363d'); axis.setAttribute('stroke-width', '1');
    svg.appendChild(axis);

    var vaxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    vaxis.setAttribute('x1', PADL); vaxis.setAttribute('y1', PADT);
    vaxis.setAttribute('x2', PADL); vaxis.setAttribute('y2', H - PADB);
    vaxis.setAttribute('stroke', '#30363d'); vaxis.setAttribute('stroke-width', '1');
    svg.appendChild(vaxis);

    // points
    var n = days.length;
    var plotW = W - PADL - PADR;
    var plotH = H - PADT - PADB;
    var pts = [];
    for (var j = 0; j < n; j++) {
      var x = PADL + (n === 1 ? plotW / 2 : (j * plotW) / (n - 1));
      var y = H - PADB - (days[j].cost / maxCost) * plotH;
      pts.push({ x: x, y: y, val: days[j].cost, label: days[j].label });
    }

    // polyline
    if (pts.length > 1) {
      var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      var ptsAttr = pts.map(function (p) { return p.x + ',' + p.y; }).join(' ');
      poly.setAttribute('points', ptsAttr);
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', '#58a6ff');
      poly.setAttribute('stroke-width', '2');
      poly.setAttribute('stroke-linejoin', 'round');
      poly.setAttribute('stroke-linecap', 'round');
      svg.appendChild(poly);
    }

    // dots + labels
    pts.forEach(function (p, idx) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
      c.setAttribute('r', '3');
      c.setAttribute('fill', '#58a6ff');
      svg.appendChild(c);

      // day label
      var tx = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      tx.setAttribute('x', p.x);
      tx.setAttribute('y', H - 4);
      tx.setAttribute('text-anchor', 'middle');
      tx.textContent = p.label;
      svg.appendChild(tx);

      // value if >0 (small)
      if (p.val > 0) {
        var ty = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        ty.setAttribute('x', p.x);
        ty.setAttribute('y', p.y - 6);
        ty.setAttribute('text-anchor', 'middle');
        ty.setAttribute('fill', '#c9d1d9');
        ty.textContent = '$' + p.val.toFixed(2);
        svg.appendChild(ty);
      }
    });

    // y max label
    var ylbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    ylbl.setAttribute('x', 4); ylbl.setAttribute('y', PADT + 10);
    ylbl.setAttribute('fill', '#8b949e');
    ylbl.textContent = '$' + maxCost.toFixed(2);
    svg.appendChild(ylbl);

    container.appendChild(svg);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderTopAgentsTable() {
    var tb = $('top-agents-table');
    if (!tb) return;
    var tbody = tb.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    var rows = state.topAgents || [];
    var countEl = $('top-agents-count');
    if (countEl) countEl.textContent = rows.length + '';

    if (!rows.length) {
      var tr0 = el('tr');
      tr0.innerHTML = '<td colspan="4" class="empty small">No usage recorded yet</td>';
      tbody.appendChild(tr0);
      return;
    }

    rows.slice(0, 8).forEach(function (a) {
      var tr = el('tr');
      tr.innerHTML =
        '<td class="agent">' + escapeHtml(a.agentName || '') + '</td>' +
        '<td class="num">' + formatNumber(a.actions || 0) + '</td>' +
        '<td class="num">' + formatTokens(a.tokens || 0) + '</td>' +
        '<td class="num cost">' + formatCost(a.costUsd || 0) + '</td>';
      tbody.appendChild(tr);
    });
  }

  function renderRecentTable() {
    var tb = $('recent-actions-table');
    if (!tb) return;
    var tbody = tb.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    var rows = state.recent || [];
    var countEl = $('recent-count');
    if (countEl) countEl.textContent = rows.length + '';

    if (!rows.length) {
      var tr0 = el('tr');
      tr0.innerHTML = '<td colspan="4" class="empty small">No actions yet</td>';
      tbody.appendChild(tr0);
      return;
    }

    rows.slice(0, 12).forEach(function (r) {
      var tr = el('tr');
      var actionStr = r.action || '';
      if (r.target) actionStr += ':' + r.target;
      tr.innerHTML =
        '<td>' + formatTime(r.createdAt) + '</td>' +
        '<td class="agent">' + escapeHtml(r.agentName || '') + '</td>' +
        '<td>' + escapeHtml(actionStr) + '</td>' +
        '<td class="num cost">' + formatCost(r.costUsd || 0) + '</td>';
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Live feed
  function addToFeed(record) {
    if (!record) return;
    state.feed.unshift(record);
    if (state.feed.length > 50) state.feed.pop();

    var feedEl = $('activity-feed');
    if (!feedEl) return;

    // remove empty
    var empty = feedEl.querySelector('.empty');
    if (empty) empty.remove();

    var item = el('div', 'activity-item');
    var time = el('span', 'activity-time', formatTime(record.createdAt));
    var agent = el('span', 'activity-agent', record.agentName || 'agent');
    var action = el('span', 'activity-action', record.action + (record.target ? ':' + record.target : ''));
    var cost = el('span', 'activity-cost', formatCost(record.costUsd));

    item.appendChild(time);
    item.appendChild(agent);
    item.appendChild(action);
    item.appendChild(cost);

    // prepend
    if (feedEl.firstChild) {
      feedEl.insertBefore(item, feedEl.firstChild);
    } else {
      feedEl.appendChild(item);
    }

    // trim dom children
    while (feedEl.children.length > 50) {
      feedEl.removeChild(feedEl.lastChild);
    }

    var fc = $('feed-count');
    if (fc) fc.textContent = state.feed.length + ' events';
  }

  function setupSSE() {
    var dot = $('live-dot');
    function setConnected(ok) {
      state.sseConnected = !!ok;
      if (dot) dot.classList.toggle('off', !ok);
    }
    setConnected(false);

    try {
      var es = new EventSource('/api/usage/stream');
      state.es = es;

      es.addEventListener('connected', function () {
        setConnected(true);
      });

      es.addEventListener('usage', function (ev) {
        try {
          var rec = JSON.parse(ev.data);
          addToFeed(rec);

          // light incremental update: bump recent + cards occasionally
          // push to recent head too (for table)
          state.recent.unshift(rec);
          if (state.recent.length > 50) state.recent.pop();
          renderRecentTable();

          // refresh full stats every ~3 events or on timer
          // rely on 5s poll for heavy stuff; just show feed live
        } catch (_) {}
      });

      es.addEventListener('error', function () {
        setConnected(false);
        // browser will auto-reconnect
      });

      // mark connected on open too
      es.onopen = function () { setConnected(true); };
    } catch (e) {
      setConnected(false);
      console.warn('[Usage] SSE not available, using polling only', e);
    }
  }

  function setupAutoRefresh() {
    if (state.autoRefreshId) clearInterval(state.autoRefreshId);
    // poll summaries + charts every 5s (SSE handles feed pushes)
    state.autoRefreshId = setInterval(function () {
      refreshAll(false).catch(function () {});
    }, 5000);
  }

  function setupRefreshBtn() {
    var btn = $('refresh-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        refreshAll(true).catch(function (e) { console.warn(e); });
      });
    }
  }

  function initUsage() {
    setupRefreshBtn();
    setupAutoRefresh();
    setupSSE();

    // initial load (include line)
    refreshAll(true).then(function () {
      // after first load, seed feed from recent if empty
      var feedEl = $('activity-feed');
      if (feedEl && state.feed.length === 0 && state.recent.length) {
        // seed last few
        var seed = state.recent.slice(0, 8).reverse();
        seed.forEach(function (r) { addToFeed(r); });
      }
    }).catch(function (e) {
      var feed = $('activity-feed');
      if (feed) feed.innerHTML = '<div class="empty">Failed to load usage data. Is the server running?</div>';
      console.error('[AgentTrace Usage] init error', e);
    });

    // expose for debug
    window.__agenttraceUsage = { state: state, refresh: function () { return refreshAll(true); } };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUsage);
  } else {
    initUsage();
  }
})();
