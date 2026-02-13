const express = require('express');
const router = express.Router();
const { supabase, authenticate, isAdmin } = require('../middleware/auth');

// POST /api/memberships/join/:clubId - Request to join club
router.post('/join/:clubId', authenticate, async (req, res) => {
    try {
        // Check if club exists
        const { data: club } = await supabase
            .from('clubs')
            .select('id, name, status')
            .eq('id', req.params.clubId)
            .eq('status', 'active')
            .single();

        if (!club) return res.status(404).json({ error: 'Club not found or inactive.' });

        // Check if already a member
        const { data: existing } = await supabase
            .from('club_memberships')
            .select('id, status')
            .eq('club_id', req.params.clubId)
            .eq('user_id', req.userId)
            .single();

        if (existing) {
            if (existing.status === 'approved') {
                return res.status(409).json({ error: 'You are already a member.' });
            }
            if (existing.status === 'pending') {
                return res.status(409).json({ error: 'Your request is already pending.' });
            }
            // If rejected, allow re-request
            await supabase
                .from('club_memberships')
                .update({ status: 'pending', joined_at: new Date() })
                .eq('id', existing.id);
        } else {
            await supabase.from('club_memberships').insert({
                user_id: req.userId,
                club_id: req.params.clubId,
                role: 'member',
                status: 'pending'
            });
        }

        // Notify club leads
        const { data: leads } = await supabase
            .from('club_memberships')
            .select('user_id')
            .eq('club_id', req.params.clubId)
            .in('role', ['lead', 'co_lead']);

        if (leads) {
            const notifications = leads.map(l => ({
                user_id: l.user_id,
                type: 'membership_request',
                title: `New Member Request`,
                message: `${req.user.name} wants to join ${club.name}.`,
                icon: '👤'
            }));
            await supabase.from('notifications').insert(notifications);
        }

        res.json({ message: 'Membership request sent! Awaiting approval.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/memberships/pending/:clubId - Get pending requests for a club
router.get('/pending/:clubId', authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('club_memberships')
            .select(`
                id, role, status, joined_at,
                users (id, name, email, department, year, profile_image)
            `)
            .eq('club_id', req.params.clubId)
            .eq('status', 'pending')
            .order('joined_at', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/memberships/:id/approve - Approve or reject
router.patch('/:id/approve', authenticate, async (req, res) => {
    try {
        const { status } = req.body; // 'approved' or 'rejected'

        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Status must be "approved" or "rejected".' });
        }

        const { data: membership, error: fetchErr } = await supabase
            .from('club_memberships')
            .select('*, clubs(name)')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !membership) {
            return res.status(404).json({ error: 'Membership request not found.' });
        }

        // Verify requester is lead of this club or admin
        const { data: requesterMembership } = await supabase
            .from('club_memberships')
            .select('role')
            .eq('club_id', membership.club_id)
            .eq('user_id', req.userId)
            .in('role', ['lead', 'co_lead'])
            .single();

        if (!requesterMembership && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only club leads or admins can approve memberships.' });
        }

        const { data, error } = await supabase
            .from('club_memberships')
            .update({ status })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        // Notify the user
        await supabase.from('notifications').insert({
            user_id: membership.user_id,
            type: status === 'approved' ? 'membership_approved' : 'membership_rejected',
            title: status === 'approved'
                ? `Welcome to ${membership.clubs.name}! 🎉`
                : `Membership Request Update`,
            message: status === 'approved'
                ? `Your request to join ${membership.clubs.name} has been approved!`
                : `Your request to join ${membership.clubs.name} was not approved.`,
            icon: status === 'approved' ? '✅' : '❌'
        });

        res.json({ message: `Membership ${status}!`, membership: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/memberships/leave/:clubId - Leave club
router.delete('/leave/:clubId', authenticate, async (req, res) => {
    try {
        const { error } = await supabase
            .from('club_memberships')
            .delete()
            .eq('club_id', req.params.clubId)
            .eq('user_id', req.userId);

        if (error) throw error;
        res.json({ message: 'Left the club successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/memberships/my - Get all my memberships
router.get('/my', authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('club_memberships')
            .select(`
                id, role, status, joined_at,
                clubs (id, name, description, icon, color, category, member_count, rating)
            `)
            .eq('user_id', req.userId)
            .order('joined_at', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;