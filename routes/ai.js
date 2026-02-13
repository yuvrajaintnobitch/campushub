const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');

// POST /api/ai/generate-description
router.post('/generate-description', authenticate, async (req, res) => {
    try {
        const { type, name, club_name, category } = req.body;
        // type: 'event' or 'club'

        const eventTemplates = [
            `Join us for "${name}" — an exciting ${category || 'campus'} event organized by ${club_name || 'our club'}! This is your chance to learn, connect, and grow. Whether you're a beginner or experienced, there's something for everyone. Don't miss out on this incredible opportunity to be part of something amazing. Register now — limited spots available!`,

            `🚀 ${name} is here! Organized by ${club_name || 'our team'}, this event brings together the best minds on campus for a day of innovation, learning, and fun. Expect hands-on sessions, expert mentors, exciting challenges, and amazing prizes. Open to all departments and years. Bring your friends and let's make this one unforgettable!`,

            `Get ready for ${name}! 🎉 ${club_name || 'We are'} hosting an unforgettable ${category || ''} experience. This event features interactive workshops, networking opportunities, and real-world skill building. Perfect for students who want to go beyond the classroom. Refreshments will be provided. Limited seats — register early!`,

            `📢 Calling all ${category || 'campus'} enthusiasts! "${name}" by ${club_name || 'our club'} is the event you've been waiting for. Dive deep into practical sessions, collaborate with peers, and showcase your talent. Certificates will be provided to all participants. This is more than just an event — it's an experience!`,

            `${club_name || 'Our club'} proudly presents "${name}" — a one-of-a-kind ${category || ''} event designed to inspire and empower students. Featuring industry experts, hands-on activities, and exciting competitions. Whether you're looking to learn something new or compete with the best, this event has it all. See you there! 🙌`
        ];

        const clubTemplates = [
            `Welcome to ${name}! We are a passionate community of students dedicated to ${category || 'learning and growing together'}. Through workshops, competitions, projects, and social events, we provide a platform for members to explore their interests, develop new skills, and build lasting friendships. Join us and be part of something special!`,

            `${name} is where curiosity meets community. We bring together students who are passionate about ${category || 'making a difference'}. From beginner-friendly workshops to advanced projects, hackathons to social meetups — there's always something happening. Join ${name} and unlock your potential!`,

            `At ${name}, we believe in learning by doing. Our club offers hands-on experience through real-world projects, industry speaker sessions, skill-building workshops, and fun competitions. Whether you're just starting out or you're already experienced, you'll find your tribe here. Let's build something amazing together!`
        ];

        const templates = type === 'club' ? clubTemplates : eventTemplates;
        const description = templates[Math.floor(Math.random() * templates.length)];

        // Simulate AI processing delay
        await new Promise(resolve => setTimeout(resolve, 800));

        res.json({
            description,
            generated_at: new Date(),
            note: 'AI-generated description. Feel free to edit!'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/suggest-clubs
router.post('/suggest-clubs', authenticate, async (req, res) => {
    try {
        const { interests, department, year } = req.body;
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        // Get all active clubs
        const { data: allClubs } = await supabase
            .from('clubs')
            .select('*')
            .eq('status', 'active')
            .order('rating', { ascending: false });

        // Get user's existing memberships
        const { data: memberships } = await supabase
            .from('club_memberships')
            .select('club_id')
            .eq('user_id', req.userId);

        const joinedClubIds = new Set((memberships || []).map(m => m.club_id));

        // Filter out already joined clubs
        const available = (allClubs || []).filter(c => !joinedClubIds.has(c.id));

        // Simple recommendation: match by interests/category
        let recommended = available;
        if (interests && interests.length > 0) {
            const interestLower = interests.map(i => i.toLowerCase());
            recommended = available.sort((a, b) => {
                const aMatch = interestLower.some(i =>
                    a.category.toLowerCase().includes(i) ||
                    a.name.toLowerCase().includes(i) ||
                    (a.description || '').toLowerCase().includes(i)
                );
                const bMatch = interestLower.some(i =>
                    b.category.toLowerCase().includes(i) ||
                    b.name.toLowerCase().includes(i) ||
                    (b.description || '').toLowerCase().includes(i)
                );
                return (bMatch ? 1 : 0) - (aMatch ? 1 : 0);
            });
        }

        res.json({
            recommendations: recommended.slice(0, 5),
            total_available: available.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ai/event-insights/:eventId
router.get('/event-insights/:eventId', authenticate, async (req, res) => {
    try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        const { data: event } = await supabase
            .from('events')
            .select('*, clubs(name)')
            .eq('id', req.params.eventId)
            .single();

        if (!event) return res.status(404).json({ error: 'Event not found' });

        // Get registration stats
        const { data: registrations } = await supabase
            .from('event_registrations')
            .select('status, registered_at, users(department, year)')
            .eq('event_id', req.params.eventId);

        const totalRegistered = (registrations || []).filter(r => r.status !== 'cancelled').length;
        const attended = (registrations || []).filter(r => r.status === 'attended').length;

        // Department breakdown
        const deptBreakdown = {};
        const yearBreakdown = {};
        (registrations || []).forEach(r => {
            if (r.users) {
                const dept = r.users.department || 'Unknown';
                const yr = r.users.year || 'Unknown';
                deptBreakdown[dept] = (deptBreakdown[dept] || 0) + 1;
                yearBreakdown[yr] = (yearBreakdown[yr] || 0) + 1;
            }
        });

        // Registration trend (by day)
        const dailyRegistrations = {};
        (registrations || []).forEach(r => {
            const day = new Date(r.registered_at).toISOString().split('T')[0];
            dailyRegistrations[day] = (dailyRegistrations[day] || 0) + 1;
        });

        // Get feedback
        const { data: feedback } = await supabase
            .from('feedback')
            .select('rating')
            .eq('event_id', req.params.eventId);

        const avgRating = feedback && feedback.length > 0
            ? (feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1)
            : null;

        // Generate insights
        const fillRate = event.max_participants > 0
            ? Math.round((totalRegistered / event.max_participants) * 100)
            : 0;

        const insights = [];
        if (fillRate > 90) insights.push('🔥 This event is almost full! High demand.');
        if (fillRate > 50) insights.push('📈 Over 50% capacity filled. Good engagement.');
        if (fillRate < 20) insights.push('⚠️ Low registrations. Consider more promotion.');
        if (attended > 0 && totalRegistered > 0) {
            const attendanceRate = Math.round((attended / totalRegistered) * 100);
            insights.push(`📊 Attendance rate: ${attendanceRate}%`);
        }
        if (avgRating && avgRating >= 4.5) insights.push('⭐ Highly rated event!');

        const topDept = Object.entries(deptBreakdown).sort((a, b) => b[1] - a[1])[0];
        if (topDept) insights.push(`🏆 Most registrations from ${topDept[0]} department`);

        res.json({
            event: event.title,
            stats: {
                total_registered: totalRegistered,
                attended,
                max_capacity: event.max_participants,
                fill_rate: fillRate + '%',
                average_rating: avgRating
            },
            department_breakdown: deptBreakdown,
            year_breakdown: yearBreakdown,
            daily_registrations: dailyRegistrations,
            insights
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;