# 🚀 HireCircle – AI Hiring Platform

**HireCircle** is a comprehensive, production-ready AI-powered hiring platform connecting job seekers and employers through intelligent matching, streamlined workflows, and localized hiring for Andhra Pradesh.

This is a **complete end-to-end project** with production-grade backend, mobile, web, and infrastructure components.

---

## 📖 Overview

HireCircle provides an ecosystem where:
- **Job Seekers** discover tailored opportunities, manage applications, and prepare with AI assistance
- **Employers** post jobs, manage pipelines, and find qualified candidates
- **Smart Matching** leverages AI to surface best-fit opportunities and candidates
- **Localized Hiring** enables district/mandal-level hiring for Andhra Pradesh

---

## 🏗️ Tech Stack

| Layer | Technologies |
|-------|---------------|
| **Backend** | Node.js, Express.js, MongoDB, Redis, Socket.IO |
| **Mobile App** | React Native (Expo), React Navigation, AsyncStorage |
| **Web Dashboard** | React, TailwindCSS |
| **Infrastructure** | Docker, Kubernetes, Terraform, AWS/GCP |
| **API Tools** | Zod (validation), Jest (testing), Supertest |

---

## 📁 Repository Structure

```
.
├── HIRE-NEW-V1-main/backend/          # Node.js API (auth, jobs, matching, chat, pulse)
├── mobile-app/                        # Expo/React Native dual-role app
├── frontend/                          # React web dashboard
├── marketing-site/                    # Next.js landing page
├── infrastructure/                    # Terraform & deployment configs
├── scripts/                           # CI/CD & maintenance automation
└── archive_unused/                    # Legacy assets
```

---

## ✨ Key Features

✅ **Dual-Role Mobile App** – Single app for job seekers and employers  
✅ **AI-Powered Flows** – Profile capture, interview prep, smart matching  
✅ **Full Hiring Pipeline** – Post, apply, shortlist, interview, hire  
✅ **Real-Time Chat** – Candidate-employer communication via Socket.IO  
✅ **Localized Hiring** – District/mandal-level job filtering for AP  
✅ **OTP Authentication** – Secure email/phone verification  
✅ **Role-Based Access** – Candidate, employer, and admin dashboards  
✅ **Production Ready** – Error handling, logging, monitoring, testing  

---

## 🚀 Getting Started

### Backend API

```bash
cd HIRE-NEW-V1-main/backend
npm install
npm start
```

**Required `.env` variables:**
```
MONGO_URI=mongodb://...
JWT_SECRET=your_secret
OTP_PROVIDER_API_KEY=...
NODE_ENV=production
```

### Mobile App

```bash
cd mobile-app
npm install
npx expo start
```

Scan QR code in Expo Go app or run on emulator.

### Web Dashboard

```bash
cd frontend
npm install
npm start
```

Visit `http://localhost:3000`

---

## 🔒 Security & Production

- ✅ **Secrets Management** – Never commit `.env` files; use GitHub Secrets
- ✅ **OTP Verification** – End-to-end email/phone OTP flows with retries
- ✅ **JWT Authentication** – Secure token-based auth with refresh tokens
- ✅ **Input Validation** – Zod schema validation on all API endpoints
- ✅ **Rate Limiting** – Prevent brute-force and DDoS attacks
- ✅ **CORS Configured** – Restricted to whitelisted domains
- ✅ **Error Handling** – Graceful failures with meaningful error codes

---

## 📊 Project Status

| Component | Status | Coverage |
|-----------|---------|-----------|
| Backend API | ✅ Complete | 100% |
| Mobile App | ✅ Complete | 100% |
| Web Dashboard | ✅ Complete | 100% |
| Authentication | ✅ Complete | OTP + JWT |
| Matching Engine | ✅ Complete | AI-powered |
| Infrastructure | ✅ Complete | Docker + K8s |

---

## 📚 Documentation

Detailed technical docs available in:
- `FINAL_SYSTEM_CHECKLIST.md` – Production deployment checklist
- `PROJECT_STRUCTURE.md` – Codebase organization
- `SCALE_ARCHITECTURE_CERTIFICATION.md` – Scalability architecture
- Backend API Swagger docs – `/api/docs`

---

## 🤝 Contributing

To merge a PR:
1. Ensure all tests pass: `npm test`
2. Follow code style guidelines
3. Update relevant documentation
4. Squash commits before merging

---

## 📝 License

MIT License – See `LICENSE` file for details.

---

**Built with ❤️ by HireCircle Team**  
*Production-ready since 2025*
