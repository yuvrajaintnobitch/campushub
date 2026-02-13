const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, authenticate } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { email, password, name, department, year, college_id } = req.body;

        // Validation
        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, password, and name are required.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        }

        // Check if user already exists
        const { data: existing } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (existing) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Create user
        const { data: user, error } = await supabase
            .from('users')
            .insert({
                email,
                password_hash,
                name,
                department: department || null,
                year: year || null,
                college_id: college_id || null,
                role: 'student'
            })
            .select()
            .single();

        if (error) throw error;

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Create welcome notification
        await supabase.from('notifications').insert({
            user_id: user.id,
            type: 'welcome',
            title: 'Welcome to ClubSync! 🎉',
            message: 'Start by exploring clubs and registering for events.',
            icon: '🚀'
        });

        // Remove password from response
        const { password_hash: _, ...userWithoutPassword } = user;

        res.status(201).json({
            message: 'Registration successful!',
            token,
            user: userWithoutPassword
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        // Find user
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        const { password_hash: _, ...userWithoutPassword } = user;

        res.json({
            message: 'Login successful!',
            token,
            user: userWithoutPassword
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/auth/me - Get current user profile
router.get('/me', authenticate, async (req, res) => {
    try {
        const { password_hash: _, ...user } = req.user;

        // Get user's clubs
        const { data: memberships } = await supabase
            .from('club_memberships')
            .select(`
                role, status, joined_at,
                clubs (id, name, icon, color, category)
            `)
            .eq('user_id', req.userId)
            .eq('status', 'approved');

        // Get user's event registrations count
        const { count: eventsAttended } = await supabase
            .from('event_registrations')
            .select('id', { count: 'exact' })
            .eq('user_id', req.userId);

        // Get user's certificates count
        const { count: certificateCount } = await supabase
            .from('certificates')
            .select('id', { count: 'exact' })
            .eq('user_id', req.userId);

        res.json({
            ...user,
            clubs: memberships || [],
            eventsAttended: eventsAttended || 0,
            certificates: certificateCount || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/auth/profile - Update profile
router.put('/profile', authenticate, async (req, res) => {
    try {
        const { name, department, year, profile_image } = req.body;

        const { data, error } = await supabase
            .from('users')
            .update({ name, department, year, profile_image })
            .eq('id', req.userId)
            .select()
            .single();

        if (error) throw error;

        const { password_hash: _, ...user } = data;
        res.json({ message: 'Profile updated!', user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;