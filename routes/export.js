const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// GET /api/export/event/:eventId/attendees
router.get('/event/:eventId/attendees', authenticate, async (req, res) => {
    try {
        const { format } = req.query; // 'csv' or 'json'

        const { data: registrations } = await supabase
            .from('event_registrations')
            .select('status, registered_at, checked_in_at, users(name, email, department, year)')
            .eq('event_id', req.params.eventId)
            .order('registered_at', { ascending: true });

        const { data: event } = await supabase
            .from('events')
            .select('title')
            .eq('id', req.params.eventId)
            .single();

        const rows = (registrations || []).map((r, i) => ({
            sr_no: i + 1,
            name: r.users?.name || '',
            email: r.users?.email || '',
            department: r.users?.department || '',
            year: r.users?.year || '',
            status: r.status,
            registered_at: r.registered_at,
            checked_in_at: r.checked_in_at || ''
        }));

        if (format === 'csv') {
            const headers = 'Sr No,Name,Email,Department,Year,Status,Registered At,Checked In At\n';
            const csvRows = rows.map(r =>
                `${r.sr_no},"${r.name}","${r.email}","${r.department}",${r.year},${r.status},"${r.registered_at}","${r.checked_in_at}"`
            ).join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${event?.title || 'attendees'}_attendees.csv"`);
            return res.send(headers + csvRows);
        }

        res.json({
            event: event?.title,
            total: rows.length,
            attendees: rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/export/club/:clubId/members
router.get('/club/:clubId/members', authenticate, async (req, res) => {
    try {
        const { format } = req.query;

        const { data: members } = await supabase
            .from('club_memberships')
            .select('role, status, joined_at, users(name, email, department, year)')
            .eq('club_id', req.params.clubId)
            .eq('status', 'approved')
            .order('joined_at', { ascending: true });

        const { data: club } = await supabase
            .from('clubs')
            .select('name')
            .eq('id', req.params.clubId)
            .single();

        const rows = (members || []).map((m, i) => ({
            sr_no: i + 1,
            name: m.users?.name || '',
            email: m.users?.email || '',
            department: m.users?.department || '',
            year: m.users?.year || '',
            role: m.role,
            joined_at: m.joined_at
        }));

        if (format === 'csv') {
            const headers = 'Sr No,Name,Email,Department,Year,Role,Joined At\n';
            const csvRows = rows.map(r =>
                `${r.sr_no},"${r.name}","${r.email}","${r.department}",${r.year},${r.role},"${r.joined_at}"`
            ).join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${club?.name || 'club'}_members.csv"`);
            return res.send(headers + csvRows);
        }

        res.json({
            club: club?.name,
            total: rows.length,
            members: rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;