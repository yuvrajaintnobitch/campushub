const express = require('express');
const router = express.Router();
const { supabase, authenticate, optionalAuth } = require('../middleware/auth');

// GET /api/events - List events
router.get('/', async (req, res) => {
    try {
        const { club_id, status, upcoming, search, limit: lim } = req.query;

        let query = supabase
            .from('events')
            .select(`
                *,
                clubs (id, name, icon, color)
            `)
            .order('event_date', { ascending: true });

        if (club_id) query = query.eq('club_id', club_id);
        if (status) query = query.eq('status', status);
        if (upcoming === 'true') {
            query = query.gte('event_date', new Date().toISOString().split('T')[0]);
        }
        if (search) {
            query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
        }
        if (lim) query = query.limit(parseInt(lim));

        const { data: events, error } = await query;
        if (error) throw error;

        // Get registration counts for each event
        const eventsWithCounts = await Promise.all(events.map(async (event) => {
            const { count } = await supabase
                .from('event_registrations')
                .select('id', { count: 'exact' })
                .eq('event_id', event.id)
                .neq('status', 'cancelled');

            return {
                ...event,
                registered_count: count || 0,
                is_full: (count || 0) >= event.max_participants
            };
        }));

        res.json(eventsWithCounts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/events/:id - Get single event
router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const { data: event, error } = await supabase
            .from('events')
            .select(`
                *,
                clubs (id, name, icon, color, description)
            `)
            .eq('id', req.params.id)
            .single();

        if (error || !event) {
            return res.status(404).json({ error: 'Event not found.' });
        }

        // Get registration count
        const { count: registeredCount } = await supabase
            .from('event_registrations')
            .select('id', { count: 'exact' })
            .eq('event_id', req.params.id)
            .neq('status', 'cancelled');

        // Check if current user is registered
        let userRegistration = null;
        if (req.userId) {
            const { data: reg } = await supabase
                .from('event_registrations')
                .select('*')
                .eq('event_id', req.params.id)
                .eq('user_id', req.userId)
                .single();
            userRegistration = reg;
        }

        // Get feedback summary
        const { data: feedbackData } = await supabase
            .from('feedback')
            .select('rating')
            .eq('event_id', req.params.id);

        const avgRating = feedbackData && feedbackData.length > 0
            ? (feedbackData.reduce((sum, f) => sum + f.rating, 0) / feedbackData.length).toFixed(1)
            : null;

        res.json({
            ...event,
            registered_count: registeredCount || 0,
            is_full: (registeredCount || 0) >= event.max_participants,
            userRegistration,
            feedback_summary: {
                average_rating: avgRating,
                total_reviews: feedbackData ? feedbackData.length : 0
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/events - Create event
router.post('/', authenticate, async (req, res) => {
    try {
        const {
            club_id, title, description, event_date,
            start_time, end_time, venue, event_type,
            max_participants, price, icon, color,
            registration_deadline
        } = req.body;

        if (!club_id || !title || !event_date || !start_time || !end_time) {
            return res.status(400).json({
                error: 'Club ID, title, date, start time, and end time are required.'
            });
        }

        // Check if user is lead of this club or admin
        const { data: membership } = await supabase
            .from('club_memberships')
            .select('role')
            .eq('club_id', club_id)
            .eq('user_id', req.userId)
            .in('role', ['lead', 'co_lead'])
            .single();

        if (!membership && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only club leads or admins can create events.' });
        }

        const { data, error } = await supabase
            .from('events')
            .insert({
                club_id, title, description, event_date,
                start_time, end_time, venue,
                event_type: event_type || 'workshop',
                max_participants: max_participants || 100,
                price: price || 0,
                icon: icon || '📅',
                color: color || '#6C5CE7,#A29BFE',
                registration_deadline,
                created_by: req.userId,
                status: 'upcoming'
            })
            .select(`*, clubs (id, name)`)
            .single();

        if (error) throw error;

        // Notify club members
        const { data: members } = await supabase
            .from('club_memberships')
            .select('user_id')
            .eq('club_id', club_id)
            .eq('status', 'approved');

        if (members && members.length > 0) {
            const notifications = members.map(m => ({
                user_id: m.user_id,
                type: 'new_event',
                title: `New Event: ${title}`,
                message: `${data.clubs.name} is hosting "${title}" on ${event_date}.`,
                icon: '📅'
            }));
            await supabase.from('notifications').insert(notifications);
        }

        res.status(201).json({ message: 'Event created!', event: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/events/:id/register - Register for event
router.post('/:id/register', authenticate, async (req, res) => {
    try {
        // Check if event exists and has capacity
        const { data: event } = await supabase
            .from('events')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (!event) return res.status(404).json({ error: 'Event not found.' });
        if (event.status === 'cancelled') return res.status(400).json({ error: 'Event is cancelled.' });
        if (event.status === 'completed') return res.status(400).json({ error: 'Event has already ended.' });

        // Check capacity
        const { count: registeredCount } = await supabase
            .from('event_registrations')
            .select('id', { count: 'exact' })
            .eq('event_id', req.params.id)
            .neq('status', 'cancelled');

        if (registeredCount >= event.max_participants) {
            return res.status(400).json({ error: 'Event is full. No spots available.' });
        }

        // Check if already registered
        const { data: existing } = await supabase
            .from('event_registrations')
            .select('id, status')
            .eq('event_id', req.params.id)
            .eq('user_id', req.userId)
            .single();

        if (existing && existing.status !== 'cancelled') {
            return res.status(409).json({ error: 'You are already registered for this event.' });
        }

        // Register
        if (existing) {
            // Re-register if previously cancelled
            await supabase
                .from('event_registrations')
                .update({ status: 'registered', registered_at: new Date() })
                .eq('id', existing.id);
        } else {
            await supabase.from('event_registrations').insert({
                event_id: req.params.id,
                user_id: req.userId,
                status: 'registered'
            });
        }

        // Create notification
        await supabase.from('notifications').insert({
            user_id: req.userId,
            type: 'event_registered',
            title: `Registered for ${event.title}! ✅`,
            message: `You're registered for "${event.title}" on ${event.event_date}.`,
            icon: '📅'
        });

        res.json({
            message: 'Successfully registered!',
            registered_count: (registeredCount || 0) + 1,
            max_participants: event.max_participants
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/events/:id/register - Cancel registration
router.delete('/:id/register', authenticate, async (req, res) => {
    try {
        const { error } = await supabase
            .from('event_registrations')
            .update({ status: 'cancelled' })
            .eq('event_id', req.params.id)
            .eq('user_id', req.userId);

        if (error) throw error;

        res.json({ message: 'Registration cancelled.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/events/:id/checkin - Check in attendee
router.post('/:id/checkin', authenticate, async (req, res) => {
    try {
        const { user_id } = req.body;
        const targetUserId = user_id || req.userId;

        const { data, error } = await supabase
            .from('event_registrations')
            .update({
                status: 'attended',
                checked_in_at: new Date()
            })
            .eq('event_id', req.params.id)
            .eq('user_id', targetUserId)
            .select()
            .single();

        if (error) throw error;

        res.json({ message: 'Checked in successfully!', registration: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;