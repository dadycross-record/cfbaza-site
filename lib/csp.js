'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const { randomBytes } = require('crypto');
const context = new AsyncLocalStorage();
const nonce = () => context.getStore();
module.exports = {
  run: fn => context.run(randomBytes(24).toString('base64'), fn),
  nonce,
  attr: () => ` nonce="${nonce()}"`,
};
