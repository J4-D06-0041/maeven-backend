const express = require('express');
const bcrypt = require('bcryptjs');
const usersModel = require('../models/users');
const jwt = require('jsonwebtoken');

const router = express.Router();

// POST /login
// Accepts { phone?, email?, password }
router.post('/login', async (req, res) => {
  try {
    const { phone, email, password } = req.body || {};
    if ((!phone && !email) || !password) {
      return res.status(400).json({ ok: false, error: 'phone or email and password are required' });
    }

    let user = null;
    if (phone) user = await usersModel.findByPhone(phone);
    if (!user && email) user = await usersModel.findByEmail(email);

    if (!user) return res.status(404).json({ ok: false, error: 'user not found' });
    if (user.is_active === false) return res.status(403).json({ ok: false, error: 'user is inactive' });

    const hash = user.password_hash || '';
    const match = await bcrypt.compare(password, hash);
    if (!match) return res.status(401).json({ ok: false, error: 'invalid credentials' });

    const { password_hash, ...safeUser } = user;
    // Build JWT token (include id and role). Provide a fallback secret for dev.
    const jwtSecret = process.env.JWT_SECRET || 'please-change-this-secret';
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: '8h' });

    // Normalize user object expected by clients
    const userPayload = {
      id: user.id,
      name: user.full_name || user.fullName || null,
      phone: user.phone || null,
      role: user.role || null
    };

    // Return original data plus the token and normalized user object
    return res.json({ ok: true, data: safeUser, token, user: userPayload });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
