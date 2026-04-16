# HireCircle

Active repository structure for the current app.

## Structure

```text
HIRECIRCLE/
  frontend/  Expo React Native app
  backend/   Node.js + Express API
```

## Requirements

- Node.js 18+
- npm
- MongoDB
- Expo Go for mobile testing

## Frontend

Location: `HIRECIRCLE/frontend`

Install:

```bash
npm install
```

Run:

```bash
EXPO_PUBLIC_API_BASE=http://YOUR_LAN_IP:3000/api npx expo start --lan --clear
```

Notes:

- App name: `HireCircle`
- Expo slug: `hirecircle`
- Android package: `com.lokesh.hirecircle`
- The frontend resolves API fallbacks in development, but using `EXPO_PUBLIC_API_BASE` is recommended.

## Backend

Location: `HIRECIRCLE/backend`

Install:

```bash
npm install
```

Required environment variables:

- `MONGO_URI`
- `JWT_SECRET`

Recommended local development environment:

```bash
NODE_ENV=development
ALLOW_NON_PROD_RUNTIME=true
ALLOW_DEV_BOOTSTRAP=true
HOST=0.0.0.0
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/hirecircle
JWT_SECRET=replace_with_a_long_local_secret
REDIS_ENABLED=false
EXTERNAL_EVENT_BRIDGE_ENABLED=false
```

Run:

```bash
npm start
```

## Local Development Flow

1. Start MongoDB.
2. Start the backend from `HIRECIRCLE/backend`.
3. Start Expo from `HIRECIRCLE/frontend`.
4. Open Expo Go and connect to the shown `exp://...` session.

## Auth Walkthrough Support

For local app walkthroughs, enable:

- `ALLOW_DEV_BOOTSTRAP=true`

That allows the mobile app to use the local dev bootstrap auth path.

## Current Notes

- Logs are kept under `HIRECIRCLE/backend/logs`
- Uploads are stored under `HIRECIRCLE/backend/uploads`
- This repo has been minimized to the active mobile frontend and backend only
