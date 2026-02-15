const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// GET /api/certificates
router.get('/', authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('certificates')
            .select(`
                *,
                events (
                    id, title, event_date, icon, color,
                    clubs (id, name, icon)
                )
            `)
            .eq('user_id', req.userId)
            .order('issued_at', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/certificates/verify/:code
router.get('/verify/:code', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('certificates')
            .select(`
                *,
                users (id, name, email),
                events (id, title, event_date)
            `)
            .eq('verification_code', req.params.code)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Certificate not found.' });
        }

        res.json({
            valid: true,
            user_name: data.users ? data.users.name : 'Unknown',
            user_email: data.users ? data.users.email : '',
            event_title: data.events ? data.events.title : 'Unknown Event',
            event_date: data.events ? data.events.event_date : null,
            certificate_type: data.certificate_type,
            issued_at: data.issued_at,
            verification_code: data.verification_code
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/certificates/issue
router.post('/issue', authenticate, async (req, res) => {
    try {
        const { event_id, user_id, certificate_type } = req.body;

        const code = 'CH-' + Date.now().toString(36).toUpperCase() +
                     Math.random().toString(36).substring(2, 6).toUpperCase();

        const { data, error } = await supabase
            .from('certificates')
            .insert({
                user_id,
                event_id,
                certificate_type: certificate_type || 'participation',
                verification_code: code
            })
            .select()
            .single();

        if (error) throw error;

        await supabase.from('notifications').insert({
            user_id,
            type: 'certificate_ready',
            title: 'Certificate Available! 🏆',
            message: 'Your certificate is ready to download.',
            icon: '🏆'
        });

        res.status(201).json({ message: 'Certificate issued!', certificate: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;