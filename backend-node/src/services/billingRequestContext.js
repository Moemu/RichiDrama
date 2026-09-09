'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const storage = new AsyncLocalStorage();

function run(context, fn) { return storage.run({ cost_operation_id: require('node:crypto').randomUUID(), ...context, auto_billing_disabled: false }, fn); }
function current() { return storage.getStore() || null; }
function disableAutoBilling() { const store = current(); if (store) store.auto_billing_disabled = true; }

module.exports = { run, current, disableAutoBilling };
