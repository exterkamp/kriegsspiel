const target = process.env.API_URL ?? 'http://localhost:3000';
module.exports = {
  '/game-creations': { target },
  '/map-library': { target },
  '/games': { target, ws: true },
  '/scenarios': { target },
  '/admin/api': { target },
  '/auth': { target },
};
