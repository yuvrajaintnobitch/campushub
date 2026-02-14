const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('public'));

// Routes - only include ones that exist
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clubs', require('./routes/clubs'));
app.use('/api/events', require('./routes/events'));
app.use('/api/memberships', require('./routes/memberships'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/notifications', require('./routes/notifications'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'CampusHub API is running 🚀', timestamp: new Date() });
});

// Dashboard stats
app.get('/api/stats', async (req, res) => {
    try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        const [clubs, events, users, certificates] = await Promise.all([
            supabase.from('clubs').select('id', { count: 'exact' }).eq('status', 'active'),
            supabase.from('events').select('id', { count: 'exact' }),
            supabase.from('users').select('id', { count: 'exact' }),
            supabase.from('certificates').select('id', { count: 'exact' })
        ]);

        res.json({
            activeClubs: clubs.count || 0,
            totalEvents: events.count || 0,
            activeStudents: users.count || 0,
            certificatesIssued: certificates.count || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n⚡ CampusHub API running on port ${PORT}\n`);
});