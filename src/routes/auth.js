const express = require('express');
const bcrypt = require('bcryptjs');
const usersModel = require('../models/users');

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
    return res.json({ ok: true, data: safeUser });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
