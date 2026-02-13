const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// GET /api/analytics/overview
router.get('/overview', authenticate, async (req, res) => {
    try {
        // Total counts
        const [clubsRes, eventsRes, usersRes, certsRes, feedbackRes] = await Promise.all([
            supabase.from('clubs').select('id', { count: 'exact' }).eq('status', 'active'),
            supabase.from('events').select('id', { count: 'exact' }),
            supabase.from('users').select('id', { count: 'exact' }),
            supabase.from('certificates').select('id', { count: 'exact' }),
            supabase.from('feedback').select('rating')
        ]);

        // Average platform rating
        const ratings = (feedbackRes.data || []).map(f => f.rating);
        const avgRating = ratings.length > 0
            ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
            : 0;

        // Most popular clubs (by member count)
        const { data: topClubs } = await supabase
            .from('clubs')
            .select('name, icon, member_count, rating')
            .eq('status', 'active')
            .order('member_count', { ascending: false })
            .limit(5);

        // Upcoming events count
        const { count: upcomingCount } = await supabase
            .from('events')
            .select('id', { count: 'exact' })
            .gte('event_date', new Date().toISOString().split('T')[0]);

        // Recent registrations (last 7 days)
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { count: recentRegistrations } = await supabase
            .from('event_registrations')
            .select('id', { count: 'exact' })
            .gte('registered_at', weekAgo);

        // New members this month
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        const { count: newMembersThisMonth } = await supabase
            .from('club_memberships')
            .select('id', { count: 'exact' })
            .gte('joined_at', monthStart)
            .eq('status', 'approved');

        // Events by category
        const { data: events } = await supabase
            .from('events')
            .select('event_type');
        const eventsByType = {};
        (events || []).forEach(e => {
            eventsByType[e.event_type] = (eventsByType[e.event_type] || 0) + 1;
        });

        // Clubs by category
        const { data: clubs } = await supabase
            .from('clubs')
            .select('category')
            .eq('status', 'active');
        const clubsByCategory = {};
        (clubs || []).forEach(c => {
            clubsByCategory[c.category] = (clubsByCategory[c.category] || 0) + 1;
        });

        // Monthly registration trend (last 6 months)
        const monthlyTrend = [];
        for (let i = 5; i >= 0; i--) {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            const start = new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
            const end = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString();
            const { count } = await supabase
                .from('event_registrations')
                .select('id', { count: 'exact' })
                .gte('registered_at', start)
                .lte('registered_at', end);
            monthlyTrend.push({
                month: date.toLocaleString('default', { month: 'short' }),
                registrations: count || 0
            });
        }

        res.json({
            totals: {
                clubs: clubsRes.count || 0,
                events: eventsRes.count || 0,
                users: usersRes.count || 0,
                certificates: certsRes.count || 0,
                upcoming_events: upcomingCount || 0
            },
            engagement: {
                average_rating: parseFloat(avgRating),
                recent_registrations_7d: recentRegistrations || 0,
                new_members_this_month: newMembersThisMonth || 0
            },
            top_clubs: topClubs || [],
            events_by_type: eventsByType,
            clubs_by_category: clubsByCategory,
            monthly_trend: monthlyTrend
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/user/:userId
router.get('/user/:userId', authenticate, async (req, res) => {
    try {
        const userId = req.params.userId === 'me' ? req.userId : req.params.userId;

        // User's club count
        const { data: memberships } = await supabase
            .from('club_memberships')
            .select('club_id, role, joined_at, clubs(name, icon)')
            .eq('user_id', userId)
            .eq('status', 'approved');

        // Events registered
        const { data: registrations } = await supabase
            .from('event_registrations')
            .select('status, registered_at, events(title, event_date, icon)')
            .eq('user_id', userId)
            .order('registered_at', { ascending: false });

        const attended = (registrations || []).filter(r => r.status === 'attended').length;
        const total = (registrations || []).length;

        // Certificates
        const { data: certs } = await supabase
            .from('certificates')
            .select('certificate_type, issued_at, events(title)')
            .eq('user_id', userId);

        // Feedback given
        const { data: feedback } = await supabase
            .from('feedback')
            .select('rating, events(title)')
            .eq('user_id', userId);

        const avgGivenRating = feedback && feedback.length > 0
            ? (feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1)
            : null;

        // Activity score
        const activityScore = Math.min(100, (
            (memberships || []).length * 10 +
            attended * 8 +
            (certs || []).length * 15 +
            (feedback || []).length * 5
        ));

        res.json({
            clubs_joined: (memberships || []).length,
            events_registered: total,
            events_attended: attended,
            attendance_rate: total > 0 ? Math.round((attended / total) * 100) + '%' : 'N/A',
            certificates_earned: (certs || []).length,
            feedback_given: (feedback || []).length,
            average_rating_given: avgGivenRating,
            activity_score: activityScore,
            clubs: memberships || [],
            recent_events: (registrations || []).slice(0, 10),
            certificates: certs || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/leaderboard
router.get('/leaderboard', async (req, res) => {
    try {
        // Get users with most event attendance
        const { data: users } = await supabase
            .from('users')
            .select('id, name, department, year, profile_image');

        const leaderboard = await Promise.all((users || []).map(async (user) => {
            const { count: eventsAttended } = await supabase
                .from('event_registrations')
                .select('id', { count: 'exact' })
                .eq('user_id', user.id)
                .eq('status', 'attended');

            const { count: certsCount } = await supabase
                .from('certificates')
                .select('id', { count: 'exact' })
                .eq('user_id', user.id);

            const { count: clubCount } = await supabase
                .from('club_memberships')
                .select('id', { count: 'exact' })
                .eq('user_id', user.id)
                .eq('status', 'approved');

            const score = (eventsAttended || 0) * 10 + (certsCount || 0) * 15 + (clubCount || 0) * 5;

            return {
                name: user.name,
                department: user.department,
                year: user.year,
                events_attended: eventsAttended || 0,
                certificates: certsCount || 0,
                clubs: clubCount || 0,
                score
            };
        }));

        leaderboard.sort((a, b) => b.score - a.score);

        res.json({
            leaderboard: leaderboard.slice(0, 20),
            updated_at: new Date()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;