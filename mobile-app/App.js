import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
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
import VideoCallScreen from './src/screens/VideoCallScreen';
import EmployerAnalyticsScreen from './src/screens/EmployerAnalyticsScreen';
import AdminDashboardScreen from './src/screens/AdminDashboardScreen';
import PostJobScreen from './src/screens/PostJobScreen';
import JobDetailsScreen from './src/screens/JobDetailsScreen';
import ChatScreen from './src/screens/ChatScreen';
import CompanyDetailsScreen from './src/screens/CompanyDetailsScreen';
import EmployerProfileCreateScreen from './src/screens/EmployerProfileCreateScreen';
import ProfileSetupWizardScreen from './src/screens/ProfileSetupWizardScreen';
import ApplicantTimelineScreen from './src/screens/ApplicantTimelineScreen';
import SubscriptionScreen from './src/screens/SubscriptionScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';

import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import VerificationRequiredScreen from './src/screens/VerificationRequiredScreen';
import OTPVerificationScreen from './src/screens/OTPVerificationScreen';

import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { View, Alert, Platform, StatusBar as RNStatusBar } from 'react-native';

import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';
import AppBootSplash from './src/components/AppBootSplash';
import { AppStateProvider } from './src/context/AppStateContext';
import SocketService from './src/services/socket';
import Constants from 'expo-constants';
import { navigationRef, navigate } from './src/navigation/navigationRef';
import { answerCall, endCall } from './src/services/WebRTCService';
import { logger } from './src/utils/logger';
import { AppStoreProvider, useAppStore } from './src/store/AppStore';
import { logDemoAnalyticsSummary, trackEvent } from './src/services/analytics';
import { DEMO_MODE } from './src/config';
import client from './src/api/client';

if (!__DEV__) {
  const noop = () => {};
  console.log = noop;
  console.warn = noop;
  console.info = noop;
  console.debug = noop;
}

let SplashScreenApi = {
  preventAutoHideAsync: async () => {},
  hideAsync: async () => {},
};
try {
  // Optional at build-time in offline/local environments.
  // When available, native splash hold/hide is fully enabled.
  SplashScreenApi = require('expo-splash-screen');
} catch {
  // noop fallback
}

SplashScreenApi.preventAutoHideAsync().catch(() => {});

const Stack = createStackNavigator();

