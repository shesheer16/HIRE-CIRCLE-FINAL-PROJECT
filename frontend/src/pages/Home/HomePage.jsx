import React from 'react';
import { useNavigate } from 'react-router-dom';

const HomePage = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('userInfo');
    navigate('/');
  };

  return (
    <div style={{ padding: '50px', textAlign: 'center' }}>
      <h1>Welcome to the Dashboard!</h1>
      <p>You have successfully logged in.</p>
      <button 
        onClick={handleLogout}
        style={{ padding: '10px 20px', marginTop: '20px', cursor: 'pointer' }}
      >
        Logout
      </button>
    </div>
  );
};

export default HomePage;