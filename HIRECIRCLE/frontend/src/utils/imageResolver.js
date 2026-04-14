import Constants from 'expo-constants';

export const resolveImageUrl = (imagePath, fallbackName = 'User') => {
    if (!imagePath) {
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=f3e8ff&color=7c3aed`;
    }
    
    // If it's already an absolute URL (Cloudinary, S3, http...)
    if (imagePath.startsWith('http')) {
        return imagePath;
    }
    
    // It's a local backend upload. Prepend the backend server IP.
    const baseUrl = process.env.EXPO_PUBLIC_API_BASE || Constants.expoConfig?.extra?.apiUrl || 'http://192.168.1.100:5000';
    
    // Ensure we don't double-slash when joining
    const cleanPath = imagePath.startsWith('/') ? imagePath.substring(1) : imagePath;
    return `${baseUrl}/${cleanPath}`;
};
