import React from 'react';
import { useI18n } from '../../../i18n/useI18n';

const cardStyle = {
  maxWidth: 560,
  margin: '24px auto',
  padding: '24px',
  borderRadius: 16,
  border: '1px solid #e2e8f0',
  backgroundColor: '#ffffff',
};

const buttonStyle = (active) => ({
  border: '1px solid #cbd5e1',
  background: active ? '#0f172a' : '#f8fafc',
  color: active ? '#ffffff' : '#0f172a',
  borderRadius: 10,
  padding: '8px 14px',
  cursor: 'pointer',
  fontWeight: 600,
});

const CandidateSettings = () => {
  const { language, setLanguage, t } = useI18n();

  return (
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>{t('settings.candidateTitle', 'Candidate Settings')}</h2>
      <p style={{ color: '#475569', marginBottom: 18 }}>{t('settings.description', 'Manage language and global preferences.')}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <strong>{t('settings.language', 'Language')}:</strong>
        <button type="button" style={buttonStyle(language === 'en')} onClick={() => setLanguage('en')}>
          {t('settings.languageEnglish', 'English')}
        </button>
        <button type="button" style={buttonStyle(language === 'hi')} onClick={() => setLanguage('hi')}>
          {t('settings.languageHindi', 'Hindi')}
        </button>
      </div>
    </section>
  );
};

export default CandidateSettings;
