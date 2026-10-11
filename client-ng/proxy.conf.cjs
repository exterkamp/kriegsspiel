const target = process.env.API_URL ?? 'http://localhost:3000';
module.exports = {
  '/games': { target, ws: true },
  '/scenarios': { target },
  '/auth': { target },
};
