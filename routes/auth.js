const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { supabase, authenticate } = require('../middleware/auth');

// ==========================================
// EMAIL SETUP (Brevo SMTP)
// ==========================================
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000
});

transporter.verify()
    .then(() => console.log('✅ Email service ready'))
    .catch(err => console.error('❌ Email service error:', err.message));

// ==========================================
// OTP STORE
// ==========================================
const otpStore = new Map();

// Clean expired OTPs every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [email, data] of otpStore) {
        if (now > data.expires) otpStore.delete(email);
    }
}, 600000);

// ==========================================
// POST /api/auth/send-otp
// ==========================================
router.post('/send-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required.' });

        // Rate limit: 1 OTP per 60 seconds
        const existing = otpStore.get(email);
        if (existing && Date.now() - existing.created < 60000) {
            return res.status(429).json({
                error: 'Please wait 60 seconds before requesting another code.'
            });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Store with 10 min expiry
        otpStore.set(email, {
            otp,
            expires: Date.now() + 600000,
            created: Date.now()
        });

        console.log(`OTP for ${email}: ${otp}`);

        // Try sending email
        let emailSent = false;
        const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            try {
                const sendPromise = transporter.sendMail({
                    from: { name: 'CampusHub', address: fromEmail },
                    to: email,
                    subject: '🎓 CampusHub - Verification Code',
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f8f9fa;border-radius:16px;overflow:hidden;border:1px solid #e0e0e0">
                            <div style="background:linear-gradient(135deg,#6C5CE7,#A29BFE);padding:32px;text-align:center">
                                <h1 style="color:white;margin:0;font-size:28px">🎓 CampusHub</h1>
                                <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px">Email Verification</p>
                            </div>
                            <div style="padding:32px;color:#333">
                                <p style="font-size:16px;margin-bottom:24px">Hi! Use this code to verify your email:</p>
                                <div style="background:#6C5CE7;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
                                    <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:white">${otp}</span>
                                </div>
                                <p style="font-size:13px;color:#888">⏰ This code expires in <strong>10 minutes</strong>.</p>
                                <p style="font-size:13px;color:#888">If you didn't request this, please ignore this email.</p>
                            </div>
                            <div style="background:#f0f0f0;padding:16px;text-align:center;border-top:1px solid #e0e0e0">
                                <p style="color:#999;font-size:11px;margin:0">CampusHub - Your College Club & Event Manager</p>
                            </div>
                        </div>
                    `
                });

                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Email timeout')), 12000)
                );

                await Promise.race([sendPromise, timeoutPromise]);
                emailSent = true;
                console.log(`✅ Email sent to ${email}`);
            } catch (emailErr) {
                console.error(`❌ Email failed: ${emailErr.message}`);
            }
        }

        // Always respond - fallback OTP if email failed
        res.json({
            message: emailSent
                ? `Verification code sent to ${email}. Check your inbox!`
                : `Verification code generated for ${email}`,
            ...(emailSent ? {} : { otp_fallback: otp })
        });
    } catch (err) {
        console.error('Send OTP error:', err.message);
        res.status(500).json({ error: 'Failed to send code. Please try again.' });
    }
});

// ==========================================
// POST /api/auth/verify-otp
// ==========================================
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ error: 'Email and OTP are required.' });
        }

        const stored = otpStore.get(email);
        if (!stored) {
            return res.status(400).json({ error: 'No verification code found. Request a new one.' });
        }
        if (Date.now() > stored.expires) {
            otpStore.delete(email);
            return res.status(400).json({ error: 'Code expired. Request a new one.' });
        }
        if (stored.otp !== otp.trim()) {
            return res.status(400).json({ error: 'Invalid code. Please try again.' });
        }

        otpStore.delete(email);
        res.json({ message: 'Email verified!', verified: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// POST /api/auth/register
// ==========================================
router.post('/register', async (req, res) => {
    try {
        const { email, password, name, department, year, college_id, role, club_id } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, password, and name are required.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        }

        const { data: existing } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (existing) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const { data: user, error } = await supabase
            .from('users')
            .insert({
                email,
                password_hash,
                name,
                department: department || null,
                year: year || null,
                college_id: college_id || null,
                role: (role === 'admin') ? 'admin' : 'student'
            })
            .select()
            .single();

        if (error) throw error;

        // If admin selected a club, make them club lead
        if (role === 'admin' && club_id) {
            await supabase.from('club_memberships').insert({
                user_id: user.id,
                club_id: club_id,
                role: 'lead',
                status: 'approved'
            });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Welcome notification
        await supabase.from('notifications').insert({
            user_id: user.id,
            type: 'welcome',
            title: 'Welcome to CampusHub! 🎉',
            message: role === 'admin'
                ? 'You are registered as a Club Admin. Manage your club from the Admin Panel.'
                : 'Start by exploring clubs and registering for events.',
            icon: '🚀'
        });

        // Send welcome email (non-blocking)
        const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
        if (fromEmail) {
            transporter.sendMail({
                from: { name: 'CampusHub', address: fromEmail },
                to: email,
                subject: '🎓 Welcome to CampusHub!',
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f8f9fa;border-radius:16px;overflow:hidden;border:1px solid #e0e0e0">
                        <div style="background:linear-gradient(135deg,#6C5CE7,#A29BFE);padding:32px;text-align:center">
                            <h1 style="color:white;margin:0">🎓 Welcome!</h1>
                        </div>
                        <div style="padding:32px;color:#333">
                            <p style="font-size:16px">Hi <strong>${name}</strong>,</p>
                            <p>Your CampusHub account is ready! You're registered as a <strong>${role === 'admin' ? 'Club Admin' : 'Student'}</strong>.</p>
                            <p>Start exploring clubs, events, and more!</p>
                        </div>
                    </div>
                `
            }).catch(err => console.log('Welcome email skipped:', err.message));
        }

        const { password_hash: _, ...userWithoutPassword } = user;

        res.status(201).json({
            message: 'Registration successful!',
            token,
            user: { ...userWithoutPassword, admin_club_id: club_id || null }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// POST /api/auth/login
// ==========================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Find admin's club
        let admin_club_id = null;
        if (user.role === 'admin') {
            const { data: leadMembership } = await supabase
                .from('club_memberships')
                .select('club_id')
                .eq('user_id', user.id)
                .eq('role', 'lead')
                .eq('status', 'approved')
                .limit(1)
                .single();
            if (leadMembership) admin_club_id = leadMembership.club_id;
        }

        const { password_hash: _, ...userWithoutPassword } = user;

        res.json({
            message: 'Login successful!',
            token,
            user: { ...userWithoutPassword, admin_club_id }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// GET /api/auth/me
// ==========================================
router.get('/me', authenticate, async (req, res) => {
    try {
        const { password_hash: _, ...user } = req.user;

        const { data: memberships } = await supabase
            .from('club_memberships')
            .select(`
                role, status, joined_at,
                clubs (id, name, icon, color, category)
            `)
            .eq('user_id', req.userId)
            .eq('status', 'approved');

        const { count: eventsAttended } = await supabase
            .from('event_registrations')
            .select('id', { count: 'exact' })
            .eq('user_id', req.userId);

        const { count: certificateCount } = await supabase
            .from('certificates')
            .select('id', { count: 'exact' })
            .eq('user_id', req.userId);

        let admin_club_id = null;
        if (user.role === 'admin') {
            const lead = (memberships || []).find(m => m.role === 'lead');
            if (lead) admin_club_id = lead.clubs.id;
        }

        res.json({
            ...user,
            clubs: memberships || [],
            eventsAttended: eventsAttended || 0,
            certificates: certificateCount || 0,
            admin_club_id
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// PUT /api/auth/profile
// ==========================================
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

// ==========================================
// GET /api/auth/clubs-list
// ==========================================
router.get('/clubs-list', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('clubs')
            .select('id, name, icon, category')
            .eq('status', 'active')
            .order('name');

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;