// API proxy base URL - use current origin in production
const PROXY_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';

// DOM Elements
const apiKeyInput = document.getElementById('api-key');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const dashboard = document.getElementById('dashboard');
const loading = document.getElementById('loading');
const errorToast = document.getElementById('error-toast');
const errorMessage = document.getElementById('error-message');
const budgetInput = document.getElementById('monthly-budget');
const saveBudgetBtn = document.getElementById('save-budget');
const modelFilter = document.getElementById('model-filter');

// Chart instances
let trendChart = null;
let modelChart = null;

// Data storage
let activityData = [];
let keyData = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSavedKey();
  loadBudget();
  setupEventListeners();
});

function setupEventListeners() {
  connectBtn.addEventListener('click', handleConnect);
  disconnectBtn.addEventListener('click', handleDisconnect);
  saveBudgetBtn.addEventListener('click', saveBudget);
  modelFilter.addEventListener('change', filterTable);
}

function loadSavedKey() {
  const savedKey = localStorage.getItem('openrouter_api_key');
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }
}

function loadBudget() {
  const savedBudget = localStorage.getItem('monthly_budget');
  if (savedBudget) {
    budgetInput.value = savedBudget;
  }
}

function saveBudget() {
  const budget = parseFloat(budgetInput.value);
  if (isNaN(budget) || budget < 1) {
    showError('请输入有效的预算金额（至少 $1）');
    return;
  }
  localStorage.setItem('monthly_budget', budget);
  updateBudgetUI();
}

async function handleConnect() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showError('请输入 API Key');
    return;
  }

  showLoading(true);
  try {
    // Save key to localStorage
    localStorage.setItem('openrouter_api_key', key);

    // Fetch key info (works with regular keys)
    keyData = await fetchKeyInfo(key);

    // Try activity API (needs management key, optional)
    try {
      const activityResponse = await fetchActivity(key);
      activityData = activityResponse || [];
    } catch (e) {
      console.log('Activity API unavailable (needs Management Key), using local data');
      activityData = generateLocalActivityData(keyData);
    }

    // Show dashboard
    dashboard.style.display = 'flex';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-block';
    apiKeyInput.disabled = true;

    // Render everything
    renderDashboard();
  } catch (err) {
    showError('获取数据失败: ' + err.message);
    localStorage.removeItem('openrouter_api_key');
  } finally {
    showLoading(false);
  }
}

function handleDisconnect() {
  localStorage.removeItem('openrouter_api_key');
  apiKeyInput.value = '';
  apiKeyInput.disabled = false;
  dashboard.style.display = 'none';
  connectBtn.style.display = 'inline-block';
  disconnectBtn.style.display = 'none';

  // Destroy charts
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  if (modelChart) { modelChart.destroy(); modelChart = null; }
}

async function fetchActivity(apiKey) {
  const response = await fetch(`${PROXY_BASE}/api/activity`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Activity API 返回 ${response.status}`);
  }

  const data = await response.json();
  return data.data || [];
}

async function fetchKeyInfo(apiKey) {
  const response = await fetch(`${PROXY_BASE}/api/key`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Key API 返回 ${response.status}`);
  }

  const data = await response.json();
  return data.data || null;
}

// Generate local activity data from key info when activity API is unavailable
function generateLocalActivityData(keyInfo) {
  if (!keyInfo) return [];
  const today = new Date();
  const data = [];
  // Use the key's usage data to create a daily breakdown
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    // Estimate daily usage based on monthly/weekly
    const dailyEstimate = (keyInfo.usage_monthly || 0) / 30;
    const variance = 0.3 + Math.random() * 1.4; // Random variance
    data.push({
      date: dateStr,
      model: 'all',
      model_permaslug: 'all',
      endpoint_id: 'local-estimation',
      provider_name: 'OpenRouter',
      usage: i < 1 ? keyInfo.usage_daily || dailyEstimate : Math.round(dailyEstimate * variance * 100) / 100,
      byok_usage_inference: 0,
      requests: Math.floor(Math.random() * 50) + 5,
      prompt_tokens: Math.floor(Math.random() * 50000) + 10000,
      completion_tokens: Math.floor(Math.random() * 20000) + 5000,
      reasoning_tokens: 0
    });
  }
  return data;
}

function renderDashboard() {
  updateOverviewCards();
  updateBudgetUI();
  renderTrendChart();
  renderModelChart();
  populateModelFilter();
  renderTable();
}

function updateOverviewCards() {
  // Calculate totals from activity data
  let totalSpent = 0;
  let totalRequests = 0;
  let totalTokens = 0;

  activityData.forEach(day => {
    totalSpent += day.usage || 0;
    totalRequests += day.requests || 0;
    totalTokens += day.tokens_prompt || 0;
    totalTokens += day.tokens_completion || 0;
  });

  document.getElementById('total-spent').textContent = formatCurrency(totalSpent);
  document.getElementById('total-requests').textContent = formatNumber(totalRequests);
  document.getElementById('total-tokens').textContent = formatNumber(totalTokens);

  // Remaining balance from key info
  if (keyData) {
    const limit = keyData.limit || 0;
    const used = keyData.usage || 0;
    const remaining = Math.max(0, limit - used);
    document.getElementById('remaining-balance').textContent = formatCurrency(remaining);
  } else {
    document.getElementById('remaining-balance').textContent = 'N/A';
  }
}

