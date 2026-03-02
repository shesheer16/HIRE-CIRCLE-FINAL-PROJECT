import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

console.log('Test started');
console.log('i18n:', typeof i18n);
console.log('initReactI18next:', typeof initReactI18next);

try {
  const result = i18n.use(initReactI18next);
  console.log('use() succeeded:', !!result);
} catch (error) {
  console.warn('use() failed:', error.message);
}
