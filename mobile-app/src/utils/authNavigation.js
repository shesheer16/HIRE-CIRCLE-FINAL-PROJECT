const buildTargetRoute = ({ routeNames = [], target = 'Login', selectedRole = null }) => {
    const normalizedTarget = String(target || 'Login').trim();
    if (normalizedTarget === 'RoleSelection' && routeNames.includes('RoleSelection')) {
        return { name: 'RoleSelection', params: undefined };
    }
    if (normalizedTarget === 'Register' && routeNames.includes('Register')) {
        return {
            name: 'Register',
            params: selectedRole ? { selectedRole } : undefined,
        };
    }
    if (routeNames.includes('Login')) {
        return {
            name: 'Login',
            params: selectedRole ? { selectedRole } : undefined,
        };
    }
    if (routeNames.includes('RoleSelection')) {
        return { name: 'RoleSelection', params: undefined };
    }
    if (routeNames.includes('Onboarding')) {
        return { name: 'Onboarding', params: undefined };
    }
    const fallbackName = routeNames[0];
    return fallbackName ? { name: fallbackName, params: undefined } : null;
};

export const navigateToAuthFallback = (navigation, options = {}) => {
    if (!navigation || typeof navigation.navigate !== 'function') return;

    const state = navigation.getState?.() || {};
    const routeNames = state.routeNames || [];
    const targetRoute = buildTargetRoute({
        routeNames,
        target: options?.target,
        selectedRole: options?.selectedRole || null,
    });

    if (!targetRoute) return;

    if (typeof navigation.reset === 'function') {
        navigation.reset({
            index: 0,
            routes: [{
                name: targetRoute.name,
                params: targetRoute.params,
            }],
        });
        return;
    }

    navigation.navigate(targetRoute.name, targetRoute.params);
};

export const handleAuthBackNavigation = (navigation, options = {}) => {
    if (navigation?.canGoBack?.()) {
        navigation.goBack();
        return;
    }
    navigateToAuthFallback(navigation, options);
};

export const navigateToWelcomeFallback = (navigation) => {
    navigateToAuthFallback(navigation, { target: 'RoleSelection' });
};
