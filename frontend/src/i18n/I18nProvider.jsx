import React, { createContext, useContext, useMemo, useState } from 'react';
import en from './translations/en.json';
import hi from './translations/hi.json';

const I18nContext = createContext(null);

const STORAGE_KEY = 'hire.web.language';

const TRANSLATIONS = {
  en,
  hi,
};

const resolveInitialLanguage = () => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && TRANSLATIONS[saved]) return saved;
  } catch (_error) {
    // no-op
  }
  const browserLanguage = String(navigator.language || 'en').toLowerCase();
  return browserLanguage.startsWith('hi') ? 'hi' : 'en';
};

const getByPath = (dictionary, key) => {
  return String(key || '')
    .split('.')
    .reduce((acc, item) => (acc && Object.prototype.hasOwnProperty.call(acc, item) ? acc[item] : null), dictionary);
};

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(resolveInitialLanguage());

  const setLanguage = (nextLanguage) => {
    const normalized = TRANSLATIONS[nextLanguage] ? nextLanguage : 'en';
    setLanguageState(normalized);
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    } catch (_error) {
      // no-op
    }
  };

  const value = useMemo(() => {
    const dictionary = TRANSLATIONS[language] || TRANSLATIONS.en;

    const t = (key, fallback = '') => {
      const resolved = getByPath(dictionary, key);
      if (resolved === null || resolved === undefined) return fallback || key;
      return resolved;
    };

    return {
      language,
      setLanguage,
      t,
      supportedLanguages: ['en', 'hi'],
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18nContext = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18nContext must be used inside I18nProvider');
  }
  return context;
};
