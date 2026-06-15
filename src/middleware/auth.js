// 로그인 여부 확인 미들웨어
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  // API 요청이면 401 JSON, 페이지 요청이면 로그인으로 리다이렉트
  // (미들웨어가 /api 로 마운트되면 req.path 에는 접두사가 없으므로 originalUrl 사용)
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  return res.redirect('/login');
}

module.exports = { requireAuth };
