# Cell Architecture API Reference

## Overview
This document maps the frontend pages to their backend API endpoints for the Cell Architecture demo project.

## 1. Admin Page (`celladmin.sb.seibtribe.us`)

### Frontend Location
- **Source**: `/frontend/admin/src/App.tsx`
- **Build Output**: `/frontend/admin/dist/`
- **S3 Bucket**: `cell-demo-admin-ui-021891573713`
- **CloudFront Distribution**: `E329NQI6CDDFY8`

### API Base URL
```javascript
const baseUrl = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000/prod' 
  : 'https://lo4603bdh4.execute-api.us-east-1.amazonaws.com/prod';
```

### API Endpoints Used

#### 1. Get All Cells
- **Endpoint**: `GET /admin/cells`
- **Handler**: `lambda/admin.ts:handleGetCells()`
- **Purpose**: Fetches all registered cells from DynamoDB
- **Response**: 
  ```json
  {
    "cells": [
      {
        "cellId": "us-east-1-az1",
        "region": "us-east-1",
        "availabilityZone": "us-east-1a",
        "weight": 100,
        "active": true,
        "lastHeartbeat": "2025-06-30T10:00:00Z"
      }
    ]
  }
  ```

#### 2. Get Hash Ring Distribution
- **Endpoint**: `GET /admin/hash-ring`
- **Handler**: `lambda/admin.ts:handleGetHashRing()`
- **Purpose**: Returns consistent hash ring visualization data
- **Response**:
  ```json
  {
    "distribution": [
      {
        "cellId": "us-east-1-az1",
        "virtualNodes": 150,
        "percentage": 50.0
      }
    ],
    "ring": [
      {
        "position": 123456,
        "cellId": "us-east-1-az1",
        "region": "us-east-1",
        "az": "us-east-1a"
      }
    ],
    "totalVirtualNodes": 300
  }
  ```

#### 3. Get Client Route
- **Endpoint**: `GET /admin/client-route/{clientId}`
- **Handler**: `lambda/admin.ts:handleGetClientRoute()`
- **Purpose**: Determines which cell a specific client ID routes to
- **Response**:
  ```json
  {
    "clientId": "client-123",
    "targetCell": {
      "cellId": "us-east-1-az1",
      "region": "us-east-1",
      "availabilityZone": "us-east-1a",
      "weight": 100,
      "active": true
    },
    "hashValue": 123456789
  }
  ```

#### 4. Get Cell URLs
- **Endpoint**: `GET /admin/cell-urls`
- **Handler**: `lambda/admin.ts:handleGetCellUrls()`
- **Purpose**: Returns direct access URLs for all cells
- **Response**:
  ```json
  {
    "cellUrls": [
      {
        "cellId": "us-east-1-az1",
        "region": "us-east-1",
        "availabilityZone": "us-east-1a",
        "directUrl": "https://cell-us-east-1-az1.sb.seibtribe.us",
        "routingUrl": "https://cellapi.sb.seibtribe.us/route/",
        "weight": 100,
        "active": true
      }
    ],
    "customDomain": "sb.seibtribe.us",
    "totalCells": 2
  }
  ```

#### 5. Get Recent Clients (NEW)
- **Endpoint**: `GET /admin/recent-clients`
- **Handler**: `lambda/admin.ts:handleGetRecentClients()`
- **Purpose**: Returns last 5 clients from each cell
- **Response**:
  ```json
  {
    "cell-1": ["client-001", "client-037", "client-102", "client-089", "client-156"],
    "cell-2": ["client-023", "client-078", "client-134", "client-067", "client-191"]
  }
  ```

#### 6. Update Cell
- **Endpoint**: `PUT /admin/cells/{cellId}`
- **Handler**: `lambda/admin.ts:handleUpdateCell()`
- **Request Body**:
  ```json
  {
    "active": false,
    "weight": 50
  }
  ```
- **Purpose**: Updates cell configuration (activate/deactivate, change weight)

