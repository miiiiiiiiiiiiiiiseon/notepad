// express-session 용 libSQL(Turso) 세션 저장소.
// 무료 플랜에서 서버가 슬립 후 재시작돼도 로그인이 유지되도록 세션을 DB에 보관한다.
const { Store } = require('express-session');

const DAY = 1000 * 60 * 60 * 24;

function expiryOf(sess) {
  if (sess && sess.cookie && sess.cookie.expires) {
    return new Date(sess.cookie.expires).getTime();
  }
  return Date.now() + DAY;
}

class LibsqlStore extends Store {
  constructor(client) {
    super();
    this.client = client;
  }

  async get(sid, cb) {
    try {
      const { rows } = await this.client.execute({
        sql: 'SELECT sess, expire FROM sessions WHERE sid = ?',
        args: [sid],
      });
      const row = rows[0];
      if (!row) return cb(null, null);
      if (Number(row.expire) < Date.now()) {
        await this.client.execute({ sql: 'DELETE FROM sessions WHERE sid = ?', args: [sid] });
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  async set(sid, sess, cb) {
    try {
      await this.client.execute({
        sql: `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
              ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        args: [sid, JSON.stringify(sess), expiryOf(sess)],
      });
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  async destroy(sid, cb) {
    try {
      await this.client.execute({ sql: 'DELETE FROM sessions WHERE sid = ?', args: [sid] });
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  async touch(sid, sess, cb) {
    try {
      await this.client.execute({
        sql: 'UPDATE sessions SET expire = ? WHERE sid = ?',
        args: [expiryOf(sess), sid],
      });
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
}

module.exports = { LibsqlStore };
