import React, { useContext, useEffect, useRef } from 'react';
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
import OTPVerificationScreen from './src/screens/OTPVerificationScreen';

import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { ActivityIndicator, View, Alert, Text } from 'react-native';

import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';
import { AppStateProvider } from './src/context/AppStateContext';
import SocketService from './src/services/socket';
import Constants from 'expo-constants';
import { navigationRef, navigate } from './src/navigation/navigationRef';
import { answerCall, endCall } from './src/services/WebRTCService';

const Stack = createStackNavigator();

const AppNav = () => {
  const { isLoading, userToken, hasCompletedOnboarding } = useContext(AuthContext);
  const notificationListener = useRef();
  const responseListener = useRef();

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

  useEffect(() => {
    if (!userToken) return;

    const isExpoGo = Constants.appOwnership === 'expo';
    if (isExpoGo) {
      console.log('Push notifications disabled in Expo Go (SDK 53+).');
      return;
    }

    let notificationSub;
    let responseSub;
    let isActive = true;

    const setupNotifications = async () => {
      const [{ registerForPushNotifications }, Notifications] = await Promise.all([
        import('./src/services/NotificationService'),
        import('expo-notifications'),
      ]);

      if (!isActive) return;

      await registerForPushNotifications();

      notificationSub = Notifications.addNotificationReceivedListener(notification => {
        console.log('Notification received:', notification);
      });

      responseSub = Notifications.addNotificationResponseReceivedListener(response => {
        const data = response?.notification?.request?.content?.data || {};
        if (data.type === 'message' && data.applicationId) {
          navigate('Chat', { applicationId: data.applicationId });
        } else if (data.type === 'application' && data.applicationId) {
          navigate('EmployerDashboard');
        }
      });

      notificationListener.current = notificationSub;
      responseListener.current = responseSub;
    };

    setupNotifications();

    return () => {
      isActive = false;
      const removeSubscription = (subscription) => {
        if (!subscription) return;
        if (typeof subscription.remove === 'function') {
          subscription.remove();
          return;
        }
      };

      removeSubscription(notificationSub || notificationListener.current);
      removeSubscription(responseSub || responseListener.current);
    };
  }, [userToken]);

  useEffect(() => {
    if (!userToken) return;

    const handleIncomingCall = (payload = {}) => {
      const roomId = payload.roomId || payload.applicationId;
      const callerName = payload.callerName || 'Incoming Call';
      Alert.alert('Incoming Call', `${callerName} is calling`, [
        {
          text: 'Decline',
          style: 'cancel',
          onPress: () => roomId && endCall(SocketService, roomId),
        },
        {
          text: 'Answer',
          onPress: () => {
            if (roomId) answerCall(SocketService, roomId);
            navigate('VideoCall', { roomId, applicationId: roomId, otherPartyName: callerName });
          },
        },
      ]);
    };

    SocketService.on('call_incoming', handleIncomingCall);

    return () => {
      SocketService.off('call_incoming');
    };
  }, [userToken]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#9333ea', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900' }}>HIRE</Text>
        <Text style={{ color: '#c084fc', fontSize: 32, fontWeight: '900' }}>CIRCLE</Text>
        <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
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
            <Stack.Screen name="VideoCall" component={require('./src/screens/VideoCallScreen').default} />
            <Stack.Screen name="EmployerDashboard" component={require('./src/screens/EmployerDashboardScreen').default} />
            <Stack.Screen name="EmployerAnalytics" component={require('./src/screens/EmployerAnalyticsScreen').default} />
            <Stack.Screen name="AdminDashboard" component={require('./src/screens/AdminDashboardScreen').default} />
            <Stack.Screen name="PostJob" component={require('./src/screens/PostJobScreen').default} />
            <Stack.Screen name="JobDetails" component={require('./src/screens/JobDetailsScreen').default} />
            <Stack.Screen name="Chat" component={require('./src/screens/ChatScreen').default} />
            <Stack.Screen name="EmployerProfileCreate" component={require('./src/screens/EmployerProfileCreateScreen').default} />
            <Stack.Screen name="ApplicantTimeline" component={require('./src/screens/ApplicantTimelineScreen').default} />
            <Stack.Screen name="Subscription" component={require('./src/screens/SubscriptionScreen').default} />
            <Stack.Screen name="Notifications" component={require('./src/screens/NotificationsScreen').default} options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="OTPVerification" component={OTPVerificationScreen} />
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
