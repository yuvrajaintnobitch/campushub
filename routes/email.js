const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// POST /api/email/send-reminder
router.post('/send-reminder', authenticate, async (req, res) => {
    try {
        const { event_id } = req.body;

        // Get event details
        const { data: event } = await supabase
            .from('events')
            .select('*, clubs(name)')
            .eq('id', event_id)
            .single();

        if (!event) return res.status(404).json({ error: 'Event not found' });

        // Get all registered users
        const { data: registrations } = await supabase
            .from('event_registrations')
            .select('users(id, name, email)')
            .eq('event_id', event_id)
            .eq('status', 'registered');

        if (!registrations || registrations.length === 0) {
            return res.json({ message: 'No registered users to notify', sent: 0 });
        }

        // Create in-app notifications for all registered users
        const notifications = registrations.map(r => ({
            user_id: r.users.id,
            type: 'event_reminder',
            title: `⏰ Reminder: ${event.title}`,
            message: `"${event.title}" is happening on ${event.event_date} at ${event.venue}. Don't forget to attend!`,
            icon: '⏰'
        }));

        await supabase.from('notifications').insert(notifications);

        // In a real app, you'd also send actual emails here using Resend/SendGrid
        // For prototype, we just create notifications

        res.json({
            message: `Reminders sent to ${registrations.length} registered users!`,
            sent: registrations.length,
            event: event.title
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/email/broadcast
router.post('/broadcast', authenticate, async (req, res) => {
    try {
        const { club_id, title, message } = req.body;

        if (!club_id || !title || !message) {
            return res.status(400).json({ error: 'Club ID, title, and message are required' });
        }

        // Get all club members
        const { data: members } = await supabase
            .from('club_memberships')
            .select('user_id')
            .eq('club_id', club_id)
            .eq('status', 'approved');

        if (!members || members.length === 0) {
            return res.json({ message: 'No members to notify', sent: 0 });
        }

        const notifications = members.map(m => ({
            user_id: m.user_id,
            type: 'club_broadcast',
            title: `📢 ${title}`,
            message: message,
            icon: '📢'
        }));

        await supabase.from('notifications').insert(notifications);

        res.json({
            message: `Broadcast sent to ${members.length} members!`,
            sent: members.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;