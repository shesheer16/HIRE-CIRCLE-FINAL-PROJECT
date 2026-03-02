export const navigateToWelcomeFallback = (navigation) => {
    if (!navigation || typeof navigation.navigate !== 'function') return;

    const state = navigation.getState?.() || {};
    const routeNames = state.routeNames || [];
    const currentRoute = state.routes?.[state.index || 0]?.name || '';

    if (routeNames.includes('Onboarding')) {
        navigation.navigate('Onboarding');
        return;
    }

    if (routeNames.includes('Login') && currentRoute !== 'Login') {
        navigation.navigate('Login');
        return;
    }

    if (routeNames.includes('Register') && currentRoute !== 'Register') {
        navigation.navigate('Register');
        return;
    }

    const fallbackRoute = routeNames.includes('Login')
        ? 'Login'
        : (routeNames.includes('Onboarding') ? 'Onboarding' : routeNames[0]);

    if (fallbackRoute && typeof navigation.reset === 'function') {
        navigation.reset({
            index: 0,
            routes: [{ name: fallbackRoute }],
        });
    }
};
