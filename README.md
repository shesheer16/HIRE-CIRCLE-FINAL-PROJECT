# HireCircle

AI-powered hiring platform for job seekers and employers, built as a shared product across mobile, web, and backend services.

This repository is being pushed as a checkpoint release. It captures the current state of the platform across product work, backend hardening, mobile workflow expansion, admin tooling, and Andhra Pradesh location intelligence so we can preserve progress cleanly before continuing the remaining work.

## Repo Overview

```text
Hirepp/
├── HIRE-NEW-V1-main/backend/   # Node.js + Express API, matching, auth, jobs, chat, pulse, tests
├── mobile-app/                 # Expo / React Native app for job seekers and employers
├── frontend/                   # React web dashboard and admin surfaces
├── marketing-site/             # Next.js marketing site
├── infrastructure/             # Deployment and infrastructure assets
├── scripts/                    # Repository-level maintenance and validation scripts
├── archive_unused/             # Archived legacy or unused assets kept out of the active path
└── *.md                        # Checklists, structure notes, and certification reports
```

## Current Status

Status as of March 16, 2026:

- Backend hardening is substantially expanded: tighter environment validation, stronger auth/session protections, operational access middleware, widget/embed security work, platform API protections, and broader automated test coverage.
- Mobile product flows have grown significantly: onboarding, profile setup, post job, employer dashboard, applications, auth entry, and connect/pulse surfaces all have active improvements in this checkpoint.
- Andhra Pradesh district and mandal support is now a first-class theme in the codebase through structured location catalogs, normalized location helpers, ranking utilities, and location-aware filtering groundwork.
- Web admin and browser session support now include admin login flows, guarded admin/web session helpers, and notification/session infrastructure for operational dashboards.
- This is still an in-flight product checkpoint, not a final production release. Some flows are improved but still need final end-to-end validation before we call them complete.

## What Is Working

- Shared job seeker and employer product model across the mobile app.
- AI-assisted capture flows for profiles, interviews, and richer job/application data entry.
- Smart matchmaking infrastructure and supporting backend ranking layers.
- Employer-side hiring workflow surfaces including job posting, job management, and application review flows.
- Connect, feed, pulse, and community-oriented product surfaces with ongoing UI and ranking improvements.
- Admin and operational dashboard groundwork on the web app.

## Still In Progress

- Final end-to-end verification for manual job discovery filters in `Find Work`, especially around location-filtered listing behavior.
- Full regression coverage across the recently expanded mobile flows and admin/browser session flows.
- Production deployment hardening beyond the current checkpoint, including environment completeness, observability, and rollout validation.
- Documentation depth for module-by-module ownership, deployment steps, and recovery runbooks.

## Technology Stack

### Backend

- Node.js
- Express
- MongoDB with Mongoose
- Redis-ready runtime integrations
- Socket.IO
- Zod validation
- Jest + Supertest

### Mobile App

- Expo
- React Native
- React Navigation
- AsyncStorage and SecureStore
- Axios
- React Native Maps / charts / media integrations

### Web Surfaces

- React for the dashboard frontend
- Next.js for the marketing site
- TailwindCSS in the web surfaces

## Getting Started

### Backend

```bash
cd HIRE-NEW-V1-main/backend
npm install
npm start
```

Local backend development currently expects at least:

- `MONGO_URI`
- `JWT_SECRET`

Production/staging requires additional infrastructure and provider variables enforced by the backend runtime validator.

### Mobile App

```bash
cd mobile-app
npm install
npx expo start
```

Use Expo Go or a simulator/device to run the app.

### Web Dashboard

```bash
cd frontend
npm install
npm start
```

### Marketing Site

```bash
cd marketing-site
npm install
npm run dev
```

## Security Notes

- `.env` files, logs, uploads, and local-only runtime artifacts are excluded from source control.
- Do not commit MongoDB URIs, JWT secrets, API keys, or provider credentials.
- The backend includes stricter production environment validation and rejects placeholder secrets in production-style runtimes.

## Supporting Docs

- [FINAL_SYSTEM_CHECKLIST.md](./FINAL_SYSTEM_CHECKLIST.md)
- [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)
- [REPO_CLEANUP_REPORT.md](./REPO_CLEANUP_REPORT.md)
- [SCALE_ARCHITECTURE_CERTIFICATION.md](./SCALE_ARCHITECTURE_CERTIFICATION.md)
