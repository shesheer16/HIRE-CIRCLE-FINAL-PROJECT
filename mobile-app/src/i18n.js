import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

const resources = {
    en: {
        translation: {
            welcome: 'Welcome to Hire',
            findJob: 'Find a Job',
            postJob: 'Post a Need',
            login: 'Log In',
            register: 'Create Account',
            smartInterview: 'Smart Interview',
            settings: {
                language: 'Language',
                english: 'English',
                hindi: 'Hindi',
            },
        }
    },
    hi: {
        translation: {
            welcome: 'Hire में आपका स्वागत है',
            findJob: 'नौकरी खोजें',
            postJob: 'आवश्यकता पोस्ट करें',
            login: 'लॉग इन करें',
            register: 'अकाउंट बनाएं',
            smartInterview: 'स्मार्ट इंटरव्यू',
            settings: {
                language: 'भाषा',
                english: 'अंग्रेज़ी',
                hindi: 'हिंदी',
            },
        }
    }
};

i18n
    .use(initReactI18next)
    .init({
        resources,
        lng: String(Localization.locale || 'en').toLowerCase().startsWith('hi') ? 'hi' : 'en',
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false // react already safes from xss
        }
    });

export default i18n;
