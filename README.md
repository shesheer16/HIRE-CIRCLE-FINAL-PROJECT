# HireCircle

HireCircle is a mobile-first hiring platform built around two primary user types:

- workers looking for jobs, community, applications, and interview support
- employers recruiting talent, posting jobs, managing applicants, and running hiring workflows

This repository has been intentionally minimized to the active application only. It now contains only:

- `frontend/` - the Expo React Native mobile app
- `backend/` - the Node.js + Express API and realtime server

## What The App Includes

### Shared app flows

- welcome and onboarding
- role selection
- sign in and create account
- forgot password, OTP verification, and reset password
- notifications
- chat
- settings
- terms and privacy

### Worker experience

- Connect hub
- profile and profile setup
- applications
- jobs discovery
- Smart Interview
- video recording
- video calls
- wallet
- transaction history
- escrow and withdrawal flows
- dispute submission

### Employer experience

- Connect hub
- talent browsing
- applications review
- employer dashboard
- post job
- employer profile setup
- applicant timeline
- subscription flow
- employer analytics

### Connect hub

The Connect section is a major part of the app and includes:

- Feed
- Pulse
- Circles
- Academy
- Bounties
- referral and profile overlays

## Current Mobile Navigation

The app uses a stack navigator in `frontend/App.js` and role-based bottom tabs in `frontend/src/navigation/MainTabNavigator.js`.

### Auth and entry screens

- `Welcome`
- `Onboarding`
- `RoleSelection`
- `Login`
- `Register`
- `BasicProfileSetup`
- `AccountSetupDetails`
- `ForgotPassword`
- `OTPVerification`
- `ResetPassword`
- `VerificationRequired`

### Main tabs by role

Worker tabs:

- `Connect`
- `Profiles`
- `Applications`
- `Jobs`
- `Settings`

Employer tabs:

- `Connect`
- `Talent`
- `Applications`
- `My Jobs`
- `Settings`

### Additional stack screens

- `MainTab`
- `ProfileSetupWizard`
- `EmployerProfileCreate`
- `SmartInterview`
- `VideoRecord`
- `VideoCall`
- `EmployerAnalytics`
- `AdminDashboard`
- `PostJob`
- `JobDetails`
- `Chat`
- `ContactInfo`
- `ApplicantTimeline`
- `Subscription`
- `Notifications`
- `Profiles`
- `Wallet`
- `TransactionHistory`
- `FundEscrow`
- `EscrowDetail`
- `WithdrawRequest`
- `DisputeForm`
- `TermsPrivacy`

## Backend Coverage

The backend is a Node.js + Express application with MongoDB, Socket.IO, JWT-based auth, and optional operational integrations.

### Major backend domains

Auth and identity:

- auth
- user
- admin auth
- privacy
- settings

Hiring and matching:

- jobs
- applications
- employer
- talent and matching
- offers
- subscriptions
- interview scheduling and interview processing

Communication and engagement:

- chat
- notifications
- feed
- pulse
- circles
- academy
- bounties

Financial and platform:

- payments
- financial routes
- wallet-related flows
- reports
- analytics
- admin and platform routes

Uploads and integrations:

- uploads
- SDK routes
- public API routes
- external integration routes

### Service boundaries

The backend mounts service boundaries from `backend/modules/index.js`:

- auth service
- interview service
- match service
- chat service
- feed service
- admin service
- notification service

### API docs

Swagger UI is mounted at `/api-docs` and is protected by operational-access middleware.

## Tech Stack

### Frontend

- Expo 54
- React 19
- React Native 0.81
- React Navigation
- Async Storage
- Expo Camera
- Expo Notifications
- Expo Secure Store
- Reanimated
- Socket.IO client
- Sentry

### Backend

- Node.js 18+
- Express
- MongoDB + Mongoose
- Socket.IO
- JWT
- Redis support, optional in local development
- Swagger UI
- Sentry
- OpenAI SDK
- Google Generative AI SDK

## Repository Structure

```text
HIRECIRCLE/
  README.md
  .gitignore
  frontend/
    App.js
    app.json
    index.js
    assets/
    src/
      api/
      components/
      config/
      containers/
      context/
      hooks/
      navigation/
      screens/
      services/
      store/
      theme/
      utils/
  backend/
    index.js
    package.json
    config/
    controllers/
    middleware/
    models/
    modules/
    routes/
    schemas/
    services/
    utils/
    workflow/
    uploads/
    logs/
```

