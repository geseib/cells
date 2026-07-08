import { test, expect } from '@playwright/test';
import { CELL_API_URLS, ROUTING_API_URL } from './config';

test.describe('Cell API Endpoints Tests', () => {
  test.skip(CELL_API_URLS.length === 0, 'CELL_API_URLS not set — no deployment to test against');

  CELL_API_URLS.forEach((apiUrl, index) => {
    const label = `cell #${index + 1}`;

    test(`should return cell info from ${label} /info endpoint`, async ({ request }) => {
      const response = await request.get(`${apiUrl}/info`);

      expect(response.status()).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('cellId');
      expect(data).toHaveProperty('region');
      expect(data).toHaveProperty('availabilityZone');
      expect(data).toHaveProperty('timestamp');

      expect(typeof data.cellId).toBe('string');
      expect(data.cellId.length).toBeGreaterThan(0);
    });

    test(`should return health status from ${label} /health endpoint`, async ({ request }) => {
      const response = await request.get(`${apiUrl}/health`);

      // Health endpoint might return 503 if cell is degraded, which is acceptable
      expect([200, 503]).toContain(response.status());

      const data = await response.json();
      expect(data).toHaveProperty('cellId');
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('lastCheck');
      expect(data).toHaveProperty('checks');

      expect(['healthy', 'degraded', 'unhealthy']).toContain(data.status);

      // Verify checks structure
      expect(data.checks).toHaveProperty('dynamodb');
      expect(data.checks).toHaveProperty('memory');
      expect(data.checks).toHaveProperty('cpu');

      // All check values should be boolean
      expect(typeof data.checks.dynamodb).toBe('boolean');
      expect(typeof data.checks.memory).toBe('boolean');
      expect(typeof data.checks.cpu).toBe('boolean');
    });

    test(`should track client visits for ${label}`, async ({ request }) => {
      const testClientData = {
        clientId: `cell-test-client-${index}`,
        sourceIp: '192.168.1.100'
      };

      const response = await request.post(`${apiUrl}/track-client`, {
        data: testClientData
      });

      // 200 = repeat visit updated, 201 = first visit recorded
      expect([200, 201]).toContain(response.status());

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBeTruthy();
    });

    test(`should return recent clients for ${label}`, async ({ request }) => {
      // Discover this cell's ID from its own /info endpoint
      const infoResponse = await request.get(`${apiUrl}/info`);
      expect(infoResponse.status()).toBe(200);
      const { cellId } = await infoResponse.json();

      // First, track a client visit
      await request.post(`${apiUrl}/track-client`, {
        data: {
          clientId: `recent-test-client-${index}`,
          sourceIp: '192.168.1.200'
        }
      });

      // Then get recent clients
      const response = await request.get(`${apiUrl}/clients/cell/${cellId}`);

      expect(response.status()).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('clients');
      expect(Array.isArray(data.clients)).toBeTruthy();
    });

    test(`should have CORS headers for ${label} endpoints`, async ({ request }) => {
      const response = await request.get(`${apiUrl}/info`);

      expect(response.status()).toBe(200);

      const corsHeader = response.headers()['access-control-allow-origin'];
      expect(corsHeader).toBeDefined();
    });

    test(`should handle OPTIONS requests for ${label}`, async ({ request }) => {
      const response = await request.fetch(`${apiUrl}/info`, {
        method: 'OPTIONS'
      });

      // Should return 200 or 204 for OPTIONS preflight
      expect([200, 204]).toContain(response.status());

      // Should have CORS headers
      const headers = response.headers();
      expect(headers['access-control-allow-origin']).toBeDefined();
      expect(headers['access-control-allow-methods']).toBeDefined();
    });

    test(`should return consistent cell ID across endpoints for ${label}`, async ({ request }) => {
      const [infoResponse, healthResponse] = await Promise.all([
        request.get(`${apiUrl}/info`),
        request.get(`${apiUrl}/health`)
      ]);

      // Both should succeed (health might be 503 but still return data)
      expect(infoResponse.status()).toBe(200);
      expect([200, 503]).toContain(healthResponse.status());

      const [infoData, healthData] = await Promise.all([
        infoResponse.json(),
        healthResponse.json()
      ]);

      // Both should return the same cell ID
      expect(infoData.cellId).toBe(healthData.cellId);
    });

    test(`should validate input for ${label} track-client endpoint`, async ({ request }) => {
      // Test with missing clientId
      const invalidRequest = request.post(`${apiUrl}/track-client`, {
        data: {
          sourceIp: '192.168.1.1'
          // Missing clientId
        }
      });

      // Should handle invalid input gracefully
      const response = await invalidRequest;
      expect([400, 422, 500]).toContain(response.status());
    });

    test(`should handle high frequency requests for ${label}`, async ({ request }) => {
      const requests = Array.from({ length: 10 }, () =>
        request.get(`${apiUrl}/info`)
      );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const endTime = Date.now();

      // All should succeed
      for (const response of responses) {
        expect(response.status()).toBe(200);
      }

      // Should complete in reasonable time
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000); // Less than 5 seconds

      // All should return consistent data
      const data = await Promise.all(responses.map(r => r.json()));
      const cellIds = data.map(d => d.cellId);
      expect(new Set(cellIds).size).toBe(1); // All should be the same
    });

    test(`should include proper timestamps for ${label}`, async ({ request }) => {
      const response = await request.get(`${apiUrl}/info`);
      expect(response.status()).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('timestamp');

      // Timestamp should be a valid ISO string
      const timestamp = new Date(data.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();

      // Timestamp should be recent (within last minute)
      const now = new Date();
      const timeDiff = Math.abs(now.getTime() - timestamp.getTime());
      expect(timeDiff).toBeLessThan(60000); // Less than 1 minute
    });
  });

  test('should distribute load across all available cells', async ({ request }) => {
    test.skip(!ROUTING_API_URL, 'ROUTING_API_URL not set — no deployment to test against');

    const testClients = Array.from({ length: 50 }, (_, i) => `load-dist-client-${i}`);
    const routingResults = new Map<string, number>();

    // Route all test clients
    for (const clientId of testClients) {
      const response = await request.get(
        `${ROUTING_API_URL}/admin/client-route/${clientId}`
      );

      if (response.status() === 200) {
        const data = await response.json();
        const cellId = data.targetCell.cellId;
        routingResults.set(cellId, (routingResults.get(cellId) || 0) + 1);
      }
    }

    // Should distribute across multiple cells
    expect(routingResults.size).toBeGreaterThanOrEqual(2);

    // No single cell should get more than 80% of traffic
    const totalRequests = Array.from(routingResults.values()).reduce((a, b) => a + b, 0);
    for (const [cellId, count] of routingResults) {
      const percentage = (count / totalRequests) * 100;
      expect(percentage, `Cell ${cellId} received ${percentage}% of traffic`).toBeLessThan(80);
    }
  });
});
