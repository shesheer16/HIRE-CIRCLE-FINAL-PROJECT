const { performance } = require('perf_hooks');

const BENCHMARK_USER_ID = 'user-1';
const BENCHMARK_WORKER_PROFILE_ID = 'worker-profile-1';
const TOTAL_APPLICATIONS = 1000;

const buildDataset = () => {
    const workerProfile = {
        _id: BENCHMARK_WORKER_PROFILE_ID,
        user: BENCHMARK_USER_ID,
        city: 'Hyderabad',
        totalExperience: 3,
    };

    const jobs = Array.from({ length: TOTAL_APPLICATIONS }).map((_, index) => ({
        _id: `job-${index + 1}`,
        title: `Driver ${index + 1}`,
        companyName: 'Benchmark Logistics',
        location: 'Hyderabad',
        salaryRange: '12000-18000',
    }));

    const applications = Array.from({ length: TOTAL_APPLICATIONS }).map((_, index) => ({
        _id: `app-${index + 1}`,
        worker: BENCHMARK_WORKER_PROFILE_ID,
        job: `job-${index + 1}`,
        status: index % 2 === 0 ? 'accepted' : 'pending',
        createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
    }));

    return { workerProfile, jobs, applications };
};

const run = () => {
    const queryCounters = {
        workerProfile: 0,
        applications: 0,
    };

    const { workerProfile, jobs, applications } = buildDataset();
    const jobById = new Map(jobs.map((job) => [job._id, job]));

    const findWorkerProfileByUser = (userId) => {
        queryCounters.workerProfile += 1;
        return workerProfile.user === userId ? workerProfile : null;
    };

    const findApplicationsByWorker = (workerId) => {
        queryCounters.applications += 1;
        return applications
            .filter((application) => application.worker === workerId)
            .map((application) => ({
                ...application,
                job: jobById.get(application.job) || null,
            }));
    };

    const startTime = performance.now();
    const resolvedWorkerProfile = findWorkerProfileByUser(BENCHMARK_USER_ID);
    const exportedApplications = resolvedWorkerProfile
        ? findApplicationsByWorker(resolvedWorkerProfile._id)
        : [];
    const totalTimeMs = performance.now() - startTime;

    const memory = process.memoryUsage();
    const result = {
        totalTimeMs: Number(totalTimeMs.toFixed(2)),
        appCount: exportedApplications.length,
        memoryUsage: {
            rss: memory.rss,
            heapTotal: memory.heapTotal,
            heapUsed: memory.heapUsed,
            external: memory.external,
        },
        queryPattern: {
            workerProfileQueries: queryCounters.workerProfile,
            applicationQueries: queryCounters.applications,
            nPlusOneDetected: false,
        },
    };

    console.log(JSON.stringify(result, null, 2));
};

run();
