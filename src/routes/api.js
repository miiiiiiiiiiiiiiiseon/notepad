const express = require('express');
const { client } = require('../db');

const router = express.Router();

// 현재 로그인 사용자 id 헬퍼
const uid = (req) => req.session.userId;

// HTML 태그를 제거해 미리보기 텍스트 생성
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ----------------------------- 노트북 ----------------------------- */

router.get('/notebooks', async (req, res, next) => {
  try {
    const { rows } = await client.execute({
      sql: `SELECT nb.id, nb.name,
                   (SELECT count(*) FROM notes n WHERE n.notebook_id = nb.id) AS note_count
              FROM notebooks nb
             WHERE nb.user_id = ?
             ORDER BY nb.created_at`,
      args: [uid(req)],
    });
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/notebooks', async (req, res, next) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '노트북 이름을 입력하세요.' });
  try {
    const { rows } = await client.execute({
      sql: 'INSERT INTO notebooks (user_id, name) VALUES (?, ?) RETURNING id, name',
      args: [uid(req), name],
    });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/notebooks/:id', async (req, res, next) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '노트북 이름을 입력하세요.' });
  try {
    const { rows } = await client.execute({
      sql: 'UPDATE notebooks SET name = ? WHERE id = ? AND user_id = ? RETURNING id, name',
      args: [name, req.params.id, uid(req)],
    });
    if (!rows[0]) return res.status(404).json({ error: '노트북을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/notebooks/:id', async (req, res, next) => {
  try {
    // 노트는 유지하고 notebook_id 만 비움
    await client.execute({
      sql: 'UPDATE notes SET notebook_id = NULL WHERE notebook_id = ? AND user_id = ?',
      args: [req.params.id, uid(req)],
    });
    const r = await client.execute({
      sql: 'DELETE FROM notebooks WHERE id = ? AND user_id = ?',
      args: [req.params.id, uid(req)],
    });
    if (!r.rowsAffected) return res.status(404).json({ error: '노트북을 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ------------------------------ 태그 ------------------------------ */

router.get('/tags', async (req, res, next) => {
  try {
    const { rows } = await client.execute({
      sql: `SELECT t.id, t.name,
                   (SELECT count(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS note_count
              FROM tags t
             WHERE t.user_id = ?
             ORDER BY t.name`,
      args: [uid(req)],
    });
    res.json(rows);
  } catch (err) { next(err); }
});

/* ------------------------------ 노트 ------------------------------ */

// 노트 목록 (필터: notebook, tag, q 검색)
router.get('/notes', async (req, res, next) => {
  const { notebook, tag, q } = req.query;
  const args = [uid(req)];
  const where = ['n.user_id = ?'];

  if (notebook) {
    args.push(notebook);
    where.push('n.notebook_id = ?');
  }
  if (tag) {
    args.push(tag);
    where.push('n.id IN (SELECT note_id FROM note_tags WHERE tag_id = ?)');
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    args.push(like, like);
    where.push('(n.title LIKE ? OR n.content LIKE ?)');
  }

  try {
    const { rows } = await client.execute({
      sql: `SELECT n.id, n.title, n.notebook_id, n.updated_at, n.content
              FROM notes n
             WHERE ${where.join(' AND ')}
             ORDER BY n.updated_at DESC`,
      args,
    });
    // 본문은 미리보기로 가공해서 내려보냄
    const out = rows.map((n) => ({
      id: n.id,
      title: n.title,
      notebook_id: n.notebook_id,
      updated_at: n.updated_at,
      preview: stripHtml(n.content).slice(0, 120),
    }));
    res.json(out);
  } catch (err) { next(err); }
});

// 노트 단건 (태그 포함)
router.get('/notes/:id', async (req, res, next) => {
  try {
    const { rows } = await client.execute({
      sql: 'SELECT * FROM notes WHERE id = ? AND user_id = ?',
      args: [req.params.id, uid(req)],
    });
    const note = rows[0];
    if (!note) return res.status(404).json({ error: '노트를 찾을 수 없습니다.' });
    const tagRes = await client.execute({
      sql: `SELECT t.name FROM tags t
              JOIN note_tags nt ON nt.tag_id = t.id
             WHERE nt.note_id = ? ORDER BY t.name`,
      args: [note.id],
    });
    note.tags = tagRes.rows.map((r) => r.name);
    res.json(note);
  } catch (err) { next(err); }
});

// 노트 생성
router.post('/notes', async (req, res, next) => {
  const { title = '', content = '', notebook_id = null } = req.body;
  try {
    const { rows } = await client.execute({
      sql: `INSERT INTO notes (user_id, notebook_id, title, content)
            VALUES (?, ?, ?, ?) RETURNING *`,
      args: [uid(req), notebook_id || null, title, content],
    });
    const note = rows[0];
    note.tags = [];
    res.status(201).json(note);
  } catch (err) { next(err); }
});

// 노트 수정 (제목/본문/노트북/태그)
router.put('/notes/:id', async (req, res, next) => {
  const { title, content, notebook_id, tags } = req.body;
  const tx = await client.transaction('write');
  try {
    const upd = await tx.execute({
      sql: `UPDATE notes
               SET title = COALESCE(?, title),
                   content = COALESCE(?, content),
                   notebook_id = ?,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE id = ? AND user_id = ?
             RETURNING *`,
      args: [
        title === undefined ? null : title,
        content === undefined ? null : content,
        notebook_id || null,
        req.params.id,
        uid(req),
      ],
    });
    const note = upd.rows[0];
    if (!note) {
      await tx.rollback();
      return res.status(404).json({ error: '노트를 찾을 수 없습니다.' });
    }

    // 태그 갱신 (배열이 넘어온 경우에만)
    if (Array.isArray(tags)) {
      await tx.execute({ sql: 'DELETE FROM note_tags WHERE note_id = ?', args: [note.id] });
      const cleaned = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
      for (const name of cleaned) {
        const tagRes = await tx.execute({
          sql: `INSERT INTO tags (user_id, name) VALUES (?, ?)
                ON CONFLICT (user_id, name) DO UPDATE SET name = excluded.name
                RETURNING id`,
          args: [uid(req), name],
        });
        await tx.execute({
          sql: 'INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
          args: [note.id, tagRes.rows[0].id],
        });
      }
      note.tags = cleaned;
    }

    await tx.commit();
    res.json(note);
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* noop */ }
    next(err);
  }
});

// 노트 삭제
router.delete('/notes/:id', async (req, res, next) => {
  try {
    await client.execute({ sql: 'DELETE FROM note_tags WHERE note_id = ?', args: [req.params.id] });
    const r = await client.execute({
      sql: 'DELETE FROM notes WHERE id = ? AND user_id = ?',
      args: [req.params.id, uid(req)],
    });
    if (!r.rowsAffected) return res.status(404).json({ error: '노트를 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
