// frontend/src/pages/Login/LoginPage.jsx
import React, { useState } from 'react';
import './LoginPage.css';
import { IoChevronBack } from 'react-icons/io5';
import { motion } from 'framer-motion';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const LoginPage = () => {
  const [activeTab, setActiveTab] = useState('email'); // 'phone' or 'email'
  const [formData, setFormData] = useState({
    email: '',
    phone: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const navigate = useNavigate();

  // Handle Input Changes
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError(''); // Clear error when typing
  };

  // Handle Login Submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    if (activeTab === 'phone') {
      // NOTE: Our current backend only supports Email login.
      // This is a placeholder for future phone logic.
      setError("Phone login is not yet connected to the backend. Please use Email.");
      setLoading(false);
      return;
    }

    try {
      const config = {
        headers: {
          'Content-Type': 'application/json',
        },
      };

      // Sending data to backend
      const { data } = await axios.post(
        '/api/users/login',
        { email: formData.email, password: formData.password },
        config
      );

      console.log('Login Successful:', data);
      localStorage.setItem('userInfo', JSON.stringify(data));
      
      // Redirect to home page
      navigate('/home'); 

    } catch (err) {
      setError(
        err.response && err.response.data.message
          ? err.response.data.message
          : 'Something went wrong'
      );
    }
    setLoading(false);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        {/* Back Button */}
        <button className="back-btn" onClick={() => console.log('Go back')}>
          <IoChevronBack /> Back
        </button>

        {/* Header */}
        <div className="header">
          <h1>Welcome!</h1>
          <p>Sign in to your Job Seeker account</p>
        </div>

        {/* Error Message */}
        {error && <div className="error-message">{error}</div>}

        {/* Tabs */}
        <div className="tab-container">
          {/* Animated Background Pill */}
          <motion.div
            className="tab-background"
            layoutId="activeTab"
            initial={false}
            animate={{
              x: activeTab === 'phone' ? 0 : '100%',
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />

          <button
            className={`tab ${activeTab === 'phone' ? 'active' : ''}`}
            onClick={() => setActiveTab('phone')}
          >
            Phone
          </button>
          <button
            className={`tab ${activeTab === 'email' ? 'active' : ''}`}
            onClick={() => setActiveTab('email')}
          >
            Email
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          
          {/* Phone Inputs */}
          {activeTab === 'phone' && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="input-group"
            >
              <label className="input-label">Phone Number</label>
              <div className="phone-input-container">
                <input
                  type="text"
                  className="input-field country-code"
                  defaultValue="+91"
                  readOnly
                />
                <input
                  type="tel"
                  name="phone"
                  className="input-field"
                  placeholder="98765 43210"
                  value={formData.phone}
                  onChange={handleChange}
                />
              </div>
            </motion.div>
          )}

          {/* Email Input */}
          {activeTab === 'email' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="input-group"
            >
              <label className="input-label">Email Address</label>
              <input
                type="email"
                name="email"
                className="input-field"
                placeholder="user@example.com"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </motion.div>
          )}

          {/* Password Input (Common) */}
          <div className="input-group">
            <label className="input-label">Password</label>
            <input
              type="password"
              name="password"
              className="input-field"
              placeholder="••••••••"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </div>

          <a href="#" className="forgot-password">
            Forgot password?
          </a>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <div className="footer">
          Don't have an account? <span className="link">Sign Up</span>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;