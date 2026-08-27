const express = require('express');
const bcrypt = require('bcryptjs');
const usersModel = require('../models/users');
const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn } = require('../config');

const router = express.Router();

// A bcrypt hash of a value nobody can supply. Compared against when no user
// matched, so a request for an unknown account costs the same time as one for a
// known account -- otherwise the response latency alone enumerates accounts.
const DUMMY_HASH = bcrypt.hashSync('unmatchable-placeholder-password', 10);

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

    // Every failure below returns the same 401. Distinguishing "no such user"
    // (404) from "inactive" (403) from "wrong password" (401) told an anonymous
    // caller which phone numbers and emails have accounts, and which of those
    // are live -- free account enumeration against a public endpoint.
    const match = await bcrypt.compare(password, (user && user.password_hash) || DUMMY_HASH);
    if (!user || user.is_active === false || !match) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' });
    }

    const { password_hash, ...safeUser } = user;
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });

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
