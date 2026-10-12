// Angular loads this Node-only proxy configuration as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const proxy = require('./proxy.conf.cjs');
const target = process.env.LOCAL_MAP_CATALOG_URL;
// Missing sidecar configuration must never forward local catalog requests to the live API.
module.exports = target
  ? { ...proxy, '/__local/maps': { target }, '/__local/maps/**': { target } }
  : { ...proxy };