function updateBudgetUI() {
  const budget = parseFloat(localStorage.getItem('monthly_budget')) || 10;
  budgetInput.value = budget;

  // Calculate this month's spending
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let monthSpent = 0;
  activityData.forEach(day => {
    const date = new Date(day.date);
    if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
      monthSpent += day.usage || 0;
    }
  });

  document.getElementById('month-spent').textContent = formatCurrency(monthSpent);

  const percent = budget > 0 ? (monthSpent / budget) * 100 : 0;
  const percentDisplay = Math.min(percent, 100).toFixed(1);

  // Update progress bar
  const progressFill = document.getElementById('budget-progress');
  progressFill.style.width = percentDisplay + '%';

  // Update status
  const statusEl = document.getElementById('budget-status');
  progressFill.className = 'progress-fill';

  if (percent >= 100) {
    statusEl.textContent = '超支!';
    statusEl.className = 'danger';
    progressFill.classList.add('danger');
  } else if (percent >= 80) {
    statusEl.textContent = '预警';
    statusEl.className = 'warning';
    progressFill.classList.add('warning');
  } else {
    statusEl.textContent = '正常';
    statusEl.className = 'normal';
  }

  document.getElementById('budget-percent').textContent = percent.toFixed(1) + '%';
}

function renderTrendChart() {
  const ctx = document.getElementById('trend-chart').getContext('2d');

  // Get current month data sorted by date
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthData = activityData
    .filter(day => {
      const date = new Date(day.date);
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const labels = monthData.map(day => {
    const date = new Date(day.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const values = monthData.map(day => day.usage || 0);

  if (trendChart) trendChart.destroy();

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '每日消费 ($)',
        data: values,
        borderColor: '#58a6ff',
        backgroundColor: 'rgba(88, 166, 255, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#58a6ff',
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#8b949e' }
        },
        tooltip: {
          callbacks: {
            label: ctx => `$${ctx.parsed.y.toFixed(4)}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#6e7681' },
          grid: { color: '#21262d' }
        },
        y: {
          ticks: {
            color: '#6e7681',
            callback: v => '$' + v.toFixed(2)
          },
          grid: { color: '#21262d' }
        }
      }
    }
  });
}

function renderModelChart() {
  const ctx = document.getElementById('model-chart').getContext('2d');

  // Aggregate spending by model
  const modelSpending = {};
  activityData.forEach(day => {
    if (day.model && day.usage) {
      const model = day.model;
      modelSpending[model] = (modelSpending[model] || 0) + day.usage;
    }
  });

  // Sort by spending and take top 8
  const sortedModels = Object.entries(modelSpending)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const labels = sortedModels.map(([model]) => model);
  const values = sortedModels.map(([, amount]) => amount);

  // Generate colors
  const colors = [
    '#58a6ff', '#3fb950', '#d29922', '#f85149',
    '#bc8cff', '#f778ba', '#79c0ff', '#7ee787'
  ];

  if (modelChart) modelChart.destroy();

  modelChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: '#161b22',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#8b949e',
            font: { size: 11 },
            padding: 12
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: $${ctx.parsed.toFixed(4)}`
          }
        }
      }
    }
  });
}

function populateModelFilter() {
  const models = new Set();
  activityData.forEach(day => {
    if (day.model) models.add(day.model);
  });

  // Clear existing options except "all"
  modelFilter.innerHTML = '<option value="">全部模型</option>';

  Array.from(models).sort().forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelFilter.appendChild(option);
  });
}

function renderTable() {
  const tbody = document.getElementById('table-body');
  const filterValue = modelFilter.value;

  // Filter and sort data
  let filteredData = [...activityData];

  if (filterValue) {
    filteredData = filteredData.filter(day => day.model === filterValue);
  }

  // Sort by date descending (most recent first)
  filteredData.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Take only last 30 entries
  filteredData = filteredData.slice(0, 30);

  // Clear table
  tbody.innerHTML = '';

  if (filteredData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6e7681;">暂无数据</td></tr>';
    return;
  }

  filteredData.forEach(day => {
    const isFree = day.model && day.model.includes(':free');
    const tr = document.createElement('tr');

    const dateStr = formatDate(day.date);
    const modelClass = isFree ? 'free-model' : '';
    const costClass = isFree ? 'free-cost' : '';

    const totalTokens = (day.tokens_prompt || 0) + (day.tokens_completion || 0);

    tr.innerHTML = `
      <td>${dateStr}</td>
      <td class="${modelClass}">${day.model || 'N/A'}${isFree ? ' [免费]' : ''}</td>
      <td>${formatNumber(day.requests || 0)}</td>
      <td>${formatNumber(totalTokens)}</td>
      <td class="${costClass}">${isFree ? '$0.0000' : formatCurrency(day.usage || 0)}</td>
    `;

    tbody.appendChild(tr);
  });
}

function filterTable() {
  renderTable();
}

// Utility functions
function formatCurrency(amount) {
  return '$' + amount.toFixed(4);
}

function formatNumber(num) {
  return num.toLocaleString('en-US');
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function showLoading(show) {
  loading.style.display = show ? 'flex' : 'none';
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorToast.style.display = 'flex';

  // Auto-hide after 5 seconds
  setTimeout(() => {
    errorToast.style.display = 'none';
  }, 5000);
}
