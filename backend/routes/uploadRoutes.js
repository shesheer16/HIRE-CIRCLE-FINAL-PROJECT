const express = require('express');
const router = express.Router();
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegInstaller);
const fs = require('fs');
const path = require('path');
const { extractWorkerDataFromAudio } = require('../services/geminiService');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const User = require('../models/userModel');
const { protect } = require('../middleware/authMiddleware');
const { uploadToS3 } = require('../services/s3Service');

const upload = multer({ dest: path.join(__dirname, '../uploads/') });

router.get('/test', (req, res) => res.send('Upload route is reachable on 5001'));

router.post('/video', protect, upload.single('video'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No video file provided" });

    const videoPath = req.file.path;
    const audioPath = path.join('uploads', `${req.file.filename}.mp3`);

    try {
        // 0. Upload Video to S3 immediately
        console.log(`☁️ Uploading ${req.file.filename} to S3...`);
        const s3Url = await uploadToS3(videoPath, req.file.mimetype || 'video/mp4');
        console.log(`✅ Uploaded to S3: ${s3Url}`);

        // 1. Extract Audio using FFmpeg (Stripping video for Gemini speed)
        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .toFormat('mp3')
                .on('end', resolve)
                .on('error', reject)
                .save(audioPath);
        });

        // 2. Process with Gemini 1.5 Flash
        const isEmployer = req.user.role === 'recruiter' || req.user.role === 'employer' || req.user.primaryRole === 'employer';
        const aiData = await extractWorkerDataFromAudio(audioPath, isEmployer ? 'employer' : 'worker');
        const rawData = Array.isArray(aiData) ? aiData[0] : aiData;

        const parseNumber = (value, fallback = 0) => {
            const normalized = Number.parseInt(String(value ?? '').replace(/[^0-9-]/g, ''), 10);
            return Number.isFinite(normalized) ? normalized : fallback;
        };

        const toSkills = (value) => {
            if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
            if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
            return [];
        };

        let savedProfile;
        let extractedData;
        let createdJob = null;

        if (isEmployer) {
            extractedData = {
                jobTitle: rawData?.jobTitle || rawData?.roleTitle || rawData?.roleName || null,
                companyName: rawData?.companyName || req.user.name || 'My Company',
                requiredSkills: toSkills(rawData?.requiredSkills || rawData?.skills),
                experienceRequired: rawData?.experienceRequired || null,
                salaryRange: rawData?.salaryRange || rawData?.expectedSalary || 'Negotiable',
                shift: rawData?.shift || rawData?.preferredShift || 'flexible',
                location: rawData?.location || rawData?.city || 'Remote',
                description: rawData?.description || 'New hiring requirement from Smart Interview.',
            };

            savedProfile = await EmployerProfile.findOneAndUpdate(
                { user: req.user._id },
                {
                    $set: {
                        companyName: extractedData.companyName || 'My Company',
                        location: extractedData.location || 'Remote',
                        industry: rawData?.industry || undefined,
                        videoIntroduction: {
                            videoUrl: s3Url,
                            transcript: 'Video processed by Gemini AI',
                        },
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            createdJob = await Job.create({
                employerId: req.user._id,
                title: extractedData.jobTitle || 'Open Position',
                companyName: extractedData.companyName || savedProfile.companyName || 'My Company',
                location: extractedData.location || savedProfile.location || 'Remote',
                salaryRange: extractedData.salaryRange || 'Negotiable',
                requirements: extractedData.requiredSkills,
                shift: String(extractedData.shift || 'flexible').toLowerCase() === 'day'
                    ? 'Day'
                    : String(extractedData.shift || 'flexible').toLowerCase() === 'night'
                        ? 'Night'
                        : 'Flexible',
                isPulse: String(req.body?.isPulse || '').toLowerCase() === 'true',
                isOpen: true,
            });
        } else {
            const fullName = String(rawData?.name || rawData?.firstName || req.user.name || '').trim();
            const [firstName = 'Unknown', ...rest] = fullName.split(' ').filter(Boolean);
            const lastName = rest.join(' ');

            extractedData = {
                name: fullName || `${firstName} ${lastName}`.trim(),
                roleTitle: rawData?.roleTitle || rawData?.roleName || null,
                skills: toSkills(rawData?.skills),
                experienceYears: Number.isFinite(rawData?.experienceYears) ? rawData.experienceYears : parseNumber(rawData?.totalExperience, null),
                expectedSalary: rawData?.expectedSalary || null,
                preferredShift: rawData?.preferredShift || 'flexible',
                location: rawData?.location || rawData?.city || null,
                summary: rawData?.summary || 'Profile generated from Smart Interview.',
            };

            savedProfile = await WorkerProfile.findOneAndUpdate(
                { user: req.user._id },
                {
                    $set: {
                        firstName,
                        lastName,
                        city: extractedData.location || 'Unknown',
                        totalExperience: Number.isFinite(extractedData.experienceYears) ? extractedData.experienceYears : 0,
                        videoIntroduction: {
                            videoUrl: s3Url,
                            transcript: 'Video processed by Gemini AI',
                        },
                        roleProfiles: [{
                            roleName: extractedData.roleTitle || 'General',
                            experienceInRole: Number.isFinite(extractedData.experienceYears) ? extractedData.experienceYears : 0,
                            expectedSalary: parseNumber(extractedData.expectedSalary, 0),
                            skills: extractedData.skills,
                            lastUpdated: new Date(),
                        }],
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        }

        // 4. Update Onboarding Flag
        await User.findByIdAndUpdate(req.user._id, { hasCompletedProfile: true });

        // Cleanup files
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        // Video is now on S3, local not needed

        res.status(200).json({
            success: true,
            videoUrl: s3Url,
            extractedData,
            profile: savedProfile,
            job: createdJob,
        });

    } catch (error) {
        console.error("Pipeline Error:", error);
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        res.status(500).json({ message: "Error processing video", error: error.message });
    }
});

module.exports = router;