## Frontend Configuration

Key frontend runtime values come from `frontend/app.json` and `frontend/src/config.js`.

Important details:

- app name: `HireCircle`
- Expo slug: `hirecircle`
- Android package: `com.lokesh.hirecircle`
- default development API fallback starts from localhost and then tries Expo LAN-compatible alternatives
- the preferred frontend API variable is `EXPO_PUBLIC_API_BASE`

Useful frontend environment variables:

- `EXPO_PUBLIC_API_BASE`
- `EXPO_PUBLIC_FEATURE_MATCH_UI_V1`
- `EXPO_PUBLIC_FEATURE_SETTINGS_ADVANCED`

## Backend Configuration

The backend boots from `backend/index.js` and refuses non-production direct startup unless local debugging is explicitly allowed.

Required backend environment variables:

- `MONGO_URI`
- `JWT_SECRET`

Useful local development environment variables:

- `NODE_ENV=development`
- `ALLOW_NON_PROD_RUNTIME=true`
- `ALLOW_DEV_BOOTSTRAP=true`
- `HOST=0.0.0.0`
- `PORT=3000`
- `REDIS_ENABLED=false`
- `EXTERNAL_EVENT_BRIDGE_ENABLED=false`

Optional integration variables:

- `GOOGLE_API_KEY`
- `SENTRY_DSN`
- SMTP-related variables if email flows are used

## Local Development Setup

### Requirements

- Node.js 18 or newer
- npm
- local MongoDB
- Expo Go on a physical device or emulator

### 1. Install dependencies

Frontend:

```bash
cd HIRECIRCLE/frontend
npm install
```

Backend:

```bash
cd HIRECIRCLE/backend
npm install
```

### 2. Start the backend

```bash
cd HIRECIRCLE/backend
NODE_ENV=development \
ALLOW_NON_PROD_RUNTIME=true \
ALLOW_DEV_BOOTSTRAP=true \
HOST=0.0.0.0 \
PORT=3000 \
MONGO_URI=mongodb://127.0.0.1:27017/hirecircle \
JWT_SECRET=replace_with_a_long_local_secret \
REDIS_ENABLED=false \
EXTERNAL_EVENT_BRIDGE_ENABLED=false \
npm start
```

### 3. Start the mobile app

Replace `YOUR_LAN_IP` with the machine IP reachable from your phone.

```bash
cd HIRECIRCLE/frontend
EXPO_PUBLIC_API_BASE=http://YOUR_LAN_IP:3000/api npx expo start --lan --clear
```

### 4. Open the app

- open Expo Go
- scan the QR code or open the `exp://...` session shown by Expo

## Local Auth Walkthrough Mode

For local testing, the backend exposes a dev bootstrap auth path when:

- `ALLOW_DEV_BOOTSTRAP=true`

The mobile app also contains local walkthrough support around that flow, which is useful for demos and non-production testing.

## Active Files That Matter Most

Frontend:

- `frontend/App.js`
- `frontend/src/navigation/MainTabNavigator.js`
- `frontend/src/context/AuthContext.js`
- `frontend/src/config.js`
- `frontend/src/api/client.js`

Backend:

- `backend/index.js`
- `backend/config/db.js`
- `backend/config/env.js`
- `backend/routes/authRoutes.js`
- `backend/modules/index.js`

## Common Troubleshooting

### Expo Go keeps buffering

- make sure the backend is running on port `3000`
- make sure Expo is serving on the same LAN your phone is using
- close Expo Go completely and reconnect to the fresh `exp://...` session
- if Expo prompts for account verification in the terminal, choose `Proceed anonymously`

### Backend refuses to start locally

- ensure `ALLOW_NON_PROD_RUNTIME=true` is set
- ensure MongoDB is available at the `MONGO_URI`
- ensure `JWT_SECRET` is set

### Auth walkthrough is not working

- ensure `ALLOW_DEV_BOOTSTRAP=true` is set in the backend runtime

## Current Repository State

- this repo is intentionally trimmed to the active app only
- `frontend/` is the only kept client
- `backend/` is the only kept server
- logs are stored in `backend/logs`
- uploads are stored in `backend/uploads`
