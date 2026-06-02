import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- test harness with heavy JSDOM + mock globals requires anys and some stub fns */

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const APP_JS = path.join(PUBLIC_DIR, 'app.js');

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text?: () => Promise<string>;
}

function createMockResponse(data: any, ok = true, status = 200): MockResponse {
  const textData = typeof data === 'string' ? data : JSON.stringify(data);
  const blobData = new ((global as any).Blob || Blob)([textData], {
    type: ok ? 'application/json' : 'text/plain',
  });
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(textData),
    blob: () => Promise.resolve(blobData),
  } as any;
}

describe('AgentTrace Dashboard Frontend (app.js)', () => {
  let dom: JSDOM;
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalWindow: any;
  let originalDocument: any;
  let originalFetch: any;
  let originalSetInterval: any;
  let originalClearInterval: any;
  let intervalId: number | null = null;

  beforeEach(() => {
    // Save originals
    originalWindow = (global as any).window;
    originalDocument = (global as any).document;
    originalFetch = (global as any).fetch;
    originalSetInterval = (global as any).setInterval;
    originalClearInterval = (global as any).clearInterval;

    // Setup JSDOM with minimal dashboard skeleton (matches what index.html provides)
    dom = new JSDOM(
      `<!DOCTYPE html>
      <html>
        <body>
          <div id="stats">
            <div class="stat"><span id="total-runs">0</span><label>Total Runs</label></div>
            <div class="stat"><span id="success-rate">0%</span><label>Success Rate</label></div>
            <div class="stat"><span id="avg-latency">0ms</span><label>Avg Latency</label></div>
            <div class="stat"><span id="total-cost">$0.00</span><label>Total Cost</label></div>
          </div>

          <div id="filters">
            <button class="filter-btn active" data-status="all">All</button>
            <button class="filter-btn" data-status="success">Success</button>
            <button class="filter-btn" data-status="failure">Failure</button>
            <button class="filter-btn" data-status="running">Running</button>
          </div>

          <button id="refresh-btn">Refresh</button>
          <button id="export-json-btn">Export JSON</button>
          <button id="export-csv-btn">Export CSV</button>

          <div id="runs-list"></div>
          <div id="traces-section" style="display:none">
            <span id="selected-run-name"></span>
            <div id="traces-list"></div>
          </div>
          <div id="details-section" style="display:none">
            <div id="trace-details"></div>
          </div>
        </body>
      </html>`,
      {
        url: 'http://localhost/',
        runScripts: 'dangerously',
        resources: 'usable',
      },
    );

    (global as any).window = dom.window;
    (global as any).document = dom.window.document;
    (global as any).HTMLElement = dom.window.HTMLElement;
    (global as any).Event = dom.window.Event;
    (global as any).MouseEvent = dom.window.MouseEvent;

    // Mock fetch - must be on the JSDOM window (code runs via eval in that context)
    fetchMock = vi.fn();
    dom.window.fetch = fetchMock as any;
    (global as any).fetch = fetchMock;

    // Mock timers / intervals for auto-refresh - install on window too
    intervalId = null;
    const setIntMock = vi.fn((fn: any, ms: number) => {
      intervalId = 123 as any;
      return intervalId;
    }) as any;
    const clearIntMock = vi.fn((id: any) => {
      intervalId = null;
    }) as any;
    dom.window.setInterval = setIntMock;
    dom.window.clearInterval = clearIntMock;
    (global as any).setInterval = setIntMock;
    (global as any).clearInterval = clearIntMock;

    // JSDOM does not implement alert by default (export error path uses it)
    (dom.window as any).alert = vi.fn();

    // Provide a download anchor mock for export tests
    const origCreateElement = document.createElement.bind(document);
    document.createElement = vi.fn((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        (el as any).click = vi.fn();
        (el as any).href = '';
        (el as any).download = '';
      }
      return el;
    }) as any;

    // Blob and URL mocks - install BOTH on global (for test code) AND on dom.window (for eval'ed app.js)
    const MockBlob = class {
      constructor(
        public parts: any[],
        public options?: any,
      ) {}
    };
    const mockURL = {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    } as any;
    (global as any).Blob = MockBlob;
    (global as any).URL = mockURL;
    dom.window.Blob = MockBlob as any;
    dom.window.URL = mockURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (global as any).window = originalWindow;
    (global as any).document = originalDocument;
    (global as any).fetch = originalFetch;
    (global as any).setInterval = originalSetInterval;
    (global as any).clearInterval = originalClearInterval;
    delete (global as any).Blob;
    delete (global as any).URL;
    delete (global as any).HTMLElement;
    delete (global as any).Event;
    delete (global as any).MouseEvent;
  });

  function loadAppScript() {
    const code = fs.readFileSync(APP_JS, 'utf8');
    // Execute in the JSDOM window context
    dom.window.eval(code);
  }

  function getEl(id: string) {
    return document.getElementById(id);
  }

  function click(el: Element | null) {
    if (el) {
      el.dispatchEvent(new (dom.window as any).MouseEvent('click', { bubbles: true }));
    }
  }

  const mockStats = {
    totalRuns: 5,
    totalTraces: 12,
    successRate: 0.75,
    avgLatencyMs: 1234,
    totalCostUsd: 0.0842,
    totalTokens: 4500,
    avgTokensPerTrace: 375,
    topTools: [],
    topErrors: [],
  };

  const mockRuns = [
    {
      id: 'run-1',
      name: 'Research Agent',
      status: 'success',
      traceCount: 3,
      totalTokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      totalToolCalls: 2,
      totalLatencyMs: 3200,
      totalCostUsd: 0.045,
      errorCount: 0,
      startedAt: Date.now() - 100000,
      completedAt: Date.now() - 90000,
      metadata: {},
    },
    {
      id: 'run-2',
      name: 'Writer Agent',
      status: 'failure',
      traceCount: 1,
      totalTokens: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
      totalToolCalls: 1,
      totalLatencyMs: 800,
      totalCostUsd: 0.012,
      errorCount: 1,
      startedAt: Date.now() - 50000,
      completedAt: Date.now() - 48000,
      metadata: {},
    },
    {
      id: 'run-3',
      name: 'Live Agent',
      status: 'running',
      traceCount: 2,
      totalTokens: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
      totalToolCalls: 3,
      totalLatencyMs: 1500,
      totalCostUsd: 0.027,
      errorCount: 0,
      startedAt: Date.now() - 10000,
      completedAt: undefined,
      metadata: {},
    },
  ];

  const mockTraces = [
    {
      id: 'trace-1',
      runId: 'run-1',
      name: 'search',
      status: 'success',
      input: { q: 'foo' },
      output: { results: 5 },
      tokens: { promptTokens: 40, completionTokens: 30, totalTokens: 70, model: 'gpt-4o-mini' },
      toolCalls: [
        {
          id: 'tc1',
          name: 'web_search',
          input: { query: 'foo' },
          output: 'hits',
          latencyMs: 120,
          success: true,
          timestamp: Date.now(),
        },
      ],
      latencyMs: 850,
      costUsd: 0.015,
      error: undefined,
      metadata: {},
      createdAt: Date.now() - 90000,
      updatedAt: Date.now() - 90000,
    },
  ];

  it('loads and initializes the dashboard without crashing', async () => {
    fetchMock.mockResolvedValueOnce(createMockResponse(mockStats));
    fetchMock.mockResolvedValueOnce(createMockResponse(mockRuns));
    loadAppScript();
    // allow async init loads to settle before next test mutates mocks
    await new Promise((r) => setTimeout(r, 5));
    // Should have set up auto refresh interval
    expect((global as any).setInterval).toHaveBeenCalled();
  });

  it('fetches stats on load and updates DOM elements', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns));

    loadAppScript();

    // Wait for async init
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledWith('/api/stats');
    expect(getEl('total-runs')?.textContent).toBe('5');
    expect(getEl('success-rate')?.textContent).toBe('75.0%');
    expect(getEl('avg-latency')?.textContent).toContain('1.2s'); // formatted
    expect(getEl('total-cost')?.textContent).toBe('$0.0842');
  });

  it('fetches runs on load and renders run items with status badges', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns));

    loadAppScript();
    await new Promise((r) => setTimeout(r, 0));

    const runsList = getEl('runs-list');
    expect(runsList?.children.length).toBeGreaterThanOrEqual(3);

    const badges = runsList?.querySelectorAll('.badge');
    expect(badges?.length).toBeGreaterThanOrEqual(3);
    // Check color classes or text
    expect(
      Array.from(badges || []).some(
        (b) => b.classList.contains('success') || b.textContent === 'success',
      ),
    ).toBe(true);
    expect(
      Array.from(badges || []).some(
        (b) => b.classList.contains('failure') || b.textContent === 'failure',
      ),
    ).toBe(true);
    expect(
      Array.from(badges || []).some(
        (b) => b.classList.contains('running') || b.textContent === 'running',
      ),
    ).toBe(true);
  });

  it('supports filtering runs by status via filter buttons (client-side)', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns))
      .mockResolvedValueOnce(createMockResponse(mockStats)) // may refresh
      .mockResolvedValueOnce(createMockResponse(mockRuns));

    loadAppScript();
    await new Promise((r) => setTimeout(r, 0));

    const runsList = getEl('runs-list');
    const initialCount = runsList?.children.length || 0;
    expect(initialCount).toBe(3);

    // Click failure filter
    const failureBtn = document.querySelector('[data-status="failure"]') as HTMLButtonElement;
    click(failureBtn);
    await new Promise((r) => setTimeout(r, 0));

    // Only failure run should remain visible (or re-rendered filtered)
    const afterFilter = runsList?.children.length || 0;
    // Depending on impl: either hide or re-render subset. Accept either but ensure not all shown
    expect(afterFilter).toBeLessThan(initialCount);

    // Click all
    const allBtn = document.querySelector('[data-status="all"]') as HTMLButtonElement;
    click(allBtn);
    await new Promise((r) => setTimeout(r, 0));
    expect(runsList?.children.length).toBe(initialCount);
  });

  it('clicking a run loads its traces via /api/traces and shows traces section', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns))
      .mockResolvedValueOnce(createMockResponse(mockTraces)); // for traces

    loadAppScript();
    await new Promise((r) => setTimeout(r, 0));

    const firstRun = document.querySelector('.run-item') as HTMLElement;
    expect(firstRun).toBeTruthy();

    // Simulate selecting run
    click(firstRun);
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/traces?runId='));
    const tracesSection = getEl('traces-section');
    expect(tracesSection?.style.display).not.toBe('none');
    expect(getEl('traces-list')?.children.length).toBeGreaterThan(0);
  });

  it('clicking a trace shows full details (tokens, tool calls, latency, cost)', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns))
      .mockResolvedValueOnce(createMockResponse(mockTraces))
      .mockResolvedValueOnce(createMockResponse(mockTraces[0])); // detail fetch if separate

    loadAppScript();
    await new Promise((r) => setTimeout(r, 0));

    // Select run first
    const firstRun = document.querySelector('.run-item') as HTMLElement;
    click(firstRun);
    await new Promise((r) => setTimeout(r, 0));

    const firstTrace = document.querySelector('.trace-item') as HTMLElement;
    expect(firstTrace).toBeTruthy();
    click(firstTrace);
    await new Promise((r) => setTimeout(r, 0));

    const details = getEl('trace-details');
    expect(details?.innerHTML || '').toContain('Latency'); // key in UI
    expect(details?.textContent).toContain('0.015'); // cost
    expect(details?.textContent || '').toMatch(/web_search|tool/i); // tool call
  });

  it('refresh button triggers reload of stats and runs', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns))
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns));

    loadAppScript();
    await new Promise((r) => setTimeout(r, 0));

    const callsBefore = fetchMock.mock.calls.length;
    const refreshBtn = getEl('refresh-btn');
    click(refreshBtn);
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('export JSON button triggers fetch to /api/export?format=json and download', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns))
      .mockResolvedValueOnce(createMockResponse('{"runs":[],"traces":[]}', true)); // export response

    loadAppScript();
    await new Promise((r) => setTimeout(r, 0));

    const exportBtn = getEl('export-json-btn');
    click(exportBtn);
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledWith('/api/export?format=json');
    // Should have created blob url and clicked anchor (our mock)
    expect((global as any).URL.createObjectURL).toHaveBeenCalled();
  });

  it('export CSV button uses ?format=csv', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns))
      .mockResolvedValueOnce(createMockResponse('id,name\nr1,foo', true));

    loadAppScript();
    await new Promise((r) => setTimeout(r, 0));

    const exportBtn = getEl('export-csv-btn');
    click(exportBtn);
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledWith('/api/export?format=csv');
  });

  it('auto-refresh is set up on init (every ~5s)', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse(mockStats))
      .mockResolvedValueOnce(createMockResponse(mockRuns));

    loadAppScript();
    await new Promise((r) => setTimeout(r, 5));

    expect((global as any).setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it('handles empty states gracefully (no runs, no traces)', async () => {
    fetchMock
      .mockResolvedValueOnce(createMockResponse({ ...mockStats, totalRuns: 0 }))
      .mockResolvedValueOnce(createMockResponse([]));

    loadAppScript();
    await new Promise((r) => setTimeout(r, 0));

    const runsList = getEl('runs-list');
    expect(runsList?.textContent || '').toMatch(/no runs|empty/i);
  });
});
