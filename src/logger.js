const config = require('./config.js');
const { getContext } = require('./requestContext.js');

const REDACTED = '[REDACTED]';

function redactText(value) {
  let text = value;

  // Remove known application credentials if they appear in text.
  const secrets = [
    config.jwtSecret,
    config.db?.connection?.password,
    config.factory?.apiKey,
    config.metrics?.apiKey,
    config.logging?.apiKey,
  ];

  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      text = text.split(secret).join(REDACTED);
    }
  }

  return text
    .replace(/Bearer\s+\S+/gi, `Bearer ${REDACTED}`)
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      REDACTED
    )
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      REDACTED
    );
}

function sanitize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === 'string') {
    // Response bodies may already be JSON strings.
    try {
      return sanitize(JSON.parse(value), seen);
    } catch {
      return redactText(value);
    }
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  let result;

  if (Array.isArray(value)) {
    result = value.map((item) => sanitize(item, seen));
  } else {
    result = {};

    for (const [key, fieldValue] of Object.entries(value)) {
      const sensitive =
        /password|passwd|secret|token|jwt|authorization|cookie|apikey|email|phone|address|cardnumber|cvv/i.test(
          key.replace(/[-_]/g, '')
        );

      result[key] = sensitive
        ? REDACTED
        : sanitize(fieldValue, seen);
    }
  }

  seen.delete(value);
  return result;
}

class Logger {
   httpLogger = (req, res, next) => {
      let responseBody = null;
      const originalSend = res.send;
  
      res.send = function (body) {
        responseBody = body;
  
        // Restore Express's original method before sending.
        res.send = originalSend;
        return originalSend.call(this, body);
      };
  
      res.once('finish', () => {
        const level =
          res.statusCode >= 500
            ? 'error'
            : res.statusCode >= 400
              ? 'warn'
              : 'info';
  
        void this.log(level, 'http', {
          method: req.method,
          path: req.originalUrl.split('?')[0],
          authorized: Boolean(req.headers.authorization),
          statusCode: res.statusCode,
          reqBody: req.body ?? null,
          resBody: responseBody,
        });
      });
  
      next();
   };
   
   log(level, type, data = {}) {
      // Unit tests should not send requests to Grafana.
      if (process.env.NODE_ENV === 'test') {
         return Promise.resolve();
      }

      const logging = config.logging;

      if (
         !logging?.endpointUrl ||
         !logging?.accountId ||
         !logging?.apiKey
      ) {
         return Promise.resolve();
      }

      try {
         const entry = sanitize({
         ...data,
         ...getContext(),
         });

         const event = {
         streams: [
            {
               stream: {
               component: logging.source,
               level,
               type,
               },
               values: [
               [
                  (BigInt(Date.now()) * 1000000n).toString(),
                  JSON.stringify(entry),
               ],
               ],
            },
         ],
         };

         return this.sendLogToGrafana(event);
      } catch {
         console.error('Unable to prepare Grafana log');
         return Promise.resolve();
      }
   }

   async sendLogToGrafana(event) {
      const logging = config.logging;

      try {
         const response = await fetch(logging.endpointUrl, {
         method: 'POST',
         headers: {
            'Content-Type': 'application/json',
            Authorization:
               `Bearer ${logging.accountId}:${logging.apiKey}`,
         },
         body: JSON.stringify(event),
         signal: AbortSignal.timeout(5000),
         });

         if (!response.ok) {
         console.error(
            'Grafana log delivery failed:',
            response.status
         );
         }
      } catch {
         // Logging failures must not break application requests.
         console.error('Unable to send log to Grafana');
      }
   }
}

module.exports = new Logger();