const AppNav = () => {
  const { isLoading, userToken, userInfo, updateUserInfo, hasCompletedOnboarding } = useContext(AuthContext);
  const { role, setSocketStatus, incrementNotificationsCount, setNotificationsCount } = useAppStore();
  const notificationListener = useRef();
  const responseListener = useRef();
  const hasRunInterviewResumeCheckRef = useRef(false);
  const hasHiddenNativeSplashRef = useRef(false);
  const [showBootSplash, setShowBootSplash] = useState(true);
  const [profileGateState, setProfileGateState] = useState({
    checking: false,
    requiresSetup: false,
    completion: null,
  });

  useEffect(() => {
    if (Platform.OS === 'android') {
      RNStatusBar.setBackgroundColor('#5b21b6');
      RNStatusBar.setBarStyle('light-content');
      RNStatusBar.setTranslucent(false);
    }
  }, []);

  useEffect(() => {
    trackEvent('APP_OPEN', {
      platform: Platform.OS,
    });
  }, []);

  useEffect(() => {
    if (!DEMO_MODE || !__DEV__) return undefined;

    let mounted = true;
    const logSnapshot = async () => {
      try {
        const { getMockDatasetSummary } = await import('./src/demo/mockApi');
        if (!mounted) return;
        const datasetSummary = getMockDatasetSummary();
        logDemoAnalyticsSummary(datasetSummary);
      } catch (error) {
        logger.warn('Demo metrics snapshot unavailable:', error?.message || error);
      }
    };

    logSnapshot();
    const interval = setInterval(logSnapshot, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (userToken) {
      if (DEMO_MODE) {
        setSocketStatus('connected');
      } else {
        setSocketStatus('connecting');
        SocketService.connect();
      }
    } else {
      setSocketStatus('disconnected');
      SocketService.disconnect();
      setNotificationsCount(0);
    }
    return () => {
      SocketService.disconnect();
    };
  }, [userToken, setNotificationsCount, setSocketStatus]);

  useEffect(() => {
    if (DEMO_MODE) return;
    if (!userToken) return;

    const isExpoGo = Constants.appOwnership === 'expo';
    if (isExpoGo) {
      logger.log('Push notifications disabled in Expo Go (SDK 53+).');
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
        logger.log('Notification received:', notification);
        incrementNotificationsCount(1);
      });

      responseSub = Notifications.addNotificationResponseReceivedListener(response => {
        const data = response?.notification?.request?.content?.data || {};
        if (data.type === 'message' && data.applicationId) {
          navigate('Chat', { applicationId: data.applicationId });
        } else if (data.type === 'application' && data.applicationId) {
          navigate('MainTab', { screen: role === 'employer' ? 'My Jobs' : 'Applications' });
        } else if ((data.type === 'INTERVIEW_READY' || data.type === 'interview_ready') && data.processingId) {
          navigate('SmartInterview', { processingId: data.processingId, fromNotification: true });
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
  }, [userToken, role, incrementNotificationsCount]);

  useEffect(() => {
    if (DEMO_MODE) return;
    if (!userToken) {
      hasRunInterviewResumeCheckRef.current = false;
      return;
    }
    if (hasRunInterviewResumeCheckRef.current) return;

    hasRunInterviewResumeCheckRef.current = true;
    let isMounted = true;

    const resumeInterviewIfNeeded = async () => {
      try {
        const { default: apiClient } = await import('./src/api/client');
        const { data } = await apiClient.get('/api/v2/interview-processing/latest');
        if (!isMounted) return;

        if (data?.processingId && (data?.status === 'pending' || data?.status === 'processing')) {
          navigate('SmartInterview', {
            processingId: data.processingId,
            resumeCheck: true,
          });
        }
      } catch (error) {
        logger.warn('Interview resume check failed:', error?.message || error);
      }
    };

    resumeInterviewIfNeeded();
    return () => {
      isMounted = false;
    };
  }, [userToken]);

  useEffect(() => {
    if (DEMO_MODE) {
      setProfileGateState({
        checking: false,
        requiresSetup: false,
        completion: null,
      });
      return;
    }
    if (!userToken) {
      setProfileGateState({
        checking: false,
        requiresSetup: false,
        completion: null,
      });
      return;
    }

    let cancelled = false;
    const loadProfileGate = async () => {
      setProfileGateState((prev) => ({ ...prev, checking: true }));
      try {
        const { data } = await client.get('/api/users/profile-completion');
        if (cancelled) return;
        const completion = data?.completion || null;
        const requiresSetup = !Boolean(completion?.actions?.canAccessApp);

        setProfileGateState({
          checking: false,
          requiresSetup,
          completion,
        });

        if (completion) {
          await updateUserInfo?.({
            hasCompletedProfile: Boolean(completion?.meetsProfileCompleteThreshold),
            profileCompletion: completion,
          });
        }
      } catch (error) {
        if (cancelled) return;
        const fallbackRequiresSetup = !Boolean(userInfo?.hasCompletedProfile);
        setProfileGateState({
          checking: false,
          requiresSetup: fallbackRequiresSetup,
          completion: null,
        });
      }
    };

    void loadProfileGate();
    return () => {
      cancelled = true;
    };
  }, [userInfo?.activeRole, userInfo?.hasCompletedProfile, userToken, updateUserInfo]);

  const handleProfileWizardCompleted = useCallback(async (completion) => {
    setProfileGateState({
      checking: false,
      requiresSetup: false,
      completion: completion || null,
    });
    if (completion) {
      await updateUserInfo?.({
        hasCompletedProfile: Boolean(completion?.meetsProfileCompleteThreshold),
        profileCompletion: completion,
      });
    }
  }, [updateUserInfo]);

  useEffect(() => {
    let active = true;
    if (isLoading) {
      setShowBootSplash(true);
      return () => {
        active = false;
      };
    }

    const finalizeBoot = async () => {
      if (!hasHiddenNativeSplashRef.current) {
        try {
          await SplashScreenApi.hideAsync();
        } catch {
          // native splash may already be hidden
        }
        hasHiddenNativeSplashRef.current = true;
      }

      setTimeout(() => {
        if (active) {
          setShowBootSplash(false);
        }
      }, 520);
    };

    void finalizeBoot();
    return () => {
      active = false;
    };
  }, [isLoading, userToken, hasCompletedOnboarding]);

  useEffect(() => {
    if (DEMO_MODE) return;
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

  if (showBootSplash || isLoading || (Boolean(userToken) && profileGateState.checking)) {
    return <AppBootSplash showProgress={isLoading} />;
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
          profileGateState.requiresSetup ? (
            <>
              <Stack.Screen name="ProfileSetupWizard">
                {(props) => (
                  <ProfileSetupWizardScreen
                    {...props}
                    completionSnapshot={profileGateState.completion}
                    onCompleted={handleProfileWizardCompleted}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="SmartInterview" component={SmartInterviewScreen} />
              <Stack.Screen name="VideoRecord" component={VideoRecordScreen} />
              <Stack.Screen name="OTPVerification" component={OTPVerificationScreen} />
            </>
          ) : (
            <>
              <Stack.Screen name="MainTab" component={MainTabNavigator} />
              <Stack.Screen name="VideoRecord" component={VideoRecordScreen} />
              <Stack.Screen name="SmartInterview" component={SmartInterviewScreen} />
              <Stack.Screen name="VideoCall" component={VideoCallScreen} />
              <Stack.Screen name="EmployerAnalytics" component={EmployerAnalyticsScreen} />
              <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
              <Stack.Screen name="PostJob" component={PostJobScreen} />
              <Stack.Screen name="JobDetails" component={JobDetailsScreen} />
              <Stack.Screen name="Chat" component={ChatScreen} />
              <Stack.Screen name="ContactInfo" component={CompanyDetailsScreen} />
              <Stack.Screen name="EmployerProfileCreate" component={EmployerProfileCreateScreen} />
              <Stack.Screen name="ApplicantTimeline" component={ApplicantTimelineScreen} />
              <Stack.Screen name="Subscription" component={SubscriptionScreen} />
              <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
              <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
              <Stack.Screen name="OTPVerification" component={OTPVerificationScreen} />
            </>
          )
        ) : (
          // Unauthenticated Stack
          hasCompletedOnboarding ? (
            <>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Register" component={RegisterScreen} />
              <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
              <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
              <Stack.Screen name="VerificationRequired" component={VerificationRequiredScreen} />
            </>
          ) : (
            <>
              <Stack.Screen name="Onboarding" component={OnboardingScreen} />
              <Stack.Screen name="RoleSelection" component={RoleSelectionScreen} />
              <Stack.Screen name="Register" component={RegisterScreen} />
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
              <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
              <Stack.Screen name="VerificationRequired" component={VerificationRequiredScreen} />
            </>
          )
        )}
      </Stack.Navigator>
      <StatusBar style="light" backgroundColor="#5b21b6" translucent={false} />
    </NavigationContainer>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppStateProvider>
          <AuthProvider>
            <AppStoreProvider>
              <OfflineBanner />
              <AppNav />
            </AppStoreProvider>
          </AuthProvider>
        </AppStateProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
