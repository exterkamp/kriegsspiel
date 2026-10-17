import { expect, it } from 'vitest';
import { buildApp } from './app.js';
import { StubOrderParser } from '../orders/stubParser.js';

it('serves default battlefield geography without authentication or game/seat side effects', async () => {
  const app = await buildApp({ parser: new StubOrderParser() });
  try {
    const response = await app.server.inject({ method: 'GET', url: '/scenarios' });
    expect(response.statusCode).toBe(200);
    const { battlefield } = response.json().scenarios[0];
    expect(battlefield.map).toMatchObject({
      widthM: 4000,
      heightM: 3000,
      source: 'scenario-default',
    });
    expect(battlefield.map.terrainIdentity).toBe(battlefield.pairing.terrainIdentity);
    expect(battlefield.capabilities).toEqual({ addMaps: false });
    expect(response.body).not.toMatch(/"(?:units|hq|victory|intel)"/);
    expect(
      (await app.server.inject({ method: 'POST', url: '/games', payload: {} })).statusCode,
    ).toBe(401);
  } finally {
    await app.server.close();
  }
});
