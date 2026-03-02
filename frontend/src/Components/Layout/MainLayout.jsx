import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import TopBar from './TopBar';
// Correct Path: Up one level from Layout to Components
import VideoRecorder from '../VideoRecorder';
import { useI18n } from '../../i18n/useI18n';
import {
  IoChatbubblesOutline,
  IoPeopleOutline,
  IoDocumentTextOutline,
  IoBriefcaseOutline,
  IoSettingsOutline,
  IoVideocam
} from 'react-icons/io5';

const MainLayout = ({ children, role }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isRecordingMode, setIsRecordingMode] = useState(false);
  const { t } = useI18n();

  const getTitle = () => {
    const path = location.pathname.split('/').pop();
    if (!path) return 'Dashboard';
    const keyMap = {
      connect: 'nav.connect',
      profiles: 'nav.profiles',
      applications: 'nav.applications',
      jobs: 'nav.jobs',
      settings: 'nav.settings',
    };
    return t(keyMap[path], path.charAt(0).toUpperCase() + path.slice(1));
  };

  const tabs = [
    { name: t('nav.connect', 'Connect'), icon: <IoChatbubblesOutline />, path: `/${role}/connect` },
    { name: t('nav.profiles', 'Profiles'), icon: <IoPeopleOutline />, path: `/${role}/profiles` },
    { name: t('nav.applications', 'Applications'), icon: <IoDocumentTextOutline />, path: `/${role}/applications` },
    { name: t('nav.jobs', 'Jobs'), icon: <IoBriefcaseOutline />, path: `/${role}/jobs` },
    { name: t('nav.settings', 'Settings'), icon: <IoSettingsOutline />, path: `/${role}/settings` },
  ];

  return (
    <div style={styles.wrapper}>
      <TopBar title={getTitle()} />

      <div style={styles.content}>
        {children}
      </div>

      {/* Persistent Video FAB - WhatsApp Style */}
      {role === 'candidate' && (
        <button
          onClick={() => setIsRecordingMode(true)}
          style={styles.fab}
        >
          <IoVideocam size={28} color="white" />
        </button>
      )}

      {/* Video Recording Modal Overlay */}
      {isRecordingMode && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <button
              onClick={() => setIsRecordingMode(false)}
              style={styles.closeBtn}
            >
              ✕
            </button>
            <VideoRecorder onUploadSuccess={() => {
              setIsRecordingMode(false);
              navigate(`/${role}/profiles`);
            }} />
          </div>
        </div>
      )}

      <nav style={styles.bottomNav}>
        {tabs.map((tab) => (
          <div
            key={tab.name}
            onClick={() => navigate(tab.path)}
            style={{
              ...styles.navItem,
              color: location.pathname === tab.path ? '#4F46E5' : '#6B7280'
            }}
          >
            <div style={styles.icon}>{tab.icon}</div>
            <span style={styles.tabText}>{tab.name}</span>
          </div>
        ))}
      </nav>
    </div>
  );
};

const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#fff',
    position: 'relative'
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    paddingBottom: '70px'
  },
  fab: {
    position: 'fixed',
    bottom: '85px',
    right: '20px',
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: '#4F46E5', // Matching your Indigo theme
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    border: 'none',
    cursor: 'pointer',
    zIndex: 1050,
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '15px'
  },
  modalCard: {
    backgroundColor: '#fff',
    width: '95%',
    maxWidth: '500px',
    borderRadius: '20px',
    padding: '20px',
    position: 'relative',
    maxHeight: '90vh',
    overflowY: 'auto'
  },
  closeBtn: {
    position: 'absolute',
    top: '15px',
    right: '15px',
    background: '#f3f4f6',
    border: 'none',
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    cursor: 'pointer',
    zIndex: 2010,
    fontWeight: 'bold'
  },
  bottomNav: {
    position: 'fixed',
    bottom: 0,
    width: '100%',
    height: '65px',
    backgroundColor: '#fff',
    borderTop: '1px solid #E5E7EB',
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    zIndex: 1000,
    paddingBottom: '5px'
  },
  navItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    cursor: 'pointer'
  },
  icon: { fontSize: '24px' },
  tabText: {
    fontSize: '10px',
    marginTop: '4px',
    fontWeight: '500'
  }
};

export default MainLayout;
