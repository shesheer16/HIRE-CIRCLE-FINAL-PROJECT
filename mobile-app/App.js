import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import './src/i18n'; // Load translations

// Screens
import RoleSelectionScreen from './src/screens/RoleSelectionScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import BasicProfileSetupScreen from './src/screens/BasicProfileSetupScreen';
import AccountSetupDetailsScreen from './src/screens/AccountSetupDetailsScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import OTPVerificationScreen from './src/screens/OTPVerificationScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import VerificationRequiredScreen from './src/screens/VerificationRequiredScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';
import VideoRecordScreen from './src/screens/VideoRecordScreen';
import SmartInterviewContainer from './src/containers/SmartInterviewContainer';
import VideoCallScreen from './src/screens/VideoCallScreen';
import EmployerAnalyticsScreen from './src/screens/EmployerAnalyticsScreen';
import AdminDashboardScreen from './src/screens/AdminDashboardScreen';
import PostJobScreen from './src/screens/PostJobScreen';
import JobDetailsScreen from './src/screens/JobDetailsScreen';
import ChatContainer from './src/containers/ChatContainer';
import CompanyDetailsScreen from './src/screens/CompanyDetailsScreen';
import EmployerProfileCreateScreen from './src/screens/EmployerProfileCreateScreen';
import ProfileSetupWizardScreen from './src/screens/ProfileSetupWizardScreen';
import ApplicantTimelineScreen from './src/screens/ApplicantTimelineScreen';
import SubscriptionScreen from './src/screens/SubscriptionScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ProfilesScreen from './src/screens/ProfilesScreen';
import WalletScreen from './src/screens/WalletScreen';
import TransactionHistoryScreen from './src/screens/TransactionHistoryScreen';
import FundEscrowScreen from './src/screens/FundEscrowScreen';
import EscrowDetailScreen from './src/screens/EscrowDetailScreen';
import WithdrawRequestScreen from './src/screens/WithdrawRequestScreen';
import DisputeFormScreen from './src/screens/DisputeFormScreen';
import TermsPrivacyScreen from './src/screens/TermsPrivacyScreen';


import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { Alert, Platform, StatusBar as RNStatusBar } from 'react-native';

import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';
import AppBootSplash from './src/components/AppBootSplash';
import NetworkRetryBanner from './src/components/NetworkRetryBanner';
import { AppStateProvider } from './src/context/AppStateContext';
import SocketService from './src/services/socket';
import Constants from 'expo-constants';
import { navigationRef, navigate } from './src/navigation/navigationRef';
import { answerCall, endCall } from './src/services/WebRTCService';
import { logger } from './src/utils/logger';
import { useAppStore, initAppStoreListeners } from './src/store/AppStore';
import { trackEvent } from './src/services/analytics';
import client, { setApiErrorHandler, setUnauthorizedHandler } from './src/api/client';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { getNormalizedProfileReadiness, isProfileRoleGateError } from './src/utils/profileReadiness';
import { isQaRoleBootstrapEnabled } from './src/utils/authRoleSelection';
import * as Sentry from '@sentry/react-native';

Sentry.init({
    dsn: 'https://6577889ade994073aab05a0d3bbba324@o4505051754954752.ingest.sentry.io/4505051756593152', // Placeholder DSN for HireCircle
    debug: __DEV__,
    tracesSampleRate: 1.0,
});


let SplashScreenApi = {
  preventAutoHideAsync: async () => { },
  hideAsync: async () => { },
};
try {
  SplashScreenApi = require('expo-splash-screen');
} catch {
  // expo-splash-screen is optional in this workspace
}

SplashScreenApi.preventAutoHideAsync().catch(() => { });

const Stack = createStackNavigator();
const APP_BACKGROUND = '#f8fafc';
const APP_STATUS_PURPLE = '#7c3aed';
const AUTH_BYPASS_FOR_QA = isQaRoleBootstrapEnabled();
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const APP_NAV_THEME = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: APP_BACKGROUND,
    card: APP_BACKGROUND,
    border: '#e2e8f0',
  },
};

