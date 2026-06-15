const express = require('express');
const bcrypt = require('bcryptjs');
const { client } = require('../db');

const router = express.Router();

// 회원가입 페이지
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/app');
  res.render('register', { error: null });
});

// 회원가입 처리
router.post('/register', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) {
    return res.render('register', { error: '이메일과 비밀번호를 입력하세요.' });
  }
  if (password.length < 6) {
    return res.render('register', { error: '비밀번호는 6자 이상이어야 합니다.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await client.execute({
      sql: 'INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id',
      args: [email, hash],
    });
    const userId = result.rows[0].id;
    // 첫 노트북 기본 생성
    await client.execute({
      sql: 'INSERT INTO notebooks (user_id, name) VALUES (?, ?)',
      args: [userId, '내 노트북'],
    });
    req.session.userId = userId;
    req.session.email = email;
    res.redirect('/app');
  } catch (err) {
    // SQLite UNIQUE 위반
    if (/UNIQUE constraint/i.test(err.message || '')) {
      return res.render('register', { error: '이미 가입된 이메일입니다.' });
    }
    console.error(err);
    res.render('register', { error: '가입 중 오류가 발생했습니다.' });
  }
});

// 로그인 페이지
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/app');
  res.render('login', { error: null });
});

// 로그인 처리
router.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  try {
    const { rows } = await client.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [email],
    });
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.render('login', { error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    req.session.userId = user.id;
    req.session.email = user.email;
    res.redirect('/app');
  } catch (err) {
    console.error(err);
    res.render('login', { error: '로그인 중 오류가 발생했습니다.' });
  }
});

// 로그아웃
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
