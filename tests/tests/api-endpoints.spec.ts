import { test, expect } from '@playwright/test';

test.describe('API Endpoints Tests', () => {
  const baseApiUrl = 'https://lo4603bdh4.execute-api.us-east-1.amazonaws.com/prod';
  
  test('should return cell information from /admin/cells', async ({ request }) => {
    const response = await request.get(`${baseApiUrl}/admin/cells`);
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('cells');
    expect(Array.isArray(data.cells)).toBeTruthy();
    expect(data.cells.length).toBeGreaterThanOrEqual(2);
    
    // Verify cell structure
    for (const cell of data.cells) {
      expect(cell).toHaveProperty('cellId');
      expect(cell).toHaveProperty('region');
      expect(cell).toHaveProperty('availabilityZone');
      expect(cell).toHaveProperty('active');
      expect(typeof cell.active).toBe('boolean');
    }
  });

  test('should return hash ring data from /admin/hash-ring', async ({ request }) => {
    const response = await request.get(`${baseApiUrl}/admin/hash-ring`);
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('distribution');
    expect(data).toHaveProperty('ring');
    expect(data).toHaveProperty('totalVirtualNodes');
    
    // Verify distribution structure
    expect(Array.isArray(data.distribution)).toBeTruthy();
    for (const dist of data.distribution) {
      expect(dist).toHaveProperty('cellId');
      expect(dist).toHaveProperty('virtualNodes');
      expect(dist).toHaveProperty('percentage');
      expect(typeof dist.virtualNodes).toBe('number');
      expect(typeof dist.percentage).toBe('number');
    }
    
    // Verify ring structure
    expect(Array.isArray(data.ring)).toBeTruthy();
    for (const node of data.ring.slice(0, 5)) { // Check first 5
      expect(node).toHaveProperty('position');
      expect(node).toHaveProperty('cellId');
      expect(typeof node.position).toBe('number');
    }
  });

  test('should return cell URLs from /admin/cell-urls', async ({ request }) => {
    const response = await request.get(`${baseApiUrl}/admin/cell-urls`);
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('cellUrls');
    expect(data).toHaveProperty('totalCells');
    
    expect(Array.isArray(data.cellUrls)).toBeTruthy();
    expect(data.cellUrls.length).toBeGreaterThanOrEqual(2);
    
    // Verify cell URL structure
    for (const cellUrl of data.cellUrls) {
      expect(cellUrl).toHaveProperty('cellId');
      expect(cellUrl).toHaveProperty('directUrl');
      expect(cellUrl).toHaveProperty('active');
      expect(cellUrl.directUrl).toMatch(/^https:\/\//);
    }
  });

  test('should route clients correctly via /admin/client-route/{clientId}', async ({ request }) => {
    const testClientId = 'api-test-client-123';
    const response = await request.get(`${baseApiUrl}/admin/client-route/${testClientId}`);
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('clientId');
    expect(data).toHaveProperty('targetCell');
    expect(data).toHaveProperty('hashValue');
    
    expect(data.clientId).toBe(testClientId);
    expect(data.targetCell).toHaveProperty('cellId');
    expect(data.targetCell).toHaveProperty('region');
    expect(data.targetCell).toHaveProperty('availabilityZone');
    expect(typeof data.hashValue).toBe('number');
  });

  test('should return consistent routing for same client ID', async ({ request }) => {
    const testClientId = 'consistency-test-client';
    
    // Make multiple requests for the same client
    const responses = await Promise.all([
      request.get(`${baseApiUrl}/admin/client-route/${testClientId}`),
      request.get(`${baseApiUrl}/admin/client-route/${testClientId}`),
      request.get(`${baseApiUrl}/admin/client-route/${testClientId}`)
    ]);
    
    // All should return 200
    for (const response of responses) {
      expect(response.status()).toBe(200);
    }
    
    // Parse responses
    const data = await Promise.all(responses.map(r => r.json()));
    
    // All should route to the same cell
    const targetCells = data.map(d => d.targetCell.cellId);
    expect(new Set(targetCells).size).toBe(1); // All should be the same
    
    // Hash values should be consistent
    const hashValues = data.map(d => d.hashValue);
    expect(new Set(hashValues).size).toBe(1); // All should be the same
  });

  test('should return client tracking data from /clients', async ({ request }) => {
    const response = await request.get(`${baseApiUrl}/clients`);
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('recentClients');
    expect(data).toHaveProperty('cellClients');
    expect(data).toHaveProperty('clients');
    
    expect(Array.isArray(data.recentClients)).toBeTruthy();
    expect(Array.isArray(data.clients)).toBeTruthy();
    expect(typeof data.cellClients).toBe('object');
  });

  test('should track client visits via POST /track-client', async ({ request }) => {
    const testClientData = {
      clientId: 'api-track-test-client',
      cellId: 'us-east-1-az1',
      sourceIp: '192.168.1.1'
    };
    
    const response = await request.post(`${baseApiUrl}/track-client`, {
      data: testClientData
    });
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('success');
    expect(data.success).toBeTruthy();
  });

  test('should return QR codes via POST /qr-code', async ({ request }) => {
    const qrData = {
      text: 'https://example.com',
      size: 150
    };
    
    const response = await request.post(`${baseApiUrl}/qr-code`, {
      data: qrData
    });
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('qrCodeUrl');
    expect(data.qrCodeUrl).toMatch(/^data:image/);
  });

  test('should handle invalid client IDs gracefully', async ({ request }) => {
    const invalidClientIds = ['', 'null', 'undefined', '<script>alert("xss")</script>'];
    
    for (const clientId of invalidClientIds) {
      const response = await request.get(`${baseApiUrl}/admin/client-route/${encodeURIComponent(clientId)}`);
      
      // Should either return valid routing or proper error
      if (response.status() === 200) {
        const data = await response.json();
        expect(data).toHaveProperty('clientId');
        expect(data).toHaveProperty('targetCell');
      } else {
        expect([400, 404, 422]).toContain(response.status());
      }
    }
  });

  test('should have CORS headers for browser requests', async ({ request }) => {
    const response = await request.get(`${baseApiUrl}/admin/cells`);
    
    expect(response.status()).toBe(200);
    
    const corsHeader = response.headers()['access-control-allow-origin'];
    expect(corsHeader).toBeDefined();
    expect(corsHeader).toBe('*'); // Or specific domain
  });

  test('should handle high load of routing requests', async ({ request }) => {
    const clientIds = Array.from({ length: 20 }, (_, i) => `load-test-client-${i}`);
    
    // Make concurrent requests
    const startTime = Date.now();
    const responses = await Promise.all(
      clientIds.map(clientId => 
        request.get(`${baseApiUrl}/admin/client-route/${clientId}`)
      )
    );
    const endTime = Date.now();
    
    // All should succeed
    for (const response of responses) {
      expect(response.status()).toBe(200);
    }
    
    // Should complete in reasonable time (less than 10 seconds)
    const duration = endTime - startTime;
    expect(duration).toBeLessThan(10000);
    
    // Verify distribution across cells
    const data = await Promise.all(responses.map(r => r.json()));
    const cellDistribution = new Map<string, number>();
    
    for (const item of data) {
      const cellId = item.targetCell.cellId;
      cellDistribution.set(cellId, (cellDistribution.get(cellId) || 0) + 1);
    }
    
    // Should distribute across multiple cells (not all to one cell)
    expect(cellDistribution.size).toBeGreaterThan(1);
  });
});