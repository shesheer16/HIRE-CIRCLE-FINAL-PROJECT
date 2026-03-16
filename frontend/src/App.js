import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/Landing/LandingPage';
import LoginPage from './pages/Login/LoginPage';
import SignupPage from './pages/Signup/SignupPage';
import ForgotPassword from './pages/ForgotPassword/ForgotPassword';
import MainLayout from './Components/Layout/MainLayout';
import RequireAdminSession from './Components/Auth/RequireAdminSession';
import RequireWebSession from './Components/Auth/RequireWebSession';
import AppNoticeProvider from './Components/Notifications/AppNoticeProvider';

// Candidate Screens
import CandidateConnect from './pages/Dashboard/Candidate/Connect';
import CandidateProfiles from './pages/Dashboard/Candidate/Profiles';
import CandidateApplications from './pages/Dashboard/Candidate/Applications';
import CandidateJobs from './pages/Dashboard/Candidate/Jobs';
import CandidateSettings from './pages/Dashboard/Candidate/Settings';

// Recruiter Screens
import RecruiterConnect from './pages/Dashboard/Recruiter/RecConnect';
import RecruiterProfiles from './pages/Dashboard/Recruiter/RecProfiles';
import RecruiterApplications from './pages/Dashboard/Recruiter/RecApplications';
import RecruiterJobs from './pages/Dashboard/Recruiter/RecJobs';
import RecruiterSettings from './pages/Dashboard/Recruiter/RecSettings';
import AdminLoginPage from './pages/Admin/AdminLoginPage';
import MatchQualityDashboard from './pages/Admin/MatchQualityDashboard';
import MarketControlDashboard from './pages/Admin/MarketControlDashboard';

function App() {
  return (
    <AppNoticeProvider>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/match-quality" element={<RequireAdminSession><MatchQualityDashboard /></RequireAdminSession>} />
          <Route path="/admin/market-control" element={<RequireAdminSession><MarketControlDashboard /></RequireAdminSession>} />

          {/* Candidate Routes */}
          <Route element={<RequireWebSession allowedRoles={['candidate']} />}>
            <Route path="/candidate/connect" element={<MainLayout role="candidate"><CandidateConnect /></MainLayout>} />
            <Route path="/candidate/profiles" element={<MainLayout role="candidate"><CandidateProfiles /></MainLayout>} />
            <Route path="/candidate/applications" element={<MainLayout role="candidate"><CandidateApplications /></MainLayout>} />
            <Route path="/candidate/jobs" element={<MainLayout role="candidate"><CandidateJobs /></MainLayout>} />
            <Route path="/candidate/settings" element={<MainLayout role="candidate"><CandidateSettings /></MainLayout>} />
          </Route>

          {/* Recruiter Routes */}
          <Route element={<RequireWebSession allowedRoles={['recruiter']} />}>
            <Route path="/recruiter/connect" element={<MainLayout role="recruiter"><RecruiterConnect /></MainLayout>} />
            <Route path="/recruiter/profiles" element={<MainLayout role="recruiter"><RecruiterProfiles /></MainLayout>} />
            <Route path="/recruiter/applications" element={<MainLayout role="recruiter"><RecruiterApplications /></MainLayout>} />
            <Route path="/recruiter/jobs" element={<MainLayout role="recruiter"><RecruiterJobs /></MainLayout>} />
            <Route path="/recruiter/settings" element={<MainLayout role="recruiter"><RecruiterSettings /></MainLayout>} />
          </Route>
        </Routes>
      </Router>
    </AppNoticeProvider>
  );
}

export default App;
