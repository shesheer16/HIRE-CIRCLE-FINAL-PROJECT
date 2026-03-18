import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { logger } from '../utils/logger';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        logger.error('ErrorBoundary caught an error', error);
        Sentry.captureException(error, {
            extra: {
                componentStack: errorInfo?.componentStack,
            },
        });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    }

    render() {
        if (this.state.hasError) {
            const hasNetworkHint = String(this.state.error?.message || '').toLowerCase().includes('network');
            const title = hasNetworkHint ? 'Connection hiccup' : 'We hit a small snag';
            const description = hasNetworkHint
                ? 'Please check your network and try again.'
                : 'This screen can be refreshed safely. Your progress is still saved.';

            return (
                <View style={styles.container}>
                    <Text style={styles.icon}>⚠️</Text>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.subtitle}>{description}</Text>
                    <TouchableOpacity style={styles.button} onPress={this.handleReset}>
                        <Text style={styles.buttonText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return this.props.children;
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        backgroundColor: '#f8fafc',
    },
    icon: {
        fontSize: 36,
        marginBottom: 10,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 14,
        color: '#64748b',
        textAlign: 'center',
        lineHeight: 21,
        marginBottom: 24,
    },
    button: {
        backgroundColor: '#1d4ed8',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 10,
    },
    buttonText: {
        color: '#ffffff',
        fontWeight: '700',
    },
});

export default ErrorBoundary;
