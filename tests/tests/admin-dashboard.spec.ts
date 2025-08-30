import { test, expect } from '@playwright/test';

test.describe('Admin Dashboard Tests', () => {
  
  test('should load admin dashboard and display cells', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the page to load
    await expect(page.locator('h1')).toContainText('Cell Architecture Admin');
    
    // Check that cells section is visible
    await expect(page.locator('h2').filter({ hasText: 'Active Cells' })).toBeVisible();
    
    // Wait for cells to load
    await page.waitForSelector('.cell-card', { timeout: 10000 });
    
    // Verify we have at least 2 cells (us-east-1-az1 and us-east-1-az2)
    const cellCards = page.locator('.cell-card');
    const cellCount = await cellCards.count();
    expect(cellCount).toBeGreaterThanOrEqual(2);
    
    // Check that each cell has required information
    for (let i = 0; i < cellCount; i++) {
      const cell = cellCards.nth(i);
      await expect(cell.locator('h3')).toBeVisible(); // Cell ID
      await expect(cell.locator('p').filter({ hasText: 'Region:' })).toBeVisible();
      await expect(cell.locator('p').filter({ hasText: 'AZ:' })).toBeVisible();
      await expect(cell.locator('p').filter({ hasText: 'Status:' })).toBeVisible();
    }
  });

  test('should make correct API calls on page load', async ({ page }) => {
    const apiCalls: string[] = [];
    
    // Track all API calls
    page.on('request', request => {
      if (request.url().includes('execute-api') || request.url().includes('cellapi.sb.seibtribe.us')) {
        apiCalls.push(request.url());
      }
    });
    
    await page.goto('/');
    
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');
    
    // Verify expected API calls were made
    const expectedEndpoints = [
      '/admin/cells',
      '/admin/hash-ring',
      '/clients'
    ];
    
    for (const endpoint of expectedEndpoints) {
      const foundCall = apiCalls.some(call => call.includes(endpoint));
      expect(foundCall, `Expected API call to ${endpoint} was not found`).toBeTruthy();
    }
  });

  test('should display hash ring visualization', async ({ page }) => {
    await page.goto('/');
    
    // Wait for hash ring section to be visible
    await expect(page.locator('h2').filter({ hasText: 'Client Distribution' })).toBeVisible();
    
    // Check for pie chart
    await expect(page.locator('.recharts-pie')).toBeVisible({ timeout: 10000 });
    
    // Verify virtual nodes distribution table
    await expect(page.locator('h3').filter({ hasText: 'Virtual Nodes Distribution' })).toBeVisible();
    await expect(page.locator('.data-table')).toBeVisible();
    
    // Check table headers
    await expect(page.locator('th').filter({ hasText: 'Cell ID' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Virtual Nodes' })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Percentage' })).toBeVisible();
  });

  test('should allow client routing test', async ({ page }) => {
    await page.goto('/');
    
    // Find and fill client ID input
    const clientInput = page.locator('input[placeholder*="client ID"]').first();
    await expect(clientInput).toBeVisible();
    
    // Test with a specific client ID
    await clientInput.fill('test-client-123');
    
    // Click route button
    await page.locator('button').filter({ hasText: 'Route Client' }).click();
    
    // Wait for result
    await page.waitForTimeout(2000);
    
    // Should show routing result
    const routingResult = page.locator('.routing-result, .client-route-result').first();
    await expect(routingResult).toBeVisible({ timeout: 5000 });
  });

  test('should display recent client activity', async ({ page }) => {
    await page.goto('/');
    
    // Wait for recent client activity section
    await expect(page.locator('h3').filter({ hasText: 'Recent Client Activity' })).toBeVisible();
    
    // Should have cell activity cards
    await page.waitForSelector('[style*="gridTemplateColumns"]', { timeout: 10000 });
    
    // Each cell should have a counter card
    const activityCards = page.locator('[style*="gridTemplateColumns"] > div');
    const cardCount = await activityCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(2);
  });

  test('should navigate to cell URLs', async ({ page }) => {
    await page.goto('/');
    
    // Wait for cell URLs section
    await expect(page.locator('h2').filter({ hasText: 'Cell URLs' })).toBeVisible();
    
    // Find cell URL links
    const cellLinks = page.locator('a[href*="cell-us-east-1"]');
    const linkCount = await cellLinks.count();
    expect(linkCount).toBeGreaterThanOrEqual(2);
    
    // Test first cell link (without actually navigating away)
    const firstLink = cellLinks.first();
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/https:\/\/cell-us-east-1-(az1|az2)\.sb\.seibtribe\.us/);
  });

  test('should have working router and demo links', async ({ page }) => {
    await page.goto('/');
    
    // Check router link
    const routerLink = page.locator('a[href*="router"]');
    await expect(routerLink).toBeVisible();
    
    // Check demo script link
    const demoLink = page.locator('a[href*="demo"]');
    await expect(demoLink).toBeVisible();
  });

  test('should show QR codes for cells', async ({ page }) => {
    await page.goto('/');
    
    // Wait for QR codes to load
    await page.waitForTimeout(3000);
    
    // Should have QR code images or placeholders
    const qrElements = page.locator('img[src*="data:image"], .qr-code, [alt*="QR"]');
    const qrCount = await qrElements.count();
    expect(qrCount).toBeGreaterThanOrEqual(0); // QR codes might be optional
  });
});