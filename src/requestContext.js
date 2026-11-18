const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const storage = new AsyncLocalStorage();

function middleware(req, res, next) {
  const context = {
    requestId: randomUUID(),
    req,
  };

  storage.run(context, () => next());
}

function getContext() {
  const context = storage.getStore();

  return {
    requestId: context?.requestId ?? null,
    userId: context?.req.user?.id ?? null,
  };
}

module.exports = {
  middleware,
  getContext,
};