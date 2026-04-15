import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import client from '../api/client';
import { logger } from '../utils/logger';
import ContactInfoView from '../components/contact/ContactInfoView';

const DEFAULT_TIMELINE = [
    { year: '2023', event: 'Reached 10M successful deliveries nationwide' },
    { year: '2021', event: 'Expanded cross-border logistics to SEA regions' },
    { year: '2015', event: 'Founded in Hyderabad as a small bike-fleet' },
];

const PRODUCT_ICONS = ['🚚', '❄️', '🏗️', '🏢', '📦'];

export default function CompanyDetailsScreen({ navigation, route }) {
    const { applicationId, companyId, companyName: companyNameParam } = route.params || {};
    const [details, setDetails] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorText, setErrorText] = useState('');

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                setErrorText('');
                setLoading(true);

                if (companyId) {
                    const [organizationResult, jobsResult] = await Promise.allSettled([
                        client.get(`/api/organizations/${companyId}`),
                        client.get('/api/jobs', { params: { companyId } }),
                    ]);

                    const organization = organizationResult.status === 'fulfilled'
                        ? organizationResult.value?.data?.organization || null
                        : null;
                    const jobList = jobsResult.status === 'fulfilled'
                        ? (Array.isArray(jobsResult.value?.data?.data) ? jobsResult.value.data.data : [])
                        : [];
                    setJobs(jobList);

                    if (organization) {
                        setDetails({
                            companyName: organization.name || companyNameParam || 'Company',
                            location: organization.location || 'Location N/A',
                            industry: organization.industry || 'Industry N/A',
                            avatar: organization.logoUrl || organization.avatar || null,
                            employer: {
                                email: '',
                                phone: '',
                                website: organization.website || '',
                            },
                        });
                        return;
                    }
                }

                if (applicationId) {
                    const res = await client.get(`/api/applications/${applicationId}`);
                    const application = res?.data?.application || res?.data || {};
                    const job = application?.job || {};
                    const employer = application?.employer || {};
                    const fallbackCompanyName = job?.companyName || employer?.companyName || employer?.name || companyNameParam || 'Company';

                    setDetails({
                        companyName: fallbackCompanyName,
                        location: job?.location || employer?.location || 'Location N/A',
                        industry: employer?.industry || 'Industry N/A',
                        avatar: employer?.logoUrl || employer?.avatar || null,
                        employer: {
                            email: employer?.email || '',
                            phone: employer?.phone || '',
                            website: employer?.website || '',
                        },
                    });

                    if (job?._id || job?.title) {
                        setJobs([job]);
                    }
                    return;
                }

                throw new Error('Missing company context');
            } catch (error) {
                logger.error('Fetch company details error:', error);
                setErrorText('Could not load company details.');
            } finally {
                setLoading(false);
            }
        };

        fetchDetails();
    }, [applicationId, companyId, companyNameParam]);

    if (loading) {
        return (
            <SafeAreaView style={styles.centered} edges={['top']}>
                <ActivityIndicator size="large" color="#7c3aed" />
            </SafeAreaView>
        );
    }

    if (!details) {
        return (
            <SafeAreaView style={styles.centered} edges={['top']}>
                <Text style={styles.errorText}>{errorText || 'Could not load company details.'}</Text>
            </SafeAreaView>
        );
    }

    const companyName = details.companyName || companyNameParam || 'Company';
    const location = details.location || 'Location N/A';
    const industry = details.industry || 'Industry N/A';
    const products = (jobs.length > 0 ? jobs : []).map((job, index) => ({
        name: job.title || `Open Role ${index + 1}`,
        icon: PRODUCT_ICONS[index % PRODUCT_ICONS.length],
        desc: `${job.salaryRange || 'Negotiable'}${job.location ? ` • ${job.location}` : ''}`,
    }));

    return (
        <View style={styles.container}>
            <ContactInfoView
                presentation="screen"
                mode="employer"
                title={companyName}
                data={{
                    name: companyName,
                    avatar: details.avatar,
                    headline: 'Moving the world, one delivery at a time.',
                    industryTag: `${industry.toUpperCase()} • ${location.toUpperCase()}`,
                    industry,
                    hq: location,
                    products: products.length > 0 ? products : undefined,
                    timeline: DEFAULT_TIMELINE,
                    contactInfo: {
                        partnership: details.employer?.email || '',
                        support: details.employer?.phone || '',
                        website: details.employer?.website || '',
                    },
                }}
                onBack={() => {
                    if (navigation.canGoBack()) {
                        navigation.goBack();
                        return;
                    }
                    navigation.navigate('MainTab');
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 24,
    },
    errorText: {
        color: '#ef4444',
        fontSize: 16,
        textAlign: 'center',
    },
});
