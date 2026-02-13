const express = require('express');
const router = express.Router();
const { supabase } = require('../middleware/auth');

// GET /api/social/share/:eventId
router.get('/share/:eventId', async (req, res) => {
    try {
        const { data: event } = await supabase
            .from('events')
            .select('*, clubs(name)')
            .eq('id', req.params.eventId)
            .single();

        if (!event) return res.status(404).json({ error: 'Event not found' });

        const text = `🎉 Check out "${event.title}" by ${event.clubs.name}! 📅 ${event.event_date} 📍 ${event.venue}. Register now on CampusHub!`;
        const url = `${req.protocol}://${req.get('host')}`;

        res.json({
            event: event.title,
            share_links: {
                twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
                whatsapp: `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`,
                linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}&title=${encodeURIComponent(event.title)}&summary=${encodeURIComponent(text)}`,
                telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
                copy_text: text
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;