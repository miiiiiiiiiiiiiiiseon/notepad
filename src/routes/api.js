const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// 현재 로그인 사용자 id 헬퍼
const uid = (req) => req.session.userId;

/* ----------------------------- 노트북 ----------------------------- */

router.get('/notebooks', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT nb.id, nb.name,
              (SELECT count(*) FROM notes n WHERE n.notebook_id = nb.id) AS note_count
         FROM notebooks nb
        WHERE nb.user_id = $1
        ORDER BY nb.created_at`,
      [uid(req)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/notebooks', async (req, res, next) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '노트북 이름을 입력하세요.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO notebooks (user_id, name) VALUES ($1, $2) RETURNING id, name',
      [uid(req), name]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/notebooks/:id', async (req, res, next) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '노트북 이름을 입력하세요.' });
  try {
    const { rows } = await pool.query(
      'UPDATE notebooks SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name',
      [name, req.params.id, uid(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: '노트북을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/notebooks/:id', async (req, res, next) => {
  try {
    // 노트는 삭제하지 않고 notebook_id 만 NULL 로 (DB의 ON DELETE SET NULL)
    const { rowCount } = await pool.query(
      'DELETE FROM notebooks WHERE id = $1 AND user_id = $2',
      [req.params.id, uid(req)]
    );
    if (!rowCount) return res.status(404).json({ error: '노트북을 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ------------------------------ 태그 ------------------------------ */

router.get('/tags', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name,
              (SELECT count(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS note_count
         FROM tags t
        WHERE t.user_id = $1
        ORDER BY t.name`,
      [uid(req)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/* ------------------------------ 노트 ------------------------------ */

// 노트 목록 (필터: notebook, tag, q 검색)
router.get('/notes', async (req, res, next) => {
  const { notebook, tag, q } = req.query;
  const params = [uid(req)];
  const where = ['n.user_id = $1'];

  if (notebook) {
    params.push(notebook);
    where.push(`n.notebook_id = $${params.length}`);
  }
  if (tag) {
    params.push(tag);
    where.push(`n.id IN (SELECT note_id FROM note_tags WHERE tag_id = $${params.length})`);
  }
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(`(n.title ILIKE $${params.length} OR n.content ILIKE $${params.length})`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.title, n.notebook_id, n.updated_at,
              left(regexp_replace(n.content, '<[^>]*>', '', 'g'), 120) AS preview
         FROM notes n
        WHERE ${where.join(' AND ')}
        ORDER BY n.updated_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// 노트 단건 (태그 포함)
router.get('/notes/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM notes WHERE id = $1 AND user_id = $2',
      [req.params.id, uid(req)]
    );
    const note = rows[0];
    if (!note) return res.status(404).json({ error: '노트를 찾을 수 없습니다.' });
    const tagRes = await pool.query(
      `SELECT t.name FROM tags t
         JOIN note_tags nt ON nt.tag_id = t.id
        WHERE nt.note_id = $1 ORDER BY t.name`,
      [note.id]
    );
    note.tags = tagRes.rows.map((r) => r.name);
    res.json(note);
  } catch (err) { next(err); }
});

// 노트 생성
router.post('/notes', async (req, res, next) => {
  const { title = '', content = '', notebook_id = null } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO notes (user_id, notebook_id, title, content)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [uid(req), notebook_id || null, title, content]
    );
    const note = rows[0];
    note.tags = [];
    res.status(201).json(note);
  } catch (err) { next(err); }
});

// 노트 수정 (제목/본문/노트북/태그)
router.put('/notes/:id', async (req, res, next) => {
  const { title, content, notebook_id, tags } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE notes
          SET title = COALESCE($1, title),
              content = COALESCE($2, content),
              notebook_id = $3,
              updated_at = now()
        WHERE id = $4 AND user_id = $5
        RETURNING *`,
      [title, content, notebook_id || null, req.params.id, uid(req)]
    );
    const note = rows[0];
    if (!note) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '노트를 찾을 수 없습니다.' });
    }

    // 태그 갱신 (배열이 넘어온 경우에만)
    if (Array.isArray(tags)) {
      await client.query('DELETE FROM note_tags WHERE note_id = $1', [note.id]);
      const cleaned = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
      for (const name of cleaned) {
        const tagRes = await client.query(
          `INSERT INTO tags (user_id, name) VALUES ($1, $2)
           ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [uid(req), name]
        );
        await client.query(
          'INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [note.id, tagRes.rows[0].id]
        );
      }
      note.tags = cleaned;
    }

    await client.query('COMMIT');
    res.json(note);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 노트 삭제
router.delete('/notes/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM notes WHERE id = $1 AND user_id = $2',
      [req.params.id, uid(req)]
    );
    if (!rowCount) return res.status(404).json({ error: '노트를 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
