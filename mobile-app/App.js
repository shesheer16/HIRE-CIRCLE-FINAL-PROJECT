import React, { useContext, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import './src/i18n'; // Load translations

// Screens
import OnboardingScreen from './src/screens/OnboardingScreen';
import RoleSelectionScreen from './src/screens/RoleSelectionScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import LoginScreen from './src/screens/LoginScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';
import VideoRecordScreen from './src/screens/VideoRecordScreen';
import SmartInterviewScreen from './src/screens/SmartInterviewScreen';

import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import VerificationRequiredScreen from './src/screens/VerificationRequiredScreen';

import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { ActivityIndicator, View } from 'react-native';

import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';
import { AppStateProvider } from './src/context/AppStateContext';
import SocketService from './src/services/socket';

const Stack = createStackNavigator();

const AppNav = () => {
  const { isLoading, userToken, hasCompletedOnboarding } = useContext(AuthContext);

  useEffect(() => {
    if (userToken) {
      SocketService.connect();
    } else {
      SocketService.disconnect();
    }
    return () => {
      SocketService.disconnect();
    };
  }, [userToken]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#9333ea" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#F9FAFB' }
        }}
      >
        {userToken !== null ? (
          // Authenticated Stack
          <>
            <Stack.Screen name="MainTab" component={MainTabNavigator} />
            <Stack.Screen name="VideoRecord" component={VideoRecordScreen} />
            <Stack.Screen name="SmartInterview" component={SmartInterviewScreen} />
            <Stack.Screen name="EmployerDashboard" component={require('./src/screens/EmployerDashboardScreen').default} />
            <Stack.Screen name="EmployerAnalytics" component={require('./src/screens/EmployerAnalyticsScreen').default} />
            <Stack.Screen name="AdminDashboard" component={require('./src/screens/AdminDashboardScreen').default} />
            <Stack.Screen name="PostJob" component={require('./src/screens/PostJobScreen').default} />
            <Stack.Screen name="JobDetails" component={require('./src/screens/JobDetailsScreen').default} />
            <Stack.Screen name="Chat" component={require('./src/screens/ChatScreen').default} />
            <Stack.Screen name="EmployerProfileCreate" component={require('./src/screens/EmployerProfileCreateScreen').default} />
            <Stack.Screen name="Notifications" component={require('./src/screens/NotificationsScreen').default} options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </>
        ) : (
          // Unauthenticated Stack
          <>
            {!hasCompletedOnboarding && <Stack.Screen name="Onboarding" component={OnboardingScreen} />}
            <Stack.Screen name="RoleSelection" component={RoleSelectionScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
            <Stack.Screen name="VerificationRequired" component={VerificationRequiredScreen} />
          </>
        )}
      </Stack.Navigator>
      <StatusBar style="auto" />
    </NavigationContainer>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <OfflineBanner />
        <AppStateProvider>
          <AuthProvider>
            <AppNav />
          </AuthProvider>
        </AppStateProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
