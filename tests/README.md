# Cell Architecture Demo - Test Suite

This comprehensive test suite validates all components of the Cell Architecture Demo using Playwright.

## Test Coverage

### Admin Dashboard Tests (`admin-dashboard.spec.ts`)
- ✅ Page loading and cell display
- ✅ API calls tracking (`/admin/cells`, `/admin/hash-ring`, `/clients`)
- ✅ Hash ring visualization with virtual node percentages
- ✅ Client routing functionality
- ✅ Recent client activity display
- ✅ Cell URL navigation
- ✅ Router and demo link validation
- ✅ QR code generation

### Cell Pages Tests (`cell-pages.spec.ts`)
- ✅ Individual cell page loading (AZ1 and AZ2)
- ✅ API calls tracking (`/info`, `/health`)
- ✅ Health status display
- ✅ Client ID handling from URL parameters
- ✅ Recent client activity per cell
- ✅ Demo panel functionality
- ✅ 403 error prevention
- ✅ Consistent routing validation

### Router Pages Tests (`router-pages.spec.ts`)
- ✅ Router page loading and UI elements
- ✅ Client routing with result display
- ✅ API calls during routing (`/admin/client-route/`, `/admin/cell-urls`)
- ✅ Auto-router functionality
- ✅ Redirect to target cell with client ID preservation
- ✅ Error handling for failed API calls
- ✅ Input validation

### API Endpoints Tests (`api-endpoints.spec.ts`)
- ✅ `/admin/cells` - Cell information
- ✅ `/admin/hash-ring` - Virtual node distribution
- ✅ `/admin/cell-urls` - Cell URL configuration
- ✅ `/admin/client-route/{clientId}` - Client routing
- ✅ `/clients` - Client tracking data
- ✅ `POST /track-client` - Client visit tracking
- ✅ `POST /qr-code` - QR code generation
- ✅ Consistent routing validation
- ✅ CORS header validation
- ✅ High load testing
- ✅ Invalid input handling

### Cell API Endpoints Tests (`cell-api-endpoints.spec.ts`)
- ✅ `/info` endpoint for each cell
- ✅ `/health` endpoint with status checks
- ✅ `POST /track-client` for individual cells
- ✅ `/clients/cell/{cellId}` - Cell-specific recent clients
- ✅ CORS and OPTIONS request handling
- ✅ Input validation and error handling
- ✅ High frequency request handling
- ✅ Load distribution validation

## Setup and Installation

1. **Install Dependencies**
   ```bash
   cd /Users/georgeseib/Documents/projects/cells/tests
   npm install
   ```

2. **Install Playwright Browsers**
   ```bash
   npm run install:browsers
   ```

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests with Browser UI (Headed Mode)
```bash
npm run test:headed
```

### Run Specific Test File
```bash
npx playwright test admin-dashboard.spec.ts
```

### Debug Tests
```bash
npm run test:debug
```

### Run Tests in Specific Browser
```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

## Test Configuration

- **Base URL**: `https://celladmin.sb.seibtribe.us`
- **Browsers**: Chromium, Firefox, Safari/WebKit
- **Retries**: 2 retries in CI, 0 locally
- **Screenshots**: On failure only
- **Traces**: On first retry

## API Endpoints Tested

### Global Routing API
- Base: `https://lo4603bdh4.execute-api.us-east-1.amazonaws.com/prod`
- Endpoints: `/admin/cells`, `/admin/hash-ring`, `/admin/cell-urls`, `/admin/client-route/{id}`, `/clients`, `/track-client`, `/qr-code`

### Cell-Specific APIs
- **AZ1**: `https://rwa731jg5h.execute-api.us-east-1.amazonaws.com/prod`
- **AZ2**: `https://uqy9mzzp05.execute-api.us-east-1.amazonaws.com/prod`
- Endpoints: `/info`, `/health`, `/track-client`, `/clients/cell/{cellId}`

## Key Validations

### Consistent Hashing
- Same client ID always routes to same cell
- Load distribution across cells (no single cell > 80%)
- Hash values remain consistent

### Client Tracking
- Client visits are properly recorded
- Client ID preservation across redirects
- Recent activity displays correctly per cell

### Health Monitoring
- Health checks return proper status
- Degraded cells return 503 but valid data
- Memory, CPU, and DynamoDB checks validated

### Virtual Node Distribution
- Pie chart shows virtual node percentages (not client distribution)
- Distribution table matches hash ring data
- Total virtual nodes calculation is correct

### Error Handling
- 403 errors are prevented (except acceptable files like favicon.ico)
- Invalid inputs handled gracefully
- API failures show appropriate error messages

## Test Results

Run `npm test` to execute the full suite. Results will be available in:
- Console output for immediate feedback
- HTML report in `playwright-report/` directory
- Screenshots and traces for failed tests

## Continuous Integration

These tests are designed to run in CI environments with:
- Automatic retries for flaky tests
- Parallel execution across browsers
- Comprehensive error reporting
- Performance validation

## Troubleshooting

### Common Issues

1. **Tests timing out**: Increase timeout in `playwright.config.ts`
2. **API calls failing**: Check if services are deployed and healthy
3. **Flaky tests**: Add appropriate waits or increase retries
4. **CORS errors**: Verify API Gateway CORS configuration

### Debug Commands

```bash
# Run with verbose output
npx playwright test --reporter=verbose

# Run single test with debug
npx playwright test admin-dashboard.spec.ts:10 --debug

# Generate trace for analysis
npx playwright test --trace=on
```