const normalizeObjectId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') {
    const normalized = value.trim();
    return OBJECT_ID_PATTERN.test(normalized) ? normalized : '';
  }
  if (typeof value === 'object') {
    const nested = normalizeObjectId(value._id || value.id || value.$oid || '');
    return nested || '';
  }
  return '';
};

const AppNav = () => {
  const {
    isLoading,
    userToken,
    userInfo,
    updateUserInfo,
    logout,
    hasCompletedOnboarding,
    authEntryRole,
    pendingPostAuthSetup,
    consumePendingPostAuthSetup,
  } = useContext(AuthContext);
  const { role, setSocketStatus, incrementNotificationsCount, setNotificationsCount } = useAppStore();
  const notificationListener = useRef();
  const responseListener = useRef();
  const hasRunInterviewResumeCheckRef = useRef(false);
  const hasHiddenNativeSplashRef = useRef(false);
  const qaSessionBootstrapRef = useRef(false);
  const [showBootSplash, setShowBootSplash] = useState(true);
  const [profileGateState, setProfileGateState] = useState({
    checking: false,
    requiresSetup: false,
    completion: null,
  });
  const [networkRetryState, setNetworkRetryState] = useState({
    visible: false,
    message: '',
    retry: null,
  });
  const hasActiveSession = Boolean(userToken);
  const isAuthenticated = Boolean(userToken);
  const shouldForceWelcome = __DEV__ && !isAuthenticated;
  const authInitialRouteName = shouldForceWelcome
    ? 'Welcome'
    : (hasCompletedOnboarding ? 'RoleSelection' : 'Welcome');
  const authInitialLoginParams = authEntryRole ? { selectedRole: authEntryRole } : undefined;
  const shouldShowPendingPostAuthSetup = isAuthenticated && Boolean(pendingPostAuthSetup);
  const shouldShowProfileSetup = !shouldShowPendingPostAuthSetup && !AUTH_BYPASS_FOR_QA && profileGateState.requiresSetup;
  const navigatorInitialRouteName = !isAuthenticated
    ? authInitialRouteName
    : shouldShowPendingPostAuthSetup
      ? (pendingPostAuthSetup === 'worker_profile' ? 'ProfileSetupWizard' : 'EmployerProfileCreate')
      : (shouldShowProfileSetup ? 'ProfileSetupWizard' : 'MainTab');
  const navigatorKey = !isAuthenticated
    ? `auth:${authInitialRouteName}:${authEntryRole || 'none'}:${hasCompletedOnboarding ? '1' : '0'}`
    : shouldShowPendingPostAuthSetup
      ? `pending:${pendingPostAuthSetup}`
      : (shouldShowProfileSetup ? 'profile-setup' : 'main-app');

  const resolveBootstrapRole = useCallback(() => {
    const roleFromStore = String(role || '').trim().toLowerCase();
    if (roleFromStore === 'employer' || roleFromStore === 'recruiter') return 'employer';
    if (roleFromStore === 'worker' || roleFromStore === 'candidate') return 'worker';
    const roleFromUser = String(userInfo?.primaryRole || userInfo?.activeRole || '').trim().toLowerCase();
    if (roleFromUser === 'employer' || roleFromUser === 'recruiter') return 'employer';
    return 'worker';
  }, [role, userInfo?.activeRole, userInfo?.primaryRole]);

  const syncUnreadNotificationsCount = useCallback(async () => {
    if (!userToken) {
      setNotificationsCount(0);
      return;
    }

    try {
      const { data } = await client.get('/api/notifications', {
        params: { page: 1, limit: 1 },
        __skipApiErrorHandler: true,
        __allowWhenCircuitOpen: true,
      });
      const unreadCount = Number(data?.unreadCount);
      if (Number.isFinite(unreadCount)) {
        setNotificationsCount(unreadCount);
      }
    } catch (error) {
      logger.warn('Failed to sync notifications count:', error?.message || error);
    }
  }, [setNotificationsCount, userToken]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      RNStatusBar.setBackgroundColor('#ffffff');
      RNStatusBar.setBarStyle('dark-content');
      RNStatusBar.setTranslucent(false);
    }
    initAppStoreListeners();
  }, []);

  useEffect(() => {
    trackEvent('APP_OPEN', {
      platform: Platform.OS,
    });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      if (!userToken) {
        return;
      }

      if (AUTH_BYPASS_FOR_QA) {
        try {
          const { data } = await client.post('/api/auth/dev-bootstrap', {
            role: resolveBootstrapRole(),
          }, {
            __skipUnauthorizedHandler: true,
          });

          if (data?.token) {
            await updateUserInfo?.(data);
            return;
          }
        } catch (_error) {
          // Fall through to logout if recovery fails.
        }
      }
      await logout({ skipServerCall: true });
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [logout, resolveBootstrapRole, updateUserInfo, userToken]);

  useEffect(() => {
    if (!AUTH_BYPASS_FOR_QA) return;

    if (!userToken || !userInfo?.hasSelectedRole) {
      qaSessionBootstrapRef.current = false;
      return;
    }

    if (qaSessionBootstrapRef.current) return;
    qaSessionBootstrapRef.current = true;

    let cancelled = false;
    const syncQaSession = async () => {
      try {
        const { data } = await client.post('/api/auth/dev-bootstrap', {
          role: resolveBootstrapRole(),
        }, {
          __skipUnauthorizedHandler: true,
          __skipApiErrorHandler: true,
        });

        if (!cancelled && data?.token) {
          await updateUserInfo?.(data);
        }
      } catch (_error) {
        // Keep current session if bootstrap refresh fails.
      }
    };

    void syncQaSession();
    return () => {
      cancelled = true;
    };
  }, [resolveBootstrapRole, updateUserInfo, userInfo?.hasSelectedRole, userToken]);

  useEffect(() => {
    const onApiError = (apiError) => {
      if (apiError?.type === 'network') {
        // Keep UI clean in QA/launch-preview mode; feature screens already provide empty states.
        return;
      }

      if (apiError?.type === 'permission') {
        // Role/profile gate errors are handled at screen-level with empty-state UX.
        if (isProfileRoleGateError(apiError) || AUTH_BYPASS_FOR_QA) return;
        return;
      }

      if (apiError?.type === 'validation') {
        // Feature screens already handle validation errors locally with contextual UI.
        return;
      }

      if (apiError?.type === 'server') {
        if (AUTH_BYPASS_FOR_QA) return;
        Alert.alert('Server error', String(apiError?.message || 'Something went wrong on the server. Please retry.'));
      }
    };

    setApiErrorHandler(onApiError);
    return () => {
      setApiErrorHandler(null);
    };
  }, []);

  useEffect(() => {
    const shouldAutoConnectSocket = Boolean(userToken);
    if (shouldAutoConnectSocket) {
      setSocketStatus('connecting');
      SocketService.connect();
    } else {
      setSocketStatus('disconnected');
      SocketService.disconnect();
      if (!userToken) {
        setNotificationsCount(0);
      }
    }
    return () => {
      SocketService.disconnect();
    };
  }, [userToken, setNotificationsCount, setSocketStatus]);

  useEffect(() => {
    void syncUnreadNotificationsCount();
  }, [syncUnreadNotificationsCount, userInfo?._id]);

  useEffect(() => {
    if (!userToken) return undefined;

    const handleRealtimeNotificationCreated = (payload = {}) => {
      const unreadCount = Number(payload?.unreadCount);
      if (Number.isFinite(unreadCount)) {
        setNotificationsCount(unreadCount);
        return;
      }
      incrementNotificationsCount(1);
    };

    const handleRealtimeNotificationRead = (payload = {}) => {
      const unreadCount = Number(payload?.unreadCount);
      if (Number.isFinite(unreadCount)) {
        setNotificationsCount(unreadCount);
        return;
      }
      if (payload?.all) {
        setNotificationsCount(0);
      }
    };

    SocketService.on('notification_created', handleRealtimeNotificationCreated);
    SocketService.on('NOTIFICATION_CREATED', handleRealtimeNotificationCreated);
    SocketService.on('notification_read', handleRealtimeNotificationRead);
    SocketService.on('NOTIFICATION_READ', handleRealtimeNotificationRead);

    return () => {
      SocketService.off('notification_created', handleRealtimeNotificationCreated);
      SocketService.off('NOTIFICATION_CREATED', handleRealtimeNotificationCreated);
      SocketService.off('notification_read', handleRealtimeNotificationRead);
      SocketService.off('NOTIFICATION_READ', handleRealtimeNotificationRead);
    };
  }, [incrementNotificationsCount, setNotificationsCount, userToken]);

  useEffect(() => {
    if (!userToken) return;

    const isExpoGo = (
      Constants.executionEnvironment === 'storeClient'
      || Constants.appOwnership === 'expo'
    );
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
        const applicationId = normalizeObjectId(data?.applicationId || data?.chatId);
        if (data.type === 'message' && applicationId) {
          navigate('Chat', { applicationId });
        } else if (data.type === 'application' && applicationId) {
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
    if (AUTH_BYPASS_FOR_QA) {
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
          const readiness = getNormalizedProfileReadiness({
            hasCompletedProfile: Boolean(completion?.meetsProfileCompleteThreshold),
            profileComplete: Boolean(completion?.meetsProfileCompleteThreshold),
          });
          await updateUserInfo?.({
            hasCompletedProfile: readiness.hasCompletedProfile,
            profileComplete: readiness.profileComplete,
            profileCompletion: completion,
          });
        }
      } catch (error) {
        if (cancelled) return;
        setProfileGateState({
          checking: false,
          requiresSetup: true,
          completion: null,
        });
      }
    };

    void loadProfileGate();
    return () => {
      cancelled = true;
    };
  }, [userInfo?.activeRole, userInfo?.hasCompletedProfile, userInfo?.profileComplete, userToken, updateUserInfo]);

  const handleProfileWizardCompleted = useCallback(async (completion) => {
    setProfileGateState({
      checking: false,
      requiresSetup: false,
      completion: completion || null,
    });
    if (completion) {
      const readiness = getNormalizedProfileReadiness({
        hasCompletedProfile: Boolean(completion?.meetsProfileCompleteThreshold),
        profileComplete: Boolean(completion?.meetsProfileCompleteThreshold),
      });
      await updateUserInfo?.({
        hasCompletedProfile: readiness.hasCompletedProfile,
        profileComplete: readiness.profileComplete,
        profileCompletion: completion,
      });
    }
  }, [updateUserInfo]);

  const handlePendingWorkerSetupCompleted = useCallback(async (completion) => {
    await handleProfileWizardCompleted(completion || null);
    await consumePendingPostAuthSetup?.();
  }, [consumePendingPostAuthSetup, handleProfileWizardCompleted]);

  const handlePendingEmployerSetupCompleted = useCallback(async () => {
    setProfileGateState((prev) => ({
      checking: false,
      requiresSetup: false,
      completion: prev.completion,
    }));
    await consumePendingPostAuthSetup?.();
  }, [consumePendingPostAuthSetup]);

  useEffect(() => {
    let active = true;
    let releaseTimer = null;
    if (isLoading) {
      setShowBootSplash(true);
      return () => {
        active = false;
        if (releaseTimer) clearTimeout(releaseTimer);
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

      if (!active) return;
      releaseTimer = setTimeout(() => {
        if (active) setShowBootSplash(false);
      }, 2500);
    };

    void finalizeBoot();
    return () => {
      active = false;
      if (releaseTimer) clearTimeout(releaseTimer);
    };
  }, [hasActiveSession, isLoading]);

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

  if (showBootSplash || isLoading) {
    return <AppBootSplash showProgress />;
  }

  return (
    <NavigationContainer ref={navigationRef} theme={APP_NAV_THEME}>
      <Stack.Navigator
        key={navigatorKey}
        initialRouteName={navigatorInitialRouteName}
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: APP_BACKGROUND }
        }}
      >
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="RoleSelection" component={RoleSelectionScreen} />
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              initialParams={authInitialLoginParams}
            />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="BasicProfileSetup" component={BasicProfileSetupScreen} />
            <Stack.Screen name="AccountSetupDetails" component={AccountSetupDetailsScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="OTPVerification" component={OTPVerificationScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
            <Stack.Screen name="VerificationRequired" component={VerificationRequiredScreen} />
          </>
        ) : shouldShowPendingPostAuthSetup ? (
          <>
            {pendingPostAuthSetup === 'worker_profile' ? (
              <Stack.Screen name="ProfileSetupWizard">
                {(props) => (
                  <ProfileSetupWizardScreen
                    {...props}
                    completionSnapshot={profileGateState.completion}
                    onCompleted={handlePendingWorkerSetupCompleted}
                  />
                )}
              </Stack.Screen>
            ) : (
              <Stack.Screen name="EmployerProfileCreate">
                {(props) => (
                  <EmployerProfileCreateScreen
                    {...props}
                    onCompleted={handlePendingEmployerSetupCompleted}
                  />
                )}
              </Stack.Screen>
            )}
          </>
        ) : shouldShowProfileSetup ? (
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
            <Stack.Screen name="SmartInterview">
              {(props) => (
                <ErrorBoundary>
                  <SmartInterviewContainer {...props} />
                </ErrorBoundary>
              )}
            </Stack.Screen>
            <Stack.Screen name="VideoRecord" component={VideoRecordScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="MainTab" component={MainTabNavigator} />
            <Stack.Screen name="VideoRecord" component={VideoRecordScreen} />
            <Stack.Screen name="SmartInterview">
              {(props) => (
                <ErrorBoundary>
                  <SmartInterviewContainer {...props} />
                </ErrorBoundary>
              )}
            </Stack.Screen>
            <Stack.Screen name="VideoCall" component={VideoCallScreen} />
            <Stack.Screen name="EmployerAnalytics" component={EmployerAnalyticsScreen} />
            <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
            <Stack.Screen name="PostJob" component={PostJobScreen} />
            <Stack.Screen name="JobDetails" component={JobDetailsScreen} />
            <Stack.Screen name="Chat" component={ChatContainer} />
            <Stack.Screen name="ContactInfo" component={CompanyDetailsScreen} />
            <Stack.Screen name="EmployerProfileCreate" component={EmployerProfileCreateScreen} />
            <Stack.Screen name="ProfileSetupWizard" component={ProfileSetupWizardScreen} />
            <Stack.Screen name="ApplicantTimeline" component={ApplicantTimelineScreen} />
            <Stack.Screen name="Subscription" component={SubscriptionScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
            <Stack.Screen name="Profiles" component={ProfilesScreen} />
            <Stack.Screen name="Wallet" component={WalletScreen} />
            <Stack.Screen name="TransactionHistory" component={TransactionHistoryScreen} />
            <Stack.Screen name="FundEscrow" component={FundEscrowScreen} />
            <Stack.Screen name="EscrowDetail" component={EscrowDetailScreen} />
            <Stack.Screen name="WithdrawRequest" component={WithdrawRequestScreen} />
            <Stack.Screen name="DisputeForm" component={DisputeFormScreen} />
          </>
        )}
        <Stack.Screen name="TermsPrivacy" component={TermsPrivacyScreen} />
      </Stack.Navigator>
      <StatusBar style="dark" backgroundColor="#ffffff" translucent={false} />
      <NetworkRetryBanner
        visible={networkRetryState.visible}
        message={networkRetryState.message}
        onRetry={async () => {
          if (typeof networkRetryState.retry === 'function') {
            try {
              await networkRetryState.retry();
              setNetworkRetryState({ visible: false, message: '', retry: null });
            } catch (_error) { }
          }
        }}
        onDismiss={() => setNetworkRetryState({ visible: false, message: '', retry: null })}
      />
    </NavigationContainer>
  );
};

function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <AppStateProvider>
            <AuthProvider>
              <OfflineBanner />
              <AppNav />
            </AuthProvider>
          </AppStateProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(App);

