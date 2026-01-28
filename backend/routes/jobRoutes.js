const express = require('express');
const router = express.Router();
const { 
    createJob, 
    getEmployerJobs, 
    suggestRequirements, 
    deleteJob, 
    updateJob 
} = require('../controllers/jobController');

// Ensure both protect and employer are destructured from the middleware file
const { protect, employer } = require('../middleware/authMiddleware');

// @route   POST /api/jobs
router.post('/', protect, employer, createJob);

// @route   GET /api/jobs/my-jobs
router.get('/my-jobs', protect, employer, getEmployerJobs);

// @route   POST /api/jobs/suggest
router.post('/suggest', protect, employer, suggestRequirements);

// @route   DELETE /api/jobs/:id
router.delete('/:id', protect, employer, deleteJob);

// @route   PUT /api/jobs/:id
router.put('/:id', protect, employer, updateJob);

module.exports = router;