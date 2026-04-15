const express = require('express');
const router = express.Router();
const { protect, employer } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const {
    interviewScheduleCreateSchema,
    interviewScheduleRescheduleSchema,
} = require('../schemas/requestSchemas');
const {
    createInterviewSchedule,
    completeInterviewSchedule,
    rescheduleInterview,
    listInterviewSchedules,
} = require('../controllers/interviewScheduleController');

router.get('/', protect, listInterviewSchedules);
router.post('/', protect, employer, validate({ body: interviewScheduleCreateSchema }), createInterviewSchedule);
router.put('/:id/complete', protect, employer, completeInterviewSchedule);
router.put('/:id/reschedule', protect, employer, validate({ body: interviewScheduleRescheduleSchema }), rescheduleInterview);

module.exports = router;

