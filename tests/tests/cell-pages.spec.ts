import { test, expect } from '@playwright/test';

test.describe('Cell Pages Tests', () => {
  const cellUrls = [
    'https://cell-us-east-1-az1.sb.seibtribe.us',
    'https://cell-us-east-1-az2.sb.seibtribe.us'
  ];

  for (const cellUrl of cellUrls) {
    const cellId = cellUrl.match(/cell-(us-east-1-az\d+)/)?.[1] || 'unknown';
    
    test(`should load ${cellId} cell page correctly`, async ({ page }) => {
      await page.goto(cellUrl);
      
      // Wait for page to load
      await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10000 });
      
      // Should display cell information
      await expect(page.locator('text=/Cell|Region|AZ/')).toBeVisible();
    });

    test(`should make correct API calls for ${cellId}`, async ({ page }) => {
      const apiCalls: string[] = [];
      
      // Track API calls
      page.on('request', request => {
        if (request.url().includes('execute-api')) {
          apiCalls.push(request.url());
        }
      });
      
      await page.goto(cellUrl);
      await page.waitForLoadState('networkidle');
      
      // Should call /info endpoint
      const infoCall = apiCalls.some(call => call.includes('/info'));
      expect(infoCall, `/info endpoint was not called for ${cellId}`).toBeTruthy();
      
      // Should call /health endpoint
      const healthCall = apiCalls.some(call => call.includes('/health'));
      expect(healthCall, `/health endpoint was not called for ${cellId}`).toBeTruthy();
    });

    test(`should display health status for ${cellId}`, async ({ page }) => {
      await page.goto(cellUrl);
      
      // Wait for health check to complete
      await page.waitForTimeout(3000);
      
      // Should show health status
      await expect(page.locator('text=/Health|Status|Active|Healthy/i')).toBeVisible({ timeout: 10000 });
    });

    test(`should handle client ID from URL parameter for ${cellId}`, async ({ page }) => {
      const testClientId = 'test-client-url-param';
      await page.goto(`${cellUrl}?clientId=${testClientId}`);
      
      // Should display the client ID
      await expect(page.locator(`text=${testClientId}, text=Welcome`)).toBeVisible({ timeout: 10000 });
    });

    test(`should show recent client activity for ${cellId}`, async ({ page }) => {
      await page.goto(cellUrl);
      
      // Wait for client activity section
      await page.waitForTimeout(2000);
      
      // Should have some form of client activity display
      await expect(page.locator('text=/Recent|Activity|Client/i')).toBeVisible({ timeout: 10000 });
    });

    test(`should load demo panel for ${cellId}`, async ({ page }) => {
      await page.goto(cellUrl);
      
      // Wait for demo panel script to load
      await page.waitForTimeout(2000);
      
      // Should have demo panel toggle button
      await expect(page.locator('#demo-panel-toggle, button[title*="Demo"]')).toBeVisible({ timeout: 5000 });
    });

    test(`should not have 403 errors for ${cellId}`, async ({ page }) => {
      const failedRequests: string[] = [];
      
      page.on('response', response => {
        if (response.status() === 403) {
          failedRequests.push(response.url());
        }
      });
      
      await page.goto(cellUrl);
      await page.waitForLoadState('networkidle');
      
      // Filter out known issues that might be acceptable
      const criticalFailures = failedRequests.filter(url => 
        !url.includes('favicon.ico') && 
        !url.includes('robots.txt') &&
        !url.includes('.map')
      );
      
      expect(criticalFailures, `Found 403 errors: ${criticalFailures.join(', ')}`).toHaveLength(0);
    });
  }

  test('should route clients correctly between cells', async ({ page }) => {
    // Test that different client IDs route to different cells when appropriate
    const testClients = ['client-a', 'client-b', 'client-c', 'client-d'];
    const routingResults: { [key: string]: string } = {};
    
    for (const clientId of testClients) {
      // Go to admin page to test routing
      await page.goto('https://celladmin.sb.seibtribe.us');
      
      // Fill client ID and test routing
      const clientInput = page.locator('input[placeholder*="client ID"]').first();
      await clientInput.fill(clientId);
      
      await page.locator('button').filter({ hasText: 'Route Client' }).click();
      await page.waitForTimeout(1000);
      
      // Capture which cell it routes to
      const routingResult = page.locator('.routing-result, .client-route-result').first();
      if (await routingResult.isVisible()) {
        const resultText = await routingResult.textContent();
        if (resultText) {
          const cellMatch = resultText.match(/(us-east-1-az\d+)/);
          if (cellMatch) {
            routingResults[clientId] = cellMatch[1];
          }
        }
      }
    }
    
    // Verify that we have routing results
    expect(Object.keys(routingResults).length).toBeGreaterThan(0);
    
    // Verify consistent hashing - same client should always route to same cell
    for (const clientId of testClients) {
      if (routingResults[clientId]) {
        // Test the same client ID again
        await page.goto('https://celladmin.sb.seibtribe.us');
        const clientInput = page.locator('input[placeholder*="client ID"]').first();
        await clientInput.fill(clientId);
        await page.locator('button').filter({ hasText: 'Route Client' }).click();
        await page.waitForTimeout(1000);
        
        const routingResult = page.locator('.routing-result, .client-route-result').first();
        if (await routingResult.isVisible()) {
          const resultText = await routingResult.textContent();
          if (resultText) {
            const cellMatch = resultText.match(/(us-east-1-az\d+)/);
            if (cellMatch) {
              expect(cellMatch[1]).toBe(routingResults[clientId]);
            }
          }
        }
      }
    }
  });
});