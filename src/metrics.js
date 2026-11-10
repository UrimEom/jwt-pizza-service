const os = require('os');
const config = require('./config.js');

const startedAt = `${Date.now()}000000`;
const sessions = new Map();

const requests = { GET: 0, PUT: 0, POST: 0, DELETE: 0 };
const authAttempts = { success: 0, failure: 0 };

let endpointLatency = 0;
let endpointCount = 0;
let pizzasSold = 0;
let pizzaFailures = 0;
let revenue = 0;
let creationLatency = 0;
let creationCount = 0;
let timer;
let sending = false;

function cpuSnapshot() {
  return os.cpus().reduce(
    (result, cpu) => {
      result.idle += cpu.times.idle;
      result.total += Object.values(cpu.times).reduce(
        (sum, value) => sum + value,
        0
      );
      return result;
    },
    { idle: 0, total: 0 }
  );
}

let previousCpu = cpuSnapshot();

function cpuPercentage() {
  const current = cpuSnapshot();
  const total = current.total - previousCpu.total;
  const idle = current.idle - previousCpu.idle;
  previousCpu = current;

  return total > 0 ? 100 * (1 - idle / total) : 0;
}

function requestTracker(req, res, next) {
  const start = process.hrtime.bigint();
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');

  res.once('finish', () => {
    requests[req.method] = (requests[req.method] || 0) + 1;

    endpointLatency +=
      Number(process.hrtime.bigint() - start) / 1e9;
    endpointCount += 1;

    if (req.method === 'PUT' && path === '/api/auth') {
      const result = res.statusCode < 400 ? 'success' : 'failure';
      authAttempts[result] += 1;
    }
  });

  next();
}

function userLoggedIn(userId, token) {
  sessions.set(token, userId);
}

function userLoggedOut(token) {
  sessions.delete(token);
}

function pizzaPurchase(success, seconds, items = []) {
  creationLatency += seconds;
  creationCount += 1;

  if (success) {
    pizzasSold += items.length;
    revenue += items.reduce(
      (sum, item) => sum + Number(item.price || 0),
      0
    );
  } else {
    pizzaFailures += 1;
  }
}

function buildMetric(name, value, unit, type, labels = {}) {
  const point = {
    asDouble: value,
    timeUnixNano: `${Date.now()}000000`,
    attributes: Object.entries({
      source: config.metrics.source,
      ...labels,
    }).map(([key, value]) => ({
      key,
      value: { stringValue: String(value) },
    })),
  };

  const data = { dataPoints: [point] };

  if (type === 'sum') {
    point.startTimeUnixNano = startedAt;
    data.aggregationTemporality = 2;
    data.isMonotonic = true;
  }

  return { name, unit, [type]: data };
}

async function sendMetrics() {
  if (sending) return;
  sending = true;

  try {
    const metrics = [];

    const counter = (name, value, unit = '1', labels = {}) => {
      metrics.push(buildMetric(name, value, unit, 'sum', labels));
    };

    const gauge = (name, value, unit = '1') => {
      metrics.push(buildMetric(name, value, unit, 'gauge'));
    };

    for (const [method, count] of Object.entries(requests)) {
      counter('http_requests', count, '1', { method });
    }

    for (const [result, count] of Object.entries(authAttempts)) {
      counter('auth_attempts', count, '1', { result });
    }

    gauge('active_users', new Set(sessions.values()).size);
    gauge('cpu', cpuPercentage(), '%');

    const memory = 100 * (1 - os.freemem() / os.totalmem());
    gauge('memory', memory, '%');

    counter('pizzas_sold', pizzasSold);
    counter('pizza_creation_failures', pizzaFailures);
    counter('pizza_revenue', revenue);

    counter('service_latency', endpointLatency, 's');
    counter('service_requests_completed', endpointCount);
    counter('pizza_creation_latency', creationLatency, 's');
    counter('pizza_creation_attempts', creationCount);

    const credentials = Buffer.from(
      `${config.metrics.accountId}:${config.metrics.apiKey}`
    ).toString('base64');

    const response = await fetch(config.metrics.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                scope: { name: 'jwt-pizza-service' },
                metrics,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      // Do not print configuration or credentials.
      console.error(`Metrics upload failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('Metrics upload failed:', error.message);
  } finally {
    sending = false;
  }
}

function start() {
  if (timer) return;

  const settings = config.metrics;
  if (
    !settings?.endpointUrl ||
    !settings?.accountId ||
    !settings?.apiKey
  ) {
    console.warn('Metrics reporting disabled: missing configuration');
    return;
  }

  previousCpu = cpuSnapshot();
  timer = setInterval(sendMetrics, 10000);
  timer.unref();
}

function stop() {
  clearInterval(timer);
  timer = undefined;
}

module.exports = {
  requestTracker,
  userLoggedIn,
  userLoggedOut,
  pizzaPurchase,
  start,
  stop,
};