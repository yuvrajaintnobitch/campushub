const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');
const crypto = require('crypto');

// GET /api/certificates/my - Get all my certificates
router.get('/my', authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('certificates')
            .select(`
                *,
                events (id, title, event_date, icon, color, clubs(id, name))
            `)
            .eq('user_id', req.userId)
            .order('issued_at', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/certificates/generate/:eventId - Generate certificate for attendee
router.post('/generate/:eventId', authenticate, async (req, res) => {
    try {
        const { user_id, certificate_type } = req.body;
        const targetUserId = user_id || req.userId;

        // Check if user attended
        const { data: registration } = await supabase
            .from('event_registrations')
            .select('status')
            .eq('event_id', req.params.eventId)
            .eq('user_id', targetUserId)
            .single();

        if (!registration || registration.status !== 'attended') {
            return res.status(400).json({ error: 'User must have attended the event.' });
        }

        // Check if certificate already exists
        const { data: existing } = await supabase
            .from('certificates')
            .select('id')
            .eq('event_id', req.params.eventId)
            .eq('user_id', targetUserId)
            .single();

        if (existing) {
            return res.status(409).json({ error: 'Certificate already issued for this event.' });
        }

        // Generate unique verification code
        const verification_code = `CS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const { data, error } = await supabase
            .from('certificates')
            .insert({
                user_id: targetUserId,
                event_id: req.params.eventId,
                certificate_type: certificate_type || 'participation',
                verification_code
            })
            .select(`
                *,
                events (id, title, event_date, clubs(name)),
                users (name, email)
            `)
            .single();

        if (error) throw error;

        // Notify user
        await supabase.from('notifications').insert({
            user_id: targetUserId,
            type: 'certificate_ready',
            title: 'Certificate Available! 🏆',
            message: `Your certificate for "${data.events.title}" is ready to download.`,
            icon: '🏆'
        });

        res.status(201).json({ message: 'Certificate generated!', certificate: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/certificates/verify/:code - Verify a certificate
router.get('/verify/:code', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('certificates')
            .select(`
                *,
                users (name, email, department),
                events (title, event_date, clubs(name))
            `)
            .eq('verification_code', req.params.code)
            .single();

        if (error || !data) {
            return res.status(404).json({ valid: false, error: 'Certificate not found.' });
        }

        res.json({
            valid: true,
            certificate: {
                holder: data.users.name,
                event: data.events.title,
                club: data.events.clubs.name,
                date: data.events.event_date,
                type: data.certificate_type,
                issued_at: data.issued_at,
                verification_code: data.verification_code
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/certificates/bulk-generate/:eventId - Generate for all attendees
router.post('/bulk-generate/:eventId', authenticate, async (req, res) => {
    try {
        // Get all attendees
        const { data: attendees } = await supabase
            .from('event_registrations')
            .select('user_id')
            .eq('event_id', req.params.eventId)
            .eq('status', 'attended');

        if (!attendees || attendees.length === 0) {
            return res.status(400).json({ error: 'No attendees found for this event.' });
        }

        // Filter out users who already have certificates
        const { data: existingCerts } = await supabase
            .from('certificates')
            .select('user_id')
            .eq('event_id', req.params.eventId);

        const existingUserIds = new Set((existingCerts || []).map(c => c.user_id));
        const newAttendees = attendees.filter(a => !existingUserIds.has(a.user_id));

        if (newAttendees.length === 0) {
            return res.json({ message: 'All attendees already have certificates.', generated: 0 });
        }

        const certs = newAttendees.map(a => ({
            user_id: a.user_id,
            event_id: req.params.eventId,
            certificate_type: req.body.certificate_type || 'participation',
            verification_code: `CH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
        }));

        const { error } = await supabase.from('certificates').insert(certs);
        if (error) throw error;

        res.json({ message: `Generated ${certs.length} certificates!`, generated: certs.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;