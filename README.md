# HireCircle 🚀

> **Smart AI matching for everyone.**
> An AI-powered hiring platform designed to seamlessly connect Job Seekers and Employers through an intelligent matchmaking engine, intuitive mobile app, and scalable backend architecture.

---

## 🏗️ Architecture & Project Structure

The repository is structured into distinct microservices and client apps to ensure scalability, ease of maintenance, and decoupled deployment.

```text
HIRE-NEW-V1/
├── HIRE-NEW-V1-main/
│   └── backend/         # Node.js + Express backend & AI matching engine
├── mobile-app/          # React Native (Expo) mobile application (iOS & Android)
├── frontend/            # React web dashboard for admin/employer management
├── marketing-site/      # Next.js landing page & SEO optimized promotional site
├── config/              # Shared configuration & deployment manifests
├── scripts/             # CLI, maintenance, and database scripts
└── infrastructure/      # Infrastructure as Code (IaC) & deployment configs
```

## 🛠️ Technology Stack

### Backend (`/HIRE-NEW-V1-main/backend`)
- **Runtime:** Node.js + Express
- **Database:** MongoDB (Mongoose) + Redis (Caching)
- **AI/ML:** Custom probabilistic synthesis matching engine + Gemini AI integrations
- **Realtime:** Socket.io (for Chat, Notifications, and Interview updates)
- **Workers:** Background queue processing (SQS, BullMQ) for heavy jobs

### Mobile App (`/mobile-app`)
- **Framework:** React Native + Expo
- **Navigation:** React Navigation (Stack & Tabs)
- **State Management:** React Context API + Custom Hooks
- **Styling:** Custom StyleSheet + Theme provider
- **Animations:** React Native Animated API for smooth micro-interactions

### Frontend & Marketing (`/frontend` & `/marketing-site`)
- **Framework:** React (Dashboard) & Next.js (Marketing)
- **Styling:** TailwindCSS

---

## ✨ Core Features
1. **Role-Based Architecture:** Unified app for both `Job Seekers` and `Employers` (Hybrid Mode).
2. **AI Matchmaking Engine:** Real-time semantic and probabilistic scoring to instantly connect candidates to the perfect jobs.
3. **Smart Interviews:** AI-assisted interviews, scheduling, and insights.
4. **Realtime Connect Platform:** Fully integrated chat, networking feed, and community circles.
5. **Secure Escrow & Bounties:** Built-in financial layer for gig-work and referral bounties.

---

## 🚀 Getting Started

### 1. Backend Setup
```bash
cd HIRE-NEW-V1-main/backend
npm install
npm start
```
*(Requires running MongoDB, Redis instances, and populated `.env` variables)*

### 2. Mobile App Setup
```bash
cd mobile-app
npm install
npx expo start
```
*(Use the Expo Go app on your physical device, or press `i` / `a` to run on iOS/Android simulators)*

### 3. Web Dashboard / Marketing Site
```bash
cd frontend         # Or cd marketing-site
npm install
npm run dev
```

---

## 🔒 Security & Maintenance

- **Keys & Secrets:** Never commit `.env` files or API keys. The `.gitignore` is heavily fortified.
- **Uploads:** User uploads and local DB data (`.mongo-data`) are excluded from source control.
- **Architecture Validation:** Run `npm run check:syntax` in the backend before pushing changes.

---

*For deep technical documentation, architecture decisions, and regression checklists, please see [PROJECT_EXECUTION_MASTER.md](./PROJECT_EXECUTION_MASTER.md).*
