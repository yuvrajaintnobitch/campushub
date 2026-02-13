const express = require('express');
const router = express.Router();
const { supabase, authenticate, isAdmin, optionalAuth } = require('../middleware/auth');

// GET /api/clubs - List all active clubs
router.get('/', async (req, res) => {
    try {
        const { category, search, sort } = req.query;

        let query = supabase
            .from('clubs')
            .select('*')
            .eq('status', 'active');

        if (category && category !== 'all') {
            query = query.ilike('category', `%${category}%`);
        }

        if (search) {
            query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
        }

        if (sort === 'members') {
            query = query.order('member_count', { ascending: false });
        } else if (sort === 'rating') {
            query = query.order('rating', { ascending: false });
        } else {
            query = query.order('created_at', { ascending: false });
        }

        const { data, error } = await query;
        if (error) throw error;

        // Get event count for each club
        const clubsWithEvents = await Promise.all(data.map(async (club) => {
            const { count } = await supabase
                .from('events')
                .select('id', { count: 'exact' })
                .eq('club_id', club.id);
            return { ...club, events_count: count || 0 };
        }));

        res.json(clubsWithEvents);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/clubs/:id - Get single club details
router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const { data: club, error } = await supabase
            .from('clubs')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !club) {
            return res.status(404).json({ error: 'Club not found.' });
        }

        // Get members
        const { data: members, count: memberCount } = await supabase
            .from('club_memberships')
            .select(`
                role, status, joined_at,
                users (id, name, email, department, year, profile_image)
            `, { count: 'exact' })
            .eq('club_id', req.params.id)
            .eq('status', 'approved');

        // Get upcoming events
        const { data: events } = await supabase
            .from('events')
            .select('*')
            .eq('club_id', req.params.id)
            .gte('event_date', new Date().toISOString().split('T')[0])
            .order('event_date', { ascending: true })
            .limit(5);

        // Check if current user is a member
        let userMembership = null;
        if (req.userId) {
            const { data: membership } = await supabase
                .from('club_memberships')
                .select('*')
                .eq('club_id', req.params.id)
                .eq('user_id', req.userId)
                .single();
            userMembership = membership;
        }

        res.json({
            ...club,
            members: members || [],
            memberCount: memberCount || 0,
            upcomingEvents: events || [],
            userMembership
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/clubs - Create a new club
router.post('/', authenticate, async (req, res) => {
    try {
        const { name, description, objectives, category, icon, color } = req.body;

        if (!name || !category) {
            return res.status(400).json({ error: 'Club name and category are required.' });
        }

        const { data, error } = await supabase
            .from('clubs')
            .insert({
                name,
                description,
                objectives,
                category,
                icon: icon || '🏛️',
                color: color || '#6C5CE7,#A29BFE',
                created_by: req.userId,
                status: req.user.role === 'admin' ? 'active' : 'pending'
            })
            .select()
            .single();

        if (error) throw error;

        // Auto-add creator as lead member
        await supabase.from('club_memberships').insert({
            user_id: req.userId,
            club_id: data.id,
            role: 'lead',
            status: 'approved'
        });

        // Notify admins if pending
        if (data.status === 'pending') {
            const { data: admins } = await supabase
                .from('users')
                .select('id')
                .eq('role', 'admin');

            if (admins) {
                const notifications = admins.map(admin => ({
                    user_id: admin.id,
                    type: 'club_request',
                    title: `New Club Request: ${name}`,
                    message: `${req.user.name} has requested to create "${name}".`,
                    icon: '🏛️'
                }));
                await supabase.from('notifications').insert(notifications);
            }
        }

        res.status(201).json({ message: 'Club created!', club: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/clubs/:id - Update club
router.put('/:id', authenticate, async (req, res) => {
    try {
        // Check if user is club lead or admin
        const { data: membership } = await supabase
            .from('club_memberships')
            .select('role')
            .eq('club_id', req.params.id)
            .eq('user_id', req.userId)
            .eq('role', 'lead')
            .single();

        if (!membership && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only club leads or admins can update the club.' });
        }

        const { name, description, objectives, category, icon, color } = req.body;

        const { data, error } = await supabase
            .from('clubs')
            .update({ name, description, objectives, category, icon, color })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        res.json({ message: 'Club updated!', club: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/clubs/:id/approve - Admin approve club
router.patch('/:id/approve', authenticate, isAdmin, async (req, res) => {
    try {
        const { status } = req.body; // 'active' or 'inactive'

        const { data, error } = await supabase
            .from('clubs')
            .update({ status: status || 'active' })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        // Notify creator
        await supabase.from('notifications').insert({
            user_id: data.created_by,
            type: 'club_approved',
            title: `Club "${data.name}" Approved! 🎉`,
            message: 'Your club has been approved and is now active.',
            icon: '✅'
        });

        res.json({ message: 'Club approved!', club: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;