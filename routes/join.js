const express = require('express');
const { getDb } = require('../db/init');

const router = express.Router();

function normalizeName(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_'`".,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// POST /api/join/verify — public; body { token, answer }; checks answer === prenume (case-insensitive)
router.post('/verify', (req, res) => {
  const db = getDb();
  const { token, answer } = req.body;
  if (!token || typeof answer !== 'string') return res.status(400).json({ error: 'token and answer required' });
  const invite = db.prepare(
    'SELECT id, prenume FROM invitations WHERE token = ? AND used_by IS NULL'
  ).get(token);
  if (!invite) return res.status(404).json({ error: 'Invite not found or already used' });
  const expected = normalizeName(invite.prenume);
  const given = normalizeName(answer);
  const expectedCompact = expected.replace(/\s+/g, '');
  const givenCompact = given.replace(/\s+/g, '');

  // Accept exact, compact-equivalent (spaces/hyphens), or full-name input starting with prenume.
  const ok = (
    !!expected &&
    !!given &&
    (
      expected === given ||
      expectedCompact === givenCompact ||
      given === expected.split(' ')[0] ||
      given.startsWith(expected + ' ') ||
      given.startsWith(expected.split(' ')[0] + ' ')
    )
  );

  if (!ok) return res.status(400).json({ error: 'Wrong answer' });
  res.json({ ok: true });
});

// GET /api/join/:token — public; returns nume, prenume if invite exists and unused
router.get('/:token', (req, res) => {
  const db = getDb();
  const invite = db.prepare(
    'SELECT id, nume, prenume FROM invitations WHERE token = ? AND used_by IS NULL'
  ).get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Invite not found or already used' });
  res.json({ nume: invite.nume || '', prenume: invite.prenume || '' });
});

module.exports = router;
