# 🚀 HireCircle

> **AI-powered hiring platform** for job seekers and employers, built as a shared ecosystem across mobile, web, and backend services.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-v1.0.0--checkpoint-green.svg)

---

## 📖 Overview

HireCircle connects top talent with incredible opportunities through an intelligent matching platform. This repository contains the full stack of applications and services required to run the platform.

### 🏗️ Repository Structure

| Folder | Description |
|--------|-------------|
| 📁 `HIRE-NEW-V1-main/backend/` | **Node.js + Express API** managing matching, auth, jobs, chat, and pulse. |
| 📁 `mobile-app/` | **Expo / React Native app** serving both job seekers and employers. |
| 📁 `frontend/` | **React web dashboard** for administrative surfaces and metrics. |
| 📁 `marketing-site/` | **Next.js marketing site** for user acquisition and product showcase. |
| 📁 `infrastructure/` | Deployment resources and infrastructure assets. |
| 📁 `scripts/` | Repository-level maintenance, CI/CD, and validation scripts. |
| 📁 `archive_unused/` | Legacy or unused assets archived safely out of the active path. |

---

## ✨ Features

- **Dual-Model Mobile App**: Shared job seeker and employer functionality in a single intuitive interface.
- **AI-Assisted Operations**: Streamlined profile capture, interview prep, and richer job/application data entry.
- **Smart Matchmaking**: Intelligent ranking layers and matching infrastructure to connect the right people.
- **Employer Workflow**: Complete hiring pipelines from posting jobs to reviewing applications.
- **Community Pulse**: Connect, feed, and community-oriented social surfaces.
- **Location Intelligence**: Deep integration with Andhra Pradesh district and mandal hierarchies for localized hiring.

---

## 🛠️ Technology Stack

### Backend
- **Core:** Node.js, Express.js
- **Database:** MongoDB with Mongoose
- **Cache & Real-time:** Redis integrations, Socket.IO
- **Validation & Testing:** Zod, Jest, Supertest

### Mobile App
- **Framework:** React Native (Expo)
- **Navigation:** React Navigation
- **Storage:** AsyncStorage, SecureStore
- **Integrations:** React Native Maps, Reanimated, various media integrations

### Web Surfaces
- **Frontend Dashboard:** React, TailwindCSS
- **Marketing Site:** Next.js

---

## 🚀 Getting Started

### 1. Backend (API)

```bash
cd HIRE-NEW-V1-main/backend
npm install
npm start
```
*Requires `.env` variables like `MONGO_URI` and `JWT_SECRET` for local development.*

### 2. Mobile App

```bash
cd mobile-app
npm install
npx expo start
```
*Run using Expo Go on your physical device or a simulator.*

### 3. Web Dashboard

```bash
cd frontend
npm install
npm start
```

### 4. Marketing Site

```bash
cd marketing-site
npm install
npm run dev
```

---

## 🔒 Security Notes

- **Secrets:** `.env` files, logs, and local artifacts are excluded from source control.
- **Credentials:** Never commit MongoDB URIs, JWT secrets, API keys, or provider credentials.
- **Validation:** The backend enforces strict production environment validation and rejects placeholder secrets.

---

## 📚 Documentation

For deeper dives into architecture and structure, refer to:
- [Final System Checklist](./FINAL_SYSTEM_CHECKLIST.md)
- [Project Structure Notes](./PROJECT_STRUCTURE.md)
- [Scale Architecture Certification](./SCALE_ARCHITECTURE_CERTIFICATION.md)
- [Repo Cleanup Report](./REPO_CLEANUP_REPORT.md)
