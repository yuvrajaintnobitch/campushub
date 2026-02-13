const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');
const crypto = require('crypto');

// POST /api/checkin/generate/:eventId - Generate check-in code
router.post('/generate/:eventId', authenticate, async (req, res) => {
    try {
        const checkinCode = crypto.randomBytes(6).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Store in event metadata (using description temporarily, or create a new field)
        // For prototype, we'll use a simple approach
        res.json({
            event_id: req.params.eventId,
            checkin_code: checkinCode,
            checkin_url: `${req.protocol}://${req.get('host')}/api/checkin/verify/${checkinCode}`,
            qr_data: `CAMPUSHUB-CHECKIN:${req.params.eventId}:${checkinCode}`,
            expires_at: expiresAt,
            instructions: 'Share this code or QR with attendees. They can use it to check in.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/checkin/attend - Mark attendance
router.post('/attend', authenticate, async (req, res) => {
    try {
        const { event_id } = req.body;

        const { data, error } = await supabase
            .from('event_registrations')
            .update({
                status: 'attended',
                checked_in_at: new Date()
            })
            .eq('event_id', event_id)
            .eq('user_id', req.userId)
            .select()
            .single();

        if (error) {
            return res.status(400).json({ error: 'Registration not found. Please register first.' });
        }

        // Create notification
        await supabase.from('notifications').insert({
            user_id: req.userId,
            type: 'checked_in',
            title: 'Checked In! ✅',
            message: 'You have been marked as attended. Certificate will be available after the event.',
            icon: '✅'
        });

        res.json({
            message: 'Successfully checked in! ✅',
            checked_in_at: data.checked_in_at
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/checkin/status/:eventId - Get check-in status for event
router.get('/status/:eventId', authenticate, async (req, res) => {
    try {
        const { data: registrations } = await supabase
            .from('event_registrations')
            .select('status, checked_in_at, users(name, department)')
            .eq('event_id', req.params.eventId);

        const total = (registrations || []).length;
        const checkedIn = (registrations || []).filter(r => r.status === 'attended').length;
        const pending = total - checkedIn;

        res.json({
            total_registered: total,
            checked_in: checkedIn,
            pending: pending,
            check_in_rate: total > 0 ? Math.round((checkedIn / total) * 100) + '%' : '0%',
            attendees: (registrations || []).map(r => ({
                name: r.users?.name,
                department: r.users?.department,
                status: r.status,
                checked_in_at: r.checked_in_at
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;