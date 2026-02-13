const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// GET /api/chat/:clubId/messages - Get messages for a club
router.get('/:clubId/messages', authenticate, async (req, res) => {
    try {
        const { limit: lim, before } = req.query;

        let query = supabase
            .from('chat_messages')
            .select(`
                *,
                users (id, name, profile_image)
            `)
            .eq('club_id', req.params.clubId)
            .order('sent_at', { ascending: false })
            .limit(parseInt(lim) || 50);

        if (before) {
            query = query.lt('sent_at', before);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Reverse to get chronological order
        res.json((data || []).reverse());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/chat/:clubId/messages - Send a message
router.post('/:clubId/messages', authenticate, async (req, res) => {
    try {
        const { message, message_type } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message cannot be empty.' });
        }

        // Check if user is a member of the club
        const { data: membership } = await supabase
            .from('club_memberships')
            .select('id')
            .eq('club_id', req.params.clubId)
            .eq('user_id', req.userId)
            .eq('status', 'approved')
            .single();

        if (!membership && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'You must be a member of this club to send messages.' });
        }

        const { data, error } = await supabase
            .from('chat_messages')
            .insert({
                club_id: req.params.clubId,
                sender_id: req.userId,
                message: message.trim(),
                message_type: message_type || 'text'
            })
            .select(`
                *,
                users (id, name, profile_image)
            `)
            .single();

        if (error) throw error;

        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/chat/channels - Get user's chat channels (clubs they're in)
router.get('/', authenticate, async (req, res) => {
    try {
        const { data: memberships, error } = await supabase
            .from('club_memberships')
            .select(`
                clubs (id, name, icon, color)
            `)
            .eq('user_id', req.userId)
            .eq('status', 'approved');

        if (error) throw error;

        // Get last message and unread count for each club
        const channels = await Promise.all((memberships || []).map(async (m) => {
            const { data: lastMsg } = await supabase
                .from('chat_messages')
                .select('message, sent_at, users(name)')
                .eq('club_id', m.clubs.id)
                .order('sent_at', { ascending: false })
                .limit(1)
                .single();

            return {
                ...m.clubs,
                last_message: lastMsg ? {
                    text: lastMsg.message,
                    sender: lastMsg.users?.name,
                    time: lastMsg.sent_at
                } : null
            };
        }));

        res.json(channels);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;