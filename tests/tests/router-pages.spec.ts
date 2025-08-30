import { test, expect } from '@playwright/test';

test.describe('Router Pages Tests', () => {
  
  test('should load router page correctly', async ({ page }) => {
    await page.goto('/router.html');
    
    // Wait for page to load
    await expect(page.locator('h1')).toContainText('Cell Architecture Router');
    
    // Should have client input section
    await expect(page.locator('h2').filter({ hasText: 'Direct Client Routing' })).toBeVisible();
    
    // Should have input field and route button
    await expect(page.locator('input[placeholder*="client ID"]')).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Route Now' })).toBeVisible();
  });

  test('should route client to correct cell', async ({ page }) => {
    await page.goto('/router.html');
    
    // Fill in a test client ID
    const testClientId = 'playwright-test-client';
    await page.locator('input[placeholder*="client ID"]').fill(testClientId);
    
    // Click route button
    await page.locator('button').filter({ hasText: 'Route Now' }).click();
    
    // Wait for routing result
    await page.waitForTimeout(3000);
    
    // Should show routing information
    await expect(page.locator('.routing-result, .cell-info')).toBeVisible({ timeout: 10000 });
    
    // Should display the client ID that was routed
    await expect(page.locator(`text=${testClientId}`)).toBeVisible();
    
    // Should display cell information
    await expect(page.locator('text=/Cell:|Region:|AZ:/')).toBeVisible();
  });

  test('should make correct API calls during routing', async ({ page }) => {
    const apiCalls: string[] = [];
    
    page.on('request', request => {
      if (request.url().includes('execute-api') || request.url().includes('cellapi.sb.seibtribe.us')) {
        apiCalls.push(request.url());
      }
    });
    
    await page.goto('/router.html');
    
    // Fill and submit routing request
    await page.locator('input[placeholder*="client ID"]').fill('test-client');
    await page.locator('button').filter({ hasText: 'Route Now' }).click();
    
    await page.waitForTimeout(3000);
    
    // Should call client-route endpoint
    const routeCall = apiCalls.some(call => call.includes('/admin/client-route/'));
    expect(routeCall, 'Client route API call was not made').toBeTruthy();
    
    // Should call cell-urls endpoint
    const cellUrlsCall = apiCalls.some(call => call.includes('/admin/cell-urls'));
    expect(cellUrlsCall, 'Cell URLs API call was not made').toBeTruthy();
  });

  test('should handle auto-routing', async ({ page }) => {
    await page.goto('/auto.html');
    
    // Auto router should automatically route
    await page.waitForTimeout(5000);
    
    // Should show routing status or redirect
    const hasStatusText = await page.locator('text=/Routing|Redirecting|Loading/i').isVisible();
    const hasBeenRedirected = !page.url().includes('auto.html');
    
    expect(hasStatusText || hasBeenRedirected).toBeTruthy();
  });

  test('should redirect to cell after routing', async ({ page }) => {
    // Set up navigation tracking
    let redirectUrl = '';
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        redirectUrl = frame.url();
      }
    });
    
    await page.goto('/router.html');
    
    // Fill and submit routing request
    await page.locator('input[placeholder*="client ID"]').fill('redirect-test-client');
    await page.locator('button').filter({ hasText: 'Route Now' }).click();
    
    // Wait for potential redirect
    await page.waitForTimeout(8000);
    
    // Check if we were redirected to a cell URL
    const currentUrl = page.url();
    const cellUrlPattern = /cell-us-east-1-az\d+\.sb\.seibtribe\.us/;
    
    // Either we should be redirected or see the redirect message
    const isOnCellPage = cellUrlPattern.test(currentUrl);
    const hasRedirectMessage = await page.locator('text=/Redirecting/i').isVisible();
    
    expect(isOnCellPage || hasRedirectMessage).toBeTruthy();
  });

  test('should preserve client ID in redirect URL', async ({ page }) => {
    await page.goto('/router.html');
    
    const testClientId = 'preserve-test-client';
    
    // Track navigation for client ID parameter
    page.on('framenavigated', async frame => {
      if (frame === page.mainFrame() && frame.url().includes('cell-us-east-1')) {
        const url = new URL(frame.url());
        const clientIdParam = url.searchParams.get('clientId');
        expect(clientIdParam).toBe(testClientId);
      }
    });
    
    await page.locator('input[placeholder*="client ID"]').fill(testClientId);
    await page.locator('button').filter({ hasText: 'Route Now' }).click();
    
    // Wait for potential redirect
    await page.waitForTimeout(8000);
  });

  test('should handle routing errors gracefully', async ({ page }) => {
    // Block API calls to simulate error
    await page.route('**/admin/client-route/**', route => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });
    
    await page.goto('/router.html');
    
    await page.locator('input[placeholder*="client ID"]').fill('error-test-client');
    await page.locator('button').filter({ hasText: 'Route Now' }).click();
    
    await page.waitForTimeout(3000);
    
    // Should show error message
    await expect(page.locator('.error, text=/error/i')).toBeVisible({ timeout: 5000 });
  });

  test('should validate input requirements', async ({ page }) => {
    await page.goto('/router.html');
    
    // Try to route without entering client ID
    await page.locator('button').filter({ hasText: 'Route Now' }).click();
    
    await page.waitForTimeout(1000);
    
    // Should show validation message or focus input
    const inputFocused = await page.locator('input[placeholder*="client ID"]').isFocused();
    const hasValidationMessage = await page.locator('text=/enter.*client.*id/i').isVisible();
    
    expect(inputFocused || hasValidationMessage).toBeTruthy();
  });
});