const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// GET /api/notifications - Get user's notifications
router.get('/', authenticate, async (req, res) => {
    try {
        const { limit: lim, unread_only } = req.query;

        let query = supabase
            .from('notifications')
            .select('*')
            .eq('user_id', req.userId)
            .order('created_at', { ascending: false });

        if (unread_only === 'true') {
            query = query.eq('is_read', false);
        }

        query = query.limit(parseInt(lim) || 20);

        const { data, error } = await query;
        if (error) throw error;

        // Get unread count
        const { count: unreadCount } = await supabase
            .from('notifications')
            .select('id', { count: 'exact' })
            .eq('user_id', req.userId)
            .eq('is_read', false);

        res.json({
            notifications: data || [],
            unread_count: unreadCount || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/notifications/:id/read - Mark as read
router.patch('/:id/read', authenticate, async (req, res) => {
    try {
        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', req.params.id)
            .eq('user_id', req.userId);

        res.json({ message: 'Marked as read.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/notifications/read-all - Mark all as read
router.patch('/read-all', authenticate, async (req, res) => {
    try {
        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', req.userId)
            .eq('is_read', false);

        res.json({ message: 'All notifications marked as read.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;