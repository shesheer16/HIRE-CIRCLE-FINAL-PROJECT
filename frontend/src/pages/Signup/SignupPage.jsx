import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import '../Login/LoginPage.css'; // Reusing your existing CSS
import { buildApiUrl } from '../../config/api';

const SignupPage = () => {
  const navigate = useNavigate();

  // 1. Check which role they selected on the Landing Page
  const [role, setRole] = useState('candidate');

  useEffect(() => {
    const selectedRole = localStorage.getItem('selectedRole');
    if (selectedRole) {
      setRole(selectedRole);
    }
  }, []);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const config = { headers: { 'Content-Type': 'application/json' } };

      // Send Name, Email, Password AND the Role we saved earlier
      const { data } = await axios.post(
        buildApiUrl('/api/users/register'),
        { ...formData, role },
        config
      );

      localStorage.setItem('userInfo', JSON.stringify(data));
      if (data.role === 'recruiter') {
        navigate('/recruiter/jobs');
      } else {
        navigate('/candidate/jobs');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed');
    }
    setLoading(false);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="header">
          <h1>Create Account</h1>
          <p>Signing up as a <b>{role === 'candidate' ? 'Job Seeker' : 'Employer'}</b></p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">Full Name</label>
            <input type="text" name="name" className="input-field" placeholder="John Doe" onChange={handleChange} required />
          </div>

          <div className="input-group">
            <label className="input-label">Email Address</label>
            <input type="email" name="email" className="input-field" placeholder="user@example.com" onChange={handleChange} required />
          </div>

          <div className="input-group">
            <label className="input-label">Password</label>
            <input type="password" name="password" className="input-field" placeholder="••••••••" onChange={handleChange} required />
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Creating Account...' : 'Sign Up'}
          </button>
        </form>

        <div className="footer">
          Already have an account? <Link to="/login" className="link">Login</Link>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
