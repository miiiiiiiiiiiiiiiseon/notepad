require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const { client, init } = require('./db');
const { LibsqlStore } = require('./session-store');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// 기동 시 환경변수 로드 상태 출력 (값은 마스킹). 누락 시 경고.
(function checkEnv() {
  const required = ['TURSO_URL', 'TURSO_TOKEN', 'SESSION_SECRET'];
  const mask = (v) => (v ? v.slice(0, 4) + '••••(len:' + v.length + ')' : '(없음)');
  console.log('[env] 환경변수 로드 상태:');
  for (const key of required) {
    console.log(`[env]   ${key} = ${mask(process.env[key])}`);
  }
  console.log(`[env]   PORT = ${process.env.PORT || '(미설정, 기본 3000)'}`);
  console.log(`[env]   NODE_ENV = ${process.env.NODE_ENV || '(미설정)'}`);
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(
      `[env] ⚠️ 누락된 필수 환경변수: ${missing.join(', ')}\n` +
      `[env]    Render 에서는 .env 파일이 무시됩니다. render.yaml 의 envVars 또는 \n` +
      `[env]    Render 대시보드(서비스 → Environment)에서 설정하세요.`
    );
  }
})();

// 뷰 엔진
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 미들웨어
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Render 의 프록시 뒤에서 secure 쿠키가 동작하도록
app.set('trust proxy', 1);

app.use(
  session({
    store: new LibsqlStore(client),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30일
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);

// 헬스체크 (Render healthCheckPath)
app.get('/healthz', (req, res) => res.send('ok'));

// 루트
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/app' : '/login');
});

// 인증 라우트
app.use('/', authRoutes);

// 메인 앱 화면 (로그인 필요)
app.get('/app', requireAuth, (req, res) => {
  res.render('app', { email: req.session.email });
});

// API (로그인 필요)
app.use('/api', requireAuth, apiRoutes);

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
  res.status(500).send('서버 오류가 발생했습니다.');
});

// 직접 실행할 때만 DB 초기화 후 서버 시작
if (require.main === module) {
  init()
    .then(() => {
      app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
    })
    .catch((err) => {
      console.error('DB 초기화 실패:', err);
      process.exit(1);
    });
}

module.exports = app;
