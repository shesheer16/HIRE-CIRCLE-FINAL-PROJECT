import React from 'react';
import { useNavigate } from 'react-router-dom';
import { IoArrowBack, IoLogOutOutline } from 'react-icons/io5';
import { logoutWebSession } from '../../utils/webAuthSession';

const TopBar = ({ title }) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logoutWebSession();
    localStorage.removeItem('selectedRole');
    navigate('/'); // Go back to Landing Page
  };

  return (
    <div style={styles.header}>
      {/* Left: Back Arrow */}
      <button onClick={() => navigate(-1)} style={styles.iconBtn}>
        <IoArrowBack size={24} />
      </button>

      {/* Center: Page Title */}
      <h2 style={styles.title}>{title}</h2>

      {/* Right: Logout Button */}
      <button onClick={handleLogout} style={styles.iconBtn}>
        <IoLogOutOutline size={24} color="#EF4444" />
      </button>
    </div>
  );
};

const styles = {
  header: {
    height: '60px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 15px',
    backgroundColor: '#fff',
    borderBottom: '1px solid #E5E7EB',
    position: 'sticky',
    top: 0,
    zIndex: 1100,
  },
  title: { fontSize: '18px', fontWeight: '700', color: '#111827', margin: 0 },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }
};

export default TopBar;