### Admin Page Features
1. **Cell Status Dashboard**: Shows all cells with health status
2. **Hash Ring Visualization**: Pie chart showing cell distribution
3. **Client Routing Test**: Input client ID to see which cell it routes to
4. **Cell URLs Display**: Shows direct access URLs with QR codes
5. **Recent Clients**: Shows last 5 clients per cell (with fallback demo data)

## 2. Router Page (`cellrouter.sb.seibtribe.us`)

### Frontend Location
- **Source**: `/frontend/router/index.html` and `/frontend/router/auto.html`
- **Build Output**: Static HTML files
- **S3 Bucket**: `cell-demo-router-021891573713`
- **CloudFront Distribution**: (need to check)

### Pages

#### Manual Router (`/index.html`)
- **Purpose**: Manual client ID input for routing demonstration
- **API Endpoint**: `https://cellapi.sb.seibtribe.us/route/{clientId}`
- **Handler**: `lambda/routing.ts`
- **Response**: HTTP 302 redirect to appropriate cell

#### Auto Router (`/auto.html`)
- **Purpose**: Automatic routing based on generated client ID
- **API Endpoint**: `https://cellapi.sb.seibtribe.us/auto`
- **Handler**: `lambda/auto-router.ts`
- **Response**: HTTP 302 redirect with generated client ID

## 3. Cell Content Pages

### Frontend Location
- **Source**: `/frontend/cell/index.html`
- **Build Output**: Static HTML
- **S3 Buckets**: 
  - `cell-demo-us-east-1-az1-content-021891573713`
  - `cell-demo-us-east-1-az2-content-021891573713`
- **CloudFront Distributions**: One per cell

### Cell-Specific APIs
Each cell has its own API Gateway:
- **us-east-1-az1**: `https://rwa731jg5h.execute-api.us-east-1.amazonaws.com/prod`
- **us-east-1-az2**: `https://uqy9mzzp05.execute-api.us-east-1.amazonaws.com/prod`

#### Cell Info Endpoint
- **Endpoint**: `GET /cell-info`
- **Handler**: `lambda/cell-info.ts`
- **Purpose**: Returns information about the specific cell
- **Response**:
  ```json
  {
    "cellId": "us-east-1-az1",
    "region": "us-east-1",
    "availabilityZone": "us-east-1a",
    "requestId": "abc-123",
    "clientId": "client-456"
  }
  ```

## 4. Infrastructure Components

### DynamoDB Tables
1. **cell-demo-cell-registry**: Stores cell configuration
2. **cell-demo-routing-config**: Stores routing configuration
3. **cell-demo-us-east-1-az1-data**: Cell-specific data
4. **cell-demo-us-east-1-az2-data**: Cell-specific data

### Lambda Functions
1. **cell-demo-admin**: Admin API endpoints
2. **cell-demo-routing**: Client routing logic
3. **cell-demo-auto-router**: Auto-routing with generated IDs
4. **cell-demo-qr-generator**: QR code generation
5. **cell-demo-us-east-1-az1**: Cell-specific functions
6. **cell-demo-us-east-1-az2**: Cell-specific functions

### API Gateway
- **Main Routing API**: `lo4603bdh4` (`cell-demo-routing-api`)
- **Cell APIs**: 
  - `rwa731jg5h` (`cell-demo-us-east-1-az1-api`)
  - `uqy9mzzp05` (`cell-demo-us-east-1-az2-api`)

## 5. Common Issues & Solutions

### CORS Errors
- All Lambda responses must include:
  ```javascript
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }
  ```

### Lambda Handler Path
- Current handler path: `dist/lambda/admin.handler`
- Build output structure: `/dist/lambda/[function-name].js`

### CloudFront Caching
- Admin page cache invalidation: `aws cloudfront create-invalidation --distribution-id E329NQI6CDDFY8 --paths "/*"`
- Cache takes 2-15 minutes to clear

### S3 Access
- All S3 buckets use CloudFront OAI (Origin Access Identity)
- Direct S3 access will result in AccessDenied
- Must access through CloudFront URLs