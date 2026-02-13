const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// POST /api/feedback/:eventId - Submit feedback
router.post('/:eventId', authenticate, async (req, res) => {
    try {
        const { rating, comment } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
        }

        // Check if user attended the event
        const { data: registration } = await supabase
            .from('event_registrations')
            .select('status')
            .eq('event_id', req.params.eventId)
            .eq('user_id', req.userId)
            .single();

        if (!registration) {
            return res.status(400).json({ error: 'You must be registered for this event to submit feedback.' });
        }

        // Check if already submitted
        const { data: existing } = await supabase
            .from('feedback')
            .select('id')
            .eq('event_id', req.params.eventId)
            .eq('user_id', req.userId)
            .single();

        if (existing) {
            // Update existing feedback
            const { data, error } = await supabase
                .from('feedback')
                .update({ rating, comment, submitted_at: new Date() })
                .eq('id', existing.id)
                .select()
                .single();

            if (error) throw error;
            return res.json({ message: 'Feedback updated!', feedback: data });
        }

        const { data, error } = await supabase
            .from('feedback')
            .insert({
                event_id: req.params.eventId,
                user_id: req.userId,
                rating,
                comment
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ message: 'Feedback submitted! Thanks! ⭐', feedback: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/feedback/:eventId - Get feedback for an event
router.get('/:eventId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('feedback')
            .select(`
                *,
                users (id, name, profile_image)
            `)
            .eq('event_id', req.params.eventId)
            .order('submitted_at', { ascending: false });

        if (error) throw error;

        // Calculate summary
        const ratings = (data || []).map(f => f.rating);
        const avgRating = ratings.length > 0
            ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
            : 0;

        res.json({
            reviews: data || [],
            summary: {
                average_rating: parseFloat(avgRating),
                total_reviews: ratings.length,
                distribution: {
                    5: ratings.filter(r => r === 5).length,
                    4: ratings.filter(r => r === 4).length,
                    3: ratings.filter(r => r === 3).length,
                    2: ratings.filter(r => r === 2).length,
                    1: ratings.filter(r => r === 1).length,
                }
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;